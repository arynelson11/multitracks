import type { VercelRequest, VercelResponse } from '@vercel/node';
import axios from 'axios';
import { applyCors } from './_lib/cors.js';

// Endpoint unico de estatisticas de admin, roteado por ?source=.
// Consolida o que antes eram duas funcoes serverless (abacatepay-stats +
// replicate-stats) pra respeitar o limite de 12 funcoes do plano Hobby da Vercel.

// ───────────────────────── AbacatePay ─────────────────────────
async function abacatePayStats(res: VercelResponse) {
  const token = process.env.ABACATEPAY_ACCESS_TOKEN;
  if (!token) return res.status(500).json({ error: 'Server misconfiguration' });

  const api = axios.create({
    baseURL: 'https://api.abacatepay.com/v2',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  });

  const [checkoutsRes, subscriptionsRes] = await Promise.allSettled([
    api.get('/checkouts'),
    api.get('/subscriptions'),
  ]);

  const checkouts: any[] = checkoutsRes.status === 'fulfilled'
    ? (checkoutsRes.value.data?.data ?? [])
    : [];

  const subscriptions: any[] = subscriptionsRes.status === 'fulfilled'
    ? (subscriptionsRes.value.data?.data ?? [])
    : [];

  const paidCheckouts = checkouts.filter((c: any) => c.status === 'PAID');
  const totalRevenueCents = paidCheckouts.reduce((sum: number, c: any) => sum + (c.amount ?? 0), 0);
  const activeSubscriptions = subscriptions.filter((s: any) => s.status === 'ACTIVE');

  // Recent 10 payments across both lists
  const recent = [...checkouts, ...subscriptions]
    .sort((a, b) => new Date(b.createdAt ?? b.created_at ?? 0).getTime() - new Date(a.createdAt ?? a.created_at ?? 0).getTime())
    .slice(0, 10)
    .map((c: any) => ({
      id: c.id,
      status: c.status,
      amount: c.amount ?? 0,
      createdAt: c.createdAt ?? c.created_at ?? null,
      metadata: c.metadata ?? null,
    }));

  return res.status(200).json({
    totalRevenueBRL: totalRevenueCents / 100,
    paidCount: paidCheckouts.length,
    totalCheckouts: checkouts.length,
    activeSubscriptions: activeSubscriptions.length,
    totalSubscriptions: subscriptions.length,
    recent,
  });
}

// ───────────────────────── Replicate ─────────────────────────
// Replicate hardware pricing (USD per second) — https://replicate.com/pricing
const HARDWARE_PRICING: Record<string, number> = {
  'cpu':                    0.000100,
  'nvidia-t4-gpu':          0.000225,
  'nvidia-t4-gpu-high':     0.000225,
  'nvidia-a40-gpu':         0.000575,
  'nvidia-a40-gpu-large':   0.000725,
  'nvidia-a100-gpu':        0.001150,
  'nvidia-a100-gpu-large':  0.002300,
  'nvidia-h100-gpu':        0.003500,
};

// Known version → hardware map (avoids extra API calls for frequently used models)
const VERSION_HARDWARE: Record<string, string> = {
  '25a173108cff36ef9f80f854c162d01df9e6528be175794b81158fa03836d953': 'cpu', // htdemucs_6s
};

interface ReplicatePrediction {
  id: string;
  model: string;
  version: string | null;
  status: 'starting' | 'processing' | 'succeeded' | 'failed' | 'canceled';
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  metrics?: { predict_time?: number; total_time?: number };
  source: string;
  urls: { get: string };
}

interface ReplicateListResponse {
  results: ReplicatePrediction[];
  next: string | null;
}

interface ReplicateVersionDetail {
  id: string;
  openapi_schema?: { info?: { 'x-replicate-hardware'?: string } };
}

async function getVersionHardware(token: string, model: string, version: string): Promise<string> {
  if (VERSION_HARDWARE[version]) return VERSION_HARDWARE[version];
  try {
    const [owner, name] = model.split('/');
    if (!owner || !name) return 'cpu';
    const res = await fetch(`https://api.replicate.com/v1/models/${owner}/${name}/versions/${version}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return 'cpu';
    const data = await res.json() as ReplicateVersionDetail;
    const hw = data.openapi_schema?.info?.['x-replicate-hardware'] ?? 'cpu';
    VERSION_HARDWARE[version] = hw;
    return hw;
  } catch {
    return 'cpu';
  }
}

function costUSD(predictTime: number, hardware: string): number {
  const rate = HARDWARE_PRICING[hardware] ?? HARDWARE_PRICING['cpu'];
  return predictTime * rate;
}

async function replicateStats(res: VercelResponse) {
  const token = process.env.REPLICATE_API_TOKEN;
  if (!token) return res.status(500).json({ error: 'REPLICATE_API_TOKEN not configured' });

  try {
    // Fetch up to 5 pages of predictions (max 500)
    const allPredictions: ReplicatePrediction[] = [];
    let nextUrl: string | null = 'https://api.replicate.com/v1/predictions?limit=100';
    let pages = 0;

    while (nextUrl && pages < 5) {
      const response = await fetch(nextUrl, {
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      });
      if (!response.ok) {
        const err = await response.text();
        throw new Error(`Replicate API error: ${response.status} ${err}`);
      }
      const data = await response.json() as ReplicateListResponse;
      allPredictions.push(...data.results);
      nextUrl = data.next ?? null;
      pages++;
    }

    // Resolve hardware for unique versions (batch, deduplicated)
    const uniqueVersions = [...new Set(
      allPredictions
        .filter(p => p.version && p.model)
        .map(p => JSON.stringify({ version: p.version, model: p.model }))
    )].map(s => JSON.parse(s) as { version: string; model: string });

    const hardwareMap: Record<string, string> = {};
    await Promise.all(
      uniqueVersions.map(async ({ version, model }) => {
        hardwareMap[version] = await getVersionHardware(token, model, version);
      })
    );

    // Build enriched predictions with cost
    const enriched = allPredictions.map(p => {
      const predictTime = p.metrics?.predict_time ?? 0;
      const hardware = p.version ? (hardwareMap[p.version] ?? 'cpu') : 'cpu';
      const cost = costUSD(predictTime, hardware);
      return { ...p, predictTime, hardware, cost };
    });

    // Time windows
    const now = new Date();
    const startOf30d = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    const recent = enriched.filter(p => new Date(p.created_at) >= startOf30d);

    // Aggregate
    const succeeded = enriched.filter(p => p.status === 'succeeded').length;
    const failed = enriched.filter(p => p.status === 'failed').length;
    const recentSucceeded = recent.filter(p => p.status === 'succeeded').length;
    const recentFailed = recent.filter(p => p.status === 'failed').length;

    const totalPredictTime = enriched.reduce((s, p) => s + p.predictTime, 0);
    const recentPredictTime = recent.reduce((s, p) => s + p.predictTime, 0);

    const totalCostUSD = enriched.reduce((s, p) => s + p.cost, 0);
    const recentCostUSD = recent.reduce((s, p) => s + p.cost, 0);

    // Monthly cost breakdown (last 6 months)
    const monthlyCosts: Record<string, number> = {};
    for (const p of enriched) {
      const month = p.created_at.slice(0, 7); // "YYYY-MM"
      monthlyCosts[month] = (monthlyCosts[month] ?? 0) + p.cost;
    }
    const monthlyCostsSorted = Object.entries(monthlyCosts)
      .sort((a, b) => a[0].localeCompare(b[0]))
      .slice(-6)
      .map(([month, cost]) => ({ month, cost: parseFloat(cost.toFixed(4)) }));

    // Top models by usage + cost
    const modelMap: Record<string, { total: number; succeeded: number; totalTime: number; totalCost: number }> = {};
    for (const p of enriched) {
      const m = p.model || 'unknown';
      if (!modelMap[m]) modelMap[m] = { total: 0, succeeded: 0, totalTime: 0, totalCost: 0 };
      modelMap[m].total++;
      if (p.status === 'succeeded') modelMap[m].succeeded++;
      modelMap[m].totalTime += p.predictTime;
      modelMap[m].totalCost += p.cost;
    }
    const topModels = Object.entries(modelMap)
      .sort((a, b) => b[1].total - a[1].total)
      .slice(0, 5)
      .map(([model, s]) => ({
        model,
        total: s.total,
        succeeded: s.succeeded,
        totalTime: Math.round(s.totalTime),
        totalCost: parseFloat(s.totalCost.toFixed(4)),
      }));

    // Last 20 predictions
    const recentList = enriched.slice(0, 20).map(p => ({
      id: p.id,
      model: p.model,
      status: p.status,
      source: p.source,
      created_at: p.created_at,
      predict_time: p.predictTime > 0 ? parseFloat(p.predictTime.toFixed(2)) : null,
      hardware: p.hardware,
      estimated_cost: parseFloat(p.cost.toFixed(4)),
    }));

    return res.status(200).json({
      total: enriched.length,
      succeeded,
      failed,
      recentTotal: recent.length,
      recentSucceeded,
      recentFailed,
      totalPredictTime: Math.round(totalPredictTime),
      recentPredictTime: Math.round(recentPredictTime),
      totalCostUSD: parseFloat(totalCostUSD.toFixed(4)),
      recentCostUSD: parseFloat(recentCostUSD.toFixed(4)),
      monthlyCosts: monthlyCostsSorted,
      topModels,
      recentList,
    });
  } catch (error: any) {
    console.error('replicate-stats error:', error);
    return res.status(500).json({ error: error.message || 'Internal Server Error' });
  }
}

// ───────────────────────── Router ─────────────────────────
export default async function handler(req: VercelRequest, res: VercelResponse) {
  applyCors(req, res, 'GET,OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const source = (req.query.source as string) || '';
  if (source === 'abacatepay') return abacatePayStats(res);
  if (source === 'replicate') return replicateStats(res);
  return res.status(400).json({ error: 'Parametro "source" invalido (use abacatepay ou replicate)' });
}

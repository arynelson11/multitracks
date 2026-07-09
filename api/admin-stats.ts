import type { VercelRequest, VercelResponse } from '@vercel/node';
import axios from 'axios';
import { createClient } from '@supabase/supabase-js';
import { applyCors } from './_lib/cors.js';
import { verifyAdmin } from './_lib/auth.js';

// Endpoint unico de estatisticas de admin, roteado por ?source=.
// Consolida o que antes eram duas funcoes serverless (payment-stats +
// replicate-stats) pra respeitar o limite de 12 funcoes do plano Hobby da Vercel.

// ───────────────────────── Asaas ─────────────────────────
// Provedor de pagamento atual (migrou do AbacatePay). value vem em REAIS
// (não centavos). Statuses que representam dinheiro efetivamente recebido:
const ASAAS_PAID_STATUSES = new Set(['RECEIVED', 'CONFIRMED', 'RECEIVED_IN_CASH']);

function asaasBaseUrl(): string {
  return process.env.ASAAS_ENV === 'production'
    ? 'https://api.asaas.com/v3'
    : 'https://api-sandbox.asaas.com/v3';
}

async function asaasStats(res: VercelResponse) {
  // Mapa valor+ciclo -> plano (espelha PLAN_PRICING de checkout.ts). Usado para
  // classificar assinaturas do Asaas por plano e calcular MRR.
  const PLAN_BY_VALUE: Record<string, string> = {
    '49.9|MONTHLY': 'essencial_mensal',
    '454.8|YEARLY': 'essencial_anual',
    '119.9|MONTHLY': 'pro_mensal',
    '1078.8|YEARLY': 'pro_anual',
  };
  const monthlyEquiv = (value: number, cycle: string) =>
    cycle === 'YEARLY' ? value / 12 : value;

  const apiKey = process.env.ASAAS_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'Server misconfiguration: ASAAS_API_KEY' });

  const api = axios.create({
    baseURL: asaasBaseUrl(),
    headers: { access_token: apiKey, 'Content-Type': 'application/json' },
    timeout: 9000,
  });

  // Pagina uma lista do Asaas (offset/limit + hasMore), com cap defensivo.
  async function fetchAll(path: string, maxPages = 10): Promise<any[]> {
    const out: any[] = [];
    const limit = 100;
    let offset = 0;
    for (let page = 0; page < maxPages; page++) {
      const { data } = await api.get(path, { params: { limit, offset } });
      const rows: any[] = data?.data ?? [];
      out.push(...rows);
      if (!data?.hasMore || rows.length < limit) break;
      offset += limit;
    }
    return out;
  }

  const [paymentsRes, subscriptionsRes] = await Promise.allSettled([
    fetchAll('/payments'),
    fetchAll('/subscriptions'),
  ]);

  const payments: any[]      = paymentsRes.status === 'fulfilled' ? paymentsRes.value : [];
  const subscriptions: any[] = subscriptionsRes.status === 'fulfilled' ? subscriptionsRes.value : [];

  const paid = payments.filter((p: any) => ASAAS_PAID_STATUSES.has(p.status));
  const totalRevenueBRL = paid.reduce((sum: number, p: any) => sum + (Number(p.value) || 0), 0);
  const activeSubscriptions = subscriptions.filter((s: any) => s.status === 'ACTIVE');

  let mrrBRL = 0;
  const byPlan = new Map<string, { count: number; monthlyBRL: number }>();
  for (const s of activeSubscriptions) {
    const value = Number(s.value) || 0;
    const cycle = String(s.cycle || 'MONTHLY');
    const monthly = monthlyEquiv(value, cycle);
    mrrBRL += monthly;
    const key = PLAN_BY_VALUE[`${value}|${cycle}`] ?? 'desconhecido';
    const cur = byPlan.get(key) ?? { count: 0, monthlyBRL: 0 };
    cur.count += 1;
    cur.monthlyBRL += monthly;
    byPlan.set(key, cur);
  }
  const revenueByPlan = [...byPlan.entries()].map(([planKey, v]) => ({
    planKey,
    count: v.count,
    monthlyBRL: parseFloat(v.monthlyBRL.toFixed(2)),
  }));

  // Cobranças mais recentes (valor em reais — o front formata direto com fmtBRL).
  const recent = [...payments]
    .sort((a, b) => new Date(b.dateCreated ?? 0).getTime() - new Date(a.dateCreated ?? 0).getTime())
    .slice(0, 10)
    .map((p: any) => ({
      id: p.id,
      status: p.status,
      amount: Number(p.value) || 0,
      createdAt: p.dateCreated ?? null,
      metadata: null,
    }));

  return res.status(200).json({
    totalRevenueBRL,
    paidCount: paid.length,
    totalCheckouts: payments.length,
    activeSubscriptions: activeSubscriptions.length,
    totalSubscriptions: subscriptions.length,
    mrrBRL: parseFloat(mrrBRL.toFixed(2)),
    revenueByPlan,
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
    const monthlyRuns: Record<string, number> = {};
    for (const p of enriched) {
      const month = p.created_at.slice(0, 7); // "YYYY-MM"
      monthlyCosts[month] = (monthlyCosts[month] ?? 0) + p.cost;
      monthlyRuns[month] = (monthlyRuns[month] ?? 0) + 1;
    }
    const monthlyCostsSorted = Object.entries(monthlyCosts)
      .sort((a, b) => a[0].localeCompare(b[0]))
      .slice(-6)
      .map(([month, cost]) => ({ month, cost: parseFloat(cost.toFixed(4)) }));
    // Contagem real de separações por mês (não custo) — usado na aba Uso & Sinais.
    const monthlyCountsSorted = Object.entries(monthlyRuns)
      .sort((a, b) => a[0].localeCompare(b[0]))
      .slice(-6)
      .map(([month, count]) => ({ month, count }));

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

    // Custo de IA por usuário: cruza predictions do Replicate (id + custo) com
    // a tabela public.predictions (replicate_id -> user_id) via service role.
    const perUser: Array<{ userId: string; runs: number; costUSD: number; costUSD30d: number }> = [];
    const supaUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (supaUrl && serviceKey) {
      try {
        const supabase = createClient(supaUrl, serviceKey);
        const ids = enriched.map(p => p.id);
        // Busca ownership em lotes (evita URL gigante no .in()).
        const ownerMap = new Map<string, string>(); // replicate_id -> user_id
        const CHUNK = 200;
        for (let i = 0; i < ids.length; i += CHUNK) {
          const slice = ids.slice(i, i + CHUNK);
          const { data } = await supabase
            .from('predictions')
            .select('replicate_id, user_id')
            .in('replicate_id', slice);
          for (const row of data ?? []) ownerMap.set(row.replicate_id, row.user_id);
        }
        const agg = new Map<string, { runs: number; costUSD: number; costUSD30d: number }>();
        for (const p of enriched) {
          const uid = ownerMap.get(p.id);
          if (!uid) continue;
          const cur = agg.get(uid) ?? { runs: 0, costUSD: 0, costUSD30d: 0 };
          cur.runs += 1;
          cur.costUSD += p.cost;
          if (new Date(p.created_at) >= startOf30d) cur.costUSD30d += p.cost;
          agg.set(uid, cur);
        }
        for (const [userId, v] of agg) {
          perUser.push({
            userId,
            runs: v.runs,
            costUSD: parseFloat(v.costUSD.toFixed(4)),
            costUSD30d: parseFloat(v.costUSD30d.toFixed(4)),
          });
        }
      } catch (e) {
        console.error('[admin-stats] perUser cost join failed:', e instanceof Error ? e.message : e);
      }
    }

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
      monthlyCounts: monthlyCountsSorted,
      topModels,
      recentList,
      perUser,
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

  // Dados de negócio (receita, assinaturas, custos): só admin.
  const auth = await verifyAdmin(req);
  if (!auth.ok) return res.status(auth.status).json({ error: auth.error });

  const source = (req.query.source as string) || '';
  if (source === 'asaas') return asaasStats(res);
  if (source === 'replicate') return replicateStats(res);
  return res.status(400).json({ error: 'Parametro "source" invalido (use asaas ou replicate)' });
}

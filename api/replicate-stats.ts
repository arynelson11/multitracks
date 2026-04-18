import type { VercelRequest, VercelResponse } from '@vercel/node';

interface ReplicatePrediction {
  id: string;
  model: string;
  version: string | null;
  status: 'starting' | 'processing' | 'succeeded' | 'failed' | 'canceled';
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  metrics?: { predict_time?: number };
  source: string;
  urls: { get: string };
}

interface ReplicateListResponse {
  results: ReplicatePrediction[];
  next: string | null;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const token = process.env.REPLICATE_API_TOKEN;
  if (!token) return res.status(500).json({ error: 'REPLICATE_API_TOKEN not configured' });

  try {
    // Fetch up to 3 pages of predictions (max 250 predictions)
    const allPredictions: ReplicatePrediction[] = [];
    let nextUrl: string | null = 'https://api.replicate.com/v1/predictions?limit=100';
    let pages = 0;

    while (nextUrl && pages < 3) {
      const response = await fetch(nextUrl, {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        const err = await response.text();
        throw new Error(`Replicate API error: ${response.status} ${err}`);
      }

      const data: ReplicateListResponse = await response.json();
      allPredictions.push(...data.results);
      nextUrl = data.next ?? null;
      pages++;
    }

    // Aggregate stats
    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    const recent = allPredictions.filter(p => new Date(p.created_at) >= thirtyDaysAgo);

    const succeeded = allPredictions.filter(p => p.status === 'succeeded').length;
    const failed = allPredictions.filter(p => p.status === 'failed').length;
    const recentSucceeded = recent.filter(p => p.status === 'succeeded').length;

    const totalPredictTime = allPredictions.reduce((acc, p) => acc + (p.metrics?.predict_time ?? 0), 0);
    const recentPredictTime = recent.reduce((acc, p) => acc + (p.metrics?.predict_time ?? 0), 0);

    // Group by model
    const modelCounts: Record<string, { total: number; succeeded: number; totalTime: number }> = {};
    for (const p of allPredictions) {
      const model = p.model || 'unknown';
      if (!modelCounts[model]) modelCounts[model] = { total: 0, succeeded: 0, totalTime: 0 };
      modelCounts[model].total++;
      if (p.status === 'succeeded') modelCounts[model].succeeded++;
      modelCounts[model].totalTime += p.metrics?.predict_time ?? 0;
    }

    const topModels = Object.entries(modelCounts)
      .sort((a, b) => b[1].total - a[1].total)
      .slice(0, 5)
      .map(([model, stats]) => ({ model, ...stats }));

    // Last 20 predictions for the table
    const recentList = allPredictions.slice(0, 20).map(p => ({
      id: p.id,
      model: p.model,
      status: p.status,
      source: p.source,
      created_at: p.created_at,
      predict_time: p.metrics?.predict_time ?? null,
    }));

    return res.status(200).json({
      total: allPredictions.length,
      succeeded,
      failed,
      recentTotal: recent.length,
      recentSucceeded,
      totalPredictTime: Math.round(totalPredictTime),
      recentPredictTime: Math.round(recentPredictTime),
      topModels,
      recentList,
    });
  } catch (error: any) {
    console.error('replicate-stats error:', error);
    return res.status(500).json({ error: error.message || 'Internal Server Error' });
  }
}

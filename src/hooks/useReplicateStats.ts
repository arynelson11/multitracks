import { useState, useEffect, useCallback } from 'react';

export interface ReplicatePredictionRow {
  id: string;
  model: string;
  status: 'starting' | 'processing' | 'succeeded' | 'failed' | 'canceled';
  source: string;
  created_at: string;
  predict_time: number | null;
  hardware: string;
  estimated_cost: number;
}

export interface ReplicateTopModel {
  model: string;
  total: number;
  succeeded: number;
  totalTime: number;
  totalCost: number;
}

export interface ReplicateMonthlyCost {
  month: string; // "YYYY-MM"
  cost: number;
}

export interface ReplicateStats {
  total: number;
  succeeded: number;
  failed: number;
  recentTotal: number;
  recentSucceeded: number;
  recentFailed: number;
  totalPredictTime: number;
  recentPredictTime: number;
  totalCostUSD: number;
  recentCostUSD: number;
  monthlyCosts: ReplicateMonthlyCost[];
  topModels: ReplicateTopModel[];
  recentList: ReplicatePredictionRow[];
}

export function useReplicateStats() {
  const [stats, setStats] = useState<ReplicateStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchStats = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/replicate-stats');
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      const data: ReplicateStats = await res.json();
      setStats(data);
    } catch (err: any) {
      setError(err.message || 'Erro ao buscar dados do Replicate');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStats();
  }, [fetchStats]);

  return { stats, loading, error, refetch: fetchStats };
}

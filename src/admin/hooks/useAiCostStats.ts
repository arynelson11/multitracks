import { useState, useEffect, useCallback } from 'react';
import { apiUrl } from '../../lib/api';
import { getAuthHeaders } from '../../lib/supabase';

export interface AiCostStats {
  total: number; succeeded: number; failed: number;
  recentTotal: number; recentCostUSD: number; totalCostUSD: number;
  recentPredictTime: number; totalPredictTime: number;
  monthlyCosts: { month: string; cost: number }[];
  topModels: { model: string; total: number; succeeded: number; totalTime: number; totalCost: number }[];
  recentList: { id: string; model: string; status: string; source: string; created_at: string; predict_time: number | null; hardware: string; estimated_cost: number }[];
  perUser: { userId: string; runs: number; costUSD: number; costUSD30d: number }[];
}

export function useAiCostStats() {
  const [stats, setStats] = useState<AiCostStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const res = await fetch(apiUrl('/api/admin-stats?source=replicate'), { headers: await getAuthHeaders() });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Erro ao buscar custos de IA');
      setStats(data);
    } catch (e) { setError(e instanceof Error ? e.message : 'Erro ao buscar custos de IA'); } finally { setLoading(false); }
  }, []);

  useEffect(() => { refetch(); }, [refetch]);
  return { stats, loading, error, refetch };
}

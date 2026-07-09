import { useState, useEffect, useCallback } from 'react';
import { apiUrl } from '../../lib/api';
import { getAuthHeaders } from '../../lib/supabase';

export interface FinanceStats {
  totalRevenueBRL: number; paidCount: number; totalCheckouts: number;
  activeSubscriptions: number; totalSubscriptions: number; mrrBRL: number;
  revenueByPlan: { planKey: string; count: number; monthlyBRL: number }[];
  recent: { id: string; status: string; amount: number; createdAt: string | null }[];
}

export function useFinanceStats() {
  const [stats, setStats] = useState<FinanceStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const res = await fetch(apiUrl('/api/admin-stats?source=asaas'), { headers: await getAuthHeaders() });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Erro ao buscar financeiro');
      setStats(data);
    } catch (e) { setError(e instanceof Error ? e.message : 'Erro ao buscar financeiro'); } finally { setLoading(false); }
  }, []);

  useEffect(() => { refetch(); }, [refetch]);
  return { stats, loading, error, refetch };
}

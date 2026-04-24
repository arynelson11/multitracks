import { useState, useEffect, useCallback } from 'react';

export interface AbacatePayStats {
  totalRevenueBRL: number;
  paidCount: number;
  totalCheckouts: number;
  activeSubscriptions: number;
  totalSubscriptions: number;
  recent: {
    id: string;
    status: string;
    amount: number;
    createdAt: string | null;
    metadata: Record<string, any> | null;
  }[];
}

export function useAbacatePayStats() {
  const [stats, setStats] = useState<AbacatePayStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await fetch('/api/abacatepay-stats');
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Erro ao buscar dados');
      setStats(data);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refetch(); }, [refetch]);

  return { stats, loading, error, refetch };
}

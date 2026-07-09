import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../../lib/supabase';

export interface AdminUser {
  id: string; email: string; display_name: string | null; provider: string | null;
  created_at: string; last_sign_in_at: string | null; is_active: boolean;
  plan: string; separations_count: number;
}
export interface UsersStats {
  totalUsers: number; activeUsers: number; inactiveUsers: number;
  newUsers7d: number; newUsers30d: number; paidSubscribers: number;
  totalSeparations: number; planDistribution: Record<string, number>; users: AdminUser[];
}

export function useAdminUsers() {
  const [stats, setStats] = useState<UsersStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    if (!supabase) { setError('Supabase não configurado'); setLoading(false); return; }
    setLoading(true); setError(null);
    try {
      const { data, error: rpcError } = await supabase.rpc('get_admin_dashboard_stats');
      if (rpcError) throw new Error(`${rpcError.message}. Rodou o SQL do RPC no Supabase?`);
      setStats({
        totalUsers: data?.totalUsers ?? 0,
        activeUsers: data?.activeUsers ?? 0,
        inactiveUsers: data?.inactiveUsers ?? 0,
        newUsers7d: data?.newUsers7d ?? 0,
        newUsers30d: data?.newUsers30d ?? 0,
        paidSubscribers: data?.paidSubscribers ?? 0,
        totalSeparations: data?.totalSeparations ?? 0,
        planDistribution: data?.planDistribution ?? {},
        users: Array.isArray(data?.users) ? data.users : [],
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao carregar usuários');
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { refetch(); }, [refetch]);
  return { stats, loading, error, refetch };
}

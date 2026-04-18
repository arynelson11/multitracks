import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';

export interface AdminUser {
    id: string;
    email: string;
    display_name: string | null;
    provider: string | null;
    created_at: string;
    last_sign_in_at: string | null;
    is_active: boolean;
    songs_count: number;
    tokens_used: number;
    plan: string;
}

export interface AdminStats {
    totalUsers: number;
    activeUsers: number;
    inactiveUsers: number;
    totalSongs: number;
    totalTokensUsed: number;
    totalSubscribers: number;
    monthlyRevenue: number;
    users: AdminUser[];
}

export function useAdminDashboard() {
    const [stats, setStats] = useState<AdminStats | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const fetchStats = useCallback(async () => {
        if (!supabase) {
            setError('Supabase não configurado');
            setLoading(false);
            return;
        }

        setLoading(true);
        setError(null);

        try {
            const { data, error: rpcError } = await supabase.rpc('get_admin_dashboard_stats');
            
            if (rpcError) {
                throw new Error(`Erro ao buscar dados do dashboard: ${rpcError.message}. Certifique-se de ter executado o SQL RPC no Supabase.`);
            }

            if (data) {
                // Ensure users array is typed and properly formatted
                const parsedStats: AdminStats = {
                    totalUsers: data.totalUsers || 0,
                    activeUsers: data.activeUsers || 0,
                    inactiveUsers: data.inactiveUsers || 0,
                    totalSongs: data.totalSongs || 0,
                    totalTokensUsed: data.totalTokensUsed || 0,
                    totalSubscribers: data.totalSubscribers || 0,
                    monthlyRevenue: data.monthlyRevenue || 0,
                    users: Array.isArray(data.users) ? data.users : []
                };
                setStats(parsedStats);
            }

        } catch (err: any) {
            console.error('Admin dashboard error:', err);
            setError(err.message || 'Erro ao carregar dados');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchStats();
    }, [fetchStats]);

    return { stats, loading, error, refetch: fetchStats };
}

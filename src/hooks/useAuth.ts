import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { apiUrl } from '../lib/api';
import type { User, Session } from '@supabase/supabase-js';

export function useAuth() {
    const [user, setUser] = useState<User | null>(null);
    const [session, setSession] = useState<Session | null>(null);
    const [loading, setLoading] = useState(true);
    const [userPlan, setUserPlan] = useState<string>('free');

    useEffect(() => {
        if (!supabase) {
            setLoading(false);
            return;
        }

        const fetchPlan = async (userId: string) => {
            try {
                const { data } = await supabase!
                    .from('profiles')
                    .select('plan')
                    .eq('id', userId)
                    .single();
                
                if (data && data.plan) {
                    setUserPlan(data.plan);
                } else {
                    setUserPlan('free');
                }
            } catch (err) {
                console.error("Error fetching user plan:", err);
            }
        };

        // Get initial session
        supabase!.auth.getSession().then(({ data: { session } }) => {
            setSession(session);
            setUser(session?.user ?? null);
            if (session?.user) {
                fetchPlan(session.user.id).finally(() => setLoading(false));
            } else {
                setLoading(false);
            }
        });

        // Listen for changes on auth state (login, logout, etc)
        const { data: { subscription } } = supabase!.auth.onAuthStateChange((_event, session) => {
            setSession(session);
            setUser(session?.user ?? null);
            if (session?.user) {
                fetchPlan(session.user.id).finally(() => setLoading(false));
            } else {
                setUserPlan('free');
                setLoading(false);
            }
        });

        return () => subscription.unsubscribe();
    }, []);

    const signOut = async () => {
        await supabase!.auth.signOut();
    };

    // Logout em todos os dispositivos (revoga todas as sessões).
    const signOutEverywhere = async () => {
        await supabase!.auth.signOut({ scope: 'global' });
    };

    // Atualiza nome de exibição e/ou foto (guardados em user_metadata).
    const updateProfile = async (data: { displayName?: string; avatarUrl?: string }) => {
        const metadata: Record<string, string> = {};
        if (data.displayName !== undefined) metadata.display_name = data.displayName;
        if (data.avatarUrl !== undefined) metadata.avatar_url = data.avatarUrl;
        const { data: res, error } = await supabase!.auth.updateUser({ data: metadata });
        if (error) throw error;
        if (res.user) setUser(res.user);
        return res.user;
    };

    // Define ou troca a senha (funciona inclusive para contas que entraram via Google).
    const updatePassword = async (newPassword: string) => {
        const { error } = await supabase!.auth.updateUser({ password: newPassword });
        if (error) throw error;
    };

    // Exclui a própria conta (endpoint serverless valida o JWT e usa service_role).
    const deleteAccount = async () => {
        const { data: { session } } = await supabase!.auth.getSession();
        const token = session?.access_token;
        if (!token) throw new Error('Sessão expirada');
        const res = await fetch(apiUrl('/api/delete-account'), {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        });
        if (!res.ok) {
            const body = await res.json().catch(() => ({}));
            throw new Error(body.error || 'Falha ao excluir conta');
        }
        await supabase!.auth.signOut();
    };

    return {
        user,
        session,
        loading,
        userPlan,
        signOut,
        signOutEverywhere,
        updateProfile,
        updatePassword,
        deleteAccount
    };
}

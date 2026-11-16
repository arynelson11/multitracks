import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { apiUrl } from '../lib/api';
import { effectivePlan, fetchPlanState } from '../lib/planState';
import type { User, Session } from '@supabase/supabase-js';

const PLAN_CHANGED_EVENT = 'playback-plan-changed';

export function useAuth() {
    const [user, setUser] = useState<User | null>(null);
    const [session, setSession] = useState<Session | null>(null);
    const [loading, setLoading] = useState(true);
    const [rawPlan, setRawPlan] = useState<string>('free');
    // Depois de cancelada, a assinatura vale até esta data; daí em diante é Livre.
    const [planExpiresAt, setPlanExpiresAt] = useState<string | null>(null);
    const [expiryTick, setExpiryTick] = useState(0);

    const fetchPlan = useCallback(async (userId: string) => {
        const state = await fetchPlanState(userId);
        if (!state) return; // erro de rede: mantém o que já tinha
        setRawPlan(state.plan);
        setPlanExpiresAt(state.planExpiresAt);
    }, []);

    // Se a data de fim chegar com o app aberto, reavalia sozinho.
    useEffect(() => {
        if (!planExpiresAt) return;
        const ms = Date.parse(planExpiresAt) - Date.now();
        if (!(ms > 0) || ms > 2_000_000_000) return;
        const t = setTimeout(() => setExpiryTick(x => x + 1), ms + 1000);
        return () => clearTimeout(t);
    }, [planExpiresAt]);

    void expiryTick; // só força o novo render quando a data de fim passa
    const userPlan = effectivePlan(rawPlan, planExpiresAt);

    useEffect(() => {
        if (!supabase) {
            setLoading(false);
            return;
        }

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
                setRawPlan('free');
                setPlanExpiresAt(null);
                setLoading(false);
            }
        });

        return () => subscription.unsubscribe();
    }, [fetchPlan]);

    // Relê o plano em TODAS as telas abertas (cada componente tem sua instância
    // deste hook), ex.: depois de cancelar a assinatura.
    useEffect(() => {
        if (!user) return;
        const onChanged = () => { void fetchPlan(user.id); };
        window.addEventListener(PLAN_CHANGED_EVENT, onChanged);
        return () => window.removeEventListener(PLAN_CHANGED_EVENT, onChanged);
    }, [user, fetchPlan]);

    const refreshPlan = useCallback(async () => {
        window.dispatchEvent(new Event(PLAN_CHANGED_EVENT));
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
        planExpiresAt,
        refreshPlan,
        signOut,
        signOutEverywhere,
        updateProfile,
        updatePassword,
        deleteAccount
    };
}

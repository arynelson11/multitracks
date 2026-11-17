import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { apiUrl } from '../lib/api';
import { effectivePlan, fetchPlanState } from '../lib/planState';
import { syncBillingOnLogin } from '../lib/subscription';
import { fetchProfileFlags, touchLastSeen } from '../lib/profileFlags';
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
    // Papel de admin e bloqueio, do próprio perfil (profiles.is_admin e blocked_at).
    const [isAdmin, setIsAdmin] = useState(false);
    const [blockedAt, setBlockedAt] = useState<string | null>(null);
    // De quem já foi lido o perfil: num login nesta aba o carregando volta até o papel
    // chegar (senão a guarda do admin mostraria "Acesso negado" por um instante).
    const profileUserRef = useRef<string | null>(null);

    // Plano, papel e bloqueio vêm juntos: o carregando cobre os três.
    const fetchPlan = useCallback(async (userId: string) => {
        const [state, flags] = await Promise.all([fetchPlanState(userId), fetchProfileFlags(userId)]);
        profileUserRef.current = userId;
        if (!state) return; // erro de rede: mantém o que já tinha (plano, papel e bloqueio)
        setRawPlan(state.plan);
        setPlanExpiresAt(state.planExpiresAt);
        setIsAdmin(flags.isAdmin);
        setBlockedAt(flags.blockedAt);
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
                void syncBillingOnLogin(session.user.id);
                touchLastSeen();
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
                // Outra conta (login nesta aba): espera o perfil dela. A mesma conta
                // (renovação do token, volta pra aba) segue com o que já tem.
                if (profileUserRef.current !== session.user.id) setLoading(true);
                touchLastSeen();
                fetchPlan(session.user.id).finally(() => setLoading(false));
            } else {
                profileUserRef.current = null;
                setRawPlan('free');
                setPlanExpiresAt(null);
                setIsAdmin(false);
                setBlockedAt(null);
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

    // Volta pro app (ex.: pagou no navegador pelo app de computador): relê o plano.
    useEffect(() => {
        if (!user) return;
        let last = 0;
        const onFocus = () => {
            if (Date.now() - last < 30_000) return;
            last = Date.now();
            void fetchPlan(user.id);
        };
        window.addEventListener('focus', onFocus);
        return () => window.removeEventListener('focus', onFocus);
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
        isAdmin,
        blockedAt,
        refreshPlan,
        signOut,
        signOutEverywhere,
        updateProfile,
        updatePassword,
        deleteAccount
    };
}

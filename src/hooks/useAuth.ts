import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { apiUrl } from '../lib/api';
import { effectivePlan, fetchPlanState } from '../lib/planState';
import { syncBillingOnLogin } from '../lib/subscription';
import { fetchProfileFlagsWithin, touchLastSeen } from '../lib/profileFlags';
import { clearPlanCache, readPlanCache, savePlanCache } from '../lib/planCache';
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
    // Conta da sessão agora: resposta que chega de outra conta (saiu ou trocou) é descartada.
    const sessionUserRef = useRef<string | null>(null);

    // Plano, papel e bloqueio vêm juntos: o carregando cobre os três. A leitura do papel e do
    // bloqueio tem teto de 4 s (Ruling ADM-T27-teto); a do plano segue como antes, sem teto.
    // A leitura inteira que dá certo fica guardada no aparelho (planCache); é ela que vale
    // quando a conta abre sem internet, até a data de fim do plano ou 30 dias sem conferir.
    const fetchPlan = useCallback(async (userId: string) => {
        const [state, flags] = await Promise.all([fetchPlanState(userId), fetchProfileFlagsWithin(userId)]);
        if (sessionUserRef.current !== userId) return;
        const sameAccount = profileUserRef.current === userId;
        profileUserRef.current = userId;
        if (!state) {
            // Erro de rede: a mesma conta mantém o que já tinha (plano, papel e bloqueio). A conta
            // que ainda não foi lida nesta aba abre com o último plano e papel conhecidos neste
            // aparelho (só os dela; sem eles, Livre e sem admin). Outra conta não herda nada da
            // anterior. Nada é regravado: o prazo de 30 dias conta da última leitura que deu certo.
            if (!sameAccount) {
                const saved = readPlanCache(userId);
                setRawPlan(saved?.plan ?? 'free');
                setPlanExpiresAt(saved?.planExpiresAt ?? null);
                setIsAdmin(saved?.isAdmin ?? false);
                setBlockedAt(null);
            }
            return;
        }
        setRawPlan(state.plan);
        setPlanExpiresAt(state.planExpiresAt);
        if (!flags) {
            // A leitura do papel estourou o teto: no carregamento de uma conta vale o papel
            // guardado neste aparelho pra ela (sem ele, não admin), não bloqueado, e o app abre;
            // a mesma conta (releitura) mantém o que já tinha. A resposta atrasada é descartada:
            // nada reabre sozinho, só a próxima leitura. Sem o papel lido, nada é regravado.
            if (!sameAccount) {
                setIsAdmin(readPlanCache(userId)?.isAdmin ?? false);
                setBlockedAt(null);
            }
            return;
        }
        setIsAdmin(flags.isAdmin);
        setBlockedAt(flags.blockedAt);
        // Conta bloqueada não fica com plano guardado (sem internet ela abriria com ele).
        if (flags.blockedAt) clearPlanCache();
        else savePlanCache(userId, { ...state, isAdmin: flags.isAdmin });
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
            sessionUserRef.current = session?.user?.id ?? null;
            if (session?.user) {
                void syncBillingOnLogin(session.user.id);
                touchLastSeen(session.user.id);
                fetchPlan(session.user.id).finally(() => setLoading(false));
            } else {
                setLoading(false);
            }
        });

        // Listen for changes on auth state (login, logout, etc)
        const { data: { subscription } } = supabase!.auth.onAuthStateChange((event, session) => {
            setSession(session);
            setUser(session?.user ?? null);
            sessionUserRef.current = session?.user?.id ?? null;
            if (session?.user) {
                // Outra conta (login nesta aba): espera o perfil dela. A mesma conta
                // (renovação do token, volta pra aba) segue com o que já tem.
                if (profileUserRef.current !== session.user.id) setLoading(true);
                touchLastSeen(session.user.id);
                fetchPlan(session.user.id).finally(() => setLoading(false));
            } else {
                // Sair da conta apaga o plano guardado no aparelho. Abrir sem sessão não apaga: sem
                // internet e com o login vencido, o supabase-js abre sem sessão e a volta da rede
                // traz a mesma conta de novo (o plano guardado é só dela, de qualquer forma).
                if (event === 'SIGNED_OUT') clearPlanCache();
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

// Fonte única de "quais planos são pagos" no backend + lookup do plano do usuário.
// Mantém em sincronia com src/lib/plans.ts (planTier) e com as chaves de
// PLAN_PRICING em api/_lib/pricing.ts.

import { brtToday } from './billing.js';

// Separações por mês civil de Brasília. Ajuste aqui se mudar a estratégia comercial.
export const PLAN_LIMITS: Record<string, number> = {
    free:              5,
    essencial_mensal:  50,
    essencial_anual:   50,
    pro_mensal:        150,
    pro_anual:         150,
};

export const PAID_PLANS = new Set(['essencial_mensal', 'essencial_anual', 'pro_mensal', 'pro_anual']);

export function isPaidPlan(plan: string | null | undefined): boolean {
    return !!plan && PAID_PLANS.has(plan);
}

// Plano que vale agora: depois de cancelado, o plano segue até plan_expires_at
// e daí em diante conta como Livre (mesmo antes de alguém gravar 'free').
export function effectivePlan(plan: string | null | undefined, expiresAt: string | null | undefined, now: Date = new Date()): string {
    if (!plan) return 'free';
    if (expiresAt && Date.parse(expiresAt) <= now.getTime()) return 'free';
    return plan;
}

type ProfileRow = { plan?: string | null; plan_expires_at?: string | null } | null;
type DbError = { message: string; code?: string } | null;

function isMissingColumn(e: DbError): boolean {
    return !!e && (e.code === '42703' || /plan_expires_at/.test(e.message));
}

// Lê o plano efetivo usando um client já criado (service_role). Lança em erro de DB.
// Se db/supabase_assinaturas.sql ainda não rodou (coluna plan_expires_at não
// existe), lê só o plano, pra não derrubar a separação de todo mundo.
export async function getUserPlan(supabase: any, userId: string): Promise<string> { // eslint-disable-line @typescript-eslint/no-explicit-any
    let res: { data: ProfileRow; error: DbError } = await supabase
        .from('profiles')
        .select('plan, plan_expires_at')
        .eq('id', userId)
        .maybeSingle();
    if (isMissingColumn(res.error)) {
        res = await supabase.from('profiles').select('plan').eq('id', userId).maybeSingle();
    }
    if (res.error) throw new Error(res.error.message);
    return effectivePlan(res.data?.plan ?? 'free', res.data?.plan_expires_at ?? null);
}

// ── Cota extra do mês (admin "Somar N", D11) ──

// "AAAA-MM" do mês de Brasília (23:30 de 30/11 em Brasília já é 01/12 em UTC).
export function brtMonth(at: Date | string): string {
    return brtToday(new Date(at)).slice(0, 7);
}

type QuotaBonusRow = { quota_bonus?: number | null; quota_bonus_period?: string | null } | null;

// O extra só vale no mês de Brasília em que o admin deu (quota_bonus_period);
// no dia 1º some sozinho, sem ninguém zerar a coluna.
export function quotaBonusFor(row: QuotaBonusRow, now: Date): number {
    const bonus = Number(row?.quota_bonus ?? 0);
    const period = row?.quota_bonus_period;
    if (!Number.isFinite(bonus) || bonus <= 0 || !period || Number.isNaN(Date.parse(period))) return 0;
    return brtMonth(period) === brtMonth(now) ? Math.trunc(bonus) : 0;
}

function isMissingBonusColumn(e: DbError): boolean {
    return !!e && (e.code === '42703' || /quota_bonus/.test(e.message));
}

// Lê a cota extra do mês com um client já criado (service_role). Lança em erro
// de DB, como getUserPlan. Se db/supabase_admin_papel.sql ainda não rodou
// (colunas ausentes), não há extra: dá 0.
export async function getQuotaBonus(supabase: any, userId: string, now: Date = new Date()): Promise<number> { // eslint-disable-line @typescript-eslint/no-explicit-any
    const res: { data: QuotaBonusRow; error: DbError } = await supabase
        .from('profiles')
        .select('quota_bonus, quota_bonus_period')
        .eq('id', userId)
        .maybeSingle();
    if (isMissingBonusColumn(res.error)) return 0;
    if (res.error) throw new Error(res.error.message);
    return quotaBonusFor(res.data, now);
}

// Fonte única de "quais planos são pagos" no backend + lookup do plano do usuário.
// Mantém em sincronia com src/lib/plans.ts (planTier) e com as chaves de
// PLAN_PRICING em api/_lib/pricing.ts.

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

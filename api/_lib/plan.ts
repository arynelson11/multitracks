// Fonte única de "quais planos são pagos" no backend + lookup do plano do usuário.
// Mantém em sincronia com src/lib/plans.ts (planTier) e com as chaves de
// PLAN_PRICING em api/checkout.ts / VALID_PLANS em api/webhook/asaas.ts.

export const PAID_PLANS = new Set(['essencial_mensal', 'essencial_anual', 'pro_mensal', 'pro_anual']);

export function isPaidPlan(plan: string | null | undefined): boolean {
    return !!plan && PAID_PLANS.has(plan);
}

// Lê profiles.plan usando um client já criado (service_role). Lança em erro de DB.
export async function getUserPlan(supabase: any, userId: string): Promise<string> {
    const { data, error } = await supabase
        .from('profiles')
        .select('plan')
        .eq('id', userId)
        .maybeSingle();
    if (error) throw new Error(error.message);
    return data?.plan ?? 'free';
}

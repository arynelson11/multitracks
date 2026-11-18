import { supabase } from './supabase'

// Plano do usuário como o app deve tratar agora. Depois de cancelada, a
// assinatura vale até profiles.plan_expires_at e daí em diante é Livre (mesma
// regra do servidor em api/_lib/plan.ts).

export type PlanState = { plan: string; planExpiresAt: string | null }

export function effectivePlan(plan: string | null | undefined, expiresAt: string | null | undefined, now: Date = new Date()): string {
  if (!plan) return 'free'
  if (expiresAt && Date.parse(expiresAt) <= now.getTime()) return 'free'
  return plan
}

type Row = { plan?: string | null; plan_expires_at?: string | null } | null
type Err = { message: string; code?: string } | null

export async function fetchPlanState(userId: string): Promise<PlanState | null> {
  if (!supabase) return null
  try {
    let res: { data: Row; error: Err } = await supabase.from('profiles').select('plan, plan_expires_at').eq('id', userId).maybeSingle()
    // db/supabase_assinaturas.sql ainda não rodou: lê só o plano
    if (res.error && (res.error.code === '42703' || /plan_expires_at/.test(res.error.message))) {
      res = await supabase.from('profiles').select('plan').eq('id', userId).maybeSingle()
    }
    if (res.error) return null
    return { plan: res.data?.plan || 'free', planExpiresAt: res.data?.plan_expires_at ?? null }
  } catch {
    return null
  }
}

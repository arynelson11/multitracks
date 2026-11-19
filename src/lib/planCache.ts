import type { PlanState } from './planState'

// Último plano conhecido da conta, guardado no aparelho (spec 5, "Plano guardado no aparelho";
// Ruling R2: vai junto o papel de admin da mesma conta). Serve só pra quem paga (ou o admin)
// não cair no Livre sem internet, sobretudo no app de computador no culto. Libera apenas o uso
// no próprio aparelho: tudo que custa dinheiro (separação, checkout) o servidor decide pelo banco.
//
// Vale só pra mesma conta (o id do usuário) e até 30 dias sem conferir; a data de fim do plano
// vem junto e o useAuth passa tudo pelo effectivePlan, então o que vier antes vence. O
// armazenamento pode faltar ou lançar (aba privada, cota cheia): aí não há plano guardado e
// nada quebra. Funciona igual no navegador e no app de computador (file://).

export type CachedPlan = PlanState & { isAdmin: boolean }

export const PLAN_CACHE_KEY = 'ps-plano-guardado'
export const PLAN_CACHE_MAX_AGE_MS = 30 * 86_400_000

type Saved = { userId: string; plan: string; planExpiresAt: string | null; isAdmin: boolean; checkedAt: string }

export function savePlanCache(userId: string, state: CachedPlan, now: Date = new Date()): void {
  const saved: Saved = {
    userId,
    plan: state.plan,
    planExpiresAt: state.planExpiresAt,
    isAdmin: state.isAdmin === true,
    checkedAt: now.toISOString(),
  }
  try {
    localStorage.setItem(PLAN_CACHE_KEY, JSON.stringify(saved))
  } catch {
    // sem armazenamento: fica sem plano guardado
  }
}

export function readPlanCache(userId: string, now: Date = new Date()): CachedPlan | null {
  let raw: string | null
  try {
    raw = localStorage.getItem(PLAN_CACHE_KEY)
  } catch {
    return null
  }
  if (!raw) return null
  let saved: unknown
  try {
    saved = JSON.parse(raw)
  } catch {
    return null
  }
  if (!isSaved(saved) || saved.userId !== userId) return null
  const checkedAt = Date.parse(saved.checkedAt)
  if (Number.isNaN(checkedAt) || now.getTime() - checkedAt > PLAN_CACHE_MAX_AGE_MS) return null
  return { plan: saved.plan, planExpiresAt: saved.planExpiresAt, isAdmin: saved.isAdmin }
}

export function clearPlanCache(): void {
  try {
    localStorage.removeItem(PLAN_CACHE_KEY)
  } catch {
    // sem armazenamento: não há o que apagar
  }
}

function isSaved(v: unknown): v is Saved {
  if (!v || typeof v !== 'object') return false
  const s = v as Record<string, unknown>
  return typeof s.userId === 'string'
    && typeof s.plan === 'string' && s.plan !== ''
    && (s.planExpiresAt === null || typeof s.planExpiresAt === 'string')
    && typeof s.isAdmin === 'boolean'
    && typeof s.checkedAt === 'string'
}

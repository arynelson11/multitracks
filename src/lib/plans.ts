/**
 * Plan display name mapping.
 *
 * Internal IDs (stored in DB via `profiles.plan` column, returned by the
 * AbacatePay webhook, and used as keys in LIMITS objects) are kept as the
 * legacy product names — changing them would require renaming AbacatePay
 * products and migrating existing rows in `profiles`.
 *
 * This helper translates the internal ID to the user-facing name that
 * matches the current brand naming (Livre / Pro / Studio).
 *
 * If you add a new tier, also:
 *   1. add it to LIMITS in SeparatorStudio.tsx + SettingsModal.tsx
 *   2. add a product entry in PricingModal.tsx
 *   3. configure the corresponding product in AbacatePay dashboard
 */

const PLAN_DISPLAY_NAMES: Record<string, string> = {
  free: 'Livre',
  gratuito: 'Livre',
  essencial_mensal: 'Pro Mensal',
  essencial_anual: 'Pro Anual',
  pro_mensal: 'Studio Mensal',
  pro_anual: 'Studio Anual',
}

export function planDisplayName(internalId: string | null | undefined): string {
  if (!internalId) return 'Livre'
  return PLAN_DISPLAY_NAMES[internalId.toLowerCase()] ?? 'Livre'
}

export function isPaidPlan(internalId: string | null | undefined): boolean {
  if (!internalId) return false
  const id = internalId.toLowerCase()
  return id !== 'free' && id !== 'gratuito'
}

/**
 * Nível do plano, independente do ciclo de cobrança (mensal/anual).
 * O gating por feature usa o tier, não o ID bruto — assim Pro e Studio podem
 * ter regras diferentes (o `isPaidPlan` só distingue grátis de pago).
 */
export type PlanTier = 'free' | 'pro' | 'studio'

const PLAN_TIERS: Record<string, PlanTier> = {
  free: 'free',
  gratuito: 'free',
  essencial_mensal: 'pro',
  essencial_anual: 'pro',
  pro_mensal: 'studio',
  pro_anual: 'studio',
}

export function planTier(internalId: string | null | undefined): PlanTier {
  if (!internalId) return 'free'
  return PLAN_TIERS[internalId.toLowerCase()] ?? 'free'
}

// ── Regras de feature por plano (fonte única) ──

// Loop de seção: grátis repete um número limitado de vezes; pago libera o
// infinito (uso de ministração ao vivo).
export const FREE_MAX_LOOP_REPEATS = 4
export function canUseInfiniteLoop(id: string | null | undefined): boolean {
  return planTier(id) !== 'free'
}

// Modo Ao Vivo (banda conecta o celular): exclusivo dos planos pagos.
export function canUseLiveMode(id: string | null | undefined): boolean {
  return planTier(id) !== 'free'
}

// Quantos aparelhos da banda podem conectar na sessão ao vivo.
export function maxLiveDevices(id: string | null | undefined): number {
  const t = planTier(id)
  if (t === 'studio') return Infinity
  if (t === 'pro') return 4
  return 0
}

// Controle de loop/seções pela banda (pelo celular) é exclusivo do Studio.
export function canBandControlSections(id: string | null | undefined): boolean {
  return planTier(id) === 'studio'
}

// Baixar a faixa separada pro computador (WAV/MP3) é exclusivo do pago.
export function canDownloadStems(id: string | null | undefined): boolean {
  return planTier(id) !== 'free'
}

// BPM detectado pela IA: recurso de preparo, exclusivo do pago.
export function canUseBpmDetection(id: string | null | undefined): boolean {
  return planTier(id) !== 'free'
}

// Voz guia (manual e automática): exclusivo do pago.
export function canUseVoiceGuide(id: string | null | undefined): boolean {
  return planTier(id) !== 'free'
}

// Marcar seções e usar loop ao vivo: exclusivo do pago.
export function canUseSections(id: string | null | undefined): boolean {
  return planTier(id) !== 'free'
}

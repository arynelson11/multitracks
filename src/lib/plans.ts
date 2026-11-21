/**
 * Plan display name mapping.
 *
 * Internal IDs (stored in DB via `profiles.plan` column, resolved by the
 * payment webhook, and used as keys in LIMITS objects) are kept as the
 * legacy product names. Changing them would require migrating existing rows
 * in `profiles` and the plan keys in api/checkout.ts + api/webhook/asaas.ts.
 *
 * This helper translates the internal ID to the user-facing name that
 * matches the current brand naming (Livre / Pro / Studio).
 *
 * If you add a new tier, also:
 *   1. add it to LIMITS in SeparatorStudio.tsx + SettingsModal.tsx
 *   2. add a card in src/components/pricing/pricingCatalog.ts (its price comes from PRICES in
 *      src/content/site.ts; pricingCatalog.test.ts checks every card against PLAN_PRICING)
 *   3. add its price/cycle to PLAN_PRICING in api/_lib/pricing.ts (used by api/checkout.ts)
 *   4. add its key to VALID_PLANS in api/webhook/asaas.ts
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
 * O gating por feature usa o tier, não o ID bruto: assim Pro e Studio podem
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
// Uma função por recurso, dizendo quais níveis têm ele. Parte 3 (Livre como amostra, spec
// seção 5, não publicado): o que roda no aparelho e não custa nada abre pro Livre; o que usa
// a nuvem ou gera arquivo pra levar embora continua pago. Quem paga não perde nada.

type PlanId = string | null | undefined

const ALL_TIERS: readonly PlanTier[] = ['free', 'pro', 'studio']
const PAID_TIERS: readonly PlanTier[] = ['pro', 'studio']
const STUDIO_TIER: readonly PlanTier[] = ['studio']

function allows(tiers: readonly PlanTier[], id: PlanId): boolean {
  return tiers.includes(planTier(id))
}

// Modo Ao Vivo (banda conecta o celular): todos. O Livre entra com 1 celular e um teto de
// tempo por dia (`maxLiveDevices`, `liveDailyLimitMs`).
export function canUseLiveMode(id: PlanId): boolean {
  return allows(ALL_TIERS, id)
}

// Quantos aparelhos da banda podem conectar na sessão ao vivo.
export function maxLiveDevices(id: PlanId): number {
  const t = planTier(id)
  if (t === 'studio') return Infinity
  if (t === 'pro') return 4
  return 1
}

// Teto do Ao Vivo por dia de Brasília, em ms: 10 minutos no Livre; nulo = sem teto (pagos).
export function liveDailyLimitMs(id: PlanId): number | null {
  return planTier(id) === 'free' ? 600_000 : null
}

// Controle de loop/seções pela banda (pelo celular) é exclusivo do Studio.
export function canBandControlSections(id: PlanId): boolean {
  return allows(STUDIO_TIER, id)
}

// Cota de separações de faixas por mês conforme o tier. Usa planTier pra valer
// tanto pro ciclo mensal quanto anual (os IDs crus divergem; o tier não).
// O servidor tem a mesma tabela (`PLAN_LIMITS` em api/_lib/plan.ts) e é quem barra.
export function maxSeparationsPerMonth(id: PlanId): number {
  const t = planTier(id)
  if (t === 'studio') return 150
  if (t === 'pro') return 50
  return 3
}

// Em quantas faixas dá pra separar. O servidor aceita 2, 4 e 6 de qualquer plano (o app de
// computador antigo ainda pede 2 no Livre); o app oferece ao Livre só 4 e 6, o resultado completo.
export type StemCount = 2 | 4 | 6
export const ALL_STEM_COUNTS: readonly StemCount[] = [2, 4, 6]
const FREE_STEM_COUNTS: readonly StemCount[] = [4, 6]

export function separationStemOptions(id: PlanId): readonly StemCount[] {
  return planTier(id) === 'free' ? FREE_STEM_COUNTS : ALL_STEM_COUNTS
}

// Baixar a faixa separada pro computador (WAV/MP3) é exclusivo do pago.
export function canDownloadStems(id: PlanId): boolean {
  return allows(PAID_TIERS, id)
}

// BPM detectado pela IA (no Separador): todos, roda no aparelho.
export function canUseBpmDetection(id: PlanId): boolean {
  return allows(ALL_TIERS, id)
}

// Voz guia (manual e automática): todos, roda no aparelho.
export function canUseVoiceGuide(id: PlanId): boolean {
  return allows(ALL_TIERS, id)
}

// Marcar seções, repetir e o loop infinito ao vivo: todos.
export function canUseSections(id: PlanId): boolean {
  return allows(ALL_TIERS, id)
}

// Click gerado pro que falta na música (o `autoClick` do motor): todos, roda no aparelho.
export function canUseGeneratedClick(id: PlanId): boolean {
  return allows(ALL_TIERS, id)
}

// Trocar o tom e definir o tom original: todos.
export function canChangeKey(id: PlanId): boolean {
  return allows(ALL_TIERS, id)
}

// Catálogo da plataforma (BIBLIOTECA): todos. No Livre, cada música conta nas do mês no palco.
export function canUsePlatformCatalog(id: PlanId): boolean {
  return allows(ALL_TIERS, id)
}

// Conjuntos de pads da nuvem (os pads do aparelho são de todos): exclusivo do pago.
export function canUseCloudPads(id: PlanId): boolean {
  return allows(PAID_TIERS, id)
}

// Repertório com várias músicas: próxima, anterior e AUTO entre músicas e Salvar e Carregar
// o .zip. Exclusivo do pago.
export function canUseRepertoire(id: PlanId): boolean {
  return allows(PAID_TIERS, id)
}

// Músicas diferentes por mês no palco: 3 no Livre, sem limite nos pagos.
export function maxStageSongsPerMonth(id: PlanId): number {
  return planTier(id) === 'free' ? 3 : Infinity
}

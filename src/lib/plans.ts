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

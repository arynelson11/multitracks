// ── Tabela de preços (fonte única) ──
// O valor da assinatura é definido aqui, no backend, e enviado pro Asaas via
// API. Assim o preço não depende de produto configurado em painel (era a dor
// do AbacatePay). As chaves são os nomes internos usados em profiles.plan.
// Anual: `value` é o total cobrado uma vez por ano (ciclo YEARLY).
// Usada por api/checkout.ts (cobrança), pelo webhook (registro do pagamento)
// e pela troca de plano (api/_lib/billing.ts).

export type PlanKey = 'essencial_mensal' | 'essencial_anual' | 'pro_mensal' | 'pro_anual'
export type BillingCycle = 'MONTHLY' | 'YEARLY'

export const PLAN_PRICING: Record<PlanKey, { value: number; cycle: BillingCycle; description: string; label: string }> = {
  essencial_mensal: { value: 49.90, cycle: 'MONTHLY', description: 'Playback Studio Pro (mensal)', label: 'Pro Mensal' },
  essencial_anual:  { value: 454.80, cycle: 'YEARLY',  description: 'Playback Studio Pro (anual)', label: 'Pro Anual' },
  pro_mensal:       { value: 119.90, cycle: 'MONTHLY', description: 'Playback Studio Studio (mensal)', label: 'Studio Mensal' },
  pro_anual:        { value: 1078.80, cycle: 'YEARLY', description: 'Playback Studio Studio (anual)', label: 'Studio Anual' },
}

export function isPlanKey(v: unknown): v is PlanKey {
  return typeof v === 'string' && Object.prototype.hasOwnProperty.call(PLAN_PRICING, v)
}

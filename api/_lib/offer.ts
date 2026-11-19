import type { SupabaseClient } from '@supabase/supabase-js'
import { accountSubscriptionCount } from './billing.js'
import { PLAN_PRICING } from './pricing.js'

// Oferta do primeiro mês e eventos de anúncio (Parte 3, D7 e D8). O registro da oferta, a
// janela de 48 horas e os eventos moram no SQL (db/supabase_oferta.sql e
// db/supabase_eventos.sql), escritos só pelo servidor; aqui ficam os preços, as listas
// aceitas e as duas leituras que o api/checkout.ts usa (?action=offer, ?action=track e o
// checkout com offer: true).

// A janela vale 48 horas a partir da primeira vez que a oferta aparece no mês (a conta é
// do SQL, offer_open_window; o número fica aqui pra quem lê o código e pros testes).
export const OFFER_WINDOW_HOURS = 48

// Valor do primeiro mês, só nos planos mensais (anual sem oferta). `essencial_mensal` é o
// Pro Mensal (cheio R$ 49,90) e `pro_mensal` é o Studio Mensal (cheio R$ 119,90); o preço
// cheio segue em api/_lib/pricing.ts.
export const OFFER_PRICING = { essencial_mensal: 24.9, pro_mensal: 59.9 } as const
export type OfferPlanKey = keyof typeof OFFER_PRICING

export function isOfferPlan(k: unknown): k is OfferPlanKey {
  return typeof k === 'string' && Object.hasOwn(OFFER_PRICING, k)
}

// 'R$ 24,90' (vírgula nos centavos, como o formatReais do app). Só valores de plano mensal,
// todos abaixo de mil.
function reais(v: number): string {
  return `R$ ${v.toFixed(2).replace('.', ',')}`
}

// O item do checkout do Asaas com a oferta: a página de pagamento é a última tela antes do
// cartão e precisa dizer o preço de depois do primeiro mês. Tudo sai de OFFER_PRICING e
// PLAN_PRICING. Depois do primeiro pagamento, a troca pro preço cheio devolve a descrição
// normal à assinatura.
export function offerCheckoutItem(planKey: OfferPlanKey): { name: string; description: string; value: number } {
  const plan = PLAN_PRICING[planKey]
  const value = OFFER_PRICING[planKey]
  return {
    name: `${plan.description}, 1º mês ${reais(value)}`,
    description: `Primeiro mês por ${reais(value)}. A partir do segundo mês, ${reais(plan.value)} por mês. Cancele quando quiser.`,
    value,
  }
}

// Os limites que abrem a janela. A mesma lista vive no app (LIMIT_KINDS em
// src/lib/livreRules.ts) e no CHECK de first_month_offers.trigger_kind: mudar aqui é mudar
// lá (o teste de paridade em api/__tests__/offer.test.ts confere as três).
export const OFFER_TRIGGERS = ['separations', 'stage-songs', 'live', 'repertoire', 'download'] as const
export type OfferTrigger = (typeof OFFER_TRIGGERS)[number]

// Eventos de anúncio que o app grava por ?action=track, e os lugares (AdPlacement no app e
// o CHECK de product_events.placement, mesma lista).
export const AD_KINDS = ['ad_shown', 'ad_clicked'] as const
export const AD_PLACEMENTS = ['home', 'separation-done', 'limit', 'badge'] as const

function isOneOf<T extends string>(list: readonly T[], v: unknown): v is T {
  return typeof v === 'string' && (list as readonly string[]).includes(v)
}
export const isOfferTrigger = (v: unknown): v is OfferTrigger => isOneOf(OFFER_TRIGGERS, v)
export const isAdKind = (v: unknown): v is (typeof AD_KINDS)[number] => isOneOf(AD_KINDS, v)
export const isAdPlacement = (v: unknown): v is (typeof AD_PLACEMENTS)[number] => isOneOf(AD_PLACEMENTS, v)

// 'ineligible': a conta já teve assinatura (a oferta é só da primeira). Os outros vêm do
// registro: 'active' com o relógio e o mês da janela, 'expired' (a janela do mês passou),
// 'used' (a conta já usou) e 'none' (nenhuma janela no mês).
export type OfferStatus = 'active' | 'expired' | 'used' | 'none' | 'ineligible'
export type OfferAnswer = { status: OfferStatus; expiresAt: string | null; month: string | null }

const MONTH_RE = /^\d{4}-\d{2}$/

// A resposta de offer_current e offer_open_window ({ status, expiresAt, month }). Fora do
// formato lança: quem chama trata como erro (sem oferta), nunca como janela aberta.
function parseAnswer(data: unknown): OfferAnswer {
  const d = (data ?? {}) as Record<string, unknown>
  if (d.status === 'active') {
    if (typeof d.expiresAt === 'string' && Number.isFinite(Date.parse(d.expiresAt)) && typeof d.month === 'string' && MONTH_RE.test(d.month)) {
      return { status: 'active', expiresAt: d.expiresAt, month: d.month }
    }
  } else if (d.status === 'expired' || d.status === 'used' || d.status === 'none') {
    return { status: d.status, expiresAt: null, month: typeof d.month === 'string' ? d.month : null }
  }
  throw new Error('resposta da oferta fora do formato')
}

// Estado da oferta da conta. Conta que já teve assinatura (accountSubscriptionCount > 0):
// 'ineligible' sem chamar o registro (nada é gravado). Senão, o registro (readOfferWindow).
// Erro de banco ou resposta estranha lança: quem chama decide (sem oferta).
export async function readOffer(
  db: SupabaseClient,
  userId: string,
  o: { open: boolean; trigger?: string; now: Date },
): Promise<OfferAnswer> {
  if ((await accountSubscriptionCount(db, userId)) > 0) return { status: 'ineligible', expiresAt: null, month: null }
  return readOfferWindow(db, userId, o)
}

// Só o registro da oferta, pra quem já conferiu que a conta nunca assinou (o checkout lê a
// contagem uma vez e trata o erro dela à parte). Com `open` abre a janela do mês se ainda não
// houver (o app só pede isso na tela de limite, com o limite em `trigger`); sem `open` só lê.
export async function readOfferWindow(
  db: SupabaseClient,
  userId: string,
  o: { open: boolean; trigger?: string; now: Date },
): Promise<OfferAnswer> {
  const p_now = o.now.toISOString()
  let out: { data: unknown; error: { message: string } | null }
  if (o.open) {
    if (!isOfferTrigger(o.trigger)) throw new Error('limite fora da lista da oferta')
    out = await db.rpc('offer_open_window', { p_user_id: userId, p_trigger: o.trigger, p_now })
  } else {
    out = await db.rpc('offer_current', { p_user_id: userId, p_now })
  }
  if (out.error) throw new Error(`registro da oferta: ${out.error.message}`)
  return parseAnswer(out.data)
}

// Grava um anúncio visto ou clicado da conta (um por conta, lugar e dia de Brasília, pelo
// SQL). Devolve se gravou: false quando já tinha no dia ou quando o banco falhou (o app
// segue igual; o evento só serve pro funil do admin).
export async function recordAdEvent(
  db: SupabaseClient,
  userId: string,
  kind: string,
  placement: string,
  now: Date,
): Promise<boolean> {
  const { data, error } = await db.rpc('record_product_event', {
    p_user_id: userId, p_kind: kind, p_placement: placement, p_detail: null, p_now: now.toISOString(),
  })
  if (error) {
    console.warn('[offer] evento de anuncio nao gravado:', String(error.message ?? '').slice(0, 200))
    return false
  }
  return data === true
}

import type { SupabaseClient } from '@supabase/supabase-js'
import {
  AsaasError,
  deleteSubscription,
  ensureDueDateNotifications,
  findSubscriptionIdByCheckout,
  getSubscription,
  listSubscriptionPayments,
  refundPayment,
  type AsaasApi,
  type AsaasPayment,
} from './asaas.js'
import { PLAN_PRICING, isPlanKey, type BillingCycle, type PlanKey } from './pricing.js'

// Regras de cobrança do Playback Studio (decididas pelo dono em 2026-11-16).
// O estado mora no banco (db/supabase_assinaturas.sql); aqui ficam a ordem das
// chamadas ao Asaas e ao Supabase e o tratamento de cada evento do webhook.
//
// * Cancelar pelo botão: plano até o fim do período pago, depois Livre.
// * Arrependimento em até 7 dias da primeira compra: estorno e Livre na hora.
// * Renovação vencida sem pagamento: Livre no mesmo dia e assinatura
//   cancelada no Asaas. Pagamento atrasado que chegar mesmo assim devolve o
//   plano até o fim daquele período e marca o caso pro admin.
// * Estorno do período atual: Livre na hora e assinatura cancelada no Asaas.
// * Compra de um plano novo encerra a assinatura anterior (sem cobrar duas).
//
// Funções exportadas pra reuso pelo admin: activateFromCheckout,
// cancelSubscriptionForUser, changePlan, grantCourtesy, endCourtesy.

export type BillingDeps = {
  db: SupabaseClient
  asaas: AsaasApi | null
  now?: () => Date
}

export type BillingErrorCode = 'asaas_unavailable' | 'asaas_rejected' | 'not_found' | 'db_error' | 'misconfigured' | 'partial'

// Erro com mensagem pronta pra mostrar ao usuário (português, sem detalhe técnico).
export class BillingError extends Error {
  readonly code: BillingErrorCode
  readonly httpStatus: number
  constructor(code: BillingErrorCode, message: string, httpStatus: number) {
    super(message)
    this.name = 'BillingError'
    this.code = code
    this.httpStatus = httpStatus
  }
}

const MSG_ASAAS_DOWN_NOTHING_CHANGED =
  'Não conseguimos falar com o sistema de pagamento agora. Sua assinatura não foi cancelada e nada mudou. Tente de novo em alguns minutos.'

// ── Datas (o Asaas trabalha com datas de Brasília, UTC-3 sem horário de verão) ──

const BRT_OFFSET_MS = 3 * 3600_000
const DATE_RE = /^(\d{4}-\d{2}-\d{2})(?:[ T](\d{2}:\d{2}(?::\d{2})?)(?:\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?$/

// "2026-11-16", "2026-11-16 15:02:38" ou "2026-11-16T03:00:00+0000" → "2026-11-16" em Brasília.
export function toBrtDate(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const m = DATE_RE.exec(v.trim())
  if (!m) return null
  if (!m[3]) return m[1]
  const zone = m[3] === 'Z' ? 'Z' : m[3].replace(/^([+-]\d{2}):?(\d{2})$/, '$1:$2')
  const t = Date.parse(`${m[1]}T${m[2] ?? '00:00:00'}${zone}`)
  if (Number.isNaN(t)) return null
  return new Date(t - BRT_OFFSET_MS).toISOString().slice(0, 10)
}

export function brtToday(now: Date): string {
  return new Date(now.getTime() - BRT_OFFSET_MS).toISOString().slice(0, 10)
}

export function addDays(date: string, days: number): string {
  const t = Date.parse(`${date}T00:00:00Z`) + days * 86400_000
  return new Date(t).toISOString().slice(0, 10)
}

// ── Cobranças ──

export const PAID_STATUSES = new Set(['CONFIRMED', 'RECEIVED', 'RECEIVED_IN_CASH'])
const REFUNDED_STATUSES = new Set(['REFUNDED', 'REFUND_REQUESTED', 'REFUND_IN_PROGRESS'])
export const WITHDRAWAL_DAYS = 7

// Vencimento da última cobrança paga (define até quando o plano vale).
export function latestPaidDueDate(payments: AsaasPayment[]): string | null {
  let best: string | null = null
  for (const p of payments) {
    if (p.deleted || !PAID_STATUSES.has(p.status ?? '')) continue
    const d = toBrtDate(p.dueDate)
    if (d && (!best || d > best)) best = d
  }
  return best
}

// Arrependimento: vale só pra primeira compra (nenhuma renovação ainda) e até
// 7 dias corridos depois do pagamento, no horário de Brasília.
export function withdrawalStatus(payments: AsaasPayment[], now: Date): { payment: AsaasPayment; alreadyRefunded: boolean } | null {
  const relevant = payments.filter((p) => !p.deleted && (PAID_STATUSES.has(p.status ?? '') || REFUNDED_STATUSES.has(p.status ?? '')))
  if (relevant.length !== 1) return null
  const p = relevant[0]
  const bought = toBrtDate(p.confirmedDate ?? p.paymentDate ?? p.clientPaymentDate ?? p.dateCreated ?? p.dueDate)
  if (!bought || brtToday(now) > addDays(bought, WITHDRAWAL_DAYS)) return null
  return { payment: p, alreadyRefunded: REFUNDED_STATUSES.has(p.status ?? '') }
}

// ── Banco ──

type SubRow = {
  id: string
  kind: 'asaas' | 'courtesy'
  user_id: string
  plan_key: string
  cycle: BillingCycle | null
  asaas_subscription_id: string | null
  asaas_customer_id: string | null
  status: 'active' | 'canceled'
  paid_until: string | null
  access_until: string | null
  cancel_source: string | null
  asaas_deleted_at: string | null
  created_at: string
}
const SUB_COLS = 'id, kind, user_id, plan_key, cycle, asaas_subscription_id, asaas_customer_id, status, paid_until, access_until, cancel_source, asaas_deleted_at, created_at'

type EndResult = { result: string; access_until?: string | null; needs_asaas_delete?: boolean; subscription_id?: string | null }

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null
}
function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}
function obj(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
}

async function rpc<T>(db: SupabaseClient, name: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await db.rpc(name, args)
  if (error) throw new BillingError('db_error', `Falha no banco (${name}): ${error.message}`, 500)
  return data as T
}

async function getSubBy(db: SupabaseClient, col: 'id' | 'asaas_subscription_id', value: string): Promise<SubRow | null> {
  const { data, error } = await db.from('billing_subscriptions').select(SUB_COLS).eq(col, value).maybeSingle()
  if (error) throw new BillingError('db_error', `Falha no banco (billing_subscriptions): ${error.message}`, 500)
  return (data as SubRow | null) ?? null
}

async function activeRowsForUser(db: SupabaseClient, userId: string): Promise<SubRow[]> {
  const { data, error } = await db.from('billing_subscriptions').select(SUB_COLS)
    .eq('user_id', userId).eq('status', 'active').eq('kind', 'asaas')
  if (error) throw new BillingError('db_error', `Falha no banco (billing_subscriptions): ${error.message}`, 500)
  return ((data as SubRow[] | null) ?? []).sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
}

// Dono de um checkout: o vínculo gravado pelo api/checkout.ts e, pra quem
// assinou antes desta versão (vínculo já apagado), a tabela payments.
async function checkoutOwner(db: SupabaseClient, checkoutId: string): Promise<{ userId: string; planKey: PlanKey } | null> {
  const pending = await db.from('pending_checkouts').select('user_id, plan_key').eq('id', checkoutId).maybeSingle()
  if (pending.error) throw new BillingError('db_error', `Falha no banco (pending_checkouts): ${pending.error.message}`, 500)
  const p = pending.data as { user_id?: unknown; plan_key?: unknown } | null
  if (p && typeof p.user_id === 'string' && UUID_RE.test(p.user_id) && isPlanKey(p.plan_key)) {
    return { userId: p.user_id, planKey: p.plan_key }
  }
  const paid = await db.from('payments').select('user_id, plan_key').eq('asaas_checkout_id', checkoutId).maybeSingle()
  if (paid.error) throw new BillingError('db_error', `Falha no banco (payments): ${paid.error.message}`, 500)
  const q = paid.data as { user_id?: unknown; plan_key?: unknown } | null
  if (q && typeof q.user_id === 'string' && UUID_RE.test(q.user_id) && isPlanKey(q.plan_key)) {
    return { userId: q.user_id, planKey: q.plan_key }
  }
  return null
}

// Acha (ou cria) a linha da assinatura a partir do que o evento traz.
export async function resolveSubscription(
  deps: BillingDeps,
  ref: { subscriptionId?: string | null; checkoutId?: string | null; customerId?: string | null },
): Promise<SubRow | null> {
  const { db } = deps
  if (ref.subscriptionId) {
    const bySub = await getSubBy(db, 'asaas_subscription_id', ref.subscriptionId)
    if (bySub) return bySub
  }

  let checkoutId = ref.checkoutId ?? null
  if (!checkoutId && ref.subscriptionId && deps.asaas) {
    // payload sem o checkout: pergunta ao Asaas de qual checkout veio
    const sub = await getSubscription(deps.asaas, ref.subscriptionId)
    checkoutId = str(sub?.checkoutSession)
  }
  if (!checkoutId) return null

  const existing = await getSubBy(db, 'id', checkoutId)
  if (existing) {
    if (!existing.asaas_subscription_id && ref.subscriptionId) {
      await rpc<string>(db, 'billing_upsert_subscription', {
        p_id: existing.id, p_user_id: existing.user_id, p_plan_key: existing.plan_key, p_cycle: existing.cycle,
        p_subscription_id: ref.subscriptionId, p_customer_id: ref.customerId ?? null,
      })
      return (await getSubBy(db, 'id', checkoutId)) ?? existing
    }
    return existing
  }

  const owner = await checkoutOwner(db, checkoutId)
  if (!owner) return null
  const linked = await rpc<string>(db, 'billing_upsert_subscription', {
    p_id: checkoutId, p_user_id: owner.userId, p_plan_key: owner.planKey, p_cycle: PLAN_PRICING[owner.planKey].cycle,
    p_subscription_id: ref.subscriptionId ?? null, p_customer_id: ref.customerId ?? null,
  })
  if (linked !== 'ok') {
    console.warn('[billing] vinculo recusado', { checkoutId, linked })
    return null
  }
  return getSubBy(db, 'id', checkoutId)
}

// Termina, no Asaas, uma assinatura que o banco já encerrou. Se o Asaas recusar
// de vez (4xx), marca pro admin em vez de travar a fila do webhook; se estiver
// fora do ar, lança (o webhook devolve 500 e o Asaas reenvia).
async function finishAsaasRemoval(deps: BillingDeps, rowId: string, end: EndResult): Promise<'deleted' | 'skipped' | 'flagged'> {
  if (!end.needs_asaas_delete) return 'skipped'
  const flag = (note: string) => rpc<null>(deps.db, 'billing_flag_review', { p_id: rowId, p_note: note }).then(() => 'flagged' as const)
  if (!deps.asaas) return flag('remover a assinatura no painel do Asaas (servidor sem ASAAS_API_KEY)')
  const subId = end.subscription_id ?? await findSubscriptionIdByCheckout(deps.asaas, rowId)
  if (!subId) return flag('assinatura nao encontrada no Asaas para remover')
  try {
    await deleteSubscription(deps.asaas, subId)
  } catch (e) {
    if (e instanceof AsaasError && e.kind === 'rejected') return flag(`Asaas recusou remover ${subId}: ${e.message}`)
    throw e
  }
  await rpc<null>(deps.db, 'billing_mark_asaas_deleted', { p_id: rowId, p_subscription_id: subId })
  return 'deleted'
}

// ── Ativação (CHECKOUT_PAID) ──

export async function activateFromCheckout(
  deps: BillingDeps,
  input: { checkoutId: string; userId: string; planKey: PlanKey; customerId?: string | null; firstDueDate?: string | null },
): Promise<{ result: 'activated' | 'owner_mismatch'; superseded: number }> {
  const { db } = deps
  const now = (deps.now ?? (() => new Date()))()
  const price = PLAN_PRICING[input.planKey]
  const due = input.firstDueDate ?? brtToday(now)

  const linked = await rpc<string>(db, 'billing_upsert_subscription', {
    p_id: input.checkoutId, p_user_id: input.userId, p_plan_key: input.planKey, p_cycle: price.cycle,
    p_subscription_id: null, p_customer_id: input.customerId ?? null, p_paid_due_date: due, p_activate: true,
  })
  if (linked === 'owner_mismatch') {
    console.error('[billing] checkout pago ligado a outro usuario; nada ativado', { checkoutId: input.checkoutId })
    await rpc<null>(db, 'billing_flag_review', { p_id: input.checkoutId, p_note: 'CHECKOUT_PAID com dono diferente do registrado' })
    return { result: 'owner_mismatch', superseded: 0 }
  }

  // Registro antigo (o painel admin atual lê esta tabela). Idempotente pelo id.
  const { error: payErr } = await db.from('payments').upsert({
    id: input.checkoutId, user_id: input.userId, plan_key: input.planKey,
    value: price.value, cycle: price.cycle, asaas_checkout_id: input.checkoutId,
  }, { onConflict: 'id' })
  if (payErr) console.error('[billing] payments upsert falhou:', payErr.message)

  // Comprou um plano novo tendo outro ativo: encerra o anterior (sem cobrar duas vezes).
  // Só as ANTERIORES a esta e só se esta estiver ativa: um CHECKOUT_PAID antigo
  // reprocessado nunca derruba uma assinatura mais nova.
  let superseded = 0
  const current = await getSubBy(db, 'id', input.checkoutId)
  const others = current?.status === 'active' ? await activeRowsForUser(db, input.userId) : []
  for (const old of others) {
    if (old.id === input.checkoutId || old.created_at >= current!.created_at) continue
    const end = await rpc<EndResult>(db, 'billing_end_subscription', { p_id: old.id, p_source: 'superseded', p_paid_due_date: null, p_immediate: true })
    await finishAsaasRemoval(deps, old.id, end)
    superseded++
  }

  // Avisos do próprio Asaas (vencimento e atraso) ligados. Nunca derruba a ativação.
  if (deps.asaas && input.customerId) {
    try { await ensureDueDateNotifications(deps.asaas, input.customerId) } catch (e) {
      console.warn('[billing] nao deu pra conferir as notificacoes do cliente:', e instanceof Error ? e.message : 'erro')
    }
  }
  return { result: 'activated', superseded }
}

// ── Cancelamento (botão do app; o admin também chama) ──

export type CancelResult = {
  result: 'canceled' | 'already_canceled'
  accessUntil: string | null
  refunded: boolean
  plan: string
}

type LegacyCandidate = { checkoutId: string; planKey: PlanKey }

// Assinou antes desta versão: o checkout pago ficou em payments, sem linha em
// billing_subscriptions. Só esses precisam de consulta ao Asaas pra serem achados.
async function legacyCandidates(db: SupabaseClient, userId: string): Promise<LegacyCandidate[]> {
  const { data, error } = await db.from('payments').select('asaas_checkout_id, plan_key').eq('user_id', userId)
  if (error) throw new BillingError('db_error', `Falha no banco (payments): ${error.message}`, 500)
  const out: LegacyCandidate[] = []
  for (const p of (data as { asaas_checkout_id?: unknown; plan_key?: unknown }[] | null) ?? []) {
    const checkoutId = str(p.asaas_checkout_id)
    if (!checkoutId || !isPlanKey(p.plan_key)) continue
    if (await getSubBy(db, 'id', checkoutId)) continue
    out.push({ checkoutId, planKey: p.plan_key })
  }
  return out
}

async function adoptLegacySubscriptions(db: SupabaseClient, asaas: AsaasApi, userId: string, candidates: LegacyCandidate[]): Promise<void> {
  for (const c of candidates) {
    const subId = await findSubscriptionIdByCheckout(asaas, c.checkoutId)
    if (!subId) continue
    const sub = await getSubscription(asaas, subId)
    if (!sub || sub.status !== 'ACTIVE') continue
    await rpc<string>(db, 'billing_upsert_subscription', {
      p_id: c.checkoutId, p_user_id: userId, p_plan_key: c.planKey, p_cycle: PLAN_PRICING[c.planKey].cycle,
      p_subscription_id: subId, p_customer_id: str(sub.customer),
    })
  }
}

const MSG_MISCONFIGURED = 'O cancelamento está indisponível agora. Fale com a gente pelo WhatsApp.'

// Cancela as assinaturas DESTE usuário. Também usado ao excluir a conta
// (immediate: true). Sem nada pra cancelar, lança not_found sem falar com o Asaas.
export async function cancelSubscriptionForUser(
  deps: BillingDeps,
  input: { userId: string; source: 'user' | 'admin'; immediate?: boolean },
): Promise<CancelResult> {
  const { db } = deps
  const now = (deps.now ?? (() => new Date()))()

  // 1. Só as assinaturas DESTE usuário (o id vem do login, nunca do pedido).
  let rows = await activeRowsForUser(db, input.userId)
  if (rows.length === 0) {
    const candidates = await legacyCandidates(db, input.userId)
    if (candidates.length > 0) {
      if (!deps.asaas) throw new BillingError('misconfigured', MSG_MISCONFIGURED, 500)
      try {
        await adoptLegacySubscriptions(db, deps.asaas, input.userId, candidates)
      } catch (e) {
        if (e instanceof AsaasError) throw new BillingError('asaas_unavailable', MSG_ASAAS_DOWN_NOTHING_CHANGED, 502)
        throw e
      }
      rows = await activeRowsForUser(db, input.userId)
    }
  }

  if (rows.length === 0) {
    const { data, error } = await db.from('billing_subscriptions').select(SUB_COLS)
      .eq('user_id', input.userId).eq('status', 'canceled')
    if (error) throw new BillingError('db_error', `Falha no banco: ${error.message}`, 500)
    const graced = ((data as SubRow[] | null) ?? [])
      .filter((r) => r.access_until && Date.parse(r.access_until) > now.getTime())
      .sort((a, b) => (a.access_until! < b.access_until! ? 1 : -1))[0]
    if (graced) return { result: 'already_canceled', accessUntil: graced.access_until, refunded: false, plan: graced.plan_key }
    throw new BillingError('not_found',
      'Não encontramos uma assinatura ativa na sua conta. Se aparece cobrança no seu cartão, fale com a gente pelo WhatsApp que a gente resolve.', 404)
  }

  const asaas = deps.asaas
  if (!asaas) throw new BillingError('misconfigured', MSG_MISCONFIGURED, 500)

  // 2. Lê tudo no Asaas ANTES de mudar qualquer coisa.
  type Plan = { row: SubRow; subId: string; lastPaid: string | null; withdrawal: ReturnType<typeof withdrawalStatus> }
  const plans: Plan[] = []
  try {
    for (const row of rows) {
      const subId = row.asaas_subscription_id ?? await findSubscriptionIdByCheckout(asaas, row.id)
      if (!subId) {
        // Sem o id não dá pra parar a cobrança: não marca nada como cancelado.
        await rpc<null>(db, 'billing_flag_review', { p_id: row.id, p_note: 'cancelamento pedido no app, mas a assinatura nao foi achada no Asaas' })
        throw new BillingError('asaas_rejected',
          'Não achamos sua assinatura no sistema de pagamento para cancelar. Nada foi alterado. Fale com a gente pelo WhatsApp que a gente resolve por lá.', 502)
      }
      const payments = await listSubscriptionPayments(asaas, subId)
      plans.push({ row, subId, lastPaid: latestPaidDueDate(payments), withdrawal: input.source === 'user' ? withdrawalStatus(payments, now) : null })
    }
  } catch (e) {
    if (e instanceof AsaasError) throw new BillingError('asaas_unavailable', MSG_ASAAS_DOWN_NOTHING_CHANGED, 502)
    throw e
  }

  // 3. Executa uma assinatura por vez: estorno (se couber), remoção no Asaas, registro.
  //    A ordem protege o bolso do cliente: se o estorno sair e a remoção falhar,
  //    o webhook PAYMENT_REFUNDED também cancela a assinatura sozinho.
  let accessUntil: string | null = null
  let refunded = false
  let done = 0
  for (const plan of plans) {
    const { row, subId, withdrawal } = plan
    const isWithdrawal = !!withdrawal
    let stage: 'refund' | 'delete' | 'record' = 'refund'
    let refundedNow = false
    try {
      if (withdrawal && !withdrawal.alreadyRefunded) {
        await refundPayment(asaas, withdrawal.payment.id, 'Arrependimento em ate 7 dias (cancelado pelo app)')
        refundedNow = true
      }
      stage = 'delete'
      await deleteSubscription(asaas, subId)
      stage = 'record'
      const end = await rpc<EndResult>(db, 'billing_end_subscription', {
        p_id: row.id,
        p_source: isWithdrawal ? 'user_refund' : input.source,
        p_paid_due_date: plan.lastPaid,
        p_immediate: isWithdrawal || !!input.immediate,
      })
      await rpc<null>(db, 'billing_mark_asaas_deleted', { p_id: row.id, p_subscription_id: subId })
      refunded = refunded || isWithdrawal
      const a = end.access_until ?? null
      if (a && (!accessUntil || a > accessUntil)) accessUntil = a
      done++
    } catch (e) {
      console.error('[billing] cancelamento parou', { rowId: row.id, stage, message: e instanceof Error ? e.message : 'erro' })
      if (stage === 'record') {
        throw new BillingError('partial',
          'Sua assinatura foi cancelada no sistema de pagamento e nada mais será cobrado, mas não conseguimos atualizar sua conta aqui. Tente de novo para ver a data certinha.', 500)
      }
      if (refundedNow) {
        throw new BillingError('partial',
          'O estorno foi pedido, mas o sistema de pagamento não confirmou o fim da renovação. Tente de novo em alguns minutos. Se continuar, fale com a gente pelo WhatsApp.', 502)
      }
      if (done === 0) {
        throw new BillingError('asaas_unavailable', stage === 'refund'
          ? 'Não conseguimos pedir o estorno agora. Nada foi cancelado e nada mudou. Tente de novo em alguns minutos.'
          : MSG_ASAAS_DOWN_NOTHING_CHANGED, 502)
      }
      throw new BillingError('partial',
        'Parte do cancelamento foi feita, mas o sistema de pagamento parou de responder. Tente de novo em alguns minutos para terminar.', 502)
    }
  }

  return { result: 'canceled', accessUntil, refunded, plan: rows[0].plan_key }
}

// ── Troca de plano (admin) ──
// Vale a partir da próxima cobrança: o Asaas atualiza valor e ciclo da
// assinatura e das cobranças pendentes já geradas; o plano do perfil muda na hora.
export async function changePlan(deps: BillingDeps, input: { userId: string; newPlanKey: PlanKey }): Promise<{ result: 'changed' | 'unchanged'; planKey: PlanKey }> {
  if (!deps.asaas) throw new BillingError('misconfigured', 'Troca de plano indisponível (servidor sem ASAAS_API_KEY).', 500)
  const [row] = await activeRowsForUser(deps.db, input.userId)
  if (!row) throw new BillingError('not_found', 'Este usuário não tem assinatura ativa.', 404)
  if (row.plan_key === input.newPlanKey) return { result: 'unchanged', planKey: input.newPlanKey }
  const price = PLAN_PRICING[input.newPlanKey]
  try {
    const subId = row.asaas_subscription_id ?? await findSubscriptionIdByCheckout(deps.asaas, row.id)
    if (!subId) throw new BillingError('not_found', 'Assinatura não encontrada no Asaas.', 404)
    await deps.asaas.put(`/subscriptions/${encodeURIComponent(subId)}`, {
      value: price.value, cycle: price.cycle, description: price.description, updatePendingPayments: true,
    })
  } catch (e) {
    if (e instanceof AsaasError) {
      throw new BillingError(e.kind === 'rejected' ? 'asaas_rejected' : 'asaas_unavailable', `O Asaas não trocou o plano: ${e.message}. Nada mudou.`, 502)
    }
    throw e
  }
  const res = await rpc<{ result: string }>(deps.db, 'billing_change_plan', { p_id: row.id, p_plan_key: input.newPlanKey, p_cycle: price.cycle })
  if (res?.result !== 'changed') {
    throw new BillingError('partial', `O Asaas trocou o plano, mas o banco respondeu ${res?.result ?? 'nada'}. Conferir à mão.`, 500)
  }
  return { result: 'changed', planKey: input.newPlanKey }
}

// ── Cortesia (admin): plano pago sem cobrança ──
export async function grantCourtesy(
  deps: BillingDeps,
  input: { userId: string; planKey: PlanKey; until?: Date | null; note?: string | null },
): Promise<{ courtesyId: string }> {
  if (!UUID_RE.test(input.userId)) throw new BillingError('not_found', 'Usuário inválido.', 400)
  const id = await rpc<string>(deps.db, 'billing_grant_courtesy', {
    p_user_id: input.userId, p_plan_key: input.planKey,
    p_until: input.until ? input.until.toISOString() : null, p_note: input.note ?? null,
  })
  return { courtesyId: id }
}

export async function endCourtesy(deps: BillingDeps, input: { courtesyId: string }): Promise<{ result: string }> {
  if (!input.courtesyId.startsWith('cortesia:')) throw new BillingError('not_found', 'Isto não é uma cortesia.', 400)
  const end = await rpc<EndResult>(deps.db, 'billing_end_subscription', { p_id: input.courtesyId, p_source: 'admin', p_paid_due_date: null, p_immediate: true })
  return { result: end.result }
}

// ── Webhook ──

const PAYMENT_EVENTS_KEPT = new Set([
  'PAYMENT_CREATED', 'PAYMENT_UPDATED', 'PAYMENT_CONFIRMED', 'PAYMENT_RECEIVED', 'PAYMENT_OVERDUE',
  'PAYMENT_DELETED', 'PAYMENT_RESTORED', 'PAYMENT_REFUNDED', 'PAYMENT_PARTIALLY_REFUNDED',
  'PAYMENT_REFUND_IN_PROGRESS', 'PAYMENT_CHARGEBACK_REQUESTED', 'PAYMENT_CHARGEBACK_DISPUTE',
  'PAYMENT_AWAITING_CHARGEBACK_REVERSAL', 'PAYMENT_RECEIVED_IN_CASH_UNDONE',
])

export function isBillingEvent(event: unknown): event is string {
  return event === 'CHECKOUT_PAID'
    || (typeof event === 'string' && event.startsWith('SUBSCRIPTION_'))
    || (typeof event === 'string' && PAYMENT_EVENTS_KEPT.has(event))
}

export async function handleAsaasEvent(deps: BillingDeps, payload: Record<string, unknown>): Promise<{ result: string }> {
  const event = str(payload.event) ?? ''
  if (event === 'CHECKOUT_PAID') return onCheckoutPaid(deps, obj(payload.checkout))
  if (event.startsWith('SUBSCRIPTION_')) return onSubscriptionEvent(deps, event, obj(payload.subscription))
  if (PAYMENT_EVENTS_KEPT.has(event)) return onPaymentEvent(deps, event, obj(payload.payment))
  return { result: 'ignored' }
}

async function onCheckoutPaid(deps: BillingDeps, checkout: Record<string, unknown>): Promise<{ result: string }> {
  const checkoutId = str(checkout.id)
  let owner = checkoutId ? await checkoutOwner(deps.db, checkoutId) : null
  // Bônus: se o Asaas tiver propagado nosso externalReference ("<user>::<plano>").
  if (!owner && typeof checkout.externalReference === 'string' && checkout.externalReference.includes('::')) {
    const [u, p] = checkout.externalReference.split('::')
    if (UUID_RE.test(u) && isPlanKey(p)) owner = { userId: u, planKey: p }
  }
  if (!owner || !checkoutId) {
    console.warn('[asaas-webhook] could not resolve user/plan', { checkoutId })
    return { result: 'no-ref' }
  }
  const sub = obj(checkout.subscription)
  const out = await activateFromCheckout(deps, {
    checkoutId, userId: owner.userId, planKey: owner.planKey,
    customerId: str(checkout.customer), firstDueDate: toBrtDate(sub.nextDueDate),
  })
  return { result: out.result === 'activated' ? 'activated' : out.result }
}

async function onSubscriptionEvent(deps: BillingDeps, event: string, sub: Record<string, unknown>): Promise<{ result: string }> {
  const subId = str(sub.id)
  if (!subId) return { result: 'ignored' }
  const row = await resolveSubscription(deps, { subscriptionId: subId, checkoutId: str(sub.checkoutSession), customerId: str(sub.customer) })
  if (!row) {
    console.warn('[asaas-webhook] assinatura sem dono conhecido', { subId, event })
    return { result: 'unresolved' }
  }
  const status = str(sub.status)
  const ended = event === 'SUBSCRIPTION_DELETED' || event === 'SUBSCRIPTION_INACTIVATED'
    || (event === 'SUBSCRIPTION_UPDATED' && (sub.deleted === true || status === 'INACTIVE' || status === 'EXPIRED'))
  if (!ended) return { result: 'linked' }

  if (row.status === 'canceled') {
    // nosso próprio cancelamento voltando pelo webhook: só confirma a remoção
    if (!row.asaas_deleted_at) await rpc<null>(deps.db, 'billing_mark_asaas_deleted', { p_id: row.id, p_subscription_id: subId })
    return { result: 'already_canceled' }
  }
  // Parou no Asaas (painel ou inativação): plano até o fim do período pago.
  let paidDue: string | null = null
  if (!row.paid_until && deps.asaas) paidDue = latestPaidDueDate(await listSubscriptionPayments(deps.asaas, subId))
  await rpc<EndResult>(deps.db, 'billing_end_subscription', { p_id: row.id, p_source: 'asaas', p_paid_due_date: paidDue, p_immediate: false })
  return { result: 'ended' }
}

async function recordPayment(deps: BillingDeps, row: SubRow, event: string, p: Record<string, unknown>): Promise<void> {
  const now = (deps.now ?? (() => new Date()))()
  const record: Record<string, unknown> = {
    asaas_payment_id: str(p.id),
    user_id: row.user_id,
    subscription_ref: row.id,
    asaas_subscription_id: str(p.subscription) ?? row.asaas_subscription_id,
    asaas_checkout_id: str(p.checkoutSession) ?? (row.kind === 'asaas' ? row.id : null),
    asaas_customer_id: str(p.customer) ?? row.asaas_customer_id,
    status: str(p.status) ?? event.replace(/^PAYMENT_/, ''),
    billing_type: str(p.billingType),
    value: num(p.value),
    net_value: num(p.netValue),
    original_value: num(p.originalValue),
    interest_value: num(p.interestValue),
    due_date: toBrtDate(p.dueDate),
    payment_date: toBrtDate(p.paymentDate ?? p.clientPaymentDate),
    confirmed_date: toBrtDate(p.confirmedDate),
    last_event: event,
    last_event_at: now.toISOString(),
  }
  if (event === 'PAYMENT_REFUNDED') record.refunded_at = now.toISOString()
  // Dados do cartão (creditCard) nunca são guardados.
  const { error } = await deps.db.from('billing_payments').upsert(record, { onConflict: 'asaas_payment_id' })
  if (error) throw new BillingError('db_error', `Falha no banco (billing_payments): ${error.message}`, 500)
}

async function onPaymentEvent(deps: BillingDeps, event: string, p: Record<string, unknown>): Promise<{ result: string }> {
  const paymentId = str(p.id)
  const subId = str(p.subscription)
  const checkoutId = str(p.checkoutSession)
  if (!paymentId) return { result: 'ignored' }
  // Cobrança avulsa (fora de assinatura do app): não é nossa, não guarda.
  if (!subId && !checkoutId) return { result: 'not_subscription' }
  const row = await resolveSubscription(deps, { subscriptionId: subId, checkoutId, customerId: str(p.customer) })
  if (!row) {
    console.warn('[asaas-webhook] cobranca sem dono conhecido', { paymentId, event })
    return { result: 'unresolved' }
  }
  await recordPayment(deps, row, event, p)
  const due = toBrtDate(p.dueDate)

  switch (event) {
    case 'PAYMENT_CONFIRMED':
    case 'PAYMENT_RECEIVED': {
      const r = await rpc<EndResult>(deps.db, 'billing_payment_confirmed', { p_id: row.id, p_due_date: due })
      if (r.result === 'late_after_cancel') console.warn('[asaas-webhook] pagamento depois do cancelamento, marcado pro admin', { rowId: row.id })
      return { result: r.result }
    }
    case 'PAYMENT_OVERDUE': {
      const r = await rpc<EndResult>(deps.db, 'billing_payment_overdue', { p_id: row.id, p_due_date: due })
      await finishAsaasRemoval(deps, row.id, r)
      return { result: r.result }
    }
    case 'PAYMENT_REFUNDED': {
      const r = await rpc<EndResult>(deps.db, 'billing_payment_refunded', { p_id: row.id, p_due_date: due })
      await finishAsaasRemoval(deps, row.id, r)
      return { result: r.result }
    }
    case 'PAYMENT_CHARGEBACK_REQUESTED':
    case 'PAYMENT_CHARGEBACK_DISPUTE':
      await rpc<null>(deps.db, 'billing_flag_review', { p_id: row.id, p_note: `chargeback na cobranca ${paymentId}` })
      return { result: 'flagged_chargeback' }
    default:
      return { result: 'recorded' }
  }
}

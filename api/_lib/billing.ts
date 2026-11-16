import type { SupabaseClient } from '@supabase/supabase-js'
import {
  AsaasError,
  deleteSubscription,
  ensureEmailOnlyNotifications,
  findSubscriptionIdByCheckout,
  getSubscription,
  inactivateSubscription,
  listSubscriptionPayments,
  refundPayment,
  removeFuturePendingCharges,
  type AsaasApi,
  type AsaasPayment,
} from './asaas.js'
import { PLAN_PRICING, isPlanKey, type BillingCycle, type PlanKey } from './pricing.js'

// Regras de cobrança do Playback Studio (dono e coordenador, 2026-11-16).
// O estado mora no banco (db/supabase_assinaturas.sql); aqui ficam a ordem das
// chamadas ao Asaas e ao Supabase e o tratamento de cada evento do webhook.
//
// * Cancelar pelo botão: plano até o fim do período pago, depois Livre.
// * Arrependimento em até 7 dias da primeira cobrança: estorno automático só
//   na PRIMEIRA assinatura da conta; nas seguintes, a renovação é cancelada e
//   fica um pedido de estorno pro admin aprovar. Estorno recusado pelo Asaas:
//   cancela mesmo assim e fica "estorno pendente" pro admin.
// * Renovação vencida: Livre no mesmo dia e assinatura INATIVADA no Asaas (a
//   cobrança vencida continua pagável). Paga depois do vencimento: plano até o
//   fim daquele período e marca pro admin. A liquidação do cartão nunca conta
//   como pagamento atrasado.
// * Estorno do período atual: Livre na hora e assinatura removida no Asaas.
// * Uma assinatura paga ativa por conta (COB-I7-v2), venha o aviso na ordem que
//   vier: mesmo plano pago duas vezes, fica a de pagamento confirmado mais
//   antigo e a outra tem a renovação inativada (o admin estorna à mão); planos
//   diferentes, fica o checkout criado por último e a outra é encerrada. O
//   webhook NUNCA estorna: só o botão do usuário (arrependimento) estorna.
// * Tudo que precisa ser feito no Asaas e falha vira pendência persistida
//   (billing_pending_actions), tentada de novo no próximo webhook, no próximo
//   login do usuário e no job diário, até dar certo.
//
// Funções exportadas pra reuso pelo admin: activateFromCheckout,
// cancelSubscriptionForUser, previewCancellation, changePlan, grantCourtesy,
// endCourtesy, runPendingActions, runDailyJob.

export type BillingDeps = {
  db: SupabaseClient
  asaas: AsaasApi | null
  now?: () => Date
}

export type BillingErrorCode =
  | 'asaas_unavailable' | 'asaas_rejected' | 'not_found' | 'db_error' | 'misconfigured' | 'partial' | 'pending_stop'

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
const MSG_MISCONFIGURED = 'O cancelamento está indisponível agora. Fale com a gente pelo WhatsApp.'

// ── Datas: sempre o dia no fuso America/Sao_Paulo (o Asaas trabalha com datas
// de Brasília). Nunca a data de UTC: 21:30 em Brasília já é o dia seguinte em UTC.

const BRT_DAY = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' })
const DATE_RE = /^(\d{4}-\d{2}-\d{2})(?:[ T](\d{2}:\d{2}(?::\d{2})?)(?:\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?$/

// Dia (AAAA-MM-DD) em Brasília de um instante.
export function brtToday(now: Date): string {
  const parts = BRT_DAY.formatToParts(now)
  const get = (type: string) => parts.find((x) => x.type === type)?.value ?? ''
  return `${get('year')}-${get('month')}-${get('day')}`
}

// "2026-11-16", "2026-11-16 15:02:38" ou "2026-11-16T03:00:00+0000" → "2026-11-16" em Brasília.
// Sem fuso, o Asaas já manda a data de Brasília.
export function toBrtDate(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const m = DATE_RE.exec(v.trim())
  if (!m) return null
  if (!m[3]) return m[1]
  const zone = m[3] === 'Z' ? 'Z' : m[3].replace(/^([+-]\d{2}):?(\d{2})$/, '$1:$2')
  const t = Date.parse(`${m[1]}T${m[2] ?? '00:00:00'}${zone}`)
  if (Number.isNaN(t)) return null
  return brtToday(new Date(t))
}

// Instante de um "dateCreated" do Asaas ("2026-11-16 15:02:38", horário de
// Brasília, que não tem horário de verão desde 2019).
export function asaasInstant(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const m = DATE_RE.exec(v.trim())
  if (!m) return null
  const zone = m[3] ? (m[3] === 'Z' ? 'Z' : m[3].replace(/^([+-]\d{2}):?(\d{2})$/, '$1:$2')) : '-03:00'
  const t = Date.parse(`${m[1]}T${m[2] ?? '00:00:00'}${zone}`)
  return Number.isNaN(t) ? null : new Date(t).toISOString()
}

export function addDays(date: string, days: number): string {
  const t = Date.parse(`${date}T00:00:00Z`) + days * 86400_000
  return new Date(t).toISOString().slice(0, 10)
}

// ── Cobranças ──

export const PAID_STATUSES = new Set(['CONFIRMED', 'RECEIVED', 'RECEIVED_IN_CASH'])
const REFUNDED_STATUSES = new Set(['REFUNDED', 'REFUND_REQUESTED', 'REFUND_IN_PROGRESS'])
export const WITHDRAWAL_DAYS = 7

// Dia em que o cliente pagou (cartão: confirmedDate).
export function paidOn(p: AsaasPayment | Record<string, unknown>): string | null {
  const x = p as AsaasPayment
  return toBrtDate(x.confirmedDate ?? x.paymentDate ?? x.clientPaymentDate)
}

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

// Arrependimento: só a primeira cobrança da assinatura (nenhuma renovação) e
// até 7 dias corridos depois do pagamento, no horário de Brasília.
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
  user_id: string | null
  plan_key: string
  cycle: BillingCycle | null
  asaas_subscription_id: string | null
  asaas_customer_id: string | null
  status: 'active' | 'canceled'
  started_at: string
  first_paid_at: string | null
  checkout_created_at: string | null
  checkout_paid_at: string | null
  switch_confirmed: boolean | null
  last_paid_due_date: string | null
  next_due_date: string | null
  paid_until: string | null
  access_until: string | null
  cancel_source: string | null
  asaas_stopped_at: string | null
  created_at: string
}
const SUB_COLS = 'id, kind, user_id, plan_key, cycle, asaas_subscription_id, asaas_customer_id, status, started_at, first_paid_at, checkout_created_at, checkout_paid_at, switch_confirmed, last_paid_due_date, next_due_date, paid_until, access_until, cancel_source, asaas_stopped_at, created_at'

type EndResult = { result: string; access_until?: string | null; action_id?: number | null }

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
function nowOf(deps: BillingDeps): Date {
  return (deps.now ?? (() => new Date()))()
}
function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : 'erro'
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

// Assinaturas pagas ativas do usuário, da de início mais recente pra mais antiga.
async function activeRowsForUser(db: SupabaseClient, userId: string): Promise<SubRow[]> {
  const { data, error } = await db.from('billing_subscriptions').select(SUB_COLS)
    .eq('user_id', userId).eq('status', 'active').eq('kind', 'asaas')
  if (error) throw new BillingError('db_error', `Falha no banco (billing_subscriptions): ${error.message}`, 500)
  return ((data as SubRow[] | null) ?? []).sort((a, b) => (a.started_at < b.started_at ? 1 : -1))
}

type Owner = { userId: string; planKey: PlanKey; startedAt: string | null; legacy: boolean; switchConfirmed: boolean; checkoutCreatedAt: string | null }

// Dono de um checkout: o vínculo gravado pelo api/checkout.ts e, pra quem
// assinou antes desta versão (vínculo já apagado), a tabela payments.
async function checkoutOwner(db: SupabaseClient, checkoutId: string): Promise<Owner | null> {
  const pending = await db.from('pending_checkouts').select('user_id, plan_key, switch_confirmed, created_at').eq('id', checkoutId).maybeSingle()
  if (pending.error) throw new BillingError('db_error', `Falha no banco (pending_checkouts): ${pending.error.message}`, 500)
  const p = pending.data as { user_id?: unknown; plan_key?: unknown; switch_confirmed?: unknown; created_at?: unknown } | null
  if (p && typeof p.user_id === 'string' && UUID_RE.test(p.user_id) && isPlanKey(p.plan_key)) {
    return { userId: p.user_id, planKey: p.plan_key, startedAt: null, legacy: false, switchConfirmed: p.switch_confirmed === true, checkoutCreatedAt: str(p.created_at) }
  }
  const paid = await db.from('payments').select('user_id, plan_key, paid_at').eq('asaas_checkout_id', checkoutId).maybeSingle()
  if (paid.error) throw new BillingError('db_error', `Falha no banco (payments): ${paid.error.message}`, 500)
  const q = paid.data as { user_id?: unknown; plan_key?: unknown; paid_at?: unknown } | null
  if (q && typeof q.user_id === 'string' && UUID_RE.test(q.user_id) && isPlanKey(q.plan_key)) {
    return { userId: q.user_id, planKey: q.plan_key, startedAt: str(q.paid_at), legacy: true, switchConfirmed: false, checkoutCreatedAt: str(q.paid_at) }
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
  let asaasSub: Awaited<ReturnType<typeof getSubscription>> | undefined
  if (!checkoutId && ref.subscriptionId && deps.asaas) {
    // payload sem o checkout: pergunta ao Asaas de qual checkout veio
    asaasSub = await getSubscription(deps.asaas, ref.subscriptionId)
    checkoutId = str(asaasSub?.checkoutSession)
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
    p_subscription_id: ref.subscriptionId ?? null, p_customer_id: ref.customerId ?? null, p_started_at: owner.startedAt,
    // quem assinou antes desta versão já pagou (o plano veio do CHECKOUT_PAID antigo)
    p_first_paid_at: owner.legacy ? owner.startedAt : null,
    p_checkout_created_at: owner.checkoutCreatedAt, p_switch_confirmed: owner.switchConfirmed,
    p_checkout_paid_at: owner.legacy ? owner.startedAt : null,
  })
  if (linked !== 'ok') {
    console.warn('[billing] vinculo recusado', { checkoutId, linked })
    return null
  }
  // Assinante de antes desta versão: a linha nasce ativa só se a assinatura
  // ainda está ativa no Asaas (evento de cobrança antiga não ressuscita plano).
  if (owner.legacy && ref.subscriptionId && deps.asaas) {
    const sub = asaasSub !== undefined ? asaasSub : await getSubscription(deps.asaas, ref.subscriptionId)
    if (!sub || sub.deleted === true || sub.status !== 'ACTIVE') {
      await rpc<EndResult>(db, 'billing_end_subscription', {
        p_id: checkoutId, p_source: 'asaas', p_paid_due_date: null, p_immediate: false,
        p_stop: sub?.status === 'INACTIVE' ? 'inactivate' : 'delete', p_already_stopped: true,
      })
    }
  }
  return getSubBy(db, 'id', checkoutId)
}

// ── Pendências com o Asaas ──

type PendingAction = {
  id: number
  subscription_ref: string
  action: 'delete_subscription' | 'inactivate_subscription' | 'delete_future_payments' | 'refund_payment'
  reason: string
  asaas_subscription_id: string | null
  asaas_payment_id: string | null   // na inativação: a vencida da decisão, que nunca é removida
  due_date: string | null
}

// Executa as pendências com o Asaas. Nunca lança por erro do Asaas: a falha
// fica gravada e é tentada de novo depois.
export async function runPendingActions(
  deps: BillingDeps,
  filter: { ids?: number[]; userId?: string; limit?: number } = {},
): Promise<{ done: number; failed: number }> {
  const out = { done: 0, failed: 0 }
  const asaas = deps.asaas
  if (!asaas) return out
  if (filter.ids && filter.ids.length === 0) return out
  let q = deps.db.from('billing_pending_actions')
    .select('id, subscription_ref, action, reason, asaas_subscription_id, asaas_payment_id, due_date')
    .eq('status', 'pending').eq('auto_retry', true)
  if (filter.ids) q = q.in('id', filter.ids)
  else q = q.lte('next_attempt_at', nowOf(deps).toISOString())
  if (filter.userId) q = q.eq('user_id', filter.userId)
  const { data, error } = await q.order('id', { ascending: true }).limit(filter.limit ?? 10)
  if (error) throw new BillingError('db_error', `Falha no banco (billing_pending_actions): ${error.message}`, 500)

  const queue = [...((data as PendingAction[] | null) ?? [])]
  while (queue.length > 0) {
    const a = queue.shift()!
    try {
      const row = await getSubBy(deps.db, 'id', a.subscription_ref)
      const subId = a.asaas_subscription_id ?? row?.asaas_subscription_id ?? await findSubscriptionIdByCheckout(asaas, a.subscription_ref)
      if (!subId) {
        await rpc<null>(deps.db, 'billing_action_failed', { p_action_id: a.id, p_error: 'assinatura nao achada no Asaas', p_permanent: true })
        out.failed++
        continue
      }
      if (a.action === 'inactivate_subscription') {
        // Rede de segurança (sem o evento do Asaas): confere no Asaas antes.
        if (a.reason === 'rede_de_seguranca' && a.due_date) {
          const payments = await listSubscriptionPayments(asaas, subId)
          const today = brtToday(nowOf(deps))
          const live = payments.filter((p) => !p.deleted)
          // A cobrança do ciclo cortado é a de vencimento ORIGINAL igual ao ciclo;
          // só se nenhuma tiver esse ciclo vale a data atual (COB-S2: uma cobrança
          // de ciclo antigo adiada pra essa data não conta como a do ciclo).
          const ofCycle = live.filter((p) => toBrtDate(p.originalDueDate) === a.due_date)
          const candidates = ofCycle.length > 0 ? ofCycle : live.filter((p) => toBrtDate(p.dueDate) === a.due_date)
          const paid = candidates.find((p) => PAID_STATUSES.has(p.status ?? ''))
          // Q3/S1: cobrança já vencida sem pagamento, em qualquer status (removida
          // não conta; estornada também não: não é dívida, COB-FINAL)
          const unpaidPast = live.some((p) => {
            const d = toBrtDate(p.dueDate)
            return !!d && d < today && !PAID_STATUSES.has(p.status ?? '') && !REFUNDED_STATUSES.has(p.status ?? '')
          })
          // COB-S1 / COB-FINAL: com outra cobrança vencida sem pagamento nada é
          // desfeito, nem o pago em dia: cai no ramo de baixo (corte mantido, marca e inativa).
          if (paid && !unpaidPast) {
            const r = await rpc<EndResult>(deps.db, 'billing_payment_confirmed', {
              p_id: a.subscription_ref, p_due_date: toBrtDate(paid.originalDueDate) ?? a.due_date,
              p_paid_on: paidOn(paid), p_real_due: toBrtDate(paid.dueDate),
            })
            // Pago em dia (o aviso é que atrasou): corte desfeito e marcado, nada a inativar.
            if (r.result === 'reactivated') { await enforceSinglePaid(deps, row?.user_id ?? null); out.done++; continue }
            if (r.result === 'already_counted') {
              // COB-R1 com a COB-S1: ciclo já contado só é corte indevido se o
              // pagamento foi EM DIA (até o vencimento da própria cobrança); a outra
              // vencida sem pagamento já foi excluída acima. Aí desfaz e marca, nunca inativa.
              const paidDay = paidOn(paid)
              const onTime = !!paidDay && paidDay <= (toBrtDate(paid.dueDate) ?? a.due_date)
              if (onTime) {
                const u = await rpc<EndResult>(deps.db, 'billing_undo_counted_cut', { p_id: a.subscription_ref, p_cut_due: a.due_date })
                if (u.result !== 'refused_late') {
                  await enforceSinglePaid(deps, row?.user_id ?? null)
                  out.done++
                  continue
                }
              }
              // Atraso já contado antes desta pendência: regra do N1, plano até o
              // fim daquele período e inativa mesmo assim.
              await rpc<null>(deps.db, 'billing_flag_review', {
                p_id: a.subscription_ref,
                p_note: `rede de seguranca: ciclo ${a.due_date} pago com atraso: sem renovacao, inativa no Asaas`,
              })
            }
            // Pago depois do vencimento: plano até o fim daquele período, mas a
            // inativação acontece mesmo assim (regra do dono: sem renovação).
          } else {
            // A cobrança daquele vencimento não existe mais (data mudada no
            // painel ou cobrança removida) e a próxima de verdade ainda não
            // venceu: a rede cortou à toa, desfaz.
            // Q3: só desfaz se NENHUMA cobrança já vencida está sem pagamento,
            // em qualquer status (removida não conta); senão mantém o corte e marca.
            const next = live
              .filter((p) => p.status === 'PENDING' || p.status === 'AWAITING_RISK_ANALYSIS')
              .map((p) => toBrtDate(p.dueDate))
              .filter((d): d is string => !!d && d >= today && d !== a.due_date)
              .sort()[0]
            if (!unpaidPast && next) {
              const r = await rpc<EndResult>(deps.db, 'billing_undo_safety_cut', { p_id: a.subscription_ref, p_real_due: next })
              if (r.result === 'undone') { out.done++; continue }
            } else if (unpaidPast) {
              await rpc<null>(deps.db, 'billing_flag_review', { p_id: a.subscription_ref, p_note: 'rede de seguranca: corte mantido, ha cobranca vencida sem pagamento' })
            } else {
              // COB-R5: manter o corte também marca pro admin.
              await rpc<null>(deps.db, 'billing_flag_review', {
                p_id: a.subscription_ref,
                p_note: `rede de seguranca: corte mantido, a cobranca do ciclo ${a.due_date} nao foi achada no Asaas e nao ha proxima em aberto`,
              })
            }
          }
        }
        await inactivateSubscription(asaas, subId)
        // COB-R2: a inativação vale assim que o Asaas aceitou (asaas_stopped_at
        // gravado agora). A remoção das cobranças futuras é uma pendência própria,
        // criada na mesma chamada do banco, e roda logo em seguida; se o Asaas
        // recusar, a inativação continua feita.
        const removal = await rpc<number | null>(deps.db, 'billing_action_done', { p_action_id: a.id, p_subscription_id: subId, p_note: 'ok' })
        out.done++
        if (typeof removal === 'number') {
          queue.unshift({ id: removal, subscription_ref: a.subscription_ref, action: 'delete_future_payments', reason: a.reason, asaas_subscription_id: subId, asaas_payment_id: a.asaas_payment_id, due_date: a.due_date })
        }
        continue
      }
      if (a.action === 'delete_future_payments') {
        const res = await removeFuturePendingCharges(asaas, subId, brtToday(nowOf(deps)), { paymentId: a.asaas_payment_id, cycleDue: a.due_date })
        if (res.refused.length > 0) {
          await rpc<null>(deps.db, 'billing_flag_review', {
            p_id: a.subscription_ref,
            p_note: `renovacao inativada, mas o Asaas recusou remover a cobranca futura ${res.refused.join(', ')}: remover a mao no painel`,
          })
          await rpc<null>(deps.db, 'billing_action_failed', { p_action_id: a.id, p_error: `Asaas recusou remover ${res.refused.join(', ')}`, p_permanent: true })
          out.failed++
          continue
        }
        await rpc<number | null>(deps.db, 'billing_action_done', {
          p_action_id: a.id, p_subscription_id: subId, p_note: res.removed.length ? `removidas: ${res.removed.join(', ')}` : 'nada a remover',
        })
        out.done++
        continue
      }
      if (a.action === 'delete_subscription') {
        await deleteSubscription(asaas, subId)
      } else {
        continue // estorno: é com o admin
      }
      await rpc<number | null>(deps.db, 'billing_action_done', { p_action_id: a.id, p_subscription_id: subId, p_note: 'ok' })
      out.done++
    } catch (e) {
      if (!(e instanceof AsaasError)) throw e
      console.warn('[billing] pendencia continua pendente', { actionId: a.id, action: a.action, message: e.message })
      await rpc<null>(deps.db, 'billing_action_failed', { p_action_id: a.id, p_error: e.message, p_permanent: e.kind === 'rejected' })
      out.failed++
    }
  }
  return out
}

// Pra caminhos em que a pendência não pode derrubar nada (webhook, ativação).
async function tryPending(deps: BillingDeps, ids: (number | null | undefined)[]): Promise<void> {
  const clean = ids.filter((x): x is number => typeof x === 'number')
  if (clean.length === 0) return
  try { await runPendingActions(deps, { ids: clean }) } catch (e) {
    console.warn('[billing] pendencias ficam pro proximo ciclo:', errMsg(e))
  }
}

// ── Assinaturas de antes desta versão (sem linha em billing_subscriptions) ──

type LegacyCandidate = { checkoutId: string; planKey: PlanKey; paidAt: string | null }

async function legacyCandidates(db: SupabaseClient, userId: string): Promise<LegacyCandidate[]> {
  const { data, error } = await db.from('payments').select('asaas_checkout_id, plan_key, paid_at').eq('user_id', userId)
  if (error) throw new BillingError('db_error', `Falha no banco (payments): ${error.message}`, 500)
  const out: LegacyCandidate[] = []
  for (const p of (data as { asaas_checkout_id?: unknown; plan_key?: unknown; paid_at?: unknown }[] | null) ?? []) {
    const checkoutId = str(p.asaas_checkout_id)
    if (!checkoutId || !isPlanKey(p.plan_key)) continue
    if (await getSubBy(db, 'id', checkoutId)) continue
    out.push({ checkoutId, planKey: p.plan_key, paidAt: str(p.paid_at) })
  }
  return out
}

// Cria a linha de cada assinatura antiga ainda ATIVA no Asaas, com o início real.
async function adoptLegacySubscriptions(db: SupabaseClient, asaas: AsaasApi, userId: string, candidates: LegacyCandidate[]): Promise<void> {
  for (const c of candidates) {
    const subId = await findSubscriptionIdByCheckout(asaas, c.checkoutId)
    if (!subId) {
      // Não achou: pode seguir cobrando junto sem ninguém saber. Caso pro admin.
      await rpc<number>(db, 'billing_enqueue_action', {
        p_ref: c.checkoutId, p_action: 'admin_review', p_reason: 'assinatura antiga nao achada no Asaas: conferir se ainda cobra',
        p_auto_retry: false, p_user_id: userId,
      })
      continue
    }
    const sub = await getSubscription(asaas, subId)
    if (!sub || sub.deleted === true || sub.status !== 'ACTIVE') continue
    await rpc<string>(db, 'billing_upsert_subscription', {
      p_id: c.checkoutId, p_user_id: userId, p_plan_key: c.planKey, p_cycle: PLAN_PRICING[c.planKey].cycle,
      p_subscription_id: subId, p_customer_id: str(sub.customer), p_started_at: c.paidAt,
      p_first_paid_at: c.paidAt, p_checkout_created_at: c.paidAt, p_checkout_paid_at: c.paidAt,
    })
  }
}

// Primeira assinatura da conta? (contrato anterior em billing_subscriptions ou payments)
async function isFirstSubscription(db: SupabaseClient, userId: string): Promise<boolean> {
  const ids = new Set<string>()
  // Compra repetida (cancel_source 'duplicate') não conta: ela não tira o
  // arrependimento da compra que ficou (Q8).
  const dupes = new Set<string>()
  const subs = await db.from('billing_subscriptions').select('id, cancel_source').eq('user_id', userId).eq('kind', 'asaas')
  if (subs.error) throw new BillingError('db_error', `Falha no banco: ${subs.error.message}`, 500)
  for (const r of (subs.data as { id: string; cancel_source?: string | null }[] | null) ?? []) {
    if (r.cancel_source === 'duplicate') dupes.add(r.id)
    else ids.add(r.id)
  }
  const pays = await db.from('payments').select('asaas_checkout_id').eq('user_id', userId)
  if (pays.error) throw new BillingError('db_error', `Falha no banco: ${pays.error.message}`, 500)
  for (const r of (pays.data as { asaas_checkout_id?: unknown }[] | null) ?? []) {
    const c = str(r.asaas_checkout_id)
    if (c && !dupes.has(c)) ids.add(c)
  }
  return ids.size <= 1
}

// ── Ativação (CHECKOUT_PAID) ──

export async function activateFromCheckout(
  deps: BillingDeps,
  input: {
    checkoutId: string; userId: string; planKey: PlanKey; customerId?: string | null; firstDueDate?: string | null
    startedAt?: string | null      // hora do pagamento (dateCreated do CHECKOUT_PAID)
    switchConfirmed?: boolean      // a pessoa confirmou "Trocar de plano?" na tela
    checkoutCreatedAt?: string | null  // quando o checkout foi aberto (intenção, decide entre planos)
  },
): Promise<{ result: 'activated' | 'owner_mismatch' | 'duplicate'; superseded: number }> {
  const { db } = deps
  const price = PLAN_PRICING[input.planKey]
  const due = input.firstDueDate ?? brtToday(nowOf(deps))

  const linked = await rpc<string>(db, 'billing_upsert_subscription', {
    p_id: input.checkoutId, p_user_id: input.userId, p_plan_key: input.planKey, p_cycle: price.cycle,
    p_subscription_id: null, p_customer_id: input.customerId ?? null, p_paid_due_date: due, p_activate: true,
    p_started_at: input.startedAt ?? null,
    // CHECKOUT_PAID = pagamento confirmado, com a hora exata (desempate no mesmo dia, COB-R4)
    p_first_paid_at: input.startedAt ?? nowOf(deps).toISOString(),
    p_checkout_created_at: input.checkoutCreatedAt ?? null, p_switch_confirmed: !!input.switchConfirmed,
    p_checkout_paid_at: input.startedAt ?? nowOf(deps).toISOString(),
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

  // Quem assinou antes desta versão não tem linha: acha a assinatura antiga no
  // Asaas pra também encerrar (senão seriam duas cobranças). Asaas fora do ar
  // aqui lança: o evento fica pra nova tentativa (a ativação já valeu).
  const legacy = (await legacyCandidates(db, input.userId)).filter((c) => c.checkoutId !== input.checkoutId)
  if (legacy.length > 0) {
    if (deps.asaas) await adoptLegacySubscriptions(db, deps.asaas, input.userId, legacy)
    else await rpc<null>(db, 'billing_flag_review', { p_id: input.checkoutId, p_note: 'troca de plano: conferir assinatura antiga no Asaas (servidor sem ASAAS_API_KEY)' })
  }

  // Uma assinatura paga ativa por conta (COB-I7-v2), sem estorno automático.
  const current = await getSubBy(db, 'id', input.checkoutId)
  const enforced = await enforceSinglePaid(deps, input.userId)
  const duplicate = enforced.duplicates.includes(input.checkoutId) || current?.cancel_source === 'duplicate'
  const superseded = enforced.superseded.length

  // Avisos do próprio Asaas ao cliente só por e-mail. Nunca derruba a ativação.
  if (deps.asaas && input.customerId) {
    try { await ensureEmailOnlyNotifications(deps.asaas, input.customerId) } catch (e) {
      console.warn('[billing] nao deu pra conferir as notificacoes do cliente:', errMsg(e))
    }
  }
  return { result: duplicate ? 'duplicate' : 'activated', superseded }
}

// Garante no máximo UMA assinatura paga ativa por conta, venham os avisos na
// ordem que vierem (roda depois de todo aviso que cria ou ativa assinatura).
// * Mesmo plano: fica a de pagamento CONFIRMADO mais antigo (sem pagamento não
//   conta como primeira e espera o pagamento dela). O PAYMENT_CONFIRMED só traz o
//   dia (meia-noite de Brasília), então a comparação é pelo dia; duas compras no
//   mesmo dia desempatam pela hora exata do CHECKOUT_PAID (COB-R4), e enquanto
//   uma delas ainda não tem essa hora, espera (o CHECKOUT_PAID sempre chega). As
//   outras pagas têm a renovação inativada no Asaas e o admin recebe "compra
//   duplicada: estornar à mão".
// * Planos diferentes (entre as pagas): fica o checkout CRIADO por último (a
//   última intenção da pessoa). As outras são encerradas no Asaas e, se a troca
//   não foi confirmada na tela, o admin recebe os valores.
// O corte e a marcação pro admin vão na MESMA chamada do banco (COB-R3).
// Nunca estorna nada.
export async function enforceSinglePaid(deps: BillingDeps, userId: string | null): Promise<{ duplicates: string[]; superseded: string[] }> {
  const out = { duplicates: [] as string[], superseded: [] as string[] }
  if (!userId) return out
  const { db } = deps
  const rows = await activeRowsForUser(db, userId)
  if (rows.length <= 1) return out
  const actionIds: (number | null | undefined)[] = []
  const ts = (v: string | null | undefined) => (v ? Date.parse(v) : Number.POSITIVE_INFINITY)
  const paidDay = (r: SubRow) => brtToday(new Date(Date.parse(r.first_paid_at!)))

  const byPlan = new Map<string, SubRow[]>()
  for (const r of rows) byPlan.set(r.plan_key, [...(byPlan.get(r.plan_key) ?? []), r])
  const paidKeepers: SubRow[] = []
  let waiting = false
  for (const group of byPlan.values()) {
    const paid = group.filter((r) => r.first_paid_at)
    if (paid.length === 0) continue
    const firstDay = paid.map(paidDay).sort()[0]
    const sameDay = paid.filter((r) => paidDay(r) === firstDay)
    if (sameDay.length > 1 && sameDay.some((r) => !r.checkout_paid_at)) { waiting = true; continue }
    const keeper = sameDay
      .sort((a, b) => ts(a.checkout_paid_at) - ts(b.checkout_paid_at) || ts(a.checkout_created_at) - ts(b.checkout_created_at) || (a.id < b.id ? -1 : 1))[0]
    paidKeepers.push(keeper)
    // só as PAGAS além da primeira são repetidas; uma sem pagamento confirmado
    // espera (o pagamento dela pode chegar e ela ser a mais antiga)
    for (const dup of paid) {
      if (dup.id === keeper.id) continue
      const note = await duplicateNote(deps, dup, keeper)
      const end = await rpc<EndResult>(db, 'billing_end_subscription', { p_id: dup.id, p_source: 'duplicate', p_paid_due_date: null, p_immediate: true, p_stop: 'inactivate', p_note: note })
      actionIds.push(end?.action_id)
      out.duplicates.push(dup.id)
    }
  }

  // com um plano ainda esperando o desempate, a troca entre planos espera junto
  if (paidKeepers.length > 1 && !waiting) {
    const keeper = paidKeepers.slice()
      .sort((a, b) => ts(b.checkout_created_at ?? b.started_at) - ts(a.checkout_created_at ?? a.started_at))[0]
    for (const old of paidKeepers) {
      if (old.id === keeper.id) continue
      let note: string | null = null
      if (!keeper.switch_confirmed) {
        const o = PLAN_PRICING[old.plan_key as PlanKey]
        const n = PLAN_PRICING[keeper.plan_key as PlanKey]
        const until = old.paid_until ? ` pago ate ${brDate(old.paid_until)}` : ''
        note = `troca de plano fora do Alterar Plano: periodo antigo do ${o?.label ?? old.plan_key}${o ? ` (${brl(o.value)})` : ''}${until}; ficou o ${n?.label ?? keeper.plan_key}${n ? ` (${brl(n.value)})` : ''}; avaliar estorno proporcional`
      }
      const end = await rpc<EndResult>(db, 'billing_end_subscription', { p_id: old.id, p_source: 'superseded', p_paid_due_date: null, p_immediate: true, p_note: note })
      actionIds.push(end?.action_id)
      out.superseded.push(old.id)
    }
  }
  await tryPending(deps, actionIds)
  return out
}

function brl(v: number): string {
  return `R$ ${v.toFixed(2).replace('.', ',')}`
}

// Nota da compra repetida, com o id e o link da cobrança quando o Asaas responde.
async function duplicateNote(deps: BillingDeps, dup: SubRow, keeper: SubRow): Promise<string> {
  const base = `compra duplicada: estornar a mao (ficou a ${keeper.id})`
  if (!dup.first_paid_at) return `${base}; esta ainda sem pagamento confirmado, a renovacao foi inativada; se a cobranca for paga, estornar`
  if (!deps.asaas) return `${base}; procurar a cobranca pelo checkout ${dup.id}`
  try {
    const res = await deps.asaas.get<{ data?: AsaasPayment[] }>('/payments', { checkoutSession: dup.id, limit: 10 })
    const pay = (Array.isArray(res?.data) ? res.data : []).find((p) => !p.deleted && PAID_STATUSES.has(p.status ?? '')
      && (!p.checkoutSession || p.checkoutSession === dup.id))
    if (pay) return `${base}; cobranca ${pay.id}${pay.invoiceUrl ? ` ${pay.invoiceUrl}` : ''}`
  } catch (e) {
    if (!(e instanceof AsaasError)) throw e
  }
  return `${base}; procurar a cobranca pelo checkout ${dup.id}`
}

// dd/mm/aaaa do último dia com acesso (o fim guardado é o começo do dia seguinte).
function brDate(accessEnd: string): string {
  const d = brtToday(new Date(Date.parse(accessEnd) - 1000))
  return `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`
}

// ── Cancelamento (botão do app, exclusão da conta e admin) ──

export type CancelResult = {
  result: 'canceled' | 'already_canceled'
  accessUntil: string | null
  refunded: boolean          // estorno automático feito
  refundRequested: boolean   // pedido de estorno pro admin aprovar (não é a 1ª assinatura)
  refundFailed: boolean      // estorno recusado pelo Asaas: o admin faz à mão
  pendingStop: boolean       // parar a recorrência no Asaas ficou pendente (tenta de novo sozinho)
  plan: string
}

type CancelSource = 'user' | 'admin' | 'account_deleted'

async function openStopActions(db: SupabaseClient, userId: string): Promise<number> {
  const { data, error } = await db.from('billing_pending_actions').select('id, action')
    .eq('user_id', userId).eq('status', 'pending').in('action', ['delete_subscription', 'inactivate_subscription'])
  if (error) throw new BillingError('db_error', `Falha no banco (billing_pending_actions): ${error.message}`, 500)
  return ((data as unknown[] | null) ?? []).length
}

type Plan = {
  row: SubRow
  subId: string
  lastPaid: string | null
  withdrawal: ReturnType<typeof withdrawalStatus>
}

// Lê no Asaas o que precisa pra decidir (sem mudar nada).
async function planCancellation(deps: BillingDeps & { asaas: AsaasApi }, userId: string, source: CancelSource): Promise<{ rows: SubRow[]; plans: Plan[]; first: boolean }> {
  const { db, asaas } = deps
  const now = nowOf(deps)
  let rows = await activeRowsForUser(db, userId)
  if (rows.length === 0) {
    const candidates = await legacyCandidates(db, userId)
    if (candidates.length > 0) {
      await adoptLegacySubscriptions(db, asaas, userId, candidates)
      rows = await activeRowsForUser(db, userId)
    }
  }
  const plans: Plan[] = []
  for (const row of rows) {
    const subId = row.asaas_subscription_id ?? await findSubscriptionIdByCheckout(asaas, row.id)
    if (!subId) {
      // Sem o id não dá pra parar a cobrança: não marca nada como cancelado.
      await rpc<null>(db, 'billing_flag_review', { p_id: row.id, p_note: 'cancelamento pedido no app, mas a assinatura nao foi achada no Asaas' })
      throw new BillingError('asaas_rejected',
        'Não achamos sua assinatura no sistema de pagamento para cancelar. Nada foi alterado. Fale com a gente pelo WhatsApp que a gente resolve por lá.', 502)
    }
    const payments = await listSubscriptionPayments(asaas, subId)
    plans.push({ row, subId, lastPaid: latestPaidDueDate(payments), withdrawal: source === 'admin' ? null : withdrawalStatus(payments, now) })
  }
  const first = rows.length > 0 ? await isFirstSubscription(db, userId) : false
  return { rows, plans, first }
}

export async function cancelSubscriptionForUser(
  deps: BillingDeps,
  input: { userId: string; source: CancelSource; immediate?: boolean },
): Promise<CancelResult> {
  const { db } = deps
  const now = nowOf(deps)

  // Pendências velhas deste usuário primeiro (tentativa a cada ação dele).
  try { await runPendingActions(deps, { userId: input.userId, limit: 1 }) } catch (e) {
    console.warn('[billing] pendencias do usuario ficam pro proximo ciclo:', errMsg(e))
  }

  // Sem nada ativo e sem assinatura antiga a achar: não precisa do Asaas.
  const anyActive = (await activeRowsForUser(db, input.userId)).length > 0
  const anyLegacy = !anyActive && (await legacyCandidates(db, input.userId)).length > 0
  if (!anyActive && !anyLegacy) {
    if (input.source === 'account_deleted' && (await openStopActions(db, input.userId)) > 0) {
      throw new BillingError('pending_stop',
        'Sua conta não foi excluída: ainda estamos terminando de cancelar sua assinatura no sistema de pagamento. Tente de novo em alguns minutos.', 409)
    }
    const { data, error } = await db.from('billing_subscriptions').select(SUB_COLS)
      .eq('user_id', input.userId).eq('status', 'canceled')
    if (error) throw new BillingError('db_error', `Falha no banco: ${error.message}`, 500)
    const graced = ((data as SubRow[] | null) ?? [])
      .filter((r) => r.access_until && Date.parse(r.access_until) > now.getTime())
      .sort((a, b) => (a.access_until! < b.access_until! ? 1 : -1))[0]
    if (graced) {
      return { result: 'already_canceled', accessUntil: graced.access_until, refunded: false, refundRequested: false, refundFailed: false, pendingStop: false, plan: graced.plan_key }
    }
    throw new BillingError('not_found',
      'Não encontramos uma assinatura ativa na sua conta. Se aparece cobrança no seu cartão, fale com a gente pelo WhatsApp que a gente resolve.', 404)
  }

  const asaas = deps.asaas
  if (!asaas) throw new BillingError('misconfigured', MSG_MISCONFIGURED, 500)

  // 1. Lê tudo no Asaas ANTES de mudar qualquer coisa.
  let planned: Awaited<ReturnType<typeof planCancellation>>
  try {
    planned = await planCancellation({ ...deps, asaas }, input.userId, input.source)
  } catch (e) {
    if (e instanceof AsaasError) throw new BillingError('asaas_unavailable', MSG_ASAAS_DOWN_NOTHING_CHANGED, 502)
    throw e
  }
  if (planned.rows.length === 0) {
    throw new BillingError('not_found',
      'Não encontramos uma assinatura ativa na sua conta. Se aparece cobrança no seu cartão, fale com a gente pelo WhatsApp que a gente resolve.', 404)
  }

  // 2. Uma assinatura por vez: estorno (se couber), parar no Asaas, registro.
  const out: CancelResult = { result: 'canceled', accessUntil: null, refunded: false, refundRequested: false, refundFailed: false, pendingStop: false, plan: planned.rows[0].plan_key }
  let done = 0
  for (const plan of planned.plans) {
    const { row, subId, withdrawal } = plan
    let refundedNow = false
    let refundFailedNow = false
    const refundRequestNow = !!withdrawal && !withdrawal.alreadyRefunded && !planned.first
    let stage: 'refund' | 'stop' | 'record' = 'refund'
    try {
      // Estorno automático só na primeira assinatura da conta.
      if (withdrawal && !withdrawal.alreadyRefunded && planned.first) {
        try {
          await refundPayment(asaas, withdrawal.payment.id, 'Arrependimento em ate 7 dias (cancelado pelo app)')
          refundedNow = true
        } catch (e) {
          if (e instanceof AsaasError && e.kind === 'rejected') refundFailedNow = true
          else throw e
        }
      }
      // Arrependimento automático (feito, já feito antes ou recusado): Livre na hora.
      const autoWithdrawal = !!withdrawal && planned.first

      stage = 'stop'
      let stopped = false
      try {
        await deleteSubscription(asaas, subId)
        stopped = true
      } catch (e) {
        if (!(e instanceof AsaasError)) throw e
        const nothingYet = !refundedNow && !refundFailedNow && done === 0
        if (nothingYet && input.source !== 'account_deleted' && e.kind === 'unavailable') throw e
        // senão: cancela aqui e a remoção fica pendente (tentada de novo sozinha)
      }

      stage = 'record'
      const source = autoWithdrawal ? 'user_refund' : input.source
      const end = await rpc<EndResult>(db, 'billing_end_subscription', {
        p_id: row.id,
        p_source: source,
        p_paid_due_date: plan.lastPaid,
        p_immediate: autoWithdrawal || !!input.immediate || input.source === 'account_deleted',
        p_stop: 'delete',
        p_already_stopped: stopped,
      })
      if (withdrawal && (refundFailedNow || refundRequestNow)) {
        await rpc<number>(db, 'billing_enqueue_action', {
          p_ref: row.id, p_action: 'refund_payment',
          p_reason: refundFailedNow ? 'estorno_recusado_pelo_asaas' : 'arrependimento_pedido_nao_e_a_primeira_assinatura',
          p_payment_id: withdrawal.payment.id, p_due_date: toBrtDate(withdrawal.payment.dueDate),
          p_amount: num(withdrawal.payment.value), p_auto_retry: false,
        })
      }
      out.refunded ||= refundedNow || (autoWithdrawal && !!withdrawal?.alreadyRefunded)
      out.refundFailed ||= refundFailedNow
      out.refundRequested ||= refundRequestNow
      out.pendingStop ||= !stopped
      const a = end.access_until ?? null
      if (a && (!out.accessUntil || a > out.accessUntil)) out.accessUntil = a
      done++
    } catch (e) {
      console.error('[billing] cancelamento parou', { rowId: row.id, stage, message: errMsg(e) })
      if (stage === 'record') {
        throw new BillingError('partial',
          'Sua assinatura foi cancelada no sistema de pagamento e nada mais será cobrado, mas não conseguimos atualizar sua conta aqui. Tente de novo para ver a data certinha.', 500)
      }
      if (done === 0 && !refundedNow) {
        throw new BillingError('asaas_unavailable', stage === 'refund'
          ? 'Não conseguimos pedir o estorno agora. Nada foi cancelado e nada mudou. Tente de novo em alguns minutos.'
          : MSG_ASAAS_DOWN_NOTHING_CHANGED, 502)
      }
      throw new BillingError('partial',
        'Parte do cancelamento foi feita, mas o sistema de pagamento parou de responder. Tente de novo em alguns minutos para terminar.', 502)
    }
  }

  if (input.source === 'account_deleted' && out.pendingStop) {
    throw new BillingError('pending_stop',
      'Sua conta não foi excluída: a assinatura já foi cancelada aqui, mas o sistema de pagamento ainda não confirmou. Tente de novo em alguns minutos.', 409)
  }
  return out
}

// ── Prévia do cancelamento (texto certo na tela antes de confirmar) ──

export type CancelPreview = {
  outcome: 'none' | 'refund_auto' | 'refund_request' | 'until_period_end'
  plan: string | null
  accessUntil: string | null
  amount: number | null
}

export async function previewCancellation(deps: BillingDeps, userId: string): Promise<CancelPreview> {
  const { db } = deps
  const rows = await activeRowsForUser(db, userId)
  if (rows.length === 0) return { outcome: 'none', plan: null, accessUntil: null, amount: null }
  if (!deps.asaas) throw new BillingError('misconfigured', MSG_MISCONFIGURED, 500)
  const row = rows[0]
  try {
    const subId = row.asaas_subscription_id ?? await findSubscriptionIdByCheckout(deps.asaas, row.id)
    const payments = subId ? await listSubscriptionPayments(deps.asaas, subId) : []
    const withdrawal = withdrawalStatus(payments, nowOf(deps))
    const lastPaid = latestPaidDueDate(payments)
    const amount = num(withdrawal?.payment.value) ?? num(payments.find((p) => toBrtDate(p.dueDate) === lastPaid)?.value)
    if (withdrawal) {
      const first = await isFirstSubscription(db, userId)
      return { outcome: first ? 'refund_auto' : 'refund_request', plan: row.plan_key, accessUntil: null, amount }
    }
    const accessUntil = await rpc<string | null>(db, 'billing_preview_access', { p_id: row.id, p_paid_due_date: lastPaid })
    return { outcome: 'until_period_end', plan: row.plan_key, accessUntil: accessUntil ?? row.paid_until, amount }
  } catch (e) {
    if (e instanceof AsaasError) throw new BillingError('asaas_unavailable', 'Não deu para consultar o sistema de pagamento agora.', 502)
    throw e
  }
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
const SUBSCRIPTION_EVENTS_KEPT = new Set(['SUBSCRIPTION_CREATED', 'SUBSCRIPTION_UPDATED', 'SUBSCRIPTION_INACTIVATED', 'SUBSCRIPTION_DELETED'])

export function isBillingEvent(event: unknown): event is string {
  return event === 'CHECKOUT_PAID'
    || (typeof event === 'string' && (SUBSCRIPTION_EVENTS_KEPT.has(event) || PAYMENT_EVENTS_KEPT.has(event)))
}

// Tira do payload o que não pode ser guardado (cartão, dados do pagador).
export function sanitizeAsaasPayload(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sanitizeAsaasPayload)
  if (!v || typeof v !== 'object') return v
  const out: Record<string, unknown> = {}
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    if (/^creditCard/i.test(k) || k === 'customerData') continue
    out[k] = sanitizeAsaasPayload(val)
  }
  return out
}

export async function handleAsaasEvent(deps: BillingDeps, payload: Record<string, unknown>): Promise<{ result: string }> {
  const event = str(payload.event) ?? ''
  if (event === 'CHECKOUT_PAID') return onCheckoutPaid(deps, obj(payload.checkout), asaasInstant(payload.dateCreated))
  if (SUBSCRIPTION_EVENTS_KEPT.has(event)) return onSubscriptionEvent(deps, event, obj(payload.subscription))
  if (PAYMENT_EVENTS_KEPT.has(event)) return onPaymentEvent(deps, event, obj(payload.payment), asaasInstant(payload.dateCreated))
  return { result: 'ignored' }
}

async function onCheckoutPaid(deps: BillingDeps, checkout: Record<string, unknown>, paidAt: string | null): Promise<{ result: string }> {
  const checkoutId = str(checkout.id)
  let owner = checkoutId ? await checkoutOwner(deps.db, checkoutId) : null
  // Bônus: se o Asaas tiver propagado nosso externalReference ("<user>::<plano>").
  if (!owner && typeof checkout.externalReference === 'string' && checkout.externalReference.includes('::')) {
    const [u, p] = checkout.externalReference.split('::')
    if (UUID_RE.test(u) && isPlanKey(p)) owner = { userId: u, planKey: p, startedAt: null, legacy: false, switchConfirmed: false, checkoutCreatedAt: null }
  }
  if (!owner || !checkoutId) {
    console.warn('[asaas-webhook] could not resolve user/plan', { checkoutId })
    return { result: 'no-ref' }
  }
  const sub = obj(checkout.subscription)
  const out = await activateFromCheckout(deps, {
    checkoutId, userId: owner.userId, planKey: owner.planKey,
    customerId: str(checkout.customer), firstDueDate: toBrtDate(sub.nextDueDate),
    startedAt: paidAt, switchConfirmed: owner.switchConfirmed, checkoutCreatedAt: owner.checkoutCreatedAt,
  })
  return { result: out.result }
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
  const deleted = event === 'SUBSCRIPTION_DELETED' || sub.deleted === true
  const ended = deleted || event === 'SUBSCRIPTION_INACTIVATED'
    || (event === 'SUBSCRIPTION_UPDATED' && (status === 'INACTIVE' || status === 'EXPIRED'))
  if (!ended) {
    await enforceSinglePaid(deps, row.user_id)
    return { result: 'linked' }
  }
  const kind = deleted ? 'deleted' : 'inactivated'

  if (row.status === 'canceled') {
    // nosso próprio corte voltando pelo webhook: confirma que a recorrência parou
    await rpc<null>(deps.db, 'billing_mark_asaas_stopped', { p_id: row.id, p_kind: kind, p_subscription_id: subId })
    return { result: 'already_canceled' }
  }
  // Parou no Asaas (painel ou inativação): plano até o fim do período pago.
  let paidDue: string | null = null
  if (!row.paid_until && deps.asaas) paidDue = latestPaidDueDate(await listSubscriptionPayments(deps.asaas, subId))
  await rpc<EndResult>(deps.db, 'billing_end_subscription', {
    p_id: row.id, p_source: 'asaas', p_paid_due_date: paidDue, p_immediate: false,
    p_stop: deleted ? 'delete' : 'inactivate', p_already_stopped: true,
  })
  return { result: 'ended' }
}

async function recordPayment(deps: BillingDeps, row: SubRow, event: string, p: Record<string, unknown>, eventAt: string | null): Promise<void> {
  // Dados do cartão (creditCard) nunca são guardados.
  await rpc<string>(deps.db, 'billing_record_payment', {
    p_payment_id: str(p.id),
    p_ref: row.id,
    p_user_id: row.user_id,
    p_subscription_id: str(p.subscription) ?? row.asaas_subscription_id,
    p_checkout_id: str(p.checkoutSession) ?? (row.kind === 'asaas' ? row.id : null),
    p_customer_id: str(p.customer) ?? row.asaas_customer_id,
    // Cobrança removida no Asaas (evento PAYMENT_DELETED ou deleted: true no
    // payload): sai das "em aberto" e da rede de segurança.
    p_status: event === 'PAYMENT_DELETED' || p.deleted === true ? 'DELETED' : str(p.status) ?? event.replace(/^PAYMENT_/, ''),
    p_billing_type: str(p.billingType),
    p_value: num(p.value),
    p_net_value: num(p.netValue),
    p_original_value: num(p.originalValue),
    p_interest_value: num(p.interestValue),
    p_due_date: toBrtDate(p.dueDate),
    p_payment_date: toBrtDate(p.paymentDate ?? p.clientPaymentDate),
    p_confirmed_date: toBrtDate(p.confirmedDate),
    p_event: event,
    p_event_at: eventAt ?? nowOf(deps).toISOString(),
    p_original_due_date: toBrtDate(p.originalDueDate),
  })
}

async function onPaymentEvent(deps: BillingDeps, event: string, p: Record<string, unknown>, eventAt: string | null): Promise<{ result: string }> {
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
  await recordPayment(deps, row, event, p, eventAt)
  // Ciclo = vencimento original da cobrança (adiar no painel não muda o ciclo);
  // a data atual decide se o pagamento foi atrasado.
  const real = toBrtDate(p.dueDate)
  const due = toBrtDate(p.originalDueDate) ?? real

  switch (event) {
    case 'PAYMENT_CONFIRMED':
    case 'PAYMENT_RECEIVED': {
      const r = await rpc<EndResult>(deps.db, 'billing_payment_confirmed', { p_id: row.id, p_due_date: due, p_paid_on: paidOn(p), p_real_due: real })
      if (r.result === 'late_payment' || r.result === 'paid_after_cancel' || r.result === 'flagged_closed') {
        console.warn('[asaas-webhook] pagamento marcado pro admin', { rowId: row.id, result: r.result })
      }
      await enforceSinglePaid(deps, row.user_id)
      return { result: r.result }
    }
    case 'PAYMENT_OVERDUE': {
      // a pendência guarda o id da vencida: a remoção das futuras nunca a apaga (COB-R2)
      const r = await rpc<EndResult>(deps.db, 'billing_payment_overdue', { p_id: row.id, p_due_date: due, p_reason: 'vencida', p_payment_id: paymentId })
      await tryPending(deps, [r.action_id])
      return { result: r.result }
    }
    case 'PAYMENT_REFUNDED': {
      const r = await rpc<EndResult>(deps.db, 'billing_payment_refunded', { p_id: row.id, p_due_date: due })
      await tryPending(deps, [r.action_id])
      return { result: r.result }
    }
    case 'PAYMENT_CHARGEBACK_REQUESTED':
    case 'PAYMENT_CHARGEBACK_DISPUTE':
      await rpc<null>(deps.db, 'billing_flag_review', { p_id: row.id, p_note: `chargeback na cobranca ${paymentId}` })
      return { result: 'flagged_chargeback' }
    default:
      await enforceSinglePaid(deps, row.user_id)
      return { result: 'recorded' }
  }
}

// ── Eventos que falharam e job diário ──

const MAX_EVENT_ATTEMPTS = 20

// Reprocessa eventos gravados que não terminaram (Asaas ou rede fora do ar).
export async function retryWebhookEvents(deps: BillingDeps, limit = 20): Promise<{ done: number; failed: number }> {
  const out = { done: 0, failed: 0 }
  const olderThan = new Date(nowOf(deps).getTime() - 2 * 60_000).toISOString()
  const { data, error } = await deps.db.from('asaas_webhook_events').select('id, event, payload, attempts')
    .in('status', ['pending', 'failed']).lt('attempts', MAX_EVENT_ATTEMPTS).lte('received_at', olderThan)
    .order('received_at', { ascending: true }).limit(limit)
  if (error) throw new BillingError('db_error', `Falha no banco (asaas_webhook_events): ${error.message}`, 500)
  for (const ev of (data as { id: string; event: string; payload: unknown; attempts: number }[] | null) ?? []) {
    if ((await processStoredEvent(deps, ev.id, obj(ev.payload), ev.attempts)).ok) out.done++
    else out.failed++
  }
  return out
}

// Processa um evento já gravado e marca o resultado.
export async function processStoredEvent(deps: BillingDeps, id: string, payload: Record<string, unknown>, attempts: number): Promise<{ ok: boolean; result?: string }> {
  try {
    const out = await handleAsaasEvent(deps, payload)
    await deps.db.from('asaas_webhook_events').update({ status: 'done', processed_at: nowOf(deps).toISOString(), attempts: attempts + 1, last_error: null }).eq('id', id)
    return { ok: true, result: out.result }
  } catch (e) {
    // Esgotou as tentativas: fica 'exhausted' (o admin vê) e o job para de tentar.
    const exhausted = attempts + 1 >= MAX_EVENT_ATTEMPTS
    console.warn('[asaas-webhook] evento fica pra nova tentativa', { id, exhausted, message: errMsg(e) })
    await deps.db.from('asaas_webhook_events').update({ status: exhausted ? 'exhausted' : 'failed', attempts: attempts + 1, last_error: errMsg(e).slice(0, 500) }).eq('id', id)
    return { ok: false }
  }
}

// Job diário: o mesmo trabalho do pg_cron (rebaixar e rede de segurança), os
// eventos que falharam e as pendências com o Asaas.
export async function runDailyJob(deps: BillingDeps): Promise<Record<string, unknown>> {
  const db = await rpc<Record<string, unknown>>(deps.db, 'billing_daily_job', {})
  const events = await retryWebhookEvents(deps, 50)
  const pending = await runPendingActions(deps, { limit: 50 })
  return { db, events, pending }
}

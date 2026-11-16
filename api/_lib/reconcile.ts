import {
  AsaasError,
  findSubscriptionIdByCheckout,
  getSubscription,
  listCustomerSubscriptions,
  listSubscriptionPayments,
  type AsaasPayment,
} from './asaas.js'
import { BillingError, PAID_STATUSES, brtToday, toBrtDate, type BillingDeps } from './billing.js'

// Conferência diária entre o app e o Asaas (COB-RECONCILE), pela rota
// GET /api/webhook/asaas?action=reconcile com o mesmo CRON_SECRET do job.
// * No Asaas SÓ LÊ (GET). No banco SÓ MARCA pro admin: billing_flag_review na
//   linha da assinatura, ou um caso admin_review (sem nova tentativa) quando não
//   há linha. Nunca mexe em dinheiro nem em acesso.
// * Folga contra alarme falso: linha mexida nas últimas 2 h não é conferida;
//   pendência ainda tentando há menos de 48 h explica o desencontro; pagamento
//   do dia fica pra amanhã (a data do Asaas não tem hora).
// * Corte de tempo próprio (45 s, dentro dos 60 s da função). Começa num ponto
//   diferente a cada dia, pra que todas sejam conferidas ao longo dos dias.
// * Notas sempre com o mesmo texto pro mesmo caso (billing_flag_review não repete).
// Confere as assinaturas ativas e as encerradas que ainda têm acesso, que não
// têm a parada confirmada ou que foram encerradas ou paradas nos últimos 45 dias.
// Compara:
//   1. status da assinatura: ativa no app e parada no Asaas; encerrada no app e
//      ATIVA no Asaas;
//   2. cobranças: futura em aberto numa assinatura parada (menos a vencida
//      guardada na inativação); pagamento no Asaas que o app não contou;
//      vencimento desencontrado do ciclo em aberto;
//   3. por cliente: mais de uma ATIVA; ATIVA sem registro no app;
//   4. checkouts antigos (payments) sem linha com a assinatura ATIVA no Asaas;
//   5. no banco: eventos esgotados e pendências com muitas tentativas (resumo).

export const RECONCILE_CRON = '0 11 * * *'   // vercel.json (08:00 a 08:59 de Brasília, depois do job)
export const RECONCILE_BUDGET_MS = 45_000
const RECENT_MS = 2 * 3600_000
const PENDING_GRACE_MS = 48 * 3600_000
const STOPPED_LOOKBACK_MS = 45 * 86400_000
const STUCK_ATTEMPTS = 5
const OPEN = new Set(['PENDING', 'OVERDUE', 'AWAITING_RISK_ANALYSIS'])
const STOP_ACTIONS = new Set(['delete_subscription', 'inactivate_subscription'])

type Row = {
  id: string
  user_id: string | null
  status: 'active' | 'canceled'
  asaas_subscription_id: string | null
  asaas_customer_id: string | null
  first_paid_at: string | null
  last_paid_due_date: string | null
  next_due_date: string | null
  access_until: string | null
  canceled_at: string | null
  asaas_stopped_at: string | null
  updated_at: string | null
}
const ROW_COLS = 'id, user_id, status, asaas_subscription_id, asaas_customer_id, first_paid_at, last_paid_due_date, next_due_date, access_until, canceled_at, asaas_stopped_at, updated_at'

type Action = {
  id: number
  subscription_ref: string
  action: string
  status: string
  asaas_payment_id: string | null
  due_date: string | null
  attempts: number | null
  created_at: string | null
}

export type ReconcileResult = {
  total: number
  checked: number
  skippedRecent: number
  flagged: number
  reviews: number
  asaasErrors: number
  partial: boolean
  skipped?: string
  summary: { exhaustedEvents: number; stuckPending: number }
}

function br(d: string): string {
  return `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`
}

async function select<T>(q: PromiseLike<{ data: unknown; error: { message: string } | null }>, table: string): Promise<T[]> {
  const { data, error } = await q
  if (error) throw new BillingError('db_error', `Falha no banco (${table}): ${error.message}`, 500)
  return (data as T[] | null) ?? []
}

export async function runReconcile(deps: BillingDeps, opts: { budgetMs?: number; clock?: () => number } = {}): Promise<ReconcileResult> {
  const { db, asaas } = deps
  const clock = opts.clock ?? (() => Date.now())
  const started = clock()
  const budget = opts.budgetMs ?? RECONCILE_BUDGET_MS
  const nowMs = (deps.now ?? (() => new Date()))().getTime()
  const today = brtToday(new Date(nowMs))
  const ms = (v: string | null | undefined) => (v ? Date.parse(v) : Number.NaN)
  const recent = (v: string | null | undefined) => nowMs - ms(v) < RECENT_MS
  const stillTrying = (a: Action) => a.status === 'pending' && nowMs - ms(a.created_at) < PENDING_GRACE_MS
  const out: ReconcileResult = { total: 0, checked: 0, skippedRecent: 0, flagged: 0, reviews: 0, asaasErrors: 0, partial: false, summary: { exhaustedEvents: 0, stuckPending: 0 } }

  const flag = async (id: string, note: string) => {
    const { error } = await db.rpc('billing_flag_review', { p_id: id, p_note: note })
    if (error) throw new BillingError('db_error', `Falha no banco (billing_flag_review): ${error.message}`, 500)
    out.flagged++
  }
  const review = async (ref: string, reason: string, userId: string | null) => {
    const { error } = await db.rpc('billing_enqueue_action', {
      p_ref: ref, p_action: 'admin_review', p_reason: reason, p_payment_id: null, p_due_date: null, p_amount: null, p_auto_retry: false, p_user_id: userId,
    })
    if (error) throw new BillingError('db_error', `Falha no banco (billing_enqueue_action): ${error.message}`, 500)
    out.reviews++
  }
  const overBudget = () => {
    if (clock() - started > budget) out.partial = true
    return out.partial
  }

  // 5. Resumo do próprio banco (sem Asaas).
  const events = await select<{ id: string }>(db.from('asaas_webhook_events').select('id').eq('status', 'exhausted'), 'asaas_webhook_events')
  const actions = await select<Action>(db.from('billing_pending_actions')
    .select('id, subscription_ref, action, status, asaas_payment_id, due_date, attempts, created_at')
    .in('action', ['delete_subscription', 'inactivate_subscription', 'delete_future_payments']), 'billing_pending_actions')
  out.summary = {
    exhaustedEvents: events.length,
    stuckPending: actions.filter((a) => a.status === 'pending' && Number(a.attempts ?? 0) >= STUCK_ATTEMPTS).length,
  }
  if (!asaas) return { ...out, skipped: 'sem ASAAS_API_KEY' }

  const rows = await select<Row>(db.from('billing_subscriptions').select(ROW_COLS).eq('kind', 'asaas'), 'billing_subscriptions')
  const appIds = new Set(rows.map((r) => r.id))
  const knownSubs = new Set(rows.map((r) => r.asaas_subscription_id).filter((x): x is string => !!x))
  const conferidas = rows.filter((r) => r.status === 'active' || !r.asaas_stopped_at
    || (r.access_until && ms(r.access_until) > nowMs)
    || [r.canceled_at, r.asaas_stopped_at].some((v) => !!v && nowMs - ms(v) < STOPPED_LOOKBACK_MS))
    .sort((a, b) => (a.id < b.id ? -1 : 1))
  out.total = conferidas.length
  const start = conferidas.length ? Math.floor(nowMs / 86400_000) % conferidas.length : 0
  const ordem = [...conferidas.slice(start), ...conferidas.slice(0, start)]

  // 1 e 2. Cada assinatura.
  for (const row of ordem) {
    if (overBudget()) break
    if (recent(row.updated_at)) { out.skippedRecent++; continue }
    try {
      const subId = row.asaas_subscription_id ?? await findSubscriptionIdByCheckout(asaas, row.id)
      out.checked++
      if (!subId) continue
      knownSubs.add(subId)
      const mine = actions.filter((a) => a.subscription_ref === row.id)
      const stopTrying = mine.some((a) => STOP_ACTIONS.has(a.action) && stillTrying(a))
      const removalTrying = mine.some((a) => a.action === 'delete_future_payments' && stillTrying(a))

      const sub = await getSubscription(asaas, subId)
      const asaasActive = !!sub && sub.deleted !== true && sub.status === 'ACTIVE'
      if (row.status === 'active' && !asaasActive) {
        await flag(row.id, `conferencia: ativa no app, mas a assinatura ${subId} esta ${!sub || sub.deleted ? 'removida' : sub.status ?? 'sem status'} no Asaas: a renovacao nao vai ser cobrada`)
      }
      if (row.status === 'canceled' && asaasActive && !stopTrying) {
        await flag(row.id, `conferencia: encerrada no app e ainda ATIVA no Asaas (${subId}): parar a recorrencia a mao`)
      }

      const live = (await listSubscriptionPayments(asaas, subId)).filter((p) => !p.deleted)
      const cycle = (p: AsaasPayment) => toBrtDate(p.originalDueDate) ?? toBrtDate(p.dueDate) ?? ''
      const lastPaid = row.last_paid_due_date ?? ''

      // cobrança futura em aberto numa assinatura parada (menos a vencida guardada)
      if ((row.status === 'canceled' || !asaasActive) && !stopTrying && !removalTrying) {
        const kept = mine.filter((a) => a.action === 'inactivate_subscription').sort((a, b) => b.id - a.id)[0]
        const futures = live.filter((p) => {
          const due = toBrtDate(p.dueDate)
          return p.status === 'PENDING' && !!due && due > today && p.id !== kept?.asaas_payment_id
            && !(kept?.due_date && toBrtDate(p.originalDueDate) === kept.due_date)
        }).map((p) => p.id).sort()
        if (futures.length > 0) await flag(row.id, `conferencia: cobranca futura em aberto numa assinatura parada (${futures.join(', ')}): remover a mao antes de cobrar`)
      }

      // pagamento no Asaas que o app não contou (linha antiga adotada sem último
      // pago conhecido fica fora: pagou antes desta versão)
      if (row.last_paid_due_date || !row.first_paid_at) {
        for (const p of live) {
          const paidDay = toBrtDate(p.confirmedDate ?? p.paymentDate ?? p.clientPaymentDate)
          if (!PAID_STATUSES.has(p.status ?? '') || cycle(p) <= lastPaid || !paidDay || paidDay >= today) continue
          await flag(row.id, `conferencia: pagamento ${p.id} no Asaas (ciclo ${br(cycle(p))}) que o app nao contou`)
        }
      }

      // vencimento desencontrado do ciclo em aberto
      if (row.status === 'active' && row.next_due_date) {
        const open = live.filter((p) => OPEN.has(p.status ?? '') && cycle(p) > lastPaid).sort((a, b) => (cycle(a) < cycle(b) ? -1 : 1))[0]
        const due = open ? toBrtDate(open.dueDate) : null
        if (open && due && due !== row.next_due_date) {
          await flag(row.id, `conferencia: vencimento desencontrado: no app ${br(row.next_due_date)}, no Asaas ${br(due)} (cobranca ${open.id})`)
        }
      }
    } catch (e) {
      if (!(e instanceof AsaasError)) throw e
      out.asaasErrors++
    }
  }

  // 3. Por cliente: mais de uma ATIVA; ATIVA sem registro no app.
  const byCustomer = new Map<string, Row[]>()
  for (const r of rows) if (r.asaas_customer_id) byCustomer.set(r.asaas_customer_id, [...(byCustomer.get(r.asaas_customer_id) ?? []), r])
  for (const [customer, mine] of [...byCustomer.entries()].sort()) {
    if (overBudget()) break
    if (mine.some((r) => recent(r.updated_at))) continue
    try {
      const active = (await listCustomerSubscriptions(asaas, customer)).filter((s) => s.deleted !== true && s.status === 'ACTIVE')
      if (active.length > 1) {
        const ids = active.map((s) => s.id).sort()
        for (const r of mine) {
          if (r.asaas_subscription_id && ids.includes(r.asaas_subscription_id)) {
            await flag(r.id, `conferencia: ${ids.length} assinaturas ATIVAS no Asaas pro mesmo cliente (${ids.join(', ')}): deixar so uma`)
          }
        }
      }
      for (const s of active) {
        if (knownSubs.has(s.id) || (s.checkoutSession && appIds.has(s.checkoutSession))) continue
        await review(`asaas:${s.id}`, `conferencia: assinatura ${s.id} ATIVA no Asaas sem registro no app (cliente ${customer})`, mine[0].user_id)
      }
    } catch (e) {
      if (!(e instanceof AsaasError)) throw e
      out.asaasErrors++
    }
  }

  // 4. Checkouts antigos (payments) sem linha: a assinatura ainda cobra?
  const legacy = await select<{ asaas_checkout_id: unknown; user_id: string | null }>(db.from('payments').select('asaas_checkout_id, user_id'), 'payments')
  for (const p of legacy) {
    const checkout = typeof p.asaas_checkout_id === 'string' ? p.asaas_checkout_id : null
    if (!checkout || appIds.has(checkout)) continue
    if (overBudget()) break
    try {
      const subId = await findSubscriptionIdByCheckout(asaas, checkout)
      if (!subId || knownSubs.has(subId)) continue
      const sub = await getSubscription(asaas, subId)
      if (sub && sub.deleted !== true && sub.status === 'ACTIVE') {
        await review(`asaas:${subId}`, `conferencia: assinatura antiga ${subId} (checkout ${checkout}) ATIVA no Asaas sem registro no app`, p.user_id)
      }
    } catch (e) {
      if (!(e instanceof AsaasError)) throw e
      out.asaasErrors++
    }
  }
  return out
}

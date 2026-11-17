import { AsaasError, getPayment, getSubscription, listSubscriptionPayments, type AsaasApi, type AsaasPayment } from '../asaas.js'
import { BillingError, brtToday, processStoredEvent, runPendingActions, type BillingDeps } from '../billing.js'
import { withAudit } from './audit.js'
import { AdminError, int, oneOf, str, type AdminCtx, type AdminHandlers } from './http.js'

// Pendências (Task 6): a fila da aba Pendências e a baixa em cada item.
// * review: a fila inteira (admin_review_queue, T5), repassada como vem.
// * resolve-flag: confere uma marcação (needs_admin_review). Só no banco: a
//   função SQL grava o registro na mesma transação (D7).
// * close-action: "marcar como feito" à mão só pra estorno, caso pra olhar e
//   remoção de cobrança futura, e o servidor confere no Asaas antes (D8).
//   Inativar ou remover assinatura só fecha quando o Asaas confirma (Tentar
//   agora). Descartar só pra estorno e caso pra olhar. A consulta ao Asaas é só
//   leitura; o registro sai da função SQL, na mesma transação do fechamento.
// * retry-action e retry-event: falam com o Asaas, então withAudit grava o
//   pendente antes e o resultado depois.
// * payment-link: a fatura da cobrança no Asaas (só leitura).
// Nenhum caminho estorna: o estorno é feito no painel do Asaas (FATOS).

const MSG_FLAG_NOT_FOUND = 'Marcação não encontrada.'
const MSG_FLAG_DONE = 'Esta marcação já foi conferida.'
const MSG_NOT_OPEN = 'Esta pendência já foi fechada.'
const MSG_STOP_BY_ASAAS = 'Esta pendência se resolve sozinha quando o Asaas confirmar. Use Tentar agora.'
const MSG_NOT_DISCARDABLE = 'Só estorno e caso pra olhar podem ser descartados.'
const MSG_STILL_CHARGING = 'O Asaas ainda cobra esta assinatura. Pare a cobrança no painel do Asaas antes de fechar.'
const MSG_CHECK_DOWN = 'Não deu pra conferir no Asaas agora. Nada foi marcado.'
const MSG_NO_PAYMENT_ID = 'Esta pendência não guarda o id da cobrança, então não dá pra conferir no Asaas. Nada foi marcado.'
const MSG_NO_SUBSCRIPTION = 'Esta pendência não guarda a assinatura do Asaas, então não dá pra conferir as cobranças futuras. Nada foi marcado.'
const MSG_NOT_AUTO = 'Esta pendência não é tentada sozinha.'
const MSG_EVENT_NOT_FOUND = 'Aviso não encontrado.'
const MSG_EVENT_DONE = 'Este aviso já foi processado.'
const MSG_ASAAS_SILENT = 'O Asaas não respondeu agora.'

const paymentNotFound = (id: string): string => `O Asaas não achou a cobrança ${id}.`

// Ações que só o Asaas fecha (a parada vale quando o Asaas aceita).
const STOP_ACTIONS = new Set(['delete_subscription', 'inactivate_subscription'])
// Ações que o admin pode descartar ("Não vou estornar", caso pra olhar).
const DISCARDABLE = new Set(['refund_payment', 'admin_review'])
const REFUND_DONE_STATUSES = new Set(['REFUNDED', 'REFUND_REQUESTED', 'REFUND_IN_PROGRESS'])
// Caso da conferência diária: assinatura ATIVA no Asaas sem registro no app.
const ASAAS_CASE_PREFIX = 'asaas:'

const PAY_ID_RE = /^pay_[A-Za-z0-9]+$/
// Id do aviso como o webhook grava: o do Asaas (evt_<hash>&<número>) ou sha:<hex>.
const EVENT_ID_RE = /^[\x21-\x7E]+$/
const MAX_ID = Number.MAX_SAFE_INTEGER

// ── Nome do status da cobrança: cópia no servidor da tabela de
// paymentStatusLabel (src/admin/lib/fmt.ts, T4), pras frases do 409.

const PAYMENT_STATUS_NAMES: Record<string, string> = {
  PENDING: 'em aberto',
  CONFIRMED: 'confirmada',
  RECEIVED: 'recebida',
  RECEIVED_IN_CASH: 'recebida em dinheiro',
  OVERDUE: 'vencida',
  REFUNDED: 'estornada',
  REFUND_REQUESTED: 'estorno pedido',
  REFUND_IN_PROGRESS: 'estorno em andamento',
  DELETED: 'removida',
  CHARGEBACK_REQUESTED: 'contestação',
}

// Status novo do Asaas sai em minúsculas, como no front; texto que não tem
// cara de status (vem de fora) não entra na frase.
export function paymentStatusName(status: string): string {
  if (Object.hasOwn(PAYMENT_STATUS_NAMES, status)) return PAYMENT_STATUS_NAMES[status]
  return /^[A-Z_]{1,40}$/.test(status) ? status.toLowerCase() : 'sem dado'
}

// ── Cobranças futuras em aberto: as mesmas três condições de
// removeFuturePendingCharges (api/_lib/asaas.ts), sem remover nada:
// em aberto (PENDING, sem deleted), vencendo depois de hoje, e fora da vencida
// guardada (id) e do ciclo cortado (vencimento original ou atual igual ao
// ciclo). Assim o 409 nunca manda remover a cobrança que tem que ficar pagável.

export function futurePendingCharges(
  payments: AsaasPayment[],
  keep: { paymentId: string | null; cycleDue: string | null },
  today: string,
): AsaasPayment[] {
  const day = (v: unknown) => (typeof v === 'string' ? v.slice(0, 10) : '')
  return payments.filter((p) => {
    const due = day(p.dueDate)
    if (p.deleted || p.status !== 'PENDING' || !due || due <= today) return false
    if (keep.paymentId && p.id === keep.paymentId) return false
    if (keep.cycleDue && (day(p.originalDueDate) === keep.cycleDue || due === keep.cycleDue)) return false
    return true
  })
}

// ── Banco

type ActionRow = {
  id: number
  subscription_ref: string
  user_id: string | null
  action: string
  status: string
  auto_retry: boolean
  attempts: number
  last_error: string | null
  asaas_subscription_id: string | null
  asaas_payment_id: string | null
  due_date: string | null
}
const ACTION_COLS = 'id, subscription_ref, user_id, action, status, auto_retry, attempts, last_error, asaas_subscription_id, asaas_payment_id, due_date'

type EventRow = { id: string; event: string; status: string; attempts: number; last_error: string | null; payload: unknown }

const dbError = (where: string, message: string): BillingError => new BillingError('db_error', `Falha no banco (${where}): ${message}`, 500)

async function rpc<T>(ctx: AdminCtx, name: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await ctx.db.rpc(name, args)
  if (error) throw dbError(name, error.message)
  return data as T
}

async function readAction(ctx: AdminCtx, id: number): Promise<ActionRow | null> {
  const { data, error } = await ctx.db.from('billing_pending_actions').select(ACTION_COLS).eq('id', id).maybeSingle()
  if (error) throw dbError('billing_pending_actions', error.message)
  return (data as ActionRow | null) ?? null
}

async function readEvent(ctx: AdminCtx, id: string): Promise<EventRow | null> {
  const { data, error } = await ctx.db.from('asaas_webhook_events').select('id, event, status, attempts, last_error, payload').eq('id', id).maybeSingle()
  if (error) throw dbError('asaas_webhook_events', error.message)
  return (data as EventRow | null) ?? null
}

async function subscriptionIdOf(ctx: AdminCtx, a: ActionRow): Promise<string | null> {
  if (a.asaas_subscription_id) return a.asaas_subscription_id
  const { data, error } = await ctx.db.from('billing_subscriptions').select('asaas_subscription_id').eq('id', a.subscription_ref).maybeSingle()
  if (error) throw dbError('billing_subscriptions', error.message)
  const id = (data as { asaas_subscription_id?: unknown } | null)?.asaas_subscription_id
  return typeof id === 'string' && id ? id : null
}

// ── Asaas

// Sem ASAAS_API_KEY: o roteador responde a frase de configuração incompleta e
// o detalhe fica no log.
function needAsaas(ctx: AdminCtx): AsaasApi {
  if (!ctx.asaas) throw new BillingError('misconfigured', 'Pendências: servidor sem ASAAS_API_KEY.', 500)
  return ctx.asaas
}

function logAsaas(where: string, e: AsaasError): void {
  console.error(`[admin] ${where}: Asaas falhou (${e.kind}, status ${e.status ?? 'sem dado'}):`, e.message.slice(0, 200))
}

const billingDeps = (ctx: AdminCtx, asaas: AsaasApi | null): BillingDeps => ({ db: ctx.db, asaas, now: () => ctx.now })

// Frase do 409 quando o Asaas mostra que ainda não dá pra fechar; null libera.
async function refundRefusal(asaas: AsaasApi, a: ActionRow): Promise<string | null> {
  const id = a.asaas_payment_id
  if (!id) return MSG_NO_PAYMENT_ID
  const p = await getPayment(asaas, id)
  if (!p) return paymentNotFound(id)
  if (REFUND_DONE_STATUSES.has(p.status ?? '')) return null
  return `O Asaas mostra a cobrança ${id} como ${paymentStatusName(p.status ?? '')}. Estorne no painel do Asaas antes de marcar como feito.`
}

async function removalRefusal(ctx: AdminCtx, asaas: AsaasApi, a: ActionRow): Promise<string | null> {
  const subId = await subscriptionIdOf(ctx, a)
  if (!subId) return MSG_NO_SUBSCRIPTION
  const payments = await listSubscriptionPayments(asaas, subId)
  const left = futurePendingCharges(payments, { paymentId: a.asaas_payment_id, cycleDue: a.due_date }, brtToday(ctx.now))
  if (left.length === 0) return null
  return `Ainda há cobrança futura em aberto no Asaas: ${left.map((p) => p.id).join(', ')}. Remova no painel antes de marcar como feito.`
}

// Caso asaas:<id> nunca volta a ser criado depois de fechado (Q12 da
// cobrança): só fecha se o Asaas já não cobra mais.
async function stillChargingRefusal(asaas: AsaasApi, a: ActionRow): Promise<string | null> {
  const subId = a.subscription_ref.slice(ASAAS_CASE_PREFIX.length)
  if (!subId) return null
  const s = await getSubscription(asaas, subId)
  return s && s.deleted !== true && s.status === 'ACTIVE' ? MSG_STILL_CHARGING : null
}

async function checkBeforeClosing(ctx: AdminCtx, a: ActionRow, outcome: 'done' | 'canceled'): Promise<void> {
  const asaasCase = a.action === 'admin_review' && a.subscription_ref.startsWith(ASAAS_CASE_PREFIX)
  const check = asaasCase ? stillChargingRefusal
    : outcome === 'done' && a.action === 'refund_payment' ? refundRefusal
    : outcome === 'done' && a.action === 'delete_future_payments' ? (api: AsaasApi, x: ActionRow) => removalRefusal(ctx, api, x)
    : null
  if (!check) return
  const asaas = needAsaas(ctx)
  let refusal: string | null
  try {
    refusal = await check(asaas, a)
  } catch (e) {
    if (!(e instanceof AsaasError)) throw e
    logAsaas('close-action', e)
    throw new AdminError(502, MSG_CHECK_DOWN)
  }
  if (refusal) throw new AdminError(409, refusal)
}

const actionState = (a: ActionRow) => ({ status: a.status, attempts: a.attempts, lastError: a.last_error })

const payloadOf = (v: unknown): Record<string, unknown> => (typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {})

const httpsUrl = (v: unknown): string | null => (typeof v === 'string' && /^https:\/\/\S+$/.test(v) ? v : null)

// ── Ações

export const handlers: AdminHandlers = {
  review: {
    method: 'GET',
    fields: [],
    run: (ctx) => rpc<unknown>(ctx, 'admin_review_queue', {}),
  },

  'payment-link': {
    method: 'GET',
    fields: ['id'],
    run: async (ctx) => {
      const id = str(ctx.query, 'id', { label: 'o id da cobrança', max: 100, pattern: PAY_ID_RE })
      const asaas = needAsaas(ctx)
      let p: AsaasPayment | null
      try {
        p = await getPayment(asaas, id)
      } catch (e) {
        if (!(e instanceof AsaasError)) throw e
        logAsaas('payment-link', e)
        throw new AdminError(502, MSG_ASAAS_SILENT)
      }
      if (!p) throw new AdminError(404, paymentNotFound(id))
      return { paymentId: id, status: typeof p.status === 'string' ? p.status : null, invoiceUrl: httpsUrl(p.invoiceUrl) }
    },
  },

  'resolve-flag': {
    method: 'POST',
    fields: ['subscriptionRef', 'note'],
    run: async (ctx) => {
      const ref = str(ctx.body, 'subscriptionRef', { label: 'a marcação', max: 200 })
      const note = str(ctx.body, 'note', { label: 'a nota', min: 3, max: 500 })
      const result = await rpc<string>(ctx, 'admin_resolve_flag', { p_admin: ctx.admin.userId, p_subscription_ref: ref, p_note: note })
      if (result === 'resolved') return { result: 'resolved' }
      if (result === 'not_found') throw new AdminError(404, MSG_FLAG_NOT_FOUND)
      if (result === 'not_flagged') throw new AdminError(409, MSG_FLAG_DONE)
      throw new Error(`admin_resolve_flag devolveu ${String(result).slice(0, 40)}`)
    },
  },

  'close-action': {
    method: 'POST',
    fields: ['actionId', 'outcome', 'note'],
    run: async (ctx) => {
      const id = int(ctx.body, 'actionId', { label: 'a pendência', min: 1, max: MAX_ID })
      const outcome = oneOf(ctx.body, 'outcome', ['done', 'canceled'] as const, { label: 'o resultado' })
      const note = str(ctx.body, 'note', { label: 'a nota', min: 3, max: 500 })
      const a = await readAction(ctx, id)
      if (!a || a.status !== 'pending') throw new AdminError(409, MSG_NOT_OPEN)
      if (STOP_ACTIONS.has(a.action)) throw new AdminError(409, MSG_STOP_BY_ASAAS)
      if (outcome === 'canceled' && !DISCARDABLE.has(a.action)) throw new AdminError(409, MSG_NOT_DISCARDABLE)
      await checkBeforeClosing(ctx, a, outcome)
      const result = await rpc<string>(ctx, 'admin_close_action', { p_admin: ctx.admin.userId, p_action_id: id, p_outcome: outcome, p_note: note })
      if (result === 'closed') return { result: 'closed' }
      if (result === 'not_open') throw new AdminError(409, MSG_NOT_OPEN)
      if (result === 'not_allowed') throw new AdminError(409, MSG_NOT_DISCARDABLE)
      throw new Error(`admin_close_action devolveu ${String(result).slice(0, 40)}`)
    },
  },

  'retry-action': {
    method: 'POST',
    fields: ['actionId'],
    run: async (ctx) => {
      const id = int(ctx.body, 'actionId', { label: 'a pendência', min: 1, max: MAX_ID })
      const a = await readAction(ctx, id)
      if (!a || a.status !== 'pending') throw new AdminError(409, MSG_NOT_OPEN)
      if (!a.auto_retry) throw new AdminError(409, MSG_NOT_AUTO)
      const asaas = needAsaas(ctx)
      return withAudit(
        ctx,
        { action: 'retry_action', targetUserId: a.user_id, targetRef: String(id), before: { action: a.action, ...actionState(a) } },
        async () => {
          // Erro do Asaas não lança: fica gravado na pendência (tentativas e último erro).
          await runPendingActions(billingDeps(ctx, asaas), { ids: [id], limit: 1 })
          const now = await readAction(ctx, id)
          if (!now) throw dbError('billing_pending_actions', `pendencia ${id} sumiu depois da tentativa`)
          return actionState(now)
        },
        (state) => state,
      )
    },
  },

  'retry-event': {
    method: 'POST',
    fields: ['eventId'],
    run: async (ctx) => {
      const eventId = str(ctx.body, 'eventId', { label: 'o aviso', max: 200, pattern: EVENT_ID_RE })
      const ev = await readEvent(ctx, eventId)
      if (!ev) throw new AdminError(404, MSG_EVENT_NOT_FOUND)
      if (ev.status === 'done') throw new AdminError(409, MSG_EVENT_DONE)
      return withAudit(
        ctx,
        { action: 'retry_event', targetRef: eventId, before: { event: ev.event, status: ev.status, attempts: ev.attempts, lastError: ev.last_error } },
        async () => {
          const reset = await rpc<string>(ctx, 'admin_reset_event', { p_admin: ctx.admin.userId, p_event_id: eventId })
          if (reset === 'not_found') throw new AdminError(404, MSG_EVENT_NOT_FOUND)
          if (reset === 'already_done') throw new AdminError(409, MSG_EVENT_DONE)
          if (reset !== 'reset') throw new Error(`admin_reset_event devolveu ${String(reset).slice(0, 40)}`)
          // Como o webhook: com ou sem a chave do Asaas, quem decide é o processamento.
          const out = await processStoredEvent(billingDeps(ctx, ctx.asaas), eventId, payloadOf(ev.payload), 0)
          return { processed: out.ok, result: out.result ?? null }
        },
        (r) => r,
      )
    },
  },
}

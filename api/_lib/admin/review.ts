import { AsaasError, getPayment, getSubscription, listSubscriptionPayments, type AsaasApi, type AsaasPayment } from '../asaas.js'
import { BillingError, brtToday, processStoredEvent, runPendingActions, type BillingDeps } from '../billing.js'
import { withAudit } from './audit.js'
import { AdminError, int, oneOf, str, type AdminCtx, type AdminHandlers } from './http.js'

// Pendências (Task 6): a fila da aba Pendências e a baixa em cada item.
// * review: a fila inteira (admin_review_queue, T5), repassada como vem, só
//   com o último erro de cada item em frase pronta (lastErrorLabel).
// * resolve-flag: confere uma marcação (needs_admin_review). Só no banco: a
//   função SQL grava o registro na mesma transação (D7). Recebe a versão da
//   marcação que o admin viu (Ruling ADM-T5-visto), com a hora obrigatória e
//   a nota que pode vir nula (Ruling ADM-T5T6-nulo): se chegou marcação nova
//   enquanto a lista estava aberta, responde { result: 'changed' } e nada muda.
// * close-action: "marcar como feito" à mão só pra estorno, caso pra olhar e
//   remoção de cobrança futura, e o servidor confere no Asaas antes (D8).
//   Inativar ou remover assinatura só fecha quando o Asaas confirma (Tentar
//   agora). Descartar só pra estorno e caso pra olhar. A consulta ao Asaas é só
//   leitura; o registro sai da função SQL, na mesma transação do fechamento.
// * retry-action e retry-event: falam com o Asaas, então withAudit grava o
//   pendente antes e o resultado depois.
// * payment-link: a fatura da cobrança no Asaas (só leitura).
// Nenhum caminho estorna: o estorno é feito no painel do Asaas (FATOS).
// O texto cru do último erro (last_error) fica só no banco: tudo que sai
// daqui (resposta e registro) passa por lastErrorLabel (Ruling ADM-T6-lastError).

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
const MSG_SEEN_MISSING = 'Falta a versão da marcação que você viu. Atualize a lista e tente de novo.'
const MSG_SEEN_NOTE_BAD = 'A versão da marcação está em formato inválido.'
const MSG_ASAAS_CASE_NO_ID = 'Esta pendência não guarda a assinatura do Asaas, então não dá pra conferir se ela ainda cobra. Nada foi marcado.'
const MSG_ASAAS_DOUBT = 'Não deu pra confirmar no Asaas que esta assinatura parou de cobrar. Confira no painel do Asaas antes de fechar.'
const MSG_ACTION_ID_BAD = 'A pendência está em formato inválido.'
const MSG_UNEXPECTED = 'Erro inesperado no servidor.'

const paymentNotFound = (id: string): string => `O Asaas não achou a cobrança ${id}.`

// Ações que só o Asaas fecha (a parada vale quando o Asaas aceita).
const STOP_ACTIONS = new Set(['delete_subscription', 'inactivate_subscription'])
// Ações que o admin pode descartar ("Não vou estornar", caso pra olhar).
const DISCARDABLE = new Set(['refund_payment', 'admin_review'])
const REFUND_DONE_STATUSES = new Set(['REFUNDED', 'REFUND_REQUESTED', 'REFUND_IN_PROGRESS'])
// Caso da conferência diária: assinatura ATIVA no Asaas sem registro no app.
const ASAAS_CASE_PREFIX = 'asaas:'
// Status da assinatura no Asaas que provam que ela parou de cobrar.
const SUBSCRIPTION_STOPPED = new Set(['INACTIVE', 'EXPIRED'])

const PAY_ID_RE = /^pay_[A-Za-z0-9]+$/
// Id do aviso como o webhook grava: o do Asaas (evt_<hash>&<número>) ou sha:<hex>.
const EVENT_ID_RE = /^[\x21-\x7E]+$/
// A nota da marcação cresce a cada marcação nova (" | "); teto folgado só pra
// não aceitar corpo absurdo.
const MAX_SEEN_NOTE = 50000
// Instante como o Postgres devolve o timestamptz no JSON (com até 6 casas e o fuso).
const INSTANT_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/

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

// ── Último erro de pendência ou aviso (last_error) em frase pronta (Ruling
// ADM-T6-lastError). O texto cru (com a descrição do Asaas ou do banco) fica
// só no banco e no log. Mapa fechado: as formas do cliente do Asaas
// (toAsaasError) e a remoção recusada da Fase 3 (Ruling
// ADM-T6-lastError-mapa); o resto vira a frase genérica. A T7 usa a mesma
// função ao ler o Registro.

const ASAAS_REFUSED_RE = /^Asaas recusou \((\d{3})\)/
const ASAAS_DOWN_STATUS_RE = /^Asaas respondeu (\d{3})$/
const REMOVAL_REFUSED_PREFIX = 'Asaas recusou remover '

// "Asaas recusou remover <ids>" (runPendingActions): os ids ajudam o dono a
// achar as cobranças no painel, e só passam se todos têm cara de id de cobrança.
function removalRefusedLabel(ids: string): string {
  const list = ids.split(', ')
  return list.every((id) => PAY_ID_RE.test(id))
    ? `O Asaas recusou remover as cobranças futuras: ${list.join(', ')}.`
    : 'O Asaas recusou remover as cobranças futuras.'
}

export function lastErrorLabel(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null
  if (typeof raw !== 'string') return MSG_UNEXPECTED
  if (raw.startsWith('Asaas sem resposta')) return 'O Asaas não respondeu.'
  const down = ASAAS_DOWN_STATUS_RE.exec(raw)
  if (down) return `O Asaas não respondeu. Status do Asaas: ${down[1]}.`
  const refused = ASAAS_REFUSED_RE.exec(raw)
  if (refused) return `O Asaas recusou o pedido. Status do Asaas: ${refused[1]}.`
  if (raw.startsWith(REMOVAL_REFUSED_PREFIX)) return removalRefusedLabel(raw.slice(REMOVAL_REFUSED_PREFIX.length))
  return MSG_UNEXPECTED
}

// A fila com o lastError de cada item de cada lista (ações e avisos) em frase
// pronta; o resto passa como veio.
function queueWithLabels(queue: unknown): unknown {
  if (typeof queue !== 'object' || queue === null || Array.isArray(queue)) return queue
  const label = (item: unknown): unknown => (typeof item === 'object' && item !== null && Object.hasOwn(item, 'lastError')
    ? { ...item, lastError: lastErrorLabel((item as { lastError: unknown }).lastError) }
    : item)
  return Object.fromEntries(Object.entries(queue).map(([key, value]) => [key, Array.isArray(value) ? value.map(label) : value]))
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
// cobrança): só fecha com prova de que o Asaas parou (Ruling
// ADM-T6-asaas-duvida): 404, removida (deleted true) ou status INACTIVE ou
// EXPIRED. Sem o id, resposta sem status ou status que não se conhece, não fecha.
async function stillChargingRefusal(asaas: AsaasApi, a: ActionRow): Promise<string | null> {
  const subId = a.subscription_ref.slice(ASAAS_CASE_PREFIX.length)
  if (!subId) return MSG_ASAAS_CASE_NO_ID
  const s: unknown = await getSubscription(asaas, subId)
  if (s === null) return null
  if (typeof s !== 'object' || Array.isArray(s)) return MSG_ASAAS_DOUBT
  const { deleted, status } = s as { deleted?: unknown; status?: unknown }
  if (deleted === true) return null
  if (typeof status === 'string' && SUBSCRIPTION_STOPPED.has(status)) return null
  return status === 'ACTIVE' ? MSG_STILL_CHARGING : MSG_ASAAS_DOUBT
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

// ── Versão da marcação que o admin viu (Ruling ADM-T5-visto). Vai pro banco
// exatamente como chegou (sem tirar espaços): é comparada com a do banco.

// adminNote da fila: texto ou null (marcação sem nota). O campo é obrigatório.
function seenNote(src: Record<string, unknown>): string | null {
  if (!Object.hasOwn(src, 'seenNote')) throw new AdminError(400, MSG_SEEN_MISSING)
  const v = src.seenNote
  if (v === null) return null
  if (typeof v !== 'string' || Array.from(v).length > MAX_SEEN_NOTE) throw new AdminError(400, MSG_SEEN_NOTE_BAD)
  return v
}

// updatedAt da fila: instante ISO que existe no calendário. Obrigatório
// (Ruling ADM-T5T6-nulo): updated_at nunca é nulo, e sem a hora vista o banco
// responderia changed pra sempre. Ausente, nulo ou vazio: a frase de versão faltando.
function seenAt(src: Record<string, unknown>): string {
  const raw = str(src, 'seenAt', { label: 'o instante da marcação', optional: true, max: 40, pattern: INSTANT_RE })
  if (raw === null) throw new AdminError(400, MSG_SEEN_MISSING)
  const [y, mo, d, h, mi, se] = INSTANT_RE.exec(raw)!.slice(1, 7).map(Number)
  const t = new Date(Date.UTC(y, mo - 1, d))
  const realDay = t.getUTCFullYear() === y && t.getUTCMonth() === mo - 1 && t.getUTCDate() === d
  if (!realDay || h > 23 || mi > 59 || se > 59) throw new AdminError(400, 'O instante da marcação está em formato inválido.')
  return raw
}

// Id da pendência (bigserial). A frase do int citaria o teto, um número que
// não diz nada pro admin (Minor 3 da T6).
function actionIdOf(body: Record<string, unknown>): number {
  try {
    return int(body, 'actionId', { label: 'a pendência', min: 1, max: Number.MAX_SAFE_INTEGER })
  } catch (e) {
    if (e instanceof AdminError) throw new AdminError(400, MSG_ACTION_ID_BAD)
    throw e
  }
}

// Estado da pendência pra resposta e pro registro, com o último erro em frase pronta.
const actionState = (a: ActionRow) => ({ status: a.status, attempts: a.attempts, lastError: lastErrorLabel(a.last_error) })

const payloadOf = (v: unknown): Record<string, unknown> => (typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {})

const httpsUrl = (v: unknown): string | null => (typeof v === 'string' && /^https:\/\/\S+$/.test(v) ? v : null)

// ── Ações

export const handlers: AdminHandlers = {
  review: {
    method: 'GET',
    fields: [],
    run: async (ctx) => queueWithLabels(await rpc<unknown>(ctx, 'admin_review_queue', {})),
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
    fields: ['subscriptionRef', 'note', 'seenNote', 'seenAt'],
    run: async (ctx) => {
      const ref = str(ctx.body, 'subscriptionRef', { label: 'a marcação', max: 200 })
      const note = str(ctx.body, 'note', { label: 'a nota', min: 3, max: 500 })
      const shownNote = seenNote(ctx.body)
      const shownAt = seenAt(ctx.body)
      const result = await rpc<string>(ctx, 'admin_resolve_flag', {
        p_admin: ctx.admin.userId, p_subscription_ref: ref, p_note: note, p_seen_note: shownNote, p_seen_at: shownAt,
      })
      if (result === 'resolved') return { result: 'resolved' }
      // Não é erro: a tela avisa que a marcação mudou e recarrega a lista (T8).
      if (result === 'changed') return { result: 'changed' }
      if (result === 'not_found') throw new AdminError(404, MSG_FLAG_NOT_FOUND)
      if (result === 'not_flagged') throw new AdminError(409, MSG_FLAG_DONE)
      throw new Error(`admin_resolve_flag devolveu ${String(result).slice(0, 40)}`)
    },
  },

  'close-action': {
    method: 'POST',
    fields: ['actionId', 'outcome', 'note'],
    run: async (ctx) => {
      const id = actionIdOf(ctx.body)
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
      const id = actionIdOf(ctx.body)
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
        { action: 'retry_event', targetRef: eventId, before: { event: ev.event, status: ev.status, attempts: ev.attempts, lastError: lastErrorLabel(ev.last_error) } },
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

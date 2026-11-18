import {
  AsaasError,
  findSubscriptionIdByCheckout,
  getSubscription,
  listCustomerSubscriptions,
  listSubscriptionPayments,
  type AsaasApi,
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
// * Corte de tempo próprio, dentro dos 60 s da função: nenhuma consulta ao
//   Asaas começa depois de 40 s e cada uma tem teto de 5 s (o pior caso termina
//   antes de 45 s, COB-PRE). Consulta que estoura o teto conta como erro do
//   Asaas. Erro do Asaas numa unidade não a conta como conferida e deixa a
//   conferência parcial, com marcação pro admin. A unidade de
//   trabalho é o CLIENTE do Asaas (as assinaturas dele e a lista de assinaturas
//   dele) e cada checkout antigo sem linha. Cada unidade tem um dia fixo numa volta
//   de RECONCILE_EVERY_DAYS dias (pelo id): as do dia vêm primeiro (parte
//   garantida) e, com o tempo que sobrar, as outras, começando num ponto
//   diferente a cada dia. Assim cada cliente é conferido pelo menos a cada 7 dias.
//   Conta: no pior caso 3 GET de 0,5 s por cliente, 1,5 s; 40 s cobrem uns 26
//   clientes por dia, então a volta de 7 dias fecha até uns 180 clientes (menos,
//   se o sorteio dos dias ficar desigual). Se a parte garantida do dia não couber,
//   ou se o Asaas der erro, a conferência parcial vira marcação pro admin (caso
//   admin_review do dia).
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
export const RECONCILE_BUDGET_MS = 40_000          // nenhuma consulta começa depois disso
export const RECONCILE_REQUEST_TIMEOUT_MS = 5_000  // teto de cada consulta ao Asaas
export const RECONCILE_EVERY_DAYS = 7
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
  total: number            // assinaturas na conferência
  checked: number          // assinaturas conferidas hoje
  skippedRecent: number
  customers: { total: number; checked: number; guaranteed: number }
  flagged: number
  reviews: number
  asaasErrors: number
  partial: boolean         // o tempo acabou antes de conferir todas as unidades
  guaranteeMissed: boolean // nem as unidades do dia (parte garantida) couberam
  skipped?: string
  summary: { exhaustedEvents: number; stuckPending: number }
}

function br(d: string): string {
  return `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`
}

// FNV-1a: dia fixo de cada unidade na volta de N dias.
function slotOf(key: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < key.length; i++) { h ^= key.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0 }
  return h % RECONCILE_EVERY_DAYS
}

async function select<T>(q: PromiseLike<{ data: unknown; error: { message: string } | null }>, table: string): Promise<T[]> {
  const { data, error } = await q
  if (error) throw new BillingError('db_error', `Falha no banco (${table}): ${error.message}`, 500)
  return (data as T[] | null) ?? []
}

type Unit = { key: string; customer: string | null; rows: Row[] } | { key: string; checkout: string; userId: string | null }

// O tempo acabou: nenhuma consulta nova ao Asaas.
class BudgetCut extends Error {}

// Asaas da conferência: só GET (escrever lança), sem começar consulta depois do
// corte e com teto por consulta (estourar o teto vira erro do Asaas).
function readOnlyAsaas(api: AsaasApi, canStart: () => boolean, timeoutMs: number): AsaasApi {
  const forbid = () => Promise.reject(new Error('a conferencia nao escreve no Asaas'))
  return {
    get: <T>(path: string, params?: Record<string, string | number | boolean>): Promise<T> => {
      if (!canStart()) return Promise.reject(new BudgetCut('corte de tempo'))
      let timer: ReturnType<typeof setTimeout> | undefined
      const ceiling = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new AsaasError('unavailable', `Asaas sem resposta em ${timeoutMs} ms`)), timeoutMs)
      })
      return Promise.race([api.get<T>(path, params), ceiling]).finally(() => clearTimeout(timer))
    },
    post: forbid,
    put: forbid,
    del: forbid,
  }
}

export async function runReconcile(deps: BillingDeps, opts: { budgetMs?: number; clock?: () => number; requestTimeoutMs?: number } = {}): Promise<ReconcileResult> {
  const { db } = deps
  const clock = opts.clock ?? (() => Date.now())
  const started = clock()
  const budget = opts.budgetMs ?? RECONCILE_BUDGET_MS
  const nowMs = (deps.now ?? (() => new Date()))().getTime()
  const today = brtToday(new Date(nowMs))
  const dayNumber = Math.floor(nowMs / 86400_000)
  const ms = (v: string | null | undefined) => (v ? Date.parse(v) : Number.NaN)
  const recent = (v: string | null | undefined) => nowMs - ms(v) < RECENT_MS
  const stillTrying = (a: Action) => a.status === 'pending' && nowMs - ms(a.created_at) < PENDING_GRACE_MS
  const out: ReconcileResult = {
    total: 0, checked: 0, skippedRecent: 0, customers: { total: 0, checked: 0, guaranteed: 0 },
    flagged: 0, reviews: 0, asaasErrors: 0, partial: false, guaranteeMissed: false, summary: { exhaustedEvents: 0, stuckPending: 0 },
  }

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
  const overBudget = () => clock() - started > budget
  const asaas = deps.asaas ? readOnlyAsaas(deps.asaas, () => !overBudget(), opts.requestTimeoutMs ?? RECONCILE_REQUEST_TIMEOUT_MS) : null

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
  const rowsById = new Map(rows.map((r) => [r.id, r]))
  const rowBySub = new Map<string, Row>()
  for (const r of rows) if (r.asaas_subscription_id) rowBySub.set(r.asaas_subscription_id, r)
  const stopTryingFor = (rowId: string) => actions.some((a) => a.subscription_ref === rowId && STOP_ACTIONS.has(a.action) && stillTrying(a))
  const isConferida = (r: Row) => r.status === 'active' || !r.asaas_stopped_at
    || (!!r.access_until && ms(r.access_until) > nowMs)
    || [r.canceled_at, r.asaas_stopped_at].some((v) => !!v && nowMs - ms(v) < STOPPED_LOOKBACK_MS)
  out.total = rows.filter(isConferida).length

  // Unidades: cada cliente do Asaas (linha sem cliente vira unidade própria) e
  // cada checkout antigo (payments) sem linha.
  const byCustomer = new Map<string, Row[]>()
  for (const r of rows) {
    const key = r.asaas_customer_id ? `cliente:${r.asaas_customer_id}` : `linha:${r.id}`
    byCustomer.set(key, [...(byCustomer.get(key) ?? []), r])
  }
  const units: Unit[] = [...byCustomer.entries()].map(([key, rs]) => ({ key, customer: rs[0].asaas_customer_id, rows: rs }))
  const legacy = await select<{ asaas_checkout_id: unknown; user_id: string | null }>(db.from('payments').select('asaas_checkout_id, user_id'), 'payments')
  const legacyUser = new Map<string, string | null>()
  for (const p of legacy) {
    const checkout = typeof p.asaas_checkout_id === 'string' ? p.asaas_checkout_id : null
    if (checkout && !rowsById.has(checkout)) {
      units.push({ key: `checkout:${checkout}`, checkout, userId: p.user_id })
      legacyUser.set(checkout, p.user_id)
    }
  }
  units.sort((a, b) => (a.key < b.key ? -1 : 1))
  const todaySlot = dayNumber % RECONCILE_EVERY_DAYS
  const guaranteed = units.filter((u) => slotOf(u.key) === todaySlot)
  const rest = units.filter((u) => slotOf(u.key) !== todaySlot)
  const start = rest.length ? (dayNumber * 7919) % rest.length : 0
  const ordem = [...guaranteed, ...rest.slice(start), ...rest.slice(0, start)]
  out.customers = { total: units.length, checked: 0, guaranteed: guaranteed.length }

  // 1 e 2. Cada assinatura conferida.
  const checkRow = async (row: Row) => {
    const subId = row.asaas_subscription_id ?? await findSubscriptionIdByCheckout(asaas, row.id)
    out.checked++
    if (!subId) return
    rowBySub.set(subId, row)
    const mine = actions.filter((a) => a.subscription_ref === row.id)
    const stopTrying = stopTryingFor(row.id)
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
    const uncounted = live.filter((p) => PAID_STATUSES.has(p.status ?? '') && cycle(p) > lastPaid)
    if (row.last_paid_due_date || !row.first_paid_at) {
      for (const p of uncounted) {
        const paidDay = toBrtDate(p.confirmedDate ?? p.paymentDate ?? p.clientPaymentDate)
        if (!paidDay || paidDay >= today) continue
        await flag(row.id, `conferencia: pagamento ${p.id} no Asaas (ciclo ${br(cycle(p))}) que o app nao contou`)
      }
    }

    // vencimento desencontrado do ciclo em aberto. Com pagamento ainda não
    // contado (inclusive o do dia), espera: o vencimento do app anda quando o
    // aviso for contado (COB-FINAL, T3).
    if (row.status === 'active' && row.next_due_date && uncounted.length === 0) {
      const open = live.filter((p) => OPEN.has(p.status ?? '') && cycle(p) > lastPaid).sort((a, b) => (cycle(a) < cycle(b) ? -1 : 1))[0]
      const due = open ? toBrtDate(open.dueDate) : null
      if (open && due && due !== row.next_due_date) {
        await flag(row.id, `conferencia: vencimento desencontrado: no app ${br(row.next_due_date)}, no Asaas ${br(due)} (cobranca ${open.id})`)
      }
    }
  }

  // 3. A lista de assinaturas do cliente: mais de uma ATIVA da MESMA conta do
  // app; ATIVA sem registro no app. Tira da conta a que tem pendência de parar
  // ainda tentando (folga de 48 h) e não junta contas diferentes que pagaram com
  // o mesmo CPF (COB-FINAL, T4).
  const checkCustomer = async (customer: string, mine: Row[]) => {
    const rowOf = (s: { id: string; checkoutSession?: string | null }) => rowBySub.get(s.id) ?? (s.checkoutSession ? rowsById.get(s.checkoutSession) : undefined)
    const active = (await listCustomerSubscriptions(asaas, customer))
      .filter((s) => s.deleted !== true && s.status === 'ACTIVE')
      .filter((s) => { const r = rowOf(s); return !(r && stopTryingFor(r.id)) })
    const byUser = new Map<string, { sub: string; row: Row }[]>()
    for (const s of active) {
      const r = rowOf(s)
      if (!r || !r.user_id) continue
      byUser.set(r.user_id, [...(byUser.get(r.user_id) ?? []), { sub: s.id, row: r }])
    }
    for (const list of byUser.values()) {
      if (list.length < 2) continue
      const ids = list.map((x) => x.sub).sort()
      for (const x of list) await flag(x.row.id, `conferencia: ${ids.length} assinaturas ATIVAS no Asaas pro mesmo cliente (${ids.join(', ')}): deixar so uma`)
    }
    // a conta: a do checkout antigo dessa assinatura, se for de um (mesmo CPF,
    // outra conta, COB-PRE d); senão a única conta do cliente; senão nenhuma
    const users = [...new Set(mine.map((r) => r.user_id).filter((u): u is string => !!u))]
    for (const s of active) {
      if (rowOf(s)) continue
      const userId = s.checkoutSession && legacyUser.has(s.checkoutSession) ? legacyUser.get(s.checkoutSession) ?? null : users.length === 1 ? users[0] : null
      await review(`asaas:${s.id}`, `conferencia: assinatura ${s.id} ATIVA no Asaas sem registro no app (cliente ${customer})`, userId)
    }
  }

  // 4. Checkout antigo sem linha: a assinatura ainda cobra?
  const checkLegacy = async (checkout: string, userId: string | null) => {
    const subId = await findSubscriptionIdByCheckout(asaas, checkout)
    if (!subId || rowBySub.has(subId)) return
    const sub = await getSubscription(asaas, subId)
    if (sub && sub.deleted !== true && sub.status === 'ACTIVE') {
      await review(`asaas:${subId}`, `conferencia: assinatura antiga ${subId} (checkout ${checkout}) ATIVA no Asaas sem registro no app`, userId)
    }
  }

  let guaranteedDone = 0
  const stop = (i: number) => {
    out.partial = true
    if (i < guaranteed.length) out.guaranteeMissed = true
  }
  for (const [i, u] of ordem.entries()) {
    if (overBudget()) { stop(i); break }
    let cut = false
    try {
      if ('checkout' in u) {
        await checkLegacy(u.checkout, u.userId)
      } else {
        for (const r of u.rows.filter(isConferida)) {
          if (overBudget()) { cut = true; break }
          if (recent(r.updated_at)) { out.skippedRecent++; continue }
          await checkRow(r)
        }
        if (!cut && u.customer && !u.rows.some((r) => recent(r.updated_at))) await checkCustomer(u.customer, u.rows)
      }
    } catch (e) {
      if (e instanceof BudgetCut) { stop(i); break }
      if (!(e instanceof AsaasError)) throw e
      // não conta como conferida e a conferência fica parcial (COB-PRE b)
      out.asaasErrors++
      out.partial = true
      continue
    }
    if (cut) { stop(i); break }
    out.customers.checked++
    if (i < guaranteed.length) guaranteedDone++
  }

  // Parcial na parte garantida (a volta de 7 dias não fecha) ou com erro do
  // Asaas: vira marcação pro admin (um caso por dia), não só linha de log.
  if (out.guaranteeMissed || out.asaasErrors > 0) {
    const why = [
      out.guaranteeMissed ? `o tempo acabou com ${guaranteedDone} de ${guaranteed.length} clientes do dia conferidos` : null,
      out.asaasErrors > 0 ? `${out.asaasErrors} erro${out.asaasErrors > 1 ? 's' : ''} do Asaas (unidade nao conferida)` : null,
    ].filter(Boolean).join('; ')
    await review(`conferencia:parcial:${today}`,
      `conferencia diaria parcial: ${why} (${out.customers.checked} de ${units.length} conferidos); a volta de ${RECONCILE_EVERY_DAYS} dias pode nao fechar, ver o Asaas, o tempo da funcao ou dividir a conferencia`,
      null)
  }
  return out
}

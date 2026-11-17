import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRes, type FakeDb, type FakeRes, type Row } from './fakeSupabase.js'
import { USER_A, USER_B, asaasDown, createBillingDb, createFakeAsaas, payment, subRow, type FakeAsaas } from './billingHarness.js'
import { AsaasError, removeFuturePendingCharges, type AsaasPayment } from '../_lib/asaas.js'
import { processStoredEvent, runPendingActions } from '../_lib/billing.js'
import { createAdminRouter } from '../_lib/admin/http.js'
import { futurePendingCharges, handlers, paymentStatusName } from '../_lib/admin/review.js'

// Servidor das pendências (Task 6): a fila, as marcações e as pendências da
// cobrança, e a baixa nelas. "Marcar como feito" à mão só vale pra estorno,
// caso pra olhar e remoção de cobrança futura, e o servidor confere no Asaas
// antes (D8). Inativar ou remover assinatura só fecha quando o Asaas confirma.
// O SQL das funções admin_* é da T5; aqui o contrato vai por setRpc, com um
// modelo das mesmas regras. Asaas só por mock.

const ADMIN_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const NOW = new Date('2026-11-16T15:00:00Z') // 12:00 em Brasília, dia 16/11/2026
const TRAVESSAO = String.fromCharCode(0x2014)
const PARTIAL_REF = 'conferencia:parcial:2026-11-16'

const MSG = {
  notOpen: 'Esta pendência já foi fechada.',
  stopByAsaas: 'Esta pendência se resolve sozinha quando o Asaas confirmar. Use Tentar agora.',
  notDiscardable: 'Só estorno e caso pra olhar podem ser descartados.',
  stillCharging: 'O Asaas ainda cobra esta assinatura. Pare a cobrança no painel do Asaas antes de fechar.',
  checkDown: 'Não deu pra conferir no Asaas agora. Nada foi marcado.',
  notAuto: 'Esta pendência não é tentada sozinha.',
  eventDone: 'Este aviso já foi processado.',
  noLog: 'Não deu pra registrar a ação no histórico, então nada foi feito.',
  misconfigured: 'Configuração do servidor incompleta. Avise o suporte.',
}

let db: FakeDb
let asaas: FakeAsaas | null
let fakes: FakeAsaas[]
let responses: FakeRes[]
let logId: number

vi.mock('../_lib/auth.js', () => ({
  verifyAdmin: vi.fn(async () => ({ ok: true, userId: ADMIN_ID, email: 'admin@igreja.com', isAdmin: true, blocked: false })),
}))
vi.mock('@supabase/supabase-js', () => ({ createClient: vi.fn(() => db) }))
vi.mock('../_lib/asaas.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('../_lib/asaas.js')>()
  return { ...real, asaasFromEnv: vi.fn(() => asaas) }
})
vi.mock('../_lib/billing.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('../_lib/billing.js')>()
  return { ...real, runPendingActions: vi.fn(real.runPendingActions), processStoredEvent: vi.fn(real.processStoredEvent) }
})

const router = createAdminRouter(handlers)

function setAsaas(routes: Parameters<typeof createFakeAsaas>[0] = {}): FakeAsaas {
  const fake = createFakeAsaas(routes)
  fakes.push(fake)
  asaas = fake
  return fake
}

async function call(method: string, action: string, input: { query?: Record<string, unknown>; body?: unknown } = {}): Promise<FakeRes> {
  const res = createRes()
  await router({ method, query: { action, ...(input.query ?? {}) }, headers: { authorization: 'Bearer admin' }, body: input.body }, res)
  responses.push(res)
  return res
}
const post = (action: string, body: unknown) => call('POST', action, { body })
const get = (action: string, query: Record<string, unknown> = {}) => call('GET', action, { query })

function pendingAction(over: Partial<Row> & { id: number; action: string }): Row {
  return {
    subscription_ref: 'chk_1', user_id: USER_A, reason: 'vencida', asaas_subscription_id: 'sub_1', asaas_payment_id: null,
    due_date: null, amount: null, auto_retry: true, status: 'pending', attempts: 0, last_error: null,
    next_attempt_at: '2026-11-16T14:00:00.000Z', created_at: '2026-11-16T14:00:00.000Z', done_at: null, done_note: null,
    ...over,
  }
}

// 3 estorno à mão; 4 remoção das cobranças futuras (a vencida pay_5 guardada);
// 6 caso da conferência diária (assinatura ativa no Asaas sem registro no app);
// 7 inativação que tenta sozinha; 8 conferência parcial do dia (sem conta);
// 9 remoção da assinatura que tenta sozinha.
function seedActions(): Row[] {
  return [
    pendingAction({ id: 3, action: 'refund_payment', reason: 'estorno_recusado_pelo_asaas', asaas_payment_id: 'pay_3', due_date: '2026-11-10', amount: 49.9, auto_retry: false }),
    pendingAction({ id: 4, action: 'delete_future_payments', asaas_payment_id: 'pay_5', due_date: '2026-11-10' }),
    pendingAction({ id: 6, action: 'admin_review', subscription_ref: 'asaas:sub_9', user_id: USER_B, asaas_subscription_id: null, auto_retry: false,
      reason: 'conferencia: assinatura sub_9 ATIVA no Asaas sem registro no app (cliente cus_9)' }),
    pendingAction({ id: 7, action: 'inactivate_subscription', asaas_payment_id: 'pay_5', due_date: '2026-11-10' }),
    pendingAction({ id: 8, action: 'admin_review', subscription_ref: PARTIAL_REF, user_id: null, asaas_subscription_id: null, auto_retry: false,
      reason: 'conferencia diaria parcial: 2 erros do Asaas (unidade nao conferida) (8 de 10 conferidos)' }),
    pendingAction({ id: 9, action: 'delete_subscription', reason: 'refund' }),
  ]
}

const EVENT_PAYLOAD = {
  id: 'evt_1', event: 'PAYMENT_CONFIRMED', dateCreated: '2026-11-10 10:00:00',
  payment: { object: 'payment', id: 'pay_10', subscription: 'sub_2', customer: 'cus_2', status: 'CONFIRMED', value: 49.9, netValue: 47.91,
    billingType: 'CREDIT_CARD', dueDate: '2026-11-10', confirmedDate: '2026-11-10' },
}

// Modelo das funções da T5 (db/supabase_admin_base.sql) com as mesmas respostas.
function installAdminSql(target: FakeDb): void {
  target.setRpc('admin_log_start', () => ++logId)
  target.setRpc('admin_log_finish', () => null)
  target.setRpc('admin_resolve_flag', (a) => {
    const r = target.tables.billing_subscriptions.find((x) => x.id === a.p_subscription_ref)
    if (!r) return 'not_found'
    if (!r.needs_admin_review) return 'not_flagged'
    r.needs_admin_review = false
    r.admin_note = [r.admin_note, `conferido pelo admin em 16/11/2026: ${String(a.p_note)}`].filter(Boolean).join(' | ')
    return 'resolved'
  })
  target.setRpc('admin_close_action', (a) => {
    const x = target.tables.billing_pending_actions.find((y) => y.id === a.p_action_id)
    if (!x || x.status !== 'pending') return 'not_open'
    if (x.action === 'delete_subscription' || x.action === 'inactivate_subscription') return 'not_allowed'
    if (a.p_outcome === 'canceled' && x.action !== 'refund_payment' && x.action !== 'admin_review') return 'not_allowed'
    Object.assign(x, { status: a.p_outcome, done_at: NOW.toISOString(), done_note: `admin: ${String(a.p_note)}` })
    return 'closed'
  })
  target.setRpc('admin_reset_event', (a) => {
    const e = target.tables.asaas_webhook_events.find((y) => y.id === a.p_event_id)
    if (!e) return 'not_found'
    if (e.status === 'done') return 'already_done'
    Object.assign(e, { status: 'failed', attempts: 0, last_error: 'reiniciado pelo admin' })
    return 'reset'
  })
}

const rpcNames = () => db.rpcCalls.map((c) => c.name)
const actionRow = (id: number) => db.tables.billing_pending_actions.find((x) => x.id === id)!
const asaasCalls = (fake: FakeAsaas | null = asaas) => (fake ? [...fake.get.mock.calls, ...fake.post.mock.calls, ...fake.put.mock.calls, ...fake.del.mock.calls] : [])

beforeEach(() => {
  vi.useFakeTimers({ now: NOW, toFake: ['Date'] })
  vi.stubEnv('VITE_SUPABASE_URL', 'https://fake.supabase.co')
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'fake-service-role')
  vi.clearAllMocks()
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  logId = 40
  fakes = []
  responses = []
  db = createBillingDb({
    billing_subscriptions: [
      subRow({ id: 'chk_1', user_id: USER_A, asaas_subscription_id: 'sub_1', status: 'canceled', cancel_source: 'unpaid', access_until: '2026-11-11T03:00:00.000Z',
        needs_admin_review: true, admin_note: 'cobranca vencida paga depois (vencimento 2026-11-10)' }),
      subRow({ id: 'chk_2', user_id: USER_B, asaas_subscription_id: 'sub_2', admin_note: 'conferido pelo admin em 10/11/2026: ok' }),
    ],
    billing_pending_actions: seedActions(),
    asaas_webhook_events: [
      { id: 'evt_1', event: 'PAYMENT_CONFIRMED', payload: EVENT_PAYLOAD, status: 'exhausted', attempts: 20, last_error: 'Asaas sem resposta (ECONNRESET)', received_at: '2026-11-10T13:00:00.000Z' },
      { id: 'evt_2', event: 'PAYMENT_CONFIRMED', payload: { ...EVENT_PAYLOAD, id: 'evt_2' }, status: 'done', attempts: 1, last_error: null, received_at: '2026-11-10T13:05:00.000Z' },
    ],
  })
  installAdminSql(db)
  setAsaas()
})

afterEach(() => {
  // Nenhuma ação estorna: nenhum caminho do Asaas com /refund, em nenhum teste.
  for (const fake of fakes) {
    for (const [path] of asaasCalls(fake) as [string][]) expect(String(path)).not.toMatch(/refund/i)
  }
  for (const res of responses) expect(JSON.stringify(res.body ?? null).includes(TRAVESSAO)).toBe(false)
  vi.useRealTimers()
  vi.unstubAllEnvs()
})

describe('fila de pendências', () => {
  it('GET review repassa a fila', async () => {
    // A conferência diária chega por billing_flag_review (marcação) e por
    // admin_review sem tentativa sozinha, inclusive a parcial do dia sem conta.
    const queue = {
      actions: [{
        id: 8, action: 'admin_review', reason: 'conferencia diaria parcial: 2 erros do Asaas', autoRetry: false, attempts: 0, lastError: null,
        nextAttemptAt: '2026-11-16T14:00:00Z', createdAt: '2026-11-16T14:00:00Z', subscriptionRef: PARTIAL_REF, asaasSubscriptionId: null,
        paymentId: null, dueDate: null, amount: null, userId: null, email: null, planKey: null,
      }],
      flags: [{ subscriptionRef: 'chk_1', userId: USER_A, email: 'a@igreja.com', planKey: 'essencial_mensal', kind: 'asaas', status: 'canceled',
        cancelSource: 'unpaid', adminNote: 'conferencia: cobranca vencida em aberto', updatedAt: '2026-11-16T09:00:00Z' }],
      events: [{ id: 'evt_1', event: 'PAYMENT_CONFIRMED', status: 'exhausted', attempts: 20, lastError: 'x', receivedAt: '2026-11-10T13:00:00Z' }],
      counts: { manual: 3, auto: 0, total: 3 },
      generatedAt: '2026-11-16T15:00:00Z',
    }
    db.setRpc('admin_review_queue', () => queue)
    const res = await get('review')
    expect(res.statusCode).toBe(200)
    expect(res.body).toEqual(queue)
    expect(db.rpcCalls).toEqual([{ name: 'admin_review_queue', args: {} }])
    expect(asaasCalls()).toEqual([])
  })

  it('erro de banco na fila vira 500 sem detalhe', async () => {
    db.setRpc('admin_review_queue', () => { throw new Error('relation "billing_pending_actions" does not exist') })
    const res = await get('review')
    expect(res.statusCode).toBe(500)
    expect(res.body).toEqual({ error: 'Erro inesperado no servidor.' })
  })

  it('review não aceita campo na query', async () => {
    const res = await get('review', { page: '1' })
    expect(res.statusCode).toBe(400)
    expect(res.body).toEqual({ error: 'Campo não esperado: page.' })
    expect(rpcNames()).toEqual([])
  })
})

describe('conferir marcação (resolve-flag)', () => {
  it('conferir tira a marcação com a nota do admin', async () => {
    const res = await post('resolve-flag', { subscriptionRef: 'chk_1', note: '  falei com o cliente  ' })
    expect(res.statusCode).toBe(200)
    expect(res.body).toEqual({ result: 'resolved' })
    expect(db.rpcCalls).toEqual([{ name: 'admin_resolve_flag', args: { p_admin: ADMIN_ID, p_subscription_ref: 'chk_1', p_note: 'falei com o cliente' } }])
    // só no banco: a própria função grava o registro na mesma transação (D7)
    expect(rpcNames()).not.toContain('admin_log_start')
  })

  it('conferir com nota curta responde 400', async () => {
    const res = await post('resolve-flag', { subscriptionRef: 'chk_1', note: 'ok' })
    expect(res.statusCode).toBe(400)
    expect(res.body).toEqual({ error: 'A nota precisa ter pelo menos 3 caracteres.' })
    const long = await post('resolve-flag', { subscriptionRef: 'chk_1', note: 'a'.repeat(501) })
    expect(long.body).toEqual({ error: 'A nota pode ter no máximo 500 caracteres.' })
    const ref = await post('resolve-flag', { subscriptionRef: 'x'.repeat(201), note: 'conferido' })
    expect(ref.statusCode).toBe(400)
    const missing = await post('resolve-flag', { subscriptionRef: 'chk_1' })
    expect(missing.body).toEqual({ error: 'Preencha a nota.' })
    expect(rpcNames()).toEqual([])
  })

  it('conferir já conferida responde 409', async () => {
    const res = await post('resolve-flag', { subscriptionRef: 'chk_2', note: 'conferido de novo' })
    expect(res.statusCode).toBe(409)
    expect(res.body).toEqual({ error: 'Esta marcação já foi conferida.' })
  })

  it('conferir marcação que não existe responde 404', async () => {
    const res = await post('resolve-flag', { subscriptionRef: 'chk_404', note: 'conferido' })
    expect(res.statusCode).toBe(404)
    expect(res.body).toEqual({ error: 'Marcação não encontrada.' })
  })
})

describe('fechar pendência à mão (close-action)', () => {
  const close = (actionId: number, outcome: string, note = 'estornei hoje') => post('close-action', { actionId, outcome, note })

  it('estorno marcado como feito com a cobrança CONFIRMED no Asaas responde 409 com "confirmada" e não fecha', async () => {
    setAsaas({ get: (path) => (path === '/payments/pay_3' ? payment({ id: 'pay_3', status: 'CONFIRMED' }) : {}) })
    const res = await close(3, 'done')
    expect(res.statusCode).toBe(409)
    expect(res.body).toEqual({ error: 'O Asaas mostra a cobrança pay_3 como confirmada. Estorne no painel do Asaas antes de marcar como feito.' })
    expect(rpcNames()).not.toContain('admin_close_action')
    expect(actionRow(3).status).toBe('pending')
  })

  it('estorno com REFUNDED no Asaas fecha', async () => {
    setAsaas({ get: (path) => (path === '/payments/pay_3' ? payment({ id: 'pay_3', status: 'REFUNDED' }) : {}) })
    const res = await close(3, 'done')
    expect(res.statusCode).toBe(200)
    expect(res.body).toEqual({ result: 'closed' })
    expect(asaas!.get).toHaveBeenCalledWith('/payments/pay_3')
    expect(db.rpcCalls.find((c) => c.name === 'admin_close_action')?.args).toEqual({ p_admin: ADMIN_ID, p_action_id: 3, p_outcome: 'done', p_note: 'estornei hoje' })
    expect(actionRow(3)).toMatchObject({ status: 'done', done_note: 'admin: estornei hoje' })
  })

  it('estorno pedido ou em andamento no Asaas também fecha', async () => {
    for (const status of ['REFUND_REQUESTED', 'REFUND_IN_PROGRESS']) {
      db.tables.billing_pending_actions = seedActions()
      setAsaas({ get: () => payment({ id: 'pay_3', status }) })
      const res = await close(3, 'done')
      expect(res.body, status).toEqual({ result: 'closed' })
    }
  })

  it('estorno com getPayment nulo responde 409 sem fechar', async () => {
    setAsaas({ get: () => { throw new AsaasError('not_found', 'não encontrado no Asaas', 404) } })
    const res = await close(3, 'done')
    expect(res.statusCode).toBe(409)
    expect(res.body).toEqual({ error: 'O Asaas não achou a cobrança pay_3.' })
    expect(rpcNames()).not.toContain('admin_close_action')
    expect(actionRow(3).status).toBe('pending')
  })

  it('estorno sem o id da cobrança não fecha como feito', async () => {
    actionRow(3).asaas_payment_id = null
    const res = await close(3, 'done')
    expect(res.statusCode).toBe(409)
    expect(asaasCalls()).toEqual([])
    expect(actionRow(3).status).toBe('pending')
  })

  it('descartar estorno ("Não vou estornar") fecha sem consultar o Asaas', async () => {
    const res = await close(3, 'canceled', 'cliente desistiu do estorno')
    expect(res.body).toEqual({ result: 'closed' })
    expect(asaasCalls()).toEqual([])
    expect(actionRow(3)).toMatchObject({ status: 'canceled', done_note: 'admin: cliente desistiu do estorno' })
  })

  it('remoção marcada como feita com pay_9 PENDING vencendo 2026-12-16 responde 409 citando pay_9', async () => {
    setAsaas({ get: (path) => (path === '/payments' ? { data: [
      payment({ id: 'pay_5', status: 'PENDING', dueDate: '2026-11-10' }),
      payment({ id: 'pay_9', status: 'PENDING', dueDate: '2026-12-16', confirmedDate: null }),
    ], hasMore: false } : {}) })
    const res = await close(4, 'done', 'removi no painel')
    expect(res.statusCode).toBe(409)
    expect(res.body).toEqual({ error: 'Ainda há cobrança futura em aberto no Asaas: pay_9. Remova no painel antes de marcar como feito.' })
    expect(asaas!.get).toHaveBeenCalledWith('/payments', { subscription: 'sub_1', limit: 100, offset: 0 })
    expect(rpcNames()).not.toContain('admin_close_action')
    expect(actionRow(4).status).toBe('pending')
  })

  it('remoção com várias futuras em aberto cita todas separadas por vírgula', async () => {
    setAsaas({ get: () => ({ data: [
      payment({ id: 'pay_9', status: 'PENDING', dueDate: '2026-12-16' }),
      payment({ id: 'pay_19', status: 'PENDING', dueDate: '2027-01-16' }),
    ], hasMore: false }) })
    const res = await close(4, 'done', 'removi no painel')
    expect(res.body).toEqual({ error: 'Ainda há cobrança futura em aberto no Asaas: pay_9, pay_19. Remova no painel antes de marcar como feito.' })
  })

  it('remoção só com a vencida protegida em aberto fecha', async () => {
    // pay_5 é a vencida da decisão de inativar: adiada pro dia 20, continua fora da conta
    setAsaas({ get: () => ({ data: [
      payment({ id: 'pay_1', status: 'CONFIRMED', dueDate: '2026-10-10' }),
      payment({ id: 'pay_5', status: 'PENDING', dueDate: '2026-11-20', originalDueDate: '2026-11-05' }),
      payment({ id: 'pay_11', status: 'PENDING', dueDate: '2026-12-10', deleted: true }),
    ], hasMore: false }) })
    const res = await close(4, 'done', 'removi no painel')
    expect(res.statusCode).toBe(200)
    expect(res.body).toEqual({ result: 'closed' })
    expect(actionRow(4)).toMatchObject({ status: 'done', done_note: 'admin: removi no painel' })
  })

  it('cobrança do ciclo cortado adiada pro futuro não é cobrada do admin', async () => {
    // sem o id guardado: quem protege é o ciclo (vencimento original igual ao da pendência)
    actionRow(4).asaas_payment_id = null
    setAsaas({ get: () => ({ data: [
      payment({ id: 'pay_8', status: 'PENDING', originalDueDate: '2026-11-10', dueDate: '2026-12-20' }),
    ], hasMore: false }) })
    const res = await close(4, 'done', 'removi no painel')
    expect(res.statusCode).toBe(200)
    expect(res.body).toEqual({ result: 'closed' })
  })

  it('remoção sem a assinatura na pendência usa a da assinatura no app', async () => {
    actionRow(4).asaas_subscription_id = null
    setAsaas({ get: () => ({ data: [], hasMore: false }) })
    const res = await close(4, 'done', 'removi no painel')
    expect(res.body).toEqual({ result: 'closed' })
    expect(asaas!.get).toHaveBeenCalledWith('/payments', { subscription: 'sub_1', limit: 100, offset: 0 })
  })

  it('remoção sem assinatura do Asaas em lugar nenhum não fecha', async () => {
    actionRow(4).asaas_subscription_id = null
    db.tables.billing_subscriptions[0].asaas_subscription_id = null
    const res = await close(4, 'done', 'removi no painel')
    expect(res.statusCode).toBe(409)
    expect(asaasCalls()).toEqual([])
    expect(actionRow(4).status).toBe('pending')
  })

  it('inativação não fecha à mão (nem a remoção da assinatura)', async () => {
    for (const id of [7, 9]) {
      for (const outcome of ['done', 'canceled']) {
        const res = await close(id, outcome, 'resolvi no painel')
        expect(res.statusCode, `${id} ${outcome}`).toBe(409)
        expect(res.body, `${id} ${outcome}`).toEqual({ error: MSG.stopByAsaas })
      }
    }
    expect(asaasCalls()).toEqual([])
    expect(rpcNames()).not.toContain('admin_close_action')
    expect(actionRow(7).status).toBe('pending')
    expect(actionRow(9).status).toBe('pending')
  })

  it('descartar remoção de cobrança futura responde 409', async () => {
    const res = await close(4, 'canceled', 'nao vou remover')
    expect(res.statusCode).toBe(409)
    expect(res.body).toEqual({ error: MSG.notDiscardable })
    expect(asaasCalls()).toEqual([])
    expect(actionRow(4).status).toBe('pending')
  })

  it('not_allowed do banco vira a mesma frase do descarte', async () => {
    db.setRpc('admin_close_action', () => 'not_allowed')
    const res = await close(3, 'canceled', 'nao vou estornar')
    expect(res.statusCode).toBe(409)
    expect(res.body).toEqual({ error: MSG.notDiscardable })
  })

  it('caso asaas: com a assinatura ACTIVE no Asaas não fecha', async () => {
    setAsaas({ get: (path) => (path === '/subscriptions/sub_9' ? { id: 'sub_9', status: 'ACTIVE', deleted: false } : {}) })
    for (const outcome of ['done', 'canceled']) {
      const res = await close(6, outcome, 'conferi no painel')
      expect(res.statusCode, outcome).toBe(409)
      expect(res.body, outcome).toEqual({ error: MSG.stillCharging })
    }
    expect(asaas!.get).toHaveBeenCalledWith('/subscriptions/sub_9')
    expect(rpcNames()).not.toContain('admin_close_action')
    expect(actionRow(6).status).toBe('pending')
  })

  it('caso asaas: com a assinatura removida fecha', async () => {
    setAsaas({ get: () => { throw new AsaasError('not_found', 'não encontrado no Asaas', 404) } })
    const res = await close(6, 'done', 'parei no painel')
    expect(res.body).toEqual({ result: 'closed' })
    expect(actionRow(6)).toMatchObject({ status: 'done', done_note: 'admin: parei no painel' })
  })

  it('caso asaas: removida (deleted) ou inativa no Asaas também fecha, como feito ou descartado', async () => {
    const cases: [Record<string, unknown>, string][] = [
      [{ id: 'sub_9', status: 'ACTIVE', deleted: true }, 'done'],
      [{ id: 'sub_9', status: 'INACTIVE', deleted: false }, 'canceled'],
      [{ id: 'sub_9', status: 'EXPIRED' }, 'done'],
    ]
    for (const [sub, outcome] of cases) {
      db.tables.billing_pending_actions = seedActions()
      setAsaas({ get: () => sub })
      const res = await close(6, outcome, 'parei no painel')
      expect(res.body, JSON.stringify(sub)).toEqual({ result: 'closed' })
    }
  })

  it('caso da conferência parcial do dia fecha sem consultar o Asaas', async () => {
    const res = await close(8, 'done', 'conferi o Asaas na mao')
    expect(res.statusCode).toBe(200)
    expect(res.body).toEqual({ result: 'closed' })
    expect(asaasCalls()).toEqual([])
    expect(db.rpcCalls.find((c) => c.name === 'admin_close_action')?.args).toEqual({ p_admin: ADMIN_ID, p_action_id: 8, p_outcome: 'done', p_note: 'conferi o Asaas na mao' })
  })

  it('Asaas fora na conferência: 502 e nada marcado', async () => {
    setAsaas({ get: () => { throw asaasDown() } })
    for (const [id, outcome] of [[3, 'done'], [4, 'done'], [6, 'done'], [6, 'canceled']] as const) {
      const res = await close(id, outcome, 'conferido no painel')
      expect(res.statusCode, `${id} ${outcome}`).toBe(502)
      expect(res.body, `${id} ${outcome}`).toEqual({ error: MSG.checkDown })
    }
    expect(rpcNames()).not.toContain('admin_close_action')
    for (const id of [3, 4, 6]) expect(actionRow(id).status).toBe('pending')
    // o detalhe do Asaas fica só no log
    expect(vi.mocked(console.error).mock.calls.flat().join(' ')).toContain('ECONNRESET')
  })

  it('servidor sem a chave do Asaas não fecha estorno como feito', async () => {
    asaas = null
    const res = await close(3, 'done')
    expect(res.statusCode).toBe(500)
    expect(res.body).toEqual({ error: MSG.misconfigured })
    expect(actionRow(3).status).toBe('pending')
  })

  it('fechar pendência já fechada responde 409', async () => {
    actionRow(3).status = 'done'
    const res = await close(3, 'canceled', 'nao vou estornar')
    expect(res.statusCode).toBe(409)
    expect(res.body).toEqual({ error: MSG.notOpen })
    const missing = await close(404, 'done', 'nao existe')
    expect(missing.body).toEqual({ error: MSG.notOpen })
    // a corrida (outra aba fechou entre a leitura e a gravação) também
    db.setRpc('admin_close_action', () => 'not_open')
    const race = await close(8, 'done', 'conferido')
    expect(race.body).toEqual({ error: MSG.notOpen })
  })

  it('entrada inválida responde 400 antes de ler a pendência', async () => {
    const cases: [Record<string, unknown>, string][] = [
      [{ actionId: 3, outcome: 'apagar', note: 'conferido' }, 'O resultado está em formato inválido.'],
      [{ actionId: 'tres', outcome: 'done', note: 'conferido' }, `A pendência precisa ser um número de 1 a ${Number.MAX_SAFE_INTEGER}.`],
      [{ actionId: 3, outcome: 'done' }, 'Preencha a nota.'],
      [{ actionId: 3, outcome: 'done', note: 'ok' }, 'A nota precisa ter pelo menos 3 caracteres.'],
      [{ actionId: 3, outcome: 'done', note: 'conferido', status: 'done' }, 'Campo não esperado: status.'],
    ]
    for (const [body, error] of cases) {
      const res = await post('close-action', body)
      expect(res.statusCode, JSON.stringify(body)).toBe(400)
      expect(res.body, JSON.stringify(body)).toEqual({ error })
    }
    expect(db.reads).toEqual([])
    expect(asaasCalls()).toEqual([])
  })
})

describe('tentar agora (retry-action)', () => {
  it('tentar agora chama runPendingActions com ids [7] e devolve o novo estado', async () => {
    setAsaas({ put: () => ({}), get: () => ({ data: [], hasMore: false }) })
    const res = await post('retry-action', { actionId: 7 })
    expect(res.statusCode).toBe(200)
    expect(res.body).toEqual({ status: 'done', attempts: 0, lastError: null })
    expect(runPendingActions).toHaveBeenCalledTimes(1)
    const [deps, filter] = vi.mocked(runPendingActions).mock.calls[0]
    expect(filter).toEqual({ ids: [7], limit: 1 })
    expect(deps.db).toBe(db)
    expect(deps.asaas).toBe(asaas)
    expect(deps.now?.().toISOString()).toBe(NOW.toISOString())
    expect(asaas!.put).toHaveBeenCalledWith('/subscriptions/sub_1', { status: 'INACTIVE' })
    // ação com o Asaas: registro pendente antes e o resultado depois (D7)
    const start = db.rpcCalls.find((c) => c.name === 'admin_log_start')
    expect(start?.args).toEqual({
      p_admin: ADMIN_ID, p_action: 'retry_action', p_target_user: USER_A, p_target_ref: '7',
      p_before: { action: 'inactivate_subscription', status: 'pending', attempts: 0, lastError: null }, p_note: null,
    })
    expect(db.rpcCalls.find((c) => c.name === 'admin_log_finish')?.args).toEqual({
      p_id: 41, p_result: 'ok', p_after: { status: 'done', attempts: 0, lastError: null }, p_message: null,
    })
    expect(rpcNames().indexOf('admin_log_start')).toBeLessThan(rpcNames().indexOf('billing_action_done'))
  })

  it('tentar agora com o Asaas fora devolve a pendência ainda aberta com a tentativa contada', async () => {
    setAsaas({ put: () => { throw asaasDown() } })
    const res = await post('retry-action', { actionId: 7 })
    expect(res.statusCode).toBe(200)
    expect(res.body).toEqual({ status: 'pending', attempts: 1, lastError: 'Asaas sem resposta (ECONNRESET)' })
    expect(actionRow(7).status).toBe('pending')
  })

  it('tentar agora em pendência manual responde 409', async () => {
    for (const id of [3, 6, 8]) {
      const res = await post('retry-action', { actionId: id })
      expect(res.statusCode, String(id)).toBe(409)
      expect(res.body, String(id)).toEqual({ error: MSG.notAuto })
    }
    expect(runPendingActions).not.toHaveBeenCalled()
    expect(rpcNames()).not.toContain('admin_log_start')
  })

  it('tentar agora em pendência já fechada responde 409 sem tentar', async () => {
    actionRow(7).status = 'done'
    const res = await post('retry-action', { actionId: 7 })
    expect(res.statusCode).toBe(409)
    expect(res.body).toEqual({ error: MSG.notOpen })
    expect(runPendingActions).not.toHaveBeenCalled()
  })

  it('sem conseguir gravar o registro, não tenta', async () => {
    db.setRpc('admin_log_start', () => { throw new Error('permission denied for table admin_audit_log') })
    const res = await post('retry-action', { actionId: 7 })
    expect(res.statusCode).toBe(500)
    expect(res.body).toEqual({ error: MSG.noLog })
    expect(runPendingActions).not.toHaveBeenCalled()
    expect(asaasCalls()).toEqual([])
  })

  it('servidor sem a chave do Asaas não tenta nem registra', async () => {
    asaas = null
    const res = await post('retry-action', { actionId: 7 })
    expect(res.statusCode).toBe(500)
    expect(res.body).toEqual({ error: MSG.misconfigured })
    expect(runPendingActions).not.toHaveBeenCalled()
    expect(rpcNames()).not.toContain('admin_log_start')
  })
})

describe('reprocessar aviso do Asaas (retry-event)', () => {
  it('reprocessar evento esgotado zera e processa', async () => {
    const res = await post('retry-event', { eventId: 'evt_1' })
    expect(res.statusCode).toBe(200)
    expect(res.body).toEqual({ processed: true, result: 'extended' })
    expect(db.rpcCalls.find((c) => c.name === 'admin_reset_event')?.args).toEqual({ p_admin: ADMIN_ID, p_event_id: 'evt_1' })
    expect(processStoredEvent).toHaveBeenCalledTimes(1)
    const [deps, id, payload, attempts] = vi.mocked(processStoredEvent).mock.calls[0]
    expect(deps.db).toBe(db)
    expect([id, payload, attempts]).toEqual(['evt_1', EVENT_PAYLOAD, 0])
    expect(db.tables.asaas_webhook_events[0]).toMatchObject({ status: 'done', attempts: 1, last_error: null })
    expect(db.tables.billing_subscriptions[1]).toMatchObject({ last_paid_due_date: '2026-11-10' })
    // o reinício e o processamento ficam entre o pendente e o resultado do registro
    expect(rpcNames()[0]).toBe('admin_log_start')
    expect(rpcNames()[1]).toBe('admin_reset_event')
    expect(db.rpcCalls[0].args).toEqual({
      p_admin: ADMIN_ID, p_action: 'retry_event', p_target_user: null, p_target_ref: 'evt_1',
      p_before: { event: 'PAYMENT_CONFIRMED', status: 'exhausted', attempts: 20, lastError: 'Asaas sem resposta (ECONNRESET)' }, p_note: null,
    })
    expect(db.rpcCalls.find((c) => c.name === 'admin_log_finish')?.args).toEqual({
      p_id: 41, p_result: 'ok', p_after: { processed: true, result: 'extended' }, p_message: null,
    })
  })

  it('reprocessar que falha de novo devolve processed falso', async () => {
    db.setRpc('billing_payment_confirmed', () => { throw new Error('deadlock detected') })
    const res = await post('retry-event', { eventId: 'evt_1' })
    expect(res.statusCode).toBe(200)
    expect(res.body).toEqual({ processed: false, result: null })
    expect(db.tables.asaas_webhook_events[0]).toMatchObject({ status: 'failed', attempts: 1 })
  })

  it('reprocessar evento feito responde 409', async () => {
    const res = await post('retry-event', { eventId: 'evt_2' })
    expect(res.statusCode).toBe(409)
    expect(res.body).toEqual({ error: MSG.eventDone })
    expect(rpcNames()).toEqual([])
    expect(processStoredEvent).not.toHaveBeenCalled()
    // corrida: o job terminou o aviso entre a leitura e o reinício
    db.setRpc('admin_reset_event', () => 'already_done')
    const race = await post('retry-event', { eventId: 'evt_1' })
    expect(race.statusCode).toBe(409)
    expect(race.body).toEqual({ error: MSG.eventDone })
    expect(processStoredEvent).not.toHaveBeenCalled()
  })

  it('reprocessar aviso que não existe responde 404', async () => {
    const res = await post('retry-event', { eventId: 'evt_404' })
    expect(res.statusCode).toBe(404)
    expect(res.body).toEqual({ error: 'Aviso não encontrado.' })
    expect(rpcNames()).toEqual([])
  })

  it('id do aviso fora do padrão responde 400', async () => {
    for (const eventId of ['evt 1', '', 'e'.repeat(201), 12]) {
      const res = await post('retry-event', { eventId })
      expect(res.statusCode, String(eventId)).toBe(400)
    }
    const spaced = await post('retry-event', { eventId: 'evt 1' })
    expect(spaced.body).toEqual({ error: 'O aviso está em formato inválido.' })
    expect(db.reads).toEqual([])
    // o id de aviso do Asaas leva & (evt_<hash>&<número>) e o do webhook sem id, sha:<hex>
    for (const eventId of ['evt_05b708f961d739ea7eba7e4db318f621&368604920', `sha:${'a1'.repeat(20)}`]) {
      const res = await post('retry-event', { eventId })
      expect(res.statusCode, eventId).toBe(404)
    }
  })

  it('sem conseguir gravar o registro, não reinicia o aviso', async () => {
    db.setRpc('admin_log_start', () => null)
    const res = await post('retry-event', { eventId: 'evt_1' })
    expect(res.statusCode).toBe(500)
    expect(res.body).toEqual({ error: MSG.noLog })
    expect(rpcNames()).not.toContain('admin_reset_event')
    expect(db.tables.asaas_webhook_events[0]).toMatchObject({ status: 'exhausted', attempts: 20 })
  })
})

describe('link da fatura (payment-link)', () => {
  it('payment-link recusa id fora do padrão e devolve a fatura', async () => {
    for (const id of ['sub_1', 'pay_', 'pay_1/../refund', 'pay_1;x', 'PAY_1']) {
      const res = await get('payment-link', { id })
      expect(res.statusCode, id).toBe(400)
      expect(res.body, id).toEqual({ error: 'O id da cobrança está em formato inválido.' })
    }
    const long = await get('payment-link', { id: `pay_${'a'.repeat(100)}` })
    expect(long.statusCode).toBe(400)
    const missing = await get('payment-link')
    expect(missing.body).toEqual({ error: 'Preencha o id da cobrança.' })
    expect(asaasCalls()).toEqual([])
    setAsaas({ get: (path) => (path === '/payments/pay_3' ? payment({ id: 'pay_3', status: 'CONFIRMED', invoiceUrl: 'https://sandbox.asaas.com/i/abc123' }) : {}) })
    const res = await get('payment-link', { id: 'pay_3' })
    expect(res.statusCode).toBe(200)
    expect(res.body).toEqual({ paymentId: 'pay_3', status: 'CONFIRMED', invoiceUrl: 'https://sandbox.asaas.com/i/abc123' })
  })

  it('cobrança sem fatura devolve invoiceUrl nulo', async () => {
    for (const invoiceUrl of [undefined, null, 'javascript:alert(1)', 'http://sem-https.example']) {
      setAsaas({ get: () => payment({ id: 'pay_3', status: 'PENDING', invoiceUrl }) })
      const res = await get('payment-link', { id: 'pay_3' })
      expect(res.body, String(invoiceUrl)).toEqual({ paymentId: 'pay_3', status: 'PENDING', invoiceUrl: null })
    }
  })

  it('cobrança que o Asaas não acha responde 404', async () => {
    setAsaas({ get: () => { throw new AsaasError('not_found', 'não encontrado no Asaas', 404) } })
    const res = await get('payment-link', { id: 'pay_404' })
    expect(res.statusCode).toBe(404)
    expect(res.body).toEqual({ error: 'O Asaas não achou a cobrança pay_404.' })
  })

  it('Asaas fora responde 502', async () => {
    setAsaas({ get: () => { throw asaasDown() } })
    const res = await get('payment-link', { id: 'pay_3' })
    expect(res.statusCode).toBe(502)
    expect(res.body).toEqual({ error: 'O Asaas não respondeu agora.' })
  })

  it('payment-link é GET e não aceita o id no corpo', async () => {
    const res = await call('GET', 'payment-link', { query: { id: 'pay_3' }, body: { note: 'x' } })
    expect(res.statusCode).toBe(400)
    expect(asaasCalls()).toEqual([])
  })
})

describe('cobranças futuras em aberto (futurePendingCharges)', () => {
  const PAYMENTS: AsaasPayment[] = [
    { id: 'pay_1', status: 'CONFIRMED', dueDate: '2026-10-10' },
    { id: 'pay_5', status: 'PENDING', dueDate: '2026-11-20', originalDueDate: '2026-11-05' },
    { id: 'pay_8', status: 'PENDING', dueDate: '2026-12-20', originalDueDate: '2026-11-10' },
    { id: 'pay_9', status: 'PENDING', dueDate: '2026-12-16', originalDueDate: '2026-12-16' },
    { id: 'pay_10', status: 'PENDING', dueDate: '2026-11-16' },
    { id: 'pay_11', status: 'PENDING', dueDate: '2026-12-10', deleted: true },
    { id: 'pay_12', status: 'OVERDUE', dueDate: '2026-11-01' },
    { id: 'pay_13', status: 'PENDING', dueDate: '2026-11-10' },
    { id: 'pay_14', status: 'PENDING', dueDate: null },
    { id: 'pay_15', status: 'AWAITING_RISK_ANALYSIS', dueDate: '2027-01-01' },
    { id: 'pay_16', status: 'PENDING', dueDate: '2027-01-16 00:00:00' },
  ]
  const ids = (list: AsaasPayment[]) => list.map((p) => p.id)

  it('em aberto, vencendo depois de hoje, fora do id guardado e fora do ciclo cortado', () => {
    expect(ids(futurePendingCharges(PAYMENTS, { paymentId: 'pay_5', cycleDue: '2026-11-10' }, '2026-11-16'))).toEqual(['pay_9', 'pay_16'])
    expect(ids(futurePendingCharges(PAYMENTS, { paymentId: null, cycleDue: '2026-11-10' }, '2026-11-16'))).toEqual(['pay_5', 'pay_9', 'pay_16'])
    expect(ids(futurePendingCharges(PAYMENTS, { paymentId: 'pay_5', cycleDue: null }, '2026-11-16'))).toEqual(['pay_8', 'pay_9', 'pay_16'])
    expect(ids(futurePendingCharges(PAYMENTS, { paymentId: null, cycleDue: null }, '2026-11-16'))).toEqual(['pay_5', 'pay_8', 'pay_9', 'pay_16'])
    expect(futurePendingCharges([], { paymentId: null, cycleDue: null }, '2026-11-16')).toEqual([])
  })

  it('escolhe as mesmas cobranças que a remoção automática remove', async () => {
    const keeps = [
      { paymentId: 'pay_5', cycleDue: '2026-11-10' },
      { paymentId: null, cycleDue: '2026-11-10' },
      { paymentId: 'pay_5', cycleDue: null },
      { paymentId: null, cycleDue: null },
      { paymentId: 'pay_9', cycleDue: '2026-12-20' },
    ]
    for (const keep of keeps) {
      const fake = createFakeAsaas({ get: () => ({ data: PAYMENTS, hasMore: false }) })
      fakes.push(fake)
      const removed = await removeFuturePendingCharges(fake, 'sub_1', '2026-11-16', keep)
      expect(ids(futurePendingCharges(PAYMENTS, keep, '2026-11-16')), JSON.stringify(keep)).toEqual(removed.removed)
    }
  })
})

describe('nome do status da cobrança (paymentStatusName)', () => {
  it('mesma tabela de paymentStatusLabel do admin', () => {
    const table: Record<string, string> = {
      PENDING: 'em aberto', CONFIRMED: 'confirmada', RECEIVED: 'recebida', RECEIVED_IN_CASH: 'recebida em dinheiro', OVERDUE: 'vencida',
      REFUNDED: 'estornada', REFUND_REQUESTED: 'estorno pedido', REFUND_IN_PROGRESS: 'estorno em andamento', DELETED: 'removida',
      CHARGEBACK_REQUESTED: 'contestação',
    }
    for (const [status, name] of Object.entries(table)) expect(paymentStatusName(status), status).toBe(name)
    expect(paymentStatusName('AWAITING_RISK_ANALYSIS')).toBe('awaiting_risk_analysis')
    expect(paymentStatusName('')).toBe('sem dado')
  })

  it('não devolve o que vem do protótipo nem texto solto do Asaas', () => {
    expect(paymentStatusName('constructor')).toBe('sem dado')
    expect(paymentStatusName('toString')).toBe('sem dado')
    expect(paymentStatusName('<script>')).toBe('sem dado')
    expect(paymentStatusName('X'.repeat(41))).toBe('sem dado')
  })
})

describe('arquivo das pendências', () => {
  it('nenhuma ação estorna: o módulo não chama estorno no Asaas', () => {
    const src = readFileSync(new URL('../_lib/admin/review.ts', import.meta.url), 'utf8')
    expect(src).not.toMatch(/refundPayment|\/refund/)
    expect(src).not.toMatch(/\.post\(|\.put\(|\.del\(/)
  })

  it('declara as seis ações das pendências com o método do contrato', () => {
    expect(Object.fromEntries(Object.entries(handlers).map(([name, h]) => [name, h.method]))).toEqual({
      review: 'GET', 'payment-link': 'GET', 'resolve-flag': 'POST', 'close-action': 'POST', 'retry-action': 'POST', 'retry-event': 'POST',
    })
  })
})

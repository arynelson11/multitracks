import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRes, type FakeDb, type FakeRes, type Row } from './fakeSupabase.js'
import { USER_A, USER_B, asaasDown, createBillingDb, createFakeAsaas, payment, subRow, type FakeAsaas } from './billingHarness.js'
import { AsaasError, removeFuturePendingCharges, type AsaasPayment } from '../_lib/asaas.js'
import { processStoredEvent, runPendingActions } from '../_lib/billing.js'
import { createAdminRouter } from '../_lib/admin/http.js'
import { futurePendingCharges, handlers, lastErrorLabel, paymentStatusName } from '../_lib/admin/review.js'

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
// Versão da marcação que o admin viu na fila (adminNote e updatedAt do ReviewFlag),
// no formato em que o Postgres devolve o timestamptz (microssegundos e +00:00).
const SEEN_NOTE = 'cobranca vencida paga depois (vencimento 2026-11-10)'
const SEEN_AT = '2026-11-16T09:00:00.123456+00:00'

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
  seenMissing: 'Falta a versão da marcação que você viu. Atualize a lista e tente de novo.',
  asaasCaseNoId: 'Esta pendência não guarda a assinatura do Asaas, então não dá pra conferir se ela ainda cobra. Nada foi marcado.',
  asaasDoubt: 'Não deu pra confirmar no Asaas que esta assinatura parou de cobrar. Confira no painel do Asaas antes de fechar.',
  actionIdBad: 'A pendência está em formato inválido.',
  asaasSilent: 'O Asaas não respondeu.',
  unexpected: 'Erro inesperado no servidor.',
}
const asaasRefused = (status: number) => `O Asaas recusou o pedido. Status do Asaas: ${status}.`

// Instante em microssegundos, como o Postgres guarda o timestamptz.
function micros(iso: unknown): number {
  const m = /^(.+T\d{2}:\d{2}:\d{2})(?:\.(\d{1,6}))?(Z|[+-]\d{2}:\d{2})$/.exec(String(iso))
  if (!m) throw new Error(`instante fora do formato no teste: ${String(iso)}`)
  return Date.parse(`${m[1]}${m[3]}`) * 1000 + Number((m[2] ?? '').padEnd(6, '0'))
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
  // Mesma ordem do SQL de admin_resolve_flag: guarda de admin, guarda da
  // chamada antiga (só a hora vista nula), linha, marcação e versão vista.
  target.setRpc('admin_resolve_flag', (a) => {
    if (a.p_admin !== ADMIN_ID) throw new Error('só admin faz ação de admin')
    if (a.p_seen_at == null) return 'changed'
    const r = target.tables.billing_subscriptions.find((x) => x.id === a.p_subscription_ref)
    if (!r) return 'not_found'
    if (!r.needs_admin_review) return 'not_flagged'
    // Ruling ADM-T5-visto: marcação diferente da que o admin viu não muda nada.
    // Nota com "is distinct from" (nula vale como versão); hora com folga de 1 ms.
    if ((r.admin_note ?? null) !== (a.p_seen_note ?? null) || Math.abs(micros(r.updated_at) - micros(a.p_seen_at)) >= 1000) return 'changed'
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
        needs_admin_review: true, admin_note: SEEN_NOTE, updated_at: SEEN_AT }),
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
    expect(res.body).toEqual({ ...queue, events: [{ ...queue.events[0], lastError: MSG.unexpected }] })
    expect(db.rpcCalls).toEqual([{ name: 'admin_review_queue', args: {} }])
    expect(asaasCalls()).toEqual([])
  })

  it('o último erro de cada pendência e aviso da fila sai em frase pronta (Ruling ADM-T6-lastError)', async () => {
    const action = (id: number, lastError: string | null) => ({ id, action: 'inactivate_subscription', autoRetry: true, attempts: 2, lastError, subscriptionRef: 'chk_1' })
    const event = (id: string, lastError: string | null) => ({ id, event: 'PAYMENT_CONFIRMED', status: 'failed', attempts: 3, lastError })
    db.setRpc('admin_review_queue', () => ({
      actions: [
        action(7, 'Asaas sem resposta (ECONNRESET)'),
        action(9, 'Asaas recusou (400): A assinatura sub_1 tem cobrança em andamento no cartão final 4242.'),
        action(10, null),
      ],
      flags: [],
      events: [
        event('evt_1', 'Falha no banco (billing_payment_confirmed): deadlock detected'),
        event('evt_3', null),
      ],
      counts: { manual: 0, auto: 5, total: 5 },
      generatedAt: '2026-11-16T15:00:00Z',
    }))
    const res = await get('review')
    expect(res.statusCode).toBe(200)
    expect(res.body).toEqual({
      actions: [action(7, MSG.asaasSilent), action(9, asaasRefused(400)), action(10, null)],
      flags: [],
      events: [event('evt_1', MSG.unexpected), event('evt_3', null)],
      counts: { manual: 0, auto: 5, total: 5 },
      generatedAt: '2026-11-16T15:00:00Z',
    })
    const text = JSON.stringify(res.body)
    for (const raw of ['ECONNRESET', 'cartão final', 'deadlock', 'billing_payment_confirmed']) expect(text).not.toContain(raw)
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
  const seen = { seenNote: SEEN_NOTE, seenAt: SEEN_AT }

  it('conferir tira a marcação com a nota do admin e a versão que ele viu', async () => {
    const res = await post('resolve-flag', { subscriptionRef: 'chk_1', note: '  falei com o cliente  ', ...seen })
    expect(res.statusCode).toBe(200)
    expect(res.body).toEqual({ result: 'resolved' })
    expect(db.rpcCalls).toEqual([{
      name: 'admin_resolve_flag',
      args: { p_admin: ADMIN_ID, p_subscription_ref: 'chk_1', p_note: 'falei com o cliente', p_seen_note: SEEN_NOTE, p_seen_at: SEEN_AT },
    }])
    expect(db.tables.billing_subscriptions[0].needs_admin_review).toBe(false)
    // só no banco: a própria função grava o registro na mesma transação (D7)
    expect(rpcNames()).not.toContain('admin_log_start')
  })

  it('marcação nova chegou com Pendências aberta: responde changed e não mexe em nada', async () => {
    // ex.: chargeback marcado na mesma assinatura depois que o admin abriu a lista
    const row = db.tables.billing_subscriptions[0]
    Object.assign(row, { admin_note: `${SEEN_NOTE} | chargeback na cobranca pay_7`, updated_at: '2026-11-16T14:59:00.000001+00:00' })
    const res = await post('resolve-flag', { subscriptionRef: 'chk_1', note: 'falei com o cliente', ...seen })
    expect(res.statusCode).toBe(200)
    expect(res.body).toEqual({ result: 'changed' })
    expect(row).toMatchObject({ needs_admin_review: true, admin_note: `${SEEN_NOTE} | chargeback na cobranca pay_7` })
    // não é erro: nenhum registro pendente fica aberto
    expect(rpcNames()).toEqual(['admin_resolve_flag'])
  })

  it('changed do banco vira o resultado changed (setRpc)', async () => {
    db.setRpc('admin_resolve_flag', () => 'changed')
    const res = await post('resolve-flag', { subscriptionRef: 'chk_1', note: 'conferido', ...seen })
    expect(res.statusCode).toBe(200)
    expect(res.body).toEqual({ result: 'changed' })
    expect(vi.mocked(console.error)).not.toHaveBeenCalled()
  })

  it('a versão vista vai como veio: sem tirar espaços, e a nota nula vale como versão', async () => {
    const row = db.tables.billing_subscriptions[0]
    row.admin_note = ' nota com espaço no fim '
    const spaced = await post('resolve-flag', { subscriptionRef: 'chk_1', note: 'conferido', seenNote: ' nota com espaço no fim ', seenAt: SEEN_AT })
    expect(spaced.body).toEqual({ result: 'resolved' })
    expect(db.rpcCalls[0].args.p_seen_note).toBe(' nota com espaço no fim ')
    // marcação sem nota (adminNote nulo na fila): a nota nula é comparada como valor
    Object.assign(row, { needs_admin_review: true, admin_note: null })
    const noNote = await post('resolve-flag', { subscriptionRef: 'chk_1', note: 'conferido', seenNote: null, seenAt: SEEN_AT })
    expect(noNote.body).toEqual({ result: 'resolved' })
    expect(db.rpcCalls[1].args).toMatchObject({ p_seen_note: null, p_seen_at: SEEN_AT })
    // nota nula vista contra uma nota no banco não é a mesma versão
    Object.assign(row, { needs_admin_review: true, admin_note: 'chargeback na cobranca pay_7' })
    const other = await post('resolve-flag', { subscriptionRef: 'chk_1', note: 'conferido', seenNote: null, seenAt: SEEN_AT })
    expect(other.body).toEqual({ result: 'changed' })
    expect(row).toMatchObject({ needs_admin_review: true, admin_note: 'chargeback na cobranca pay_7' })
  })

  it('sem o instante da marcação responde 400 sem chamar o banco (Ruling ADM-T5T6-nulo)', async () => {
    // a hora vista é obrigatória: sem ela o banco responderia changed pra sempre
    const cases: Record<string, unknown>[] = [
      { seenNote: SEEN_NOTE },
      { seenNote: SEEN_NOTE, seenAt: null },
      { seenNote: SEEN_NOTE, seenAt: '' },
      { seenNote: SEEN_NOTE, seenAt: '   ' },
      { seenNote: null },
    ]
    for (const seen of cases) {
      const res = await post('resolve-flag', { subscriptionRef: 'chk_1', note: 'conferido', ...seen })
      expect(res.statusCode, JSON.stringify(seen)).toBe(400)
      expect(res.body, JSON.stringify(seen)).toEqual({ error: MSG.seenMissing })
    }
    expect(rpcNames()).toEqual([])
    expect(db.tables.billing_subscriptions[0].needs_admin_review).toBe(true)
  })

  it('hora vista a menos de 1 ms da do banco confere; a 1 ms ou mais responde changed', async () => {
    const row = db.tables.billing_subscriptions[0]
    const far = await post('resolve-flag', { subscriptionRef: 'chk_1', note: 'conferido', seenNote: SEEN_NOTE, seenAt: '2026-11-16T09:00:00.124456+00:00' })
    expect(far.body).toEqual({ result: 'changed' })
    expect(row.needs_admin_review).toBe(true)
    // a tela pode devolver só os milissegundos, ou outro fuso pro mesmo instante
    const near = await post('resolve-flag', { subscriptionRef: 'chk_1', note: 'conferido', seenNote: SEEN_NOTE, seenAt: '2026-11-16T06:00:00.123-03:00' })
    expect(near.body).toEqual({ result: 'resolved' })
    expect(db.rpcCalls[1].args.p_seen_at).toBe('2026-11-16T06:00:00.123-03:00')
  })

  it('sem a versão vista, ou com ela quebrada, responde 400 sem chamar o banco', async () => {
    const cases: [Record<string, unknown>, string][] = [
      [{ subscriptionRef: 'chk_1', note: 'conferido' }, 'Falta a versão da marcação que você viu. Atualize a lista e tente de novo.'],
      [{ subscriptionRef: 'chk_1', note: 'conferido', seenNote: 12 }, 'A versão da marcação está em formato inválido.'],
      [{ subscriptionRef: 'chk_1', note: 'conferido', seenNote: 'x'.repeat(50001) }, 'A versão da marcação está em formato inválido.'],
      [{ subscriptionRef: 'chk_1', note: 'conferido', seenNote: SEEN_NOTE, seenAt: 'ontem' }, 'O instante da marcação está em formato inválido.'],
      [{ subscriptionRef: 'chk_1', note: 'conferido', seenNote: SEEN_NOTE, seenAt: '2026-02-30T09:00:00Z' }, 'O instante da marcação está em formato inválido.'],
      [{ subscriptionRef: 'chk_1', note: 'conferido', seenNote: SEEN_NOTE, seenAt: '2026-11-16T25:00:00Z' }, 'O instante da marcação está em formato inválido.'],
      [{ subscriptionRef: 'chk_1', note: 'conferido', seenNote: SEEN_NOTE, seenAt: 1763283600000 }, 'O instante da marcação está em formato inválido.'],
    ]
    for (const [body, error] of cases) {
      const res = await post('resolve-flag', body)
      expect(res.statusCode, JSON.stringify(body).slice(0, 80)).toBe(400)
      expect(res.body, JSON.stringify(body).slice(0, 80)).toEqual({ error })
    }
    for (const seenAt of ['2026-11-16T09:00:00Z', '2026-11-16T09:00:00.5-03:00', SEEN_AT]) {
      db.tables.billing_subscriptions[0].updated_at = seenAt
      db.tables.billing_subscriptions[0].needs_admin_review = true
      const res = await post('resolve-flag', { subscriptionRef: 'chk_1', note: 'conferido', seenNote: db.tables.billing_subscriptions[0].admin_note, seenAt })
      expect(res.statusCode, seenAt).toBe(200)
    }
  })

  it('conferir com nota curta responde 400', async () => {
    const res = await post('resolve-flag', { subscriptionRef: 'chk_1', note: 'ok', ...seen })
    expect(res.statusCode).toBe(400)
    expect(res.body).toEqual({ error: 'A nota precisa ter pelo menos 3 caracteres.' })
    const long = await post('resolve-flag', { subscriptionRef: 'chk_1', note: 'a'.repeat(501), ...seen })
    expect(long.body).toEqual({ error: 'A nota pode ter no máximo 500 caracteres.' })
    const ref = await post('resolve-flag', { subscriptionRef: 'x'.repeat(201), note: 'conferido', ...seen })
    expect(ref.statusCode).toBe(400)
    const missing = await post('resolve-flag', { subscriptionRef: 'chk_1', ...seen })
    expect(missing.body).toEqual({ error: 'Preencha a nota.' })
    expect(rpcNames()).toEqual([])
  })

  it('conferir já conferida responde 409', async () => {
    const res = await post('resolve-flag', { subscriptionRef: 'chk_2', note: 'conferido de novo', seenNote: 'conferido pelo admin em 10/11/2026: ok', seenAt: SEEN_AT })
    expect(res.statusCode).toBe(409)
    expect(res.body).toEqual({ error: 'Esta marcação já foi conferida.' })
  })

  it('conferir marcação que não existe responde 404', async () => {
    const res = await post('resolve-flag', { subscriptionRef: 'chk_404', note: 'conferido', seenNote: null, seenAt: SEEN_AT })
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

  // Ruling ADM-T6-asaas-duvida: o caso asaas: só fecha com prova de que o Asaas parou.
  it('caso asaas: sem o id da assinatura não fecha nem consulta o Asaas', async () => {
    actionRow(6).subscription_ref = 'asaas:'
    for (const outcome of ['done', 'canceled']) {
      const res = await close(6, outcome, 'parei no painel')
      expect(res.statusCode, outcome).toBe(409)
      expect(res.body, outcome).toEqual({ error: MSG.asaasCaseNoId })
    }
    expect(asaasCalls()).toEqual([])
    // nada fechado e nada gravado (nem registro)
    expect(rpcNames()).toEqual([])
    expect(actionRow(6).status).toBe('pending')
  })

  it('caso asaas: Asaas sem status ou com status que não se conhece não fecha', async () => {
    const answers: unknown[] = [
      { id: 'sub_9' },
      { id: 'sub_9', deleted: false },
      { id: 'sub_9', status: 'SUSPENDED', deleted: false },
      { id: 'sub_9', status: 'active' },
      { id: 'sub_9', status: null, deleted: 'true' },
      {},
      '',
      [],
    ]
    for (const answer of answers) {
      for (const outcome of ['done', 'canceled']) {
        setAsaas({ get: () => answer })
        const res = await close(6, outcome, 'parei no painel')
        expect(res.statusCode, `${JSON.stringify(answer)} ${outcome}`).toBe(409)
        expect(res.body, `${JSON.stringify(answer)} ${outcome}`).toEqual({ error: MSG.asaasDoubt })
        expect(asaas!.get).toHaveBeenCalledWith('/subscriptions/sub_9')
      }
    }
    expect(rpcNames()).toEqual([])
    expect(actionRow(6).status).toBe('pending')
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
      // a frase não cita o teto do número (Minor 3 da T6)
      [{ actionId: 'tres', outcome: 'done', note: 'conferido' }, MSG.actionIdBad],
      [{ outcome: 'done', note: 'conferido' }, MSG.actionIdBad],
      [{ actionId: 0, outcome: 'done', note: 'conferido' }, MSG.actionIdBad],
      [{ actionId: 2.5, outcome: 'done', note: 'conferido' }, MSG.actionIdBad],
      [{ actionId: 2 ** 53, outcome: 'done', note: 'conferido' }, MSG.actionIdBad],
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

// Parte 3 (T13, D10): a pendência de voltar pro preço cheio depois do primeiro mês com
// desconto. "Marcar como feito" à mão só com o Asaas mostrando o preço cheio do plano atual
// da assinatura; descartar continua recusado. A conferência é só leitura no Asaas.
describe('voltar pro preço cheio (restore_full_price)', () => {
  const close = (outcome: string, note = 'troquei no painel') => post('close-action', { actionId: 11, outcome, note })
  const stillAt = (v: string) => `No Asaas a assinatura ainda está em R$ ${v}. Use Tentar agora ou troque no painel do Asaas antes de marcar como feito.`
  const subWith = (value: unknown) => (path: string) => (path === '/subscriptions/sub_2' ? { id: 'sub_2', status: 'ACTIVE', value } : { data: [], hasMore: false })

  beforeEach(() => {
    // chk_2 (USER_B) é a assinatura ativa do Pro Mensal com o id do Asaas sub_2; a pendência
    // nasceu no CHECKOUT_PAID, antes de o app saber o id da assinatura
    db.tables.billing_pending_actions.push(pendingAction({
      id: 11, action: 'restore_full_price', subscription_ref: 'chk_2', user_id: USER_B, asaas_subscription_id: null, reason: 'oferta_primeiro_mes', amount: 49.9,
    }))
  })

  it('marcar como feito com o Asaas ainda em 24,90 é recusado', async () => {
    setAsaas({ get: subWith(24.9) })
    const res = await close('done')
    expect(res.statusCode).toBe(409)
    expect(res.body).toEqual({ error: stillAt('24,90') })
    expect(asaas!.get).toHaveBeenCalledWith('/subscriptions/sub_2')
    expect(rpcNames()).not.toContain('admin_close_action')
    expect(actionRow(11).status).toBe('pending')
  })

  it('marcar como feito com o Asaas em 49,90 fecha', async () => {
    setAsaas({ get: subWith(49.9) })
    const res = await close('done')
    expect(res.statusCode).toBe(200)
    expect(res.body).toEqual({ result: 'closed' })
    expect(db.rpcCalls.find((c) => c.name === 'admin_close_action')?.args).toEqual({ p_admin: ADMIN_ID, p_action_id: 11, p_outcome: 'done', p_note: 'troquei no painel' })
    expect(actionRow(11)).toMatchObject({ status: 'done', done_note: 'admin: troquei no painel' })
  })

  it('vale o preço do plano atual da assinatura: trocada pro Studio, 49,90 é recusado e 119,90 fecha', async () => {
    db.tables.billing_subscriptions.find((r) => r.id === 'chk_2')!.plan_key = 'pro_mensal'
    setAsaas({ get: subWith(49.9) })
    expect((await close('done')).body).toEqual({ error: stillAt('49,90') })
    setAsaas({ get: subWith(119.9) })
    expect((await close('done')).body).toEqual({ result: 'closed' })
  })

  it('sem o id da assinatura guardado: procura pelo checkout no Asaas (só leitura); sem achar, não fecha', async () => {
    db.tables.billing_subscriptions.find((r) => r.id === 'chk_2')!.asaas_subscription_id = null
    setAsaas({ get: (path) => (path === '/payments' ? { data: [] } : subWith(49.9)(path)) })
    const res = await close('done')
    expect(res.statusCode).toBe(409)
    expect(res.body).toEqual({ error: 'Não achamos esta assinatura no Asaas, então não dá pra conferir o preço. Nada foi marcado.' })
    expect(asaas!.get).toHaveBeenCalledWith('/payments', { checkoutSession: 'chk_2', limit: 10 })
    expect(actionRow(11).status).toBe('pending')
    // achando pelo checkout, confere o preço da assinatura achada
    setAsaas({ get: (path) => (path === '/payments' ? { data: [payment({ id: 'pay_2', subscription: 'sub_2', checkoutSession: 'chk_2' })] } : subWith(49.9)(path)) })
    expect((await close('done')).body).toEqual({ result: 'closed' })
  })

  it('assinatura que o Asaas não acha ou resposta sem o valor: não fecha', async () => {
    setAsaas({ get: () => { throw new AsaasError('not_found', 'não encontrado no Asaas', 404) } })
    expect((await close('done')).body).toEqual({ error: 'O Asaas não achou a assinatura sub_2. Nada foi marcado.' })
    for (const value of [undefined, '49.90', null]) {
      setAsaas({ get: subWith(value) })
      const res = await close('done')
      expect(res.statusCode, String(value)).toBe(409)
      expect(res.body, String(value)).toEqual({ error: 'Não deu pra confirmar no Asaas o preço desta assinatura. Confira no painel do Asaas antes de marcar como feito.' })
    }
    expect(actionRow(11).status).toBe('pending')
  })

  it('Asaas fora na conferência: 502 e nada marcado', async () => {
    setAsaas({ get: () => { throw asaasDown() } })
    const res = await close('done')
    expect(res.statusCode).toBe(502)
    expect(res.body).toEqual({ error: MSG.checkDown })
    expect(actionRow(11).status).toBe('pending')
  })

  it('descartar a volta pro preço cheio é recusado sem consultar o Asaas', async () => {
    const res = await close('canceled', 'nao quero trocar')
    expect(res.statusCode).toBe(409)
    expect(res.body).toEqual({ error: MSG.notDiscardable })
    expect(asaasCalls()).toEqual([])
    expect(actionRow(11).status).toBe('pending')
  })

  it('Tentar agora troca o preço no Asaas e fecha a pendência', async () => {
    setAsaas({ put: () => ({}) })
    const res = await post('retry-action', { actionId: 11 })
    expect(res.statusCode).toBe(200)
    expect(res.body).toEqual({ status: 'done', attempts: 0, lastError: null })
    expect(asaas!.put).toHaveBeenCalledWith('/subscriptions/sub_2', { value: 49.9, cycle: 'MONTHLY', description: 'Playback Studio Pro (mensal)', updatePendingPayments: true })
    expect(actionRow(11)).toMatchObject({ status: 'done', done_note: 'preco cheio: R$ 49,90' })
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
    // o texto cru fica só no banco; a resposta e o registro levam a frase pronta
    expect(res.body).toEqual({ status: 'pending', attempts: 1, lastError: MSG.asaasSilent })
    expect(actionRow(7)).toMatchObject({ status: 'pending', last_error: 'Asaas sem resposta (ECONNRESET)' })
    expect(db.rpcCalls.find((c) => c.name === 'admin_log_finish')?.args).toEqual({
      p_id: 41, p_result: 'ok', p_after: { status: 'pending', attempts: 1, lastError: MSG.asaasSilent }, p_message: null,
    })
  })

  it('tentar agora recusado pelo Asaas leva só o status do Asaas na resposta e no antes e depois do registro', async () => {
    Object.assign(actionRow(7), { attempts: 2, last_error: 'Asaas sem resposta (ETIMEDOUT)' })
    setAsaas({ put: () => { throw new AsaasError('rejected', 'Asaas recusou (400): A assinatura do cliente João tem cobrança em andamento.', 400) } })
    const res = await post('retry-action', { actionId: 7 })
    expect(res.statusCode).toBe(200)
    expect(res.body).toEqual({ status: 'pending', attempts: 3, lastError: asaasRefused(400) })
    expect(db.rpcCalls.find((c) => c.name === 'admin_log_start')?.args.p_before).toEqual({
      action: 'inactivate_subscription', status: 'pending', attempts: 2, lastError: MSG.asaasSilent,
    })
    expect(db.rpcCalls.find((c) => c.name === 'admin_log_finish')?.args.p_after).toEqual({ status: 'pending', attempts: 3, lastError: asaasRefused(400) })
    const logged = JSON.stringify(db.rpcCalls.filter((c) => c.name.startsWith('admin_log_')))
    for (const raw of ['João', 'ETIMEDOUT', 'em andamento']) {
      expect(logged).not.toContain(raw)
      expect(JSON.stringify(res.body)).not.toContain(raw)
    }
  })

  it('tentar agora com frase de erro desconhecida no banco mostra erro inesperado', async () => {
    Object.assign(actionRow(7), { attempts: 1, last_error: 'Falha no banco (billing_action_done): permission denied for table billing_pending_actions' })
    db.setRpc('billing_action_failed', () => null)
    setAsaas({ put: () => { throw asaasDown() } })
    const res = await post('retry-action', { actionId: 7 })
    expect(res.body).toEqual({ status: 'pending', attempts: 1, lastError: MSG.unexpected })
    expect(db.rpcCalls.find((c) => c.name === 'admin_log_start')?.args.p_before).toMatchObject({ lastError: MSG.unexpected })
  })

  it('remoção de cobrança futura recusada pelo Asaas cita as cobranças, e o Asaas fora cita o status (Ruling ADM-T6-lastError-mapa)', async () => {
    Object.assign(actionRow(4), { attempts: 1, last_error: 'Asaas respondeu 503' })
    setAsaas({
      get: (path) => (path === '/payments'
        ? { data: [payment({ id: 'pay_9', status: 'PENDING', dueDate: '2026-12-16' })], hasMore: false }
        : payment({ id: 'pay_9', status: 'PENDING', dueDate: '2026-12-16' })),
      del: () => { throw new AsaasError('rejected', 'Asaas recusou (400): Não é possível remover a cobrança do cliente João.', 400) },
    })
    const res = await post('retry-action', { actionId: 4 })
    expect(res.statusCode).toBe(200)
    expect(actionRow(4).last_error).toBe('Asaas recusou remover pay_9')
    expect(res.body).toEqual({ status: 'pending', attempts: 2, lastError: 'O Asaas recusou remover as cobranças futuras: pay_9.' })
    expect(db.rpcCalls.find((c) => c.name === 'admin_log_start')?.args.p_before).toEqual({
      action: 'delete_future_payments', status: 'pending', attempts: 1, lastError: 'O Asaas não respondeu. Status do Asaas: 503.',
    })
    expect(db.rpcCalls.find((c) => c.name === 'admin_log_finish')?.args.p_after).toEqual(res.body)
    expect(JSON.stringify(db.rpcCalls.filter((c) => c.name.startsWith('admin_log_')))).not.toContain('João')
  })

  it('tentar agora com id fora do padrão responde 400 sem o teto na frase', async () => {
    for (const actionId of ['sete', 0, -7, 7.5, 2 ** 53, null]) {
      const res = await post('retry-action', { actionId })
      expect(res.statusCode, String(actionId)).toBe(400)
      expect(res.body, String(actionId)).toEqual({ error: MSG.actionIdBad })
    }
    expect(db.reads).toEqual([])
    expect(runPendingActions).not.toHaveBeenCalled()
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
      p_before: { event: 'PAYMENT_CONFIRMED', status: 'exhausted', attempts: 20, lastError: MSG.asaasSilent }, p_note: null,
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

describe('último erro em frase pronta (lastErrorLabel)', () => {
  it('troca o texto do Asaas pela frase com o status, e nulo continua nulo', () => {
    expect(lastErrorLabel('Asaas sem resposta (ECONNRESET)')).toBe('O Asaas não respondeu.')
    expect(lastErrorLabel('Asaas sem resposta em 9000 ms')).toBe('O Asaas não respondeu.')
    expect(lastErrorLabel('Asaas recusou (400): O CPF do cliente Maria é inválido.')).toBe('O Asaas recusou o pedido. Status do Asaas: 400.')
    expect(lastErrorLabel('Asaas recusou (422): erro sem descrição')).toBe('O Asaas recusou o pedido. Status do Asaas: 422.')
    expect(lastErrorLabel(null)).toBeNull()
    expect(lastErrorLabel(undefined)).toBeNull()
  })

  it('Asaas fora com status e remoção recusada das cobranças futuras (Ruling ADM-T6-lastError-mapa)', () => {
    expect(lastErrorLabel('Asaas respondeu 503')).toBe('O Asaas não respondeu. Status do Asaas: 503.')
    expect(lastErrorLabel('Asaas respondeu 429')).toBe('O Asaas não respondeu. Status do Asaas: 429.')
    expect(lastErrorLabel('Asaas recusou remover pay_9')).toBe('O Asaas recusou remover as cobranças futuras: pay_9.')
    expect(lastErrorLabel('Asaas recusou remover pay_9, pay_19')).toBe('O Asaas recusou remover as cobranças futuras: pay_9, pay_19.')
    // id fora do padrão: a frase sai sem os ids
    for (const raw of ['Asaas recusou remover pay_9, <script>', 'Asaas recusou remover pay_9, pay_', 'Asaas recusou remover sub_1', 'Asaas recusou remover ', 'Asaas recusou remover pay_9 do cliente João']) {
      expect(lastErrorLabel(raw), raw).toBe('O Asaas recusou remover as cobranças futuras.')
    }
  })

  // Ruling ADM-T6-idempotente: a T7 aplica a função em todo registro ao ler,
  // inclusive no antes e depois que já saíram daqui em frase pronta.
  it('é idempotente: a frase que ela mesma faz passa sem mudar', () => {
    const raws = [
      'Asaas sem resposta (ECONNRESET)',
      'Asaas respondeu 503',
      'Asaas recusou (400): O CPF do cliente Maria é inválido.',
      'Asaas recusou remover pay_9, pay_19',
      'Asaas recusou remover pay_9, <script>',
      'deadlock detected',
      null,
    ]
    for (const raw of raws) {
      const once = lastErrorLabel(raw)
      expect(lastErrorLabel(once), String(raw)).toBe(once)
    }
    const own = [
      'O Asaas não respondeu.',
      'O Asaas não respondeu. Status do Asaas: 503.',
      'O Asaas recusou o pedido. Status do Asaas: 400.',
      'O Asaas recusou remover as cobranças futuras: pay_9.',
      'O Asaas recusou remover as cobranças futuras: pay_9, pay_19.',
      'O Asaas recusou remover as cobranças futuras.',
      'Erro inesperado no servidor.',
    ]
    for (const phrase of own) expect(lastErrorLabel(phrase), phrase).toBe(phrase)
    // o texto cru continua mapeado
    expect(lastErrorLabel('Asaas recusou (422): erro sem descrição')).toBe('O Asaas recusou o pedido. Status do Asaas: 422.')
    expect(lastErrorLabel('Asaas sem resposta (ETIMEDOUT)')).toBe('O Asaas não respondeu.')
  })

  it('texto parecido com a frase pronta, mas com algo a mais, não passa', () => {
    const nearMiss = [
      'O Asaas recusou o pedido. Status do Asaas: 400. O CPF do cliente Maria é inválido.',
      'O Asaas recusou o pedido. Status do Asaas: abc.',
      'O Asaas não respondeu. Status do Asaas: 5030.',
      'O Asaas não respondeu. (ECONNRESET)',
      ' O Asaas não respondeu.',
      'O Asaas recusou remover as cobranças futuras: pay_9, <script>.',
      'O Asaas recusou remover as cobranças futuras: pay_9 do cliente João.',
      'O Asaas recusou remover as cobranças futuras: .',
    ]
    for (const text of nearMiss) expect(lastErrorLabel(text), text).toBe('Erro inesperado no servidor.')
  })

  it('frase que não está no mapa vira "Erro inesperado no servidor."', () => {
    // o mapa da Ruling ADM-T6-lastError (com a Ruling ADM-T6-lastError-mapa) é fechado
    const unknown: unknown[] = [
      'deadlock detected',
      'Falha no banco (billing_action_done): permission denied for table billing_pending_actions',
      'Asaas recusou (abc): x',
      'Asaas respondeu',
      'Asaas respondeu muito devagar',
      'reiniciado pelo admin',
      'erro',
      '',
      42,
      { message: 'Asaas sem resposta (ECONNRESET)' },
    ]
    for (const raw of unknown) expect(lastErrorLabel(raw), JSON.stringify(raw)).toBe('Erro inesperado no servidor.')
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

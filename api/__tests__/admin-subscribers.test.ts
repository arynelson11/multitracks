import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeDb, createRes, type FakeDb, type FakeRes, type Row } from './fakeSupabase.js'
import { asaasDown, asaasRejected, createFakeAsaas, payment, type FakeAsaas } from './billingHarness.js'
import { AsaasError } from '../_lib/asaas.js'
import { createAdminRouter } from '../_lib/admin/http.js'
import { compareWithAsaas, handlers, type SubscriptionRow } from '../_lib/admin/subscribers.js'
// A guarda de forma da tela (T17, src/admin/lib/subscribersTypes.ts): a resposta
// do servidor tem que passar por ela, senão a aba mostra a frase de erro no lugar
// dos dados. Importada em tempo de execução pelo caminho numa variável: o tsc do
// api (NodeNext) não entra no arquivo do front, que importa sem extensão.
type ScreenGuards = { isSubscriberPage: (v: unknown) => boolean; isSubscriberDetailData: (v: unknown) => boolean }
const SCREEN_GUARDS = '../../src/admin/lib/subscribersTypes.ts'
const { isSubscriberPage, isSubscriberDetailData } = (await import(/* @vite-ignore */ SCREEN_GUARDS)) as ScreenGuards

// Assinantes (Task 25): a lista (admin_list_subscribers) e a ficha da conta
// (admin_subscriber_detail), SQL da T21; aqui o contrato vai pelo RPC falso. A
// ficha consulta o Asaas na hora (D14, só leitura, Asaas falso, sem rede) e
// mostra cada diferença entre o app e o Asaas numa frase pronta. O vencimento
// compara a cobrança em aberto do ciclo, nunca o nextDueDate da assinatura.

const ADMIN_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const USER_ID = '11111111-1111-4111-8111-111111111111'
const NOW = new Date('2026-11-16T15:00:00Z')
const TRAVESSAO = String.fromCharCode(0x2014)
const NBSP = String.fromCharCode(0x00a0)

const MSG = {
  unexpected: 'Erro inesperado no servidor.',
  notFound: 'Conta não encontrada.',
  asaasSilent: 'O Asaas não respondeu agora.',
  asaasNoKey: 'Não deu pra consultar o Asaas: configuração do servidor incompleta. Avise o suporte.',
  notChecked: 'Não conferida agora: a ficha consulta no máximo 3 assinaturas.',
}

// Cada frase de diferença começa dizendo de qual assinatura é: o plano e o mês
// de começo em Brasília, sem id técnico. A linha padrão do teste é Pro Mensal
// começada em outubro de 2026.
const ofSub = (text: string, label = 'Assinatura Pro Mensal de 10/2026'): string => `${label}: ${text}`

let db: FakeDb
let asaas: FakeAsaas | null
let responses: FakeRes[]
let listAnswer: (args: Record<string, unknown>) => unknown
let detailAnswer: (args: Record<string, unknown>) => unknown

vi.mock('../_lib/auth.js', () => ({
  verifyAdmin: vi.fn(async () => ({ ok: true, userId: ADMIN_ID, email: 'admin@igreja.com', isAdmin: true, blocked: false })),
}))
vi.mock('@supabase/supabase-js', () => ({ createClient: vi.fn(() => db) }))
vi.mock('../_lib/asaas.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('../_lib/asaas.js')>()
  return { ...real, asaasFromEnv: vi.fn(() => asaas) }
})

const router = createAdminRouter(handlers)

async function call(action: string, query: Record<string, unknown> = {}, method = 'GET'): Promise<FakeRes> {
  const res = createRes()
  await router({ method, query: { action, ...query }, headers: { authorization: 'Bearer admin' } }, res)
  responses.push(res)
  return res
}
const list = (query: Record<string, unknown> = {}) => call('subscribers', query)
const detail = (query: Record<string, unknown> = { userId: USER_ID }) => call('subscriber', query)
const body = (res: FakeRes) => res.body as Record<string, unknown>

// ── O que as funções SQL devolvem (sem os campos do servidor)

function listRow(over: Row = {}): Row {
  return {
    userId: USER_ID, email: 'quem@igreja.com', name: 'Quem', plan: 'essencial_mensal', courtesyPlan: null,
    status: 'paid_active', nextDueDate: '2026-12-17', accessUntil: null, separationsMonth: 3,
    createdAt: '2026-10-01T12:00:00+00:00', lastSeenAt: '2026-11-16T12:00:00+00:00', lastSignInAt: '2026-11-15T12:00:00+00:00',
    flags: ['due7'], ...over,
  }
}

function subscription(over: Partial<SubscriptionRow> = {}): SubscriptionRow {
  return {
    id: 'sref-1', kind: 'asaas', planKey: 'essencial_mensal', cycle: 'MONTHLY', status: 'active',
    startedAt: '2026-10-17T12:00:00+00:00', nextDueDate: '2026-12-17', paidUntil: '2026-12-17', accessUntil: null,
    cancelSource: null, canceledAt: null, asaasSubscriptionId: 'sub_1', asaasStoppedAt: null, lastPaidDueDate: '2026-11-17',
    needsAdminReview: false, adminNote: null, ...over,
  }
}

function detailRow(over: Row = {}, profile: Row = {}): Row {
  return {
    profile: {
      userId: USER_ID, email: 'quem@igreja.com', name: 'Quem', provider: 'email', plan: 'essencial_mensal', planExpiresAt: null,
      isAdmin: false, blockedAt: null, blockedReason: null, createdAt: '2026-10-01T12:00:00+00:00',
      lastSignInAt: '2026-11-15T12:00:00+00:00', lastSeenAt: '2026-11-16T12:00:00+00:00', ...profile,
    },
    quota: { used: 3, bonus: 2, periodStart: '2026-11-01T03:00:00+00:00', resetsAt: '2026-12-01T03:00:00+00:00' },
    subscriptions: [subscription()],
    payments: [],
    legacyPayments: [],
    separations: { month: 3, total: 10 },
    aiCost: { monthBrl: 1.2, totalBrl: 4.5, jobsWithoutCost: 0 },
    openActions: [],
    ...over,
  }
}

// ── Asaas falso: a assinatura por id e as cobranças por assinatura.

type Answer = unknown | AsaasError | (() => unknown)
type AsaasWorld = { subs: Record<string, Answer>; payments: Record<string, Answer> }

// Assinatura como o Asaas devolve: o nextDueDate aponta pra PRÓXIMA cobrança a
// ser gerada (a de dezembro já foi gerada com antecedência).
const liveSub = (over: Row = {}): Row => ({
  object: 'subscription', id: 'sub_1', customer: 'cus_1', status: 'ACTIVE', value: 49.9, cycle: 'MONTHLY',
  nextDueDate: '2027-01-17', deleted: false, description: 'texto interno do Asaas', ...over,
})
const paidNov = payment({ id: 'pay_nov', status: 'CONFIRMED', dueDate: '2026-11-17', originalDueDate: '2026-11-17', confirmedDate: '2026-11-17' })
const openDec = payment({ id: 'pay_dez', status: 'PENDING', dueDate: '2026-12-17', originalDueDate: '2026-12-17', confirmedDate: null })

function setAsaas(world: Partial<AsaasWorld> = {}): FakeAsaas {
  const w: AsaasWorld = { subs: { sub_1: liveSub() }, payments: { sub_1: [paidNov, openDec] }, ...world }
  const answer = (v: Answer): unknown => {
    if (v instanceof Error) throw v
    return typeof v === 'function' ? (v as () => unknown)() : v
  }
  const fake = createFakeAsaas({
    get: (path, params) => {
      const sub = /^\/subscriptions\/(.+)$/.exec(path)
      if (sub) {
        const id = decodeURIComponent(sub[1])
        if (!Object.hasOwn(w.subs, id)) throw new AsaasError('not_found', 'não encontrado no Asaas', 404)
        return answer(w.subs[id])
      }
      if (path === '/payments') {
        const id = String((params as { subscription?: unknown } | undefined)?.subscription)
        const v = answer(w.payments[id] ?? [])
        return v instanceof Promise ? v.then((data) => ({ data, hasMore: false })) : { data: v, hasMore: false }
      }
      throw new Error(`rota inesperada no Asaas falso: ${path}`)
    },
  })
  asaas = fake
  return fake
}

const subCalls = (fake: FakeAsaas) => fake.get.mock.calls.filter(([path]) => String(path).startsWith('/subscriptions/')).map(([path]) => String(path))
const paymentCalls = (fake: FakeAsaas) => fake.get.mock.calls.filter(([path]) => path === '/payments').map(([, params]) => (params as { subscription: string }).subscription)
const listArgs = () => db.rpcCalls.filter((c) => c.name === 'admin_list_subscribers').map((c) => c.args)

beforeEach(() => {
  vi.useFakeTimers({ now: NOW, toFake: ['Date'] })
  vi.stubEnv('VITE_SUPABASE_URL', 'https://fake.supabase.co')
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'fake-service-role')
  vi.spyOn(console, 'error').mockImplementation(() => {})
  responses = []
  asaas = null
  listAnswer = () => ({ total: 1, rows: [listRow()] })
  detailAnswer = () => detailRow()
  db = createFakeDb({ rpc: { admin_list_subscribers: (a) => listAnswer(a), admin_subscriber_detail: (a) => detailAnswer(a) } })
})

afterEach(() => {
  for (const res of responses) {
    const text = JSON.stringify(res.body ?? null)
    expect(text.includes(TRAVESSAO)).toBe(false)
    expect(text.includes(NBSP)).toBe(false)
    expect(res.headers['Cache-Control']).toBe('no-store')
  }
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
})

// ── Lista

describe('lista de assinantes', () => {
  it('repassa as linhas do banco com page e pageSize', async () => {
    const res = await list()
    expect(res.statusCode).toBe(200)
    expect(res.body).toEqual({ total: 1, page: 1, pageSize: 50, rows: [listRow()] })
  })

  it('all e none viram null', async () => {
    await list({ plan: 'all', status: 'all', flag: 'none' })
    // parâmetro ausente (a tela não manda "todos") e vazio também são sem filtro
    await list()
    await list({ q: '   ', plan: '', status: '', flag: '', sort: '', page: '' })
    const none = { p_search: null, p_plan: null, p_status: null, p_flag: null, p_sort: 'created', p_limit: 50, p_offset: 0 }
    expect(listArgs()).toEqual([none, none, none])
    for (const res of responses) expect(res.statusCode).toBe(200)
  })

  it('filtro de verdade vai pro banco como veio, a busca sem os espaços das pontas', async () => {
    await list({ q: '  Quem@Igreja ', plan: 'pro_anual', status: 'ending', flag: 'inactive30', sort: 'last_seen', page: '3' })
    expect(listArgs()).toEqual([{
      p_search: 'Quem@Igreja', p_plan: 'pro_anual', p_status: 'ending', p_flag: 'inactive30', p_sort: 'last_seen', p_limit: 50, p_offset: 100,
    }])
    expect(body(responses[0]).page).toBe(3)
  })

  it('cada valor aceito de plano, status, marcação e ordem passa', async () => {
    const accepted: [string, string[]][] = [
      ['plan', ['essencial_mensal', 'essencial_anual', 'pro_mensal', 'pro_anual']],
      ['status', ['paid_active', 'ending', 'courtesy', 'free', 'blocked']],
      ['flag', ['review', 'red', 'due7', 'blocked', 'inactive30']],
      ['sort', ['created', 'separations', 'last_seen']],
    ]
    for (const [key, values] of accepted) {
      for (const value of values) {
        const res = await list({ [key]: value })
        expect(res.statusCode, `${key}=${value}`).toBe(200)
      }
    }
  })

  it('filtros inválidos respondem 400', async () => {
    const cases: [Record<string, unknown>, string][] = [
      [{ plan: 'free' }, 'O plano está em formato inválido.'],
      [{ plan: 'ALL' }, 'O plano está em formato inválido.'],
      [{ status: 'active' }, 'O status está em formato inválido.'],
      [{ flag: 'all' }, 'A marcação está em formato inválido.'],
      [{ flag: 'review,red' }, 'A marcação está em formato inválido.'],
      [{ sort: 'email' }, 'A ordem está em formato inválido.'],
      [{ page: '0' }, 'A página precisa ser um número de 1 a 1000.'],
      [{ page: '1001' }, 'A página precisa ser um número de 1 a 1000.'],
      [{ page: '1.5' }, 'A página precisa ser um número de 1 a 1000.'],
      [{ q: 'a'.repeat(121) }, 'A busca pode ter no máximo 120 caracteres.'],
      [{ plan: ['pro_mensal', 'pro_anual'] }, 'Campo repetido: plan.'],
      [{ userId: USER_ID }, 'Campo não esperado: userId.'],
      [{ p_limit: '1000' }, 'Campo não esperado: p_limit.'],
    ]
    for (const [query, error] of cases) {
      const res = await list(query)
      expect(res.statusCode, JSON.stringify(query)).toBe(400)
      expect(res.body, JSON.stringify(query)).toEqual({ error })
    }
    // a busca de 120 caracteres ainda passa
    expect((await list({ q: 'a'.repeat(120) })).statusCode).toBe(200)
    expect(listArgs()).toHaveLength(1)
  })

  it('POST é recusado', async () => {
    const res = await call('subscribers', {}, 'POST')
    expect(res.statusCode).toBe(405)
    expect(listArgs()).toEqual([])
  })

  it('erro do banco ou resposta fora do formato vira erro inesperado, sem detalhe do banco', async () => {
    const bad: unknown[] = [null, [], { rows: [] }, { total: 1 }, { total: -1, rows: [] }, { total: 1, rows: {} }]
    for (const value of bad) {
      listAnswer = () => value
      const res = await list()
      expect(res.statusCode, JSON.stringify(value)).toBe(500)
      expect(res.body).toEqual({ error: MSG.unexpected })
    }
    listAnswer = () => { throw new Error('relation "auth.users" does not exist') }
    const res = await list()
    expect(res.statusCode).toBe(500)
    expect(res.body).toEqual({ error: MSG.unexpected })
  })

  it('total que chega como texto (bigint) vira número', async () => {
    listAnswer = () => ({ total: '120', rows: [] })
    const res = await list({ page: '3' })
    expect(res.body).toEqual({ total: 120, page: 3, pageSize: 50, rows: [] })
  })
})

// ── Ficha

describe('ficha do assinante', () => {
  it('conta inexistente responde 404', async () => {
    setAsaas()
    detailAnswer = () => null
    const res = await detail()
    expect(res.statusCode).toBe(404)
    expect(res.body).toEqual({ error: MSG.notFound })
    expect(db.rpcCalls).toEqual([{ name: 'admin_subscriber_detail', args: { p_user: USER_ID } }])
    expect(asaas!.get).not.toHaveBeenCalled()
  })

  it('id de conta inválido ou ausente responde 400 sem ir ao banco', async () => {
    const cases: [Record<string, unknown>, number, string][] = [
      [{}, 400, 'Preencha a conta.'],
      [{ userId: 'nao-e-uuid' }, 400, 'A conta está em formato inválido.'],
      [{ userId: `${USER_ID}' or 1=1` }, 400, 'A conta está em formato inválido.'],
      [{ userId: USER_ID, plan: 'all' }, 400, 'Campo não esperado: plan.'],
    ]
    for (const [query, status, error] of cases) {
      const res = await detail(query)
      expect(res.statusCode, JSON.stringify(query)).toBe(status)
      expect(res.body).toEqual({ error })
    }
    expect(db.rpcCalls).toEqual([])
  })

  it('o id vai pro banco em minúsculas', async () => {
    setAsaas()
    await detail({ userId: USER_ID.toUpperCase() })
    expect(db.rpcCalls).toEqual([{ name: 'admin_subscriber_detail', args: { p_user: USER_ID } }])
  })

  it('a ficha repassa o banco e acrescenta limite, planos, Asaas e diferenças', async () => {
    setAsaas()
    const res = await detail()
    expect(res.statusCode).toBe(200)
    const sql = detailRow()
    expect(res.body).toEqual({
      ...sql,
      quota: { ...(sql.quota as Row), limit: 50 },
      plans: [
        { key: 'essencial_mensal', label: 'Pro Mensal', value: 49.9, cycle: 'MONTHLY' },
        { key: 'essencial_anual', label: 'Pro Anual', value: 454.8, cycle: 'YEARLY' },
        { key: 'pro_mensal', label: 'Studio Mensal', value: 119.9, cycle: 'MONTHLY' },
        { key: 'pro_anual', label: 'Studio Anual', value: 1078.8, cycle: 'YEARLY' },
      ],
      asaasLive: [{ subscriptionRef: 'sref-1', ok: true, status: 'ACTIVE', value: 49.9, cycle: 'MONTHLY', openDueDate: '2026-12-17', deleted: false }],
      mismatches: [],
    })
    expect(subCalls(asaas!)).toEqual(['/subscriptions/sub_1'])
    expect(paymentCalls(asaas!)).toEqual(['sub_1'])
    // só leitura no Asaas
    expect(asaas!.post).not.toHaveBeenCalled()
    expect(asaas!.put).not.toHaveBeenCalled()
    expect(asaas!.del).not.toHaveBeenCalled()
  })

  it('limite de cota pelo plano efetivo e nulo pra admin', async () => {
    setAsaas()
    const cases: [Row, number | null][] = [
      [{ plan: 'pro_mensal' }, 150],
      [{ plan: 'pro_anual', planExpiresAt: '2026-12-31T03:00:00+00:00' }, 150],
      [{ plan: 'essencial_anual' }, 50],
      // cancelada com o período já acabado conta como Livre, mesmo com o plano pago gravado
      [{ plan: 'pro_mensal', planExpiresAt: '2026-11-16T14:59:59+00:00' }, 3],
      [{ plan: 'free' }, 3],
      [{ plan: 'plano_que_nao_existe' }, 3],
      [{ plan: 'constructor' }, 3],
      [{ plan: 'free', isAdmin: true }, null],
      [{ plan: 'pro_mensal', isAdmin: true }, null],
    ]
    for (const [profile, limit] of cases) {
      detailAnswer = () => detailRow({ subscriptions: [] }, profile)
      const res = await detail()
      expect(res.statusCode, JSON.stringify(profile)).toBe(200)
      expect((body(res).quota as Row).limit, JSON.stringify(profile)).toBe(limit)
      // used e bonus seguem como o banco mandou
      expect((body(res).quota as Row).bonus).toBe(2)
    }
  })

  it('o último erro das pendências da conta sai em frase pronta', async () => {
    setAsaas()
    const action = (id: number, lastError: string | null): Row => ({
      id, action: 'refund_payment', reason: 'estorno', autoRetry: false, attempts: 1, lastError, nextAttemptAt: '2026-11-16T12:00:00+00:00',
      createdAt: '2026-11-16T12:00:00+00:00', subscriptionRef: 'sref-1', asaasSubscriptionId: 'sub_1', paymentId: 'pay_1', dueDate: '2026-11-17',
      amount: 49.9, userId: USER_ID, email: 'quem@igreja.com', planKey: 'essencial_mensal',
    })
    detailAnswer = () => detailRow({ openActions: [action(1, 'Asaas recusou (400): The customer cpf is invalid'), action(2, null), action(3, 'duplicate key value violates unique constraint')] })
    const res = await detail()
    const labels = (body(res).openActions as Row[]).map((a) => a.lastError)
    expect(labels).toEqual(['O Asaas recusou o pedido. Status do Asaas: 400.', null, MSG.unexpected])
    expect(JSON.stringify(res.body)).not.toMatch(/cpf|duplicate key/)
  })

  it('banco fora do formato vira erro inesperado', async () => {
    setAsaas()
    const bad: unknown[] = [
      'texto', [], detailRow({ profile: null }), detailRow({ subscriptions: null }), detailRow({ subscriptions: ['x'] }),
      detailRow({ quota: [] }), detailRow({ payments: {} }), detailRow({ openActions: null }), detailRow({ legacyPayments: 1 }),
      detailRow({ separations: null }), detailRow({ aiCost: null }), detailRow({}, { userId: 7 }),
    ]
    for (const value of bad) {
      detailAnswer = () => value
      const res = await detail()
      expect(res.statusCode).toBe(500)
      expect(res.body).toEqual({ error: MSG.unexpected })
    }
    expect(asaas!.get).not.toHaveBeenCalled()
  })

  it('ficha sem assinatura não consulta o Asaas', async () => {
    const fake = setAsaas()
    const nothingToAsk: Row[][] = [
      [],
      // cortesia não tem Asaas; paga sem id do Asaas; encerrada que o Asaas já confirmou que parou
      [subscription({ id: 'c-1', kind: 'courtesy', asaasSubscriptionId: null })],
      [subscription({ id: 's-2', asaasSubscriptionId: null }), subscription({ id: 's-3', asaasSubscriptionId: '' })],
      [subscription({ id: 's-4', status: 'canceled', asaasStoppedAt: '2026-11-10T12:00:00+00:00' })],
    ]
    for (const subscriptions of nothingToAsk) {
      detailAnswer = () => detailRow({ subscriptions })
      const res = await detail()
      expect(res.statusCode).toBe(200)
      expect(body(res).asaasLive).toEqual([])
      expect(body(res).mismatches).toEqual([])
    }
    expect(fake.get).not.toHaveBeenCalled()
  })

  it('sem nada pra consultar, a falta da chave do Asaas não aparece', async () => {
    asaas = null
    detailAnswer = () => detailRow({ subscriptions: [] })
    const res = await detail()
    expect(res.statusCode).toBe(200)
    expect(body(res).asaasLive).toEqual([])
    expect(vi.mocked(console.error)).not.toHaveBeenCalled()
  })

  it('no máximo 3 consultas ao Asaas, as ativas primeiro, e as que sobram aparecem como não conferidas', async () => {
    const ids = ['sub_a', 'sub_b', 'sub_c', 'sub_d', 'sub_e']
    const fake = setAsaas({
      subs: Object.fromEntries(ids.map((id) => [id, liveSub({ id })])),
      payments: Object.fromEntries(ids.map((id) => [id, []])),
    })
    detailAnswer = () => detailRow({
      subscriptions: [
        subscription({ id: 'c-1', kind: 'courtesy', asaasSubscriptionId: null }),
        subscription({ id: 'r-a', asaasSubscriptionId: 'sub_a' }),
        subscription({ id: 'r-stop', status: 'canceled', asaasSubscriptionId: 'sub_stop', asaasStoppedAt: '2026-11-01T12:00:00+00:00' }),
        subscription({ id: 'r-b', status: 'canceled', asaasSubscriptionId: 'sub_b', asaasStoppedAt: null }),
        subscription({ id: 'r-c', asaasSubscriptionId: 'sub_c' }),
        subscription({ id: 'r-d', asaasSubscriptionId: 'sub_d' }),
        subscription({ id: 'r-e', status: 'canceled', asaasSubscriptionId: 'sub_e' }),
      ],
    })
    const res = await detail()
    expect(res.statusCode).toBe(200)
    // elegíveis na ordem da ficha: r-a, r-b, r-c, r-d, r-e; as ativas (r-a, r-c, r-d) vão primeiro
    expect(subCalls(fake)).toEqual(['/subscriptions/sub_a', '/subscriptions/sub_c', '/subscriptions/sub_d'])
    expect(paymentCalls(fake)).toEqual(['sub_a', 'sub_c', 'sub_d'])
    const lives = body(res).asaasLive as Row[]
    expect(lives.map((l) => l.subscriptionRef)).toEqual(['r-a', 'r-c', 'r-d', 'r-b', 'r-e'])
    expect(lives.slice(0, 3).map((l) => l.ok)).toEqual([true, true, true])
    // as que passaram de 3 têm a sua linha, sem consulta ao Asaas
    expect(lives.slice(3)).toEqual([
      { subscriptionRef: 'r-b', ok: false, error: MSG.notChecked },
      { subscriptionRef: 'r-e', ok: false, error: MSG.notChecked },
    ])
  })

  it('com 5 assinaturas e a ativa por último, a ativa é conferida e as 2 que sobram aparecem como não conferidas', async () => {
    const ids = ['sub_1', 'sub_2', 'sub_3', 'sub_4', 'sub_5']
    const fake = setAsaas({
      subs: Object.fromEntries(ids.map((id) => [id, liveSub({ id, status: 'INACTIVE' })])),
      payments: Object.fromEntries(ids.map((id) => [id, []])),
    })
    // A ficha vem com as mais novas primeiro: 4 encerradas sem a parada
    // confirmada e, por último, a ativa mais antiga (a que dá o acesso).
    detailAnswer = () => detailRow({
      subscriptions: [
        subscription({ id: 'r-1', status: 'canceled', asaasSubscriptionId: 'sub_1', startedAt: '2026-11-10T12:00:00+00:00' }),
        subscription({ id: 'r-2', status: 'canceled', asaasSubscriptionId: 'sub_2', startedAt: '2026-11-05T12:00:00+00:00' }),
        subscription({ id: 'r-3', status: 'canceled', asaasSubscriptionId: 'sub_3', startedAt: '2026-11-01T12:00:00+00:00' }),
        subscription({ id: 'r-4', status: 'canceled', asaasSubscriptionId: 'sub_4', startedAt: '2026-10-20T12:00:00+00:00' }),
        subscription({ id: 'r-5', asaasSubscriptionId: 'sub_5', startedAt: '2026-03-17T12:00:00+00:00' }),
      ],
    })
    const res = await detail()
    expect(res.statusCode).toBe(200)
    expect(subCalls(fake)).toEqual(['/subscriptions/sub_5', '/subscriptions/sub_1', '/subscriptions/sub_2'])
    expect(paymentCalls(fake)).toEqual(['sub_5', 'sub_1', 'sub_2'])
    expect(body(res).asaasLive).toEqual([
      { subscriptionRef: 'r-5', ok: true, status: 'INACTIVE', value: 49.9, cycle: 'MONTHLY', openDueDate: null, deleted: false },
      { subscriptionRef: 'r-1', ok: true, status: 'INACTIVE', value: 49.9, cycle: 'MONTHLY', openDueDate: null, deleted: false },
      { subscriptionRef: 'r-2', ok: true, status: 'INACTIVE', value: 49.9, cycle: 'MONTHLY', openDueDate: null, deleted: false },
      { subscriptionRef: 'r-3', ok: false, error: MSG.notChecked },
      { subscriptionRef: 'r-4', ok: false, error: MSG.notChecked },
    ])
    // a ativa parada no Asaas é a diferença, e a frase diz de qual assinatura é
    expect(body(res).mismatches).toEqual([ofSub('no Asaas ela está inativa, mas no app ela está ativa.', 'Assinatura Pro Mensal de 03/2026')])
  })

  it('sem a chave do Asaas, as que passam de 3 também aparecem como não conferidas', async () => {
    asaas = null
    detailAnswer = () => detailRow({
      subscriptions: ['a', 'b', 'c', 'd'].map((x) => subscription({ id: `r-${x}`, asaasSubscriptionId: `sub_${x}` })),
    })
    const res = await detail()
    expect(body(res).asaasLive).toEqual([
      { subscriptionRef: 'r-a', ok: false, error: MSG.asaasNoKey },
      { subscriptionRef: 'r-b', ok: false, error: MSG.asaasNoKey },
      { subscriptionRef: 'r-c', ok: false, error: MSG.asaasNoKey },
      { subscriptionRef: 'r-d', ok: false, error: MSG.notChecked },
    ])
  })

  it('a data compara a cobrança em aberto, não o nextDueDate da assinatura', async () => {
    // O Asaas já gerou a cobrança de dezembro: o nextDueDate da assinatura
    // (2027-01-17) é a próxima a ser gerada e não é diferença.
    setAsaas()
    let res = await detail()
    expect(body(res).mismatches).toEqual([])
    expect((body(res).asaasLive as Row[])[0].openDueDate).toBe('2026-12-17')

    // A cobrança de dezembro teve o vencimento mudado no Asaas: o ciclo é o
    // vencimento original, a data mostrada é a de agora.
    const moved = payment({ id: 'pay_dez', status: 'OVERDUE', dueDate: '2026-12-16', originalDueDate: '2026-12-17', confirmedDate: null })
    // a de janeiro em aberto (ciclo maior) e uma removida (de ciclo menor) não contam
    const jan = payment({ id: 'pay_jan', status: 'PENDING', dueDate: '2027-01-17', originalDueDate: '2027-01-17', confirmedDate: null })
    const gone = payment({ id: 'pay_x', status: 'PENDING', dueDate: '2026-12-01', originalDueDate: '2026-12-01', confirmedDate: null, deleted: true })
    setAsaas({ payments: { sub_1: [jan, gone, paidNov, moved] } })
    res = await detail()
    expect((body(res).asaasLive as Row[])[0].openDueDate).toBe('2026-12-16')
    expect(body(res).mismatches).toEqual([ofSub('no Asaas a cobrança em aberto vence em 16/12/2026, mas no app a próxima cobrança é 17/12/2026.')])
  })

  it('cobrança em análise de risco também é a cobrança em aberto do ciclo', async () => {
    const risk = payment({ id: 'pay_dez', status: 'AWAITING_RISK_ANALYSIS', dueDate: '2026-12-18', originalDueDate: '2026-12-18', confirmedDate: null })
    setAsaas({ payments: { sub_1: [paidNov, risk] } })
    const res = await detail()
    expect((body(res).asaasLive as Row[])[0].openDueDate).toBe('2026-12-18')
    expect(body(res).mismatches).toEqual([ofSub('no Asaas a cobrança em aberto vence em 18/12/2026, mas no app a próxima cobrança é 17/12/2026.')])
  })

  it('com pagamento ainda não contado a data não é comparada', async () => {
    // Dezembro já foi pago no Asaas e o app ainda não contou (último pago é
    // novembro): a de janeiro em aberto não vira diferença.
    const paidDec = payment({ id: 'pay_dez', status: 'RECEIVED', dueDate: '2026-12-17', originalDueDate: '2026-12-17', confirmedDate: '2026-11-16' })
    const jan = payment({ id: 'pay_jan', status: 'PENDING', dueDate: '2027-01-17', originalDueDate: '2027-01-17', confirmedDate: null })
    setAsaas({ payments: { sub_1: [paidNov, paidDec, jan] } })
    const res = await detail()
    expect((body(res).asaasLive as Row[])[0]).toMatchObject({ ok: true, openDueDate: null })
    expect(body(res).mismatches).toEqual([])
  })

  it('sem último pago guardado, qualquer cobrança paga espera o app contar', async () => {
    setAsaas({ payments: { sub_1: [paidNov, openDec] } })
    detailAnswer = () => detailRow({ subscriptions: [subscription({ lastPaidDueDate: null, nextDueDate: '2026-11-17' })] })
    const res = await detail()
    expect((body(res).asaasLive as Row[])[0]).toMatchObject({ openDueDate: null })
    expect(body(res).mismatches).toEqual([])
  })

  it('404 do Asaas conta como removida', async () => {
    setAsaas({ subs: {} })
    const res = await detail()
    expect(res.statusCode).toBe(200)
    expect(body(res).asaasLive).toEqual([{ subscriptionRef: 'sref-1', ok: true, status: '', value: null, cycle: '', openDueDate: '2026-12-17', deleted: true }])
    expect(body(res).mismatches).toEqual([ofSub('no Asaas ela está removida, mas no app ela está ativa.')])
  })

  it('assinatura com deleted true no Asaas também é removida', async () => {
    setAsaas({ subs: { sub_1: liveSub({ deleted: true, value: 119.9 }) } })
    const res = await detail()
    expect((body(res).asaasLive as Row[])[0]).toMatchObject({ ok: true, deleted: true })
    // removida: o valor de uma assinatura que não cobra mais não vira diferença
    expect(body(res).mismatches).toEqual([ofSub('no Asaas ela está removida, mas no app ela está ativa.')])
  })

  it('valor diferente sai com o valor em reais, sem espaço inquebrável', async () => {
    setAsaas({ subs: { sub_1: liveSub({ value: 119.9 }) } })
    const res = await detail()
    expect(body(res).mismatches).toEqual([ofSub('no Asaas o valor é R$ 119,90, mas o plano no app é Pro Mensal (R$ 49,90).')])
  })

  it('texto do Asaas que não é código não passa pra resposta', async () => {
    setAsaas({ subs: { sub_1: liveSub({ status: 'Assinatura <b>ativa</b>', cycle: 42, value: '49.90' }) } })
    const res = await detail()
    expect((body(res).asaasLive as Row[])[0]).toEqual({
      subscriptionRef: 'sref-1', ok: true, status: '', value: null, cycle: '', openDueDate: '2026-12-17', deleted: false,
    })
    // sem status que se reconheça, a ficha não diz que está tudo certo
    expect(body(res).mismatches).toEqual([ofSub('no Asaas ela está num estado que o app não reconhece, mas no app ela está ativa.')])
    expect(JSON.stringify(res.body)).not.toMatch(/<b>|texto interno/)
  })

  it('Asaas fora: a ficha abre com aviso e sem diferenças', async () => {
    const failures: [string, Partial<AsaasWorld>][] = [
      ['assinatura sem resposta', { subs: { sub_1: asaasDown() } }],
      ['cobranças sem resposta', { subs: { sub_1: liveSub({ value: 119.9, status: 'INACTIVE' }) }, payments: { sub_1: asaasDown() } }],
      ['Asaas respondeu 503', { subs: { sub_1: new AsaasError('unavailable', 'Asaas respondeu 503', 503) } }],
      ['Asaas recusou com descrição', { subs: { sub_1: asaasRejected('The access_token is invalid') } }],
    ]
    for (const [name, world] of failures) {
      setAsaas(world)
      const res = await detail()
      expect(res.statusCode, name).toBe(200)
      expect(body(res).asaasLive, name).toEqual([{ subscriptionRef: 'sref-1', ok: false, error: MSG.asaasSilent }])
      expect(body(res).mismatches, name).toEqual([])
      // o resto da ficha abre normalmente
      expect((body(res).profile as Row).userId, name).toBe(USER_ID)
      expect((body(res).quota as Row).limit, name).toBe(50)
      expect(JSON.stringify(res.body), name).not.toMatch(/ECONNRESET|access_token|recusou|503/)
    }
    // o detalhe vai pro log
    expect(vi.mocked(console.error).mock.calls.flat().join(' ')).toContain('ECONNRESET')
  })

  it('uma assinatura com o Asaas fora não esconde a outra', async () => {
    setAsaas({ subs: { sub_1: asaasDown(), sub_2: liveSub({ id: 'sub_2', status: 'ACTIVE' }) }, payments: { sub_2: [] } })
    detailAnswer = () => detailRow({
      subscriptions: [subscription(), subscription({ id: 'sref-2', status: 'canceled', asaasSubscriptionId: 'sub_2' })],
    })
    const res = await detail()
    expect(body(res).asaasLive).toEqual([
      { subscriptionRef: 'sref-1', ok: false, error: MSG.asaasSilent },
      { subscriptionRef: 'sref-2', ok: true, status: 'ACTIVE', value: 49.9, cycle: 'MONTHLY', openDueDate: null, deleted: false },
    ])
    expect(body(res).mismatches).toEqual([ofSub('o Asaas ainda cobra, mas no app ela está encerrada.')])
  })

  it('Asaas lento: passa de 5 s e vira aviso', async () => {
    vi.useRealTimers()
    vi.useFakeTimers({ now: NOW })
    setAsaas({ payments: { sub_1: () => new Promise(() => {}) } })
    let settled = false
    const pending = detail().then((res) => { settled = true; return res })
    await vi.advanceTimersByTimeAsync(4999)
    expect(settled).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    const res = await pending
    expect(res.statusCode).toBe(200)
    expect(body(res).asaasLive).toEqual([{ subscriptionRef: 'sref-1', ok: false, error: MSG.asaasSilent }])
    expect(body(res).mismatches).toEqual([])
  })

  it('servidor sem a chave do Asaas: a ficha abre e diz que não consultou', async () => {
    asaas = null
    const res = await detail()
    expect(res.statusCode).toBe(200)
    expect(body(res).asaasLive).toEqual([{ subscriptionRef: 'sref-1', ok: false, error: MSG.asaasNoKey }])
    expect(body(res).mismatches).toEqual([])
    expect(JSON.stringify(res.body)).not.toContain('ASAAS_API_KEY')
  })

  it('erro do banco na ficha vira erro inesperado e não consulta o Asaas', async () => {
    setAsaas()
    detailAnswer = () => { throw new Error('permission denied for table profiles') }
    const res = await detail()
    expect(res.statusCode).toBe(500)
    expect(res.body).toEqual({ error: MSG.unexpected })
    expect(asaas!.get).not.toHaveBeenCalled()
  })
})

// ── A forma que a tela exige (guardas de src/admin/lib/subscribersTypes.ts)

describe('a resposta passa pela guarda da tela', () => {
  it('a lista, com page e pageSize do servidor (o SQL só manda total e rows)', async () => {
    listAnswer = () => ({ total: 2, rows: [listRow(), listRow({ userId: '22222222-2222-4222-8222-222222222222', flags: [] })] })
    expect(isSubscriberPage((await list()).body)).toBe(true)
    listAnswer = () => ({ total: 0, rows: [] })
    expect(isSubscriberPage((await list({ q: 'ninguem', page: '2' })).body)).toBe(true)
    // a guarda é a de verdade: o que o SQL manda sozinho não passa
    expect(isSubscriberPage({ total: 1, rows: [listRow()] })).toBe(false)
  })

  it('a ficha com o Asaas certo, diferente, removido, fora e sem chave', async () => {
    const worlds: (Partial<AsaasWorld> | null)[] = [
      {},
      { subs: { sub_1: liveSub({ value: 119.9, status: 'INACTIVE' }) } },
      { subs: {} },
      { subs: { sub_1: asaasDown() } },
      null,
    ]
    for (const world of worlds) {
      if (world) setAsaas(world)
      else asaas = null
      const res = await detail()
      expect(res.statusCode, JSON.stringify(world)).toBe(200)
      expect(isSubscriberDetailData(res.body), JSON.stringify(world)).toBe(true)
      for (const line of body(res).mismatches as string[]) expect(line).toMatch(/^Assinatura Pro Mensal de 10\/2026: /)
      // cada assinatura consultada tem a sua linha: a que não deu pra conferir vem com ok false
      expect((body(res).asaasLive as Row[]).length).toBe(1)
    }
    // sem assinatura nenhuma: listas vazias, ainda na forma
    detailAnswer = () => detailRow({ subscriptions: [] })
    expect(isSubscriberDetailData((await detail()).body)).toBe(true)
    // o que o SQL manda sozinho (sem plans, asaasLive e mismatches) não passa
    expect(isSubscriberDetailData(detailRow())).toBe(false)
  })
})

// ── Frases das diferenças

describe('compareWithAsaas', () => {
  const live = (over: Partial<Parameters<typeof compareWithAsaas>[1]> = {}): Parameters<typeof compareWithAsaas>[1] => ({
    status: 'ACTIVE', value: 49.9, cycle: 'MONTHLY', openDueDate: '2026-12-17', deleted: false, ...over,
  })

  it('tudo igual não tem diferença', () => {
    expect(compareWithAsaas(subscription(), live())).toEqual([])
    expect(compareWithAsaas(subscription({ status: 'canceled' }), live({ status: 'INACTIVE' }))).toEqual([])
    expect(compareWithAsaas(subscription({ status: 'canceled' }), live({ deleted: true }))).toEqual([])
    expect(compareWithAsaas(subscription({ planKey: 'pro_anual', cycle: 'YEARLY' }), live({ value: 1078.8, cycle: 'YEARLY', openDueDate: null }))).toEqual([])
  })

  it('app ativa e Asaas parado ou removido, em português', () => {
    expect(compareWithAsaas(subscription(), live({ status: 'INACTIVE' }))).toEqual([ofSub('no Asaas ela está inativa, mas no app ela está ativa.')])
    expect(compareWithAsaas(subscription(), live({ status: 'EXPIRED' }))).toEqual([ofSub('no Asaas ela está expirada, mas no app ela está ativa.')])
    expect(compareWithAsaas(subscription(), live({ status: '', value: null, cycle: '', openDueDate: null, deleted: true }))).toEqual([
      ofSub('no Asaas ela está removida, mas no app ela está ativa.'),
    ])
    // removida vale mais que o status que vier junto
    expect(compareWithAsaas(subscription(), live({ status: 'ACTIVE', deleted: true }))).toEqual([
      ofSub('no Asaas ela está removida, mas no app ela está ativa.'),
    ])
    expect(compareWithAsaas(subscription(), live({ status: 'INACTIVE', deleted: true }))).toEqual([
      ofSub('no Asaas ela está removida, mas no app ela está ativa.'),
    ])
  })

  it('status desconhecido do Asaas sai sem o código', () => {
    // status novo do Asaas, ou resposta sem status (o servidor já tira o texto que não é código)
    for (const status of ['SUSPENDED', 'PAUSED', 'ACTIVE_X', '']) {
      const lines = compareWithAsaas(subscription(), live({ status }))
      expect(lines, status).toEqual([ofSub('no Asaas ela está num estado que o app não reconhece, mas no app ela está ativa.')])
      if (status) expect(lines.join(' '), status).not.toContain(status)
    }
    // encerrada no app: só ACTIVE no Asaas é diferença
    for (const status of ['SUSPENDED', '', 'INACTIVE', 'EXPIRED']) {
      expect(compareWithAsaas(subscription({ status: 'canceled' }), live({ status })), status).toEqual([])
    }
  })

  it('cada frase diz de qual assinatura é, pelo plano e pelo mês de começo em Brasília', () => {
    // 02:30 UTC do dia 1º de março ainda é 28 de fevereiro em Brasília
    expect(compareWithAsaas(subscription({ startedAt: '2026-03-01T02:30:00+00:00' }), live({ status: 'INACTIVE' }))).toEqual([
      ofSub('no Asaas ela está inativa, mas no app ela está ativa.', 'Assinatura Pro Mensal de 02/2026'),
    ])
    expect(compareWithAsaas(subscription({ planKey: 'pro_mensal', startedAt: '2026-03-01T03:00:00+00:00' }), live({ status: 'EXPIRED', value: 119.9 }))).toEqual([
      ofSub('no Asaas ela está expirada, mas no app ela está ativa.', 'Assinatura Studio Mensal de 03/2026'),
    ])
    // sem data de começo que dê pra ler, fica só o plano; plano desconhecido, só o mês
    expect(compareWithAsaas(subscription({ startedAt: '' }), live({ status: 'INACTIVE' }))).toEqual([
      ofSub('no Asaas ela está inativa, mas no app ela está ativa.', 'Assinatura Pro Mensal'),
    ])
    expect(compareWithAsaas(subscription({ planKey: 'plano_x' as SubscriptionRow['planKey'] }), live({ status: 'INACTIVE' }))).toEqual([
      ofSub('no Asaas ela está inativa, mas no app ela está ativa.', 'Assinatura de 10/2026'),
    ])
    // nenhum id técnico na frase
    for (const line of compareWithAsaas(subscription(), live({ status: 'INACTIVE', value: 119.9, cycle: 'YEARLY', openDueDate: '2026-12-16' }))) {
      expect(line).toMatch(/^Assinatura Pro Mensal de 10\/2026: /)
      expect(line).not.toMatch(/sref|sub_|pay_/)
    }
  })

  it('ACTIVE no Asaas com a linha ativa não é diferença', () => {
    expect(compareWithAsaas(subscription(), live({ status: 'ACTIVE' }))).toEqual([])
  })

  it('app encerrada e o Asaas ainda cobra', () => {
    expect(compareWithAsaas(subscription({ status: 'canceled' }), live({ openDueDate: '2026-12-16' }))).toEqual([
      ofSub('o Asaas ainda cobra, mas no app ela está encerrada.'),
    ])
  })

  it('valor diferente do preço do plano no app', () => {
    expect(compareWithAsaas(subscription(), live({ value: 119.9 }))).toEqual([ofSub('no Asaas o valor é R$ 119,90, mas o plano no app é Pro Mensal (R$ 49,90).')])
    expect(compareWithAsaas(subscription({ planKey: 'pro_anual', cycle: 'YEARLY' }), live({ value: 1000, cycle: 'YEARLY' }))).toEqual([
      ofSub('no Asaas o valor é R$ 1.000,00, mas o plano no app é Studio Anual (R$ 1.078,80).', 'Assinatura Studio Anual de 10/2026'),
    ])
    // centavo de arredondamento do ponto flutuante não é diferença
    expect(compareWithAsaas(subscription(), live({ value: 49.900000001 }))).toEqual([])
    // sem valor do Asaas não se inventa diferença
    expect(compareWithAsaas(subscription(), live({ value: null }))).toEqual([])
  })

  it('ciclo diferente do plano no app', () => {
    expect(compareWithAsaas(subscription({ planKey: 'essencial_anual', cycle: 'YEARLY' }), live({ value: 454.8, cycle: 'MONTHLY' }))).toEqual([
      ofSub('no Asaas o ciclo é mensal, mas o plano no app é anual.', 'Assinatura Pro Anual de 10/2026'),
    ])
    expect(compareWithAsaas(subscription(), live({ cycle: 'YEARLY' }))).toEqual([ofSub('no Asaas o ciclo é anual, mas o plano no app é mensal.')])
    expect(compareWithAsaas(subscription(), live({ cycle: 'QUARTERLY' }))).toEqual([ofSub('no Asaas o ciclo é trimestral, mas o plano no app é mensal.')])
    expect(compareWithAsaas(subscription(), live({ cycle: '' }))).toEqual([])
  })

  it('vencimento da cobrança em aberto diferente da próxima cobrança do app', () => {
    expect(compareWithAsaas(subscription(), live({ openDueDate: '2026-12-16' }))).toEqual([
      ofSub('no Asaas a cobrança em aberto vence em 16/12/2026, mas no app a próxima cobrança é 17/12/2026.'),
    ])
    // só com a linha ativa e com cobrança em aberto conhecida
    expect(compareWithAsaas(subscription({ status: 'canceled' }), live({ status: 'INACTIVE', openDueDate: '2026-12-16' }))).toEqual([])
    expect(compareWithAsaas(subscription(), live({ openDueDate: null }))).toEqual([])
    expect(compareWithAsaas(subscription({ nextDueDate: null }), live({ openDueDate: '2026-12-16' }))).toEqual([])
  })

  it('várias diferenças juntas, na ordem: status, valor, ciclo, vencimento', () => {
    expect(compareWithAsaas(subscription(), live({ status: 'INACTIVE', value: 454.8, cycle: 'YEARLY', openDueDate: '2027-11-17' }))).toEqual([
      ofSub('no Asaas ela está inativa, mas no app ela está ativa.'),
      ofSub('no Asaas o valor é R$ 454,80, mas o plano no app é Pro Mensal (R$ 49,90).'),
      ofSub('no Asaas o ciclo é anual, mas o plano no app é mensal.'),
      ofSub('no Asaas a cobrança em aberto vence em 17/11/2027, mas no app a próxima cobrança é 17/12/2026.'),
    ])
  })

  it('nenhuma frase tem espaço inquebrável nem travessão', () => {
    const lines = compareWithAsaas(subscription({ planKey: 'pro_anual', cycle: 'YEARLY' }), live({ status: 'EXPIRED', value: 1234567.5, cycle: 'MONTHLY', openDueDate: '2026-01-02' }))
    expect(lines.length).toBeGreaterThan(0)
    for (const line of lines) {
      expect(line.includes(NBSP)).toBe(false)
      expect(line.includes(String.fromCharCode(0x202f))).toBe(false)
      expect(line.includes(TRAVESSAO)).toBe(false)
    }
    // nenhum código do Asaas (INACTIVE, EXPIRED, MONTHLY) na frase, com qualquer status
    for (const status of ['INACTIVE', 'EXPIRED', 'SUSPENDED', '']) {
      for (const line of compareWithAsaas(subscription(), live({ status, value: 119.9, cycle: 'YEARLY', openDueDate: '2026-12-16' }))) {
        expect(line, status).not.toMatch(/[A-Z]{3,}/)
      }
    }
  })
})

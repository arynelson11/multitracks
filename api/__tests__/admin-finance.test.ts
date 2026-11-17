import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeDb, createRes, type FakeDb, type FakeRes, type Row } from './fakeSupabase.js'
import { createAdminRouter } from '../_lib/admin/http.js'
import { handlers } from '../_lib/admin/finance.js'

// Financeiro (Task 14): a ação finance lista as cobranças de um período em dias
// de Brasília, com os totais, a receita por mês e as vencidas. O SQL de
// admin_finance é da T22 (Onda 3); aqui o contrato vai por setRpc. Os números
// (receita pelo que foi pago de fato, estornos, vencidas) saem do banco e o
// servidor repassa sem mexer: só acrescenta page e pageSize.

const ADMIN_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const USER_ID = '11111111-1111-4111-8111-111111111111'
const NOW = new Date('2026-11-16T15:00:00Z')
const TRAVESSAO = String.fromCharCode(0x2014)

const MSG = {
  inverted: 'A data inicial precisa vir antes da final.',
  tooLong: 'Escolha um período de até um ano.',
  badFrom: 'A data inicial está em formato inválido.',
  badTo: 'A data final está em formato inválido.',
  badStatus: 'O status está em formato inválido.',
  badPage: 'A página precisa ser um número de 1 a 1000.',
  unexpected: 'Erro inesperado no servidor.',
}

let db: FakeDb
let responses: FakeRes[]
let answer: (args: Record<string, unknown>) => unknown

vi.mock('../_lib/auth.js', () => ({
  verifyAdmin: vi.fn(async () => ({ ok: true, userId: ADMIN_ID, email: 'admin@igreja.com', isAdmin: true, blocked: false })),
}))
vi.mock('@supabase/supabase-js', () => ({ createClient: vi.fn(() => db) }))

const router = createAdminRouter(handlers)

async function get(query: Record<string, unknown> = {}, method = 'GET'): Promise<FakeRes> {
  const res = createRes()
  await router({ method, query: { action: 'finance', ...query }, headers: { authorization: 'Bearer admin' } }, res)
  responses.push(res)
  return res
}

function financeRow(over: Row = {}): Row {
  return {
    paymentId: 'pay_1', userId: USER_ID, email: 'quem@igreja.com', planKey: 'pro_mensal', status: 'CONFIRMED',
    value: 29.9, netValue: 28.7, dueDate: '2026-11-30', paymentDate: null, confirmedDate: '2026-11-30',
    refundedAt: null, lastEvent: 'PAYMENT_CONFIRMED', lastEventAt: '2026-12-01T02:30:00.123456+00:00', ...over,
  }
}

// O que a função SQL devolve (FinancePage sem page e pageSize).
function financePage(args: Record<string, unknown>, over: Row = {}): Row {
  return {
    range: { from: args.p_from, to: args.p_to },
    totals: { grossBrl: 29.9, netBrl: 28.7, paidCount: 1, refundedBrl: 0, overdueBrl: 9.9, overdueCount: 1 },
    byMonth: [{ month: '2026-11', grossBrl: 29.9, netBrl: 28.7, byPlan: { pro_mensal: 29.9 } }],
    overdue: [{ paymentId: 'pay_9', userId: USER_ID, email: 'quem@igreja.com', planKey: 'essencial_mensal', dueDate: '2026-10-20', value: 9.9 }],
    rows: [financeRow()],
    total: 1,
    ...over,
  }
}

const financeArgs = () => db.rpcCalls.filter((c) => c.name === 'admin_finance').map((c) => c.args)
const args = (p_from: string, p_to: string, p_status = 'all', p_offset = 0) => ({ p_from, p_to, p_status, p_limit: 50, p_offset })

beforeEach(() => {
  vi.useFakeTimers({ now: NOW, toFake: ['Date'] })
  vi.stubEnv('VITE_SUPABASE_URL', 'https://fake.supabase.co')
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'fake-service-role')
  vi.spyOn(console, 'error').mockImplementation(() => {})
  responses = []
  answer = (a) => financePage(a)
  db = createFakeDb({ rpc: { admin_finance: (a) => answer(a) } })
})

afterEach(() => {
  for (const res of responses) {
    expect(JSON.stringify(res.body ?? null).includes(TRAVESSAO)).toBe(false)
    expect(res.headers['Cache-Control']).toBe('no-store')
  }
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
})

describe('período em dias de Brasília', () => {
  it('sem datas usa o mês de Brasília', async () => {
    const res = await get()
    expect(res.statusCode).toBe(200)
    expect(financeArgs()).toEqual([args('2026-11-01', '2026-11-30')])
    expect(res.body).toEqual({ ...financePage(args('2026-11-01', '2026-11-30')), page: 1, pageSize: 50 })
  })

  it('às 23:30 do dia 30 em Brasília ainda é novembro', async () => {
    // 2026-12-01T02:30Z já é dezembro em UTC, mas em Brasília são 23:30 de 30/11.
    vi.setSystemTime(new Date('2026-12-01T02:30:00Z'))
    const res = await get()
    expect(res.statusCode).toBe(200)
    expect(financeArgs()).toEqual([args('2026-11-01', '2026-11-30')])
  })

  it('à meia-noite de Brasília do dia 1º já é dezembro, que vai até o dia 31', async () => {
    vi.setSystemTime(new Date('2026-12-01T03:00:00Z'))
    await get()
    expect(financeArgs()).toEqual([args('2026-12-01', '2026-12-31')])
  })

  it('fevereiro de ano bissexto vai até o dia 29', async () => {
    vi.setSystemTime(new Date('2028-02-10T12:00:00Z'))
    await get()
    expect(financeArgs()).toEqual([args('2028-02-01', '2028-02-29')])
  })

  it('datas informadas vão pro banco como vieram', async () => {
    const res = await get({ from: '2025-12-01', to: '2026-11-30' })
    expect(res.statusCode).toBe(200)
    expect(financeArgs()).toEqual([args('2025-12-01', '2026-11-30')])
    expect(res.body).toMatchObject({ range: { from: '2025-12-01', to: '2026-11-30' } })
  })

  it('um dia só vale (inicial igual à final)', async () => {
    const res = await get({ from: '2026-11-16', to: '2026-11-16' })
    expect(res.statusCode).toBe(200)
    expect(financeArgs()).toEqual([args('2026-11-16', '2026-11-16')])
  })

  it('só uma das datas: a outra vem do mês atual de Brasília', async () => {
    await get({ from: '2026-10-05' })
    await get({ to: '2026-12-15' })
    expect(financeArgs()).toEqual([args('2026-10-05', '2026-11-30'), args('2026-11-01', '2026-12-15')])
  })

  it('datas invertidas respondem 400', async () => {
    for (const q of [{ from: '2026-11-30', to: '2026-11-01' }, { from: '2026-11-17', to: '2026-11-16' }, { to: '2026-10-31' }]) {
      const res = await get(q)
      expect(res.statusCode, JSON.stringify(q)).toBe(400)
      expect(res.body, JSON.stringify(q)).toEqual({ error: MSG.inverted })
    }
    expect(db.rpcCalls).toEqual([])
  })

  it('até 366 dias contando os dois extremos vale; 367 responde 400', async () => {
    // 2028 é bissexto: o ano inteiro tem 366 dias.
    expect((await get({ from: '2028-01-01', to: '2028-12-31' })).statusCode).toBe(200)
    expect((await get({ from: '2026-01-01', to: '2027-01-01' })).statusCode).toBe(200)
    expect(financeArgs()).toEqual([args('2028-01-01', '2028-12-31'), args('2026-01-01', '2027-01-01')])
    for (const q of [{ from: '2026-01-01', to: '2027-01-02' }, { from: '2020-01-01', to: '2026-11-30' }, { from: '2025-11-01' }]) {
      const res = await get(q)
      expect(res.statusCode, JSON.stringify(q)).toBe(400)
      expect(res.body, JSON.stringify(q)).toEqual({ error: MSG.tooLong })
    }
    expect(financeArgs().length).toBe(2)
  })

  it('data fora do formato ou que não existe responde 400 sem ler o banco', async () => {
    for (const from of ['2026-02-30', '2026-1-5', '16/11/2026', 'ontem', "2026-11-01' or '1'='1", '2026-11-01T00:00:00Z']) {
      const res = await get({ from, to: '2026-11-30' })
      expect(res.statusCode, from).toBe(400)
      expect(res.body, from).toEqual({ error: MSG.badFrom })
    }
    const res = await get({ from: '2026-11-01', to: '2026-13-01' })
    expect(res.body).toEqual({ error: MSG.badTo })
    expect(db.rpcCalls).toEqual([])
  })

  it('data vazia vale como não informada', async () => {
    await get({ from: '', to: ' ' })
    expect(financeArgs()).toEqual([args('2026-11-01', '2026-11-30')])
  })
})

describe('status e página', () => {
  it('cada status conhecido vai pro banco; vazio vale como all', async () => {
    const statuses = ['all', 'paid', 'pending', 'overdue', 'refunded', 'deleted']
    for (const status of statuses) await get({ status })
    await get({ status: '' })
    expect(financeArgs().map((a) => a.p_status)).toEqual([...statuses, 'all'])
  })

  it('status desconhecido responde 400', async () => {
    for (const status of ['ALL', 'CONFIRMED', 'pago', "paid' or '1'='1", 'overdue ']) {
      const res = await get({ status })
      expect(res.statusCode, status).toBe(400)
      expect(res.body, status).toEqual({ error: MSG.badStatus })
    }
    expect(db.rpcCalls).toEqual([])
  })

  it('página 3 pede p_offset 100', async () => {
    answer = (a) => financePage(a, { total: 120, rows: [] })
    const res = await get({ page: '3', status: 'paid' })
    expect(res.statusCode).toBe(200)
    expect(financeArgs()).toEqual([args('2026-11-01', '2026-11-30', 'paid', 100)])
    expect(res.body).toMatchObject({ total: 120, page: 3, pageSize: 50, rows: [] })
  })

  it('a página 1000 é a última aceita', async () => {
    const res = await get({ page: '1000' })
    expect(res.statusCode).toBe(200)
    expect(financeArgs()).toEqual([args('2026-11-01', '2026-11-30', 'all', 49950)])
  })

  it('página fora de 1 a 1000 ou que não é número responde 400 sem ler o banco', async () => {
    for (const page of ['0', '1001', '-1', 'abc', '1.5']) {
      const res = await get({ page })
      expect(res.statusCode, page).toBe(400)
      expect(res.body, page).toEqual({ error: MSG.badPage })
    }
    expect(db.rpcCalls).toEqual([])
  })
})

describe('entrada estrita e respostas de erro', () => {
  it('campo que a ação não declarou responde 400 sem ler o banco', async () => {
    let res = await get({ pageSize: '500' })
    expect(res.statusCode).toBe(400)
    expect(res.body).toEqual({ error: 'Campo não esperado: pageSize.' })
    res = await get({ p_limit: '5000', p_offset: '0' })
    expect(res.body).toEqual({ error: 'Campos não esperados: p_limit, p_offset.' })
    expect(db.rpcCalls).toEqual([])
  })

  it('campo repetido responde 400', async () => {
    const res = await get({ status: ['paid', 'all'] })
    expect(res.statusCode).toBe(400)
    expect(res.body).toEqual({ error: 'Campo repetido: status.' })
    expect(db.rpcCalls).toEqual([])
  })

  it('a ação é só GET', async () => {
    const res = await get({}, 'POST')
    expect(res.statusCode).toBe(405)
    expect(res.body).toEqual({ error: 'Esta ação usa GET.' })
    expect(db.rpcCalls).toEqual([])
  })

  it('erro do banco responde a frase genérica, sem o texto do banco', async () => {
    db.setRpc('admin_finance', () => { throw new Error('column "confirmed_date" of relation "billing_payments" does not exist') })
    const res = await get()
    expect(res.statusCode).toBe(500)
    expect(res.body).toEqual({ error: MSG.unexpected })
    const text = JSON.stringify(res.body)
    for (const raw of ['confirmed_date', 'billing_payments', 'admin_finance']) expect(text).not.toContain(raw)
  })

  it('função ainda não criada no banco (Onda 3) responde a frase genérica', async () => {
    db = createFakeDb()
    const res = await get()
    expect(res.statusCode).toBe(500)
    expect(res.body).toEqual({ error: MSG.unexpected })
  })

  it('resposta do banco fora do formato responde a frase genérica, sem número pela metade', async () => {
    const bad: ((a: Record<string, unknown>) => unknown)[] = [
      () => null,
      () => [],
      () => 'ok',
      (a) => ({ ...financePage(a), total: undefined }),
      (a) => ({ ...financePage(a), total: 'x' }),
      (a) => ({ ...financePage(a), total: 1.5 }),
      (a) => ({ ...financePage(a), rows: {} }),
      (a) => ({ ...financePage(a), totals: null }),
      (a) => ({ ...financePage(a), totals: [] }),
      (a) => ({ ...financePage(a), byMonth: null }),
      (a) => ({ ...financePage(a), overdue: {} }),
      (a) => ({ ...financePage(a), range: null }),
      (a) => ({ ...financePage(a), range: { from: a.p_from } }),
    ]
    for (const [i, make] of bad.entries()) {
      answer = make
      const res = await get()
      expect(res.statusCode, String(i)).toBe(500)
      expect(res.body, String(i)).toEqual({ error: MSG.unexpected })
    }
  })

  it('total que o jsonb devolve como texto (bigint grande) vira número', async () => {
    answer = (a) => financePage(a, { total: '120' })
    const res = await get()
    expect(res.statusCode).toBe(200)
    expect(res.body).toMatchObject({ total: 120, page: 1, pageSize: 50 })
  })
})

describe('números do banco passam sem mexer', () => {
  it('totais, meses, vencidas e linhas saem como o banco mandou, com page e pageSize', async () => {
    answer = (a) => financePage(a, {
      totals: { grossBrl: 1234.56, netBrl: 1180.01, paidCount: 41, refundedBrl: 29.9, overdueBrl: 0, overdueCount: 0 },
      byMonth: [
        { month: '2025-12', grossBrl: 0, netBrl: 0, byPlan: {} },
        { month: '2026-11', grossBrl: 1234.56, netBrl: 1180.01, byPlan: { pro_mensal: 1000, essencial_anual: 234.56 } },
      ],
      overdue: [],
      rows: [financeRow(), financeRow({ paymentId: 'pay_2', status: 'REFUNDED', refundedAt: '2026-11-20', userId: null, email: null, planKey: null })],
      total: 2,
    })
    const res = await get({ status: 'all' })
    const expected = { ...financePage(args('2026-11-01', '2026-11-30')), page: 1, pageSize: 50 }
    expect(res.body).toEqual({
      ...expected,
      totals: { grossBrl: 1234.56, netBrl: 1180.01, paidCount: 41, refundedBrl: 29.9, overdueBrl: 0, overdueCount: 0 },
      byMonth: [
        { month: '2025-12', grossBrl: 0, netBrl: 0, byPlan: {} },
        { month: '2026-11', grossBrl: 1234.56, netBrl: 1180.01, byPlan: { pro_mensal: 1000, essencial_anual: 234.56 } },
      ],
      overdue: [],
      rows: [financeRow(), financeRow({ paymentId: 'pay_2', status: 'REFUNDED', refundedAt: '2026-11-20', userId: null, email: null, planKey: null })],
      total: 2,
    })
  })

  it('o banco não decide a página nem o tamanho dela', async () => {
    answer = (a) => financePage(a, { page: 9, pageSize: 5000 })
    const res = await get({ page: '2' })
    expect(res.body).toMatchObject({ page: 2, pageSize: 50 })
  })
})

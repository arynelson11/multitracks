import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeDb, createRes, type FakeDb, type FakeRes, type Row } from './fakeSupabase.js'
import { AdminError, createAdminRouter } from '../_lib/admin/http.js'
import { funnelMonths, handlers } from '../_lib/admin/funnel.js'

// Funil do admin (Parte 3, T2): os números de cada mês vêm de admin_funnel
// (SQL da T1, aqui pelo contrato do banco falso) e o servidor acrescenta o nome
// do mês. months vai de 1 a 24 (padrão 6) e é conferido antes de chamar o
// banco. Cada número que o banco devolve é conferido: fora do formato vira a
// frase genérica, nunca um número inventado no lugar do que faltou.

const ADMIN_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const TRAVESSAO = String.fromCharCode(0x2014)
const NOW = '2026-11-19T15:00:00.000Z' // meio-dia de 19/11 em Brasília
const MSG_UNEXPECTED = 'Erro inesperado no servidor.'
const MSG_MONTHS = 'Escolha de 1 a 24 meses.'

let db: FakeDb
let responses: FakeRes[]
// Resposta fixa do banco; undefined monta os meses pelo p_months pedido, como o SQL.
let sql: unknown

vi.mock('../_lib/auth.js', () => ({
  verifyAdmin: vi.fn(async () => ({ ok: true, userId: ADMIN_ID, email: 'admin@igreja.com', isAdmin: true, blocked: false })),
}))
vi.mock('@supabase/supabase-js', () => ({ createClient: vi.fn(() => db) }))

const router = createAdminRouter(handlers)

async function get(query: Record<string, unknown> = {}): Promise<FakeRes> {
  const res = createRes()
  await router({ method: 'GET', query: { action: 'funnel', ...query }, headers: { authorization: 'Bearer admin' } }, res)
  responses.push(res)
  return res
}

const NOV: Row = { month: '2026-11', signups: 3, firstSeparation: 2, paying: 1, medianDaysToPay: 2.5, offersShown: 1, offersUsed: 1, adsShown: 7, adsClicked: 2 }
const OCT: Row = { month: '2026-10', signups: 4, firstSeparation: 1, paying: 0, medianDaysToPay: null, offersShown: 0, offersUsed: 0, adsShown: 0, adsClicked: 0 }

// Mês sem nada, como o SQL devolve (zeros e mediana nula).
function emptyMonth(month: string): Row {
  return { month, signups: 0, firstSeparation: 0, paying: 0, medianDaysToPay: null, offersShown: 0, offersUsed: 0, adsShown: 0, adsClicked: 0 }
}

// n meses terminando em novembro de 2026, do mais novo pro mais antigo.
function funnelSql(n: number): Row {
  const months = Array.from({ length: n }, (_, i) => {
    const d = new Date(Date.UTC(2026, 10 - i, 1))
    const month = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
    return i === 0 ? { ...NOV } : i === 1 ? { ...OCT } : emptyMonth(month)
  })
  return { months }
}

// Resposta do banco com o mês de novembro trocado.
const withNov = (over: Row): Row => ({ months: [{ ...NOV, ...over }, { ...OCT }] })

type Body = { months: Row[] }

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(NOW))
  vi.stubEnv('VITE_SUPABASE_URL', 'https://fake.supabase.co')
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'fake-service-role')
  vi.stubEnv('ASAAS_API_KEY', '')
  vi.spyOn(console, 'error').mockImplementation(() => {})
  responses = []
  sql = undefined
  db = createFakeDb({
    rpc: { admin_funnel: (args) => (sql === undefined ? funnelSql(Number(args.p_months)) : sql) },
  })
})

afterEach(() => {
  for (const res of responses) {
    expect(JSON.stringify(res.body ?? null).includes(TRAVESSAO)).toBe(false)
    expect(res.headers['Cache-Control']).toBe('no-store')
  }
  // o funil só lê pela função do banco: nenhuma tabela lida nem escrita
  expect(db.reads).toEqual([])
  expect(db.writes).toEqual([])
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
})

describe('funnelMonths', () => {
  it('sem months, ou vazio, vale 6', () => {
    expect(funnelMonths({})).toBe(6)
    expect(funnelMonths({ months: '' })).toBe(6)
  })

  it('aceita inteiro de 1 a 24', () => {
    expect(funnelMonths({ months: '1' })).toBe(1)
    expect(funnelMonths({ months: '12' })).toBe(12)
    expect(funnelMonths({ months: '24' })).toBe(24)
  })

  it('fora de 1 a 24 ou sem ser inteiro: AdminError 400 com a frase', () => {
    for (const months of ['0', '25', '-1', 'abc', '1.5', '6 meses', '1e1']) {
      let caught: unknown
      try {
        funnelMonths({ months })
      } catch (e) {
        caught = e
      }
      expect(caught, months).toBeInstanceOf(AdminError)
      expect((caught as AdminError).status, months).toBe(400)
      expect((caught as AdminError).message, months).toBe(MSG_MONTHS)
    }
  })
})

describe('ação funnel', () => {
  it('devolve os meses do banco com o nome do mês', async () => {
    const res = await get()
    expect(res.statusCode).toBe(200)
    const body = res.body as Body
    expect(body.months).toHaveLength(6)
    expect(body.months[0]).toMatchObject({ month: '2026-11', label: 'novembro de 2026', signups: 3 })
    expect(body.months[0]).toEqual({ ...NOV, label: 'novembro de 2026' })
    expect(body.months[1]).toEqual({ ...OCT, label: 'outubro de 2026' })
    // a ordem do banco (do mais novo pro mais antigo) fica
    expect(body.months.map((m) => m.label)).toEqual([
      'novembro de 2026', 'outubro de 2026', 'setembro de 2026', 'agosto de 2026', 'julho de 2026', 'junho de 2026',
    ])
  })

  it('months padrão 6 e aceita de 1 a 24', async () => {
    await get()
    expect(db.rpcCalls).toHaveLength(1)
    expect(db.rpcCalls[0].name).toBe('admin_funnel')
    expect(db.rpcCalls[0].args).toMatchObject({ p_months: 6 })
    // a hora é a do servidor
    expect(db.rpcCalls[0].args).toEqual({ p_now: NOW, p_months: 6 })
    for (const [months, expected] of [['1', 1], ['12', 12], ['24', 24]] as const) {
      const res = await get({ months })
      expect(res.statusCode, months).toBe(200)
      expect(db.rpcCalls.at(-1), months).toEqual({ name: 'admin_funnel', args: { p_now: NOW, p_months: expected } })
      expect((res.body as Body).months, months).toHaveLength(expected)
    }
  })

  it('months 0, 25 ou texto: 400 sem chamar o banco', async () => {
    for (const months of ['0', '25', 'abc', '-3', '2.5']) {
      const res = await get({ months })
      expect(res.statusCode, months).toBe(400)
      expect((res.body as { error: string }).error, months).toBe(MSG_MONTHS)
    }
    expect(db.rpcCalls).toHaveLength(0)
  })

  it('campo que a ação não declarou responde 400 sem chamar o banco', async () => {
    const res = await get({ from: '2026-01' })
    expect(res.statusCode).toBe(400)
    expect(res.body).toEqual({ error: 'Campo não esperado: from.' })
    expect(db.rpcCalls).toEqual([])
  })

  it('firstSeparation maior que signups é fora do formato: 500 com a frase genérica', async () => {
    sql = withNov({ signups: 3, firstSeparation: 4 })
    const res = await get()
    expect(res.statusCode).toBe(500)
    expect(res.body).toEqual({ error: MSG_UNEXPECTED })
  })

  it('paying maior que signups também é fora do formato', async () => {
    sql = withNov({ signups: 3, paying: 4 })
    const res = await get()
    expect(res.statusCode).toBe(500)
    expect(res.body).toEqual({ error: MSG_UNEXPECTED })
  })

  it('medianDaysToPay nulo passa como nulo', async () => {
    const res = await get()
    const body = res.body as Body
    expect(body.months[1].medianDaysToPay).toBeNull()
    expect(body.months[0].medianDaysToPay).toBe(2.5)
  })

  it('mediana zero (pagou no dia do cadastro) passa como zero', async () => {
    sql = withNov({ medianDaysToPay: 0 })
    const res = await get()
    expect(res.statusCode).toBe(200)
    expect((res.body as Body).months[0].medianDaysToPay).toBe(0)
  })

  it('só os campos do contrato saem, mesmo se o banco mandar outro', async () => {
    sql = withNov({ email: 'quem@igreja.com' })
    const res = await get()
    expect(res.statusCode).toBe(200)
    expect(Object.keys((res.body as Body).months[0]).sort()).toEqual([
      'adsClicked', 'adsShown', 'firstSeparation', 'label', 'medianDaysToPay', 'month', 'offersShown', 'offersUsed', 'paying', 'signups',
    ])
    expect(JSON.stringify(res.body)).not.toContain('igreja')
  })

  it('resposta do admin_funnel fora do formato responde a frase genérica, nunca número inventado', async () => {
    const without = (key: string): Row => Object.fromEntries(Object.entries(NOV).filter(([k]) => k !== key))
    const bad: unknown[] = [
      null,
      [],
      {},
      { months: null },
      { months: {} },
      { months: [null] },
      { months: [[]] },
      { months: [without('month')] },
      { months: [without('adsClicked')] },
      { months: [without('medianDaysToPay')] },
      withNov({ month: '2026-13' }),
      withNov({ month: '2026-1' }),
      withNov({ month: '11/2026' }),
      withNov({ month: '2026-11-01' }),
      withNov({ month: 202611 }),
      withNov({ signups: -1 }),
      withNov({ signups: 3.5 }),
      withNov({ signups: '3' }),
      withNov({ firstSeparation: -1 }),
      withNov({ paying: 0.5 }),
      withNov({ offersShown: null }),
      withNov({ offersUsed: -2 }),
      withNov({ adsShown: '7' }),
      withNov({ adsClicked: 1.5 }),
      withNov({ medianDaysToPay: -0.5 }),
      withNov({ medianDaysToPay: '2.5' }),
    ]
    for (const value of bad) {
      sql = value
      const res = await get()
      expect(res.statusCode, JSON.stringify(value)).toBe(500)
      expect(res.body, JSON.stringify(value)).toEqual({ error: MSG_UNEXPECTED })
    }
  })

  it('erro do banco responde a frase genérica, sem o texto do banco', async () => {
    db.setRpc('admin_funnel', () => { throw new Error('relation "product_events" does not exist') })
    const res = await get()
    expect(res.statusCode).toBe(500)
    expect(res.body).toEqual({ error: MSG_UNEXPECTED })
    expect(JSON.stringify(res.body)).not.toContain('product_events')
  })
})

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeDb, createRes, type FakeDb, type FakeRes, type Row } from './fakeSupabase.js'
import { createAdminRouter } from '../_lib/admin/http.js'
import { fxAgeDays, handlers, monthLabel, mrrBrl } from '../_lib/admin/overview.js'

// Visão geral (Task 15): os números do mês vêm de admin_overview (SQL na T22,
// aqui pelo contrato via setRpc) e a contagem das Pendências de
// admin_review_queue (T5). O servidor acrescenta o nome do mês, o MRR pela
// tabela de preços, a margem, a idade do câmbio guardado (api/_lib/fx.ts, T11)
// e os alertas. Câmbio com mais de 4 dias de Brasília, ou sem câmbio, liga o
// alerta (Review Focus 4: número que parece certo e está errado sem aviso).
// Sem custo (Rulings ADM-sem-custo-visao e ADM-sem-custo-sql): o alerta conta só
// os trabalhos que a varredura de Custos de IA ainda completa
// (aiCost.withoutCostPending, do próprio admin_overview); o aiCost.withoutCost
// (a nota da margem) segue com o total.

const ADMIN_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const TRAVESSAO = String.fromCharCode(0x2014)
const NOW = '2026-11-16T15:00:00.000Z' // meio-dia de 16/11 em Brasília
const MSG_UNEXPECTED = 'Erro inesperado no servidor.'

let db: FakeDb
let responses: FakeRes[]
let sql: Row
let queue: Row
let fetchSpy: ReturnType<typeof vi.fn>

vi.mock('../_lib/auth.js', () => ({
  verifyAdmin: vi.fn(async () => ({ ok: true, userId: ADMIN_ID, email: 'admin@igreja.com', isAdmin: true, blocked: false })),
}))
vi.mock('@supabase/supabase-js', () => ({ createClient: vi.fn(() => db) }))

const router = createAdminRouter(handlers)

async function get(query: Record<string, unknown> = {}): Promise<FakeRes> {
  const res = createRes()
  await router({ method: 'GET', query: { action: 'overview', ...query }, headers: { authorization: 'Bearer admin' } }, res)
  responses.push(res)
  return res
}

// O JSON de admin_overview no formato do contrato (seção B, sem os campos do servidor).
function overviewSql(over: Row = {}): Row {
  return {
    month: { start: '2026-11-01', end: '2026-11-30' },
    revenue: { grossBrl: 480.5, netBrl: 452.3, payments: 6, refundedBrl: 49.9, refunds: 1 },
    subscribers: {
      activeByPlan: { essencial_mensal: 2, pro_anual: 1 },
      endingByPlan: { pro_mensal: 1 },
      courtesyByPlan: { essencial_mensal: 1 },
      overdueAccounts: 1,
      blockedWithActiveSub: 1,
      legacyPaid: 2,
    },
    cancellations: { total: 2, bySource: { user: 1, unpaid: 1 } },
    aiCost: aiCostSql(3, 3),
    fx: { date: '2026-11-15', rate: 5.37 },
    ...over,
  }
}

// aiCost do admin_overview com o total sem custo e os pendentes.
const aiCostSql = (withoutCost: number, withoutCostPending: number): Row =>
  ({ jobs: 40, succeeded: 37, failed: 3, costBrl: 12.4, costUsd: 2.31, withoutCost, withoutCostPending })

function queueSql(counts: Row = { manual: 3, auto: 2, total: 5 }): Row {
  return { actions: [], flags: [], events: [], counts, generatedAt: NOW }
}

const fxRow = (date: string, rate: number): Row => ({ rate_date: date, usd_brl: rate, source: 'bcb_ptax_venda', fetched_at: `${date}T16:00:00.000Z` })

function setFx(rows: Row[]): void {
  db.tables.fx_rates = rows
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(NOW))
  vi.stubEnv('VITE_SUPABASE_URL', 'https://fake.supabase.co')
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'fake-service-role')
  vi.stubEnv('ASAAS_API_KEY', '')
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  // a Visão geral nunca consulta o Banco Central (nem nada na rede)
  fetchSpy = vi.fn(async () => { throw new Error('rede nos testes') })
  vi.stubGlobal('fetch', fetchSpy)
  responses = []
  sql = overviewSql()
  queue = queueSql()
  db = createFakeDb({
    tables: { fx_rates: [fxRow('2026-11-15', 5.37)] },
    rpc: { admin_overview: () => sql, admin_review_queue: () => queue },
  })
})

afterEach(() => {
  for (const res of responses) {
    expect(JSON.stringify(res.body ?? null).includes(TRAVESSAO)).toBe(false)
    expect(res.headers['Cache-Control']).toBe('no-store')
  }
  expect(fetchSpy).not.toHaveBeenCalled()
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('funções puras da Visão geral', () => {
  it('MRR de 2 Pro Mensal e 1 Studio Anual dá 189.70', () => {
    // 2 x 49,90 + 1078,80 / 12
    expect(mrrBrl({ essencial_mensal: 2, pro_anual: 1 })).toBe(189.7)
  })

  it('MRR soma os quatro planos com o anual dividido por 12, e vazio dá 0', () => {
    // 49,90 + 454,80 / 12 + 119,90 + 1078,80 / 12
    expect(mrrBrl({ essencial_mensal: 1, essencial_anual: 1, pro_mensal: 1, pro_anual: 1 })).toBe(297.6)
    expect(mrrBrl({ essencial_anual: 3 })).toBe(113.7)
    expect(mrrBrl({})).toBe(0)
  })

  it("monthLabel('2026-11-01')", () => {
    expect(monthLabel('2026-11-01')).toBe('novembro de 2026')
    expect(monthLabel('2027-01-01')).toBe('janeiro de 2027')
    expect(monthLabel('2026-03-01')).toBe('março de 2026')
  })

  it('monthLabel de dia que não existe mostra sem dado', () => {
    for (const bad of ['2026-13-01', '2026-02-30', '01/11/2026', '']) expect(monthLabel(bad), bad).toBe('sem dado')
  })

  it('fxAgeDays conta dias de Brasília entre o câmbio e hoje', () => {
    const now = new Date(NOW)
    expect(fxAgeDays('2026-11-11', now)).toBe(5)
    expect(fxAgeDays('2026-11-15', now)).toBe(1)
    expect(fxAgeDays('2026-11-16', now)).toBe(0)
    expect(fxAgeDays('2026-10-31', now)).toBe(16)
    expect(fxAgeDays(null, now)).toBeNull()
    expect(fxAgeDays('16/11/2026', now)).toBeNull()
  })

  it('fxAgeDays às 23:30 de Brasília ainda conta o dia de Brasília, não o de UTC', () => {
    // 2026-11-17T02:30Z é 23:30 do dia 16 em Brasília: 16 menos 12 dá 4 (em UTC daria 5)
    expect(fxAgeDays('2026-11-12', new Date('2026-11-17T02:30:00.000Z'))).toBe(4)
    // 03:00Z já é meia-noite do dia 17 em Brasília
    expect(fxAgeDays('2026-11-12', new Date('2026-11-17T03:00:00.000Z'))).toBe(5)
  })

  it('fxAgeDays de câmbio com data depois de hoje não fica negativo', () => {
    expect(fxAgeDays('2026-11-18', new Date(NOW))).toBe(0)
  })
})

describe('ação overview', () => {
  it('devolve os números do mês com o que o servidor acrescenta', async () => {
    const res = await get()
    expect(res.statusCode).toBe(200)
    expect(res.body).toEqual({
      month: { start: '2026-11-01', end: '2026-11-30', label: 'novembro de 2026' },
      revenue: { grossBrl: 480.5, netBrl: 452.3, payments: 6, refundedBrl: 49.9, refunds: 1 },
      mrrBrl: 189.7,
      subscribers: overviewSql().subscribers,
      cancellations: { total: 2, bySource: { user: 1, unpaid: 1 } },
      aiCost: { jobs: 40, succeeded: 37, failed: 3, costBrl: 12.4, costUsd: 2.31, withoutCost: 3, withoutCostPending: 3 },
      marginBrl: 439.9,
      fx: { date: '2026-11-15', rate: 5.37, ageDays: 1 },
      alerts: { manual: 3, auto: 2, blockedWithActiveSub: 1, withoutCostPending: 3, fxOld: false },
    })
  })

  it('chama admin_overview com a hora do servidor e a fila sem argumentos, e nada mais', async () => {
    await get()
    expect(db.rpcCalls).toEqual(expect.arrayContaining([
      { name: 'admin_overview', args: { p_now: NOW } },
      { name: 'admin_review_queue', args: {} },
    ]))
    // os pendentes vêm do próprio admin_overview (Ruling ADM-sem-custo-sql)
    expect(db.rpcCalls).toHaveLength(2)
  })

  it('só trabalhos sem preço conhecido: nenhum alerta de sem custo, e o aiCost segue com o total', async () => {
    sql = overviewSql({ aiCost: aiCostSql(5, 0) })
    const res = await get()
    expect(res.statusCode).toBe(200)
    const body = res.body as { aiCost: Row; alerts: Row }
    expect(body.alerts).toEqual({ manual: 3, auto: 2, blockedWithActiveSub: 1, withoutCostPending: 0, fxOld: false })
    expect(body.aiCost.withoutCost).toBe(5)
  })

  it('com pendentes, o alerta conta só os pendentes e o aiCost segue com o total', async () => {
    sql = overviewSql({ aiCost: aiCostSql(7, 2) })
    const res = await get()
    const body = res.body as { aiCost: Row; alerts: Row }
    expect(body.alerts.withoutCostPending).toBe(2)
    expect(body.aiCost.withoutCost).toBe(7)
  })

  it('pendentes fora do formato ou acima do total respondem a frase genérica', async () => {
    const bad = [
      { jobs: 40, succeeded: 37, failed: 3, costBrl: 12.4, costUsd: 2.31, withoutCost: 3 },
      aiCostSql(3, -1),
      aiCostSql(3, 1.5),
      { ...aiCostSql(3, 0), withoutCostPending: '1' },
      aiCostSql(3, 4),
    ]
    for (const aiCost of bad) {
      sql = overviewSql({ aiCost })
      const res = await get()
      expect(res.statusCode, JSON.stringify(aiCost)).toBe(500)
      expect(res.body).toEqual({ error: MSG_UNEXPECTED })
    }
  })

  it('margem é a receita líquida menos a IA', async () => {
    const res = await get()
    // 452,30 - 12,40
    expect((res.body as Row).marginBrl).toBe(439.9)
  })

  it('margem fica negativa quando a IA custa mais que a receita líquida', async () => {
    sql = overviewSql({
      revenue: { grossBrl: 10, netBrl: 9.5, payments: 1, refundedBrl: 0, refunds: 0 },
      aiCost: { jobs: 50, succeeded: 50, failed: 0, costBrl: 12.4, costUsd: 2.31, withoutCost: 0, withoutCostPending: 0 },
    })
    const res = await get()
    expect((res.body as Row).marginBrl).toBe(-2.9)
  })

  it('MRR vem da tabela de preços e não de valor do banco', async () => {
    sql = overviewSql({ mrrBrl: 99999 })
    const res = await get()
    expect((res.body as Row).mrrBrl).toBe(189.7)
  })

  it('câmbio com mais de 4 dias liga o alerta', async () => {
    setFx([fxRow('2026-11-11', 5.31)])
    sql = overviewSql({ fx: { date: '2026-11-11', rate: 5.31 } })
    const res = await get()
    const body = res.body as { fx: Row; alerts: Row }
    expect(body.fx).toEqual({ date: '2026-11-11', rate: 5.31, ageDays: 5 })
    expect(body.alerts.fxOld).toBe(true)
  })

  it('câmbio de 4 dias ainda não liga', async () => {
    setFx([fxRow('2026-11-12', 5.33)])
    const res = await get()
    const body = res.body as { fx: Row; alerts: Row }
    expect(body.fx).toEqual({ date: '2026-11-12', rate: 5.33, ageDays: 4 })
    expect(body.alerts.fxOld).toBe(false)
  })

  it('câmbio de ontem não liga', async () => {
    setFx([fxRow('2026-11-11', 5.31), fxRow('2026-11-15', 5.37)])
    const res = await get()
    const body = res.body as { fx: Row; alerts: Row }
    expect(body.fx).toEqual({ date: '2026-11-15', rate: 5.37, ageDays: 1 })
    expect(body.alerts.fxOld).toBe(false)
  })

  it('às 23:30 de Brasília a idade do câmbio conta o dia de Brasília', async () => {
    vi.setSystemTime(new Date('2026-11-17T02:30:00.000Z'))
    setFx([fxRow('2026-11-12', 5.33)])
    const res = await get()
    const body = res.body as { fx: Row; alerts: Row }
    expect(body.fx).toEqual({ date: '2026-11-12', rate: 5.33, ageDays: 4 })
    expect(body.alerts.fxOld).toBe(false)
    expect(db.rpcCalls).toContainEqual({ name: 'admin_overview', args: { p_now: '2026-11-17T02:30:00.000Z' } })
  })

  it('sem câmbio liga', async () => {
    setFx([])
    sql = overviewSql({ fx: { date: null, rate: null } })
    const res = await get()
    const body = res.body as { fx: Row; alerts: Row }
    expect(body.fx).toEqual({ date: null, rate: null, ageDays: null })
    expect(body.alerts.fxOld).toBe(true)
  })

  it('o câmbio é o guardado (fx.ts), sem consultar o Banco Central', async () => {
    // o banco devolve um câmbio mais velho: vale o guardado em fx_rates, lido até hoje de Brasília
    setFx([fxRow('2026-11-13', 5.35), fxRow('2026-11-15', 5.37)])
    sql = overviewSql({ fx: { date: '2026-11-10', rate: 5.3 } })
    const res = await get()
    expect((res.body as { fx: Row }).fx).toEqual({ date: '2026-11-15', rate: 5.37, ageDays: 1 })
    expect(db.reads).toContainEqual({ table: 'fx_rates', filters: [{ col: 'rate_date', op: 'lte', value: '2026-11-16' }] })
    expect(db.writes).toEqual([])
  })

  it('sem ler o câmbio guardado, vale o câmbio que o admin_overview trouxe', async () => {
    db.failTable('fx_rates', { message: 'permission denied for table fx_rates' })
    sql = overviewSql({ fx: { date: '2026-11-15', rate: 5.37 } })
    const res = await get()
    expect(res.statusCode).toBe(200)
    expect((res.body as { fx: Row }).fx).toEqual({ date: '2026-11-15', rate: 5.37, ageDays: 1 })
  })

  it('câmbio do admin_overview fora do formato conta como sem câmbio', async () => {
    db.failTable('fx_rates', { message: 'timeout' })
    for (const fx of [null, { date: '2026-11-15', rate: 0 }, { date: '15/11/2026', rate: 5.37 }, { date: '2026-11-15', rate: '5.37' }]) {
      sql = overviewSql({ fx })
      const res = await get()
      const body = res.body as { fx: Row; alerts: Row }
      expect(body.fx, JSON.stringify(fx)).toEqual({ date: null, rate: null, ageDays: null })
      expect(body.alerts.fxOld).toBe(true)
    }
  })

  it('alertas trazem a contagem da fila', async () => {
    queue = queueSql({ manual: 4, auto: 7, total: 11 })
    sql = overviewSql({
      subscribers: { ...(overviewSql().subscribers as Row), blockedWithActiveSub: 2 },
      aiCost: aiCostSql(6, 6),
    })
    const res = await get()
    expect((res.body as { alerts: Row }).alerts).toEqual({ manual: 4, auto: 7, blockedWithActiveSub: 2, withoutCostPending: 6, fxOld: false })
  })

  it('fila vazia dá alertas zerados', async () => {
    queue = queueSql({ manual: 0, auto: 0, total: 0 })
    sql = overviewSql({
      subscribers: { ...(overviewSql().subscribers as Row), blockedWithActiveSub: 0 },
      aiCost: { jobs: 0, succeeded: 0, failed: 0, costBrl: 0, costUsd: 0, withoutCost: 0, withoutCostPending: 0 },
    })
    const res = await get()
    expect((res.body as { alerts: Row }).alerts).toEqual({ manual: 0, auto: 0, blockedWithActiveSub: 0, withoutCostPending: 0, fxOld: false })
  })

  it('campo que a ação não declarou responde 400 sem ler o banco', async () => {
    const res = await get({ month: '2026-10' })
    expect(res.statusCode).toBe(400)
    expect(res.body).toEqual({ error: 'Campo não esperado: month.' })
    expect(db.rpcCalls).toEqual([])
  })

  it('erro do banco responde a frase genérica, sem o texto do banco', async () => {
    for (const name of ['admin_overview', 'admin_review_queue']) {
      const previous = db.setRpc(name, () => { throw new Error('relation "billing_payments" does not exist') })
      const res = await get()
      expect(res.statusCode, name).toBe(500)
      expect(res.body, name).toEqual({ error: MSG_UNEXPECTED })
      expect(JSON.stringify(res.body)).not.toContain('billing_payments')
      db.setRpc(name, previous!)
    }
  })

  it('resposta do admin_overview fora do formato responde a frase genérica, nunca número inventado', async () => {
    const subs = overviewSql().subscribers as Row
    const bad: unknown[] = [
      null,
      [],
      {},
      overviewSql({ month: { start: '2026-13-01', end: '2026-11-30' } }),
      overviewSql({ month: { start: '2026-11-01' } }),
      overviewSql({ revenue: { grossBrl: 480.5, payments: 6 } }),
      overviewSql({ revenue: { grossBrl: 480.5, netBrl: '452.30', payments: 6 } }),
      overviewSql({ aiCost: { jobs: 1, costUsd: 0.1, withoutCost: 0 } }),
      overviewSql({ aiCost: { jobs: 1, costBrl: 0.5, costUsd: 0.1 } }),
      overviewSql({ subscribers: { ...subs, activeByPlan: null } }),
      overviewSql({ subscribers: { ...subs, activeByPlan: { pro: 3 } } }),
      overviewSql({ subscribers: { ...subs, activeByPlan: { pro_mensal: -1 } } }),
      overviewSql({ subscribers: { ...subs, activeByPlan: { pro_mensal: 1.5 } } }),
      overviewSql({ subscribers: { ...subs, blockedWithActiveSub: null } }),
      overviewSql({ cancellations: null }),
    ]
    for (const value of bad) {
      sql = value as Row
      const res = await get()
      expect(res.statusCode, JSON.stringify(value)).toBe(500)
      expect(res.body).toEqual({ error: MSG_UNEXPECTED })
    }
  })

  it('fila fora do formato responde a frase genérica', async () => {
    for (const value of [null, {}, queueSql({ manual: 1 }), queueSql({ manual: '1', auto: 0 })]) {
      queue = value as Row
      const res = await get()
      expect(res.statusCode, JSON.stringify(value)).toBe(500)
      expect(res.body).toEqual({ error: MSG_UNEXPECTED })
    }
  })
})

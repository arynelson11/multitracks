import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createFakeDb, createRes, type FakeDb, type FakeRes, type Row } from './fakeSupabase.js'
import { createAdminRouter } from '../_lib/admin/http.js'
import { handlers } from '../_lib/admin/aiCosts.js'
import { DEMUCS_VERSION, HARDWARE_USD_PER_SECOND, PRICES_CHECKED_AT, PRICES_SOURCE } from '../_lib/aiCost.js'
import { getStoredUsdBrl } from '../_lib/fx.js'

// Custos de IA (Task 24): ai-costs (GET) soma os trabalhos gravados em
// predictions (admin_ai_costs, T10) depois de atualizar o câmbio do dia e de
// uma varredura curta que completa os custos que faltam (sweepPendingCosts,
// T12); ai-costs-sweep (POST) é o botão "Completar custos que faltam" da T19.
// Replicate (vi.mock) e Banco Central (fetch falso) só de mentira: nenhuma
// chamada de rede aqui.

const ADMIN_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const USER_ID = '11111111-1111-4111-8111-111111111111'
const USER_EMAIL = 'quem@igreja.com'
const NOW = new Date('2026-11-17T15:00:00Z') // terça, 12:00 em Brasília
const TOKEN = 'r8_token_de_teste'
const TRAVESSAO = String.fromCharCode(0x2014)

const MSG = {
  inverted: 'A data inicial precisa vir antes da final.',
  tooLong: 'Escolha um período de até um ano.',
  badFrom: 'A data inicial está em formato inválido.',
  badPage: 'A página precisa ser um número de 1 a 1000.',
  badLimit: 'O limite precisa ser um número de 1 a 100.',
  noReplicate: 'Servidor sem a chave do Replicate. A varredura não rodou; avise o suporte.',
  unexpected: 'Erro inesperado no servidor.',
}

// PTAX de venda de mentira, só dias úteis.
const PTAX: Record<string, number> = {
  '2026-11-03': 5.4, '2026-11-04': 5.41, '2026-11-05': 5.42, '2026-11-06': 5.43, '2026-11-09': 5.38, '2026-11-10': 5.39,
  '2026-11-11': 5.37, '2026-11-12': 5.385, '2026-11-13': 5.3712, '2026-11-16': 5.3655, '2026-11-17': 5.36,
}

type GetFn = (id: string, opts?: { signal?: AbortSignal }) => Promise<unknown>

let db: FakeDb
let responses: FakeRes[]
// Ordem das chamadas pra fora (Banco Central, Replicate) e da soma no banco.
let calls: string[]
let replicateAuth: unknown[]
let replicateGet: GetFn
let bcbAnswer: (from: string, to: string) => Promise<Response>
let warn: MockInstance<typeof console.warn>
let error: MockInstance<typeof console.error>

vi.mock('../_lib/auth.js', () => ({
  verifyAdmin: vi.fn(async () => ({ ok: true, userId: ADMIN_ID, email: 'admin@igreja.com', isAdmin: true, blocked: false })),
}))
vi.mock('@supabase/supabase-js', () => ({ createClient: vi.fn(() => db) }))
vi.mock('replicate', () => ({
  default: class FakeReplicate {
    predictions: { get: GetFn }
    constructor(opts: { auth?: string } = {}) {
      replicateAuth.push(opts.auth)
      this.predictions = {
        get: (id, o) => {
          calls.push(`replicate:${id}`)
          return replicateGet(id, o)
        },
      }
    }
  },
}))

const router = createAdminRouter(handlers)

async function send(method: string, action: string, query: Record<string, unknown>, body?: unknown): Promise<FakeRes> {
  const res = createRes()
  await router({ method, query: { action, ...query }, headers: { authorization: 'Bearer admin' }, body }, res)
  responses.push(res)
  return res
}
const get = (query: Record<string, unknown> = {}) => send('GET', 'ai-costs', query)
const post = (body: unknown = {}) => send('POST', 'ai-costs-sweep', {}, body)

function job(id: string, extra: Row = {}): Row {
  return {
    replicate_id: id, user_id: USER_ID, created_at: '2026-11-16T12:00:00Z', model: null, version: null, stem_count: null,
    status: null, predict_seconds: null, hardware: null, usd_per_second: null, cost_usd: null, fx_usd_brl: null,
    fx_date: null, cost_brl: null, completed_at: null, cost_recorded_at: null, ...extra,
  }
}

function done(id: string, extra: Row = {}): Row {
  return {
    id, model: 'cjwbw/demucs', version: DEMUCS_VERSION, status: 'succeeded',
    input: { audio: 'https://r2.exemplo/a.mp3', model_name: 'htdemucs' }, metrics: { predict_time: 40 },
    completed_at: '2026-11-16T12:01:00Z', ...extra,
  }
}

// Erro como o do SDK do Replicate (ApiError): a mensagem leva a URL e o texto da resposta.
function apiError(status: number): Error {
  return Object.assign(
    new Error(`Request to https://api.replicate.com/v1/predictions/x failed with status ${status}: {"detail":"texto tecnico do Replicate"}.`),
    { name: 'ApiError', response: new Response('', { status }) },
  )
}

const never = <T>() => new Promise<T>(() => {})
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

// Banco Central falso: responde a janela pedida na URL com as cotações da tabela.
function ptaxResponse(from: string, to: string, table: Record<string, number> = PTAX): Response {
  const value = Object.entries(table)
    .filter(([d]) => d >= from && d <= to)
    .map(([d, rate]) => ({ cotacaoVenda: rate, dataHoraCotacao: `${d} 13:05:00.000` }))
  return new Response(JSON.stringify({ value }), { status: 200, headers: { 'content-type': 'application/json' } })
}

const fakeFetch = vi.fn<typeof fetch>(async (url) => {
  const m = /@dataInicial='(\d{2})-(\d{2})-(\d{4})'&@dataFinalCotacao='(\d{2})-(\d{2})-(\d{4})'/.exec(String(url))
  if (!m) throw new Error('URL fora do formato')
  const from = `${m[3]}-${m[1]}-${m[2]}`
  const to = `${m[6]}-${m[4]}-${m[5]}`
  calls.push(`bcb:${to}`)
  return bcbAnswer(from, to)
})

const withCost = (r: Row) => r.cost_recorded_at != null && r.cost_usd != null && r.cost_brl != null

// admin_ai_costs falso: soma o que está na tabela NA HORA da chamada (pra provar
// que a varredura terminou antes). Formato da T10, sem page e pageSize.
function aiCostsAnswer(args: Record<string, unknown>): Row {
  calls.push('admin_ai_costs')
  const rows = db.tables.predictions ?? []
  const costed = rows.filter(withCost)
  return {
    range: { from: args.p_from, to: args.p_to },
    totals: {
      jobs: rows.length, succeeded: rows.filter((r) => r.status === 'succeeded').length, failed: 0, canceled: 0,
      unknown: rows.filter((r) => r.status === 'unknown').length, withoutCost: rows.length - costed.length,
      costUsd: costed.reduce((s, r) => s + Number(r.cost_usd), 0), costBrl: costed.reduce((s, r) => s + Number(r.cost_brl), 0),
      avgBrlPerSucceeded: null, predictSeconds: 0,
    },
    byUser: [{ userId: USER_ID, email: USER_EMAIL, jobs: rows.length, costBrl: 0 }],
    byModel: [],
    fx: { minDate: null, maxDate: null },
    rows: rows.map((r) => ({ replicateId: r.replicate_id, costBrl: r.cost_brl })),
    total: rows.length,
  }
}

const aiCostsArgs = () => db.rpcCalls.filter((c) => c.name === 'admin_ai_costs').map((c) => c.args)
const rpcArgs = (p_from: string, p_to: string, p_offset = 0) => ({ p_from, p_to, p_limit: 50, p_offset })
const rowOf = (id: string) => db.tables.predictions.find((r) => r.replicate_id === id) as Row
const predictionReads = () => db.reads.filter((r) => r.table === 'predictions')
const logText = () => JSON.stringify([...warn.mock.calls, ...error.mock.calls])

function seedDb(predictions: Row[] = [], fxRates: Row[] = []): void {
  db = createFakeDb({
    tables: { predictions, fx_rates: fxRates },
    primaryKeys: { predictions: 'replicate_id', fx_rates: 'rate_date' },
    rpc: { admin_ai_costs: (a) => aiCostsAnswer(a) },
  })
}

// Com o relógio falso: anda o tempo até a resposta sair e devolve quanto levou.
async function timed(run: () => Promise<FakeRes>, maxMs = 60_000): Promise<{ res: FakeRes; ms: number }> {
  const started = Date.now()
  let res: FakeRes | null = null
  const pending = run().then((r) => { res = r })
  while (res === null && Date.now() - started < maxMs) await vi.advanceTimersByTimeAsync(50)
  await pending
  return { res: res as unknown as FakeRes, ms: Date.now() - started }
}

beforeEach(() => {
  vi.useFakeTimers({ now: NOW, toFake: ['Date'] })
  vi.stubEnv('VITE_SUPABASE_URL', 'https://fake.supabase.co')
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'fake-service-role')
  vi.stubEnv('REPLICATE_API_TOKEN', TOKEN)
  vi.stubGlobal('fetch', fakeFetch)
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  error = vi.spyOn(console, 'error').mockImplementation(() => {})
  responses = []
  calls = []
  replicateAuth = []
  replicateGet = async (id) => done(id)
  bcbAnswer = async (from, to) => ptaxResponse(from, to)
  fakeFetch.mockClear()
  seedDb()
})

afterEach(() => {
  for (const res of responses) {
    const text = JSON.stringify(res.body ?? null)
    expect(text.includes(TRAVESSAO)).toBe(false)
    expect(text).not.toContain('texto tecnico')
    expect(text).not.toContain('Falha no banco')
    expect(res.headers['Cache-Control']).toBe('no-store')
  }
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('ai-costs: período em dias de Brasília', () => {
  it('sem datas usa o mês de Brasília', async () => {
    const res = await get()
    expect(res.statusCode).toBe(200)
    expect(aiCostsArgs()).toEqual([rpcArgs('2026-11-01', '2026-11-30')])
    expect(res.body).toMatchObject({ range: { from: '2026-11-01', to: '2026-11-30' }, page: 1, pageSize: 50 })
  })

  it('às 23:30 do dia 30 em Brasília ainda é novembro', async () => {
    vi.setSystemTime(new Date('2026-12-01T02:30:00Z'))
    await get()
    expect(aiCostsArgs()).toEqual([rpcArgs('2026-11-01', '2026-11-30')])
  })

  it('período e página informados vão pro banco, e a resposta traz page e pageSize', async () => {
    const res = await get({ from: '2026-10-01', to: '2026-10-31', page: '3' })
    expect(res.statusCode).toBe(200)
    expect(aiCostsArgs()).toEqual([rpcArgs('2026-10-01', '2026-10-31', 100)])
    expect(res.body).toMatchObject({ page: 3, pageSize: 50 })
  })

  it('período invertido, maior que um ano, data ou página inválida responde 400 sem varrer nem somar', async () => {
    seedDb([job('r1')])
    const cases: [Record<string, unknown>, string][] = [
      [{ from: '2026-11-10', to: '2026-11-01' }, MSG.inverted],
      [{ from: '2025-01-01', to: '2026-11-30' }, MSG.tooLong],
      [{ from: '2026-02-30' }, MSG.badFrom],
      [{ page: '0' }, MSG.badPage],
      [{ page: '1001' }, MSG.badPage],
    ]
    for (const [query, message] of cases) {
      const res = await get(query)
      expect(res.statusCode, JSON.stringify(query)).toBe(400)
      expect(res.body).toEqual({ error: message })
    }
    expect(calls).toEqual([])
    expect(db.rpcCalls).toEqual([])
    expect(db.writes).toEqual([])
  })

  it('366 dias contando o primeiro e o último passam', async () => {
    const res = await get({ from: '2027-03-01', to: '2028-02-29' })
    expect(res.statusCode).toBe(200)
  })

  it('campo que a ação não declarou é recusado', async () => {
    const res = await get({ status: 'paid' })
    expect(res.statusCode).toBe(400)
    expect(res.body).toEqual({ error: 'Campo não esperado: status.' })
    const res2 = await post({ limit: 5, force: true })
    expect(res2.statusCode).toBe(400)
    expect(res2.body).toEqual({ error: 'Campo não esperado: force.' })
    expect(calls).toEqual([])
  })
})

describe('ai-costs: câmbio e varredura antes de somar', () => {
  it('a varredura roda antes de somar', async () => {
    seedDb([job('r1')])
    const res = await get()
    expect(res.statusCode).toBe(200)
    // câmbio do dia, depois o Replicate, e só então a soma
    expect(calls).toEqual(['bcb:2026-11-17', 'replicate:r1', 'admin_ai_costs'])
    expect(replicateAuth).toEqual([TOKEN])
    // a soma já viu o custo gravado
    expect(res.body).toMatchObject({ totals: { jobs: 1, withoutCost: 0 } })
    expect(res.body).toMatchObject({ sweep: { recorded: 1, unknown: 0, failed: 0, brlCompleted: 0, more: false, skipped: false } })
    expect(rowOf('r1')).toMatchObject({ status: 'succeeded', cost_usd: 0.009, model: 'htdemucs', stem_count: 4 })
  })

  it('cada trabalho usa a PTAX do próprio dia de Brasília, nunca a de hoje', async () => {
    seedDb([
      job('r1', { created_at: '2026-11-13T12:00:00Z' }),
      // 23:30 do dia 12 em Brasília (já dia 13 em UTC)
      job('r2', { created_at: '2026-11-13T02:30:00Z' }),
    ])
    replicateGet = async (id) => done(id, { completed_at: id === 'r1' ? '2026-11-13T12:01:00Z' : '2026-11-13T02:31:00Z' })
    const res = await get()
    expect(res.statusCode).toBe(200)
    expect(rowOf('r1')).toMatchObject({ fx_date: '2026-11-13', fx_usd_brl: 5.3712, cost_brl: Math.round(0.009 * 5.3712 * 1e4) / 1e4 })
    expect(rowOf('r2')).toMatchObject({ fx_date: '2026-11-12', fx_usd_brl: 5.385 })
  })

  it('abre a aba com no máximo 20 trabalhos e deixa de fora o que tem menos de 10 minutos', async () => {
    const old = Array.from({ length: 22 }, (_, i) => job(`r${String(i).padStart(2, '0')}`, { created_at: `2026-11-16T12:${String(i).padStart(2, '0')}:00Z` }))
    seedDb([...old, job('novo', { created_at: '2026-11-17T14:55:00Z' })])
    const res = await get()
    expect(res.statusCode).toBe(200)
    const asked = calls.filter((c) => c.startsWith('replicate:'))
    expect(asked).toHaveLength(20)
    expect(asked).not.toContain('replicate:novo')
    expect(res.body).toMatchObject({ sweep: { recorded: 20, more: true, skipped: false } })
    expect(rowOf('novo').cost_recorded_at).toBeNull()
  })

  it('sem token do Replicate a varredura é pulada e a soma sai', async () => {
    vi.stubEnv('REPLICATE_API_TOKEN', '')
    seedDb([job('r1')])
    const res = await get()
    expect(res.statusCode).toBe(200)
    expect(replicateAuth).toEqual([])
    expect(calls).toEqual(['bcb:2026-11-17', 'admin_ai_costs'])
    expect(res.body).toMatchObject({
      totals: { withoutCost: 1 },
      sweep: { recorded: 0, unknown: 0, failed: 0, brlCompleted: 0, more: false, skipped: true },
    })
    expect(predictionReads()).toEqual([])
  })

  it('abrir Custos de IA atualiza o câmbio do dia (o alerta de câmbio velho da Visão geral apaga)', async () => {
    seedDb([], [{ rate_date: '2026-11-10', usd_brl: 5.39, source: 'bcb_ptax_venda', fetched_at: '2026-11-10T16:00:00Z' }])
    expect(await getStoredUsdBrl(db as unknown as SupabaseClient, NOW)).toMatchObject({ date: '2026-11-10', stale: true })
    const res = await get()
    expect(res.statusCode).toBe(200)
    expect(calls).toEqual(['bcb:2026-11-17', 'admin_ai_costs'])
    expect(await getStoredUsdBrl(db as unknown as SupabaseClient, NOW)).toEqual({ rate: 5.36, date: '2026-11-17', stale: false })
  })

  it('câmbio guardado há menos de 6 horas não consulta o Banco Central de novo', async () => {
    seedDb([], [{ rate_date: '2026-11-17', usd_brl: 5.36, source: 'bcb_ptax_venda', fetched_at: '2026-11-17T14:00:00Z' }])
    const res = await get()
    expect(res.statusCode).toBe(200)
    expect(fakeFetch).not.toHaveBeenCalled()
    expect(calls).toEqual(['admin_ai_costs'])
  })

  it('câmbio do Banco Central fora do formato fica no log, sem dado pessoal', async () => {
    // cotação em texto: a leitura descarta item por item e o câmbio sai nulo
    bcbAnswer = async () => new Response(JSON.stringify({ value: [{ cotacaoVenda: '5,36', dataHoraCotacao: '2026-11-16 13:05:00.000' }] }), { status: 200 })
    seedDb([job('r1')])
    const res = await get()
    expect(res.statusCode).toBe(200)
    // o dólar fica gravado, o real fica pra próxima varredura e conta como sem custo
    expect(rowOf('r1')).toMatchObject({ cost_usd: 0.009, cost_brl: null })
    expect(res.body).toMatchObject({ totals: { withoutCost: 1 }, sweep: { recorded: 1 } })
    const logs = warn.mock.calls.map((c) => c.join(' '))
    expect(logs.some((l) => l.includes('2026-11-16') && l.includes('Banco Central'))).toBe(true)
    expect(logs.some((l) => l.includes('2026-11-17') && l.includes('Banco Central'))).toBe(true)
    expect(logText()).not.toContain(USER_ID)
    expect(logText()).not.toContain(USER_EMAIL)
  })

  it('varredura que para com erro do banco não derruba os números', async () => {
    seedDb([job('r1')])
    db.failTable('predictions', { message: 'permission denied for table predictions' })
    const res = await get()
    expect(res.statusCode).toBe(200)
    expect(calls).toContain('admin_ai_costs')
    expect(res.body).toMatchObject({ sweep: { recorded: 0, unknown: 0, failed: 0, brlCompleted: 0, more: false, skipped: true } })
    expect(logText()).toContain('permission denied')
  })
})

describe('ai-costs: teto de tempo do GET (o adminApi corta em 15 s)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: NOW, toFake: ['Date', 'setTimeout', 'clearTimeout'] })
  })

  it('com o Replicate e o Banco Central pendurados, responde em até 9 s e a soma sai', async () => {
    replicateGet = () => never()
    bcbAnswer = () => never()
    seedDb([
      job('brl1', { cost_usd: 0.009, cost_recorded_at: '2026-11-10T12:00:00Z', created_at: '2026-11-10T12:00:00Z' }),
      job('brl2', { cost_usd: 0.009, cost_recorded_at: '2026-11-11T12:00:00Z', created_at: '2026-11-11T12:00:00Z' }),
      ...Array.from({ length: 20 }, (_, i) => job(`r${i}`, { created_at: `2026-11-16T12:${String(i).padStart(2, '0')}:00Z` })),
    ])
    const { res, ms } = await timed(get)
    expect(res.statusCode).toBe(200)
    expect(ms).toBeLessThanOrEqual(9000)
    expect(calls[calls.length - 1]).toBe('admin_ai_costs')
    expect(res.body).toMatchObject({ sweep: { failed: 1, more: true, skipped: false } })
    // a linha que o Replicate não respondeu fica pra próxima
    expect(rowOf('r0').cost_recorded_at).toBeNull()
  })

  it('com o Replicate lento, para no orçamento e responde em até 9 s', async () => {
    replicateGet = async (id) => { await sleep(900); return done(id) }
    seedDb(Array.from({ length: 20 }, (_, i) => job(`r${i}`, { created_at: `2026-11-16T12:${String(i).padStart(2, '0')}:00Z` })))
    const { res, ms } = await timed(get)
    expect(res.statusCode).toBe(200)
    expect(ms).toBeLessThanOrEqual(9000)
    const recorded = (res.body as { sweep: { recorded: number; more: boolean } }).sweep
    expect(recorded.recorded).toBeGreaterThan(0)
    expect(recorded.recorded).toBeLessThan(20)
    expect(recorded.more).toBe(true)
  })
})

describe('ai-costs: respostas do Replicate', () => {
  it('404 do Replicate conta como unknown', async () => {
    seedDb([job('r1')])
    replicateGet = async () => { throw apiError(404) }
    const res = await get()
    expect(res.statusCode).toBe(200)
    expect(res.body).toMatchObject({ sweep: { recorded: 0, unknown: 1, failed: 0 } })
    expect(rowOf('r1')).toMatchObject({ status: 'unknown', cost_recorded_at: NOW.toISOString(), cost_usd: null })
  })

  it('400 e 422 de id inválido também fecham a linha como unknown; id fora do formato nem vai ao Replicate', async () => {
    seedDb([
      job('r400', { created_at: '2026-11-16T12:00:00Z' }),
      job('r422', { created_at: '2026-11-16T12:01:00Z' }),
      job('../models/x', { created_at: '2026-11-16T12:02:00Z' }),
    ])
    replicateGet = async (id) => { throw apiError(id === 'r400' ? 400 : 422) }
    const res = await get()
    expect(res.body).toMatchObject({ sweep: { unknown: 3, failed: 0, more: false } })
    expect(calls.filter((c) => c.startsWith('replicate:'))).toEqual(['replicate:r400', 'replicate:r422'])
    for (const id of ['r400', 'r422', '../models/x']) expect(rowOf(id)).toMatchObject({ status: 'unknown', cost_recorded_at: NOW.toISOString() })
  })

  it('401, 429 e 500 do Replicate não fecham a linha: contam em failed e a varredura para', async () => {
    for (const status of [401, 429, 500]) {
      seedDb([job('r1', { created_at: '2026-11-16T12:00:00Z' }), job('r2', { created_at: '2026-11-16T12:01:00Z' })])
      calls = []
      replicateGet = async () => { throw apiError(status) }
      const res = await get()
      expect(res.statusCode, String(status)).toBe(200)
      expect(res.body, String(status)).toMatchObject({ sweep: { recorded: 0, unknown: 0, failed: 1, more: true } })
      expect(calls.filter((c) => c.startsWith('replicate:')), String(status)).toEqual(['replicate:r1'])
      expect(rowOf('r1').cost_recorded_at, String(status)).toBeNull()
      expect(rowOf('r1').status, String(status)).toBeNull()
    }
  })

  it('resposta do Replicate fora do formato não grava nada e conta em failed', async () => {
    seedDb([job('r1')])
    replicateGet = async () => 'sem objeto'
    const res = await get()
    expect(res.body).toMatchObject({ sweep: { failed: 1, more: true } })
    expect(rowOf('r1').cost_recorded_at).toBeNull()
  })
})

describe('ai-costs: forma da resposta', () => {
  it('a resposta traz a tabela de preços e a data', async () => {
    const res = await get()
    const body = res.body as Record<string, unknown>
    const table = Object.entries(HARDWARE_USD_PER_SECOND).map(([hardware, usdPerSecond]) => ({ hardware, usdPerSecond }))
    expect(table.length).toBeGreaterThan(0)
    expect(body.prices).toEqual({ checkedAt: PRICES_CHECKED_AT, source: PRICES_SOURCE, table })
    expect(PRICES_CHECKED_AT).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('repassa o que o banco somou, com page, pageSize, prices e sweep (a forma que a tela confere)', async () => {
    seedDb([job('r1', { cost_usd: 0.009, cost_brl: 0.0483, cost_recorded_at: '2026-11-16T12:01:00Z', status: 'succeeded' })])
    const res = await get()
    const body = res.body as Record<string, unknown>
    expect(Object.keys(body).sort()).toEqual(['byModel', 'byUser', 'fx', 'page', 'pageSize', 'prices', 'range', 'rows', 'sweep', 'total', 'totals'])
    const sql = aiCostsAnswer(rpcArgs('2026-11-01', '2026-11-30'))
    for (const key of ['range', 'totals', 'byUser', 'byModel', 'fx', 'rows', 'total']) expect(body[key], key).toEqual(sql[key])
  })

  it('total que chega como texto (bigint) vira número', async () => {
    db.setRpc('admin_ai_costs', (a) => ({ ...aiCostsAnswer(a), total: '7' }))
    const res = await get()
    expect(res.statusCode).toBe(200)
    expect(res.body).toMatchObject({ total: 7 })
  })

  it('resposta do banco fora do formato ou erro do banco vira erro inesperado, sem texto do banco', async () => {
    const answers: ((a: Record<string, unknown>) => unknown)[] = [
      () => null,
      (a) => ({ ...aiCostsAnswer(a), rows: 'x' }),
      (a) => ({ ...aiCostsAnswer(a), totals: null }),
      (a) => ({ ...aiCostsAnswer(a), total: -1 }),
      (a) => ({ ...aiCostsAnswer(a), range: { from: 1 } }),
      () => { throw new Error('Falha no banco: relation predictions does not exist') },
    ]
    for (const answer of answers) {
      db.setRpc('admin_ai_costs', answer)
      const res = await get()
      expect(res.statusCode).toBe(500)
      expect(res.body).toEqual({ error: MSG.unexpected })
    }
  })
})

describe('ai-costs-sweep (botão Completar custos que faltam)', () => {
  it('limite 0 ou 101 na varredura responde 400', async () => {
    seedDb([job('r1')])
    for (const limit of [0, 101, -1, 2.5, 'dez']) {
      const res = await post({ limit })
      expect(res.statusCode, String(limit)).toBe(400)
      expect(res.body).toEqual({ error: MSG.badLimit })
    }
    expect(calls).toEqual([])
    expect(predictionReads()).toEqual([])
  })

  it('sem limite varre até 50 e devolve o resultado da varredura', async () => {
    seedDb(Array.from({ length: 52 }, (_, i) => job(`r${String(i).padStart(2, '0')}`, { created_at: `2026-11-16T1${Math.floor(i / 60)}:${String(i % 60).padStart(2, '0')}:00Z` })))
    const res = await post()
    expect(res.statusCode).toBe(200)
    expect(res.body).toEqual({ recorded: 50, unknown: 0, failed: 0, brlCompleted: 0, more: true })
    expect(calls.filter((c) => c.startsWith('replicate:'))).toHaveLength(50)
    // o botão não soma: só a varredura
    expect(db.rpcCalls).toEqual([])
  })

  it('limite 1 a 100 vale, e o real que faltava é completado com a PTAX do dia do trabalho', async () => {
    seedDb([
      job('brl', { cost_usd: 0.009, cost_recorded_at: '2026-11-13T12:01:00Z', created_at: '2026-11-13T12:00:00Z', completed_at: '2026-11-13T12:01:00Z' }),
      job('r1'), job('r2', { created_at: '2026-11-16T12:01:00Z' }),
    ])
    const res = await post({ limit: 1 })
    expect(res.statusCode).toBe(200)
    expect(res.body).toEqual({ recorded: 1, unknown: 0, failed: 0, brlCompleted: 1, more: true })
    expect(rowOf('brl')).toMatchObject({ fx_date: '2026-11-13', fx_usd_brl: 5.3712 })
    const res100 = await post({ limit: 100 })
    expect(res100.body).toEqual({ recorded: 1, unknown: 0, failed: 0, brlCompleted: 0, more: false })
  })

  it('sem token do Replicate o botão responde a frase e nada roda', async () => {
    vi.stubEnv('REPLICATE_API_TOKEN', '   ')
    seedDb([job('r1')])
    const res = await post()
    expect(res.statusCode).toBe(500)
    expect(res.body).toEqual({ error: MSG.noReplicate })
    expect(replicateAuth).toEqual([])
    expect(calls).toEqual([])
    expect(predictionReads()).toEqual([])
  })

  it('erro do banco na varredura vira erro inesperado, sem texto do banco', async () => {
    seedDb([job('r1')])
    db.failTable('predictions', { message: 'Falha no banco: permission denied' })
    const res = await post()
    expect(res.statusCode).toBe(500)
    expect(res.body).toEqual({ error: MSG.unexpected })
  })

  it('para antes do maxDuration de 30 s mesmo com uma consulta no meio quando o orçamento acaba', async () => {
    vi.useFakeTimers({ now: NOW, toFake: ['Date', 'setTimeout', 'clearTimeout'] })
    // um trabalho por dia útil; o Replicate leva 4,9 s em cada um e o Banco Central
    // pendura justo no último dia, consultado já depois do orçamento de 20 s
    const days = ['2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13']
    seedDb(days.map((d, i) => job(`r${i}`, { created_at: `${d}T12:00:00Z` })))
    replicateGet = async (id) => {
      await sleep(4900)
      return done(id, { completed_at: `${days[Number(id.slice(1))]}T12:01:00Z` })
    }
    bcbAnswer = (from, to) => (to === '2026-11-13' ? never() : Promise.resolve(ptaxResponse(from, to)))
    const { res, ms } = await timed(post)
    expect(res.statusCode).toBe(200)
    expect(ms).toBeLessThanOrEqual(25_000)
    expect(res.body).toEqual({ recorded: 5, unknown: 0, failed: 0, brlCompleted: 0, more: false })
    // o último ficou só com o dólar; a próxima varredura completa o real
    expect(rowOf('r4')).toMatchObject({ cost_usd: 0.009, cost_brl: null })
    expect(rowOf('r0')).toMatchObject({ fx_date: '2026-11-09', fx_usd_brl: 5.38 })
  })
})

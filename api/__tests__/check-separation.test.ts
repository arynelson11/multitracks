import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createFakeDb, createRes, type DbError, type DbResult, type FakeDb, type Row } from './fakeSupabase.js'
import { DEMUCS_VERSION } from '../_lib/aiCost.js'

// Custo de IA gravado quando o app consulta o trabalho e ele termina (T23).
// A resposta da consulta é a mesma com ou sem gravação: a gravação nunca muda,
// derruba nem segura a resposta do usuário. O câmbio é só o já guardado do dia
// de Brasília do trabalho (Ruling ADM-T23-fx): nada de Banco Central aqui.
// Replicate, banco e fetch são falsos; nenhuma chamada de rede.

const USER = '11111111-1111-4111-8111-111111111111'
const OTHER = '22222222-2222-4222-8222-222222222222'
const EMAIL = 'musico@igreja.com'
const PRED = 'abcdefghij0123456789zz'
// terça, 17/11/2026, 12:00 em Brasília
const NOW = '2026-11-17T15:00:00.000Z'

const h = vi.hoisted(() => ({ getPrediction: vi.fn(), isAdmin: false }))
let db: FakeDb

vi.mock('@supabase/supabase-js', () => ({ createClient: () => db }))
// A trava de bloqueado é testada com a auth de verdade em blocked-access.test.ts.
vi.mock('../_lib/auth.js', async (orig) => ({
  ...(await orig<typeof import('../_lib/auth.js')>()),
  verifyActiveUser: vi.fn(async () => ({ ok: true, userId: USER, email: EMAIL, isAdmin: h.isAdmin, blocked: false })),
}))
vi.mock('replicate', () => ({
  default: class { predictions = { get: h.getPrediction } },
}))

// Trabalho como o separate-audio grava ao começar.
function jobRow(over: Row = {}): Row {
  return {
    replicate_id: PRED,
    user_id: USER,
    created_at: '2026-11-17T14:58:00.000Z',
    model: 'htdemucs',
    version: DEMUCS_VERSION,
    stem_count: 4,
    status: 'starting',
    cost_recorded_at: null,
    ...over,
  }
}

// O que o Replicate devolve na consulta.
function prediction(over: Row = {}): Row {
  return {
    id: PRED,
    model: 'cjwbw/demucs',
    version: DEMUCS_VERSION,
    status: 'succeeded',
    input: { audio: 'https://r2.exemplo.com/temp/musica.mp3', model_name: 'htdemucs' },
    output: { vocals: 'https://replicate.delivery/pbxt/abc/vocals.wav' },
    metrics: { predict_time: 40 },
    created_at: '2026-11-17T14:58:00.000Z',
    completed_at: '2026-11-17T14:59:00.000Z',
    ...over,
  }
}

function fxRow(date: string, rate: number): Row {
  return { rate_date: date, usd_brl: rate, source: 'bcb_ptax_venda', fetched_at: '2026-11-17T16:30:00.000Z' }
}

function setup(rows: Row[] = [jobRow()], fx: Row[] = [fxRow('2026-11-17', 5.3655)]) {
  db = createFakeDb({
    tables: { predictions: rows, fx_rates: fx },
    primaryKeys: { predictions: 'replicate_id', fx_rates: 'rate_date' },
  })
}

async function loadHandler() {
  return (await import('../check-separation.js')).default
}

async function callHandler(handler: Awaited<ReturnType<typeof loadHandler>>) {
  const res = createRes()
  const req = { method: 'GET', headers: { authorization: 'Bearer x' }, query: { predictionId: PRED } }
  await handler(req as unknown as VercelRequest, res as unknown as VercelResponse)
  return res
}

async function check() {
  return callHandler(await loadHandler())
}

const row = () => db.tables.predictions.find((r) => r.replicate_id === PRED)!
const costWrites = () => db.writes.filter((w) => w.table === 'predictions' && w.op === 'update')

// Faz falhar só um pedido ao banco: a leitura do trabalho pra gravar o custo
// (a que pede cost_recorded_at) ou a gravação do custo. A leitura do dono segue.
function failOn(step: 'cost-read' | 'cost-update', error: DbError) {
  const from = db.from.bind(db)
  db.from = (table: string) => {
    const q = from(table)
    if (table !== 'predictions') return q
    let hit = false
    const select = q.select.bind(q)
    const update = q.update.bind(q)
    q.select = ((cols?: string) => {
      if (step === 'cost-read' && cols?.includes('cost_recorded_at')) hit = true
      return select(cols)
    }) as typeof q.select
    q.update = ((payload: Row) => {
      if (step === 'cost-update') hit = true
      return update(payload)
    }) as typeof q.update
    const then = q.then.bind(q)
    q.then = ((onOk, onErr) => (hit ? Promise.resolve<DbResult>({ data: null, error }).then(onOk, onErr) : then(onOk, onErr))) as typeof q.then
    return q
  }
}

const fetchSpy = vi.fn()
let warn: MockInstance<typeof console.warn>
let error: MockInstance<typeof console.error>
const logged = () => [...warn.mock.calls, ...error.mock.calls].flat().map(String).join(' ')

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(NOW))
  vi.stubEnv('VITE_SUPABASE_URL', 'https://fake.supabase.co')
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'fake-service-role')
  vi.stubEnv('REPLICATE_API_TOKEN', 'fake-replicate')
  h.isAdmin = false
  h.getPrediction.mockReset()
  h.getPrediction.mockImplementation(async () => prediction())
  fetchSpy.mockReset()
  fetchSpy.mockImplementation(async () => new Response('{"value":[]}'))
  vi.stubGlobal('fetch', fetchSpy)
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  error = vi.spyOn(console, 'error').mockImplementation(() => {})
  setup()
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  warn.mockRestore()
  error.mockRestore()
})

describe('check-separation: custo gravado quando o trabalho termina', () => {
  it('trabalho concluído grava o custo uma vez', async () => {
    const res = await check()

    expect(res.statusCode).toBe(200)
    expect(res.body).toEqual({ prediction: prediction() })
    expect(row()).toMatchObject({
      status: 'succeeded',
      predict_seconds: 40,
      hardware: 'gpu-t4',
      usd_per_second: 0.000225,
      cost_usd: 0.009,
      fx_usd_brl: 5.3655,
      fx_date: '2026-11-17',
      cost_brl: 0.0483,
      completed_at: '2026-11-17T14:59:00.000Z',
      cost_recorded_at: NOW,
      // o que o separate-audio gravou ao começar fica
      model: 'htdemucs',
      version: DEMUCS_VERSION,
      stem_count: 4,
    })
    expect(costWrites()).toHaveLength(1)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('a segunda consulta não grava de novo', async () => {
    const first = await check()
    vi.setSystemTime(new Date('2026-11-17T15:00:05.000Z'))
    const second = await check()

    expect(first.body).toEqual({ prediction: prediction() })
    expect(second.statusCode).toBe(200)
    expect(second.body).toEqual({ prediction: prediction() })
    expect(costWrites()).toHaveLength(1)
    expect(row().cost_recorded_at).toBe(NOW)
  })

  it.each(['starting', 'processing'])('em andamento não grava (%s)', async (status) => {
    h.getPrediction.mockImplementation(async () => prediction({ status, metrics: undefined, completed_at: null, output: null }))

    const res = await check()

    expect(res.statusCode).toBe(200)
    expect(res.body).toEqual({ prediction: prediction({ status, metrics: undefined, completed_at: null, output: null }) })
    expect(db.writes).toEqual([])
    expect(db.reads.filter((r) => r.table === 'fx_rates')).toEqual([])
    expect(row()).toEqual(jobRow())
  })

  it.each(['failed', 'canceled'])('trabalho que termina como %s também grava', async (status) => {
    h.getPrediction.mockImplementation(async () => prediction({ status, metrics: {}, output: null }))

    const res = await check()

    expect(res.statusCode).toBe(200)
    expect(row()).toMatchObject({ status, cost_usd: 0, cost_brl: 0, fx_date: '2026-11-17', cost_recorded_at: NOW })
  })

  it.each([
    ['a leitura do trabalho', 'cost-read'],
    ['a gravação do custo', 'cost-update'],
  ] as const)('falha ao gravar não muda a resposta 200 (%s falha)', async (_name, step) => {
    failOn(step, { message: 'connection reset', code: '08006' })

    const res = await check()

    expect(res.statusCode).toBe(200)
    expect(res.body).toEqual({ prediction: prediction() })
    expect(row().cost_recorded_at).toBeNull()
    expect(error).toHaveBeenCalled()
    // log sem dado pessoal
    expect(logged()).not.toContain(USER)
    expect(logged()).not.toContain(EMAIL)
  })

  it('sem câmbio grava o dólar', async () => {
    setup([jobRow()], [])

    const res = await check()

    expect(res.statusCode).toBe(200)
    expect(res.body).toEqual({ prediction: prediction() })
    expect(row()).toMatchObject({ cost_usd: 0.009, cost_brl: null, fx_usd_brl: null, fx_date: null, cost_recorded_at: NOW })
  })

  it('câmbio ilegível no banco grava o dólar e responde igual', async () => {
    db.failTable('fx_rates', { message: 'connection reset', code: '08006' })

    const res = await check()

    expect(res.statusCode).toBe(200)
    expect(res.body).toEqual({ prediction: prediction() })
    expect(row()).toMatchObject({ cost_usd: 0.009, cost_brl: null, cost_recorded_at: NOW })
    expect(logged()).not.toContain(USER)
  })

  it('câmbio guardado de outro dia útil não entra: grava sem real (Ruling ADM-T23-fx)', async () => {
    // só a PTAX de segunda guardada; o trabalho é de terça
    setup([jobRow()], [fxRow('2026-11-16', 5.3712)])

    await check()

    expect(row()).toMatchObject({ cost_usd: 0.009, cost_brl: null, fx_usd_brl: null, fx_date: null, cost_recorded_at: NOW })
  })

  it('no fim de semana vale a PTAX de sexta guardada', async () => {
    // domingo, 15/11/2026
    vi.setSystemTime(new Date('2026-11-15T15:00:00.000Z'))
    setup([jobRow({ created_at: '2026-11-15T14:58:00.000Z' })], [fxRow('2026-11-13', 5.3712)])
    h.getPrediction.mockImplementation(async () => prediction({ created_at: '2026-11-15T14:58:00.000Z', completed_at: '2026-11-15T14:59:00.000Z' }))

    await check()

    expect(row()).toMatchObject({ fx_usd_brl: 5.3712, fx_date: '2026-11-13', cost_brl: 0.0483 })
  })

  it('trabalho que terminou às 23:30 de Brasília usa o câmbio daquele dia, mesmo consultado no dia seguinte', async () => {
    // terminou 17/11 23:30 em Brasília (já 18/11 em UTC); consultado 18/11 09:00 em Brasília
    vi.setSystemTime(new Date('2026-11-18T12:00:00.000Z'))
    h.getPrediction.mockImplementation(async () => prediction({ created_at: '2026-11-18T02:28:00.000Z', completed_at: '2026-11-18T02:30:00.000Z' }))

    await check()

    expect(row()).toMatchObject({ fx_usd_brl: 5.3655, fx_date: '2026-11-17', cost_brl: 0.0483, completed_at: '2026-11-18T02:30:00.000Z' })
  })

  it('admin consultando também grava', async () => {
    h.isAdmin = true
    setup([jobRow({ user_id: OTHER })])

    const res = await check()

    expect(res.statusCode).toBe(200)
    expect(res.body).toEqual({ prediction: prediction() })
    expect(row()).toMatchObject({ user_id: OTHER, cost_usd: 0.009, cost_brl: 0.0483, cost_recorded_at: NOW })
  })

  it('usuário comum consultando trabalho de outro: 403 e nada gravado', async () => {
    setup([jobRow({ user_id: OTHER })])

    const res = await check()

    expect(res.statusCode).toBe(403)
    expect(h.getPrediction).not.toHaveBeenCalled()
    expect(db.writes).toEqual([])
  })

  it('a consulta não chama o Banco Central', async () => {
    // sem a PTAX do dia guardada: é o caso em que o getUsdBrlOn iria ao Banco Central
    setup([jobRow()], [fxRow('2026-11-16', 5.3712)])

    const res = await check()

    expect(res.statusCode).toBe(200)
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(db.writes.filter((w) => w.table === 'fx_rates')).toEqual([])
    expect(row().cost_recorded_at).toBe(NOW)
  })

  it('banco lento na gravação não segura a resposta: passa do teto, responde igual e o erro de depois só vai pro log', async () => {
    // o módulo carregado antes de o relógio falso parar o setTimeout
    const handler = await loadHandler()
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] })
    vi.setSystemTime(new Date(NOW))
    // a leitura do trabalho pra gravar o custo só volta (com erro) depois de 10 s
    const from = db.from.bind(db)
    db.from = (table: string) => {
      const q = from(table)
      if (table !== 'predictions') return q
      const select = q.select.bind(q)
      q.select = ((cols?: string) => (cols?.includes('cost_recorded_at')
        ? { eq: () => ({ maybeSingle: () => new Promise<DbResult>((resolve) => setTimeout(() => resolve({ data: null, error: { message: 'statement timeout', code: '57014' } }), 10_000)) }) }
        : select(cols))) as typeof q.select
      return q
    }

    let done = false
    const pending = callHandler(handler).then((res) => { done = true; return res })
    await vi.advanceTimersByTimeAsync(1_999)
    expect(done).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    const res = await pending

    expect(res.statusCode).toBe(200)
    expect(res.body).toEqual({ prediction: prediction() })
    expect(row().cost_recorded_at).toBeNull()

    // o erro que chega depois da resposta é tratado (log), nunca erro solto
    await vi.advanceTimersByTimeAsync(10_000)
    expect(error).toHaveBeenCalled()
    expect(logged()).not.toContain(USER)
  })
})

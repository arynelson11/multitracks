import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createFakeDb, type DbResult, type FakeDb, type Row } from './fakeSupabase.js'
import { getStoredUsdBrl, getUsdBrl, getUsdBrlOn, ptaxPeriodUrl, type FxRate } from '../_lib/fx.js'
import {
  DEMUCS_VERSION,
  HARDWARE_USD_PER_SECOND,
  PRICES_CHECKED_AT,
  PRICES_SOURCE,
  VERSION_HARDWARE,
  isTerminal,
  jobCost,
  recordPredictionResult,
  stemCountFromInput,
  sweepPendingCosts,
  type ReplicatePredictionLike,
} from '../_lib/aiCost.js'

// Custo de IA por trabalho (T12). Replicate e Banco Central só por função falsa:
// nenhuma chamada de rede aqui.

const PRICES = { 'nvidia-t4': 0.000225 }
const VERSIONS = { v1: { model: 'x/y', hardware: 'nvidia-t4', source: 's' } }
const FX: FxRate = { rate: 5.3712, date: '2026-11-16', stale: false }
const NOW = new Date('2026-11-17T15:00:00Z')
const USER = '11111111-1111-1111-1111-111111111111'

const asDb = (db: FakeDb) => db as unknown as SupabaseClient

function job(id: string, extra: Row = {}): Row {
  return {
    replicate_id: id,
    user_id: USER,
    created_at: '2026-11-16T12:00:00Z',
    model: null,
    version: null,
    stem_count: null,
    status: null,
    predict_seconds: null,
    hardware: null,
    usd_per_second: null,
    cost_usd: null,
    fx_usd_brl: null,
    fx_date: null,
    cost_brl: null,
    completed_at: null,
    cost_recorded_at: null,
    ...extra,
  }
}

function done(id: string, extra: Partial<ReplicatePredictionLike> = {}): ReplicatePredictionLike {
  return {
    id,
    model: 'cjwbw/demucs',
    version: DEMUCS_VERSION,
    status: 'succeeded',
    input: { audio: 'https://r2.exemplo/a.mp3', model_name: 'htdemucs' },
    metrics: { predict_time: 40 },
    completed_at: '2026-11-16T12:01:00Z',
    ...extra,
  }
}

function dbWith(rows: Row[], fxRows: Row[] = []): FakeDb {
  return createFakeDb({
    tables: { predictions: rows, fx_rates: fxRows },
    primaryKeys: { predictions: 'replicate_id', fx_rates: 'rate_date' },
  })
}

// PTAX de venda de mentira, por dia (dias úteis só). 12/10 e 02/11 são feriados.
const PTAX: Record<string, number> = {
  '2026-10-09': 5.5501, '2026-10-13': 5.5823, '2026-10-14': 5.59, '2026-10-15': 5.6102, '2026-10-16': 5.6,
  '2026-10-29': 5.44, '2026-10-30': 5.4512, '2026-11-03': 5.4, '2026-11-13': 5.3712, '2026-11-16': 5.3655,
}

// Banco Central falso: responde a janela pedida na URL com as cotações da tabela.
function bcb(table: Record<string, number> = PTAX) {
  return vi.fn<typeof fetch>(async (url) => {
    const m = /@dataInicial='(\d{2})-(\d{2})-(\d{4})'&@dataFinalCotacao='(\d{2})-(\d{2})-(\d{4})'/.exec(String(url))
    if (!m) throw new Error('URL fora do formato')
    const from = `${m[3]}-${m[1]}-${m[2]}`
    const to = `${m[6]}-${m[4]}-${m[5]}`
    const value = Object.entries(table)
      .filter(([d]) => d >= from && d <= to)
      .map(([d, rate]) => ({ cotacaoVenda: rate, dataHoraCotacao: `${d} 13:05:00.000` }))
    return new Response(JSON.stringify({ value }), { status: 200, headers: { 'content-type': 'application/json' } })
  })
}
const bcbDown = () => vi.fn<typeof fetch>(async () => { throw new Error('Banco Central sem resposta') })

function fxRow(date: string, rate: number, fetchedAt: string): Row {
  return { rate_date: date, usd_brl: rate, source: 'bcb_ptax_venda', fetched_at: fetchedAt }
}

const rowOf = (db: FakeDb, id: string) => db.tables.predictions.find((r) => r.replicate_id === id) as Row

// Faz falhar só a gravação do custo de uma linha (o update que leva cost_usd),
// deixando leituras e as outras gravações funcionarem.
function failCostWriteFor(db: FakeDb, failId: string): void {
  const realFrom = db.from.bind(db)
  db.from = ((table: string) => {
    const qb = realFrom(table)
    if (table !== 'predictions') return qb
    let payload: Row | null = null
    let target: unknown = null
    const proxy: unknown = new Proxy(qb, {
      get(t, prop) {
        if (prop === 'update') return (p: Row) => { payload = p; t.update(p); return proxy }
        if (prop === 'eq') return (c: string, v: unknown) => { if (c === 'replicate_id') target = v; t.eq(c, v); return proxy }
        if (prop === 'then' && payload && 'cost_usd' in payload && target === failId) {
          return (ok: (v: DbResult) => unknown, err: (e: unknown) => unknown) =>
            Promise.resolve({ data: null, error: { message: 'falha simulada ao gravar' } }).then(ok, err)
        }
        const v = Reflect.get(t, prop, t)
        return typeof v === 'function' ? (...a: unknown[]) => { const r = v.apply(t, a); return r === t ? proxy : r } : v
      },
    })
    return proxy
  }) as FakeDb['from']
}

describe('jobCost', () => {
  it('custo com a tabela de exemplo', () => {
    const c = jobCost({ version: 'v1', status: 'succeeded', predictSeconds: 40 }, FX, PRICES, VERSIONS)
    expect(c).toEqual({ hardware: 'nvidia-t4', usdPerSecond: 0.000225, costUsd: 0.009, costBrl: 0.0483, fxRate: 5.3712, fxDate: '2026-11-16' })
  })

  it('versão sem preço fica sem custo', () => {
    const c = jobCost({ version: 'v9', status: 'succeeded', predictSeconds: 40 }, FX, PRICES, VERSIONS)
    expect(c).toEqual({ hardware: null, usdPerSecond: null, costUsd: null, costBrl: null, fxRate: null, fxDate: null })
    const semVersao = jobCost({ version: null, status: 'succeeded', predictSeconds: 40 }, FX, PRICES, VERSIONS)
    expect(semVersao.costUsd).toBeNull()
    // versão conhecida, mas o hardware dela sem preço na tabela: também sem custo
    const semPreco = jobCost({ version: 'v1', status: 'succeeded', predictSeconds: 40 }, FX, {}, VERSIONS)
    expect(semPreco.usdPerSecond).toBeNull()
    expect(semPreco.costUsd).toBeNull()
    expect(semPreco.costBrl).toBeNull()
  })

  it('falhou sem tempo custa 0', () => {
    for (const status of ['failed', 'canceled']) {
      const c = jobCost({ version: 'v1', status, predictSeconds: null }, FX, PRICES, VERSIONS)
      expect(c.costUsd).toBe(0)
      expect(c.costBrl).toBe(0)
      expect(c.fxRate).toBe(5.3712)
    }
  })

  it('concluído sem tempo fica sem custo', () => {
    const c = jobCost({ version: 'v1', status: 'succeeded', predictSeconds: null }, FX, PRICES, VERSIONS)
    expect(c.costUsd).toBeNull()
    expect(c.costBrl).toBeNull()
    expect(c.fxRate).toBeNull()
  })

  it('sem câmbio grava só o dólar', () => {
    const c = jobCost({ version: 'v1', status: 'succeeded', predictSeconds: 40 }, null, PRICES, VERSIONS)
    expect(c).toEqual({ hardware: 'nvidia-t4', usdPerSecond: 0.000225, costUsd: 0.009, costBrl: null, fxRate: null, fxDate: null })
  })

  it('arredonda o dólar em 6 casas e o real em 4', () => {
    const c = jobCost({ version: 'v1', status: 'succeeded', predictSeconds: 33.3337 }, FX, PRICES, VERSIONS)
    expect(c.costUsd).toBe(0.0075)
    expect(c.costBrl).toBe(0.0403)
  })
})

describe('a tabela real de preços', () => {
  it('a tabela real cobre a versão do demucs', () => {
    const entry = VERSION_HARDWARE[DEMUCS_VERSION]
    expect(entry).toBeDefined()
    expect(HARDWARE_USD_PER_SECOND[entry.hardware]).toBeGreaterThan(0)
    expect(entry.source).toMatch(/^https:\/\/replicate\.com\//)
    expect(PRICES_SOURCE).toBe('https://replicate.com/pricing')
    expect(PRICES_CHECKED_AT).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(PRICES_CHECKED_AT <= new Date().toISOString().slice(0, 10)).toBe(true)
  })
})

describe('isTerminal e stemCountFromInput', () => {
  it('só concluído, falhou e cancelado são finais', () => {
    expect(['succeeded', 'failed', 'canceled'].map(isTerminal)).toEqual([true, true, true])
    expect(['starting', 'processing', 'unknown', '', null, undefined].map(isTerminal)).toEqual([false, false, false, false, false, false])
  })

  it('stemCountFromInput dos três casos e do vazio', () => {
    expect(stemCountFromInput({ model_name: 'htdemucs', two_stems: 'vocals' })).toBe(2)
    expect(stemCountFromInput({ model_name: 'htdemucs_6s' })).toBe(6)
    expect(stemCountFromInput({ model_name: 'htdemucs' })).toBe(4)
    expect(stemCountFromInput({})).toBeNull()
    expect(stemCountFromInput(null)).toBeNull()
    expect(stemCountFromInput(undefined)).toBeNull()
    expect(stemCountFromInput('htdemucs')).toBeNull()
    expect(stemCountFromInput({ two_stems: '' })).toBeNull()
  })
})

describe('recordPredictionResult', () => {
  it('gravar trabalho concluído preenche tudo e marca a hora', async () => {
    const db = dbWith([job('r1')])
    expect(await recordPredictionResult(asDb(db), done('r1'), FX, NOW)).toBe('recorded')
    expect(rowOf(db, 'r1')).toMatchObject({
      model: 'htdemucs',
      version: DEMUCS_VERSION,
      stem_count: 4,
      status: 'succeeded',
      predict_seconds: 40,
      hardware: VERSION_HARDWARE[DEMUCS_VERSION].hardware,
      usd_per_second: HARDWARE_USD_PER_SECOND[VERSION_HARDWARE[DEMUCS_VERSION].hardware],
      cost_usd: 0.009,
      fx_usd_brl: 5.3712,
      fx_date: '2026-11-16',
      cost_brl: 0.0483,
      completed_at: '2026-11-16T12:01:00Z',
      cost_recorded_at: NOW.toISOString(),
    })
  })

  it('gravar de novo responde already e não muda nada', async () => {
    const db = dbWith([job('r1')])
    await recordPredictionResult(asDb(db), done('r1'), FX, NOW)
    const before = { ...rowOf(db, 'r1') }
    const writes = db.writes.length
    const later = new Date('2026-11-17T16:00:00Z')
    expect(await recordPredictionResult(asDb(db), done('r1', { metrics: { predict_time: 99 } }), FX, later)).toBe('already')
    expect(rowOf(db, 'r1')).toEqual(before)
    expect(db.writes.length).toBe(writes)
  })

  it('gravação que perde a corrida pra outra responde already', async () => {
    // A leitura viu a linha sem custo, mas outra consulta gravou antes do update:
    // o filtro cost_recorded_at nulo no update não acha linha e nada é sobrescrito.
    const db = dbWith([job('r1')])
    const realFrom = db.from.bind(db)
    let first = true
    db.from = ((table: string) => {
      const qb = realFrom(table)
      if (table === 'predictions' && first) {
        first = false
        rowOf(db, 'r1').cost_recorded_at = '2026-11-17T14:59:00Z'
        rowOf(db, 'r1').cost_usd = 0.001
        return createFakeDb({ tables: { predictions: [job('r1')] } }).from('predictions')
      }
      return qb
    }) as FakeDb['from']
    expect(await recordPredictionResult(asDb(db), done('r1'), FX, NOW)).toBe('already')
    expect(rowOf(db, 'r1').cost_usd).toBe(0.001)
    expect(rowOf(db, 'r1').cost_recorded_at).toBe('2026-11-17T14:59:00Z')
  })

  it('trabalho em andamento não grava', async () => {
    const db = dbWith([job('r1')])
    for (const status of ['starting', 'processing']) {
      expect(await recordPredictionResult(asDb(db), done('r1', { status, metrics: null, completed_at: null }), FX, NOW)).toBe('not_terminal')
    }
    expect(db.writes).toEqual([])
    expect(rowOf(db, 'r1').cost_recorded_at).toBeNull()
  })

  it('linha que não existe responde unknown_row', async () => {
    const db = dbWith([job('r1')])
    expect(await recordPredictionResult(asDb(db), done('r2'), FX, NOW)).toBe('unknown_row')
    expect(db.writes).toEqual([])
  })

  it('não sobrescreve modelo já gravado', async () => {
    const db = dbWith([job('r1', { model: 'htdemucs_6s', version: DEMUCS_VERSION, stem_count: 6 })])
    const p = done('r1', { version: 'outra', input: { model_name: 'htdemucs', two_stems: 'vocals' } })
    expect(await recordPredictionResult(asDb(db), p, FX, NOW)).toBe('recorded')
    expect(rowOf(db, 'r1')).toMatchObject({ model: 'htdemucs_6s', version: DEMUCS_VERSION, stem_count: 6, cost_usd: 0.009 })
  })

  it('model vem do input.model_name, nunca do model do Replicate', async () => {
    const db = dbWith([job('r1'), job('r2')])
    await recordPredictionResult(asDb(db), done('r1', { model: 'dono/demucs', input: { model_name: 'htdemucs_6s' } }), FX, NOW)
    expect(rowOf(db, 'r1').model).toBe('htdemucs_6s')
    expect(rowOf(db, 'r1').stem_count).toBe(6)
    // sem o input na resposta do Replicate, model fica nulo (nunca 'dono/demucs')
    await recordPredictionResult(asDb(db), done('r2', { model: 'dono/demucs', input: undefined }), FX, NOW)
    expect(rowOf(db, 'r2').model).toBeNull()
    expect(rowOf(db, 'r2').stem_count).toBeNull()
    expect(rowOf(db, 'r2').cost_recorded_at).toBe(NOW.toISOString())
  })

  it('status estranho vira unknown e o trabalho falho sem tempo custa 0', async () => {
    const db = dbWith([job('r1'), job('r2')])
    expect(await recordPredictionResult(asDb(db), done('r1', { status: 'aborted', metrics: null }), FX, NOW)).toBe('recorded')
    expect(rowOf(db, 'r1')).toMatchObject({ status: 'unknown', cost_usd: null, cost_brl: null, cost_recorded_at: NOW.toISOString() })
    await recordPredictionResult(asDb(db), done('r2', { status: 'failed', metrics: {} }), null, NOW)
    expect(rowOf(db, 'r2')).toMatchObject({ status: 'failed', predict_seconds: null, cost_usd: 0, cost_brl: null, fx_usd_brl: null })
  })

  it('erro do banco ao ler ou gravar lança', async () => {
    const db = dbWith([job('r1')])
    db.failTable('predictions', { message: 'conexão caiu' })
    await expect(recordPredictionResult(asDb(db), done('r1'), FX, NOW)).rejects.toThrow()
    db.clearFailure('predictions')
    failCostWriteFor(db, 'r1')
    await expect(recordPredictionResult(asDb(db), done('r1'), FX, NOW)).rejects.toThrow()
    expect(rowOf(db, 'r1').cost_recorded_at).toBeNull()
  })
})

describe('sweepPendingCosts', () => {
  const OPTS = { now: NOW, limit: 20, budgetMs: 20000, olderThanMs: 60 * 60 * 1000 }

  it('varredura pega as mais velhas, marca 404 como unknown e para no orçamento', async () => {
    const db = dbWith([
      job('novo', { created_at: '2026-11-17T14:30:00Z' }), // dentro da última hora: fica de fora
      job('c', { created_at: '2026-11-15T10:00:00Z' }),
      job('a', { created_at: '2026-11-01T10:00:00Z' }),
      job('d', { created_at: '2026-11-16T10:00:00Z' }),
      job('b', { created_at: '2026-11-10T10:00:00Z' }),
    ])
    let t = 1000
    const asked: string[] = []
    const getPrediction = vi.fn(async (id: string) => {
      asked.push(id)
      t += 60
      return id === 'a' ? null : done(id)
    })
    const getFx = vi.fn(async () => FX)
    const out = await sweepPendingCosts(asDb(db), getPrediction, getFx, { ...OPTS, budgetMs: 100, clock: () => t })
    // passo 1 (t=1000) e passo 2 (t=1060) cabem; no passo 3 (t=1120) já passou de 100 ms
    expect(asked).toEqual(['a', 'b'])
    expect(out).toEqual({ recorded: 1, unknown: 1, failed: 0, brlCompleted: 0, more: true })
    expect(getFx).toHaveBeenCalledTimes(1)
    expect(rowOf(db, 'a')).toMatchObject({ status: 'unknown', cost_usd: null, cost_brl: null, cost_recorded_at: NOW.toISOString() })
    expect(rowOf(db, 'b')).toMatchObject({ status: 'succeeded', cost_usd: 0.009, cost_brl: 0.0483 })
    for (const id of ['c', 'd', 'novo']) expect(rowOf(db, id).cost_recorded_at).toBeNull()
  })

  it('busca limit + 1 e diz se sobrou', async () => {
    const rows = ['a', 'b', 'c'].map((id, i) => job(id, { created_at: `2026-11-0${i + 1}T10:00:00Z` }))
    const db = dbWith(rows)
    const getPrediction = vi.fn(async (id: string) => done(id))
    const out = await sweepPendingCosts(asDb(db), getPrediction, async () => FX, { ...OPTS, limit: 2 })
    expect(getPrediction.mock.calls.map((c) => c[0])).toEqual(['a', 'b'])
    expect(out).toEqual({ recorded: 2, unknown: 0, failed: 0, brlCompleted: 0, more: true })
    const again = await sweepPendingCosts(asDb(db), getPrediction, async () => FX, { ...OPTS, limit: 2 })
    expect(again).toEqual({ recorded: 1, unknown: 0, failed: 0, brlCompleted: 0, more: false })
  })

  it('trabalho ainda não terminado fica pra depois', async () => {
    const db = dbWith([job('a', { created_at: '2026-11-01T10:00:00Z' })])
    const out = await sweepPendingCosts(asDb(db), async (id) => done(id, { status: 'processing', metrics: null }), async () => FX, OPTS)
    expect(out).toEqual({ recorded: 0, unknown: 0, failed: 0, brlCompleted: 0, more: false })
    expect(rowOf(db, 'a').cost_recorded_at).toBeNull()
  })

  it('status estranho não trava a varredura', async () => {
    const db = dbWith([job('a', { created_at: '2026-11-01T10:00:00Z' })])
    const out = await sweepPendingCosts(asDb(db), async (id) => done(id, { status: 'aborted', metrics: null }), async () => FX, OPTS)
    expect(out).toMatchObject({ recorded: 0, unknown: 1, failed: 0 })
    expect(rowOf(db, 'a')).toMatchObject({ status: 'unknown', cost_recorded_at: NOW.toISOString() })
    // na próxima varredura a linha já não ocupa a janela
    const getPrediction = vi.fn(async () => null)
    await sweepPendingCosts(asDb(db), getPrediction, async () => FX, OPTS)
    expect(getPrediction).not.toHaveBeenCalled()
  })

  it('falha ao gravar uma linha marca unknown e segue', async () => {
    const db = dbWith([
      job('a', { created_at: '2026-11-01T10:00:00Z' }),
      job('b', { created_at: '2026-11-02T10:00:00Z' }),
    ])
    failCostWriteFor(db, 'a')
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    const out = await sweepPendingCosts(asDb(db), async (id) => done(id), async () => FX, OPTS)
    expect(out).toEqual({ recorded: 1, unknown: 0, failed: 1, brlCompleted: 0, more: false })
    expect(log).toHaveBeenCalledTimes(1)
    expect(rowOf(db, 'a')).toMatchObject({ status: 'unknown', cost_usd: null, cost_recorded_at: NOW.toISOString() })
    expect(rowOf(db, 'b')).toMatchObject({ status: 'succeeded', cost_usd: 0.009 })
  })

  it('Replicate fora deixa a linha pra depois e para a varredura', async () => {
    const db = dbWith([
      job('a', { created_at: '2026-11-01T10:00:00Z' }),
      job('b', { created_at: '2026-11-02T10:00:00Z' }),
    ])
    const getPrediction = vi.fn(async () => { throw new Error('Replicate sem resposta') })
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    const out = await sweepPendingCosts(asDb(db), getPrediction, async () => FX, OPTS)
    expect(log).toHaveBeenCalledTimes(1)
    expect(getPrediction).toHaveBeenCalledTimes(1)
    expect(out).toEqual({ recorded: 0, unknown: 0, failed: 1, brlCompleted: 0, more: true })
    expect(rowOf(db, 'a').cost_recorded_at).toBeNull()
    expect(rowOf(db, 'b').cost_recorded_at).toBeNull()
  })

  it('varredura completa o real de quem tem dólar quando há câmbio', async () => {
    const semReal = (id: string, usd: number) => job(id, {
      created_at: '2026-11-16T13:00:00Z', completed_at: '2026-11-16T13:01:00Z', status: 'succeeded',
      cost_usd: usd, hardware: 'gpu-t4', cost_recorded_at: '2026-11-16T13:05:00Z',
    })
    const db = dbWith([semReal('a', 0.009), semReal('z', 0), job('pronto', { cost_usd: 0.01, cost_brl: 0.05, cost_recorded_at: '2026-11-02T10:05:00Z' })])
    const getPrediction = vi.fn(async () => null)

    const semCambio = await sweepPendingCosts(asDb(db), getPrediction, async () => null, OPTS)
    expect(semCambio.brlCompleted).toBe(0)
    expect(rowOf(db, 'a').cost_brl).toBeNull()

    const getFx = vi.fn(async (day: string) => (day === '2026-11-16' ? FX : null))
    const out = await sweepPendingCosts(asDb(db), getPrediction, getFx, OPTS)
    expect(out).toEqual({ recorded: 0, unknown: 0, failed: 0, brlCompleted: 2, more: false })
    expect(getFx.mock.calls).toEqual([['2026-11-16']])
    expect(getPrediction).not.toHaveBeenCalled()
    expect(rowOf(db, 'a')).toMatchObject({ cost_brl: 0.0483, fx_usd_brl: 5.3712, fx_date: '2026-11-16' })
    expect(rowOf(db, 'z')).toMatchObject({ cost_brl: 0, fx_usd_brl: 5.3712 })
    expect(rowOf(db, 'pronto').cost_brl).toBe(0.05)
  })

  it('duas varreduras juntas não contam o mesmo real duas vezes', async () => {
    const db = dbWith([job('a', {
      created_at: '2026-11-16T13:00:00Z', status: 'succeeded', cost_usd: 0.009, cost_recorded_at: '2026-11-16T13:05:00Z',
    })])
    const run = () => sweepPendingCosts(asDb(db), async () => null, async () => FX, OPTS)
    const [x, y] = await Promise.all([run(), run()])
    expect(x.brlCompleted + y.brlCompleted).toBe(1)
    expect(rowOf(db, 'a').cost_brl).toBe(0.0483)
  })

  it('câmbio que falha não derruba a varredura: grava só o dólar', async () => {
    const db = dbWith([job('a', { created_at: '2026-11-01T10:00:00Z' })])
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    const out = await sweepPendingCosts(asDb(db), async (id) => done(id), async () => { throw new Error('BC fora') }, OPTS)
    expect(log).toHaveBeenCalledTimes(1)
    expect(out).toMatchObject({ recorded: 1, brlCompleted: 0 })
    expect(rowOf(db, 'a')).toMatchObject({ cost_usd: 0.009, cost_brl: null, fx_usd_brl: null })
  })
})

describe('getUsdBrlOn: PTAX de venda do dia de Brasília do trabalho', () => {
  it('dia guardado não consulta o Banco Central', async () => {
    const db = dbWith([], [fxRow('2026-10-15', 5.6102, '2026-10-15T16:10:00Z'), fxRow('2026-11-16', 5.3655, '2026-11-16T16:10:00Z')])
    const fetchFn = bcb()
    expect(await getUsdBrlOn(asDb(db), '2026-10-15', { now: NOW, fetchFn })).toEqual({ rate: 5.6102, date: '2026-10-15', stale: false })
    expect(fetchFn).not.toHaveBeenCalled()
  })

  it('fim de semana usa o último dia útil guardado sem consultar', async () => {
    const db = dbWith([], [fxRow('2026-10-30', 5.4512, '2026-10-30T16:10:00Z')])
    const fetchFn = bcb()
    expect(await getUsdBrlOn(asDb(db), '2026-11-01', { now: NOW, fetchFn })).toEqual({ rate: 5.4512, date: '2026-10-30', stale: false })
    expect(fetchFn).not.toHaveBeenCalled()
  })

  it('sem o dia guardado consulta a janela de 8 dias pra trás e grava', async () => {
    const db = dbWith([], [fxRow('2026-11-16', 5.3655, '2026-11-16T16:10:00Z')])
    const fetchFn = bcb()
    expect(await getUsdBrlOn(asDb(db), '2026-10-15', { now: NOW, fetchFn })).toEqual({ rate: 5.6102, date: '2026-10-15', stale: false })
    expect(fetchFn).toHaveBeenCalledTimes(1)
    expect(String(fetchFn.mock.calls[0][0])).toBe(ptaxPeriodUrl('2026-10-07', '2026-10-15'))
    const dates = db.tables.fx_rates.map((r) => r.rate_date).sort()
    expect(dates).toEqual(['2026-10-09', '2026-10-13', '2026-10-14', '2026-10-15', '2026-11-16'])
    expect(db.tables.fx_rates.find((r) => r.rate_date === '2026-10-15')).toMatchObject({ usd_brl: 5.6102, fetched_at: NOW.toISOString() })
    // a próxima pergunta do mesmo dia já sai do guardado
    await getUsdBrlOn(asDb(db), '2026-10-15', { now: NOW, fetchFn })
    expect(fetchFn).toHaveBeenCalledTimes(1)
  })

  it('feriado num dia passado usa o último dia útil que o Banco Central devolve', async () => {
    const db = dbWith([], [fxRow('2026-10-09', 5.5501, '2026-10-09T16:10:00Z')])
    const fetchFn = bcb()
    // 12/10 é segunda e feriado: o guardado de sexta não basta sozinho, o Banco Central confirma
    expect(await getUsdBrlOn(asDb(db), '2026-10-12', { now: NOW, fetchFn })).toEqual({ rate: 5.5501, date: '2026-10-09', stale: false })
    expect(fetchFn).toHaveBeenCalledTimes(1)
  })

  it('Banco Central fora deixa sem câmbio, mesmo com outro dia guardado', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const db = dbWith([], [fxRow('2026-10-01', 5.5, '2026-10-01T16:10:00Z'), fxRow('2026-11-16', 5.3655, '2026-11-16T16:10:00Z')])
    expect(await getUsdBrlOn(asDb(db), '2026-10-15', { now: NOW, fetchFn: bcbDown() })).toBeNull()
    const vazio = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ value: [] }), { status: 200 }))
    expect(await getUsdBrlOn(asDb(db), '2026-10-15', { now: NOW, fetchFn: vazio })).toBeNull()
    const erro = vi.fn<typeof fetch>(async () => new Response('{}', { status: 500 }))
    expect(await getUsdBrlOn(asDb(db), '2026-10-15', { now: NOW, fetchFn: erro })).toBeNull()
    expect(warn).toHaveBeenCalled()
  })

  it('hoje antes de a PTAX sair fica sem câmbio, depois usa a do dia', async () => {
    const manha = new Date('2026-11-17T12:00:00Z') // 09:00 de Brasília, terça
    const db = dbWith([], [fxRow('2026-11-16', 5.3655, '2026-11-16T16:10:00Z')])
    expect(await getUsdBrlOn(asDb(db), '2026-11-17', { now: manha, fetchFn: bcb() })).toBeNull()
    const tarde = new Date('2026-11-17T17:00:00Z')
    const comHoje = bcb({ ...PTAX, '2026-11-17': 5.3501 })
    expect(await getUsdBrlOn(asDb(db), '2026-11-17', { now: tarde, fetchFn: comHoje })).toEqual({ rate: 5.3501, date: '2026-11-17', stale: false })
  })

  it('varrer o histórico não faz o câmbio de hoje parecer novo', async () => {
    // sem nada guardado, as cotações de outubro não são gravadas como a mais nova
    const vazio = dbWith([])
    expect((await getUsdBrlOn(asDb(vazio), '2026-10-15', { now: NOW, fetchFn: bcb() }))?.date).toBe('2026-10-15')
    expect(await getStoredUsdBrl(asDb(vazio), NOW)).toBeNull()

    // com uma cotação mais nova guardada há dias, outubro é gravado e a de hoje continua velha
    const db = dbWith([], [fxRow('2026-11-13', 5.3712, '2026-11-13T16:10:00Z')])
    await getUsdBrlOn(asDb(db), '2026-10-15', { now: NOW, fetchFn: bcb() })
    expect(db.tables.fx_rates.some((r) => r.rate_date === '2026-10-15')).toBe(true)
    expect(db.tables.fx_rates.find((r) => r.rate_date === '2026-11-13')?.fetched_at).toBe('2026-11-13T16:10:00Z')
    const hoje = bcb()
    expect(await getUsdBrl(asDb(db), { now: NOW, fetchFn: hoje })).toEqual({ rate: 5.3655, date: '2026-11-16', stale: false })
    expect(hoje).toHaveBeenCalledTimes(1)
  })

  it('dia inválido ou no futuro devolve null sem consultar', async () => {
    const fetchFn = bcb()
    const db = dbWith([])
    expect(await getUsdBrlOn(asDb(db), '2026-11-18', { now: NOW, fetchFn })).toBeNull()
    expect(await getUsdBrlOn(asDb(db), '15/10/2026', { now: NOW, fetchFn })).toBeNull()
    expect(fetchFn).not.toHaveBeenCalled()
  })
})

describe('sweepPendingCosts com o câmbio do dia do trabalho', () => {
  const OPTS = { now: NOW, limit: 20, budgetMs: 20000, olderThanMs: 60 * 60 * 1000 }
  const fxOnDay = (db: FakeDb, fetchFn: typeof fetch) => (day: string) => getUsdBrlOn(asDb(db), day, { now: NOW, fetchFn })

  it('trabalho de outubro varrido em novembro usa a PTAX de outubro', async () => {
    const db = dbWith([job('out', { created_at: '2026-10-15T14:00:00Z' })], [fxRow('2026-11-16', 5.3655, '2026-11-17T14:00:00Z')])
    const out = await sweepPendingCosts(asDb(db), async (id) => done(id, { completed_at: '2026-10-15T14:01:30Z' }), fxOnDay(db, bcb()), OPTS)
    expect(out).toMatchObject({ recorded: 1, failed: 0 })
    expect(rowOf(db, 'out')).toMatchObject({ cost_usd: 0.009, fx_usd_brl: 5.6102, fx_date: '2026-10-15', cost_brl: 0.0505 })
  })

  it('trabalho às 23:30 de Brasília do dia 30 usa o dia 30', async () => {
    const db = dbWith([
      job('p', { created_at: '2026-10-31T02:28:00Z' }),
      job('q', { created_at: '2026-10-31T02:25:00Z', completed_at: '2026-10-31T02:30:00Z', status: 'succeeded', cost_usd: 0.009, cost_recorded_at: '2026-10-31T02:31:00Z' }),
    ])
    const getFx = vi.fn(async (day: string) => (PTAX[day] ? { rate: PTAX[day], date: day, stale: false } : null))
    await sweepPendingCosts(asDb(db), async (id) => done(id, { completed_at: '2026-10-31T02:30:00Z' }), getFx, OPTS)
    expect(getFx.mock.calls).toEqual([['2026-10-30']])
    expect(rowOf(db, 'p')).toMatchObject({ fx_date: '2026-10-30', fx_usd_brl: 5.4512, cost_brl: 0.0491 })
    expect(rowOf(db, 'q')).toMatchObject({ fx_date: '2026-10-30', fx_usd_brl: 5.4512, cost_brl: 0.0491 })
  })

  it('fim de semana usa o último dia útil', async () => {
    const db = dbWith([job('sab', { created_at: '2026-10-31T15:00:00Z' })])
    await sweepPendingCosts(asDb(db), async (id) => done(id, { completed_at: '2026-10-31T15:01:00Z' }), fxOnDay(db, bcb()), OPTS)
    expect(rowOf(db, 'sab')).toMatchObject({ fx_date: '2026-10-30', fx_usd_brl: 5.4512 })
  })

  it('Banco Central fora deixa sem R$ até a próxima varredura, nunca com o câmbio de outro dia', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const db = dbWith([job('out', { created_at: '2026-10-15T14:00:00Z' })], [fxRow('2026-11-16', 5.3655, '2026-11-17T14:00:00Z')])
    const getPrediction = async (id: string) => done(id, { completed_at: '2026-10-15T14:01:30Z' })
    const fora = await sweepPendingCosts(asDb(db), getPrediction, fxOnDay(db, bcbDown()), OPTS)
    expect(fora).toMatchObject({ recorded: 1, brlCompleted: 0 })
    expect(rowOf(db, 'out')).toMatchObject({ cost_usd: 0.009, cost_brl: null, fx_usd_brl: null, fx_date: null })
    expect(warn).toHaveBeenCalled()

    const volta = await sweepPendingCosts(asDb(db), getPrediction, fxOnDay(db, bcb()), OPTS)
    expect(volta).toMatchObject({ recorded: 0, brlCompleted: 1 })
    expect(rowOf(db, 'out')).toMatchObject({ cost_brl: 0.0505, fx_date: '2026-10-15' })
  })

  it('Banco Central fora não gasta a varredura consultando dia por dia', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const db = dbWith([
      job('a', { created_at: '2026-10-13T14:00:00Z' }),
      job('b', { created_at: '2026-10-14T14:00:00Z' }),
      job('c', { created_at: '2026-10-15T14:00:00Z' }),
    ])
    const fetchFn = bcbDown()
    const out = await sweepPendingCosts(asDb(db), async (id) => done(id, { completed_at: null }), fxOnDay(db, fetchFn), OPTS)
    expect(fetchFn).toHaveBeenCalledTimes(1)
    expect(out).toMatchObject({ recorded: 3, failed: 0 })
    for (const id of ['a', 'b', 'c']) expect(rowOf(db, id)).toMatchObject({ cost_usd: 0.009, cost_brl: null })
    expect(warn).toHaveBeenCalledTimes(1)
  })

  it('câmbio de outro dia vindo de fora é recusado', async () => {
    const db = dbWith([job('out', { created_at: '2026-10-15T14:00:00Z' })])
    // FX é de 16/11: não serve pra um trabalho de 15/10
    await sweepPendingCosts(asDb(db), async (id) => done(id, { completed_at: '2026-10-15T14:01:30Z' }), async () => FX, OPTS)
    expect(rowOf(db, 'out')).toMatchObject({ cost_usd: 0.009, cost_brl: null, fx_date: null })
  })

  it('dois trabalhos do mesmo dia fazem 1 consulta, cada dia com a própria cotação', async () => {
    const db = dbWith([
      job('a', { created_at: '2026-10-15T12:00:00Z' }),
      job('b', { created_at: '2026-10-16T01:00:00Z' }), // 22:00 de 15/10 em Brasília
      job('c', { created_at: '2026-10-15T13:00:00Z', completed_at: '2026-10-15T13:01:00Z', status: 'succeeded', cost_usd: 0.009, cost_recorded_at: '2026-10-15T13:02:00Z' }),
      job('d', { created_at: '2026-10-30T15:00:00Z' }),
    ])
    const fetchFn = bcb()
    const completed: Record<string, string> = { a: '2026-10-15T12:01:00Z', b: '2026-10-16T01:01:00Z', d: '2026-10-30T15:01:00Z' }
    const out = await sweepPendingCosts(asDb(db), async (id) => done(id, { completed_at: completed[id] }), fxOnDay(db, fetchFn), OPTS)
    expect(out).toEqual({ recorded: 3, unknown: 0, failed: 0, brlCompleted: 1, more: false })
    expect(fetchFn).toHaveBeenCalledTimes(2)
    for (const id of ['a', 'b', 'c']) expect(rowOf(db, id)).toMatchObject({ fx_date: '2026-10-15', fx_usd_brl: 5.6102 })
    expect(rowOf(db, 'd')).toMatchObject({ fx_date: '2026-10-30', fx_usd_brl: 5.4512 })
  })
})

describe('fakeSupabase: .gte compara instantes ISO como instantes', () => {
  const ids = async (db: FakeDb, value: unknown) => {
    const { data } = await db.from('t').select('id').gte('at', value)
    return (data as Row[]).map((r) => r.id).sort()
  }

  it('precisão e fuso diferentes', async () => {
    const db = createFakeDb({ tables: { t: [
      { id: 'ms', at: '2026-12-01T03:00:00.000Z' },
      { id: 'brt2330', at: '2026-11-30T23:30:00-03:00' },
      { id: 'brt0010', at: '2026-12-01T00:10:00-03:00' },
      { id: 'antes', at: '2026-12-01T02:59:59.999Z' },
      { id: 'nulo', at: null },
    ] } })
    expect(await ids(db, '2026-12-01T03:00:00Z')).toEqual(['brt0010', 'ms'])
    expect(await ids(db, '2026-12-01T00:00:00.000Z')).toEqual(['antes', 'brt0010', 'brt2330', 'ms'])
  })

  it('número e dia AAAA-MM-DD seguem como antes', async () => {
    const numeros = createFakeDb({ tables: { t: [{ id: 'zero', at: 0 }, { id: 'usd', at: 0.009 }, { id: 'neg', at: -1 }, { id: 'dez', at: 10 }] } })
    expect(await ids(numeros, 0)).toEqual(['dez', 'usd', 'zero'])
    expect(await ids(numeros, 9)).toEqual(['dez'])
    const dias = createFakeDb({ tables: { t: [{ id: 'd10', at: '2026-11-10' }, { id: 'd16', at: '2026-11-16' }] } })
    expect(await ids(dias, '2026-11-12')).toEqual(['d16'])
  })
})

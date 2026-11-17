import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createFakeDb, type DbResult, type FakeDb, type Row } from './fakeSupabase.js'
import type { FxRate } from '../_lib/fx.js'
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

function dbWith(rows: Row[]): FakeDb {
  return createFakeDb({ tables: { predictions: rows }, primaryKeys: { predictions: 'replicate_id' } })
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
      created_at: '2026-11-02T10:00:00Z', status: 'succeeded', cost_usd: usd, hardware: 'gpu-t4', cost_recorded_at: '2026-11-02T10:05:00Z',
    })
    const db = dbWith([semReal('a', 0.009), semReal('z', 0), job('pronto', { cost_usd: 0.01, cost_brl: 0.05, cost_recorded_at: '2026-11-02T10:05:00Z' })])
    const getPrediction = vi.fn(async () => null)

    const semCambio = await sweepPendingCosts(asDb(db), getPrediction, async () => null, OPTS)
    expect(semCambio.brlCompleted).toBe(0)
    expect(rowOf(db, 'a').cost_brl).toBeNull()

    const out = await sweepPendingCosts(asDb(db), getPrediction, async () => FX, OPTS)
    expect(out).toEqual({ recorded: 0, unknown: 0, failed: 0, brlCompleted: 2, more: false })
    expect(getPrediction).not.toHaveBeenCalled()
    expect(rowOf(db, 'a')).toMatchObject({ cost_brl: 0.0483, fx_usd_brl: 5.3712, fx_date: '2026-11-16' })
    expect(rowOf(db, 'z')).toMatchObject({ cost_brl: 0, fx_usd_brl: 5.3712 })
    expect(rowOf(db, 'pronto').cost_brl).toBe(0.05)
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

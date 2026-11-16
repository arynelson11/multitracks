import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  bpmColumns,
  isMissingMeterColumn,
  preciseBpm,
  sanitizeTimeSignature,
  withoutMeterColumns,
} from './cloudBpm'
// Cópia do servidor (o api/ não importa de src/): tem que dar o mesmo resultado.
import * as serverMeter from '../../api/_lib/meter'

// Cliente do Supabase falso: guarda cada update/insert e responde com o que o
// teste pôr na fila (o primeiro da fila vale pra próxima chamada).
const fakeDb = vi.hoisted(() => {
  type Reply = { data?: unknown; error: { code?: string; message: string } | null }
  const state = {
    calls: [] as { op: 'update' | 'insert'; payload: Record<string, unknown> }[],
    replies: [] as Reply[],
  }
  const next = (): Reply => state.replies.shift() ?? { data: { id: 'nova' }, error: null }
  const client = {
    from: () => ({
      update: (payload: Record<string, unknown>) => {
        state.calls.push({ op: 'update', payload })
        return { eq: async () => next() }
      },
      insert: (payload: Record<string, unknown>) => {
        state.calls.push({ op: 'insert', payload })
        return { select: () => ({ single: async () => next() }) }
      },
    }),
  }
  return { state, client }
})

vi.mock('@supabase/supabase-js', () => ({ createClient: () => fakeDb.client }))

// Cache offline em memória no lugar do IndexedDB.
const fakeIdb = vi.hoisted(() => ({ store: new Map<string, unknown>() }))
vi.mock('idb-keyval', () => ({
  get: async (k: string) => fakeIdb.store.get(k),
  set: async (k: string, v: unknown) => { fakeIdb.store.set(k, v) },
  del: async (k: string) => { fakeIdb.store.delete(k) },
  keys: async () => [...fakeIdb.store.keys()],
}))

const COLUNA_FALTANDO = {
  code: 'PGRST204',
  message: "Could not find the 'bpm_exact' column of 'songs' in the schema cache",
}

describe('preciseBpm', () => {
  it('prefere o BPM exato quando ele bate com o inteiro', () => {
    expect(preciseBpm({ bpm: 73, bpm_exact: 72.5 })).toBe(72.5)
    expect(preciseBpm({ bpm: 120, bpm_exact: 120 })).toBe(120)
  })

  it('cai no inteiro quando não há exato (música antiga ou banco sem a coluna)', () => {
    expect(preciseBpm({ bpm: 72 })).toBe(72)
    expect(preciseBpm({ bpm: 72, bpm_exact: null })).toBe(72)
  })

  it('sem inteiro nenhum, vale o exato', () => {
    expect(preciseBpm({ bpm_exact: 72.5 })).toBe(72.5)
    expect(preciseBpm({ bpm: null, bpm_exact: 72.5 })).toBe(72.5)
  })

  it('ignora 0, vazio e valores inválidos', () => {
    expect(preciseBpm({ bpm: 0 })).toBeUndefined()
    expect(preciseBpm({ bpm: 0, bpm_exact: 0 })).toBeUndefined()
    expect(preciseBpm({ bpm: 72, bpm_exact: 0 })).toBe(72)
    expect(preciseBpm({ bpm: null, bpm_exact: null })).toBeUndefined()
    expect(preciseBpm({})).toBeUndefined()
    expect(preciseBpm({ bpm: Number.NaN })).toBeUndefined()
  })

  it('ignora o exato velho quando um app antigo mudou só o inteiro', () => {
    // App antigo editou o BPM pra 74 e não conhece bpm_exact: vale o 74.
    expect(preciseBpm({ bpm: 74, bpm_exact: 72.5 })).toBe(74)
    // App antigo apagou o BPM (0): a música fica sem BPM.
    expect(preciseBpm({ bpm: 0, bpm_exact: 72.5 })).toBeUndefined()
  })

  it('aceita o numeric vindo como texto', () => {
    expect(preciseBpm({ bpm: 73, bpm_exact: '72.50' as unknown as number })).toBe(72.5)
  })
})

describe('bpmColumns', () => {
  it('guarda o inteiro arredondado e o exato com 2 casas', () => {
    expect(bpmColumns(72.5)).toEqual({ bpm: 73, bpm_exact: 72.5 })
    expect(bpmColumns(120)).toEqual({ bpm: 120, bpm_exact: 120 })
    expect(bpmColumns(72.456)).toEqual({ bpm: 72, bpm_exact: 72.46 })
  })

  it('o inteiro sai do exato já arredondado, pra os dois sempre baterem', () => {
    // 72,499 vira 72,5 com 2 casas; o inteiro é o de 72,5 (73), não o de 72,499 (72).
    expect(bpmColumns(72.499)).toEqual({ bpm: 73, bpm_exact: 72.5 })
    const cols = bpmColumns(72.499)
    expect(cols && preciseBpm(cols)).toBe(72.5)
  })

  it('fora de (0, 400) devolve null', () => {
    expect(bpmColumns(0)).toBeNull()
    expect(bpmColumns(Number.NaN)).toBeNull()
    expect(bpmColumns(-90)).toBeNull()
    expect(bpmColumns(400)).toBeNull()
    expect(bpmColumns(399.999)).toBeNull()
    expect(bpmColumns(0.001)).toBeNull()
    expect(bpmColumns(Number.POSITIVE_INFINITY)).toBeNull()
  })
})

describe('sanitizeTimeSignature', () => {
  it('aceita só os compassos do banco', () => {
    for (const ts of ['3/4', '4/4', '5/4', '6/8', '7/8', '12/8']) {
      expect(sanitizeTimeSignature(ts)).toBe(ts)
    }
    expect(sanitizeTimeSignature(' 6/8 ')).toBe('6/8')
  })

  it('recusa o resto', () => {
    expect(sanitizeTimeSignature('9/8')).toBeNull()
    expect(sanitizeTimeSignature('2/4')).toBeNull()
    expect(sanitizeTimeSignature('')).toBeNull()
    expect(sanitizeTimeSignature(null)).toBeNull()
    expect(sanitizeTimeSignature(undefined)).toBeNull()
    expect(sanitizeTimeSignature(4)).toBeNull()
    expect(sanitizeTimeSignature({ ts: '4/4' })).toBeNull()
  })
})

describe('banco ainda sem as colunas novas', () => {
  it('reconhece o erro de coluna faltando só pras colunas novas', () => {
    expect(isMissingMeterColumn(COLUNA_FALTANDO)).toBe(true)
    expect(isMissingMeterColumn({
      code: '42703',
      message: 'column "time_signature" of relation "songs" does not exist',
    })).toBe(true)
    expect(isMissingMeterColumn({
      code: 'PGRST204',
      message: "Could not find the 'lyrics' column of 'songs' in the schema cache",
    })).toBe(false)
    expect(isMissingMeterColumn({ code: '23514', message: 'violates check constraint on bpm_exact' })).toBe(false)
    expect(isMissingMeterColumn(null)).toBe(false)
    expect(isMissingMeterColumn('bpm_exact')).toBe(false)
  })

  it('tira só as colunas novas, sem mexer no original', () => {
    const row = { name: 'Grande és Tu', bpm: 73, bpm_exact: 72.5, time_signature: '6/8' }
    expect(withoutMeterColumns(row)).toEqual({ name: 'Grande és Tu', bpm: 73 })
    expect(row.bpm_exact).toBe(72.5)
    expect(row.time_signature).toBe('6/8')
  })
})

describe('paridade com a cópia do servidor (api/_lib/meter.ts)', () => {
  const bpms = [
    72.5, 72.499, 72.456, 72.455, 120, 1, 0.5, 0.01, 0.005, 0.004, 0.001, 0, -0, -1, -72.5,
    399.99, 399.994, 399.995, 399.999, 400, 400.01, 1000, Number.NaN,
    Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, 1e-9, 1e9,
  ]
  it.each(bpms)('bpmColumns(%s) igual nos dois lados', (v) => {
    expect(serverMeter.bpmColumns(v)).toEqual(bpmColumns(v))
  })

  const compassos: unknown[] = [
    '3/4', '4/4', '5/4', '6/8', '7/8', '12/8', ' 6/8 ', '6/8\n', '9/8', '2/4', '4/4 extra',
    '', ' ', 'undefined', null, undefined, 4, 0.75, true, ['4/4'], { ts: '4/4' },
  ]
  it.each(compassos)('sanitizeTimeSignature(%j) igual nos dois lados', (raw) => {
    expect(serverMeter.sanitizeTimeSignature(raw)).toBe(sanitizeTimeSignature(raw))
  })

  const erros: unknown[] = [
    COLUNA_FALTANDO,
    { code: 'PGRST204', message: "Could not find the 'time_signature' column of 'songs' in the schema cache" },
    { code: '42703', message: 'column "bpm_exact" of relation "songs" does not exist' },
    { code: 'PGRST204', message: "Could not find the 'lyrics' column of 'songs' in the schema cache" },
    { code: '23514', message: 'violates check constraint on bpm_exact' },
    { code: 'PGRST204' },
    { code: 'PGRST204', message: 42 },
    { message: 'bpm_exact' },
    null, undefined, 'bpm_exact', 0,
  ]
  it.each(erros)('isMissingMeterColumn(%j) igual nos dois lados', (e) => {
    expect(serverMeter.isMissingMeterColumn(e)).toBe(isMissingMeterColumn(e))
  })

  it('as listas fechadas são as mesmas', () => {
    expect([...serverMeter.SONG_METER_COLUMNS]).toEqual(['bpm_exact', 'time_signature'])
    const row = { name: 'X', bpm: 73, bpm_exact: 72.5, time_signature: '6/8' }
    expect(serverMeter.withoutMeterColumns(row)).toEqual(withoutMeterColumns(row))
  })
})

describe('gravação na nuvem tolerante (supabase.ts)', () => {
  afterEach(() => {
    fakeDb.state.calls.length = 0
    fakeDb.state.replies.length = 0
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  async function loadSupabase() {
    vi.stubEnv('VITE_SUPABASE_URL', 'https://exemplo.supabase.co')
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'chave-de-teste')
    vi.resetModules()
    return await import('./supabase')
  }

  it('updateSong grava bpm, bpm_exact e time_signature de uma vez', async () => {
    const { updateSong } = await loadSupabase()
    const ok = await updateSong('s1', { name: 'X', bpm: 73, bpm_exact: 72.5, time_signature: '6/8' })
    expect(ok).toBe(true)
    expect(fakeDb.state.calls).toHaveLength(1)
    expect(fakeDb.state.calls[0].payload).toEqual({ name: 'X', bpm: 73, bpm_exact: 72.5, time_signature: '6/8' })
  })

  it('updateSong repete sem as colunas novas se o banco ainda não as tem', async () => {
    const { updateSong } = await loadSupabase()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    fakeDb.state.replies.push({ error: COLUNA_FALTANDO })
    const ok = await updateSong('s1', { name: 'X', bpm: 73, bpm_exact: 72.5 })
    expect(ok).toBe(true)
    expect(fakeDb.state.calls.map(c => c.payload)).toEqual([
      { name: 'X', bpm: 73, bpm_exact: 72.5 },
      { name: 'X', bpm: 73 },
    ])
    expect(warn).toHaveBeenCalledTimes(1)
  })

  it('updateSong não finge sucesso quando só havia coluna nova pra gravar', async () => {
    const { updateSong } = await loadSupabase()
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    fakeDb.state.replies.push({ error: COLUNA_FALTANDO })
    expect(await updateSong('s1', { time_signature: '6/8' })).toBe(false)
    expect(fakeDb.state.calls).toHaveLength(1)
  })

  it('updateSong não repete em outro erro', async () => {
    const { updateSong } = await loadSupabase()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    fakeDb.state.replies.push({ error: { code: '42501', message: 'permission denied' } })
    expect(await updateSong('s1', { bpm: 73, bpm_exact: 72.5 })).toBe(false)
    expect(fakeDb.state.calls).toHaveLength(1)
  })

  it('insertSong repete sem as colunas novas se o banco ainda não as tem', async () => {
    const { insertSong } = await loadSupabase()
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    fakeDb.state.replies.push({ error: COLUNA_FALTANDO }, { data: { id: 'id-novo' }, error: null })
    const id = await insertSong({
      name: 'X', artist: '', key: 'G', bpm: 73, bpm_exact: 72.5, time_signature: '6/8', cover_url: null,
    })
    expect(id).toBe('id-novo')
    expect(fakeDb.state.calls.map(c => c.payload)).toEqual([
      { name: 'X', artist: '', key: 'G', bpm: 73, bpm_exact: 72.5, time_signature: '6/8', cover_url: null },
      { name: 'X', artist: '', key: 'G', bpm: 73, cover_url: null },
    ])
  })
})

describe('cache offline (getCachedSong)', () => {
  afterEach(() => { fakeIdb.store.clear() })

  function putCached(song: Record<string, unknown>) {
    fakeIdb.store.set('playback-studio:song:s1', {
      songId: 's1',
      song: { id: 's1', name: 'X', artist: 'A', key: 'G', cover_url: null, markers: null, created_at: '', ...song },
      stemNames: ['Click.wav'],
      coverBlob: null,
    })
    fakeIdb.store.set('playback-studio:song:s1:stem:0', new Blob([new Uint8Array([1, 2, 3])]))
  }

  it('devolve o BPM exato e o compasso salvos', async () => {
    const { getCachedSong } = await import('./offlineCache')
    putCached({ bpm: 73, bpm_exact: 72.5, time_signature: '6/8' })
    const r = await getCachedSong('s1')
    expect(r?.bpm).toBe(72.5)
    expect(r?.timeSignature).toBe('6/8')
  })

  it('música baixada antes da coluna nova: inteiro e sem compasso', async () => {
    const { getCachedSong } = await import('./offlineCache')
    putCached({ bpm: 73 })
    const r = await getCachedSong('s1')
    expect(r?.bpm).toBe(73)
    expect(r?.timeSignature).toBeNull()
  })

  it('updateCachedSongMeta leva bpm e bpm_exact pro índice', async () => {
    const { getCachedSong, updateCachedSongMeta } = await import('./offlineCache')
    vi.spyOn(console, 'log').mockImplementation(() => {})
    putCached({ bpm: 73 })
    await updateCachedSongMeta('s1', { bpm: 71, bpm_exact: 70.75 })
    expect((await getCachedSong('s1'))?.bpm).toBe(70.75)
  })
})

// @vitest-environment jsdom
// Biblioteca de separações na nuvem (plano pago), lida pelo palco só pelo id (sep-1 M7). Quem acabou
// de virar pago ainda tem as separações só no aparelho: a migração pra nuvem rodava só com a lista
// (`loadList`), e o palco (que não busca a lista) nunca achava a separação. Agora a leitura pelo id
// que não acha na nuvem faz a migração uma vez e lê de novo.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, renderHook } from '@testing-library/react'
import type { SavedSeparation } from './useSeparationLibrary'

type Row = { id: string; user_id: string; song_name: string; created_at: string; [k: string]: unknown }

const mem = vi.hoisted(() => ({
  idb: new Map<string, unknown>(),
  rows: [] as Row[],
  upserts: 0,
  gets: 0,
}))
vi.mock('idb-keyval', () => ({
  get: async (k: string) => mem.idb.get(k),
  set: async (k: string, v: unknown) => { mem.idb.set(k, v) },
}))
vi.mock('../lib/supabase', () => {
  const from = () => {
    const filters: Record<string, unknown> = {}
    const matches = (r: Row) => Object.entries(filters).every(([k, v]) => r[k] === v)
    const q = {
      select: () => q,
      eq: (k: string, v: unknown) => { filters[k] = v; return q },
      order: async () => ({ data: mem.rows.filter(matches), error: null }),
      maybeSingle: async () => { mem.gets++; return { data: mem.rows.find(matches) ?? null, error: null } },
      upsert: async (rows: Row | Row[]) => {
        mem.upserts++
        for (const r of Array.isArray(rows) ? rows : [rows]) mem.rows = [...mem.rows.filter((x) => x.id !== r.id), r]
        return { error: null }
      },
    }
    return q
  }
  return { supabase: { from } }
})
vi.mock('./useAuth', () => ({ useAuth: () => ({ user: { id: 'u1' }, userPlan: 'essencial_mensal', isAdmin: false }) }))

const { useSeparationLibrary } = await import('./useSeparationLibrary')

const LOCAL: SavedSeparation = {
  id: 'sep_local', songName: 'Fé', artist: '', bpm: '120', songKey: 'C', voiceCues: [], createdAt: Date.UTC(2026, 9, 10),
  stems: [{ id: 'vocals', name: 'Vocais', url: 'https://r2/v.wav', color: '#06b6d4' }],
}

afterEach(() => {
  cleanup()
  mem.idb.clear()
  mem.rows = []
  mem.upserts = 0
  mem.gets = 0
})

describe('getSeparation na nuvem (palco, sem a lista)', () => {
  it('sep-1 M7: a separação que ainda está só no aparelho sobe pra nuvem e é achada', async () => {
    mem.idb.set('sep__index', [LOCAL])
    const { result } = renderHook(() => useSeparationLibrary({ loadList: false }))
    const found = await result.current.getSeparation('sep_local')
    expect(found).toMatchObject({ id: 'sep_local', songName: 'Fé', createdAt: LOCAL.createdAt })
    expect(mem.rows.map((r) => r.id)).toEqual(['sep_local'])
    // A migração é uma vez só: a próxima que falta não migra de novo.
    const upserts = mem.upserts
    expect(await result.current.getSeparation('sep_que_nao_existe')).toBeNull()
    expect(mem.upserts).toBe(upserts)
  })

  it('achada na nuvem de primeira: nada de migração', async () => {
    mem.rows = [{ id: 'sep_n', user_id: 'u1', song_name: 'Nuvem', created_at: new Date(LOCAL.createdAt).toISOString(), stems: LOCAL.stems, voice_cues: [] }]
    mem.idb.set('sep__index', [LOCAL])
    const { result } = renderHook(() => useSeparationLibrary({ loadList: false }))
    expect(await result.current.getSeparation('sep_n')).toMatchObject({ id: 'sep_n', songName: 'Nuvem' })
    expect(mem.upserts).toBe(0)
    expect(mem.gets).toBe(1)
  })

  it('apagada depois de migrada: continua sumida (a migração já feita não traz de volta)', async () => {
    mem.idb.set('sep__index', [LOCAL])
    mem.idb.set('sep__migrated_to_cloud_for_user:u1', '1')
    const { result } = renderHook(() => useSeparationLibrary({ loadList: false }))
    expect(await result.current.getSeparation('sep_local')).toBeNull()
    expect(mem.upserts).toBe(0)
  })
})

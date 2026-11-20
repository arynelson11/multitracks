// @vitest-environment jsdom
// Data da separação ao gravar de novo (Parte 3, T19). No Livre, a separação de um mês anterior
// conta nas 3 músicas do mês e a do mês abre de graça, pela data dela (`createdAt`). Gravar de
// novo nunca pode trocar essa data: quem grava passa a data que tem, e o hook só cai na da lista
// (ou em agora, pra separação nova) quando não recebe nenhuma. Antes, sem achar a separação na
// lista desta instância (a lista troca quando o plano muda), o hook gravava "agora".
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import type { SavedSeparation } from './useSeparationLibrary'

// A biblioteca local do Livre (IndexedDB pelo idb-keyval) num mapa em memória.
const idb = vi.hoisted(() => ({ store: new Map<string, unknown>() }))
vi.mock('idb-keyval', () => ({
  get: async (k: string) => idb.store.get(k),
  set: async (k: string, v: unknown) => { idb.store.set(k, v) },
}))
// Sem Supabase: o hook usa só a biblioteca local, como no Livre.
vi.mock('../lib/supabase', () => ({ supabase: null }))
vi.mock('./useAuth', () => ({ useAuth: () => ({ user: { id: 'livre' }, userPlan: 'free', isAdmin: false }) }))

const { useSeparationLibrary } = await import('./useSeparationLibrary')

const OCT = Date.UTC(2026, 9, 10, 15, 0, 0)
const NOW = Date.UTC(2026, 10, 20, 15, 0, 0)
const BASE = { songName: 'Fé', artist: '', bpm: '120', songKey: 'C', stems: [], voiceCues: [] }

const saved = (id: string) => (idb.store.get('sep__index') as SavedSeparation[] | undefined)?.find((s) => s.id === id)

async function mountLibrary() {
  const hook = renderHook(() => useSeparationLibrary())
  await waitFor(() => expect(hook.result.current.isLoading).toBe(false))
  return hook
}

afterEach(() => {
  cleanup()
  idb.store.clear()
})

describe('saveSeparation guarda a data da separação', () => {
  it('com createdAt, a data fica mesmo sem a separação na lista (a de outubro não vira deste mês)', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(NOW)
    const { result } = await mountLibrary()
    expect(result.current.separations).toHaveLength(0)
    await act(async () => { await result.current.saveSeparation({ ...BASE, id: 'sep_out', createdAt: OCT }) })
    expect(saved('sep_out')?.createdAt).toBe(OCT)
    expect(result.current.separations.find((s) => s.id === 'sep_out')?.createdAt).toBe(OCT)
  })

  it('com createdAt, ele vale mesmo quando a lista tem outra data', async () => {
    idb.store.set('sep__index', [{ ...BASE, id: 'sep_out', createdAt: NOW }])
    const { result } = await mountLibrary()
    await act(async () => { await result.current.saveSeparation({ ...BASE, id: 'sep_out', createdAt: OCT }) })
    expect(saved('sep_out')?.createdAt).toBe(OCT)
  })

  it('sem createdAt, com a separação na lista, fica a data da lista', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(NOW)
    idb.store.set('sep__index', [{ ...BASE, id: 'sep_out', createdAt: OCT }])
    const { result } = await mountLibrary()
    await waitFor(() => expect(result.current.separations).toHaveLength(1))
    await act(async () => { await result.current.saveSeparation({ ...BASE, id: 'sep_out', songName: 'Novo nome' }) })
    expect(saved('sep_out')).toMatchObject({ songName: 'Novo nome', createdAt: OCT })
  })

  it('sem createdAt e sem a separação na lista usa agora (como antes)', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(NOW)
    const { result } = await mountLibrary()
    await act(async () => { await result.current.saveSeparation({ ...BASE, id: 'sep_sumida' }) })
    expect(saved('sep_sumida')?.createdAt).toBe(NOW)
  })

  it('separação nova com createdAt grava com ela e ganha id novo', async () => {
    const { result } = await mountLibrary()
    const out: { id: string | null } = { id: null }
    await act(async () => { out.id = await result.current.saveSeparation({ ...BASE, createdAt: NOW }) })
    expect(out.id).toMatch(/^sep_/)
    expect(saved(out.id ?? '')?.createdAt).toBe(NOW)
  })

  it('createdAt estragado não vale: fica a data da lista ou agora', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(NOW)
    idb.store.set('sep__index', [{ ...BASE, id: 'sep_out', createdAt: OCT }])
    const { result } = await mountLibrary()
    await waitFor(() => expect(result.current.separations).toHaveLength(1))
    await act(async () => { await result.current.saveSeparation({ ...BASE, id: 'sep_out', createdAt: Number.NaN }) })
    expect(saved('sep_out')?.createdAt).toBe(OCT)
    await act(async () => { await result.current.saveSeparation({ ...BASE, id: 'sep_nova', createdAt: Number.POSITIVE_INFINITY }) })
    expect(saved('sep_nova')?.createdAt).toBe(NOW)
  })
})

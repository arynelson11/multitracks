// @vitest-environment jsdom
// Os textos do andamento da Biblioteca (inicio-1 I2, Ruling textos-biblioteca) e o aviso de espaço
// em disco, que era o aviso do navegador e vira frase na janela (inicio-1 M2).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import type { CloudSong, CloudStem } from '../lib/supabase'

const SONG = { id: 's1', name: 'Fé', artist: 'Ministério', bpm: 72, bpm_exact: null, key: 'G', cover_url: null, is_global: true, user_id: 'u' } as unknown as CloudSong
const stem = (id: string): CloudStem => ({ id, song_id: 's1', name: `Faixa ${id}`, file_url: `https://r2/${id}.wav` } as unknown as CloudStem)

const db = vi.hoisted(() => ({
  fetchSongs: vi.fn(), searchSongs: vi.fn(), fetchStems: vi.fn(), downloadFileAsBlobWithProgress: vi.fn(), deleteSongFromCloud: vi.fn(),
  cacheSongsList: vi.fn(), getCachedSongsList: vi.fn(), cacheSong: vi.fn(), isSongCached: vi.fn(), removeCachedSong: vi.fn(), getCachedSongIds: vi.fn(),
}))
vi.mock('../lib/supabase', () => ({
  fetchSongs: db.fetchSongs, searchSongs: db.searchSongs, fetchStems: db.fetchStems,
  downloadFileAsBlobWithProgress: db.downloadFileAsBlobWithProgress, deleteSongFromCloud: db.deleteSongFromCloud,
}))
vi.mock('../lib/offlineCache', () => ({
  cacheSongsList: db.cacheSongsList, getCachedSongsList: db.getCachedSongsList, cacheSong: db.cacheSong,
  isSongCached: db.isSongCached, removeCachedSong: db.removeCachedSong, getCachedSongIds: db.getCachedSongIds,
}))

const { useCloudLibrary } = await import('./useCloudLibrary')

const MB = 1024 * 1024
const deferred = <T,>() => {
  let resolve!: (v: T) => void
  const promise = new Promise<T>((r) => { resolve = r })
  return { promise, resolve }
}

beforeEach(() => {
  db.fetchSongs.mockResolvedValue([SONG])
  db.searchSongs.mockResolvedValue([SONG])
  db.cacheSongsList.mockResolvedValue(undefined)
  db.getCachedSongsList.mockResolvedValue([])
  db.getCachedSongIds.mockResolvedValue(new Set())
  db.isSongCached.mockResolvedValue(false)
})
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  Reflect.deleteProperty(navigator, 'storage')
})

async function mounted() {
  const hook = renderHook(() => useCloudLibrary())
  await waitFor(() => expect(hook.result.current.songs).toHaveLength(1))
  return hook
}

describe('Biblioteca: o andamento do baixar em frases pro usuário (inicio-1 I2)', () => {
  it('"Buscando as multitracks...", "Baixando as multitracks: 128,4 MB (1 de 2)" e "Guardando no aparelho..."', async () => {
    const stems = deferred<CloudStem[]>()
    db.fetchStems.mockReturnValue(stems.promise)
    const second = deferred<File>()
    db.downloadFileAsBlobWithProgress.mockImplementation(async (url: string, name: string, onProgress: (n: number) => void) => {
      if (url.endsWith('a.wav')) { onProgress(100 * MB); return new File(['a'], name) }
      onProgress(Math.ceil(28.4 * MB))
      return second.promise
    })
    const saving = deferred<boolean>()
    db.cacheSong.mockReturnValue(saving.promise)
    const hook = await mounted()
    let done!: Promise<unknown>
    act(() => { done = hook.result.current.downloadSong('s1') })
    await waitFor(() => expect(hook.result.current.downloadProgress).toBe('Buscando as multitracks...'))
    await act(async () => { stems.resolve([stem('a'), stem('b')]) })
    await waitFor(() => expect(hook.result.current.downloadProgress).toBe('Baixando as multitracks: 128,4 MB (1 de 2)'))
    await act(async () => { second.resolve(new File(['b'], 'b.wav')) })
    await waitFor(() => expect(hook.result.current.downloadProgress).toBe('Guardando no aparelho...'))
    await act(async () => { saving.resolve(true); await done })
    expect(hook.result.current.downloadProgress).toBe('')
  })

  it('sem nenhuma faixa na nuvem: "Nenhuma multitrack encontrada."', async () => {
    db.fetchStems.mockResolvedValue([])
    const hook = await mounted()
    await act(async () => { expect(await hook.result.current.downloadSong('s1')).toBeNull() })
    expect(hook.result.current.downloadProgress).toBe('Nenhuma multitrack encontrada.')
  })

  it('nenhuma frase do andamento usa "stem", "Rede", "cache", "offline", "Erro:" nem ponto no número, e todas saem de LIBRARY_PROGRESS', async () => {
    const { LIBRARY_PROGRESS } = await import('./useCloudLibrary')
    const texts = Object.values(LIBRARY_PROGRESS).map((t) => (typeof t === 'function' ? t(128.4 * MB, 11, 12) : t))
    expect(texts).toContain('Baixando as multitracks: 128,4 MB (11 de 12)')
    for (const t of texts) expect(t).not.toMatch(/stem|Rede|cache|offline|Erro:|\d\.\d/i)
    const { readFileSync } = await import('node:fs')
    const { join } = await import('node:path')
    const src = readFileSync(join(process.cwd(), 'src/hooks/useCloudLibrary.ts'), 'utf8')
    expect(src).not.toMatch(/setDownloadProgress\(\s*[`'"][^`'"]/)
  })
})

describe('Biblioteca: abrir do aparelho em frases pro usuário (Ruling INICIO-residuais)', () => {
  it('"Abrindo do aparelho..." enquanto lê; sem a música no aparelho e sem internet, a frase diz o que fazer', async () => {
    db.getCachedSongsList.mockResolvedValue([SONG])
    const hook = await mounted()
    act(() => { window.dispatchEvent(new Event('offline')) })
    await waitFor(() => expect(hook.result.current.isOnline).toBe(false))
    const onDevice = deferred<boolean>()
    db.isSongCached.mockReturnValue(onDevice.promise)
    let pending!: Promise<unknown>
    act(() => { pending = hook.result.current.downloadSong('s1') })
    expect(hook.result.current.downloadProgress).toBe('Abrindo do aparelho...')
    let result: unknown
    await act(async () => { onDevice.resolve(false); result = await pending })
    expect(result).toBeNull()
    expect(hook.result.current.downloadProgress).toBe('Essa música não está no aparelho. Conecte à internet pra baixar.')
    expect(hook.result.current.downloadingSongId).toBeNull()
    expect(db.fetchStems).not.toHaveBeenCalled()
    act(() => { window.dispatchEvent(new Event('online')) })
  })
})

describe('Biblioteca: espaço em disco vira frase na janela (inicio-1 M2)', () => {
  it('com menos de 150 MB livres não baixa e devolve a frase, sem o aviso do navegador', async () => {
    Object.defineProperty(navigator, 'storage', { configurable: true, value: { estimate: async () => ({ usage: 0, quota: 100 * MB }) } })
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {})
    const hook = await mounted()
    let result: unknown
    await act(async () => { result = await hook.result.current.downloadSong('s1') })
    expect(result).toEqual({ refused: 'Espaço em disco insuficiente. Por favor, libere pelo menos 150MB no dispositivo.' })
    expect(alertSpy).not.toHaveBeenCalled()
    expect(db.fetchStems).not.toHaveBeenCalled()
    expect(hook.result.current.downloadingSongId).toBeNull()
  })
})

describe('Biblioteca: tirar deste aparelho não mexe na nuvem (inicio-1 M5)', () => {
  it("'device' com internet tira só do aparelho e a música continua na lista; 'cloud' exclui da nuvem", async () => {
    db.getCachedSongIds.mockResolvedValue(new Set(['s1']))
    db.removeCachedSong.mockResolvedValue(undefined)
    db.deleteSongFromCloud.mockResolvedValue(true)
    const hook = await mounted()
    await waitFor(() => expect(hook.result.current.cachedSongIds.has('s1')).toBe(true))
    await act(async () => { expect(await hook.result.current.removeSong('s1', 'device')).toBe(true) })
    expect(db.deleteSongFromCloud).not.toHaveBeenCalled()
    expect(db.removeCachedSong).toHaveBeenCalledWith('s1')
    expect(hook.result.current.cachedSongIds.has('s1')).toBe(false)
    expect(hook.result.current.songs.map((x) => x.id)).toEqual(['s1'])
    await act(async () => { await hook.result.current.removeSong('s1', 'cloud') })
    expect(db.deleteSongFromCloud).toHaveBeenCalledWith('s1')
    expect(hook.result.current.songs).toEqual([])
  })
})

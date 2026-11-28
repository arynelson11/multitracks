// @vitest-environment jsdom
// As frases do fim do baixar chegam à tela (inicio-residuais-2): a Biblioteca com o useCloudLibrary
// de verdade, só a nuvem e o aparelho simulados. Antes, o hook escrevia a frase no andamento e zerava
// a música baixando no mesmo lote, e ninguém via "Nenhuma multitrack encontrada.", a falha de rede
// nem "Grande demais pra guardar no aparelho.". Cancelar continua calado: foi a pessoa que pediu.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { CloudSong, CloudStem } from '../lib/supabase'

const SONG = {
  id: 's1', name: 'Fé', artist: 'Ministério', bpm: 72, bpm_exact: null, key: 'G', cover_url: null, is_global: true, user_id: 'outro',
} as unknown as CloudSong
const STEM = { id: 'a', song_id: 's1', name: 'Bateria', file_url: 'https://r2/a.wav' } as unknown as CloudStem

const db = vi.hoisted(() => ({
  fetchSongs: vi.fn(), searchSongs: vi.fn(), fetchStems: vi.fn(), downloadFileAsBlobWithProgress: vi.fn(), deleteSongFromCloud: vi.fn(),
  cacheSongsList: vi.fn(), getCachedSongsList: vi.fn(), cacheSong: vi.fn(), isSongCached: vi.fn(), removeCachedSong: vi.fn(), getCachedSongIds: vi.fn(),
}))
vi.mock('../lib/supabase', () => ({
  fetchSongs: db.fetchSongs, searchSongs: db.searchSongs, fetchStems: db.fetchStems,
  downloadFileAsBlobWithProgress: db.downloadFileAsBlobWithProgress, deleteSongFromCloud: db.deleteSongFromCloud, updateSong: vi.fn(),
}))
vi.mock('../lib/offlineCache', () => ({
  cacheSongsList: db.cacheSongsList, getCachedSongsList: db.getCachedSongsList, cacheSong: db.cacheSong,
  isSongCached: db.isSongCached, removeCachedSong: db.removeCachedSong, getCachedSongIds: db.getCachedSongIds, updateCachedSongMeta: vi.fn(),
}))
vi.mock('../lib/r2', () => ({ uploadToR2: vi.fn() }))
vi.mock('../hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 'u' }, isAdmin: false }) }))

const { LibraryModal } = await import('./LibraryModal')

beforeEach(() => {
  db.fetchSongs.mockResolvedValue([SONG])
  db.searchSongs.mockResolvedValue([SONG])
  db.cacheSongsList.mockResolvedValue(undefined)
  db.getCachedSongsList.mockResolvedValue([SONG])
  db.getCachedSongIds.mockResolvedValue(new Set())
  db.isSongCached.mockResolvedValue(false)
})
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  Reflect.deleteProperty(navigator, 'onLine')
})

const library = () => screen.getByRole('dialog', { name: 'Biblioteca na Nuvem' })
const row = () => document.querySelector('[data-library-row="s1"]') as HTMLElement

async function openLibrary(onDownload = vi.fn()) {
  render(<LibraryModal isOpen onClose={() => {}} onDownload={onDownload} />)
  await waitFor(() => expect(row()).toBeTruthy())
  return onDownload
}

/** A frase em alerta no alto da Biblioteca, fora da linha da música (a linha volta ao botão). */
async function seenNotice(text: string) {
  const notice = await within(library()).findByRole('alert')
  expect(notice.textContent).toBe(text)
  expect(row().contains(notice)).toBe(false)
  return notice
}

describe('Biblioteca: as frases do fim do baixar aparecem na tela (inicio-residuais-2)', () => {
  it('ABRIR sem internet com a música fora do aparelho: "Essa música não está no aparelho. Conecte à internet pra baixar."', async () => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => false })
    // O índice do aparelho diz que ela está lá, mas a música não abre dele.
    db.getCachedSongIds.mockResolvedValue(new Set(['s1']))
    const onDownload = await openLibrary()
    fireEvent.click(await within(row()).findByRole('button', { name: /ABRIR/ }))
    await seenNotice('Essa música não está no aparelho. Conecte à internet pra baixar.')
    expect(onDownload).not.toHaveBeenCalled()
    expect(db.fetchStems).not.toHaveBeenCalled()
  })

  it('a música sem nenhuma faixa na nuvem: "Nenhuma multitrack encontrada."', async () => {
    db.fetchStems.mockResolvedValue([])
    const onDownload = await openLibrary()
    fireEvent.click(within(row()).getByRole('button', { name: /IMPORTAR/ }))
    await seenNotice('Nenhuma multitrack encontrada.')
    expect(onDownload).not.toHaveBeenCalled()
    expect(within(row()).getByRole('button', { name: /IMPORTAR/ })).toBeTruthy()
  })

  it('a rede falha no meio: "Não deu pra baixar a música. Confira a internet e tente de novo."', async () => {
    db.fetchStems.mockResolvedValue([STEM])
    db.downloadFileAsBlobWithProgress.mockRejectedValue(new TypeError('Failed to fetch'))
    const onDownload = await openLibrary()
    fireEvent.click(within(row()).getByRole('button', { name: /IMPORTAR/ }))
    await seenNotice('Não deu pra baixar a música. Confira a internet e tente de novo.')
    expect(onDownload).not.toHaveBeenCalled()
    expect(screen.queryByText('ADICIONADA')).toBeNull()
  })

  it('a música abre mas não cabe no aparelho: ADICIONADA e "Grande demais pra guardar no aparelho."', async () => {
    db.fetchStems.mockResolvedValue([STEM])
    db.downloadFileAsBlobWithProgress.mockImplementation(async (_url: string, name: string) => new File(['a'], name))
    db.cacheSong.mockResolvedValue(false)
    const onDownload = await openLibrary()
    fireEvent.click(within(row()).getByRole('button', { name: /IMPORTAR/ }))
    await seenNotice('Grande demais pra guardar no aparelho.')
    expect(onDownload).toHaveBeenCalledTimes(1)
    expect(onDownload.mock.calls[0][0]).toHaveLength(1)
    expect(within(row()).getByText('ADICIONADA')).toBeTruthy()
  })

  // Junção da v1.4.26 (observação da re-revisão inicio-residuais-2): a frase diz que a música não está
  // no aparelho, então a linha deixa de oferecer ABRIR (que só repetiria a frase) e fica no OFFLINE
  // desligado, com a dica de sempre pra quem está sem internet.
  it('depois da frase do ABRIR sem internet, a linha não oferece ABRIR de novo: OFFLINE desligado com a dica', async () => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => false })
    db.getCachedSongIds.mockResolvedValue(new Set(['s1']))
    await openLibrary()
    fireEvent.click(await within(row()).findByRole('button', { name: /ABRIR/ }))
    await seenNotice('Essa música não está no aparelho. Conecte à internet pra baixar.')
    await waitFor(() => expect(within(row()).queryByRole('button', { name: /ABRIR/ })).toBeNull())
    const offline = within(row()).getByRole('button', { name: 'OFFLINE' }) as HTMLButtonElement
    expect(offline.disabled).toBe(true)
    expect(offline.closest('[title]')?.getAttribute('title')).toBe('Conecte-se à internet para baixar esta música')
    expect(db.isSongCached).toHaveBeenCalledTimes(1)
  })

  it('cancelar não mostra frase nenhuma (foi a pessoa que pediu)', async () => {
    db.fetchStems.mockResolvedValue([STEM])
    db.downloadFileAsBlobWithProgress.mockImplementation((_url: string, _name: string, _p: unknown, signal: AbortSignal) => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(new DOMException('cancelado', 'AbortError')))
    }))
    const onDownload = await openLibrary()
    fireEvent.click(within(row()).getByRole('button', { name: /IMPORTAR/ }))
    fireEvent.click(await within(row()).findByRole('button', { name: 'Cancelar' }))
    await waitFor(() => expect(within(row()).getByRole('button', { name: /IMPORTAR/ })).toBeTruthy())
    expect(within(library()).queryByRole('alert')).toBeNull()
    expect(onDownload).not.toHaveBeenCalled()
  })
})

// @vitest-environment jsdom
// Biblioteca no Livre (Parte 3, T17): antes de baixar, a biblioteca pergunta ao App se a música
// cabe nas do mês (onBeforeDownload). Falso não baixa nada; verdadeiro (ou sem a pergunta, como
// quem paga) baixa e entrega a música pro palco como sempre.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { CloudSong } from '../lib/supabase'

const SONG = {
  id: 'n1', name: 'Fé', artist: 'Ministério', bpm: 72, bpm_exact: null, key: 'G', cover_url: null, is_global: true, user_id: 'outro',
} as unknown as CloudSong

const FILE = new File(['x'], 'Fé - Bateria.wav', { type: 'audio/wav' })
const RESULT = {
  files: [FILE], coverUrl: null, markers: null, originalKey: 'G', artist: 'Ministério', bpm: 72, timeSignature: null,
  lyrics: null, lyricsSynced: null, chords: null,
}

const lib = vi.hoisted(() => ({ downloadSong: vi.fn(), refreshSongs: vi.fn() }))
vi.mock('../hooks/useCloudLibrary', () => ({
  useCloudLibrary: () => ({
    songs: [SONG], searchQuery: '', setSearchQuery: () => {}, isLoadingList: false, downloadingSongId: null, downloadProgress: 0,
    deletingSongId: null, downloadSong: lib.downloadSong, refreshSongs: lib.refreshSongs, removeSong: vi.fn(), cancelDownload: vi.fn(),
    cachedSongIds: new Set<string>(), isOnline: true,
  }),
}))
vi.mock('../hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 'livre' }, isAdmin: false }) }))
vi.mock('../lib/supabase', () => ({ updateSong: vi.fn() }))
vi.mock('../lib/offlineCache', () => ({ updateCachedSongMeta: vi.fn() }))
vi.mock('../lib/r2', () => ({ uploadToR2: vi.fn() }))

const { LibraryModal } = await import('./LibraryModal')

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

const importButton = () => screen.getByTitle('Baixar e importar da Nuvem')

describe('biblioteca: pergunta ao Livre antes de baixar', () => {
  it('onBeforeDownload falso não baixa nada', async () => {
    lib.downloadSong.mockResolvedValue(RESULT)
    const onBeforeDownload = vi.fn(() => false)
    const onDownload = vi.fn()
    render(<LibraryModal isOpen onClose={() => {}} onDownload={onDownload} onBeforeDownload={onBeforeDownload} />)
    fireEvent.click(importButton())
    await waitFor(() => expect(onBeforeDownload).toHaveBeenCalledWith('n1'))
    // Dá a vez a qualquer promessa pendente antes de afirmar que nada aconteceu.
    await new Promise((r) => setTimeout(r, 0))
    expect(lib.downloadSong).not.toHaveBeenCalled()
    expect(onDownload).not.toHaveBeenCalled()
    // O botão continua lá (nada foi marcado como adicionado).
    expect(importButton()).toBeTruthy()
  })

  it('onBeforeDownload verdadeiro baixa e chama onDownload', async () => {
    lib.downloadSong.mockResolvedValue(RESULT)
    const onBeforeDownload = vi.fn(() => true)
    const onDownload = vi.fn()
    render(<LibraryModal isOpen onClose={() => {}} onDownload={onDownload} onBeforeDownload={onBeforeDownload} />)
    fireEvent.click(importButton())
    await waitFor(() => expect(onDownload).toHaveBeenCalledTimes(1))
    expect(onBeforeDownload).toHaveBeenCalledWith('n1')
    expect(lib.downloadSong).toHaveBeenCalledWith('n1')
    const args = onDownload.mock.calls[0]
    expect(args[0]).toEqual([FILE])
    expect(args[1]).toBe('Fé')
    expect(args[args.length - 1]).toBe('n1')
  })

  it('sem onBeforeDownload (quem paga) baixa como antes', async () => {
    lib.downloadSong.mockResolvedValue(RESULT)
    const onDownload = vi.fn()
    render(<LibraryModal isOpen onClose={() => {}} onDownload={onDownload} />)
    fireEvent.click(importButton())
    await waitFor(() => expect(onDownload).toHaveBeenCalledTimes(1))
    expect(lib.downloadSong).toHaveBeenCalledWith('n1')
  })
})

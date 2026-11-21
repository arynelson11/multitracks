// @vitest-environment jsdom
// Biblioteca no Livre (Parte 3, T17): antes de baixar, a biblioteca pergunta ao App se a música
// cabe nas do mês (onBeforeDownload). Falso não baixa nada; verdadeiro (ou sem a pergunta, como
// quem paga) baixa e entrega a música pro palco como sempre.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { CloudSong } from '../lib/supabase'

const SONG = {
  id: 'n1', name: 'Fé', artist: 'Ministério', bpm: 72, bpm_exact: null, key: 'G', cover_url: null, is_global: true, user_id: 'outro',
} as unknown as CloudSong

const FILE = new File(['x'], 'Fé - Bateria.wav', { type: 'audio/wav' })
const RESULT = {
  files: [FILE], coverUrl: null, markers: null, originalKey: 'G', artist: 'Ministério', bpm: 72, timeSignature: null,
  lyrics: null, lyricsSynced: null, chords: null,
}

const lib = vi.hoisted(() => ({
  downloadSong: vi.fn(), refreshSongs: vi.fn(), removeSong: vi.fn(), isOnline: true, cached: new Set<string>(), isAdmin: false,
}))
vi.mock('../hooks/useCloudLibrary', () => ({
  useCloudLibrary: () => ({
    songs: [SONG], searchQuery: '', setSearchQuery: () => {}, isLoadingList: false, downloadingSongId: null, downloadProgress: 0,
    deletingSongId: null, downloadSong: lib.downloadSong, refreshSongs: lib.refreshSongs, removeSong: lib.removeSong, cancelDownload: vi.fn(),
    cachedSongIds: lib.cached, isOnline: lib.isOnline,
  }),
}))
vi.mock('../hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 'livre' }, isAdmin: lib.isAdmin }) }))
vi.mock('../lib/supabase', () => ({ updateSong: vi.fn() }))
vi.mock('../lib/offlineCache', () => ({ updateCachedSongMeta: vi.fn() }))
vi.mock('../lib/r2', () => ({ uploadToR2: vi.fn() }))

const { LibraryModal } = await import('./LibraryModal')

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  lib.isOnline = true
  lib.cached = new Set<string>()
  lib.isAdmin = false
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

describe('biblioteca: baixar e excluir no contêiner (Parte 3, T3)', () => {
  it('ADICIONADA só depois do download que deu certo', async () => {
    lib.downloadSong.mockResolvedValue(null)
    const onDownload = vi.fn()
    render(<LibraryModal isOpen onClose={() => {}} onDownload={onDownload} />)
    fireEvent.click(importButton())
    await waitFor(() => expect(lib.downloadSong).toHaveBeenCalledWith('n1'))
    await new Promise((r) => setTimeout(r, 0))
    expect(onDownload).not.toHaveBeenCalled()
    expect(screen.queryByText('ADICIONADA')).toBeNull()
    expect(importButton()).toBeTruthy()
    lib.downloadSong.mockResolvedValue(RESULT)
    fireEvent.click(importButton())
    await waitFor(() => expect(screen.getByText('ADICIONADA')).toBeTruthy())
    expect(onDownload).toHaveBeenCalledTimes(1)
  })

  it('sem espaço no aparelho, a frase aparece na janela (inicio-1 M2) e nada baixa', async () => {
    lib.downloadSong.mockResolvedValue({ refused: 'Espaço em disco insuficiente. Por favor, libere pelo menos 150MB no dispositivo.' })
    const onDownload = vi.fn()
    render(<LibraryModal isOpen onClose={() => {}} onDownload={onDownload} />)
    fireEvent.click(importButton())
    const notice = await screen.findByRole('alert')
    expect(notice.textContent).toBe('Espaço em disco insuficiente. Por favor, libere pelo menos 150MB no dispositivo.')
    expect(within(screen.getByRole('dialog', { name: 'Biblioteca na Nuvem' })).getByRole('alert')).toBe(notice)
    expect(onDownload).not.toHaveBeenCalled()
    expect(screen.queryByText('ADICIONADA')).toBeNull()
    // A tentativa seguinte limpa a frase.
    lib.downloadSong.mockResolvedValue(RESULT)
    fireEvent.click(importButton())
    await waitFor(() => expect(screen.getByText('ADICIONADA')).toBeTruthy())
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('a confirmação de excluir: Cancelar não exclui; Excluir chama removeSong uma vez; Esc fecha só a confirmação', async () => {
    lib.isAdmin = true
    lib.removeSong.mockResolvedValue(undefined)
    render(<LibraryModal isOpen onClose={() => {}} onDownload={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: 'Excluir da Nuvem' }))
    expect(screen.getByRole('dialog', { name: 'Excluir da nuvem?' }).textContent).toContain('Isso removerá permanentemente para todos os usuários.')
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Excluir da nuvem?' })).getByRole('button', { name: 'Cancelar' }))
    expect(screen.queryByRole('dialog', { name: 'Excluir da nuvem?' })).toBeNull()
    expect(lib.removeSong).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Excluir da Nuvem' }))
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByRole('dialog', { name: 'Excluir da nuvem?' })).toBeNull()
    expect(screen.getByRole('dialog', { name: 'Biblioteca na Nuvem' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Excluir da Nuvem' }))
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Excluir da nuvem?' })).getByRole('button', { name: /Excluir/ }))
    await waitFor(() => expect(lib.removeSong).toHaveBeenCalledTimes(1))
    expect(lib.removeSong).toHaveBeenCalledWith('n1')
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Excluir da nuvem?' })).toBeNull())
  })

  it('excluir sem internet pergunta "Remover do cache offline" e só aparece com a música no cache', () => {
    lib.isOnline = false
    const first = render(<LibraryModal isOpen onClose={() => {}} onDownload={() => {}} />)
    // Fora do cache e sem internet: nem excluir, nem editar, e o baixar fica OFFLINE desligado.
    expect(screen.queryByRole('button', { name: 'Remover do Cache Local' })).toBeNull()
    expect((screen.getByRole('button', { name: 'OFFLINE' }) as HTMLButtonElement).disabled).toBe(true)
    first.unmount()
    lib.cached = new Set(['n1'])
    render(<LibraryModal isOpen onClose={() => {}} onDownload={() => {}} />)
    expect(screen.queryByRole('button', { name: 'Editar metadados' })).toBeNull()
    expect(screen.getByTitle('Carregar do cache local offline')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Remover do Cache Local' }))
    expect(screen.getByRole('dialog', { name: 'Remover do aparelho?' }).textContent).toContain('Remover "Fé" do Cache Offline local?')
  })
})

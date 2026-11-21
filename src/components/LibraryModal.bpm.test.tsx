// @vitest-environment jsdom
// Edição do BPM na biblioteca (T23, Minor 17 da revisão): o campo aceita "72,5" e grava as duas
// colunas (o inteiro dos apps antigos e o exato); texto inválido avisa e não grava nada.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { CloudSong } from '../lib/supabase'
import { INVALID_BPM_MESSAGE } from '../lib/cloudBpm'

const SONG = {
  id: 'n1', name: 'Fé', artist: 'Ministério', bpm: 72, bpm_exact: null, key: 'G', cover_url: null, is_global: true, user_id: 'outro',
} as unknown as CloudSong

const lib = vi.hoisted(() => ({ refreshSongs: vi.fn(), updateSong: vi.fn(), updateCachedSongMeta: vi.fn() }))
vi.mock('../hooks/useCloudLibrary', () => ({
  useCloudLibrary: () => ({
    songs: [SONG], searchQuery: '', setSearchQuery: () => {}, isLoadingList: false, downloadingSongId: null, downloadProgress: 0,
    deletingSongId: null, downloadSong: vi.fn(), refreshSongs: lib.refreshSongs, removeSong: vi.fn(), cancelDownload: vi.fn(),
    cachedSongIds: new Set<string>(), isOnline: true,
  }),
}))
vi.mock('../hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 'admin' }, isAdmin: true }) }))
vi.mock('../lib/supabase', () => ({ updateSong: lib.updateSong }))
vi.mock('../lib/offlineCache', () => ({ updateCachedSongMeta: lib.updateCachedSongMeta }))
vi.mock('../lib/r2', () => ({ uploadToR2: vi.fn() }))

const { LibraryModal } = await import('./LibraryModal')

beforeEach(() => {
  lib.updateSong.mockResolvedValue(true)
  lib.updateCachedSongMeta.mockResolvedValue(undefined)
  lib.refreshSongs.mockResolvedValue(undefined)
})
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  vi.restoreAllMocks()
})

function openEditor() {
  const onSongEdited = vi.fn()
  render(<LibraryModal isOpen onClose={() => {}} onDownload={() => {}} onSongEdited={onSongEdited} />)
  fireEvent.click(screen.getByTitle('Editar metadados'))
  const bpm = screen.getByLabelText('BPM') as HTMLInputElement
  return { onSongEdited, bpm }
}

describe('biblioteca: editar o BPM', () => {
  it('"72,5" grava o inteiro e o exato e avisa o repertório com o BPM exato', async () => {
    const { onSongEdited, bpm } = openEditor()
    expect(bpm.value).toBe('72')
    fireEvent.change(bpm, { target: { value: '72,5' } })
    fireEvent.click(screen.getByRole('button', { name: /Salvar/i }))
    await waitFor(() => expect(lib.updateSong).toHaveBeenCalledTimes(1))
    expect(lib.updateSong).toHaveBeenCalledWith('n1', expect.objectContaining({ bpm: 73, bpm_exact: 72.5, name: 'Fé', key: 'G' }))
    await waitFor(() => expect(onSongEdited).toHaveBeenCalledTimes(1))
    expect(onSongEdited).toHaveBeenCalledWith(expect.objectContaining({ songId: 'n1', prevBpm: 72, bpm: 72.5, prevName: 'Ministério - Fé' }))
    expect(lib.updateCachedSongMeta).toHaveBeenCalledWith('n1', expect.objectContaining({ bpm: 73, bpm_exact: 72.5 }))
  })

  it('BPM inválido mostra INVALID_BPM_MESSAGE em alerta e não grava nem apaga o BPM', () => {
    const alert = vi.spyOn(window, 'alert').mockImplementation(() => {})
    const { onSongEdited, bpm } = openEditor()
    fireEvent.change(bpm, { target: { value: 'setenta' } })
    fireEvent.click(screen.getByRole('button', { name: /Salvar/i }))
    // A frase fica na janela (Parte 3), sem o aviso do navegador.
    expect(screen.getByRole('alert').textContent).toBe(INVALID_BPM_MESSAGE)
    expect(alert).not.toHaveBeenCalled()
    expect(lib.updateSong).not.toHaveBeenCalled()
    expect(onSongEdited).not.toHaveBeenCalled()
    // O formulário continua aberto com o que foi digitado.
    expect(bpm.value).toBe('setenta')
  })

  it('erro ao salvar vira frase na janela, sem alert', async () => {
    const alert = vi.spyOn(window, 'alert').mockImplementation(() => {})
    lib.updateSong.mockResolvedValue(false)
    const { onSongEdited } = openEditor()
    fireEvent.click(screen.getByRole('button', { name: /Salvar/i }))
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('Erro ao salvar alterações na música.'))
    expect(alert).not.toHaveBeenCalled()
    expect(onSongEdited).not.toHaveBeenCalled()
  })

  it('fechar a edição sem salvar não grava nada', () => {
    openEditor()
    fireEvent.click(screen.getByRole('button', { name: 'Fechar a edição' }))
    expect(screen.queryByRole('group', { name: 'Editar Música' })).toBeNull()
    expect(lib.updateSong).not.toHaveBeenCalled()
  })
})

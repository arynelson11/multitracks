// @vitest-environment jsdom
// Biblioteca no Livre (Parte 3, T17): antes de baixar, a biblioteca pergunta ao App se a música
// cabe nas do mês (onBeforeDownload). Falso não baixa nada; verdadeiro (ou sem a pergunta, como
// quem paga) baixa e entrega a música pro palco como sempre.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { CloudSong } from '../lib/supabase'
import { INVALID_BPM_MESSAGE } from '../lib/cloudBpm'

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
  songs: null as CloudSong[] | null,
}))
vi.mock('../hooks/useCloudLibrary', () => ({
  useCloudLibrary: () => ({
    songs: lib.songs ?? [SONG], searchQuery: '', setSearchQuery: () => {}, isLoadingList: false, downloadingSongId: null, downloadProgress: 0,
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
  lib.songs = null
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
    expect(lib.removeSong).toHaveBeenCalledWith('n1', 'cloud')
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Excluir da nuvem?' })).toBeNull())
  })

  it('sem internet, a lixeira só tira deste aparelho e só aparece com a música nele', () => {
    lib.isOnline = false
    lib.isAdmin = true
    const first = render(<LibraryModal isOpen onClose={() => {}} onDownload={() => {}} />)
    // Fora do aparelho e sem internet: nem excluir, nem editar (nem o admin), e o baixar fica OFFLINE desligado.
    expect(screen.queryByRole('button', { name: 'Tirar deste aparelho' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Excluir da Nuvem' })).toBeNull()
    expect((screen.getByRole('button', { name: 'OFFLINE' }) as HTMLButtonElement).disabled).toBe(true)
    first.unmount()
    lib.cached = new Set(['n1'])
    render(<LibraryModal isOpen onClose={() => {}} onDownload={() => {}} />)
    expect(screen.queryByRole('button', { name: 'Editar metadados' })).toBeNull()
    expect(screen.getByTitle('Abrir a música guardada neste aparelho')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Tirar deste aparelho' }))
    const dialog = screen.getByRole('dialog', { name: 'Tirar deste aparelho?' })
    expect(dialog.textContent).toContain('Tirar "Fé" deste aparelho? Ela continua na Biblioteca na Nuvem e dá pra baixar de novo.')
    expect(dialog.textContent).not.toContain('todos')
  })

  it('a confirmação de excluir não reabre sozinha quando a música sai da lista e volta (inicio-1 M3)', () => {
    lib.isAdmin = true
    const modal = () => <LibraryModal isOpen onClose={() => {}} onDownload={() => {}} />
    const view = render(modal())
    fireEvent.click(screen.getByRole('button', { name: 'Excluir da Nuvem' }))
    expect(screen.getByRole('dialog', { name: 'Excluir da nuvem?' })).toBeTruthy()
    // A internet cai e a lista vira a do aparelho, sem a música: a confirmação fecha.
    lib.songs = []
    view.rerender(modal())
    expect(screen.queryByRole('dialog', { name: 'Excluir da nuvem?' })).toBeNull()
    // A internet volta e a lista também: nada reabre por cima, a qualquer hora.
    lib.songs = [SONG]
    view.rerender(modal())
    expect(screen.queryByRole('dialog', { name: /Excluir da nuvem|Tirar deste aparelho/ })).toBeNull()
    expect(lib.removeSong).not.toHaveBeenCalled()
  })

  it('com uma edição aberta, a frase de espaço vai pro alto da Biblioteca e não apaga o erro da edição (Ruling INICIO-residuais)', async () => {
    const LOW_SPACE = 'Espaço em disco insuficiente. Por favor, libere pelo menos 150MB no dispositivo.'
    lib.isAdmin = true
    lib.songs = [SONG, { ...SONG, id: 'n2', name: 'Santo' } as CloudSong]
    lib.downloadSong.mockResolvedValue({ refused: LOW_SPACE })
    const onDownload = vi.fn()
    render(<LibraryModal isOpen onClose={() => {}} onDownload={onDownload} />)
    const rowOf = (id: string) => document.querySelector(`[data-library-row="${id}"]`) as HTMLElement
    fireEvent.click(within(rowOf('n1')).getByRole('button', { name: 'Editar metadados' }))
    const form = screen.getByRole('group', { name: 'Editar Música' })
    fireEvent.change(within(form).getByLabelText('BPM'), { target: { value: 'setenta' } })
    fireEvent.click(within(form).getByRole('button', { name: /Salvar/i }))
    expect(within(form).getByRole('alert').textContent).toBe(INVALID_BPM_MESSAGE)
    // IMPORTAR em outra música, sem espaço no aparelho.
    fireEvent.click(within(rowOf('n2')).getByTitle('Baixar e importar da Nuvem'))
    await waitFor(() => expect(screen.getAllByRole('alert').map((a) => a.textContent)).toContain(LOW_SPACE))
    const space = screen.getAllByRole('alert').find((a) => a.textContent === LOW_SPACE)!
    // A frase não entra no formulário de outra música, e o erro da edição continua lá.
    expect(form.contains(space)).toBe(false)
    expect(within(form).getByRole('alert').textContent).toBe(INVALID_BPM_MESSAGE)
    // No alto da Biblioteca, antes da lista.
    expect(within(screen.getByRole('dialog', { name: 'Biblioteca na Nuvem' })).getAllByRole('alert')).toContain(space)
    const list = screen.getByRole('tabpanel')
    expect(list.contains(space)).toBe(false)
    expect(space.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(onDownload).not.toHaveBeenCalled()
    // Fechar a edição leva o erro dela, não a frase de espaço.
    fireEvent.click(within(form).getByRole('button', { name: 'Fechar a edição' }))
    expect(screen.getAllByRole('alert').map((a) => a.textContent)).toEqual([LOW_SPACE])
  })

  it('a confirmação guarda o que abriu: aberta como tirar do aparelho, a internet volta e ela só tira do aparelho (Ruling INICIO-residuais)', async () => {
    lib.isOnline = false
    lib.isAdmin = true
    lib.cached = new Set(['n1'])
    lib.removeSong.mockResolvedValue(true)
    const modal = () => <LibraryModal isOpen onClose={() => {}} onDownload={() => {}} />
    const view = render(modal())
    fireEvent.click(screen.getByRole('button', { name: 'Tirar deste aparelho' }))
    expect(screen.getByRole('dialog', { name: 'Tirar deste aparelho?' })).toBeTruthy()
    // A internet volta com a janela aberta: o admin passaria a excluir da nuvem, mas esta janela não muda.
    lib.isOnline = true
    view.rerender(modal())
    expect(screen.queryByRole('dialog', { name: 'Excluir da nuvem?' })).toBeNull()
    const dialog = screen.getByRole('dialog', { name: 'Tirar deste aparelho?' })
    expect(dialog.textContent).not.toContain('todos')
    expect(within(dialog).queryByRole('button', { name: 'Excluir' })).toBeNull()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Tirar' }))
    await waitFor(() => expect(lib.removeSong).toHaveBeenCalledTimes(1))
    expect(lib.removeSong).toHaveBeenCalledWith('n1', 'device')
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Tirar deste aparelho?' })).toBeNull())
  })

  it('aberta como excluir da nuvem, a internet cai com a música no aparelho: ela fecha e não vira tirar do aparelho (Ruling INICIO-residuais)', () => {
    lib.isAdmin = true
    lib.cached = new Set(['n1'])
    const modal = () => <LibraryModal isOpen onClose={() => {}} onDownload={() => {}} />
    const view = render(modal())
    fireEvent.click(screen.getByRole('button', { name: 'Excluir da Nuvem' }))
    expect(screen.getByRole('dialog', { name: 'Excluir da nuvem?' })).toBeTruthy()
    lib.isOnline = false
    view.rerender(modal())
    expect(screen.queryByRole('dialog', { name: /Excluir da nuvem|Tirar deste aparelho/ })).toBeNull()
    // A internet volta: nada reabre por cima.
    lib.isOnline = true
    view.rerender(modal())
    expect(screen.queryByRole('dialog', { name: /Excluir da nuvem|Tirar deste aparelho/ })).toBeNull()
    expect(lib.removeSong).not.toHaveBeenCalled()
  })

  it('a edição de uma aba não trava a outra: Esc fecha a Biblioteca, a frase fica no alto e a edição volta com a aba (inicio-1 M4)', () => {
    lib.isAdmin = true
    const onClose = vi.fn()
    render(<LibraryModal isOpen onClose={onClose} onDownload={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: 'Editar metadados' }))
    const form = screen.getByRole('group', { name: 'Editar Música' })
    fireEvent.change(within(form).getByLabelText('BPM'), { target: { value: 'setenta' } })
    fireEvent.click(within(form).getByRole('button', { name: /Salvar/i }))
    expect(within(form).getByRole('alert').textContent).toBe(INVALID_BPM_MESSAGE)
    // Na outra aba a edição não está à vista: a Biblioteca volta a fechar no Esc, e a frase fica no alto.
    fireEvent.click(screen.getByRole('tab', { name: 'Minhas Músicas' }))
    expect(screen.queryByRole('group', { name: 'Editar Música' })).toBeNull()
    expect(screen.getByRole('alert').textContent).toBe(INVALID_BPM_MESSAGE)
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
    // De volta à aba, a edição continua com o que foi digitado.
    fireEvent.click(screen.getByRole('tab', { name: 'Plataforma' }))
    const again = screen.getByRole('group', { name: 'Editar Música' })
    expect((within(again).getByLabelText('BPM') as HTMLInputElement).value).toBe('setenta')
  })
})

describe('lixeira da Biblioteca: excluir da nuvem só pro admin (inicio-1 M5, Ruling lixeira-biblioteca)', () => {
  it('quem não é admin e tem a música no aparelho só tira deste aparelho, com texto próprio e sem o aviso de todos', async () => {
    lib.cached = new Set(['n1'])
    lib.removeSong.mockResolvedValue(true)
    render(<LibraryModal isOpen onClose={() => {}} onDownload={() => {}} />)
    expect(screen.queryByRole('button', { name: 'Excluir da Nuvem' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Tirar deste aparelho' }))
    const dialog = screen.getByRole('dialog', { name: 'Tirar deste aparelho?' })
    expect(dialog.textContent).toContain('Tirar "Fé" deste aparelho? Ela continua na Biblioteca na Nuvem e dá pra baixar de novo.')
    expect(dialog.textContent).not.toContain('todos')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Tirar' }))
    await waitFor(() => expect(lib.removeSong).toHaveBeenCalledWith('n1', 'device'))
  })

  it('o dono que não é admin, com a música fora do aparelho, não vê a lixeira; editar continua como antes', () => {
    lib.songs = [{ ...SONG, user_id: 'livre' } as CloudSong]
    render(<LibraryModal isOpen onClose={() => {}} onDownload={() => {}} />)
    expect(screen.queryByRole('button', { name: 'Excluir da Nuvem' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Tirar deste aparelho' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Editar metadados' })).toBeTruthy()
  })

  it('o admin com internet exclui da nuvem com o aviso de todos, mesmo com a música no aparelho', async () => {
    lib.isAdmin = true
    lib.cached = new Set(['n1'])
    lib.removeSong.mockResolvedValue(true)
    render(<LibraryModal isOpen onClose={() => {}} onDownload={() => {}} />)
    expect(screen.queryByRole('button', { name: 'Tirar deste aparelho' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Excluir da Nuvem' }))
    const dialog = screen.getByRole('dialog', { name: 'Excluir da nuvem?' })
    expect(dialog.textContent).toContain('Isso removerá permanentemente para todos os usuários.')
    fireEvent.click(within(dialog).getByRole('button', { name: /Excluir/ }))
    await waitFor(() => expect(lib.removeSong).toHaveBeenCalledWith('n1', 'cloud'))
  })
})

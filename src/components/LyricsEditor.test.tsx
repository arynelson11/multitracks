// @vitest-environment jsdom
// Letra e cifra na linguagem do palco (Parte 3, faixa C): a janela do palco (tamanho lg) e tudo
// o que o editor fazia (buscar a letra, abas Letra e Cifra, salvar e dizer onde salvou).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { LyricsEditor } from './LyricsEditor'
import { searchLyrics } from '../lib/supabase'
import type { Song } from '../types'
import { oldLanguageClasses } from '../test/psLanguage'

vi.mock('../lib/supabase', () => ({ searchLyrics: vi.fn() }))

const search = vi.mocked(searchLyrics)
const TRAVESSAO = String.fromCharCode(0x2014)

type SaveFn = (songId: string, data: unknown) => Promise<boolean | 'missing'>

const SONG = { id: 's1', name: 'Grande é o Senhor', artist: 'Adhemar de Campos', duration: 240, lyrics: '', chords: 'E  B\nGrande é o Senhor' } as unknown as Song

function abrir(onSave = vi.fn<SaveFn>(async () => true)) {
  const onClose = vi.fn()
  const view = render(<LyricsEditor song={SONG} onSave={onSave} onClose={onClose} />)
  return { onSave, onClose, view }
}

const area = (nome: string) => screen.getByRole('textbox', { name: nome }) as HTMLTextAreaElement
const texto = () => document.body.textContent ?? ''

beforeEach(() => search.mockReset())
afterEach(cleanup)

describe('Letra e cifra: nada some', () => {
  it('é a janela do palco com o nome da música e fecha no X', () => {
    const { onClose } = abrir()
    expect(screen.getByRole('dialog', { name: 'Letra e cifra' })).toBeTruthy()
    expect(texto()).toContain('Grande é o Senhor')
    fireEvent.click(screen.getByRole('button', { name: 'Fechar' }))
    expect(onClose).toHaveBeenCalled()
  })

  it('busca: manda artista, nome e duração; preenche a letra e avisa a sincronizada', async () => {
    search.mockResolvedValue({ plain: 'Grande é o Senhor\ne mui digno de louvor', synced: '[00:01.00]Grande', source: 'LRCLIB' })
    abrir()
    const artista = screen.getByRole('textbox', { name: 'Artista (para a busca)' }) as HTMLInputElement
    expect(artista.value).toBe('Adhemar de Campos')
    fireEvent.change(artista, { target: { value: 'Adhemar' } })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Buscar letra' })) })
    expect(search).toHaveBeenCalledWith('Adhemar', 'Grande é o Senhor', 240)
    expect(area('Letra').value).toBe('Grande é o Senhor\ne mui digno de louvor')
    expect(texto()).toContain('Letra encontrada via LRCLIB (sincronizada).')
    expect(texto()).toContain('Versão sincronizada disponível')
  })

  it('busca sem resultado e com falha dizem o que fazer', async () => {
    search.mockResolvedValueOnce(null)
    abrir()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Buscar letra' })) })
    expect(texto()).toContain('Nenhuma letra encontrada.')
    search.mockRejectedValueOnce(new Error('rede'))
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Buscar letra' })) })
    expect(texto()).toContain('Falha na busca.')
  })

  it('abas Letra e Cifra trocam a área e guardam o texto de cada uma', () => {
    abrir()
    const letra = screen.getByRole('tab', { name: 'Letra' })
    expect(letra.getAttribute('aria-selected')).toBe('true')
    fireEvent.change(area('Letra'), { target: { value: 'minha letra' } })
    fireEvent.click(screen.getByRole('tab', { name: 'Cifra' }))
    expect(screen.queryByRole('textbox', { name: 'Letra' })).toBeNull()
    expect(area('Cifra').value).toBe('E  B\nGrande é o Senhor')
    expect(area('Cifra').getAttribute('wrap')).toBe('off')
    fireEvent.change(area('Cifra'), { target: { value: 'A  D' } })
    fireEvent.click(letra)
    expect(area('Letra').value).toBe('minha letra')
    fireEvent.click(screen.getByRole('tab', { name: 'Cifra' }))
    expect(area('Cifra').value).toBe('A  D')
  })

  it('Salvar manda o que está nas áreas (vazio vira nulo) e diz onde salvou', async () => {
    const onSave = vi.fn<SaveFn>(async () => true)
    abrir(onSave)
    fireEvent.change(area('Letra'), { target: { value: '   ' } })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Salvar' })) })
    expect(onSave).toHaveBeenCalledWith('s1', { lyrics: null, lyricsSynced: null, chords: 'E  B\nGrande é o Senhor' })
    expect(texto()).toContain('Salvo na nuvem e no aparelho.')
    onSave.mockResolvedValueOnce(false)
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Salvar' })) })
    expect(texto()).toContain('Salvo só no aparelho')
    onSave.mockRejectedValueOnce(new Error('x'))
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Salvar' })) })
    expect(texto()).toContain('Erro ao salvar.')
  })
})

// Revisão macro BC (BC2-I1, BC2-M8): o Esc e o toque fora não jogam fora o que foi digitado e não salvo.
describe('Letra e cifra: Esc e toque fora com texto não salvo', () => {
  const esc = () => fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape', code: 'Escape' })
  const toqueFora = () => {
    const camada = screen.getByRole('dialog').parentElement as HTMLElement
    fireEvent.pointerDown(camada)
    fireEvent.click(camada)
  }

  it('sem mudança, Esc fecha e o toque fora também', () => {
    const { onClose } = abrir()
    esc()
    expect(onClose).toHaveBeenCalledTimes(1)
    toqueFora()
    expect(onClose).toHaveBeenCalledTimes(2)
  })

  it('com a letra digitada, Esc e toque fora não fecham; o X fecha', () => {
    const { onClose } = abrir()
    fireEvent.change(area('Letra'), { target: { value: 'Grande é o Senhor' } })
    area('Letra').focus()
    esc()
    toqueFora()
    expect(onClose).not.toHaveBeenCalled()
    expect(area('Letra').value).toBe('Grande é o Senhor')
    fireEvent.click(screen.getByRole('button', { name: 'Fechar' }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('com a cifra mudada, ou a letra achada na busca, Esc não fecha', async () => {
    search.mockResolvedValue({ plain: 'achou', synced: null, source: 'LRCLIB' })
    const { onClose } = abrir()
    fireEvent.click(screen.getByRole('tab', { name: 'Cifra' }))
    fireEvent.change(area('Cifra'), { target: { value: 'A  E' } })
    esc()
    expect(onClose).not.toHaveBeenCalled()
    fireEvent.change(area('Cifra'), { target: { value: 'E  B\nGrande é o Senhor' } })
    esc()
    expect(onClose).toHaveBeenCalledTimes(1)
    cleanup()
    const outro = abrir()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Buscar letra' })) })
    esc()
    expect(outro.onClose).not.toHaveBeenCalled()
  })

  it('depois de salvar, Esc fecha de novo; se o salvar falhou, não', async () => {
    const onSave = vi.fn<SaveFn>(async () => true)
    const { onClose } = abrir(onSave)
    fireEvent.change(area('Letra'), { target: { value: 'nova' } })
    onSave.mockRejectedValueOnce(new Error('x'))
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Salvar' })) })
    esc()
    expect(onClose).not.toHaveBeenCalled()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Salvar' })) })
    esc()
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})

// Manutenção (2026-11-27): a música ativa muda com o editor aberto (o operador troca, o AUTO passa
// pra próxima, a banda escolhe pelo celular). O editor guarda a música de quando abriu e grava nela.
describe('Letra e cifra: a música muda com o editor aberto', () => {
  const OUTRA = { id: 's2', name: 'Aclame ao Senhor', artist: 'Diante do Trono', duration: 300, lyrics: 'letra da outra', chords: '' } as unknown as Song

  it('Salvar grava na música de quando abriu, não na que ficou ativa', async () => {
    const { onSave, onClose, view } = abrir()
    fireEvent.change(area('Letra'), { target: { value: 'letra nova da primeira' } })
    // O App passa a música ativa de agora: a outra.
    view.rerender(<LyricsEditor song={OUTRA} onSave={onSave} onClose={onClose} />)
    expect(texto()).toContain('Grande é o Senhor')
    expect(texto()).not.toContain('Aclame ao Senhor')
    expect(area('Letra').value).toBe('letra nova da primeira')
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Salvar' })) })
    expect(onSave).toHaveBeenCalledTimes(1)
    expect(onSave.mock.calls[0][0]).toBe('s1')
    expect(onSave.mock.calls[0][1]).toEqual({ lyrics: 'letra nova da primeira', lyricsSynced: null, chords: 'E  B\nGrande é o Senhor' })
  })

  it('a busca continua sendo da música de quando abriu', async () => {
    search.mockResolvedValue(null)
    const { onSave, onClose, view } = abrir()
    view.rerender(<LyricsEditor song={OUTRA} onSave={onSave} onClose={onClose} />)
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Buscar letra' })) })
    expect(search).toHaveBeenCalledWith('Adhemar de Campos', 'Grande é o Senhor', 240)
  })

  it('a música saiu do repertório: avisa na janela, o Salvar desliga e nada é gravado', async () => {
    const { onSave, onClose, view } = abrir()
    fireEvent.change(area('Letra'), { target: { value: 'texto que não pode ir pra outra' } })
    view.rerender(<LyricsEditor song={SONG} songInPlaylist={false} onSave={onSave} onClose={onClose} />)
    expect(screen.getByRole('alert').textContent).toContain('Esta música saiu do repertório')
    const salvar = screen.getByRole('button', { name: 'Salvar' }) as HTMLButtonElement
    expect(salvar.disabled).toBe(true)
    await act(async () => { fireEvent.click(salvar) })
    expect(onSave).not.toHaveBeenCalled()
    // O texto fica na área (dá pra copiar) e o Esc não joga fora.
    expect(area('Letra').value).toBe('texto que não pode ir pra outra')
    // Voltou pro repertório: o Salvar volta.
    view.rerender(<LyricsEditor song={SONG} songInPlaylist onSave={onSave} onClose={onClose} />)
    expect(screen.queryByRole('alert')).toBeNull()
    expect((screen.getByRole('button', { name: 'Salvar' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('o App respondeu que a música saiu na hora de gravar: avisa e continua com alteração', async () => {
    const onSave = vi.fn<SaveFn>(async () => 'missing')
    const { onClose } = abrir(onSave)
    fireEvent.change(area('Letra'), { target: { value: 'nova' } })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Salvar' })) })
    expect(texto()).toContain('Esta música saiu do repertório')
    expect(texto()).not.toContain('Salvo')
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape', code: 'Escape' })
    expect(onClose).not.toHaveBeenCalled()
  })
})

// Revisão das telas (I1 na letra): o Salvar desligado (salvando, ou a música que saiu do repertório)
// não pode ficar com o foco, senão ele cai no body (Chromium) e as teclas chegam ao palco antigo.
describe('Letra e cifra: o foco no Salvar', () => {
  const dialogo = () => screen.getByRole('dialog', { name: 'Letra e cifra' })
  const salvar = () => screen.getByRole('button', { name: 'Salvar' }) as HTMLButtonElement

  it('salvando, o foco vai do Salvar pra janela e volta pro Salvar no fim', async () => {
    let soltar!: (v: boolean) => void
    const onSave = vi.fn<SaveFn>(() => new Promise((r) => { soltar = r }))
    abrir(onSave)
    fireEvent.change(area('Letra'), { target: { value: 'nova' } })
    salvar().focus()
    await act(async () => { fireEvent.click(salvar()) })
    expect(document.activeElement).toBe(dialogo())
    ;(document.activeElement as HTMLElement).blur()
    await act(async () => { soltar(true) })
    expect(document.activeElement).toBe(salvar())
  })

  it("o App respondeu 'missing': o Salvar fica desligado e o foco fica na janela", async () => {
    const onSave = vi.fn<SaveFn>(async () => 'missing')
    abrir(onSave)
    fireEvent.change(area('Letra'), { target: { value: 'nova' } })
    salvar().focus()
    await act(async () => { fireEvent.click(salvar()) })
    expect(salvar().disabled).toBe(true)
    expect(document.activeElement).toBe(dialogo())
  })

  it('buscando a letra, o foco do Buscar letra vai pra janela e volta pra ele no fim', async () => {
    let soltar!: (v: null) => void
    // Once: o beforeEach devolve o mock, e o vitest chama ele no fim do teste (como limpeza).
    search.mockImplementationOnce(() => new Promise((r) => { soltar = r }))
    abrir()
    const buscar = () => screen.getByRole('button', { name: 'Buscar letra' }) as HTMLButtonElement
    buscar().focus()
    await act(async () => { fireEvent.click(buscar()) })
    expect(document.activeElement).toBe(dialogo())
    ;(document.activeElement as HTMLElement).blur()
    await act(async () => { soltar(null) })
    expect(document.activeElement).toBe(buscar())
  })

  it('a música sai do repertório com o foco no Salvar: o foco vai pra janela', () => {
    const { onSave, onClose, view } = abrir()
    salvar().focus()
    view.rerender(<LyricsEditor song={SONG} songInPlaylist={false} onSave={onSave} onClose={onClose} />)
    expect(salvar().disabled).toBe(true)
    expect(document.activeElement).toBe(dialogo())
  })
})

describe('Letra e cifra: linguagem do palco', () => {
  it('só classes da linguagem nova, sem travessão nem emoji', async () => {
    search.mockResolvedValue({ plain: 'x', synced: '[00:01.00]x', source: 'LRCLIB' })
    abrir()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Buscar letra' })) })
    fireEvent.click(screen.getByRole('tab', { name: 'Cifra' }))
    expect(oldLanguageClasses(document.body)).toEqual([])
    fireEvent.click(screen.getByRole('tab', { name: 'Letra' }))
    expect(oldLanguageClasses(document.body)).toEqual([])
    expect(texto()).not.toContain(TRAVESSAO)
    expect(texto()).not.toMatch(/[☁✓]/)
  })
})

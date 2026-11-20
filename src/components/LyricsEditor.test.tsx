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

const SONG = { id: 's1', name: 'Grande é o Senhor', artist: 'Adhemar de Campos', duration: 240, lyrics: '', chords: 'E  B\nGrande é o Senhor' } as unknown as Song

function abrir(onSave = vi.fn(async () => true)) {
  const onClose = vi.fn()
  render(<LyricsEditor song={SONG} onSave={onSave} onClose={onClose} />)
  return { onSave, onClose }
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
    const onSave = vi.fn(async () => true)
    abrir(onSave)
    fireEvent.change(area('Letra'), { target: { value: '   ' } })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Salvar' })) })
    expect(onSave).toHaveBeenCalledWith({ lyrics: null, lyricsSynced: null, chords: 'E  B\nGrande é o Senhor' })
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
    const onSave = vi.fn(async () => true)
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

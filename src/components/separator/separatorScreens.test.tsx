// @vitest-environment jsdom
import type React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { SavedSeparation } from '../../hooks/useSeparationLibrary'
import { AUDIO_FILE_ACCEPT } from '../../lib/uploadContentType'
import { SeparatorHome } from './SeparatorHome'
import { SeparatorOptions } from './SeparatorOptions'
import { SeparatorProgress } from './SeparatorProgress'
import { separationDate } from './separatorCopy'
import { oldLanguageClasses } from '../../test/psLanguage'

const TRAVESSAO = String.fromCharCode(0x2014)

const stem = (id: string, color = '#06b6d4') => ({ id, name: id, url: `https://r2/${id}.wav`, color })
const SEP_A: SavedSeparation = {
  id: 'sep_a', songName: 'Grande é o Senhor', artist: 'Ministério Ao Vivo', bpm: '72', songKey: 'G#',
  stems: ['vocals', 'drums', 'bass', 'guitar', 'piano', 'other', 'metronome'].map((i) => stem(i)), voiceCues: [], createdAt: Date.UTC(2026, 9, 5, 15),
}
const SEP_B: SavedSeparation = { id: 'sep_b', songName: '', artist: '', bpm: '120', songKey: 'C', stems: [stem('vocals'), stem('no_vocals')], voiceCues: [], createdAt: Date.UTC(2026, 10, 18, 15) }

let onBack: ReturnType<typeof vi.fn>, onPick: ReturnType<typeof vi.fn>, onOpen: ReturnType<typeof vi.fn>, onDelete: ReturnType<typeof vi.fn>
beforeEach(() => { onBack = vi.fn(); onPick = vi.fn(); onOpen = vi.fn(); onDelete = vi.fn() })
afterEach(() => { cleanup(); vi.useRealTimers() })

const home = (over: Partial<React.ComponentProps<typeof SeparatorHome>> = {}) =>
  render(<SeparatorHome separations={[SEP_A, SEP_B]} loading={false} onBack={onBack} onPickFile={onPick} onOpen={onOpen} onDelete={onDelete} {...over} />)

describe('SeparatorHome', () => {
  it('entrada: Voltar, Carregar áudio com o filtro de áudio e a lista com contagem', () => {
    home()
    fireEvent.click(screen.getByRole('button', { name: 'Voltar' }))
    expect(onBack).toHaveBeenCalled()
    expect(screen.getByRole('button', { name: /Carregar áudio/ })).toBeTruthy()
    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    expect(input.accept).toBe(AUDIO_FILE_ACCEPT)
    expect(screen.getByText('MP3, WAV ou AAC')).toBeTruthy()
    expect(screen.getByText('Separador IA')).toBeTruthy()
    expect(screen.getByText('2 salvas')).toBeTruthy()
    cleanup()
    home({ separations: [SEP_A] })
    expect(screen.getByText('1 salva')).toBeTruthy()
  })

  it('escolher um arquivo chama onPickFile com ele', () => {
    home()
    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    const file = new File(['a'], 'louvor.mp3', { type: 'audio/mpeg' })
    fireEvent.change(input, { target: { files: [file] } })
    expect(onPick).toHaveBeenCalledWith(file)
  })

  it('cartão mostra nome, artista, tom fora do C, BPM fora do 120, faixas e data; sem nome vira Sem título', () => {
    home()
    const a = document.querySelector('[data-separation-id="sep_a"]')!
    expect(a.textContent).toContain('Grande é o Senhor')
    expect(a.textContent).toContain('Ministério Ao Vivo')
    expect(a.textContent).toContain('G#')
    expect(a.textContent).toContain('72 BPM')
    expect(a.textContent).toContain('7 faixas')
    expect(a.textContent).toContain('+1')
    expect(a.querySelectorAll('span[title]').length).toBe(6)
    expect(a.textContent).toContain(separationDate(SEP_A.createdAt))
    const b = document.querySelector('[data-separation-id="sep_b"]')!
    expect(b.textContent).toContain('Sem título')
    expect(b.textContent).not.toContain('120 BPM')
    expect(b.textContent).toContain('2 faixas')
    expect(b.querySelectorAll('[data-separation-id] span').length).toBeGreaterThan(0)
  })

  it('Abrir e o cartão abrem; a lixeira pede dois toques e não abre o cartão', () => {
    vi.useFakeTimers()
    home()
    const card = document.querySelector('[data-separation-id="sep_a"]') as HTMLElement
    fireEvent.click(card)
    expect(onOpen).toHaveBeenCalledWith(SEP_A)
    onOpen.mockClear()
    fireEvent.click(screen.getAllByRole('button', { name: 'Abrir' })[0])
    expect(onOpen).toHaveBeenCalledTimes(1)
    onOpen.mockClear()
    const trash = screen.getByRole('button', { name: 'Excluir Grande é o Senhor' })
    fireEvent.click(trash)
    expect(onDelete).not.toHaveBeenCalled()
    vi.advanceTimersByTime(400)
    fireEvent.click(screen.getByRole('button', { name: 'Toque de novo para excluir Grande é o Senhor' }))
    expect(onDelete).toHaveBeenCalledWith('sep_a')
    expect(onOpen).not.toHaveBeenCalled()
    // Sem nome, a lixeira fala do "Sem título".
    expect(screen.getByRole('button', { name: 'Excluir Sem título' })).toBeTruthy()
  })

  it('carregando e vazio mostram as frases de hoje', () => {
    home({ loading: true })
    expect(screen.getByRole('status')).toBeTruthy()
    cleanup()
    home({ separations: [] })
    expect(screen.getByText('Nenhuma separação salva ainda.')).toBeTruthy()
    expect(screen.getByText('Faça sua primeira separação e ela aparecerá aqui automaticamente.')).toBeTruthy()
    expect(screen.getByText('0 salvas')).toBeTruthy()
  })

  it('os alvos do tour continuam: sep-upload e sep-biblioteca; o tour e o aviso entram quando vêm', () => {
    home({ tour: <div data-tour-fake />, notice: <p role="alert">Erro no processamento: sem internet</p> })
    expect(document.querySelector('[data-tour="sep-upload"]')).toBeTruthy()
    expect(document.querySelector('[data-tour="sep-biblioteca"]')).toBeTruthy()
    expect(document.querySelector('[data-tour-fake]')).toBeTruthy()
    expect(screen.getByRole('alert').textContent).toBe('Erro no processamento: sem internet')
  })
})

describe('SeparatorOptions', () => {
  it('opções: só as do plano, cada uma com o texto de hoje, e tocar chama onChoose', () => {
    const onChoose = vi.fn()
    render(<SeparatorOptions options={[4, 6]} onBack={onBack} onChoose={onChoose} />)
    expect(screen.queryByText('Vocais, Instrumental')).toBeNull()
    expect(screen.queryByText('Separação Básica')).toBeNull()
    expect(screen.getByText('Separação Avançada')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /Vocais, Bateria, Baixo, Outros/ }))
    expect(onChoose).toHaveBeenCalledWith(4)
    fireEvent.click(screen.getByRole('button', { name: /Guitarra, Piano/ }))
    expect(onChoose).toHaveBeenCalledWith(6)
    expect(screen.getByText('6 faixas')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Voltar' }))
    expect(onBack).toHaveBeenCalled()
  })

  it('quem paga vê a básica também', () => {
    render(<SeparatorOptions options={[2, 4, 6]} onBack={onBack} onChoose={vi.fn()} />)
    expect(screen.getByText('Separação Básica')).toBeTruthy()
    expect(screen.getByRole('button', { name: /Vocais, Instrumental/ })).toBeTruthy()
    expect(screen.getByText('Selecione o nível de isolamento de instrumentos desejado')).toBeTruthy()
  })
})

describe('SeparatorProgress', () => {
  it('progresso: título, etapa e porcentagem', () => {
    render(<SeparatorProgress title="Analisando Frequências" subtitle="Motor de IA GPU • Replicate" percent={42} detail="Extraindo instrumentos" />)
    const bar = screen.getByRole('progressbar')
    expect(bar.getAttribute('aria-valuenow')).toBe('42')
    expect(screen.getByText('42% concluído')).toBeTruthy()
    expect(screen.getByText('Extraindo instrumentos')).toBeTruthy()
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('com erro, a frase em alerta, Tentar de novo e Voltar', () => {
    const onRetry = vi.fn()
    render(<SeparatorProgress title="Abrindo no palco" subtitle="x" percent={50} detail="" error="Não deu pra baixar." onRetry={onRetry} onBack={onBack} />)
    expect(screen.getByRole('alert').textContent).toBe('Não deu pra baixar.')
    expect(screen.queryByRole('progressbar')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Tentar de novo' }))
    fireEvent.click(screen.getByRole('button', { name: 'Voltar' }))
    expect(onRetry).toHaveBeenCalled()
    expect(onBack).toHaveBeenCalled()
  })

  it('nenhum texto com travessão nem classe do visual antigo nas três vistas', () => {
    home()
    render(<SeparatorOptions options={[2, 4, 6]} onBack={onBack} onChoose={vi.fn()} />)
    render(<SeparatorProgress title="Analisando Frequências" subtitle="Motor de IA GPU • Replicate" percent={10} detail="x" onBack={onBack} />)
    expect(document.body.textContent).not.toContain(TRAVESSAO)
    expect(oldLanguageClasses(document.body)).toEqual([])
    for (const el of document.querySelectorAll('[title],[aria-label]')) {
      expect(el.getAttribute('title') ?? '').not.toContain(TRAVESSAO)
      expect(el.getAttribute('aria-label') ?? '').not.toContain(TRAVESSAO)
    }
  })
})

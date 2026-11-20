// @vitest-environment jsdom
// Metrônomo na linguagem do palco (Parte 3, faixa C): é a janela do palco (StageDialog) e nada do
// que ele fazia some. O gerador de click é mockado; o fluxo do click IA fica no .auto.test.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MetronomeModal } from './MetronomeModal'
import { generateManualClickTrackFromSample } from '../lib/AudioAnalyzer'
import type { Channel } from '../types'
import { FakeAudioBuffer } from '../test/fakeAudio'
import { oldLanguageClasses } from '../test/psLanguage'

vi.mock('../lib/AudioAnalyzer', async (importOriginal) => {
  const real = await importOriginal<typeof import('../lib/AudioAnalyzer')>()
  return { ...real, generateManualClickTrackFromSample: vi.fn(async () => ({ clickTrackUrl: 'blob:click' })) }
})

const generate = vi.mocked(generateManualClickTrackFromSample)
const TRAVESSAO = String.fromCharCode(0x2014)

function channel(id: string, name: string): Channel {
  const buffer = new FakeAudioBuffer(1, 4800, 48000) as unknown as AudioBuffer
  return { id, name, buffer } as unknown as Channel
}

function abrir() {
  const onAddClick = vi.fn()
  const onClose = vi.fn()
  const song = { id: 's1', name: 'Teste', duration: 90, bpm: 135, channels: [channel('k', 'Drums')] }
  render(<MetronomeModal isOpen onClose={onClose} playlistCurrentSong={song} onAddClick={onAddClick} />)
  return { onAddClick, onClose }
}

const botao = (nome: string) => screen.getByRole('button', { name: new RegExp(`^${nome}$`, 'i') })
const campoBpm = () => screen.getByLabelText('BPM') as HTMLInputElement

beforeEach(() => {
  localStorage.clear()
  generate.mockClear()
  vi.stubGlobal('fetch', vi.fn(async () => ({ blob: async () => new Blob(['wav'], { type: 'audio/wav' }) })))
  URL.revokeObjectURL = vi.fn()
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('Metrônomo: linguagem do palco', () => {
  it('é a janela do palco: dialog "Metrônomo", Fechar com nome e só classes da linguagem nova', () => {
    abrir()
    expect(screen.getByRole('dialog', { name: 'Metrônomo' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Fechar' })).toBeTruthy()
    expect(oldLanguageClasses(document.body)).toEqual([])
    expect(document.body.textContent).not.toContain(TRAVESSAO)
  })
})

describe('Metrônomo: nada some', () => {
  it('BPM: − e + andam 1 e o campo corrige no blur entre 40 e 300', () => {
    abrir()
    expect(campoBpm().value).toBe('120')
    fireEvent.click(botao('Aumentar o BPM'))
    expect(campoBpm().value).toBe('121')
    fireEvent.click(botao('Diminuir o BPM'))
    fireEvent.click(botao('Diminuir o BPM'))
    expect(campoBpm().value).toBe('119')
    fireEvent.change(campoBpm(), { target: { value: '999' } })
    fireEvent.blur(campoBpm())
    expect(campoBpm().value).toBe('300')
    fireEvent.change(campoBpm(), { target: { value: '10' } })
    fireEvent.blur(campoBpm())
    expect(campoBpm().value).toBe('40')
  })

  it('TAP TEMPO tira o BPM dos toques e 2× dobra (desligado quando passaria de 300)', () => {
    abrir()
    // O relógio é parado na mão: o React também lê o performance.now.
    let agora = 1000
    vi.spyOn(performance, 'now').mockImplementation(() => agora)
    fireEvent.click(botao('TAP TEMPO'))
    agora = 1600
    fireEvent.click(botao('TAP TEMPO'))
    expect(campoBpm().value).toBe('100')
    fireEvent.click(botao('2×'))
    expect(campoBpm().value).toBe('200')
    expect((botao('2×') as HTMLButtonElement).disabled).toBe(true)
  })

  it('Som do click e Subdivisão marcam a escolha e guardam', () => {
    abrir()
    expect(botao('Classic').getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(botao('Woodblock'))
    expect(botao('Woodblock').getAttribute('aria-pressed')).toBe('true')
    expect(botao('Classic').getAttribute('aria-pressed')).toBe('false')
    expect(localStorage.getItem('clickLibrarySelection')).toContain('"type":"Woodblock"')
    fireEvent.click(botao('1/8'))
    expect(botao('1/8').getAttribute('aria-pressed')).toBe('true')
    expect(localStorage.getItem('clickLibrarySelection')).toContain('"subdivision":"eighth"')
  })

  it('Acentuar o 1 é um interruptor; desligado vai pro gerador', async () => {
    const { onAddClick } = abrir()
    const acento = screen.getByRole('switch', { name: 'Acentuar o 1' })
    expect(acento.getAttribute('aria-checked')).toBe('true')
    fireEvent.click(acento)
    expect(acento.getAttribute('aria-checked')).toBe('false')
    await act(async () => { fireEvent.click(botao('GERAR CLICK MANUAL')) })
    await vi.waitFor(() => expect(onAddClick).toHaveBeenCalledTimes(1))
    expect(generate.mock.calls[0][4]).toBe(false)
  })

  it('enquanto gera o click, Fechar, Esc e toque fora não fecham; depois fecha como sempre', async () => {
    let soltar: (v: { clickTrackUrl: string }) => void = () => {}
    generate.mockImplementationOnce(() => new Promise((r) => { soltar = r }))
    const { onAddClick, onClose } = abrir()
    await act(async () => { fireEvent.click(botao('GERAR CLICK MANUAL')) })
    await vi.waitFor(() => expect(generate).toHaveBeenCalled())
    expect(screen.getByRole('status').textContent).toContain('Gerando click')
    fireEvent.click(screen.getByRole('button', { name: 'Fechar' }))
    fireEvent.keyDown(window, { key: 'Escape' })
    const camada = screen.getByRole('dialog').parentElement as HTMLElement
    fireEvent.click(camada)
    expect(onClose).not.toHaveBeenCalled()
    await act(async () => { soltar({ clickTrackUrl: 'blob:click' }) })
    await vi.waitFor(() => expect(onAddClick).toHaveBeenCalledTimes(1))
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})

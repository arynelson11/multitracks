// @vitest-environment jsdom
import type React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { oldLanguageClasses } from '../../test/psLanguage'
import { SeparatorPlayerBar } from './SeparatorPlayerBar'
import { SeparatorTrackStrip } from './SeparatorTrackStrip'
import { FakeAudioContext, resetWaves, savedSeparation, waves } from './separatorTestKit'

const TRAVESSAO = String.fromCharCode(0x2014)

const lib = vi.hoisted(() => ({
  separations: [] as unknown[], saveSeparation: vi.fn(async () => 'sep_1'), deleteSeparation: vi.fn(), getSeparation: vi.fn(), isLoading: false,
}))
vi.mock('wavesurfer.js', async () => (await import('./separatorTestKit')).wavesurferModule())
vi.mock('../../lib/syncedTrackPlayer', async () => (await import('./separatorTestKit')).syncedPlayerModule())
vi.mock('../../hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 'u1' }, userPlan: 'essencial_mensal', isAdmin: false, loading: false }) }))
vi.mock('../../hooks/useSeparationLibrary', () => ({ useSeparationLibrary: () => lib }))
vi.mock('../../hooks/useLivre', () => ({
  useLivre: () => ({ isLivre: false, stage: { used: 0, limit: Infinity }, canOpenSong: () => true, canOpenNewSong: () => true, noteSongOpened: vi.fn(), live: { remainingMs: Infinity, limitMs: null }, canStartLive: () => true, limit: null, requestLimit: vi.fn(), closeLimit: vi.fn() }),
}))
vi.mock('../../lib/r2', () => ({ uploadToR2: vi.fn(async () => ({ url: 'https://r2/x.wav' })) }))
vi.mock('../GuidedTour', () => ({ GuidedTour: () => null }))
vi.mock('../PricingModal', () => ({ PricingModal: () => null }))
vi.mock('../livre/AdSlot', () => ({ AdSlot: () => null }))

import { SeparatorStudio } from '../SeparatorStudio'

beforeEach(() => {
  resetWaves()
  lib.saveSeparation.mockClear()
  localStorage.setItem('sep_tour_seen', '1')
  ;(window as unknown as { AudioContext: unknown }).AudioContext = FakeAudioContext
  window.requestAnimationFrame = ((cb: FrameRequestCallback) => setTimeout(() => cb(0), 16) as unknown as number)
  window.cancelAnimationFrame = ((id: number) => clearTimeout(id)) as typeof window.cancelAnimationFrame
})
afterEach(() => { cleanup(); vi.useRealTimers() })

type BarProps = React.ComponentProps<typeof SeparatorPlayerBar>
const barProps = (over: Partial<BarProps> = {}): BarProps => ({
  songName: 'Grande é o Senhor', channels: 4, format: 'wav', canSave: true, saving: false, bpm: '72', songKey: 'G', keyPickerOpen: false,
  isPlaying: false, isLooping: false, time: '0:12', total: '3:20', voice: { count: 2, locked: false },
  sync: { offsetMs: 10, enabled: true, busy: false }, masterVolume: 0.8,
  onBack: vi.fn(), onFormat: vi.fn(), onSave: vi.fn(), onExport: vi.fn(), onOpenBpm: vi.fn(), onKeyPicker: vi.fn(), onKey: vi.fn(),
  onStart: vi.fn(), onTogglePlay: vi.fn(), onEnd: vi.fn(), onToggleLoop: vi.fn(), onVoice: vi.fn(), onNudge: vi.fn(), onMaster: vi.fn(),
  ...over,
})
const btn = (name: string | RegExp) => screen.getByRole('button', { name }) as HTMLButtonElement

describe('SeparatorPlayerBar', () => {
  it('barra: Voltar, formato, Salvar só com a separação gravada, Exportar, BPM e Tom', () => {
    const p = barProps()
    render(<SeparatorPlayerBar {...p} />)
    fireEvent.click(btn('Voltar')); expect(p.onBack).toHaveBeenCalled()
    expect(screen.getByText('Separador IA · 4 CH')).toBeTruthy()
    fireEvent.click(screen.getByRole('radio', { name: 'MP3' })); expect(p.onFormat).toHaveBeenCalledWith('mp3')
    fireEvent.click(btn('Salvar')); expect(p.onSave).toHaveBeenCalled()
    expect(btn('Salvar').title).toBe('Salvar tudo na sua biblioteca')
    fireEvent.click(btn('Exportar')); expect(p.onExport).toHaveBeenCalled()
    fireEvent.click(btn('BPM 72')); expect(p.onOpenBpm).toHaveBeenCalled()
    fireEvent.click(btn('Tom G')); expect(p.onKeyPicker).toHaveBeenCalledWith(true)
    cleanup()
    render(<SeparatorPlayerBar {...barProps({ canSave: false })} />)
    expect(screen.queryByRole('button', { name: 'Salvar' })).toBeNull()
    cleanup()
    render(<SeparatorPlayerBar {...barProps({ saving: true })} />)
    expect(btn('Salvando').disabled).toBe(true)
  })

  it('barra: início, play, fim e loop chamam as ações; o tempo aparece em m:ss', () => {
    const p = barProps()
    render(<SeparatorPlayerBar {...p} />)
    fireEvent.click(btn('Voltar ao início')); expect(p.onStart).toHaveBeenCalled()
    fireEvent.click(btn('Tocar')); expect(p.onTogglePlay).toHaveBeenCalled()
    fireEvent.click(btn('Ir para o fim')); expect(p.onEnd).toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: /Loop/ })); expect(p.onToggleLoop).toHaveBeenCalled()
    expect(document.body.textContent).toContain('0:12 / 3:20')
    cleanup()
    render(<SeparatorPlayerBar {...barProps({ isPlaying: true, isLooping: true })} />)
    expect(btn('Pausar').getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('button', { name: /Loop/ }).title).toBe('Loop ativado')
  })

  it('barra: Voz com a contagem e cadeado quando travado; SYNC desligado sem o Metrônomo', () => {
    const p = barProps()
    render(<SeparatorPlayerBar {...p} />)
    fireEvent.click(btn('Voz (2)')); expect(p.onVoice).toHaveBeenCalled()
    fireEvent.click(btn('Adiantar o click 10 ms')); expect(p.onNudge).toHaveBeenCalledWith(-10)
    fireEvent.click(btn('Atrasar o click 10 ms')); expect(p.onNudge).toHaveBeenCalledWith(10)
    expect(screen.getByText('+10')).toBeTruthy()
    fireEvent.change(screen.getByRole('slider', { name: 'Volume geral' }), { target: { value: '0.5' } }); expect(p.onMaster).toHaveBeenCalledWith(0.5)
    cleanup()
    render(<SeparatorPlayerBar {...barProps({ voice: { count: 0, locked: true }, sync: { offsetMs: 0, enabled: false, busy: false } })} />)
    expect(btn('Voz').title).toBe('Voz guia disponível nos planos pagos')
    expect(btn('Adiantar o click 10 ms').disabled).toBe(true)
    cleanup()
    render(<SeparatorPlayerBar {...barProps({ voice: null })} />)
    expect(screen.queryByRole('button', { name: /^Voz/ })).toBeNull()
  })

  it('grade do tom: abre, escolhe e fecha; tocar fora fecha', () => {
    const p = barProps({ keyPickerOpen: true })
    render(<SeparatorPlayerBar {...p} />)
    const grid = screen.getByRole('dialog', { name: 'Selecionar tom' })
    expect(grid.querySelectorAll('button')).toHaveLength(12)
    fireEvent.click(btn('A#')); expect(p.onKey).toHaveBeenCalledWith('A#'); expect(p.onKeyPicker).toHaveBeenCalledWith(false)
    p.onKeyPicker.mockClear()
    fireEvent.click(document.querySelector('[data-key-backdrop]')!); expect(p.onKeyPicker).toHaveBeenCalledWith(false)
  })
})

type StripProps = React.ComponentProps<typeof SeparatorTrackStrip>
const stripProps = (over: Partial<StripProps> = {}): StripProps => ({
  index: 0, name: 'Vocais', color: '#06b6d4', state: { muted: false, soloed: false, volume: 1, pan: 0.3 }, height: 120, compact: false,
  downloading: false, downloadTitle: 'Baixar Vocais (WAV)', downloadLocked: false,
  onMute: vi.fn(), onSolo: vi.fn(), onDownload: vi.fn(), onPan: vi.fn(), onPanCenter: vi.fn(), onVolume: vi.fn(), ...over,
})

describe('SeparatorTrackStrip', () => {
  it('faixa: M, S, baixar com o título do formato, pan com clique que centra e volume', () => {
    const p = stripProps()
    render(<SeparatorTrackStrip {...p} />)
    expect(screen.getByText('01')).toBeTruthy()
    fireEvent.click(btn('M')); expect(p.onMute).toHaveBeenCalled()
    fireEvent.click(btn('S')); expect(p.onSolo).toHaveBeenCalled()
    expect(btn('M').getAttribute('data-touch-exception')).toBe('ms')
    fireEvent.click(btn('Baixar Vocais (WAV)')); expect(p.onDownload).toHaveBeenCalled()
    const pan = btn(/Pan de Vocais/)
    expect(pan.textContent).toContain('R15')
    fireEvent.click(pan); expect(p.onPanCenter).toHaveBeenCalled()
    fireEvent.wheel(pan, { deltaY: 1 }); expect(p.onPan).toHaveBeenCalledWith(0.2)
    fireEvent.change(screen.getByRole('slider', { name: 'Volume de Vocais' }), { target: { value: '0.4' } }); expect(p.onVolume).toHaveBeenCalledWith(0.4)
    cleanup()
    render(<SeparatorTrackStrip {...stripProps({ downloading: true, state: { muted: true, soloed: true, volume: 0, pan: 0 } })} />)
    expect(btn('Baixar Vocais (WAV)').disabled).toBe(true)
    expect(btn('M').getAttribute('aria-pressed')).toBe('true')
    expect(document.body.textContent).toContain('-∞')
  })
})

/** Evento de ponteiro com a posição (o PointerEvent do jsdom não leva o clientX). */
function pointer(el: Element, type: string, clientX: number) {
  act(() => { el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, clientX })) })
}

async function openSaved(sep = savedSeparation()) {
  lib.separations = [sep]
  render(<SeparatorStudio onClose={vi.fn()} stageBusy={{ isPlaying: false, isCountingIn: false }} />)
  fireEvent.click(document.querySelector(`[data-separation-id="${sep.id}"]`)!)
  // As ondas ficam prontas no ciclo seguinte (a duração vem da primeira).
  await act(async () => { await new Promise((r) => setTimeout(r, 5)) })
}

describe('Separador montado', () => {
  it('abrir uma separação mostra a barra, uma faixa por canal e as ondas', async () => {
    await openSaved()
    expect(document.querySelector('[data-separator-bar]')).toBeTruthy()
    expect([...document.querySelectorAll('[data-track-id]')].map((e) => e.getAttribute('data-track-id'))).toEqual(['vocals', 'drums', 'bass'])
    expect(document.querySelectorAll('[data-wave-id]')).toHaveLength(3)
    expect(waves.map((w) => w.url)).toEqual(['https://r2/vocals.wav', 'https://r2/drums.wav', 'https://r2/bass.wav'])
    expect(document.body.textContent).toContain('0:00 / 3:20')
    expect(oldLanguageClasses(document.querySelector('[data-separator-player]')!)).toEqual([])
  })

  it('Espaço toca e pausa, menos dentro de campo de texto', async () => {
    await openSaved()
    fireEvent.keyDown(window, { code: 'Space' })
    await act(async () => { await new Promise((r) => setTimeout(r, 0)) })
    expect(waves.every((w) => w.playing)).toBe(true)
    expect(btn('Pausar')).toBeTruthy()
    fireEvent.keyDown(window, { code: 'Space' })
    expect(waves.every((w) => !w.playing)).toBe(true)
    const input = document.createElement('input')
    document.body.appendChild(input)
    fireEvent.keyDown(input, { code: 'Space' })
    expect(waves.every((w) => !w.playing)).toBe(true)
    input.remove()
  })

  it('arrastar a marcação muda o tempo dela e o clique leva a agulha', async () => {
    await openSaved()
    const timeline = document.querySelector('[data-timeline]') as HTMLElement
    timeline.getBoundingClientRect = () => ({ left: 0, width: 1000, top: 0, height: 100, right: 1000, bottom: 100, x: 0, y: 0, toJSON: () => ({}) })
    const cue = () => document.querySelector('[data-cue="c1"]') as HTMLElement
    expect(cue().title).toBe('Verso 1 · 0:20, arraste para mover')
    // Clique sem arrastar: todas as ondas vão pro tempo da marcação.
    pointer(cue(), 'pointerdown', 100)
    pointer(cue(), 'pointerup', 100)
    expect(waves.every((w) => w.time === 20)).toBe(true)
    // Arrastar até a metade da linha do tempo: a marcação vai pra 100 s.
    pointer(cue(), 'pointerdown', 100)
    pointer(cue(), 'pointermove', 500)
    pointer(cue(), 'pointerup', 500)
    expect(cue().title).toBe('Verso 1 · 1:40, arraste para mover')
  })

  it('Voltar salva e volta pra entrada', async () => {
    await openSaved()
    lib.saveSeparation.mockClear()
    fireEvent.click(btn('Voltar'))
    expect(lib.saveSeparation).toHaveBeenCalledWith(expect.objectContaining({ id: 'sep_1', createdAt: savedSeparation().createdAt }))
    expect(document.querySelector('[data-separator-home]')).toBeTruthy()
  })

  it('erro ao baixar vira a frase embaixo da barra, sem alert', async () => {
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {})
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('sem rede') }))
    await openSaved()
    fireEvent.click(btn('Baixar Vocais (WAV)'))
    await act(async () => { await new Promise((r) => setTimeout(r, 0)) })
    expect(screen.getByRole('alert').textContent).toBe('Erro ao baixar a faixa. Tenta de novo.')
    expect(alertSpy).not.toHaveBeenCalled()
    vi.unstubAllGlobals()
  })

  it('nenhum texto com travessão no player (inclusive os title)', async () => {
    await openSaved()
    expect(document.body.textContent).not.toContain(TRAVESSAO)
    for (const el of document.querySelectorAll('[title],[aria-label]')) {
      expect(el.getAttribute('title') ?? '').not.toContain(TRAVESSAO)
      expect(el.getAttribute('aria-label') ?? '').not.toContain(TRAVESSAO)
    }
  })
})

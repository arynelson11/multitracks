// @vitest-environment jsdom
import type React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { OPEN_ERROR_TEXT, type StageSeparationOpen } from '../../lib/separation/stageHandoff'
import { FakeAudioContext, resetWaves, savedSeparation } from './separatorTestKit'

const h = vi.hoisted(() => ({
  lib: { separations: [] as unknown[], saveSeparation: vi.fn<(d: unknown) => Promise<string | null>>(async () => 'sep_new'), deleteSeparation: vi.fn(), getSeparation: vi.fn(), isLoading: false },
  livre: { isLivre: false, canOpen: true, requestLimit: vi.fn(), noteSongOpened: vi.fn() },
  auth: { isAdmin: true, userPlan: 'essencial_mensal' },
}))
vi.mock('wavesurfer.js', async () => (await import('./separatorTestKit')).wavesurferModule())
vi.mock('../../lib/syncedTrackPlayer', async () => (await import('./separatorTestKit')).syncedPlayerModule())
vi.mock('../../hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 'u1' }, userPlan: h.auth.userPlan, isAdmin: h.auth.isAdmin, loading: false }) }))
vi.mock('../../hooks/useSeparationLibrary', () => ({ useSeparationLibrary: () => h.lib }))
vi.mock('../../hooks/useLivre', () => ({
  useLivre: () => ({
    isLivre: h.livre.isLivre, stage: { used: 3, limit: 3 }, canOpenSong: () => h.livre.canOpen, canOpenNewSong: () => h.livre.canOpen,
    noteSongOpened: h.livre.noteSongOpened, live: { remainingMs: Infinity, limitMs: null }, canStartLive: () => true,
    limit: null, requestLimit: h.livre.requestLimit, closeLimit: vi.fn(),
  }),
}))
vi.mock('../../lib/r2', () => ({ uploadToR2: vi.fn(async () => ({ url: 'https://r2/temp.mp3' })) }))
vi.mock('../../lib/supabase', () => ({ getAuthHeaders: async () => ({}) }))
vi.mock('../GuidedTour', () => ({ GuidedTour: () => null }))
vi.mock('../PricingModal', () => ({ PricingModal: () => null }))
vi.mock('../livre/AdSlot', () => ({ AdSlot: () => null }))
vi.mock('../livre/LimitGate', () => ({ LimitGate: () => null }))

import { SeparatorStudio } from '../SeparatorStudio'

type FetchFn = (url: string) => Promise<unknown>
let route: FetchFn
const okJson = (body: unknown) => ({ ok: true, status: 200, json: async () => body })
const okAudio = (name: string) => ({ ok: true, status: 200, blob: async () => new Blob([name], { type: 'audio/wav' }) })

beforeEach(() => {
  resetWaves()
  h.lib.saveSeparation.mockReset()
  h.lib.saveSeparation.mockResolvedValue('sep_new')
  h.lib.separations = []
  h.livre.isLivre = false
  h.livre.canOpen = true
  h.livre.requestLimit.mockReset()
  h.auth.isAdmin = true
  localStorage.setItem('sep_tour_seen', '1')
  ;(window as unknown as { AudioContext: unknown }).AudioContext = FakeAudioContext
  window.requestAnimationFrame = ((cb: FrameRequestCallback) => setTimeout(() => cb(0), 16) as unknown as number)
  window.cancelAnimationFrame = ((id: number) => clearTimeout(id)) as typeof window.cancelAnimationFrame
  route = async (url: string) => okAudio(url)
  vi.stubGlobal('fetch', vi.fn((url: string) => route(String(url))))
})
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals() })

const flush = async (ms = 0) => { await act(async () => { await new Promise((r) => setTimeout(r, ms)) }) }

function mount(over: Partial<React.ComponentProps<typeof SeparatorStudio>> = {}) {
  const onOpenOnStage = vi.fn<(o: StageSeparationOpen) => void>()
  const utils = render(<SeparatorStudio onClose={vi.fn()} stageBusy={{ isPlaying: false, isCountingIn: false }} stageAvailable onOpenOnStage={onOpenOnStage} {...over} />)
  return { onOpenOnStage, ...utils }
}

/** Separa um arquivo de verdade pelo fluxo do Separador, com a IA respondendo pelo fetch falso. */
async function separateNew() {
  vi.useFakeTimers({ shouldAdvanceTime: true, advanceTimeDelta: 5 })
  route = async (url: string) => {
    if (url.includes('/api/separate-audio')) return okJson({ prediction: { id: 'p1', status: 'starting' } })
    if (url.includes('/api/check-separation')) return okJson({ prediction: { status: 'succeeded', output: { vocals: 'https://ia/v.wav', drums: 'https://ia/d.wav' } } })
    if (url.includes('/api/upload-stem-from-url')) return okJson({ url: `https://r2/hosted_${Math.random().toString(36).slice(2, 6)}.wav` })
    return okAudio(url)
  }
  const input = document.querySelector('input[type="file"]') as HTMLInputElement
  fireEvent.change(input, { target: { files: [new File(['a'], 'Louvor Novo.mp3', { type: 'audio/mpeg' })] } })
  fireEvent.click(screen.getByRole('button', { name: /Vocais, Instrumental/ }))
  await act(async () => { await vi.advanceTimersByTimeAsync(4500) })
  await act(async () => { await vi.advanceTimersByTimeAsync(100) })
}

describe('Separador entregando a separação pro palco', () => {
  it('separação nova com o palco disponível baixa as faixas e chama onOpenOnStage com justSeparated', async () => {
    const { onOpenOnStage } = mount()
    await separateNew()
    expect(h.lib.saveSeparation).toHaveBeenCalledTimes(1)
    expect(onOpenOnStage).toHaveBeenCalledTimes(1)
    const o = onOpenOnStage.mock.calls[0][0]
    expect(o.justSeparated).toBe(true)
    expect(o.sep).toMatchObject({ id: 'sep_new', songName: 'Louvor Novo' })
    expect(typeof o.sep.createdAt).toBe('number')
    expect(o.files?.map((f) => f.name)).toEqual(['Vocais.wav', 'Bateria.wav'])
    // O player de reserva nunca apareceu.
    expect(document.querySelector('[data-separator-player]')).toBeNull()
  })

  it('separação nova sem registro salvo abre no player do Separador', async () => {
    h.lib.saveSeparation.mockResolvedValue(null)
    const { onOpenOnStage } = mount()
    await separateNew()
    expect(onOpenOnStage).not.toHaveBeenCalled()
    expect(document.querySelector('[data-separator-player]')).toBeTruthy()
  })

  it('sem stageAvailable a separação abre no player do Separador, como hoje', async () => {
    h.lib.separations = [savedSeparation()]
    const { onOpenOnStage } = mount({ stageAvailable: false })
    fireEvent.click(document.querySelector('[data-separation-id="sep_1"]')!)
    await flush(5)
    expect(onOpenOnStage).not.toHaveBeenCalled()
    expect(document.querySelector('[data-separator-player]')).toBeTruthy()
  })

  it('separação já no repertório: onOpenOnStage com files nulo e o App só pula', async () => {
    const sep = savedSeparation()
    h.lib.separations = [sep]
    const fetchSpy = vi.mocked(fetch)
    const { onOpenOnStage } = mount({ stageSeparationIds: new Set(['sep_1']) })
    fetchSpy.mockClear()
    fireEvent.click(document.querySelector('[data-separation-id="sep_1"]')!)
    expect(onOpenOnStage).toHaveBeenCalledWith({ sep, files: null, justSeparated: false })
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('reabrir de Minhas separações baixa as faixas remotas e entrega sem justSeparated', async () => {
    h.lib.separations = [savedSeparation()]
    const { onOpenOnStage } = mount()
    fireEvent.click(screen.getByRole('button', { name: 'Abrir' }))
    expect(screen.getByText('Abrindo no palco')).toBeTruthy()
    await flush(5)
    expect(onOpenOnStage).toHaveBeenCalledTimes(1)
    expect(onOpenOnStage.mock.calls[0][0].justSeparated).toBe(false)
    expect(onOpenOnStage.mock.calls[0][0].files).toHaveLength(3)
  })

  it('erro ao baixar mostra a frase e Tentar de novo, sem chamar onOpenOnStage', async () => {
    h.lib.separations = [savedSeparation()]
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {})
    let n = 0
    route = async (url: string) => { if (++n === 2) throw new TypeError('Failed to fetch'); return okAudio(url) }
    const { onOpenOnStage } = mount()
    fireEvent.click(screen.getByRole('button', { name: 'Abrir' }))
    await flush(5)
    expect(screen.getByRole('alert').textContent).toBe(OPEN_ERROR_TEXT)
    expect(onOpenOnStage).not.toHaveBeenCalled()
    expect(alertSpy).not.toHaveBeenCalled()
    route = async (url: string) => okAudio(url)
    fireEvent.click(screen.getByRole('button', { name: 'Tentar de novo' }))
    await flush(5)
    expect(onOpenOnStage).toHaveBeenCalledTimes(1)
  })

  it('Voltar no meio de baixar cancela', async () => {
    h.lib.separations = [savedSeparation()]
    let release!: () => void
    route = (url: string) => new Promise((resolve) => { release = () => resolve(okAudio(url)) })
    const { onOpenOnStage } = mount()
    fireEvent.click(screen.getByRole('button', { name: 'Abrir' }))
    await flush(0)
    fireEvent.click(screen.getByRole('button', { name: 'Voltar' }))
    expect(document.querySelector('[data-separator-home]')).toBeTruthy()
    route = async (url: string) => okAudio(url)
    release()
    await flush(5)
    expect(onOpenOnStage).not.toHaveBeenCalled()
  })

  it('abrir no palco não grava a separação com faixas vazias', async () => {
    h.lib.separations = [savedSeparation()]
    const { onOpenOnStage, unmount } = mount()
    fireEvent.click(screen.getByRole('button', { name: 'Abrir' }))
    await flush(5)
    expect(onOpenOnStage).toHaveBeenCalled()
    unmount()
    await flush(900)
    for (const [data] of h.lib.saveSeparation.mock.calls) expect((data as { stems: unknown[] }).stems.length).toBeGreaterThan(0)
  })

  it('Livre sem vaga: a tela de limite e nada vai pro palco', async () => {
    h.auth.isAdmin = false
    h.auth.userPlan = 'free'
    h.livre.isLivre = true
    h.livre.canOpen = false
    h.lib.separations = [savedSeparation({ createdAt: Date.UTC(2026, 8, 1) })]
    const { onOpenOnStage } = mount()
    fireEvent.click(screen.getByRole('button', { name: 'Abrir' }))
    await flush(5)
    expect(h.livre.requestLimit).toHaveBeenCalledWith('stage-songs')
    expect(onOpenOnStage).not.toHaveBeenCalled()
    h.auth.userPlan = 'essencial_mensal'
  })
})

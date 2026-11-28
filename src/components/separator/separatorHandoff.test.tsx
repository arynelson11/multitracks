// @vitest-environment jsdom
import type React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { OPEN_ERROR_TEXT, OPEN_MISSING_TEXT, type StageSeparationOpen, type StemStore } from '../../lib/separation/stageHandoff'
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
// Os Planos abertos ficam marcados na página (pra provar que nunca abrem atrás de uma janela).
vi.mock('../PricingModal', () => ({ PricingModal: ({ isOpen }: { isOpen: boolean }) => (isOpen ? <div data-pricing-open="" /> : null) }))
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
  h.livre.noteSongOpened.mockReset()
  h.auth.isAdmin = true
  h.auth.userPlan = 'essencial_mensal'
  localStorage.setItem('sep_tour_seen', '1')
  ;(window as unknown as { AudioContext: unknown }).AudioContext = FakeAudioContext
  window.requestAnimationFrame = ((cb: FrameRequestCallback) => setTimeout(() => cb(0), 16) as unknown as number)
  window.cancelAnimationFrame = ((id: number) => clearTimeout(id)) as typeof window.cancelAnimationFrame
  route = async (url: string) => okAudio(url)
  vi.stubGlobal('fetch', vi.fn((url: string) => route(String(url))))
})
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals() })

const flush = async (ms = 0) => { await act(async () => { await new Promise((r) => setTimeout(r, ms)) }) }

// O aparelho falso (Ruling SEP-memoria, manutenção 2026-11-27): as faixas descem direto pra ele.
let disk: Map<string, File>
let stemStore: StemStore & { put: ReturnType<typeof vi.fn>; discard: ReturnType<typeof vi.fn> }
beforeEach(() => {
  disk = new Map()
  let n = 0
  stemStore = {
    put: vi.fn(async (file: File) => { const id = `st${++n}`; disk.set(id, file); return id }),
    discard: vi.fn(async (ids: readonly string[]) => { for (const id of ids) disk.delete(id) }),
  }
})

function mount(over: Partial<React.ComponentProps<typeof SeparatorStudio>> = {}) {
  const onOpenOnStage = vi.fn<(o: StageSeparationOpen) => void>()
  // A conta, o plano e o papel vêm do App (1b, sem useAuth no Separador); o mock do useAuth fica pros Planos.
  const utils = render(<SeparatorStudio onClose={vi.fn()} stageBusy={{ isPlaying: false, isCountingIn: false }} userId="u1" userPlan={h.auth.userPlan} isAdmin={h.auth.isAdmin} stageAvailable onOpenOnStage={onOpenOnStage} stemStore={stemStore} {...over} />)
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
    // Só a id e o nome vão pro App: as faixas já estão no aparelho.
    expect(o.stems?.map((st) => st.name)).toEqual(['Vocais.wav', 'Bateria.wav'])
    expect(o.stems?.map((st) => disk.get(st.id)?.name)).toEqual(['Vocais.wav', 'Bateria.wav'])
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

  it('separação já no repertório: onOpenOnStage com stems nulo e o App só pula', async () => {
    const sep = savedSeparation()
    h.lib.separations = [sep]
    const fetchSpy = vi.mocked(fetch)
    const { onOpenOnStage } = mount({ stageSeparationIds: new Set(['sep_1']) })
    fetchSpy.mockClear()
    fireEvent.click(document.querySelector('[data-separation-id="sep_1"]')!)
    expect(onOpenOnStage).toHaveBeenCalledWith({ sep, stems: null, justSeparated: false })
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(stemStore.put).not.toHaveBeenCalled()
  })

  it('reabrir de Minhas separações baixa as faixas remotas e entrega sem justSeparated', async () => {
    h.lib.separations = [savedSeparation()]
    const { onOpenOnStage } = mount()
    fireEvent.click(screen.getByRole('button', { name: 'Abrir' }))
    expect(screen.getByText('Abrindo no palco')).toBeTruthy()
    await flush(5)
    expect(onOpenOnStage).toHaveBeenCalledTimes(1)
    expect(onOpenOnStage.mock.calls[0][0].justSeparated).toBe(false)
    expect(onOpenOnStage.mock.calls[0][0].stems).toHaveLength(3)
    expect(disk.size).toBe(3)
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
    // Tudo ou nada: a faixa que já tinha descido sai do aparelho.
    expect(stemStore.discard).toHaveBeenCalledWith(['st1'])
    expect(disk.size).toBe(0)
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
    // O que desceu antes do Voltar não fica no aparelho.
    expect(disk.size).toBe(0)
  })

  it('sem onde gravar as faixas (stemStore), a separação abre no player do Separador', async () => {
    h.lib.separations = [savedSeparation()]
    const { onOpenOnStage } = mount({ stemStore: undefined })
    fireEvent.click(screen.getByRole('button', { name: 'Abrir' }))
    await flush(5)
    expect(onOpenOnStage).not.toHaveBeenCalled()
    expect(document.querySelector('[data-separator-player]')).toBeTruthy()
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

describe('Separador de reserva: Livre, Planos e o caminho que sobra (revisão sep-2)', () => {
  const livreUser = () => { h.auth.isAdmin = false; h.auth.userPlan = 'free'; h.livre.isLivre = true }
  const openReserve = async (sep = savedSeparation()) => {
    h.lib.separations = [sep]
    const utils = mount({ stageAvailable: false })
    fireEvent.click(screen.getByRole('button', { name: 'Abrir' }))
    await flush(5)
    expect(document.querySelector('[data-separator-player]')).toBeTruthy()
    return utils
  }

  it('sep-2 I1: no Livre, Exportar abre a tela de limite download, nunca o formulário nem os Planos por baixo', async () => {
    livreUser()
    await openReserve()
    fireEvent.click(screen.getByRole('button', { name: 'Exportar' }))
    expect(h.livre.requestLimit).toHaveBeenCalledWith('download')
    expect(screen.queryByRole('dialog', { name: 'Publicar na Nuvem' })).toBeNull()
    expect(document.querySelector('[data-pricing-open]')).toBeNull()
  })

  it('sep-2 I1: quem paga continua abrindo o formulário de publicar pelo Exportar', async () => {
    h.auth.isAdmin = false
    await openReserve()
    fireEvent.click(screen.getByRole('button', { name: 'Exportar' }))
    expect(screen.getByRole('dialog', { name: 'Publicar na Nuvem' })).toBeTruthy()
    expect(h.livre.requestLimit).not.toHaveBeenCalled()
  })

  it('sep-2 M1: com o palco novo, o Separador não conta a separação de mês anterior (quem conta é o palco, na chegada)', async () => {
    livreUser()
    h.lib.separations = [savedSeparation({ createdAt: Date.UTC(2026, 8, 1) })]
    const { onOpenOnStage } = mount()
    fireEvent.click(screen.getByRole('button', { name: 'Abrir' }))
    await flush(5)
    expect(onOpenOnStage).toHaveBeenCalledTimes(1)
    expect(h.livre.noteSongOpened).not.toHaveBeenCalled()
  })

  it('sep-2 M1: erro ao baixar pro palco não gasta a vaga do Livre', async () => {
    livreUser()
    h.lib.separations = [savedSeparation({ createdAt: Date.UTC(2026, 8, 1) })]
    route = async () => { throw new TypeError('Failed to fetch') }
    mount()
    fireEvent.click(screen.getByRole('button', { name: 'Abrir' }))
    await flush(5)
    fireEvent.click(screen.getByRole('button', { name: 'Voltar' }))
    expect(h.livre.noteSongOpened).not.toHaveBeenCalled()
  })

  it('sep-2 M1: no Separador de reserva a separação de mês anterior conta ao abrir, como antes', async () => {
    livreUser()
    await openReserve(savedSeparation({ createdAt: Date.UTC(2026, 8, 1) }))
    expect(h.livre.noteSongOpened).toHaveBeenCalledTimes(1)
  })

  it('sep-2 I3: faixa que não baixa: "Abrir aqui no Separador" abre no player de reserva, com a frase de faixa que não existe mais pro 4xx', async () => {
    h.lib.separations = [savedSeparation()]
    let n = 0
    route = async (url: string) => (++n === 2 ? { ok: false, status: 404, blob: async () => new Blob() } : okAudio(url))
    const { onOpenOnStage } = mount()
    fireEvent.click(screen.getByRole('button', { name: 'Abrir' }))
    await flush(5)
    expect(screen.getByRole('alert').textContent).toBe(OPEN_MISSING_TEXT)
    expect(OPEN_MISSING_TEXT).not.toBe(OPEN_ERROR_TEXT)
    fireEvent.click(screen.getByRole('button', { name: 'Abrir aqui no Separador' }))
    await flush(5)
    expect(document.querySelector('[data-separator-player]')).toBeTruthy()
    expect(onOpenOnStage).not.toHaveBeenCalled()
    expect([...document.querySelectorAll('[data-track-id]')].map((e) => e.getAttribute('data-track-id'))).toEqual(['vocals', 'drums', 'bass'])
  })

  it('sep-2 I3: sem internet continua a frase da internet, e o Abrir aqui no Separador também está lá', async () => {
    h.lib.separations = [savedSeparation()]
    route = async () => { throw new TypeError('Failed to fetch') }
    mount()
    fireEvent.click(screen.getByRole('button', { name: 'Abrir' }))
    await flush(5)
    expect(screen.getByRole('alert').textContent).toBe(OPEN_ERROR_TEXT)
    expect(screen.getByRole('button', { name: 'Tentar de novo' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Abrir aqui no Separador' })).toBeTruthy()
  })

  it('sep-2 I3: no Livre, abrir aqui no Separador uma separação de mês anterior conta nesse momento', async () => {
    livreUser()
    h.lib.separations = [savedSeparation({ createdAt: Date.UTC(2026, 8, 1) })]
    route = async () => { throw new TypeError('Failed to fetch') }
    mount()
    fireEvent.click(screen.getByRole('button', { name: 'Abrir' }))
    await flush(5)
    expect(h.livre.noteSongOpened).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Abrir aqui no Separador' }))
    await flush(5)
    expect(h.livre.noteSongOpened).toHaveBeenCalledTimes(1)
  })

  it('sep-2 M7: arquivo que não é de áudio na entrada mostra a frase, sem ir pras opções', async () => {
    mount()
    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    fireEvent.change(input, { target: { files: [new File(['x'], 'cifra.pdf', { type: 'application/pdf' })] } })
    expect(screen.getByRole('alert').textContent).toBe('Esse arquivo não é de áudio.')
    expect(document.querySelector('[data-separator-home]')).toBeTruthy()
  })

  it('sep-2 M5: o passo 4 do tour de reserva não fala mais do repertório do Multitracks', () => {
    const src = readFileSync(join(process.cwd(), 'src/components/SeparatorStudio.tsx'), 'utf8')
    expect(src).not.toMatch(/repertório do Multitracks/)
    expect(src).toContain('Tudo que você separa fica salvo aqui. Reabra quando quiser e continue de onde parou.')
  })
})

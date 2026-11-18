// @vitest-environment jsdom
import { createElement } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, renderHook, screen } from '@testing-library/react'

// Teto da leitura do papel e do bloqueio (Ruling ADM-T27-teto): o useAuth de verdade, com o
// banco falso. A leitura do papel ('is_admin, blocked_at') pode ficar pendurada; a do plano
// responde na hora (ela fica como antes da T9, sem teto).
type FlagsRow = { is_admin: boolean; blocked_at: string | null }
type FakeSession = { user: { id: string; email: string }; access_token: string }

const h = vi.hoisted(() => ({
  session: null as FakeSession | null,
  flags: {} as Record<string, FlagsRow>,
  flagsHold: null as Promise<void> | null,
  listeners: [] as ((event: string, session: unknown) => void)[],
}))

vi.mock('../lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: async () => ({ data: { session: h.session } }),
      onAuthStateChange: (cb: (event: string, session: unknown) => void) => {
        h.listeners.push(cb)
        return { data: { subscription: { unsubscribe: () => {} } } }
      },
      signOut: async () => {},
    },
    from: () => ({
      select: (cols: string) => ({
        eq: (_col: string, id: string) => ({
          maybeSingle: async () => {
            if (!cols.includes('is_admin')) return { data: { plan: 'pro_mensal', plan_expires_at: null }, error: null }
            if (h.flagsHold) await h.flagsHold
            return { data: h.flags[id] ?? null, error: null }
          },
        }),
      }),
    }),
    rpc: () => Promise.resolve({ data: null, error: null }),
  },
  getAuthHeaders: async () => ({}),
  updateSongMarkers: async () => {},
  fetchSongs: async () => [],
  updateSong: async () => {},
}))
vi.mock('../lib/subscription', async (orig) => ({
  ...(await orig<typeof import('../lib/subscription')>()),
  syncBillingOnLogin: async () => {},
}))

// O App de verdade, com o motor de áudio falso e as telas vizinhas vazias.
vi.mock('./useAudioEngine', () => {
  const fn = () => {}
  const song = { id: 's1', name: 'Música de teste', channels: [], duration: 100, markers: [] }
  const engine = {
    isReady: true, initEngine: fn, loadFiles: fn, isLoading: false, isRestoring: false,
    playlist: [song], activeSongIndex: 0, setPlaylistOrder: fn, removeSongFromPlaylist: fn, jumpToSong: fn,
    renameSong: fn, setCoverImage: fn, clearSession: fn,
    setChannelBus: fn, exportPlaylist: fn, importPlaylist: fn,
    channels: [], pause: fn, seekTo: fn, prevSong: fn, nextSong: fn, isPlaying: false, currentTime: 0, duration: 100,
    masterVolume: 1, updateVolume: fn, toggleMute: fn, toggleSolo: fn, updateMasterVolume: fn,
    changePitch: fn, setOriginalKey: fn, currentMarker: null, setSongMarkers: fn, setSongLyrics: fn, syncSongMeta: fn,
    playbackMode: 'continue', setPlaybackMode: fn,
    activeLoop: null, pendingJump: null, armLoop: fn, cancelLoop: fn, armJump: fn, cancelJump: fn,
    addChannelToActiveSong: fn,
    updatePan: fn, removeChannel: fn, reorderChannels: fn, setChannelMeta: fn,
    precountEnabled: false, precountBeats: 4, isCountingIn: false,
    setPrecountBeats: fn, togglePrecountEnabled: fn, playWithPrecount: fn, cancelCountIn: fn,
    createEndlessMetronomeSong: fn,
    // Campos que o motor ganhou na v1.4.19 (palco novo, saídas separadas, grade): parados, como no palco antigo.
    outputPlan: { mode: 'split2', channels: 2, vs: [0], click: [1], guide: [1], panByRole: true, fellBackFrom: null, warning: null },
    maxOutputChannels: 2, masterMuted: false, toggleMasterMute: fn, getOutputLevels: () => [],
    sectionIntent: null, transitionView: null, landed: null, sectionSpansView: [], armSection: fn, stepSection: fn, armRepeat: fn, toggleSectionLoop: fn, cancelArm: fn,
    heardNow: () => 0, heardPosition: () => 0, precountTimes: [],
    songGrid: null, gridWarning: null, setSongMeter: fn, redetectSongGrid: fn, isReadingGrid: false,
  }
  return { useAudioEngine: () => engine }
})
// O App da v1.4.19 lê a chave do palco (CONFIG > Geral > Palco) no useSettings: aqui no palco
// antigo, o padrão de quem nunca mexeu na chave.
vi.mock('../contexts/SettingsContext', async (orig) => ({
  ...(await orig<typeof import('../contexts/SettingsContext')>()),
  useSettings: () => ({ settings: { stageVersion: 'antigo' } }),
}))
vi.mock('./usePadSynth', () => {
  const fn = () => {}
  const pads = {
    playPad: fn, stopPad: fn, activeNote: null, loadCustomPad: fn, clearCustomPad: fn, customPads: new Map(),
    customPadNames: new Map(), padVolume: 0.4, updatePadVolume: fn, selectedPadSet: null, selectPadSet: fn, padMode: 'synth',
  }
  return { usePadSynth: () => pads }
})
vi.mock('./useSamplesLibrary', () => {
  const lib = { samples: [], loops: [], loading: false, playingUrl: null, playSample: () => {}, stopPlayback: () => {} }
  return { useSamplesLibrary: () => lib }
})
vi.mock('./useLiveSync', () => {
  const live = { isFollowerMode: false, isConnected: false, followerState: null, sendCommand: () => {} }
  return { useLiveSync: () => live }
})
vi.mock('./useDesktopUpdate', () => {
  const desk = { update: null, install: () => {} }
  return { useDesktopUpdate: () => desk }
})
vi.mock('../admin/AdminApp', () => ({ default: () => null }))
vi.mock('../components/SectionBar', async (orig) => ({ ...(await orig<typeof import('../components/SectionBar')>()), SectionBar: () => null }))
vi.mock('../components/SettingsModal', () => ({ SettingsModal: () => null }))
vi.mock('../components/MetronomeModal', () => ({ MetronomeModal: () => null }))
vi.mock('../components/LibraryModal', () => ({ LibraryModal: () => null }))
vi.mock('../components/AdminModal', () => ({ AdminModal: () => null }))
vi.mock('../components/PadSetsModal', () => ({ PadSetsModal: () => null }))
vi.mock('../components/LiveModeModal', () => ({ LiveModeModal: () => null }))
vi.mock('../components/FollowerView', () => ({ FollowerView: () => null }))
vi.mock('../components/AuthPage', () => ({ AuthPage: () => null }))
vi.mock('../components/SeparatorStudio', () => ({ SeparatorStudio: () => null }))
vi.mock('../components/LandingPage', () => ({ LandingPage: () => null }))
vi.mock('../components/DownloadPage', () => ({ DownloadPage: () => null }))
vi.mock('../components/GuidedTour', () => ({ GuidedTour: () => null }))
vi.mock('../components/WhatsNewModal', () => ({ WhatsNewModal: () => null }))
vi.mock('../components/InstallAppBanner', () => ({ InstallAppBanner: () => null }))
vi.mock('../components/RenewalNoticeBanner', () => ({ RenewalNoticeBanner: () => null }))
vi.mock('../components/LyricsEditor', () => ({ LyricsEditor: () => null }))
vi.mock('../components/PricingModal', () => ({ PricingModal: () => null }))
vi.mock('../components/ChannelEditPanel', () => ({ ChannelEditPanel: () => null }))
vi.mock('../components/ChannelTrashButton', () => ({ ChannelTrashButton: () => null }))
vi.mock('../components/SubscriptionPanel', () => ({ SubscriptionPanel: () => null }))

import { useAuth } from './useAuth'
import App from '../App'

const TETO = 4000
const ADMIN = { id: 'u-adm', email: 'equipe@exemplo.com' }
const BLOQUEADO = { id: 'u-blq', email: 'bloqueado@exemplo.com' }
const sessionOf = (u: { id: string; email: string }): FakeSession => ({ user: u, access_token: 'tok' })
const flush = () => act(async () => { await vi.advanceTimersByTimeAsync(0) })
const advance = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms) })
// Leitura do papel pendurada até o teste soltar.
const hangFlags = () => {
  let release = () => {}
  h.flagsHold = new Promise<void>((r) => { release = r })
  return () => release()
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  h.session = null
  h.flags = {}
  h.flagsHold = null
  h.listeners.length = 0
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('useAuth: teto de 4 s na leitura do papel e do bloqueio', () => {
  it('leitura rápida não espera o teto', async () => {
    h.session = sessionOf(ADMIN)
    h.flags[ADMIN.id] = { is_admin: true, blocked_at: null }
    const { result } = renderHook(() => useAuth())
    await flush()
    expect(result.current.loading).toBe(false)
    expect(result.current.isAdmin).toBe(true)
  })

  it('leitura pendurada: o carregando solta aos 4 s, sem admin e sem bloqueio, com o plano lido', async () => {
    h.session = sessionOf(ADMIN)
    h.flags[ADMIN.id] = { is_admin: true, blocked_at: '2026-11-17T15:00:00Z' }
    hangFlags()
    const { result } = renderHook(() => useAuth())
    await flush()
    expect(result.current.loading).toBe(true)
    await advance(TETO - 1)
    expect(result.current.loading).toBe(true)
    await advance(1)
    expect(result.current.loading).toBe(false)
    expect(result.current.user?.id).toBe(ADMIN.id)
    expect(result.current.userPlan).toBe('pro_mensal')
    expect(result.current.isAdmin).toBe(false)
    expect(result.current.blockedAt).toBeNull()
  })

  it('a resposta que chega depois do teto não muda nada sozinha', async () => {
    h.session = sessionOf(BLOQUEADO)
    h.flags[BLOQUEADO.id] = { is_admin: true, blocked_at: '2026-11-17T15:00:00Z' }
    const release = hangFlags()
    const { result } = renderHook(() => useAuth())
    await advance(TETO)
    expect(result.current.loading).toBe(false)
    release()
    await flush()
    await flush()
    expect(result.current.isAdmin).toBe(false)
    expect(result.current.blockedAt).toBeNull()
  })

  it('outra conta que entra com a leitura pendurada não herda o papel da anterior', async () => {
    h.session = sessionOf(ADMIN)
    h.flags[ADMIN.id] = { is_admin: true, blocked_at: null }
    const { result } = renderHook(() => useAuth())
    await flush()
    expect(result.current.isAdmin).toBe(true)

    hangFlags()
    act(() => { for (const cb of h.listeners) cb('SIGNED_IN', sessionOf(BLOQUEADO)) })
    expect(result.current.loading).toBe(true)
    await advance(TETO)
    expect(result.current.loading).toBe(false)
    expect(result.current.user?.id).toBe(BLOQUEADO.id)
    expect(result.current.isAdmin).toBe(false)
    expect(result.current.blockedAt).toBeNull()
  })

  it('a mesma conta numa releitura pendurada mantém o que já tinha (o painel do admin não fecha)', async () => {
    h.session = sessionOf(ADMIN)
    h.flags[ADMIN.id] = { is_admin: true, blocked_at: null }
    const { result } = renderHook(() => useAuth())
    await flush()
    expect(result.current.isAdmin).toBe(true)

    hangFlags()
    await act(async () => { window.dispatchEvent(new Event('playback-plan-changed')) })
    await advance(TETO)
    expect(result.current.loading).toBe(false)
    expect(result.current.isAdmin).toBe(true)
  })
})

describe('App com a leitura do papel pendurada', () => {
  const playerShown = () => screen.queryAllByRole('button', { name: 'Tocar' }).length > 0
  const adminButton = () => screen.queryByRole('button', { name: 'Admin' })
  const blockedScreen = () => screen.queryByRole('heading', { name: 'Sua conta está bloqueada' })

  beforeEach(() => {
    // O jsdom não tem ResizeObserver (o mixer mede a largura dos canais com ele).
    vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  })
  afterEach(() => { vi.unstubAllGlobals() })

  it('o carregando solta aos 4 s e o app abre sem o botão ADMIN, e a resposta atrasada não o traz', async () => {
    h.session = sessionOf(ADMIN)
    h.flags[ADMIN.id] = { is_admin: true, blocked_at: null }
    const release = hangFlags()
    render(createElement(App))
    await flush()
    expect(playerShown()).toBe(false)
    await advance(TETO - 1)
    expect(playerShown()).toBe(false)

    await advance(1)
    expect(playerShown()).toBe(true)
    expect(adminButton()).toBeNull()
    expect(blockedScreen()).toBeNull()

    release()
    await flush()
    await flush()
    expect(adminButton()).toBeNull()
    expect(playerShown()).toBe(true)
  })

  it('conta bloqueada com a leitura pendurada abre o app, e a resposta atrasada não põe a tela de bloqueio', async () => {
    h.session = sessionOf(BLOQUEADO)
    h.flags[BLOQUEADO.id] = { is_admin: false, blocked_at: '2026-11-17T15:00:00Z' }
    const release = hangFlags()
    render(createElement(App))
    await advance(TETO)
    expect(playerShown()).toBe(true)
    expect(blockedScreen()).toBeNull()

    release()
    await flush()
    await flush()
    expect(blockedScreen()).toBeNull()
    expect(playerShown()).toBe(true)
  })

  it('leitura rápida de conta bloqueada mostra a tela de bloqueio direto, sem o player antes', async () => {
    h.session = sessionOf(BLOQUEADO)
    h.flags[BLOQUEADO.id] = { is_admin: false, blocked_at: '2026-11-17T15:00:00Z' }
    render(createElement(App))
    await flush()
    expect(blockedScreen()).not.toBeNull()
    expect(playerShown()).toBe(false)
  })
})

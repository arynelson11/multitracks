// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createElement } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'

// O App de verdade, com o login, o motor de áudio, os pads e os samples falsos e as telas
// vizinhas vazias: só o que decide a tela de conta bloqueada e o som do player roda como no app.
type FakeUser = { id: string; email: string }
type FakeState = {
  user: FakeUser | null; loading: boolean; isAdmin: boolean; blockedAt: string | null; userPlan: string
  isPlaying: boolean; isCountingIn: boolean; activeNote: string | null; playingUrl: string | null
}

const h = vi.hoisted(() => {
  const listeners = new Set<() => void>()
  let state: FakeState = {
    user: null, loading: false, isAdmin: false, blockedAt: null, userPlan: 'free',
    isPlaying: false, isCountingIn: false, activeNote: null, playingUrl: null,
  }
  const set = (next: Partial<FakeState>) => { state = { ...state, ...next }; for (const l of listeners) l() }
  return {
    get: () => state,
    set,
    subscribe: (l: () => void) => { listeners.add(l); return () => { listeners.delete(l) } },
    play: vi.fn(() => set({ isPlaying: true })),
    pause: vi.fn(() => set({ isPlaying: false })),
    cancelCountIn: vi.fn(() => set({ isCountingIn: false })),
    stopPad: vi.fn(() => set({ activeNote: null })),
    stopSample: vi.fn(() => set({ playingUrl: null })),
    signOut: vi.fn(async () => {}),
    deleteAccount: vi.fn(async () => {}),
    liveProps: null as null | { onToggleDevice: (ip: string) => void },
  }
})

vi.mock('./hooks/useAuth', async () => {
  const { useSyncExternalStore } = await import('react')
  return {
    useAuth: () => {
      const s = useSyncExternalStore(h.subscribe, h.get)
      return {
        user: s.user, loading: s.loading, isAdmin: s.isAdmin, blockedAt: s.blockedAt, userPlan: s.userPlan,
        signOut: h.signOut, deleteAccount: h.deleteAccount,
      }
    },
  }
})
vi.mock('./hooks/useAudioEngine', async () => {
  const { useSyncExternalStore } = await import('react')
  const fn = () => {}
  const song = { id: 's1', name: 'Música de teste', channels: [], duration: 100, markers: [] }
  const base = {
    isReady: true, initEngine: fn, loadFiles: fn, isLoading: false, isRestoring: false,
    playlist: [song], activeSongIndex: 0, setPlaylistOrder: fn, removeSongFromPlaylist: fn, jumpToSong: fn,
    renameSong: fn, setCoverImage: fn, clearSession: fn,
    setChannelBus: fn, exportPlaylist: fn, importPlaylist: fn,
    channels: [], pause: () => h.pause(), seekTo: fn, prevSong: fn, nextSong: fn, currentTime: 0, duration: 100,
    masterVolume: 1, updateVolume: fn, toggleMute: fn, toggleSolo: fn, updateMasterVolume: fn,
    changePitch: fn, setOriginalKey: fn, currentMarker: null, setSongMarkers: fn, setSongLyrics: fn, syncSongMeta: fn,
    playbackMode: 'continue', setPlaybackMode: fn,
    activeLoop: null, pendingJump: null, armLoop: fn, cancelLoop: fn, armJump: fn, cancelJump: fn,
    addChannelToActiveSong: fn,
    updatePan: fn, removeChannel: fn, reorderChannels: fn, setChannelMeta: fn,
    precountEnabled: false, precountBeats: 4,
    setPrecountBeats: fn, togglePrecountEnabled: fn, playWithPrecount: () => h.play(), cancelCountIn: () => h.cancelCountIn(),
    createEndlessMetronomeSong: fn,
    // Campos que o motor ganhou na v1.4.19 (palco novo, saídas separadas, grade): parados, como no palco antigo.
    outputPlan: { mode: 'split2', channels: 2, vs: [0], click: [1], guide: [1], panByRole: true, fellBackFrom: null, warning: null },
    maxOutputChannels: 2, masterMuted: false, toggleMasterMute: fn, getOutputLevels: () => [],
    sectionIntent: null, transitionView: null, landed: null, sectionSpansView: [], armSection: fn, stepSection: fn, armRepeat: fn, toggleSectionLoop: fn, cancelArm: fn,
    heardNow: () => 0, heardPosition: () => 0, precountTimes: [],
    songGrid: null, gridWarning: null, setSongMeter: fn, redetectSongGrid: fn, isReadingGrid: false,
  }
  return {
    useAudioEngine: () => {
      const s = useSyncExternalStore(h.subscribe, h.get)
      return { ...base, isPlaying: s.isPlaying, isCountingIn: s.isCountingIn }
    },
  }
})
// O App da v1.4.19 lê a chave do palco (CONFIG > Geral > Palco) no useSettings: aqui no palco
// antigo, o padrão de quem nunca mexeu na chave.
vi.mock('./contexts/SettingsContext', async (orig) => ({
  ...(await orig<typeof import('./contexts/SettingsContext')>()),
  useSettings: () => ({ settings: { stageVersion: 'antigo' } }),
}))
vi.mock('./hooks/usePadSynth', async () => {
  const { useSyncExternalStore } = await import('react')
  const fn = () => {}
  const base = {
    playPad: fn, stopPad: () => h.stopPad(), loadCustomPad: fn, clearCustomPad: fn, customPads: new Map(),
    customPadNames: new Map(), padVolume: 0.4, updatePadVolume: fn, selectedPadSet: null, selectPadSet: fn, padMode: 'synth',
  }
  return {
    usePadSynth: () => {
      const s = useSyncExternalStore(h.subscribe, h.get)
      return { ...base, activeNote: s.activeNote }
    },
  }
})
vi.mock('./hooks/useSamplesLibrary', async () => {
  const { useSyncExternalStore } = await import('react')
  return {
    useSamplesLibrary: () => {
      const s = useSyncExternalStore(h.subscribe, h.get)
      return { samples: [], loops: [], loading: false, playingUrl: s.playingUrl, playSample: () => {}, stopPlayback: () => h.stopSample() }
    },
  }
})
vi.mock('./hooks/useLiveSync', () => {
  const live = { isFollowerMode: false, isConnected: false, followerState: null, sendCommand: () => {} }
  return { useLiveSync: () => live }
})
vi.mock('./hooks/useDesktopUpdate', () => {
  const desk = { update: null, install: () => {} }
  return { useDesktopUpdate: () => desk }
})
vi.mock('./lib/supabase', () => ({
  supabase: {},
  updateSongMarkers: async () => {},
  fetchSongs: async () => [],
  updateSong: async () => {},
  getAuthHeaders: async () => ({}),
}))
vi.mock('./admin/AdminApp', () => ({ default: () => null }))
vi.mock('./components/SectionBar', async (orig) => ({ ...(await orig<typeof import('./components/SectionBar')>()), SectionBar: () => null }))
vi.mock('./components/SettingsModal', () => ({ SettingsModal: () => null }))
vi.mock('./components/MetronomeModal', () => ({ MetronomeModal: () => null }))
vi.mock('./components/LibraryModal', () => ({ LibraryModal: () => null }))
vi.mock('./components/AdminModal', () => ({ AdminModal: () => null }))
vi.mock('./components/PadSetsModal', () => ({ PadSetsModal: () => null }))
vi.mock('./components/LiveModeModal', () => ({
  LiveModeModal: (props: { onToggleDevice: (ip: string) => void }) => { h.liveProps = props; return null },
}))
vi.mock('./components/FollowerView', () => ({ FollowerView: () => null }))
vi.mock('./components/AuthPage', () => ({ AuthPage: () => null }))
vi.mock('./components/SeparatorStudio', () => ({ SeparatorStudio: () => null }))
vi.mock('./components/LandingPage', () => ({ LandingPage: () => null }))
vi.mock('./components/DownloadPage', () => ({ DownloadPage: () => null }))
vi.mock('./components/GuidedTour', () => ({ GuidedTour: () => null }))
vi.mock('./components/WhatsNewModal', () => ({ WhatsNewModal: () => null }))
vi.mock('./components/InstallAppBanner', () => ({ InstallAppBanner: () => null }))
vi.mock('./components/RenewalNoticeBanner', () => ({ RenewalNoticeBanner: () => null }))
vi.mock('./components/LyricsEditor', () => ({ LyricsEditor: () => null }))
vi.mock('./components/PricingModal', () => ({ PricingModal: () => null }))
vi.mock('./components/ChannelEditPanel', () => ({ ChannelEditPanel: () => null }))
vi.mock('./components/ChannelTrashButton', () => ({ ChannelTrashButton: () => null }))
// A assinatura fica de fora: o próprio teste da BlockedScreen cobre o painel.
vi.mock('./components/SubscriptionPanel', () => ({ SubscriptionPanel: () => null }))

import App from './App'

const read = (path: string) => readFileSync(join(process.cwd(), 'src', path), 'utf8')

describe('App.tsx usa a regra da conta bloqueada', () => {
  it('chama shouldShowBlocked e mostra a BlockedScreen depois do login e do carregamento', () => {
    const app = read('App.tsx')
    expect(app).toMatch(/import \{ shouldShowBlocked \} from '\.\/lib\/profileFlags'/)
    expect(app).toMatch(/const blocked = shouldShowBlocked\(\{ user, blockedAt, isAdmin \}\)/)
    const gate = app.indexOf('if (blocked) return <BlockedScreen plan={userPlan} onSignOut={signOut} onDeleteAccount={deleteAccount} />')
    expect(gate).toBeGreaterThan(-1)
    // Depois dos bloqueios de carregamento e de login, antes do Separador, do admin e do player.
    expect(gate).toBeGreaterThan(app.indexOf('if (loading) {'))
    expect(gate).toBeGreaterThan(app.indexOf('if (!user) {'))
    expect(gate).toBeLessThan(app.indexOf('if (isSeparatorOpen) {'))
    expect(gate).toBeLessThan(app.indexOf('if (adminPanelShown) {'))
    expect(gate).toBeLessThan(app.indexOf('// ───────────────── MAIN APP'))
  })
})

const MUSICO = { id: 'u-mus', email: 'musico@exemplo.com' }
const BLOCKED_AT = '2026-11-17T15:00:00Z'
const TITLE = 'Sua conta está bloqueada'
const blockedShown = () => screen.queryByRole('heading', { name: TITLE }) !== null
const pressSpace = () => fireEvent.keyDown(window, { code: 'Space' })

type RemoteCommand = { action: string; ip?: string }

describe('App com a conta bloqueada', () => {
  let remote: ((cmd: RemoteCommand) => void) | null = null

  beforeEach(() => {
    // O jsdom não tem ResizeObserver (o mixer mede a largura dos canais com ele).
    vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
    h.set({
      user: MUSICO, loading: false, isAdmin: false, blockedAt: null, userPlan: 'pro_mensal',
      isPlaying: false, isCountingIn: false, activeNote: null, playingUrl: null,
    })
    for (const m of [h.play, h.pause, h.cancelCountIn, h.stopPad, h.stopSample, h.signOut, h.deleteAccount]) m.mockClear()
    h.liveProps = null
    remote = null
  })
  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
    delete (window as { playbackDesktop?: unknown }).playbackDesktop
  })

  it('quem não está bloqueado nunca vê a tela, do carregando ao player, e o Espaço toca e pausa', () => {
    const seen: boolean[] = []
    h.set({ user: null, loading: true })
    render(createElement(App))
    seen.push(blockedShown())
    act(() => h.set({ user: MUSICO, loading: true }))
    seen.push(blockedShown())
    act(() => h.set({ loading: false }))
    seen.push(blockedShown())
    expect(seen).toEqual([false, false, false])

    pressSpace()
    expect(h.play).toHaveBeenCalledTimes(1)
    pressSpace()
    expect(h.pause).toHaveBeenCalledTimes(1)
  })

  it('conta bloqueada vê a tela no lugar do player, e o Espaço não toca', () => {
    h.set({ blockedAt: BLOCKED_AT })
    render(createElement(App))
    expect(blockedShown()).toBe(true)
    expect(screen.queryAllByRole('button', { name: 'Tocar' })).toEqual([])
    pressSpace()
    expect(h.play).not.toHaveBeenCalled()
  })

  it('o bloqueio chega com a música tocando: para a música, a contagem, o pad e o sample', () => {
    render(createElement(App))
    act(() => h.set({ isPlaying: true, activeNote: 'C', playingUrl: 'https://exemplo.com/loop.wav' }))
    act(() => h.set({ blockedAt: BLOCKED_AT }))
    expect(blockedShown()).toBe(true)
    expect(h.pause).toHaveBeenCalledTimes(1)
    expect(h.stopPad).toHaveBeenCalledTimes(1)
    expect(h.stopSample).toHaveBeenCalledTimes(1)
    expect(h.get().isPlaying).toBe(false)

    // Contagem antes da música também para.
    act(() => h.set({ isCountingIn: true }))
    expect(h.cancelCountIn).toHaveBeenCalledTimes(1)

    // Por trás da tela de bloqueio o Espaço não volta a tocar.
    pressSpace()
    expect(h.play).not.toHaveBeenCalled()
  })

  it('desbloqueada (a próxima leitura do perfil volta sem bloqueio), o player volta com o Espaço', () => {
    h.set({ blockedAt: BLOCKED_AT })
    render(createElement(App))
    expect(blockedShown()).toBe(true)
    act(() => h.set({ blockedAt: null }))
    expect(blockedShown()).toBe(false)
    pressSpace()
    expect(h.play).toHaveBeenCalledTimes(1)
  })

  it('admin com blockedAt preenchido segue no player', () => {
    h.set({ isAdmin: true, blockedAt: BLOCKED_AT })
    render(createElement(App))
    expect(blockedShown()).toBe(false)
    pressSpace()
    expect(h.play).toHaveBeenCalledTimes(1)
  })

  it('comando da banda não toca a música com a conta bloqueada', () => {
    ;(window as { playbackDesktop?: unknown }).playbackDesktop = {
      isElectron: true,
      onClientsUpdate: () => () => {},
      onRemoteCommand: (cb: (cmd: RemoteCommand) => void) => { remote = cb; return () => { remote = null } },
    }
    render(createElement(App))
    // O líder libera o celular da banda; o comando dele toca a música.
    act(() => h.liveProps?.onToggleDevice('10.0.0.5'))
    act(() => remote?.({ action: 'toggle-play', ip: '10.0.0.5' }))
    expect(h.play).toHaveBeenCalledTimes(1)
    act(() => remote?.({ action: 'toggle-play', ip: '10.0.0.5' }))
    expect(h.pause).toHaveBeenCalledTimes(1)

    act(() => h.set({ blockedAt: BLOCKED_AT }))
    act(() => remote?.({ action: 'toggle-play', ip: '10.0.0.5' }))
    expect(h.play).toHaveBeenCalledTimes(1)
  })

  it('Sair e Excluir minha conta da tela chamam o signOut e o deleteAccount do useAuth', () => {
    h.set({ blockedAt: BLOCKED_AT, userPlan: 'free' })
    render(createElement(App))
    fireEvent.click(screen.getByRole('button', { name: 'Sair' }))
    expect(h.signOut).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: 'Excluir minha conta' }))
    fireEvent.change(screen.getByLabelText('Digite EXCLUIR para confirmar'), { target: { value: 'EXCLUIR' } })
    fireEvent.click(screen.getByRole('button', { name: 'Excluir de vez' }))
    expect(h.deleteAccount).toHaveBeenCalledTimes(1)
  })
})

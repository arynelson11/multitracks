// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { AdminEntryButton } from './AdminEntryButton'

// O App de verdade, com o login e o motor de áudio falsos e as telas vizinhas vazias:
// só o que decide abrir o admin e os atalhos do player roda como no app.
type FakeAuth = { user: { id: string; email: string } | null; loading: boolean; isAdmin: boolean; userPlan: string; signOut: () => Promise<void> }

const h = vi.hoisted(() => {
  const listeners = new Set<() => void>()
  let auth: FakeAuth = { user: null, loading: false, isAdmin: false, userPlan: 'free', signOut: async () => {} }
  return {
    getAuth: () => auth,
    setAuth: (next: Partial<FakeAuth>) => { auth = { ...auth, ...next }; for (const l of listeners) l() },
    subscribe: (l: () => void) => { listeners.add(l); return () => { listeners.delete(l) } },
    play: vi.fn(),
    pause: vi.fn(),
  }
})

vi.mock('../hooks/useAuth', async () => {
  const { useSyncExternalStore } = await import('react')
  return { useAuth: () => useSyncExternalStore(h.subscribe, h.getAuth) }
})
vi.mock('../hooks/useAudioEngine', () => {
  const fn = () => {}
  const song = { id: 's1', name: 'Música de teste', channels: [], duration: 100, markers: [] }
  const engine = {
    isReady: true, initEngine: fn, loadFiles: fn, isLoading: false, isRestoring: false,
    playlist: [song], activeSongIndex: 0, setPlaylistOrder: fn, removeSongFromPlaylist: fn, jumpToSong: fn,
    renameSong: fn, setCoverImage: fn, clearSession: fn,
    setChannelBus: fn, exportPlaylist: fn, importPlaylist: fn,
    channels: [], pause: () => h.pause(), seekTo: fn, prevSong: fn, nextSong: fn, isPlaying: false, currentTime: 0, duration: 100,
    masterVolume: 1, updateVolume: fn, toggleMute: fn, toggleSolo: fn, updateMasterVolume: fn,
    changePitch: fn, setOriginalKey: fn, currentMarker: null, setSongMarkers: fn, setSongLyrics: fn, syncSongMeta: fn,
    playbackMode: 'continue', setPlaybackMode: fn,
    activeLoop: null, pendingJump: null, armLoop: fn, cancelLoop: fn, armJump: fn, cancelJump: fn,
    addChannelToActiveSong: fn,
    updatePan: fn, removeChannel: fn, reorderChannels: fn, setChannelMeta: fn,
    precountEnabled: false, precountBeats: 4, isCountingIn: false,
    setPrecountBeats: fn, togglePrecountEnabled: fn, playWithPrecount: () => h.play(), cancelCountIn: fn,
    createEndlessMetronomeSong: fn,
  }
  return { useAudioEngine: () => engine }
})
vi.mock('../hooks/usePadSynth', () => {
  const pads = {
    playPad: () => {}, activeNote: null, loadCustomPad: () => {}, clearCustomPad: () => {}, customPads: new Map(),
    customPadNames: new Map(), padVolume: 0.4, updatePadVolume: () => {}, selectedPadSet: null, selectPadSet: () => {}, padMode: 'synth',
  }
  return { usePadSynth: () => pads }
})
vi.mock('../hooks/useSamplesLibrary', () => {
  const lib = { samples: [], loops: [], loading: false, playingUrl: null, playSample: () => {}, stopPlayback: () => {} }
  return { useSamplesLibrary: () => lib }
})
vi.mock('../hooks/useLiveSync', () => {
  const live = { isFollowerMode: false, isConnected: false, followerState: null, sendCommand: () => {} }
  return { useLiveSync: () => live }
})
vi.mock('../hooks/useDesktopUpdate', () => {
  const desk = { update: null, install: () => {} }
  return { useDesktopUpdate: () => desk }
})
vi.mock('../lib/supabase', () => ({
  supabase: {},
  updateSongMarkers: async () => {},
  fetchSongs: async () => [],
  updateSong: async () => {},
  getAuthHeaders: async () => ({}),
}))
vi.mock('../admin/AdminApp', async () => {
  const { createElement } = await import('react')
  return { default: ({ onClose }: { onClose?: () => void }) => createElement('button', { type: 'button', onClick: onClose }, 'Voltar ao app') }
})
vi.mock('./SectionBar', async (orig) => ({ ...(await orig<typeof import('./SectionBar')>()), SectionBar: () => null }))
vi.mock('./SettingsModal', () => ({ SettingsModal: () => null }))
vi.mock('./MetronomeModal', () => ({ MetronomeModal: () => null }))
vi.mock('./LibraryModal', () => ({ LibraryModal: () => null }))
vi.mock('./AdminModal', () => ({ AdminModal: () => null }))
vi.mock('./PadSetsModal', () => ({ PadSetsModal: () => null }))
vi.mock('./LiveModeModal', () => ({ LiveModeModal: () => null }))
vi.mock('./FollowerView', () => ({ FollowerView: () => null }))
vi.mock('./AuthPage', () => ({ AuthPage: () => null }))
vi.mock('./SeparatorStudio', () => ({ SeparatorStudio: () => null }))
vi.mock('./LandingPage', () => ({ LandingPage: () => null }))
vi.mock('./DownloadPage', () => ({ DownloadPage: () => null }))
vi.mock('./GuidedTour', () => ({ GuidedTour: () => null }))
vi.mock('./WhatsNewModal', () => ({ WhatsNewModal: () => null }))
vi.mock('./InstallAppBanner', () => ({ InstallAppBanner: () => null }))
vi.mock('./RenewalNoticeBanner', () => ({ RenewalNoticeBanner: () => null }))
vi.mock('./LyricsEditor', () => ({ LyricsEditor: () => null }))
vi.mock('./PricingModal', () => ({ PricingModal: () => null }))
vi.mock('./ChannelEditPanel', () => ({ ChannelEditPanel: () => null }))
vi.mock('./ChannelTrashButton', () => ({ ChannelTrashButton: () => null }))

import App from '../App'

afterEach(cleanup)

const VARIANTS = ['toolbar', 'drawer'] as const

// O ambiente jsdom do Vitest deixa a instância em globalThis.jsdom.
type JsdomConsole = {
  on(event: 'jsdomError', cb: (err: Error) => void): void
  off(event: 'jsdomError', cb: (err: Error) => void): void
}
const jsdomConsole = () => (globalThis as unknown as { jsdom: { virtualConsole: JsdomConsole } }).jsdom.virtualConsole

describe('AdminEntryButton', () => {
  it('AdminEntryButton não aparece pra quem não é admin', () => {
    for (const variant of VARIANTS) {
      const { container } = render(<AdminEntryButton isAdmin={false} variant={variant} onOpen={() => {}} />)
      expect(container.innerHTML).toBe('')
      expect(screen.queryByRole('button')).toBeNull()
      cleanup()
    }
  })

  it('o clique chama onOpen e não mexe no endereço', () => {
    // O jsdom não troca de página: quem tenta (location.href = '/admin') só gera um aviso
    // no console virtual dele. O href igual pega a troca por hash; o aviso pega o resto.
    const navigations: string[] = []
    const onJsdomError = (err: Error) => { navigations.push(err.message) }
    jsdomConsole().on('jsdomError', onJsdomError)
    try {
      for (const variant of VARIANTS) {
        const onOpen = vi.fn()
        const before = window.location.href
        render(<AdminEntryButton isAdmin variant={variant} onOpen={onOpen} />)
        fireEvent.click(screen.getByRole('button'))
        expect(onOpen).toHaveBeenCalledTimes(1)
        expect(window.location.href).toBe(before)
        cleanup()
      }
    } finally {
      jsdomConsole().off('jsdomError', onJsdomError)
    }
    expect(navigations).toEqual([])
  })

  it('na barra mostra ADMIN e no menu mostra Admin', () => {
    render(<AdminEntryButton isAdmin variant="toolbar" onOpen={() => {}} />)
    const toolbar = screen.getByRole('button')
    expect(toolbar.textContent).toBe('ADMIN')
    // O texto some em tela estreita: o nome acessível não depende dele.
    expect(toolbar.getAttribute('aria-label')).toBe('Admin')
    expect(toolbar.querySelector('svg')).not.toBeNull()
    cleanup()

    render(<AdminEntryButton isAdmin variant="drawer" onOpen={() => {}} />)
    const drawer = screen.getByRole('button')
    expect(drawer.textContent).toBe('Admin')
    expect(drawer.querySelectorAll('svg').length).toBe(2)
  })
})

describe('App com o admin aberto', () => {
  const ADMIN = { id: 'u-adm', email: 'equipe@exemplo.com' }
  const MUSICO = { id: 'u-mus', email: 'musico@exemplo.com' }

  beforeEach(() => {
    // O jsdom não tem ResizeObserver (o mixer mede a largura dos canais com ele).
    vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
    h.setAuth({ user: ADMIN, loading: false, isAdmin: true, userPlan: 'pro_mensal' })
    h.play.mockReset()
    h.pause.mockReset()
  })
  afterEach(() => { vi.unstubAllGlobals() })

  const pressSpace = () => fireEvent.keyDown(window, { code: 'Space' })
  const openAdmin = async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Admin' }))
    await screen.findByRole('button', { name: 'Voltar ao app' })
  }
  const panelShown = () => screen.queryByRole('button', { name: 'Voltar ao app' }) !== null

  it('abre o admin pelo botão, sem tocar a música no Espaço, e volta pro player', async () => {
    render(<App />)
    await openAdmin()
    pressSpace()
    expect(h.play).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Voltar ao app' }))
    expect(panelShown()).toBe(false)
    pressSpace()
    expect(h.play).toHaveBeenCalledTimes(1)
  })

  it('com o admin aberto a sessão cai: quem entra depois tem o Espaço tocando', async () => {
    render(<App />)
    await openAdmin()

    act(() => h.setAuth({ user: null, isAdmin: false, userPlan: 'free' }))
    act(() => h.setAuth({ user: MUSICO, isAdmin: false }))
    expect(panelShown()).toBe(false)
    pressSpace()
    expect(h.play).toHaveBeenCalledTimes(1)
  })

  it('o painel não reabre sozinho quando o papel volta', async () => {
    render(<App />)
    await openAdmin()

    // Papel relido como falso (rebaixado ou leitura que falhou): o player volta com o Espaço.
    act(() => h.setAuth({ isAdmin: false }))
    expect(panelShown()).toBe(false)
    pressSpace()
    expect(h.play).toHaveBeenCalledTimes(1)

    // Na leitura boa seguinte o papel volta: o botão reaparece, o painel não.
    act(() => h.setAuth({ isAdmin: true }))
    await act(async () => {})
    expect(panelShown()).toBe(false)
    expect(screen.getByRole('button', { name: 'Admin' })).toBeTruthy()
  })
})

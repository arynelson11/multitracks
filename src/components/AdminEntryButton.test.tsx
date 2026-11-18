// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { AdminEntryButton, InAppAdmin } from './AdminEntryButton'

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
    // Chave do palco que o useSettings falso devolve (CONFIG > Geral > Palco).
    stage: 'antigo' as 'novo' | 'antigo',
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
    // Campos que o motor ganhou na v1.4.19 (palco novo, saídas separadas, grade): parados, como no palco antigo.
    outputPlan: { mode: 'split2', channels: 2, vs: [0], click: [1], guide: [1], panByRole: true, fellBackFrom: null, warning: null },
    maxOutputChannels: 2, masterMuted: false, toggleMasterMute: fn, getOutputLevels: () => [],
    sectionIntent: null, transitionView: null, landed: null, sectionSpansView: [], armSection: fn, stepSection: fn, armRepeat: fn, toggleSectionLoop: fn, cancelArm: fn,
    heardNow: () => 0, heardPosition: () => 0, precountTimes: [],
    songGrid: null, gridWarning: null, setSongMeter: fn, redetectSongGrid: fn, isReadingGrid: false,
  }
  return { useAudioEngine: () => engine }
})
// O App lê a chave do palco (CONFIG > Geral > Palco) no useSettings: o palco antigo nos casos de
// sempre e o palco novo (padrão da v1.4.20) nos casos dele, com a tela de 1024x768 do jsdom.
vi.mock('../contexts/SettingsContext', async (orig) => ({
  ...(await orig<typeof import('../contexts/SettingsContext')>()),
  useSettings: () => ({ settings: { stageVersion: h.stage } }),
}))
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
const fakeAdminApp = async () => {
  const { createElement } = await import('react')
  return { default: ({ onClose }: { onClose?: () => void }) => createElement('button', { type: 'button', onClick: onClose }, 'Voltar ao app') }
}
vi.mock('../admin/AdminApp', () => fakeAdminApp())
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
    h.stage = 'antigo'
  })
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

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

  it('palco novo: o ADMIN fica no EDITAR, só pra admin, e abre o admin dentro do app', async () => {
    // O palco novo desenha a onda num canvas (o jsdom não tem).
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => null)
    h.stage = 'novo'
    const { unmount } = render(<App />)
    expect(document.querySelector('[data-stage-shell]')).not.toBeNull()
    // Fora do EDITAR não tem ADMIN; no EDITAR, as ferramentas do admin.
    expect(screen.queryByRole('button', { name: 'ADMIN' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Editar' }))
    fireEvent.click(screen.getByRole('button', { name: 'ADMIN' }))
    await screen.findByRole('button', { name: 'Voltar ao app' })
    // Com o admin aberto, o Espaço não toca a música por baixo; ao voltar, o palco novo volta.
    pressSpace()
    expect(h.play).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Voltar ao app' }))
    expect(document.querySelector('[data-stage-shell]')).not.toBeNull()
    unmount()

    // Quem não é admin não vê o ADMIN nem no EDITAR.
    act(() => h.setAuth({ user: MUSICO, isAdmin: false }))
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: 'Editar' }))
    expect(screen.queryByRole('button', { name: 'ADMIN' })).toBeNull()
    expect(screen.getByRole('group', { name: 'Marcar seção' })).toBeTruthy()
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

  it('uma importação que rejeita mostra a frase, e ao voltar o Espaço volta a tocar', async () => {
    // O React escreve no console o erro que a proteção pegou.
    vi.spyOn(console, 'error').mockImplementation(() => {})
    // Registro de módulos limpo e o pedaço do admin falhando (publicação nova na web,
    // file:// no computador): o App novo importa de novo e a importação é recusada.
    vi.resetModules()
    vi.doMock('../admin/AdminApp', () => { throw new Error('Failed to fetch dynamically imported module') })
    try {
      const { default: FreshApp } = await import('../App')
      render(<FreshApp />)
      fireEvent.click(screen.getByRole('button', { name: 'Admin' }))
      expect(await screen.findByText(LOAD_FAILED)).toBeTruthy()
      // A tela do admin (com a frase) está aberta: os atalhos do player seguem parados.
      pressSpace()
      expect(h.play).not.toHaveBeenCalled()

      fireEvent.click(screen.getByRole('button', { name: 'Voltar ao app' }))
      expect(screen.queryByText(LOAD_FAILED)).toBeNull()
      pressSpace()
      expect(h.play).toHaveBeenCalledTimes(1)
    } finally {
      vi.doMock('../admin/AdminApp', () => fakeAdminApp())
    }
  })
})

const LOAD_FAILED = 'Não deu pra abrir o admin. Tente de novo.'

describe('InAppAdmin', () => {
  type AdminModule = { default: (props: { onClose?: () => void }) => ReturnType<typeof AdminEntryButton> }
  const FakeAdmin = ({ onClose }: { onClose?: () => void }) => <button type="button" onClick={onClose}>Painel de pé</button>

  // O React escreve no console o erro que a proteção pegou.
  beforeEach(() => { vi.spyOn(console, 'error').mockImplementation(() => {}) })

  it('enquanto o pedaço do admin carrega mostra Carregando', () => {
    render(<InAppAdmin load={() => new Promise<AdminModule>(() => {})} onClose={() => {}} />)
    expect(screen.getByRole('status').textContent).toBe('Carregando...')
  })

  it('importação que rejeita mostra a frase, e Voltar ao app chama onClose', async () => {
    const onClose = vi.fn()
    render(<InAppAdmin load={() => Promise.reject(new Error('404'))} onClose={onClose} />)
    expect((await screen.findByRole('alert')).textContent).toContain(LOAD_FAILED)
    fireEvent.click(screen.getByRole('button', { name: 'Voltar ao app' }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('Tentar de novo importa outra vez, não reaproveita a promessa recusada', async () => {
    const load = vi.fn<() => Promise<AdminModule>>()
      .mockRejectedValueOnce(new Error('404'))
      .mockResolvedValueOnce({ default: FakeAdmin })
    const onClose = vi.fn()
    render(<InAppAdmin load={load} onClose={onClose} />)
    await screen.findByText(LOAD_FAILED)
    expect(load).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByRole('button', { name: 'Tentar de novo' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Painel de pé' }))
    expect(load).toHaveBeenCalledTimes(2)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('erro de render fora das abas mostra a frase, e Tentar de novo monta outra vez', async () => {
    let broken = true
    const Broken = () => {
      if (broken) throw new Error('quebrou fora das abas')
      return <p>Painel de pé</p>
    }
    render(<InAppAdmin load={async () => ({ default: Broken })} onClose={() => {}} />)
    await screen.findByText(LOAD_FAILED)
    broken = false
    fireEvent.click(screen.getByRole('button', { name: 'Tentar de novo' }))
    expect(await screen.findByText('Painel de pé')).toBeTruthy()
  })
})

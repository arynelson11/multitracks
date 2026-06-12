// Detecção de ambiente desktop (Electron) exposta pelo preload via contextBridge.
// No navegador, window.playbackDesktop é undefined e isElectron fica false.
// Esta é a costura pra ligar funções que só existem no app (cache offline,
// host local, etc) nas próximas fases. Detecção por capability, não user-agent.

export interface PlaybackDesktop {
  isElectron: true
  platform: string
  version: string
  openExternalUrl: (url: string) => void
  onDeepLinkAuth: (callback: (fragment: string) => void) => () => void
}

declare global {
  interface Window {
    playbackDesktop?: PlaybackDesktop
  }
}

const bridge = typeof window !== 'undefined' ? window.playbackDesktop : undefined

export const isElectron: boolean = bridge?.isElectron === true
export const desktopInfo: PlaybackDesktop | undefined = bridge

/** Abre URL no navegador do sistema (só funciona no Electron). */
export function openExternalUrl(url: string) {
  if (bridge?.openExternalUrl) {
    bridge.openExternalUrl(url)
  } else {
    // Fallback no navegador: abre em nova aba
    window.open(url, '_blank')
  }
}

/** Escuta deep links de auth vindos do main process. Retorna cleanup. */
export function onDeepLinkAuth(callback: (fragment: string) => void): () => void {
  if (bridge?.onDeepLinkAuth) {
    return bridge.onDeepLinkAuth(callback)
  }
  return () => {} // noop no navegador
}

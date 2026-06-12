// Detecção de ambiente desktop (Electron) exposta pelo preload via contextBridge.
// No navegador, window.playbackDesktop é undefined e isElectron fica false.
// Esta é a costura pra ligar funções que só existem no app (cache offline,
// host local, etc) nas próximas fases. Detecção por capability, não user-agent.

// A declaração global de window.playbackDesktop vive em src/types.ts (fonte única).
// Aqui derivamos o tipo dela pra evitar declarações duplicadas/conflitantes.
export type PlaybackDesktop = NonNullable<Window['playbackDesktop']>

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

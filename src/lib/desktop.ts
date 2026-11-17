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

const isHttps = (url: string) => url.startsWith('https://')

/**
 * Abre um link externo que só chega depois de um pedido (a fatura do Asaas, por exemplo). Na web,
 * o navegador só deixa abrir aba dentro do clique: a aba abre já, em branco, recebe o endereço em
 * `go` e fecha em `cancel` se o link não vier. Chame no próprio clique, antes de qualquer await.
 * No app de computador segue pelo bridge, como o openExternalUrl. `go` diz se conseguiu abrir e
 * só aceita endereço https: qualquer outro (http, javascript:, vazio) fecha a aba e devolve false,
 * porque a aba em branco nasce com a origem do app.
 */
export function openExternalUrlLater(): { go: (url: string) => boolean; cancel: () => void } {
  const b = bridge
  if (b?.openExternalUrl) {
    return {
      go: (url) => {
        if (!isHttps(url)) return false
        b.openExternalUrl(url)
        return true
      },
      cancel: () => {},
    }
  }
  // Sem noopener: com ele o window.open devolve null e não dá pra trocar o endereço depois.
  // O opener é zerado aqui, pra página de fora não alcançar o app.
  const tab = window.open('', '_blank')
  if (tab) tab.opener = null
  const cancel = () => {
    if (tab && !tab.closed) tab.close()
  }
  return {
    go: (url) => {
      if (!isHttps(url)) {
        cancel()
        return false
      }
      if (tab && !tab.closed) {
        tab.location.replace(url)
        return true
      }
      // Aba bloqueada ou fechada antes do link chegar: tenta de novo, que pode ser bloqueado também.
      const late = window.open(url, '_blank')
      if (late) late.opener = null
      return late !== null
    },
    cancel,
  }
}

/** Escuta deep links de auth vindos do main process. Retorna cleanup. */
export function onDeepLinkAuth(callback: (fragment: string) => void): () => void {
  if (bridge?.onDeepLinkAuth) {
    return bridge.onDeepLinkAuth(callback)
  }
  return () => {} // noop no navegador
}

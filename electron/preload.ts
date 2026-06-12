import { contextBridge, ipcRenderer } from 'electron'

// Ponte segura entre o processo principal e o React.
// É o único canal que o renderer enxerga do mundo Electron (contextIsolation).
// window.playbackDesktop é a costura usada pra ligar os extras de desktop.
contextBridge.exposeInMainWorld('playbackDesktop', {
  isElectron: true,
  platform: process.platform,
  version: process.versions.electron,

  // Abre uma URL no navegador do sistema (pra OAuth, links externos, etc).
  openExternalUrl: (url: string) => {
    ipcRenderer.send('open-external-url', url)
  },

  // Escuta deep links de auth (playbackstudio://auth/callback#token=...).
  // O main process manda 'deep-link-auth' com o fragmento da URL.
  onDeepLinkAuth: (callback: (fragment: string) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, fragment: string) => callback(fragment)
    ipcRenderer.on('deep-link-auth', handler)
    // Retorna cleanup pra o React poder limpar no useEffect
    return () => ipcRenderer.removeListener('deep-link-auth', handler)
  },
})

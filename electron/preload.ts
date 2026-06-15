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

  // Inicia o servidor HTTP e WS local na porta preferida (ou dinâmica se estiver em uso)
  startLocalServer: async (preferredPort?: number) => {
    return await ipcRenderer.invoke('start-local-server', preferredPort)
  },

  // Para o servidor HTTP e WS local
  stopLocalServer: async () => {
    return await ipcRenderer.invoke('stop-local-server')
  },

  // Envia estado para o main repassar aos clients via WebSocket
  broadcastState: (state: any) => {
    ipcRenderer.send('ws-broadcast', state)
  },
  // Escuta comandos remotos vindos dos dispositivos da banda. Retorna cleanup.
  onRemoteCommand: (callback: (cmd: { type: 'COMMAND'; action: string; index?: number; id?: string; value?: number; clientId?: string; ip?: string }) => void) => {
    const handler = (_e: unknown, cmd: { type: 'COMMAND'; action: string; index?: number; id?: string; value?: number; clientId?: string; ip?: string }) => callback(cmd)
    ipcRenderer.on('remote-command', handler)
    return () => ipcRenderer.removeListener('remote-command', handler)
  },
  // Escuta a lista de dispositivos conectados ao servidor local. Retorna cleanup.
  onClientsUpdate: (callback: (clients: { id: string; ip: string }[]) => void) => {
    const handler = (_e: unknown, clients: { id: string; ip: string }[]) => callback(clients)
    ipcRenderer.on('ws-clients', handler)
    return () => ipcRenderer.removeListener('ws-clients', handler)
  },

  // ── Auto-update ──
  // Mac: avisa que existe versão nova pra baixar ({version, url}). Retorna cleanup.
  onUpdateAvailable: (callback: (info: { version: string; url: string }) => void) => {
    const handler = (_e: unknown, info: { version: string; url: string }) => callback(info)
    ipcRenderer.on('update:available', handler)
    return () => ipcRenderer.removeListener('update:available', handler)
  },
  // Windows: a nova versão já foi baixada e está pronta pra instalar. Retorna cleanup.
  onUpdateReady: (callback: (version: string) => void) => {
    const handler = (_e: unknown, version: string) => callback(version)
    ipcRenderer.on('update:ready', handler)
    return () => ipcRenderer.removeListener('update:ready', handler)
  },
  // Checa sob demanda se há versão nova publicada. Retorna info de versão
  // (request/response — confiável, não se perde por timing como os eventos).
  checkForUpdate: () => ipcRenderer.invoke('check-for-update'),
  // Aplica a atualização: Windows reinicia e instala; Mac abre a página de download.
  installUpdate: () => ipcRenderer.invoke('install-update'),
})

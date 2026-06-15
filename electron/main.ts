import { app, BrowserWindow, shell, ipcMain, session } from 'electron'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import express from 'express'
import { WebSocketServer } from 'ws'
import http from 'http'
import os from 'os'
import cors from 'cors'
import fs from 'fs'
import { randomUUID } from 'node:crypto'
import electronUpdater from 'electron-updater'

const { autoUpdater } = electronUpdater

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// Rede de segurança: um erro não tratado (ex: porta em uso ao subir o servidor
// local) não deve derrubar o app inteiro. Loga e segue.
process.on('uncaughtException', (err) => {
  console.error('[main] uncaughtException:', err)
})
process.on('unhandledRejection', (reason) => {
  console.error('[main] unhandledRejection:', reason)
})

// Deep link protocol — playbackstudio://
// Registra o app pra interceptar URLs com esse esquema.
const PROTOCOL = 'playbackstudio'
if (process.defaultApp) {
  // Em dev, precisa registrar com o path do Electron explícito.
  if (process.argv.length >= 2) {
    app.setAsDefaultProtocolClient(PROTOCOL, process.execPath, [
      path.resolve(process.argv[1]),
    ])
  }
} else {
  app.setAsDefaultProtocolClient(PROTOCOL)
}

// Garante instância única — se o app já estiver aberto, traz pra frente.
const gotTheLock = app.requestSingleInstanceLock()
if (!gotTheLock) {
  app.quit()
} else {
  app.on('second-instance', (_event, argv) => {
    // Windows/Linux: a deep link vem como último argumento do argv.
    const deepLink = argv.find((a) => a.startsWith(`${PROTOCOL}://`))
    if (deepLink) handleDeepLink(deepLink)

    const win = BrowserWindow.getAllWindows()[0]
    if (win) {
      if (win.isMinimized()) win.restore()
      win.focus()
    }
  })
}

// vite-plugin-electron injeta esta env no processo principal durante o dev.
// Em produção ela fica undefined, então carregamos o build de dist/.
const DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL

let mainWindow: BrowserWindow | null = null

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#121214',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  mainWindow.once('ready-to-show', () => mainWindow!.show())

  // Links externos abrem no navegador do sistema, não dentro da janela do app.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  // Intercepta navegação OAuth — o Supabase tenta redirecionar pra accounts.google.com
  // dentro da janela do Electron. Queremos que isso abra no navegador do sistema.
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (url.startsWith('https://accounts.google.com') || url.includes('supabase.co/auth')) {
      event.preventDefault()
      shell.openExternal(url)
    }
  })

  if (DEV_SERVER_URL) {
    mainWindow.loadURL(DEV_SERVER_URL)
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'))
  }
}

// ── Deep link handler ──
// Recebe playbackstudio://auth/callback#access_token=...&refresh_token=...
function handleDeepLink(url: string) {
  if (!mainWindow) return

  // Extrai o fragmento (tudo depois do #)
  const hashIndex = url.indexOf('#')
  if (hashIndex === -1) return

  const fragment = url.substring(hashIndex + 1)
  // Manda pro renderer via IPC seguro
  mainWindow.webContents.send('deep-link-auth', fragment)

  // Traz a janela pra frente
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.focus()
}

// ── IPC: abrir URL no navegador do sistema ──
ipcMain.on('open-external-url', (_event, url: string) => {
  if (typeof url === 'string' && (url.startsWith('https://') || url.startsWith('http://'))) {
    shell.openExternal(url)
  }
})

// ── Auto-update ──
// Windows: o electron-updater baixa a nova versão sozinho e instala no próximo
//   restart. O renderer recebe 'update:ready' e oferece reiniciar na hora.
// macOS (sem assinatura): o macOS recusa aplicar updates de apps não assinados,
//   então só checamos a versão mais recente no GitHub e avisamos pra baixar.
const GH_REPO = 'arynelson11/multitracks'
const SIX_HOURS = 1000 * 60 * 60 * 6

function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number)
  const pb = b.split('.').map(Number)
  for (let i = 0; i < 3; i++) {
    const diff = (pa[i] || 0) - (pb[i] || 0)
    if (diff !== 0) return diff > 0 ? 1 : -1
  }
  return 0
}

async function checkMacUpdate() {
  try {
    const res = await fetch(`https://api.github.com/repos/${GH_REPO}/releases/latest`, {
      headers: { Accept: 'application/vnd.github+json' },
    })
    if (!res.ok) return
    const data = (await res.json()) as { tag_name?: string }
    const latest = (data.tag_name || '').replace(/^v/, '')
    if (latest && compareVersions(latest, app.getVersion()) > 0) {
      mainWindow?.webContents.send('update:available', {
        version: latest,
        url: 'https://playbackstudio.com.br/download',
      })
    }
  } catch (err) {
    console.error('[update] checagem mac falhou:', err)
  }
}

function setupAutoUpdate() {
  if (!app.isPackaged) return // dev não tem pacote pra atualizar

  if (process.platform === 'win32') {
    autoUpdater.autoDownload = true
    autoUpdater.autoInstallOnAppQuit = true
    autoUpdater.on('update-downloaded', (info) => {
      mainWindow?.webContents.send('update:ready', info.version)
    })
    autoUpdater.on('error', (err) => console.error('[update] win:', err))
    // Atraso inicial: dá tempo do renderer montar os listeners antes de avisar.
    setTimeout(() => {
      autoUpdater.checkForUpdates().catch(() => {})
      setInterval(() => autoUpdater.checkForUpdates().catch(() => {}), SIX_HOURS)
    }, 4000)
  } else if (process.platform === 'darwin') {
    setTimeout(() => {
      checkMacUpdate()
      setInterval(checkMacUpdate, SIX_HOURS)
    }, 4000)
  }
}

// Renderer pede pra aplicar a atualização (botão "Reiniciar"/"Baixar").
ipcMain.handle('install-update', () => {
  if (process.platform === 'win32') {
    autoUpdater.quitAndInstall()
  } else {
    shell.openExternal('https://playbackstudio.com.br/download')
  }
})

// ── Local Server (Fase 2) ──
let localServer: http.Server | null = null
let wss: WebSocketServer | null = null

function getLocalIp(): string {
  const interfaces = os.networkInterfaces()
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]!) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address
      }
    }
  }
  return '127.0.0.1'
}

// Informa o renderer (líder) sobre os dispositivos conectados, pra gestão de permissão.
function notifyClients() {
  if (!wss) return
  const clients = [...wss.clients]
    .map((c) => ({ id: (c as any).clientId as string, ip: (c as any).ip as string }))
    .filter((c) => c.id)
  mainWindow?.webContents.send('ws-clients', clients)
}

ipcMain.handle('start-local-server', async (_event, preferredPort = 8080) => {
  // Servidor já no ar (ex: renderer recarregou mas o main seguiu vivo):
  // devolve a URL existente em vez de erro, pra o app se reconectar.
  if (localServer) {
    const addr = localServer.address()
    const port = addr && typeof addr !== 'string' ? addr.port : preferredPort
    return { url: `http://${getLocalIp()}:${port}`, error: null }
  }

  return new Promise((resolve) => {
    const appExpress = express()
    appExpress.use(cors())

    const distPath = path.join(__dirname, '../dist')
    
    // Fallback: se dist/ não existir (ex: dev sem build prévio), servimos um aviso
    if (!fs.existsSync(distPath)) {
      appExpress.use((_req, res) => {
        res.send('<h1>Build não encontrado</h1><p>Em modo de desenvolvimento, rode <code>npm run build</code> primeiro para que a banda possa ver a interface.</p>')
      })
    } else {
      appExpress.use(express.static(distPath))
      // Tratamento para SPA (fallback para index.html)
      appExpress.use((_req, res) => {
        res.sendFile(path.join(distPath, 'index.html'))
      })
    }

    const server = http.createServer(appExpress)
    const wsServer = new WebSocketServer({ server })

    // Tenta escutar numa porta; em EADDRINUSE, cai pra porta dinâmica (0).
    // Usa listeners 'once' removidos a cada tentativa pra o erro não escapar
    // como uncaughtException (comportamento observado no Windows).
    let triedDynamic = false
    const tryListen = (port: number) => {
      const onError = (err: NodeJS.ErrnoException) => {
        server.removeListener('listening', onListening)
        if (err.code === 'EADDRINUSE' && !triedDynamic) {
          triedDynamic = true
          console.warn(`Port ${port} in use, trying dynamic port...`)
          setImmediate(() => tryListen(0))
        } else {
          resolve({ url: null, error: err.message })
        }
      }
      const onListening = () => {
        server.removeListener('error', onError)
        localServer = server
        wss = wsServer
        const addr = server.address()
        const actualPort = typeof addr === 'string' ? port : addr?.port
        resolve({ url: `http://${getLocalIp()}:${actualPort}`, error: null })
      }
      server.once('error', onError)
      server.once('listening', onListening)
      server.listen(port, '0.0.0.0')
    }

    wsServer.on('connection', (ws, req) => {
      // Identidade por dispositivo: o líder aprova/bloqueia cada um individualmente.
      const clientId = randomUUID()
      const ip = (req.socket.remoteAddress || '').replace('::ffff:', '')
      ;(ws as any).clientId = clientId
      ;(ws as any).ip = ip
      ws.send(JSON.stringify({ type: 'CLIENT_JOINED', clientId, ip }))
      notifyClients()

      ws.on('message', (message) => {
        // Comando reverso (dispositivo da banda -> líder). Encaminha pro renderer
        // com o clientId de origem; o líder valida a permissão e executa no engine.
        try {
          const data = JSON.parse(message.toString())
          if (data && data.type === 'COMMAND') {
            mainWindow?.webContents.send('remote-command', { ...data, clientId, ip })
          }
        } catch {
          // mensagem inválida — ignora
        }
      })
      ws.on('close', () => notifyClients())
    })

    tryListen(preferredPort)
  })
})

ipcMain.handle('stop-local-server', async () => {
  if (wss) {
    wss.clients.forEach((client) => client.terminate())
    wss.close()
    wss = null
  }
  if (localServer) {
    localServer.close()
    localServer = null
  }
})

ipcMain.on('ws-broadcast', (event, data) => {
  if (wss) {
    wss.clients.forEach((client) => {
      if (client.readyState === 1) {
        client.send(JSON.stringify(data))
      }
    })
  }
})

app.whenReady().then(() => {
  // As funções serverless (/api) rodam no domínio de produção e só liberam CORS
  // para origens na allowlist — que não inclui o app desktop. Aqui injetamos os
  // headers Access-Control-* nas respostas dessas chamadas (cobre preflight e
  // resposta real), permitindo que o renderer as consuma.
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    // /api/* roda no domínio de produção; o upload binário (capa, stems, pads) vai
    // direto pro R2 via URL assinada (*.r2.cloudflarestorage.com). Ambos precisam
    // dos headers CORS injetados, pois a origin do app desktop (file://) não está
    // na allowlist de nenhum dos dois. PUT entra na lista por causa do upload R2.
    const needsCors =
      details.url.includes('playbackstudio.com.br/api/') ||
      details.url.includes('.r2.cloudflarestorage.com')
    if (needsCors) {
      callback({
        responseHeaders: {
          ...details.responseHeaders,
          'access-control-allow-origin': ['*'],
          'access-control-allow-methods': ['GET,POST,PUT,PATCH,DELETE,OPTIONS'],
          'access-control-allow-headers': ['Content-Type, Authorization'],
        },
      })
    } else {
      callback({ responseHeaders: details.responseHeaders })
    }
  })

  createWindow()
  setupAutoUpdate()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

// macOS: deep link chega aqui quando o app já está aberto.
app.on('open-url', (event, url) => {
  event.preventDefault()
  handleDeepLink(url)
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

// Libera a porta do servidor local ao sair, pra não deixar a porta presa
// (causa de EADDRINUSE numa próxima abertura, sobretudo no Windows).
app.on('before-quit', () => {
  try {
    wss?.clients.forEach((c) => c.terminate())
    wss?.close()
    localServer?.close()
  } catch { /* noop */ }
})

import { app, BrowserWindow, shell, ipcMain } from 'electron'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import express from 'express'
import { WebSocketServer } from 'ws'
import http from 'http'
import os from 'os'
import cors from 'cors'
import fs from 'fs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

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

    wsServer.on('connection', (ws) => {
      console.log('Client connected to Live Mode WS')
      ws.send(JSON.stringify({ type: 'CLIENT_JOINED' }))
      
      ws.on('message', (message) => {
        // Comando reverso (dispositivo da banda -> líder). Encaminha pro renderer,
        // que valida a permissão e executa no engine.
        try {
          const data = JSON.parse(message.toString())
          if (data && data.type === 'COMMAND') {
            mainWindow?.webContents.send('remote-command', data)
          }
        } catch {
          // mensagem inválida — ignora
        }
      })
      ws.on('close', () => console.log('Client disconnected'))
    })

    server.on('error', (err: any) => {
      if (err.code === 'EADDRINUSE') {
        console.warn(`Port ${preferredPort} in use, trying dynamic port...`)
        // A porta 0 pede pro SO alocar uma porta disponível
        server.listen(0, '0.0.0.0')
      } else {
        resolve({ url: null, error: err.message })
      }
    })

    server.on('listening', () => {
      localServer = server
      wss = wsServer
      const addr = server.address()
      const port = typeof addr === 'string' ? preferredPort : addr?.port
      const ip = getLocalIp()
      resolve({ url: `http://${ip}:${port}`, error: null })
    })

    server.listen(preferredPort, '0.0.0.0')
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
  createWindow()
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

import { app, BrowserWindow, shell, ipcMain } from 'electron'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

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

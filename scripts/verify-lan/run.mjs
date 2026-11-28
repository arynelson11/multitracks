#!/usr/bin/env node
// Tela da banda pela rede local (manutenção 2026-11-27, revisão do item 4, C1): abre o build de
// computador como o celular da banda abre, por http://<IP da rede local>:<porta>, fora de contexto
// seguro (sem crypto.randomUUID, sem service worker). O vitest e o verify-layout rodam em contexto
// seguro (localhost) e não pegam um erro que derruba o app inteiro só na rede local.
// Uso: node scripts/verify-lan/run.mjs [--no-build]
//   sem --no-build, monta antes o build de computador (DESKTOP=1 npx vite build, em dist/).
// Passa quando a tela da banda ([data-follower-view]) monta no #root e nenhum erro solto
// ("Uncaught") aparece; sai com código 1 se não montar, se der erro ou se o Chrome não responder.
import http from 'node:http'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '../..')
const DIST = path.join(ROOT, 'dist')
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const TIMEOUT_S = 40
const args = process.argv.slice(2)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const fail = (msg) => { console.error(`FALHA: ${msg}`); process.exit(1) }

/** Um IPv4 da rede local (10/8, 172.16/12, 192.168/16), como o do computador que roda o app. */
function lanIp() {
  const privado = /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list ?? []) if (a.family === 'IPv4' && !a.internal && privado.test(a.address)) return a.address
  }
  return null
}

if (!args.includes('--no-build')) {
  process.stdout.write('build de computador (DESKTOP=1 npx vite build)... ')
  let log = ''
  const code = await new Promise((resolve) => {
    const b = spawn('npx', ['vite', 'build'], { cwd: ROOT, env: { ...process.env, DESKTOP: '1' }, stdio: ['ignore', 'pipe', 'pipe'] })
    b.stdout.on('data', (c) => { log += c })
    b.stderr.on('data', (c) => { log += c })
    b.once('exit', resolve)
  })
  if (code !== 0) { console.error(log); fail(`o build saiu com ${code}`) }
  console.log('ok')
}
if (!fs.existsSync(path.join(DIST, 'index.html'))) fail('não achei dist/index.html (rode sem --no-build)')

const ip = lanIp()
if (!ip) fail('esta máquina não tem IP da rede local (10.x, 172.16 a 31.x ou 192.168.x); conecte numa rede e rode de novo')

// Antes do app: anota os erros soltos da página (o mesmo que o console mostra como "Uncaught") e,
// com a tela da banda montada (ou o tempo acabando), manda o resultado pro servidor.
const PROBE = `<script>(function(){
  var errors = [];
  window.addEventListener('error', function (e) {
    if (!(e instanceof ErrorEvent)) return;
    errors.push(/^Uncaught/.test(e.message) ? e.message : 'Uncaught ' + e.message);
  }, true);
  window.addEventListener('unhandledrejection', function (e) {
    var r = e.reason; errors.push('Uncaught (in promise) ' + (r && r.message ? r.message : String(r)));
  });
  var t0 = Date.now();
  function send(mounted) {
    var root = document.getElementById('root');
    fetch('/__verify-lan', { method: 'POST', body: JSON.stringify({
      mounted: mounted, rootChildren: root ? root.children.length : -1, errors: errors,
      secure: window.isSecureContext, randomUUID: !!(window.crypto && typeof crypto.randomUUID === 'function'), href: location.href,
    }) });
  }
  function poll() {
    if (document.querySelector('#root [data-follower-view]')) { setTimeout(function () { send(true); }, 1500); return; }
    if (Date.now() - t0 > 12000) { send(false); return; }
    setTimeout(poll, 200);
  }
  window.addEventListener('load', function () { setTimeout(poll, 100); });
})();</script>`

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json' }
let resolveResult
const result = new Promise((r) => { resolveResult = r })

// Como o express do app de computador (electron/main.ts): arquivos do dist/ e, no resto, o index.html.
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x')
  if (req.method === 'POST' && url.pathname === '/__verify-lan') {
    let body = ''
    req.on('data', (c) => { body += c })
    req.on('end', () => { res.end('ok'); try { resolveResult(JSON.parse(body)) } catch { resolveResult({ fatal: 'resultado ilegível' }) } })
    return
  }
  let file = path.join(DIST, decodeURIComponent(url.pathname))
  if (!file.startsWith(DIST) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(DIST, 'index.html')
  res.setHeader('Cache-Control', 'no-store')
  if (file.endsWith('.html')) {
    res.setHeader('Content-Type', MIME['.html'])
    res.end(fs.readFileSync(file, 'utf8').replace('<head>', `<head>${PROBE}`))
    return
  }
  res.setHeader('Content-Type', MIME[path.extname(file)] || 'application/octet-stream')
  fs.createReadStream(file).pipe(res)
})
// A tela da banda tenta o WebSocket do líder no mesmo endereço: aqui não há líder, ela fica em "Reconectando".
server.on('upgrade', (_req, socket) => socket.destroy())
await new Promise((r) => server.listen(0, ip, r))
const url = `http://${ip}:${server.address().port}/`
console.log(`abrindo ${url} no Chrome headless (como o celular da banda)`)

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-lan-'))
const chrome = spawn(CHROME, ['--headless=new', '--no-first-run', '--no-default-browser-check', '--window-size=500,900', `--user-data-dir=${profile}`, url], { stdio: 'ignore' })
const exited = new Promise((r) => chrome.once('exit', r))
const got = await Promise.race([result, sleep(TIMEOUT_S * 1000).then(() => null)])
chrome.kill('SIGTERM')
await Promise.race([exited, sleep(2000)])
try { chrome.kill('SIGKILL') } catch { /* já saiu */ }
server.close()
try { fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }) } catch { /* sobrou o perfil temporário */ }

if (!got) fail(`o Chrome não respondeu em ${TIMEOUT_S}s`)
if (got.fatal) fail(got.fatal)
console.log(`contexto seguro: ${got.secure ? 'sim' : 'não'}; crypto.randomUUID: ${got.randomUUID ? 'existe' : 'não existe'}`)
console.log(`tela da banda no #root: ${got.mounted ? 'montada' : `não montou (#root com ${got.rootChildren} filhos)`}`)
for (const e of got.errors) console.log(`  ${e}`)
if (got.secure) fail('a página abriu em contexto seguro: a verificação não vale (o IP não é da rede local?)')
if (!got.mounted || got.errors.length > 0) fail(`${got.mounted ? '' : 'a tela da banda não montou; '}${got.errors.length} erro(s) solto(s)`)
console.log('OK: a tela da banda abre pela rede local, sem erro solto')

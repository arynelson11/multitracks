#!/usr/bin/env node
// Verificador de texto cortado e de alvos de toque do palco novo (T20), no Chrome headless.
// Uso: node scripts/verify-layout/run.mjs [--only 1280x800[,1440x900]] [--estado normal[,tom]] [--jobs 3] [--no-build]
//   sem --estado: os 11 estados normais nos 8 tamanhos (88 combinações);
//   --estado quebrado: só a prova (um botão de largura fixa com texto longo), que tem de falhar.
// Sai com código 1 se alguma combinação falhar (ou não responder). Resultados em scripts/verify-layout/results/.
import http from 'node:http'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { build } from 'vite'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const OUT = path.join(HERE, '.build')
const RES = path.join(HERE, 'results')
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'

/**
 * Tamanhos de tela do palco novo (Global Constraints do plano), mais a menor tela dele (1024x740,
 * Ruling T18-altura) e duas abaixo de 1024 px, onde o palco novo só fica tocando (a trava da R-25:
 * iPad girado ou janela estreitada; Ruling I2-estreito): ali vale "nada inalcançável", a casca rola de lado.
 */
const SIZES = ['1024x740', '1024x768', '1280x760', '1280x800', '1440x900', '1920x1080', '900x740', '810x1080']
/** Estados da rodada normal: a mesma lista de ESTADOS em fixture.ts. */
const ESTADOS = ['normal', 'contando', 'pads', 'editar', 'livre', 'selo', 'repertorio', 'tom', 'semtom', 'compasso', 'config',
  // Demais telas da Parte 3 (faixa C), a mesma lista de telasEstados.ts.
  'metronomo']
const PROVA = 'quebrado'
const TIMEOUT_S = 40
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.woff2': 'font/woff2', '.woff': 'font/woff', '.svg': 'image/svg+xml', '.png': 'image/png',
}

function usage(message) {
  console.error(message)
  console.error('uso: node scripts/verify-layout/run.mjs [--only LxA[,LxA]] [--estado nome[,nome]] [--jobs N] [--no-build]')
  process.exit(2)
}

const args = process.argv.slice(2)
const opt = (name) => {
  const i = args.indexOf(name)
  if (i < 0) return undefined
  const v = args[i + 1]
  if (!v || v.startsWith('--')) usage(`${name} precisa de um valor`)
  return v
}
const list = (v) => (v ? v.split(',').map((s) => s.trim()).filter(Boolean) : null)
const sizes = list(opt('--only')) ?? SIZES
const estados = list(opt('--estado')) ?? ESTADOS
const jobs = Math.max(1, Number(opt('--jobs') ?? 3) || 3)
for (const s of sizes) if (!/^\d{3,4}x\d{3,4}$/.test(s)) usage(`tamanho inválido: ${s}`)
for (const e of estados) if (e !== PROVA && !ESTADOS.includes(e)) usage(`estado desconhecido: ${e}`)

function serve() {
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x')
    if (req.method === 'POST' && u.pathname === '/result') {
      const name = (u.searchParams.get('name') || 'resultado').replace(/[^\w-]/g, '')
      const chunks = []
      req.on('data', (c) => chunks.push(c))
      req.on('end', () => {
        fs.mkdirSync(RES, { recursive: true })
        fs.writeFileSync(path.join(RES, `${name}.json`), Buffer.concat(chunks))
        res.end('ok')
      })
      return
    }
    if (u.pathname === '/janela') {
      // Página mínima da calibração: só diz o tamanho da área da página.
      res.setHeader('Content-Type', MIME['.html'])
      res.end('<!doctype html><script>fetch("/result?name=_janela",{method:"POST",body:JSON.stringify({w:innerWidth,h:innerHeight})})</script>')
      return
    }
    const rel = u.pathname === '/' ? 'index.html' : decodeURIComponent(u.pathname.slice(1))
    const file = path.join(OUT, rel)
    if (!file.startsWith(OUT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.statusCode = 404
      res.end()
      return
    }
    res.setHeader('Content-Type', MIME[path.extname(file)] || 'application/octet-stream')
    res.setHeader('Cache-Control', 'no-store')
    fs.createReadStream(file).pipe(res)
  })
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)))
}

/** Abre o Chrome headless na janela pedida e espera o resultado `name` (JSON) ou o tempo acabar. */
async function chromeRun(url, name, w, h) {
  const out = path.join(RES, `${name}.json`)
  fs.rmSync(out, { force: true })
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-layout-'))
  const chrome = spawn(CHROME, [
    '--headless=new', '--no-first-run', '--no-default-browser-check', '--force-device-scale-factor=1',
    `--window-size=${w},${h}`, `--user-data-dir=${profile}`, url,
  ], { stdio: 'ignore' })
  const exited = new Promise((r) => chrome.once('exit', r))
  const t0 = Date.now()
  while (!fs.existsSync(out) && Date.now() - t0 < TIMEOUT_S * 1000) await sleep(250)
  await sleep(200)
  chrome.kill('SIGTERM')
  await Promise.race([exited, sleep(2000)])
  try { chrome.kill('SIGKILL') } catch { /* já saiu */ }
  await Promise.race([exited, sleep(1000)])
  // O Chrome ainda pode estar soltando arquivos do perfil: tenta de novo e, se sobrar, o sistema limpa a pasta temporária.
  try { fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }) } catch { /* sobrou o perfil temporário */ }
  return fs.existsSync(out) ? JSON.parse(fs.readFileSync(out, 'utf8')) : null
}

/**
 * O --window-size do headless novo é o da janela, e a área da página sai menor (a moldura
 * invisível da janela fica com o resto). Mede a diferença uma vez, pra pedir a janela que dá a
 * área exata de cada tamanho; cada combinação confere a área de novo.
 */
async function calibrate(port) {
  const got = await chromeRun(`http://127.0.0.1:${port}/janela`, '_janela', 1280, 800)
  if (!got) usage('o Chrome não respondeu na calibração da janela (confira CHROME)')
  return { dw: 1280 - got.w, dh: 800 - got.h }
}

/** O Chrome headless não abre janela mais estreita que isto: abaixo, a página mede dentro de um iframe (main.tsx). */
const MIN_WINDOW_W = 500

async function runOne(port, frame, estado, size) {
  const [w, h] = size.split('x').map(Number)
  const name = `${estado}_${size}`
  const t0 = Date.now()
  const celular = w < MIN_WINDOW_W ? `&celular=${size}` : ''
  const data = await chromeRun(`http://127.0.0.1:${port}/index.html?estado=${estado}&name=${name}${celular}`, name, Math.max(w, MIN_WINDOW_W) + frame.dw, h + frame.dh)
  if (!data) return { name, estado, size, fatal: `sem resposta em ${TIMEOUT_S}s` }
  if (data.fatal) return { name, estado, size, fatal: data.fatal }
  // A janela tem de ser do tamanho pedido: senão a medida não vale pra esse tamanho.
  if (data.viewport.w !== w || data.viewport.h !== h) return { name, estado, size, fatal: `janela de ${data.viewport.w}x${data.viewport.h}, pedida ${size}` }
  return { name, estado, size, failures: data.failures, counts: data.counts, secs: ((Date.now() - t0) / 1000).toFixed(1) }
}

if (!args.includes('--no-build')) {
  process.stdout.write('montando a página... ')
  await build({ configFile: path.join(HERE, 'vite.config.ts'), logLevel: 'warn' })
  console.log('ok')
}
if (!fs.existsSync(path.join(OUT, 'index.html'))) usage('sem build em scripts/verify-layout/.build (rode sem --no-build)')

const server = await serve()
const port = server.address().port
const frame = await calibrate(port)
const combos = estados.flatMap((estado) => sizes.map((size) => ({ estado, size })))
const results = []
let next = 0
await Promise.all(Array.from({ length: Math.min(jobs, combos.length) }, async () => {
  while (next < combos.length) {
    const c = combos[next++]
    const r = await runOne(port, frame, c.estado, c.size)
    const n = r.fatal ? 'ERRO' : r.failures.length === 0 ? 'ok' : `${r.failures.length} falha(s)`
    console.log(`${c.estado} ${c.size}: ${n}${r.secs ? ` (${r.secs}s)` : ''}`)
    results.push(r)
  }
}))
server.close()

// Relatório na ordem das combinações, com seletor, texto e medidas de cada falha.
results.sort((a, b) => combos.findIndex((c) => c.estado === a.estado && c.size === a.size) - combos.findIndex((c) => c.estado === b.estado && c.size === b.size))
let failed = 0
let total = 0
const counts = { texts: 0, targets: 0, msException: 0, narrowException: 0, iconButtons: 0 }
for (const r of results) {
  if (r.fatal) {
    failed++
    console.log(`\n[ERRO] ${r.estado} ${r.size}: ${r.fatal}`)
    continue
  }
  for (const k of Object.keys(counts)) counts[k] += r.counts[k]
  if (r.failures.length === 0) continue
  failed++
  total += r.failures.length
  console.log(`\n[FALHA] ${r.estado} ${r.size}: ${r.failures.length}`)
  for (const f of r.failures) console.log(`  (${f.kind}) ${f.selector}${f.text ? ` "${f.text}"` : ''}\n      ${f.detail}`)
}
console.log(`\n${results.length} combinações: ${results.length - failed} ok, ${failed} com falha (${total} falhas).`)
console.log(`Medidos: ${counts.texts} textos, ${counts.iconButtons} botões só de ícone e ${counts.targets} alvos de toque; exceções aceitas: ${counts.msException} M/S (32x30) e ${counts.narrowException} blocos estreitos da onda.`)
process.exit(failed === 0 ? 0 : 1)

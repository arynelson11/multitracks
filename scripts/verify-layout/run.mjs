#!/usr/bin/env node
// Verificador de texto cortado e de alvos de toque do palco novo (T20), no Chrome headless.
// Uso: node scripts/verify-layout/run.mjs [--only 1280x800[,1440x900]] [--estado normal[,tom]] [--jobs 3] [--no-build]
//   sem --estado: os 12 estados normais e 18 dos 19 estados da faixa C nos 8 tamanhos (240 combinações),
//   17 estados em 390x844 (o inicio da frente 1b, os 15 da faixa C que abrem no celular e o
//   download-celular, só de celular) e os 10 estados da faixa B (login e Configurações) em 1024x740,
//   1280x800, 1920x1080, 390x844 e 844x390 (50); com a faixa D (gaveta e janela de publicar do palco nos
//   8, páginas do Separador em 5 tamanhos e as janelas dele em 2): 360; com a tela inicial com o anúncio
//   (8 e 390x844), a Biblioteca (2 estados em 5 tamanhos, JANELAS_INICIO): 379 combinações;
//   --estado quebrado: só a prova (um botão de largura fixa com texto longo), que tem de falhar
//   (com --only 390x844, a prova da moldura do celular).
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
const ESTADOS = ['normal', 'contando', 'pads', 'editar', 'livre', 'selo', 'repertorio', 'tom', 'semtom', 'compasso', 'config', 'inicio', 'inicio-anuncio',
  // Gaveta SEPARAÇÃO do palco (Parte 3, faixa D), nos 8 tamanhos do palco.
  'separacao', 'separacao-voz', 'separacao-bpm', 'separacao-publicar',
  // Demais telas da Parte 3 (faixa C), a mesma lista de telasEstados.ts.
  'metronomo', 'padsnuvem', 'padsnuvem-editar', 'letra', 'cifra', 'teleprompter', 'teleprompter-vazio', 'novidades', 'atualizacao', 'atualizacao-web', 'tour', 'tour-centro', 'download', 'download-ajuda', 'download-celular', 'aovivo', 'aovivo-cheio', 'aovivo-erro', 'adminlogin',
  // Separador (Parte 3, faixa D), a mesma lista de telasEstados.ts.
  'separador-inicio', 'separador-opcoes', 'separador-player', 'separador-bpm', 'separador-voz', 'separador-publicar',
  // Biblioteca na Nuvem (Parte 3, partes 3 a 5), a mesma lista de telasEstados.ts.
  'biblioteca', 'biblioteca-editar']
/**
 * Telas da faixa C que abrem no celular: sem --only, medem também em 390x844. O Modo Ao Vivo do host
 * só existe no computador, então fica de fora.
 */
const TELAS_C_CELULAR = ['metronomo', 'padsnuvem', 'padsnuvem-editar', 'letra', 'cifra', 'teleprompter', 'teleprompter-vazio', 'novidades', 'atualizacao', 'atualizacao-web', 'tour', 'tour-centro', 'download', 'download-ajuda', 'adminlogin']
/**
 * Estados que abrem no celular: a tela inicial (`inicio`) e ela com o cartão do anúncio da casa
 * (`inicio-anuncio`). Sem --only, medem também em 390x844, pela mesma moldura das faixas B e C.
 */
const ESTADOS_CELULAR = ['inicio', 'inicio-anuncio']
/** Telas da faixa C que só existem no celular (navegador de celular simulado): só em 390x844. */
const TELAS_C_SO_CELULAR = ['download-celular']
/**
 * Telas da faixa B da Parte 3 (login e Configurações, telasB.ts), fora do palco: sem --estado
 * entram na rodada normal, nos tamanhos de TELAS_B_SIZES (abrem no celular, então 390x844 entra).
 */
const ESTADOS_B = ['login', 'criarconta', 'recuperar', 'novasenha', 'config-perfil', 'config-geral', 'config-buses', 'config-novidades', 'config-assinatura', 'config-sobre']
// 844x390: celular deitado, onde as Configurações cortavam o fim de cada aba (revisão macro BC, BC1-M6).
const TELAS_B_SIZES = ['1024x740', '1280x800', '1920x1080', '390x844', '844x390']
/**
 * Páginas do Separador (Parte 3, faixa D): abrem em qualquer tela, celular incluído, então medem
 * em 1024x740, 1280x800, 1920x1080, 390x844 e 844x390 (celular deitado, onde a faixa do player é baixa).
 */
const PAGINAS_SEPARADOR = ['separador-inicio', 'separador-opcoes', 'separador-player']
const PAGINAS_SEPARADOR_SIZES = ['1024x740', '1280x800', '1920x1080', '390x844', '844x390']
/**
 * As janelas do Separador de reserva (BPM e click, Voz Guia e Publicar, revisão sep-2 I5): abertas
 * uma por vez por cima do player, no celular em pé e na menor tela do palco.
 */
const JANELAS_SEPARADOR = ['separador-bpm', 'separador-voz', 'separador-publicar']
const JANELAS_SEPARADOR_SIZES = ['390x844', '1024x740']
/**
 * Janelas do começo do app (Parte 3, partes 3 a 5: Biblioteca e Planos): abrem em qualquer tela,
 * nos dois palcos e no celular, então medem em 1024x740, 1280x800, 1920x1080, 390x844 e 844x390
 * (celular deitado, onde a janela fica baixa e a lista rola dentro).
 */
const JANELAS_INICIO = ['biblioteca', 'biblioteca-editar']
const JANELAS_INICIO_SIZES = ['1024x740', '1280x800', '1920x1080', '390x844', '844x390']
/** Largura de celular: abaixo da janela mínima do Chrome headless, roda na moldura (/moldura). */
const CELULAR = '390x844'
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
const onlySizes = list(opt('--only'))
const sizes = onlySizes ?? SIZES
const estados = list(opt('--estado')) ?? [...ESTADOS, ...ESTADOS_B]
const jobs = Math.max(1, Number(opt('--jobs') ?? 3) || 3)
for (const s of sizes) if (!/^\d{3,4}x\d{3,4}$/.test(s)) usage(`tamanho inválido: ${s}`)
for (const e of estados) if (e !== PROVA && !ESTADOS.includes(e) && !ESTADOS_B.includes(e)) usage(`estado desconhecido: ${e}`)

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
    if (u.pathname === '/moldura') {
      // Celular (abaixo da largura mínima da janela do Chrome headless, 500 px): a página roda num
      // iframe do tamanho pedido, que vira a janela dela (innerWidth, media queries e a medida).
      const w = Number(u.searchParams.get('w')) || 390
      const h = Number(u.searchParams.get('h')) || 844
      const q = (u.searchParams.get('q') || '').replace(/[^\w=&%.-]/g, '')
      res.setHeader('Content-Type', MIME['.html'])
      res.end(`<!doctype html><style>html,body{margin:0;background:#000;overflow:hidden}iframe{border:0;display:block}</style><iframe src="index.html?${q}" width="${w}" height="${h}"></iframe>`)
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

/** Largura mínima da janela do Chrome headless: abaixo dela a página roda num iframe (/moldura). */
const MIN_WINDOW_W = 500

async function runOne(port, frame, estado, size) {
  const [w, h] = size.split('x').map(Number)
  const name = `${estado}_${size}`
  const t0 = Date.now()
  const query = `estado=${estado}&name=${name}`
  const url = w < MIN_WINDOW_W
    ? `http://127.0.0.1:${port}/moldura?w=${w}&h=${h}&q=${encodeURIComponent(query)}`
    : `http://127.0.0.1:${port}/index.html?${query}`
  const data = await chromeRun(url, name, Math.max(w, MIN_WINDOW_W) + frame.dw, h + frame.dh)
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
// As telas da faixa B usam os tamanhos delas (com o celular) e as da faixa C e o inicio da 1b, que
// abrem no celular, ganham o 390x844 além dos 8, salvo quando --only diz outros.
const sizesFor = (estado) => {
  if (onlySizes) return sizes
  if (ESTADOS_B.includes(estado)) return TELAS_B_SIZES
  if (PAGINAS_SEPARADOR.includes(estado)) return PAGINAS_SEPARADOR_SIZES
  if (JANELAS_SEPARADOR.includes(estado)) return JANELAS_SEPARADOR_SIZES
  if (JANELAS_INICIO.includes(estado)) return JANELAS_INICIO_SIZES
  if (TELAS_C_SO_CELULAR.includes(estado)) return [CELULAR]
  if (TELAS_C_CELULAR.includes(estado) || ESTADOS_CELULAR.includes(estado)) return [...SIZES, CELULAR]
  return SIZES
}
const combos = estados.flatMap((estado) => sizesFor(estado).map((size) => ({ estado, size })))
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

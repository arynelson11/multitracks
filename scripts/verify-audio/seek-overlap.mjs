#!/usr/bin/env node
// Verificação no Chrome da busca, das voltas do LOOP do palco antigo (que passam pela mesma busca)
// e da "próxima" no motor (Rulings I2-proxima e I4-busca, Ruling ÁUDIO): o hook REAL
// useAudioEngine (esbuild, o que já vem com o Vite) no palco antigo, com o AudioContext dele
// trocado por um OfflineAudioContext do mesmo Chrome (cada ação roda num suspend, com o relógio
// parado; a saída é a renderização amostra a amostra, como nas medidas da T7, T17, T26 e T28). O
// relógio de tempo real do Chrome headless ficou parado nesta máquina na onda da v1.4.20
// (currentTime em 0,005 s por 60 s numa página vazia), por isso o offline. "Tudo junto" com os
// knobs separando a posição velha (saída 1) da nova (saída 2). Mede:
//   - busca tocando de 18 s pra 2 s: por quanto tempo a voz velha fica em ganho 1 (e acima da
//     metade) por cima da nova, o tempo de reação e o degrau da soltura;
//   - busca saindo dos últimos 5 s com o FADE: se o rabo da posição velha sobe (+8 dB antes);
//   - "próxima" tocando: se a música velha volta a soar mais alta depois do fade de 1,5 s;
//   - a volta do principal pro volume sem degrau.
// O motor lê o baseLatency do Chrome de tempo real desta máquina (0,0053 s); com --baseLatency
// 0.012, o do aparelho de buffer grande (Windows, placa com 10 ms). --sem-hold tira o
// cancelAndHoldAtTime (o caminho do Firefox).
//
// Uso: source ~/.nvm/nvm.sh && nvm use 24
//      node scripts/verify-audio/seek-overlap.mjs                        # código atual
//      node scripts/verify-audio/seek-overlap.mjs --baseLatency 0.012    # latência grande simulada
//      node scripts/verify-audio/seek-overlap.mjs --sem-hold             # sem cancelAndHoldAtTime
//      node scripts/verify-audio/seek-overlap.mjs --rev 1c46e1f          # o src/ de um commit (o "antes")
// Outro Chrome: CHROME=/caminho/do/chrome. Sai com 1 se um critério falhar. JSON em results/.
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync, spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { build as esbuild } from 'esbuild'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '../..')
const OUT = path.join(HERE, '.build')
const RES = path.join(HERE, 'results')
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const TIMEOUT_S = 120
// A posição velha sai em 0,5 x principal: degrau de 0,005 por amostra = 0,01 no principal.
const DC = 0.5
const STEP_MAX = 0.01 * DC
// Ruling T26-busca: sobreposição aceita da voz velha em ganho 1 com a nova.
const OVERLAP_MAX_MS = 6.4
// Medida a 1 amostra (~0,02 ms) e o "ganho 1" com 1% de folga.
const OVERLAP_EPS_MS = 0.1

const args = process.argv.slice(2)
const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined }
const rev = opt('--rev')
const baseLatency = opt('--baseLatency')
const semHold = args.includes('--sem-hold')
const vezes = Math.max(1, Number(opt('--vezes') ?? 1) || 1) // o offline é determinístico; serve pra conferir

function srcRoot() {
  if (!rev) return path.join(ROOT, 'src')
  const sha = execFileSync('git', ['rev-parse', '--short', rev], { cwd: ROOT }).toString().trim()
  const base = path.join(OUT, `rev-${sha}`)
  fs.rmSync(base, { recursive: true, force: true })
  fs.mkdirSync(base, { recursive: true })
  const tar = execFileSync('git', ['archive', '--format=tar', sha, 'src'], { cwd: ROOT, maxBuffer: 1 << 28 })
  execFileSync('tar', ['-x', '-C', base], { input: tar })
  return path.join(base, 'src')
}

// O motor importa o Worker da grade pelo `?worker&inline` do Vite: aqui ele vira um Worker que não
// nasce (o motor segue sem ler grade, como sem Worker; esta medida não usa grade).
const workerStub = {
  name: 'worker-inline-stub',
  setup(b) {
    b.onResolve({ filter: /\?worker&inline$/ }, (a) => ({ path: a.path, namespace: 'worker-stub' }))
    b.onLoad({ filter: /.*/, namespace: 'worker-stub' }, () => ({ contents: 'export default function NoWorker() { throw new Error("sem Worker nesta medida") }', loader: 'js' }))
  },
}

async function bundle() {
  await esbuild({
    entryPoints: [path.join(HERE, 'www/seek-overlap.page.js')],
    outfile: path.join(OUT, 'seek-overlap.bundle.js'),
    bundle: true,
    format: 'esm',
    platform: 'browser',
    target: 'es2022',
    jsx: 'automatic',
    sourcemap: false,
    nodePaths: [path.join(ROOT, 'node_modules')],
    logLevel: 'warning',
    alias: { '@src': srcRoot() },
    plugins: [workerStub],
    define: { 'import.meta.env': '{"DEV":false,"PROD":true,"MODE":"verify"}' },
  })
}

const MIME = { '.html': 'text/html', '.js': 'text/javascript' }
function serve() {
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x')
    if (req.method === 'POST' && u.pathname === '/result') {
      const name = (u.searchParams.get('name') || 'out').replace(/[^\w.-]/g, '')
      const chunks = []
      req.on('data', (c) => chunks.push(c))
      req.on('end', () => {
        fs.mkdirSync(RES, { recursive: true })
        fs.writeFileSync(path.join(RES, name + '.json'), Buffer.concat(chunks))
        res.end('ok')
      })
      return
    }
    const rel = u.pathname.startsWith('/.build/') ? u.pathname.slice(1) : path.join('www', u.pathname)
    const file = path.join(HERE, rel)
    if (!file.startsWith(HERE) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.statusCode = 404; res.end(); return }
    res.setHeader('Content-Type', MIME[path.extname(file)] || 'application/octet-stream')
    res.setHeader('Cache-Control', 'no-store')
    fs.createReadStream(file).pipe(res)
  })
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)))
}

async function runChrome(server, name) {
  const out = path.join(RES, name + '.json')
  fs.rmSync(out, { force: true })
  const profile = path.join(HERE, `chrome-profile-${name}`)
  fs.rmSync(profile, { recursive: true, force: true })
  const q = `name=${name}${baseLatency ? '&baseLatency=' + baseLatency : ''}${semHold ? '&semHold=1' : ''}`
  const url = `http://127.0.0.1:${server.address().port}/seek-overlap.html?${q}`
  const chrome = spawn(CHROME, ['--headless=new', '--no-first-run', '--no-default-browser-check', '--autoplay-policy=no-user-gesture-required', '--mute-audio', `--user-data-dir=${profile}`, url], { stdio: 'ignore' })
  const t0 = Date.now()
  while (!fs.existsSync(out) && Date.now() - t0 < TIMEOUT_S * 1000) await new Promise((r) => setTimeout(r, 300))
  await new Promise((r) => setTimeout(r, 300))
  chrome.kill('SIGTERM')
  await new Promise((r) => setTimeout(r, 800))
  try { chrome.kill('SIGKILL') } catch { /* já saiu */ }
  fs.rmSync(profile, { recursive: true, force: true })
  if (!fs.existsSync(out)) return { fatal: `sem resultado em ${TIMEOUT_S}s` }
  return JSON.parse(fs.readFileSync(out, 'utf8'))
}

const f = (v, d = 4) => (typeof v === 'number' ? v.toFixed(d) : String(v))
const db = (a, b) => (a > 0 && b > 0 ? 20 * Math.log10(a / b) : NaN)
const stats = (v) => { const s = v.filter((x) => typeof x === 'number').sort((a, b) => a - b); return s.length ? { min: s[0], med: s[Math.floor(s.length / 2)], max: s[s.length - 1] } : null }

function report(r) {
  if (r.fatal) { console.log('ERRO na página:', r.fatal); return false }
  const full = stats(r.seeks.map((s) => s.overlapFullMs))
  const half = stats(r.seeks.map((s) => s.overlapHalfMs))
  const reaction = stats(r.seeks.map((s) => s.reactionMs))
  const step = Math.max(...r.seeks.map((s) => s.oldStep))
  const oldOver = Math.max(...r.seeks.map((s) => s.oldMax / s.before))
  console.log(r.userAgent)
  console.log(`OfflineAudioContext a ${r.sampleRate} Hz; baseLatency que o motor lê ${f(r.baseLatency)} s; saída ${r.outputs}${r.semHold ? '; sem cancelAndHoldAtTime' : ''}`)
  const bad = r.steps.filter((s) => s.error)
  if (bad.length) console.log('passos com erro:', JSON.stringify(bad))
  console.log(`busca x${r.seeks.length}: voz velha em ganho 1 por cima da nova ${f(full?.min, 2)} a ${f(full?.max, 2)} ms (mediana ${f(full?.med, 2)}); acima da metade ${f(half?.min, 2)} a ${f(half?.max, 2)} ms; reação ${f(reaction?.min, 2)} a ${f(reaction?.max, 2)} ms`)
  console.log(`busca saindo do FADE: antes ${f(r.fade.before)}, máximo da posição velha depois ${f(r.fade.oldMax)} (${f(db(r.fade.oldMax, r.fade.before), 2)} dB); degrau ${f(r.fade.oldStep, 5)}`)
  console.log(`próxima: antes ${f(r.next.beforeNext)}, fim do fade ${f(r.next.endOfFade)}, máximo da música velha depois ${f(r.next.oldMaxAfter)} (${f(db(r.next.oldMaxAfter, r.next.endOfFade), 2)} dB); degrau ${f(r.next.oldStep, 5)}; música nova assentada ${f(r.next.newSettled)}`)
  const checks = [
    ['saídas em "Tudo junto" (knobs separando velha e nova)', r.outputs === 'stereo', r.outputs],
    [`busca: voz velha em ganho 1 por cima da nova <= ${OVERLAP_MAX_MS} ms em todas`, !!full && full.max <= OVERLAP_MAX_MS + OVERLAP_EPS_MS, `máximo ${f(full?.max, 2)} ms`],
    ['busca: a posição velha nunca sobe e desce sem degrau (0,01 no principal)', oldOver <= 1.01 && step <= STEP_MAX, `máximo/antes ${f(oldOver)}; degrau ${f(step, 5)}`],
    ['busca saindo do FADE: o rabo da posição velha não sobe (+0,1 dB no máximo)', r.fade.oldMax <= r.fade.before * 1.0116 && r.fade.oldStep <= STEP_MAX, `${f(db(r.fade.oldMax, r.fade.before), 2)} dB; degrau ${f(r.fade.oldStep, 5)}`],
    ['próxima: a música velha não volta mais alta que no fim do fade (+0,1 dB)', r.next.oldMaxAfter !== null && r.next.oldMaxAfter <= r.next.endOfFade * 1.0116 + 1e-4, `${f(db(r.next.oldMaxAfter, r.next.endOfFade), 2)} dB`],
    ['próxima: a música nova chega no volume', r.next.newSettled !== null && Math.abs(r.next.newSettled - DC) < 0.01, f(r.next.newSettled)],
    ['busca: a posição nova chega no nível', r.seeks.every((s) => Math.abs(s.newAfter - DC) < 0.01), r.seeks.map((s) => f(s.newAfter)).join(', ')],
    ['busca e próxima: a volta do principal pro volume sem degrau (0,01 no principal)', [...r.seeks, r.fade, r.next].every((s) => s.newStep !== null && s.newStep <= STEP_MAX), [...r.seeks, r.fade, r.next].map((s) => f(s.newStep, 5)).join(', ')],
    ['roteiro inteiro sem erro', r.steps.length === 14 && r.steps.every((s) => !s.error), `${r.steps.length} passos`],
  ]
  let ok = true
  for (const [name, pass, detail] of checks) { ok &&= !!pass; console.log(`${pass ? 'OK   ' : 'FALHA'} ${name}: ${detail}`) }
  return ok
}

await bundle()
if (rev) console.log('src/ do commit', rev)
const server = await serve()
let ok = true
for (let k = 0; k < vezes; k++) {
  if (vezes > 1) console.log(`--- rodada ${k + 1} de ${vezes} ---`)
  const tag = `${rev ? '_' + rev : ''}${baseLatency ? '_bl' + baseLatency : ''}${semHold ? '_semhold' : ''}${vezes > 1 ? '-' + (k + 1) : ''}`
  const r = await runChrome(server, `seek-overlap${tag}`)
  ok = report(r) && ok
}
server.close()
process.exit(ok ? 0 : 1)

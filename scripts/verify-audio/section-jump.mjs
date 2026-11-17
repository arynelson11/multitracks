#!/usr/bin/env node
// Verificação no Chrome real do pulo de seção e do FADE do motor (T28, Ruling ÁUDIO): o hook
// REAL useAudioEngine (esbuild, o que já vem com o Vite) montado com stageMode 'novo' numa página,
// tocando em tempo real no Chrome headless. "Click e Guia separados", Click mudo e o Baixo em nível
// constante 0,5 na VS: qualquer degrau na saída da VS é das automações (envelopes das vozes e
// principal), gravada amostra a amostra por um AudioWorklet. Mede: o cruzamento no 1 (soma dos
// envelopes 1, sem o pico de uma amostra da voz nova), a pausa no meio da contagem, o FADE
// agendado, o principal segurado com pulo armado e a volta no 1, o volume mexido e ARRASTADO
// (um evento a cada 16 ms) com o FADE marcado, longe e no meio da rampa, a saída do FADE seguida
// de volume em menos de 50 ms e a volta pro FADE tocando. Critério de degrau: 0,01 por amostra no
// principal (0,005 na VS, que é o Baixo a 0,5). Controle: a voz nova do play, que entra sem rampa
// (T26), tem de ser acusada. Existe porque o fake dos testes não reproduz o navegador.
//
// Uso: source ~/.nvm/nvm.sh && nvm use 24
//      node scripts/verify-audio/section-jump.mjs               # código atual
//      node scripts/verify-audio/section-jump.mjs --sem-hold    # sem cancelAndHoldAtTime (Firefox)
//      node scripts/verify-audio/section-jump.mjs --rev 967aaad # o src/ de um commit (o "antes")
//      node scripts/verify-audio/section-jump.mjs --vezes 4     # repete (o pico do cruzamento era intermitente)
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
// Degrau por amostra no principal; na VS o Baixo está a 0,5.
const STEP_MAX = 0.01
const DC = 0.5

const args = process.argv.slice(2)
const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined }
const rev = opt('--rev')
const semHold = args.includes('--sem-hold')
const vezes = Math.max(1, Number(opt('--vezes') ?? 1) || 1)

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

async function bundle() {
  await esbuild({
    entryPoints: [path.join(HERE, 'www/section-jump.page.js')],
    outfile: path.join(OUT, 'section-jump.bundle.js'),
    bundle: true,
    format: 'esm',
    platform: 'browser',
    target: 'es2022',
    jsx: 'automatic',
    sourcemap: false,
    nodePaths: [path.join(ROOT, 'node_modules')],
    logLevel: 'warning',
    alias: { '@src': srcRoot() },
    define: { 'import.meta.env': '{"DEV":false,"PROD":true,"MODE":"verify"}' },
  })
}

const MIME = { '.html': 'text/html', '.js': 'text/javascript' }
function serve() {
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x')
    if (req.method === 'POST' && u.pathname === '/result') {
      const name = (u.searchParams.get('name') || 'out').replace(/[^\w-]/g, '')
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
  const url = `http://127.0.0.1:${server.address().port}/section-jump.html?name=${name}${semHold ? '&semHold=1' : ''}`
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

const f = (v) => (typeof v === 'number' ? v.toFixed(5) : String(v))
const near = (a, b, tol) => typeof a === 'number' && typeof b === 'number' && Math.abs(a - b) <= tol
// Degrau na VS convertido pro principal (a VS é o Baixo a 0,5).
const onMaster = (step) => step / DC

function report(r) {
  if (r.fatal) { console.log('ERRO na página:', r.fatal); return false }
  const vs = STEP_MAX * DC
  const checks = [
    ['saídas em "Click e Guia separados"', r.outputs === 'split2', r.outputs],
    ['cruzamento no 1: sem degrau e VS em 0,5 (soma dos envelopes 1)', r.ev.T1committed && r.cross.step <= vs && r.cross.lo > DC - 0.01 && r.cross.hi < DC + 0.01, `T1 ${f(r.ev.T1)}; degrau ${f(onMaster(r.cross.step))} em ${f(r.cross.at)}; VS ${f(r.cross.lo)} a ${f(r.cross.hi)}`],
    ['pausa no meio da contagem: sem degrau e silêncio 100 ms depois', r.pause1.step <= vs && r.pause1.after < 1e-3, `degrau ${f(onMaster(r.pause1.step))}; depois ${f(r.pause1.after)}`],
    ['controle: a voz nova do play entra sem rampa (a medida acusa)', r.play1.control > 0.3, `degrau na VS ${f(r.play1.control)} em ${f(r.play1.onset)}`],
    ['FADE agendado: rampa linear de 0,8 até 0, desvio <= 0,005', r.fade1.dev <= 0.005 && r.fade1.step <= vs, `desvio ${f(r.fade1.dev)}; degrau ${f(onMaster(r.fade1.step))}`],
    ['armou no meio do FADE: segura sem degrau no nível de agora', r.hold.step <= vs && near(r.hold.lo, r.hold.expected, 0.01) && r.hold.hi - r.hold.lo < 0.002, `degrau ${f(onMaster(r.hold.step))}; ${f(r.hold.lo)} a ${f(r.hold.hi)} (~${f(r.hold.expected)})`],
    ['pulo marcado devolve o principal no 1 sem degrau', r.ev.T3committed && r.restore.step <= vs && near(r.restore.after, DC, 0.01), `T3 ${f(r.ev.T3)}; degrau ${f(onMaster(r.restore.step))}; VS depois ${f(r.restore.after)}`],
    ['volume mexido no meio do FADE: segue a curva com o volume novo', r.vol.step <= vs && near(r.vol.before, r.vol.wantBefore, 0.01) && near(r.vol.after, r.vol.wantAfter, 0.01), `degrau ${f(onMaster(r.vol.step))}; antes ${f(r.vol.before)} (~${f(r.vol.wantBefore)}), depois ${f(r.vol.after)} (~${f(r.vol.wantAfter)})`],
    ['volume ARRASTADO no meio do FADE (16 ms por evento): liso', r.dragFade.step <= vs && near(r.dragFade.after, r.dragFade.want, 0.01), `degrau ${f(onMaster(r.dragFade.step))} em ${f(r.dragFade.at)}; depois ${f(r.dragFade.after)} (~${f(r.dragFade.want)})`],
    ['saiu do FADE e mexeu no volume 20 ms depois: liso e o volume novo vale', r.drop.step <= vs && near(r.drop.after, r.drop.want, 0.005), `degrau ${f(onMaster(r.drop.step))}; depois ${f(r.drop.after)} (~${f(r.drop.want)})`],
    ['voltou pro FADE tocando: parte do nível de agora', r.refade.step <= vs && near(r.refade.before, DC * 0.6, 0.005) && r.refade.after < r.refade.before, `degrau ${f(onMaster(r.refade.step))}; ${f(r.refade.before)} para ${f(r.refade.after)}`],
    ['volume ARRASTADO com o FADE longe: liso', r.dragFar.step <= vs && near(r.dragFar.after, r.dragFar.want, 0.005), `degrau ${f(onMaster(r.dragFar.step))} em ${f(r.dragFar.at)}; depois ${f(r.dragFar.after)} (~${f(r.dragFar.want)})`],
    ['pausa no fim: sem degrau', r.pause2.step <= vs && r.pause2.after < 1e-3, `degrau ${f(onMaster(r.pause2.step))}; depois ${f(r.pause2.after)}`],
  ]
  console.log(r.userAgent, r.semHold ? '(sem cancelAndHoldAtTime)' : '')
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
  const r = await runChrome(server, `section-jump${semHold ? '-sem-hold' : ''}${vezes > 1 ? '-' + (k + 1) : ''}`)
  ok = report(r) && ok
}
server.close()
process.exit(ok ? 0 : 1)

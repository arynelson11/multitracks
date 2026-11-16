#!/usr/bin/env node
// Verificação no Chrome real do agendador do pulo de seção (T17, Ruling ÁUDIO): agendar, cancelar,
// trocar o alvo e o reset rodam o src/audio/sectionScheduler.ts de verdade (esbuild, o que já vem
// com o Vite) num OfflineAudioContext do Chrome headless, com o tique dentro de ctx.suspend(t).
// Mede: bipes nos tempos certos e com o acento; guia calada do 1º bipe ao 1 (mais a latência da
// entrada); a música no alvo depois do 1 e a soma das vozes igual a 1 o tempo todo (cruzamento sem
// buraco); cancelar ou trocar pro loop em cada instante entre agendar e a guarda (a cada 2 a 9
// quanta, a 48 e a 44,1 kHz, com e sem cancelAndHoldAtTime): contagem e guia sem degrau (<= 0,01
// por amostra), contagem muda depois da janela, guia de volta em 1 em 10 ms, música sem pulo.
// Controles negativos: a medida acusa o degrau do texto literal do brief (set 1 no cancel) e da
// rampa sem o set fora da rampa. Existe porque o fake dos testes não reproduz o navegador.
//
// Uso: source ~/.nvm/nvm.sh && nvm use 24
//      node scripts/verify-audio/section-scheduler.mjs
// Outro Chrome: CHROME=/caminho/do/chrome. Sai com 1 se um critério falhar. JSON em results/.
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { build as esbuild } from 'esbuild'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '../..')
const OUT = path.join(HERE, '.build')
const RES = path.join(HERE, 'results')
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const TIMEOUT_S = 900

async function bundle() {
  const src = path.join(ROOT, 'src')
  await esbuild({
    entryPoints: [path.join(HERE, 'www/section-scheduler.page.js')],
    outfile: path.join(OUT, 'section-scheduler.bundle.js'),
    bundle: true,
    format: 'esm',
    platform: 'browser',
    target: 'es2022',
    sourcemap: false,
    logLevel: 'warning',
    plugins: [{
      name: 'src-da-t17',
      setup(b) { b.onResolve({ filter: /^@t17\/\w+$/ }, (a) => ({ path: path.join(src, 'audio', a.path.slice(5) + '.ts') })) },
    }],
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
  const url = `http://127.0.0.1:${server.address().port}/section-scheduler.html?name=${name}`
  const chrome = spawn(CHROME, ['--headless=new', '--no-first-run', '--no-default-browser-check', '--mute-audio', `--user-data-dir=${profile}`, url], { stdio: 'ignore' })
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

const f = (v) => (typeof v === 'number' ? (Math.abs(v) < 1e-3 && v !== 0 ? v.toExponential(1) : v.toFixed(4)) : String(v))
function report(data) {
  if (data.fatal) { console.log('ERRO na página:', data.fatal); return false }
  console.log(data.userAgent)
  console.log('critérios:', JSON.stringify(data.criteria))
  let ok = true
  for (const c of data.cases) {
    ok &&= c.ok
    const extra = c.onsets ? ` bipes em ${c.onsets.map((t) => t.toFixed(5)).join(' ')};` : ''
    const guia = c.guideDev !== undefined ? ` guia desvio ${f(c.guideDev)}${c.guideStep !== undefined ? `, degrau ${f(c.guideStep)}` : ''};` : ''
    console.log(`${c.ok ? 'OK   ' : 'FALHA'} ${c.name}:${extra}${guia} música antes ${f(c.pos.before)} depois ${f(c.pos.after)}; soma das vozes ${f(c.dc.worst)}; pousos ${JSON.stringify(c.landed)}${c.error ? ' ERRO ' + c.error : ''}`)
  }
  for (const s of data.sweeps) {
    ok &&= s.ok
    const w = s.worst
    console.log(`${s.ok ? 'OK   ' : 'FALHA'} ${s.name}: ${s.count} instantes, ${s.badCount} ruins; pior degrau contagem ${f(w.countStep)}, cauda ${f(w.countTail)}, degrau guia ${f(w.guideStep)}, guia fora de 1 ${f(w.guideBack)}, música ${f(w.pos)}, soma ${f(w.dc)}`)
    for (const b of s.bad) console.log('      ruim em', b.now.toFixed(5), JSON.stringify(b))
    if (s.badCount > s.bad.length) console.log(`      (mais ${s.badCount - s.bad.length})`)
  }
  for (const c of data.controls) {
    ok &&= c.caught
    console.log(`${c.caught ? 'OK   ' : 'FALHA'} controle negativo, ${c.name}: degrau ${f(c.step)} (a medida tem de acusar > ${data.criteria.STEP_MAX})`)
  }
  return ok
}

await bundle()
const server = await serve()
const name = 'section-scheduler'
const t0 = Date.now()
const data = await runChrome(server, name)
server.close()
console.log(`tempo: ${((Date.now() - t0) / 1000).toFixed(1)} s`)
process.exit(report(data) ? 0 : 1)

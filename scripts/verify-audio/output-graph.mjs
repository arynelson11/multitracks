#!/usr/bin/env node
// Verificação no Chrome real dos barramentos por papel e do roteador de saídas (T12; R-24;
// Ruling T12/T25 a). Empacota o src/audio/outputGraph.ts de verdade (com o planOutputs, o
// effectivePan e o scheduleCount reais; esbuild, o que já vem com o Vite), renderiza num
// OfflineAudioContext do Chrome headless e mede o som em cada saída:
// A) vazamento: em "Click e Guia separados" (ouvido na 1 e na 2) e em "4 ou mais" (8 e 3
//    canais), Click, Guia (mono e estéreo, com o pan do canal certo e errado) e a contagem
//    sem canal de click: o pico na saída da VS tem de ficar abaixo de -90 dBFS;
// B) nível (R-24): cada saída comparada com o grafo da v1.4.15 (pan automático em separados e
//    no ouvido do "4 ou mais"; knob em "Tudo junto" e na VS do "4 ou mais"): erro <= 0,1 dB;
// C) troca de rota com apply() no meio do som (pans dos canais sem mudar): depois da troca,
//    nada de Click, Guia ou contagem na VS do plano novo (< -90 dBFS) e o ouvido com som;
// D) medidor: levels() lê o pico das saídas 1 e 2 (erro < 0,02);
// E) contagem (mono) no mesmo nível no ouvido sozinha ou com um canal estéreo no barramento do
//    Click (erro <= 0,1 dB e diferença por amostra < 1e-6);
// F) aparelho de 1 canal (Ruling T12-mono): "Tudo junto" e separados montam e trocam sem lançar,
//    e Click, Guia e VS saem no canal único com (L + R) / 2 (diferença por amostra < 1e-6).
//
// Uso: source ~/.nvm/nvm.sh && nvm use 24
//      node scripts/verify-audio/output-graph.mjs
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
const MAX_LEAK_DB = -90
const MAX_LEVEL_ERROR_DB = 0.1
const MIN_EAR_DB = -30
const MAX_METER_ERROR = 0.02
const MAX_COUNT_DIFF = 1e-6
const TIMEOUT_S = 180

async function bundle() {
  const src = path.join(ROOT, 'src')
  const alias = { '@t12/outputGraph': 'audio/outputGraph.ts', '@t12/outputPlan': 'lib/outputPlan.ts', '@t12/countTones': 'audio/countTones.ts' }
  await esbuild({
    entryPoints: [path.join(HERE, 'www/output-graph.page.js')],
    outfile: path.join(OUT, 'output-graph.bundle.js'),
    bundle: true,
    format: 'esm',
    platform: 'browser',
    target: 'es2022',
    sourcemap: false,
    logLevel: 'warning',
    plugins: [{
      name: 'src-da-t12',
      setup(b) { b.onResolve({ filter: /^@t12\// }, (a) => ({ path: path.join(src, alias[a.path]) })) },
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
  const url = `http://127.0.0.1:${server.address().port}/output-graph.html?name=${name}`
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

const num = (v) => (v === '-inf' ? -Infinity : v === 'inf' ? Infinity : v)
const fmtDb = (v) => (num(v) === -Infinity ? '-inf' : `${num(v).toFixed(1)}`)
const who = (s) => (s.kind === 'count' ? 'contagem' : `${s.role === 'click' ? 'Click' : 'Guia'} ${s.mono ? 'mono' : 'estéreo'} pan ${s.pan}`)

function report(data) {
  if (data.fatal) { console.log('ERRO na página:', data.fatal); return false }
  console.log(data.userAgent)
  let ok = true

  const leakBad = data.leaks.filter((r) => !(num(r.vsPeakDb) < MAX_LEAK_DB))
  const leakWorst = data.leaks.reduce((a, r) => (num(r.vsPeakDb) > num(a.vsPeakDb) ? r : a), data.leaks[0])
  const earQuiet = data.leaks.filter((r) => r.ear.some((e) => !(num(e.peakDb) > MIN_EAR_DB)))
  ok &&= leakBad.length === 0 && earQuiet.length === 0
  console.log(`${leakBad.length || earQuiet.length ? 'FALHA' : 'OK  '} A) vazamento pra VS: ${data.leaks.length} casos, pior pico na saída da VS ${fmtDb(leakWorst.vsPeakDb)} dBFS (${leakWorst.plan}, ${leakWorst.sources.map(who).join(' + ')}); critério < ${MAX_LEAK_DB} dBFS; ${earQuiet.length} casos com o ouvido abaixo de ${MIN_EAR_DB} dBFS`)
  for (const r of leakBad) console.log(`      ${r.plan} ${r.sources.map(who).join(' + ')}: ${fmtDb(r.vsPeakDb)} dBFS`)
  const byPlan = {}
  for (const r of data.leaks) byPlan[r.plan] = Math.max(byPlan[r.plan] ?? -Infinity, num(r.vsPeakDb))
  console.log('      pior por plano: ' + Object.entries(byPlan).map(([p, v]) => `${p} ${fmtDb(v)}`).join(' · '))

  const outs = data.levels.flatMap((r) => r.outputs.map((o) => ({ ...o, r })))
  const lvlBad = outs.filter((o) => !(num(o.errorDb) <= MAX_LEVEL_ERROR_DB))
  const lvlWorst = outs.reduce((a, o) => (num(o.errorDb) > num(a.errorDb) ? o : a), outs[0])
  const diffWorst = outs.reduce((a, o) => (o.maxDiff > a.maxDiff ? o : a), outs[0])
  const stereoDiff = outs.filter((o) => o.r.plan === 'stereo').reduce((a, o) => Math.max(a, o.maxDiff), 0)
  ok &&= lvlBad.length === 0
  console.log(`${lvlBad.length ? 'FALHA' : 'OK  '} B) nível x v1.4.15 (R-24): ${outs.length} saídas, maior erro ${num(lvlWorst.errorDb).toExponential(2)} dB (${lvlWorst.r.plan} ${lvlWorst.r.role} ${lvlWorst.r.mono ? 'mono' : 'estéreo'}, saída ${lvlWorst.output}); critério <= ${MAX_LEVEL_ERROR_DB} dB`)
  console.log(`      maior diferença por amostra ${diffWorst.maxDiff.toExponential(2)} (${diffWorst.r.plan} ${diffWorst.r.role}); "Tudo junto": ${stereoDiff.toExponential(2)}`)
  for (const o of lvlBad) console.log(`      ${o.r.plan} ${o.r.role} ${o.r.mono ? 'mono' : 'estéreo'} knob ${o.r.knob} saída ${o.output}: erro ${o.errorDb} dB (v1.4.15 ${fmtDb(o.refRmsDb)} dB, agora ${fmtDb(o.gotRmsDb)} dB)`)

  const swBad = data.switches.filter((s) => s.applyError || !(num(s.vsPeakDbAfter) < MAX_LEAK_DB) || (s.vsPeakDbBefore !== null && !(num(s.vsPeakDbBefore) < MAX_LEAK_DB)) || s.ear.some((e) => !(num(e.peakDb) > MIN_EAR_DB)))
  const swWorst = data.switches.reduce((a, s) => Math.max(a, num(s.vsPeakDbAfter), s.vsPeakDbBefore === null ? -Infinity : num(s.vsPeakDbBefore)), -Infinity)
  ok &&= swBad.length === 0
  console.log(`${swBad.length ? 'FALHA' : 'OK  '} C) troca de rota com apply(): ${data.switches.length} trocas, pior pico na VS (antes e depois) ${fmtDb(swWorst)} dBFS`)
  console.log(`      troca no quantum de ${data.switches[0].switchedAt.toFixed(5)} s; medido a partir dele, sem folga`)
  for (const s of data.switches) console.log(`      ${s.from} -> ${s.to}: VS antes ${s.vsPeakDbBefore === null ? '(Tudo junto)' : fmtDb(s.vsPeakDbBefore)}, depois ${fmtDb(s.vsPeakDbAfter)} dBFS; ouvido ${s.ear.map((e) => `saída ${e.output} ${fmtDb(e.peakDb)}`).join(', ')}${s.applyError ? ` ERRO ${s.applyError}` : ''}`)

  const cBad = data.countLevel.filter((r) => !(r.maxDiff < MAX_COUNT_DIFF) || !(r.levelErrorDb <= MAX_LEVEL_ERROR_DB))
  ok &&= cBad.length === 0
  console.log(`${cBad.length ? 'FALHA' : 'OK  '} E) contagem sozinha x com canal estéreo no barramento do Click: ${data.countLevel.map((r) => `${r.plan} pico ${fmtDb(r.countPeakDb)} dBFS, erro ${r.levelErrorDb.toExponential(2)} dB, diferença ${r.maxDiff.toExponential(2)}`).join(' · ')}`)

  const monoBad = data.mono.filter((r) => r.error || r.channels !== 1 || r.destCount !== 1 || !(num(r.peakDbBefore) > MIN_EAR_DB) || !(num(r.peakDbAfter) > MIN_EAR_DB) || !(r.maxDiff < MAX_COUNT_DIFF))
  ok &&= monoBad.length === 0
  const monoDiff = data.mono.reduce((a, r) => Math.max(a, r.maxDiff ?? Infinity), 0)
  console.log(`${monoBad.length ? 'FALHA' : 'OK  '} F) aparelho de 1 canal: ${data.mono.length} casos (Tudo junto mono da T19, Tudo junto, separados nos dois lados; Click, Guia e VS; troca no meio), ${data.mono.filter((r) => r.error).length} erros; destino com 1 canal; maior diferença x (L + R) / 2 ${monoDiff.toExponential(2)}`)
  for (const r of monoBad) console.log(`      ${r.plan} ${r.role}: ${r.error ?? `canais ${r.channels}, destino ${r.destCount}, antes ${fmtDb(r.peakDbBefore)}, depois ${fmtDb(r.peakDbAfter)} dBFS, diferença ${r.maxDiff}`}`)

  const mOk = data.meter.error < MAX_METER_ERROR
  ok &&= mOk
  console.log(`${mOk ? 'OK  ' : 'FALHA'} D) medidor: levels() = l ${data.meter.got.l.toFixed(4)}, r ${data.meter.got.r.toFixed(4)}; pico renderizado l ${data.meter.want.l.toFixed(4)}, r ${data.meter.want.r.toFixed(4)}`)
  return ok
}

await bundle()
const server = await serve()
const data = await runChrome(server, 'output-graph')
server.close()
process.exit(report(data) ? 0 : 1)

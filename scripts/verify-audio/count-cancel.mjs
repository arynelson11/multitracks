#!/usr/bin/env node
// Verificação no Chrome real: cancelar a contagem com um bipe soando não pode dar degrau.
// Empacota o src/audio/countTones.ts de verdade (esbuild, o que já vem com o Vite), renderiza
// o bipe num OfflineAudioContext do Chrome headless e cancela em cada quantum de 128 amostras
// ao longo do bipe, do ataque à parada (82 instantes a 48 kHz), no acento e no tempo comum, a 48 e a 44,1 kHz, com
// e sem cancelAndHoldAtTime (o Firefox não tem). Critério: em nenhum instante o envelope muda
// mais que 0,01 de uma amostra pra outra, e depois da janela do cancel a saída é silêncio.
// Existe porque o fake dos testes não segue a especificação do cancelAndHoldAtTime (T7, rodada 2).
//
// Uso: source ~/.nvm/nvm.sh && nvm use 24
//      node scripts/verify-audio/count-cancel.mjs              # código atual
//      node scripts/verify-audio/count-cancel.mjs --rev HEAD~1 # o src/ de um commit (o "antes")
// Outro Chrome: CHROME=/caminho/do/chrome. Sai com 1 se o critério falhar. JSON em results/.
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
const MAX_STEP = 0.01
const MAX_TAIL = 1e-3
const TIMEOUT_S = 180

function srcRoot(rev) {
  if (!rev) return path.join(ROOT, 'src')
  const sha = execFileSync('git', ['rev-parse', '--short', rev], { cwd: ROOT }).toString().trim()
  const base = path.join(OUT, `rev-${sha}`)
  fs.rmSync(base, { recursive: true, force: true })
  fs.mkdirSync(base, { recursive: true })
  const tar = execFileSync('git', ['archive', '--format=tar', sha, 'src/audio'], { cwd: ROOT, maxBuffer: 1 << 26 })
  execFileSync('tar', ['-x', '-C', base], { input: tar })
  return path.join(base, 'src')
}

async function bundle(rev) {
  const src = srcRoot(rev)
  await esbuild({
    entryPoints: [path.join(HERE, 'www/count-cancel.page.js')],
    outfile: path.join(OUT, 'count-cancel.bundle.js'),
    bundle: true,
    format: 'esm',
    platform: 'browser',
    target: 'es2022',
    sourcemap: false,
    logLevel: 'warning',
    plugins: [{
      name: 'src-da-t7',
      setup(b) { b.onResolve({ filter: /^@t7\/countTones$/ }, () => ({ path: path.join(src, 'audio/countTones.ts') })) },
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
  const url = `http://127.0.0.1:${server.address().port}/count-cancel.html?name=${name}`
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

function report(data) {
  if (data.fatal) { console.log('ERRO na página:', data.fatal); return false }
  console.log(data.userAgent)
  console.log(`bipe em ${data.at} s; critério: degrau por amostra <= ${MAX_STEP} e silêncio (<= ${MAX_TAIL}) depois da janela do cancel`)
  let ok = true
  for (const c of data.configs) {
    const bad = c.instants.filter((r) => r.worst > MAX_STEP)
    const worst = c.instants.reduce((a, r) => (r.worst > a.worst ? r : a), { worst: 0, now: 0 })
    const loud = c.instants.filter((r) => r.tail > MAX_TAIL)
    const pass = bad.length === 0 && loud.length === 0
    ok &&= pass
    const tipo = c.label === 1 ? 'acento' : 'tempo 2'
    console.log(`${pass ? 'OK  ' : 'FALHA'} ${c.sr} Hz, ${tipo}, ${c.variant}: ${bad.length}/${c.instants.length} instantes com degrau > ${MAX_STEP}; maior ${worst.worst.toFixed(4)} (cancel em ${worst.now.toFixed(4)} s); sem cancel o bipe tem ${c.baseline.worst.toFixed(4)}; ${loud.length} com som depois da janela`)
    if (bad.length) console.log('      ' + bad.map((r) => `${r.now.toFixed(4)}:${r.worst.toFixed(3)}`).join(' '))
  }
  return ok
}

const i = process.argv.indexOf('--rev')
const rev = i >= 0 ? process.argv[i + 1] : undefined
await bundle(rev)
if (rev) console.log('src/audio do commit', rev)
const server = await serve()
const name = rev ? `count-cancel_${rev.replace(/[^\w]/g, '')}` : 'count-cancel'
const data = await runChrome(server, name)
server.close()
process.exit(report(data) ? 0 : 1)

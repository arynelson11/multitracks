#!/usr/bin/env node
// Verificação da troca de tom no Chrome headless, com o hook REAL do app.
// Uso: node scripts/verify-pitch/run.mjs [cenario ...] [--tag nome] [--rev commit]
//   cenários: S1 S2 SPREAD NAN METRONOMO (padrão: todos)
//   --rev: roda contra o src/ de um commit (ex.: --rev HEAD~1 pro "antes")
// Sai com código 1 se algum critério falhar. Resultados em scripts/verify-pitch/results/.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buildHarness } from './build.mjs';
import { analyze, printReport } from './analyze.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RES = path.join(HERE, 'results');
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

export const SCENARIOS = {
  // 0 -> +2 -> 0 -> +3 -> 0 -> +5 tocando, 24 canais (click e guia primeiro).
  S1: { query: 'seq=S1&n=22&order=A', timeout: 150 },
  // Trocas rápidas (80 ms) com 24 canais.
  S2: { query: 'seq=S2&n=22&order=A', timeout: 120 },
  // Duas faixas de instrumento com o mesmo trem de clicks em L e R: mede o início de cada uma.
  SPREAD: { query: 'seq=SPREAD&n=8&order=A', timeout: 90 },
  // Tom inválido (NaN) chegando no motor.
  NAN: { query: 'seq=NAN&n=4&order=A', timeout: 90 },
  // Click do Separador: "Metrônomo" com acento, gravado depois dos stems.
  METRONOMO: { query: 'seq=S1&n=6&order=B&click=' + encodeURIComponent('Metrônomo'), timeout: 120 },
};

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json' };

function serve() {
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    if (req.method === 'POST' && u.pathname === '/result') {
      const name = (u.searchParams.get('name') || 'out').replace(/[^\w-]/g, '');
      const chunks = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => {
        fs.mkdirSync(RES, { recursive: true });
        fs.writeFileSync(path.join(RES, name + '.json'), Buffer.concat(chunks));
        res.end('ok');
      });
      return;
    }
    const rel = u.pathname.startsWith('/.build/') ? u.pathname.slice(1) : path.join('www', u.pathname);
    const file = path.join(HERE, rel);
    if (!file.startsWith(HERE) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.statusCode = 404; res.end(); return; }
    res.setHeader('Content-Type', MIME[path.extname(file)] || 'application/octet-stream');
    res.setHeader('Cache-Control', 'no-store');
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

async function runScenario(server, key, tag) {
  const sc = SCENARIOS[key];
  const name = `${key}${tag ? '_' + tag : ''}`;
  const out = path.join(RES, name + '.json');
  fs.rmSync(out, { force: true });
  const profile = path.join(HERE, `chrome-profile-${name}`);
  fs.rmSync(profile, { recursive: true, force: true });
  const port = server.address().port;
  const url = `http://127.0.0.1:${port}/engine.html?${sc.query}&name=${name}`;
  const chrome = spawn(CHROME, ['--headless=new', '--no-first-run', '--no-default-browser-check',
    '--autoplay-policy=no-user-gesture-required', '--mute-audio', `--user-data-dir=${profile}`, url], { stdio: 'ignore' });
  const t0 = Date.now();
  while (!fs.existsSync(out) && Date.now() - t0 < sc.timeout * 1000) await new Promise((r) => setTimeout(r, 500));
  await new Promise((r) => setTimeout(r, 500));
  chrome.kill('SIGTERM');
  await new Promise((r) => setTimeout(r, 800));
  try { chrome.kill('SIGKILL'); } catch { /* já saiu */ }
  fs.rmSync(profile, { recursive: true, force: true });
  if (!fs.existsSync(out)) return { key, name, fatal: `TIMEOUT ${sc.timeout}s` };
  const data = JSON.parse(fs.readFileSync(out, 'utf8'));
  if (data.fatal) return { key, name, fatal: data.fatal };
  return { key, name, checks: analyze(key, data), secs: ((Date.now() - t0) / 1000).toFixed(0) };
}

const args = process.argv.slice(2);
const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const tag = opt('--tag') || '';
const rev = opt('--rev');
const optVals = new Set(['--tag', '--rev'].map((n) => args.indexOf(n)).filter((i) => i >= 0).map((i) => i + 1));
const keys = args.filter((a, i) => !a.startsWith('--') && !optVals.has(i));
const list = keys.length ? keys : Object.keys(SCENARIOS);
for (const k of list) if (!SCENARIOS[k]) { console.error('cenário desconhecido:', k); process.exit(2); }

await buildHarness({ rev });
if (rev) console.log('src/ do commit', rev);
const server = await serve();
const results = [];
for (const k of list) {
  process.stdout.write(`rodando ${k}... `);
  const r = await runScenario(server, k, tag);
  console.log(r.fatal ? 'ERRO' : `ok (${r.secs}s)`);
  results.push(r);
}
server.close();
const ok = printReport(results);
process.exit(ok ? 0 : 1);

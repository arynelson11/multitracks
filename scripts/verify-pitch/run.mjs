#!/usr/bin/env node
// Verificação da troca de tom e do palco novo no Chrome headless, com o hook REAL do app.
// Uso: node scripts/verify-pitch/run.mjs [cenario ...] [--tag nome] [--rev commit]
//   cenários: ver SCENARIOS abaixo (padrão: todos)
//   --rev: roda contra o src/ de um commit (ex.: --rev HEAD~1 pro "antes")
// Sai com código 1 se algum critério falhar. Resultados em scripts/verify-pitch/results/.
// O SPLIT compara com a v1.4.15: rodar antes `node scripts/verify-pitch/run.mjs SPLIT --rev b53a95c --tag v1415`.
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
  // Igual, com 24 canais (laço de start() mais longo).
  SPREAD22: { query: 'seq=SPREAD&n=22&order=A', timeout: 120 },
  // 50 reinícios (seek) com 24 canais: conta quantos separam as faixas.
  SEEKS: { query: 'seq=SEEKS&n=22&order=A', timeout: 120 },
  // Buraco no reinício: seek tocando, no tom 0 e no +2.
  RESTART: { query: 'seq=RESTART&n=8&order=A', timeout: 90 },
  // Loop de seção do palco novo (toggleSectionLoop) na música de teste: emenda do click no tom 0 e no +2.
  LOOP: { query: 'seq=LOOP&song=palco&n=8&order=A', timeout: 120 },
  // O loop do palco antigo (o mecanismo da v1.4.16, armLoop): buraco na emenda (sem o atraso do rAF).
  LOOP_ANTIGO: { query: 'seq=LOOP&stage=antigo&n=8&order=A', timeout: 120 },
  // Laço de start() travado no meio de 12 seeks: o play descarta e reagenda tudo junto.
  STALL: { query: 'seq=STALL&n=8&order=A', timeout: 90 },
  // Repertório: A (24 canais) +2, B (10) +3, C (30) +2, remove B, A de volta e no tom 0.
  SONGS: { query: 'seq=SONGS&order=A&dur=30', timeout: 180 },
  // Play transposto pendente + troca de música (jumpToSong, prevSong, nextSong) antes do worklet nascer.
  PENDENTE: { query: 'seq=PENDENTE&order=A&dur=20', timeout: 120 },
  // Nível de faixa mono e estéreo (pan total e centro), tom 0 x transposto.
  LEVELS: { query: 'seq=LEVELS&order=A', timeout: 90 },
  // Tom inválido (NaN) chegando no motor.
  NAN: { query: 'seq=NAN&n=4&order=A', timeout: 90 },
  // Click do Separador: "Metrônomo" com acento, gravado depois dos stems.
  METRONOMO: { query: 'seq=S1&n=6&order=B&click=' + encodeURIComponent('Metrônomo'), timeout: 120 },
  // Click com o nome em inglês ("Metronome"), mesma ordem do Separador.
  METRONOME: { query: 'seq=S1&n=6&order=B&click=Metronome', timeout: 120 },
  // Palco novo (T30), música de teste com click acentuado a 120 BPM e marcas nas barras.
  // Pulo armado na seção 1 pra 0:00: contagem só no click, guia calada, vozes no 1; tom 0 e +2.
  JUMP: { parts: [{ id: 'tom0', query: 'seq=JUMP&song=palco&n=8&order=A' }, { id: 'tom2', query: 'seq=JUMP&song=palco&n=8&order=A&pitch=2' }], timeout: 90 },
  // Arma e cancela entre o 2º e o 3º bipe.
  CANCEL: { query: 'seq=CANCEL&song=palco&n=8&order=A', timeout: 90 },
  // Saídas: "Click e Guia separados" (normal e com o lado trocado) e "Tudo junto"; nível igual ao da v1.4.15.
  SPLIT: { parts: [{ id: 'separados', query: 'seq=SPLIT&song=limpo&n=8&order=A&saida=split2' }, { id: 'trocado', query: 'seq=SPLIT&song=limpo&n=8&order=A&saida=split2t' }, { id: 'junto', query: 'seq=SPLIT&song=limpo&n=8&order=A&saida=stereo' }], timeout: 90 },
  // Pré-contagem de 4 a 120 BPM no play do 0:00; na parte `trava`, a thread principal trava 15 ms
  // no fim da contagem marcada (o relógio passa do 1º bipe antes de o play conferir o relógio).
  PRECOUNT: { parts: [{ id: 'livre', query: 'seq=PRECOUNT&song=limpo&n=8&order=A' }, { id: 'trava', query: 'seq=PRECOUNT&song=limpo&n=8&order=A&trava=1' }], timeout: 90 },
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

// Cenário com partes (JUMP, SPLIT): uma página do Chrome por parte, resultados `CENARIO-parte`.
async function runScenario(server, key, tag, part) {
  const sc = SCENARIOS[key];
  const query = part ? part.query : sc.query;
  const name = `${key}${part ? '-' + part.id : ''}${tag ? '_' + tag : ''}`;
  const out = path.join(RES, name + '.json');
  fs.rmSync(out, { force: true });
  const profile = path.join(HERE, `chrome-profile-${name}`);
  fs.rmSync(profile, { recursive: true, force: true });
  const port = server.address().port;
  const url = `http://127.0.0.1:${port}/engine.html?${query}&name=${name}`;
  const chrome = spawn(CHROME, ['--headless=new', '--no-first-run', '--no-default-browser-check',
    '--autoplay-policy=no-user-gesture-required', '--mute-audio', `--user-data-dir=${profile}`, url], { stdio: 'ignore' });
  const t0 = Date.now();
  while (!fs.existsSync(out) && Date.now() - t0 < sc.timeout * 1000) await new Promise((r) => setTimeout(r, 500));
  await new Promise((r) => setTimeout(r, 500));
  chrome.kill('SIGTERM');
  await new Promise((r) => setTimeout(r, 800));
  try { chrome.kill('SIGKILL'); } catch { /* já saiu */ }
  fs.rmSync(profile, { recursive: true, force: true });
  const label = part ? `${key}-${part.id}` : key;
  if (!fs.existsSync(out)) return { key: label, name, fatal: `TIMEOUT ${sc.timeout}s` };
  const data = JSON.parse(fs.readFileSync(out, 'utf8'));
  if (data.fatal) return { key: label, name, fatal: data.fatal };
  return { key: label, name, checks: analyze(key, data, { part: part?.id, tag }), secs: ((Date.now() - t0) / 1000).toFixed(0) };
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
  for (const part of SCENARIOS[k].parts || [null]) {
    process.stdout.write(`rodando ${k}${part ? '-' + part.id : ''}... `);
    const r = await runScenario(server, k, tag, part);
    console.log(r.fatal ? 'ERRO' : `ok (${r.secs}s)`);
    results.push(r);
  }
}
server.close();
const ok = printReport(results);
process.exit(ok ? 0 : 1);

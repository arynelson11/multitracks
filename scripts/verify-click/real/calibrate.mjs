// M2b: calibração do detector de tempo com multitracks REAIS do dono, usando a
// faixa de click de cada pacote como gabarito.
//
// Pra cada pacote (pasta) de ~/Downloads/Áudio/PLAYBACK STUDIO:
// 1. gabarito pelo click (clickTruth.mjs): BPM, fase, acento do "1", subdivisão;
// 2. o detector como o app rodaria: pickTempoSources escolhe as faixas pelos nomes
//    (pulso, baixo, harmonia) e detectSongGrid roda nelas, na música INTEIRA e
//    também nos primeiros 30, 60, 120 e 240 s (a confiança depende da duração);
//    de novo na música inteira com o BPM do nome como referência (nearBpm);
// 3. negativos: guia, voz, pad e cordas/coro do mesmo pacote, cada um sozinho
//    como se fosse o pulso, nas mesmas durações.
// Áudio só é lido (ffmpeg, mono 44,1 kHz) e nunca gravado; os resultados (sem
// áudio) vão pra results/ (fora do git). O detector vem de um commit (build.mjs).
//
//   source ~/.nvm/nvm.sh && nvm use 24
//   cd scripts/verify-click/real
//   node build.mjs calibrate.mjs
//   node dist/calibrate.mjs --shard 0/4   # (em paralelo: 1/4, 2/4, 3/4)
//   node dist/calibrate.mjs --only Gabi   # um pacote
//   node summarize.mjs                    # tabelas e o corte
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { detectSongGrid } from 'detector/lib/beatGrid';
import { pickTempoSources } from 'detector/lib/tempoSources';
import { channelFamily } from 'detector/lib/channelNames';
import { findClickChannel } from 'detector/lib/channelRoles';
import { decodeMono } from './decode.mjs';
import { clickOnsets, soundClasses } from './clickOnsets.mjs';
import { clickTruth, nameBpm } from './clickTruth.mjs';
import { evaluateGrid } from './evaluate.mjs';

/* global __DETECTOR__ */
const DETECTOR = __DETECTOR__;
const ROOT = process.env.MT_ROOT || path.join(os.homedir(), 'Downloads/Áudio/PLAYBACK STUDIO');
const SKIP = new Set(['Bounces', 'Click and Guide Samples']);
const AUDIO = /\.(wav|mp3|m4a|aiff?|flac)$/i;
const SR = 44100;
const DURATIONS = [30, 60, 120, 240];
const OUT = path.resolve(process.cwd(), 'results');

const args = process.argv.slice(2);
const opt = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
const shard = opt('--shard');
const only = opt('--only');

function walk(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith('.')) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p));
    else if (AUDIO.test(e.name)) out.push(p);
  }
  return out;
}

const baseName = (f) => path.basename(f).replace(/\.[^/.]+$/, '');
const CLICKISH = /click|metr/i;
const NEG_CATS = [
  ['guia', (ch, fam) => fam === 'guia'],
  ['voz', (ch, fam) => fam === 'vocal' || fam === 'backing'],
  ['pad', (ch, fam) => fam === 'pad'],
  ['cordas/coro', (ch) => /string|cordas|choir|coral|coro|violin|violino|orquestra|orch/i.test(ch.name)],
];

const round = (v, d = 3) => (v === null || v === undefined || Number.isNaN(v) ? v : Math.round(v * 10 ** d) / 10 ** d);

function runDetector(tracks, opts) {
  const t0 = Date.now();
  const g = detectSongGrid(tracks, SR, opts);
  return { bpm: g.bpm, firstBeat: round(g.firstBeat, 4), downbeat: g.downbeat, confidence: round(g.confidence, 4),
    offbeatRisk: g.offbeatRisk, tracksUsed: g.tracksUsed, ms: Date.now() - t0 };
}

function cut(tracks, seconds) {
  const n = Math.round(seconds * SR);
  return tracks.map((t) => ({ ...t, channels: t.channels.map((c) => c.subarray(0, Math.min(n, c.length))) }));
}

function durationsFor(full) {
  return [...DURATIONS.filter((d) => d < full - 5), full];
}

async function runPackage(pkg) {
  const dir = path.join(ROOT, pkg);
  const files = walk(dir).sort((a, b) => baseName(a).localeCompare(baseName(b), 'pt', { numeric: true }));
  const channels = files.map((f, i) => ({ id: `c${i}`, name: baseName(f), file: f }));
  const fam = new Map(channels.map((c) => [c.id, channelFamily(c)]));
  const res = { pkg, detector: DETECTOR, sampleRate: SR, files: channels.map((c) => ({ id: c.id, name: c.name, family: fam.get(c.id), rel: path.relative(dir, c.file) })) };

  // 1. click: o que o app acharia e todos os candidatos pelo nome; fica o de mais clicks
  const appClick = findClickChannel(channels) ?? null;
  const cands = channels.filter((c) => fam.get(c.id) === 'click' || CLICKISH.test(c.name) || /^met$/i.test(c.name));
  res.click = { app: appClick?.name ?? null, candidates: [] };
  let best = null;
  for (const c of cands) {
    const x = decodeMono(c.file, { sampleRate: SR });
    const on = clickOnsets(x, SR);
    res.click.candidates.push({ name: c.name, seconds: round(x.length / SR, 1), clicks: on.length });
    if (!best || on.length > best.on.length) best = { c, x, on };
  }
  if (!best || best.on.length < 32) {
    res.skipped = 'sem faixa de click';
    return res;
  }
  soundClasses(best.x, best.on, SR);
  const nb = nameBpm(pkg, best.c.name);
  const truth = clickTruth(best.on, { nameBpm: nb });
  best.x = null;
  if (!truth.ok) { res.skipped = `click sem gabarito: ${truth.reason}`; return res; }
  res.click.used = best.c.name;
  const { beats, beatIdx, accents, ...truthSummary } = truth;
  res.truth = { ...truthSummary, nBeats: beats.length, nAccents: accents.length, firstAccent: accents[0] ?? null };
  const bpb = truth.beatsPerBar;

  // 2. faixas como o app escolheria
  const src = pickTempoSources(channels);
  res.sources = { click: src.click?.name ?? null, pulse: src.pulse.map((c) => c.name), bass: src.bass?.name ?? null, harmony: src.harmony.map((c) => c.name), label: src.label };
  const cache = new Map();
  const load = (ch) => {
    if (!cache.has(ch.id)) cache.set(ch.id, decodeMono(ch.file, { sampleRate: SR }));
    return cache.get(ch.id);
  };
  const tracks = [
    ...src.pulse.map((c) => ({ id: c.name, label: c.name, use: 'pulse', channels: [load(c)] })),
    ...(src.bass ? [{ id: src.bass.name, label: src.bass.name, use: 'bass', channels: [load(src.bass)] }] : []),
    ...src.harmony.map((c) => ({ id: c.name, label: c.name, use: 'harmony', channels: [load(c)] })),
  ];
  res.trackSeconds = Object.fromEntries(tracks.map((t) => [t.id, round(t.channels[0].length / SR, 1)]));
  res.runs = [];
  if (src.pulse.length) {
    const full = Math.max(...tracks.filter((t) => t.use === 'pulse').map((t) => t.channels[0].length)) / SR;
    res.fullSeconds = round(full, 1);
    for (const d of durationsFor(full)) {
      const det = runDetector(cut(tracks, d), { beatsPerBar: bpb });
      res.runs.push({ seconds: round(d, 1), full: d === full, det, eval: evaluateGrid(det, truth, bpb, d) });
    }
    const near = nb ?? Math.round(truth.bpm);
    const detN = runDetector(tracks, { beatsPerBar: bpb, nearBpm: near });
    res.nearRun = { nearBpm: near, det: detN, eval: evaluateGrid(detN, truth, bpb, full) };
  }
  cache.clear();

  // 3. negativos (um por categoria), cada um sozinho como pulso
  res.negatives = [];
  const usedIds = new Set();
  for (const [cat, test] of NEG_CATS) {
    const ch = channels.find((c) => !usedIds.has(c.id) && fam.get(c.id) !== 'click' && test(c, fam.get(c.id)));
    if (!ch) continue;
    usedIds.add(ch.id);
    const x = decodeMono(ch.file, { sampleRate: SR });
    const full = x.length / SR;
    const runs = [];
    for (const d of durationsFor(full)) {
      const det = runDetector(cut([{ id: ch.name, label: ch.name, use: 'pulse', channels: [x] }], d), { beatsPerBar: bpb });
      runs.push({ seconds: round(d, 1), full: d === full, det, eval: evaluateGrid(det, truth, bpb, d) });
    }
    res.negatives.push({ cat, name: ch.name, family: fam.get(ch.id), seconds: round(full, 1), runs });
  }
  return res;
}

const pkgs = fs.readdirSync(ROOT, { withFileTypes: true }).filter((e) => e.isDirectory() && !SKIP.has(e.name)).map((e) => e.name).sort((a, b) => a.localeCompare(b, 'pt'));
let todo = pkgs.filter((p) => !only || p.includes(only));
if (shard) {
  const [i, n] = shard.split('/').map(Number);
  todo = todo.filter((_, k) => k % n === i);
}
fs.mkdirSync(OUT, { recursive: true });
const outFile = path.join(OUT, `run-${DETECTOR.commit}-${shard ? shard.replace('/', 'of') : only ? 'only' : 'all'}.json`);
const results = [];
console.log(`detector ${DETECTOR.commit} sha256 ${DETECTOR.sha256}: ${todo.length} pacotes -> ${outFile}`);
for (const p of todo) {
  const t0 = Date.now();
  try {
    const r = await runPackage(p);
    results.push(r);
    const f = r.runs?.find((x) => x.full);
    console.log(`${((Date.now() - t0) / 1000).toFixed(0).padStart(4)} s  ${p.slice(0, 50).padEnd(50)} ${r.skipped ?? ''}${f ? `click ${round(r.truth.bpm, 2)} det ${f.det.bpm} conf ${f.det.confidence} ${f.eval.level}/${f.eval.phaseClass} ${round(f.eval.phaseMs, 1)} ms ader ${round(f.eval.adherence, 2)} 1:${f.eval.downbeatOk}` : ''}`);
  } catch (e) {
    results.push({ pkg: p, error: String(e?.stack ?? e) });
    console.log(`ERRO ${p}: ${e?.message ?? e}`);
  }
  fs.writeFileSync(outFile, JSON.stringify(results, null, 1));
}

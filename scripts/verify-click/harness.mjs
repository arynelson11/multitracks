// Medição 2: pipeline completo do botão "AUTO-DETECTAR E GERAR CLICK".
// Roda o código REAL de src/lib/beatGrid.ts e src/lib/AudioAnalyzer.ts (v1.4.14)
// e o AudioAnalyzer.ts da v1.4.9 (git show 5e051c2), com shims de Web Audio.
// Build: node build.mjs && node dist/harness.mjs [filtro]
import './shims.mjs';
import { detectBeatGrid } from '../../src/lib/beatGrid';
import { generateManualClickTrackFromSample, analyzeBufferAndGenerateClick } from '../../src/lib/AudioAnalyzer';
import { analyzeBufferAndGenerateClick as analyze149 } from './v149/AudioAnalyzer';
import { FakeAudioBuffer } from './shims.mjs';
import { makeSong } from './synth.mjs';
import { parseWav } from './wav.mjs';
import fs from 'node:fs';

const BEATS_PER_BAR = { '3/4': 3, '4/4': 4, '5/4': 5, '6/8': 6, '7/8': 7, '12/8': 12 };

// Transcrição fiel de MetronomeModal.tsx:152-166 (v1.4.14): escolha da faixa.
export function pickTrack(channels) {
  let t = channels.find(c => c.name.toLowerCase().includes('drum') || c.name.toLowerCase().includes('bateria'));
  if (!t) t = channels.find(c => c.name.toLowerCase().includes('bass') || c.name.toLowerCase().includes('baixo'));
  if (!t) t = channels.find(c => { const n = c.name.toLowerCase(); return !n.includes('click') && !n.includes('metronomo') && !n.includes('guia') && !n.includes('guide'); });
  if (!t) t = channels[0];
  return t;
}

// Transcrição fiel de MetronomeModal.tsx:177-202 (v1.4.14).
async function aiCurrent(song, sel) {
  const target = pickTrack(song.channels);
  const buf = target.buffer;
  const channelsData = [];
  for (let c = 0; c < buf.numberOfChannels; c++) channelsData.push(buf.getChannelData(c));
  const t0 = Date.now();
  const grid = detectBeatGrid(channelsData, buf.sampleRate, { beatsPerBar: BEATS_PER_BAR[sel.timeSignature] ?? 4 });
  const ms = Date.now() - t0;
  const useGrid = grid.confidence >= 0.1;
  const { clickTrackUrl } = useGrid
    ? await generateManualClickTrackFromSample(sel.type, sel.subdivision, grid.bpm, buf.duration, sel.accentBeat1, sel.timeSignature,
        { firstBeat: grid.firstBeat, downbeat: grid.downbeat })
    : await analyzeBufferAndGenerateClick(buf, () => {});
  const blob = await (await fetch(clickTrackUrl)).blob();
  return { target: target.name, grid, path: useGrid ? 'grade' : 'reserva', blob, detectMs: ms };
}

// v1.4.9 (MetronomeModal 5e051c2): analyzeBufferAndGenerateClick direto.
async function ai149(song) {
  const target = pickTrack(song.channels);
  const { bpm, clickTrackUrl } = await analyze149(target.buffer, () => {});
  const blob = await (await fetch(clickTrackUrl)).blob();
  return { target: target.name, bpm, blob };
}

function mono(w) {
  const m = new Float32Array(w.frames);
  for (const ch of w.channels) for (let i = 0; i < w.frames; i++) m[i] += ch[i] / w.numberOfChannels;
  return m;
}

// Acha cada click: início audível = 1ª amostra >= -20 dB do pico local do golpe.
export function detectClicks(x, sr) {
  const out = [];
  const thrAbs = 0.01;
  const look = Math.round(sr * 0.03);
  const back = Math.round(sr * 0.02);
  const minGap = Math.round(sr * 0.04);
  let i = 0;
  while (i < x.length) {
    if (Math.abs(x[i]) < thrAbs) { i++; continue; }
    let pk = 0;
    for (let j = i; j < Math.min(x.length, i + look); j++) if (Math.abs(x[j]) > pk) pk = Math.abs(x[j]);
    let pre = 0;
    for (let j = Math.max(0, i - back); j < i; j++) if (Math.abs(x[j]) > pre) pre = Math.abs(x[j]);
    if (pre >= 0.3 * pk) { i++; continue; } // cauda do click anterior
    let on = i;
    for (let j = Math.max(0, i - back); j < Math.min(x.length, i + look); j++) if (Math.abs(x[j]) >= 0.1 * pk) { on = j; break; }
    out.push({ t: on / sr, peak: pk });
    i = on + minGap;
  }
  return out;
}

function nearest(arr, t) {
  let lo = 0, hi = arr.length - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (arr[m].t < t) lo = m; else hi = m; }
  return Math.abs(arr[lo].t - t) <= Math.abs(arr[hi].t - t) ? arr[lo] : arr[hi];
}

export function evaluate(clicks, song, opts = {}) {
  const beatDur = 60 / song.bpm;
  const beats = song.beats;
  const errs = beats.map(T => { const c = nearest(clicks, T); return { T, e: (c.t - T) * 1000, c }; });
  const far = errs.filter(x => Math.abs(x.e) > 0.25 * beatDur * 1000).length;
  const abs = errs.map(x => Math.abs(x.e));
  const mean = abs.reduce((a, b) => a + b, 0) / abs.length;
  const max = Math.max(...abs);
  const signedMean = errs.reduce((a, b) => a + b.e, 0) / errs.length;
  // 1º click do arquivo, relativo à grade real estendida pra trás
  const c0 = clicks[0];
  const k0 = Math.round((c0.t - song.firstBeat) / beatDur);
  const c0err = (c0.t - (song.firstBeat + k0 * beatDur)) * 1000;
  // Acento: clicks com pico >= 85% do maior pico
  const maxPk = Math.max(...clicks.map(c => c.peak));
  const minPk = Math.min(...clicks.map(c => c.peak));
  const hasAccent = minPk < 0.85 * maxPk;
  const isAcc = (c) => hasAccent && c.peak >= 0.85 * maxPk;
  const accClicks = clicks.filter(isAcc);
  const barSet = song.bars;
  let barsAcc = 0, barsChecked = 0;
  const firstAccBar = opts.firstDrumBar ?? 0;
  for (let b = 0; b < barSet.length; b++) {
    const c = nearest(clicks, barSet[b]);
    if (Math.abs(c.t - barSet[b]) > 0.25 * beatDur) continue;
    barsChecked++;
    if (isAcc(c)) barsAcc++;
  }
  // Em que tempo do compasso real o acento cai (moda)
  const posHist = new Map();
  for (const c of accClicks) {
    const beatPos = Math.round((c.t - song.firstBeat) / beatDur);
    const p = ((beatPos % song.beatsPerBar) + song.beatsPerBar) % song.beatsPerBar;
    const frac = Math.abs((c.t - song.firstBeat) / beatDur - beatPos) > 0.25 ? 'fora' : p + 1;
    posHist.set(frac, (posHist.get(frac) || 0) + 1);
  }
  const accentOn1 = barsChecked ? barsAcc / barsChecked : 0;
  const accentWrong = accClicks.length - barsAcc;
  const last = errs[errs.length - 1];
  return {
    nClicks: clicks.length, nBeats: beats.length, clicksPerBeat: +(clicks.length / ((song.duration - clicks[0].t) / beatDur)).toFixed(2),
    first: +errs[0].e.toFixed(2), firstClickAt: +c0.t.toFixed(3), firstClickGridErr: +c0err.toFixed(2),
    mean: +mean.toFixed(2), signedMean: +signedMean.toFixed(2), max: +max.toFixed(2), lastErr: +last.e.toFixed(2), far,
    hasAccent, accentOn1: +(accentOn1 * 100).toFixed(1), accentWrong, accentPos: Object.fromEntries(posHist),
  };
}

function songToChannels(song, names) {
  const ch = [];
  for (const [key, name] of names) {
    const st = song.tracks[key];
    ch.push({ name, buffer: new FakeAudioBuffer(st, song.sr) });
  }
  return ch;
}

const SAMPLE_INFO = JSON.parse(fs.readFileSync(new URL('../samples.json', import.meta.url)));
const sampleOnsetMs = (type, sub) => SAMPLE_INFO.find(r => r.file === `${type}-${sub}.wav`)?.first_m20dB_ms ?? 0;

const DEFAULT_SEL = { type: 'Classic', subdivision: 'quarter', timeSignature: '4/4', accentBeat1: true };

export const CASES = [
  { id: 'a', desc: '1º tempo em 0,00 s, 120 BPM, 4/4', song: { bpm: 120, firstBeat: 0 } },
  { id: 'b', desc: '1º tempo em 1,37 s, 120 BPM', song: { bpm: 120, firstBeat: 1.37 } },
  { id: 'b44k', desc: 'igual (b), faixa decodificada a 44,1 kHz', song: { bpm: 120, firstBeat: 1.37, sr: 44100 } },
  { id: 'c1', desc: 'BPM decimal 72,5', song: { bpm: 72.5, firstBeat: 0.43 } },
  { id: 'c2', desc: 'BPM decimal 135,04', song: { bpm: 135.04, firstBeat: 0.21 } },
  { id: 'd', desc: 'intro 8 compassos só pad, bateria entra no comp. 9 (100 BPM)', song: { bpm: 100, firstBeat: 0.62, introBars: 8 } },
  { id: 'e1', desc: 'síncope forte (gospel/funk 16ths, 96 BPM)', song: { bpm: 96, firstBeat: 0.35, pattern: 'sync44' } },
  { id: 'e2', desc: 'contratempo dominante (one drop, 76 BPM)', song: { bpm: 76, firstBeat: 0.5, pattern: 'offbeat44' } },
  { id: 'f1', desc: '3/4 valsa 90 BPM, modal 3/4 (certo)', song: { bpm: 90, firstBeat: 0.3, pattern: 'waltz34' }, sel: { timeSignature: '3/4' } },
  { id: 'f2', desc: '3/4 valsa 90 BPM, modal 4/4 (errado)', song: { bpm: 90, firstBeat: 0.3, pattern: 'waltz34' }, sel: { timeSignature: '4/4' } },
  { id: 'f3', desc: '6/8 colcheia=180 (semínima pontuada=60), modal 6/8 (certo)', song: { bpm: 180, firstBeat: 0.3, pattern: 'sixeight' }, sel: { timeSignature: '6/8' } },
  { id: 'f4', desc: '6/8 colcheia=180, modal 4/4 (errado)', song: { bpm: 180, firstBeat: 0.3, pattern: 'sixeight' }, sel: { timeSignature: '4/4' } },
  { id: 'g1', desc: 'bateria a -40 dB, sem ruído', song: { bpm: 120, firstBeat: 0.8, gain: 0.01 } },
  { id: 'g2', desc: 'bateria a -50 dB + chiado -45 dB', song: { bpm: 120, firstBeat: 0.8, gain: 0.00316, noiseDb: -45 } },
  { id: 'g3', desc: 'pacote sem bateria/baixo: só Pad (escolhido por sobra)', song: { bpm: 120, firstBeat: 0.8 }, names: [['pad', 'Pad'], ['bass', 'Teclado']] },
  { id: 'h', desc: 'humanizado (jitter ±5 ms), 118 BPM', song: { bpm: 118, firstBeat: 0.8, jitterMs: 5 } },
  // ── variações extras ──
  { id: 'x_disco', desc: 'bumbo em todo tempo + chimbal aberto forte no "e" (worship/disco), 124 BPM', song: { bpm: 124, firstBeat: 0.9, pattern: 'disco44' } },
  { id: 'x_popsync', desc: 'pop sincopado leve (bumbo 1, e-do-2, 3; chimbal colcheias iguais), 84 BPM', song: { bpm: 84, firstBeat: 0.5, pattern: 'popsync44' } },
  { id: 'x_kicksync', desc: 'bumbo 1, e-do-2, e-do-3; caixa 2 e 4; chimbal colcheias iguais, 92 BPM', song: { bpm: 92, firstBeat: 0.5, pattern: 'kicksync44' } },
  { id: 'x_hat16on', desc: 'chimbal 16 com acento no tempo; bumbo 1 e e-do-3, 100 BPM', song: { bpm: 100, firstBeat: 0.5, pattern: 'hat16on44' } },
  { id: 'x_sync16even', desc: 'igual (e1) mas chimbal 16 sem acento, 96 BPM', song: { bpm: 96, firstBeat: 0.35, pattern: 'sync44even' } },
  { id: 'x_a_crash', desc: 'igual (a) começando em 0,000 com prato no 1 a cada 4 comp.', song: { bpm: 120, firstBeat: 0, crashEvery: 4 } },
  { id: 'x_a_popsync0', desc: 'pop sincopado (bumbo só no 1 e 3 do comp. não empatam) começando em 0,000', song: { bpm: 84, firstBeat: 0, pattern: 'popsync44' } },
  { id: 'x_d_fill4', desc: 'intro 8 comp. + virada de caixa no tempo 4 antes da entrada', song: { bpm: 100, firstBeat: 0.62, introBars: 8, fillBeforeEntry: 4 } },
  { id: 'x_d_fill3', desc: 'intro 8 comp. + virada de caixa a partir do tempo 3 antes da entrada', song: { bpm: 100, firstBeat: 0.62, introBars: 8, fillBeforeEntry: 3 } },
  { id: 'x_d_pickup', desc: 'intro 4 comp., 1º tempo da música em 2,00 s, bateria entra com virada no 4', song: { bpm: 110, firstBeat: 2.0, introBars: 4, fillBeforeEntry: 4, crashEvery: 8 } },
  { id: 'x_f3_pulse', desc: '(f3) avaliado na semínima pontuada (pulso de 60)', song: { bpm: 180, firstBeat: 0.3, pattern: 'sixeight' }, sel: { timeSignature: '6/8' }, evalPulse: 3 },
  { id: 'x_f4_pulse', desc: '(f4) avaliado na semínima pontuada (pulso de 60)', song: { bpm: 180, firstBeat: 0.3, pattern: 'sixeight' }, sel: { timeSignature: '4/4' }, evalPulse: 3 },
  { id: 't_64', desc: 'balada 64 BPM, chimbal colcheias', song: { bpm: 64, firstBeat: 0.7 } },
  { id: 't_68_16', desc: 'balada 68 BPM, chimbal semicolcheias (acento no tempo)', song: { bpm: 68, firstBeat: 0.7, pattern: 'hat16on44' } },
  { id: 't_58', desc: 'balada 58 BPM, chimbal colcheias', song: { bpm: 58, firstBeat: 0.7 } },
  { id: 't_160', desc: 'rápida 160 BPM, chimbal colcheias', song: { bpm: 160, firstBeat: 0.7 } },
  { id: 't_176', desc: 'rápida 176 BPM, chimbal colcheias', song: { bpm: 176, firstBeat: 0.7 } },
  { id: 'n_kicksplit', desc: 'pacote com KICK/SNARE separados (sem "drum"): cai no BASS (colcheias iguais)', song: { bpm: 104, firstBeat: 0.55 }, names: [['drums', 'KICK'], ['bass8', 'BASS'], ['pad', 'PAD']] },
  { id: 'n_loop', desc: 'pacote só com Loop (shaker 16, acento no "e") + Pad', song: { bpm: 104, firstBeat: 0.55 }, names: [['shaker', 'Loop'], ['pad', 'Pad']] },
  { id: 'n_padfirst', desc: 'pacote Pad antes do Loop, sem bateria/baixo', song: { bpm: 104, firstBeat: 0.55 }, names: [['pad', 'Pad'], ['shaker', 'Loop']] },
  ...['Blip', 'Woodblock', 'Cowbell', 'Percussive', 'Gentle', 'Saw'].map(type => (
    { id: `s_${type}`, desc: `(b) com som ${type} 1/4`, song: { bpm: 120, firstBeat: 1.37 }, sel: { type } })),
  { id: 's_Classic8', desc: '(b) com Classic 1/8', song: { bpm: 120, firstBeat: 1.37 }, sel: { subdivision: 'eighth' } },
  { id: 's_Classic16', desc: '(b) com Classic 1/16', song: { bpm: 120, firstBeat: 1.37 }, sel: { subdivision: 'sixteenth' } },
  { id: 's_ClassicAcc', desc: '(b) com Classic Acentos', song: { bpm: 120, firstBeat: 1.37 }, sel: { subdivision: 'accents' } },
];

async function runCase(cs, filterSel) {
  const song = makeSong({ duration: 300, sr: 48000, ...cs.song });
  const names = cs.names ?? [['drums', 'Bateria'], ['bass', 'Baixo'], ['pad', 'Pad']];
  const s = { channels: songToChannels(song, names) };
  const sel = { ...DEFAULT_SEL, ...(cs.sel || {}), ...(filterSel || {}) };
  const cur = await aiCurrent(s, sel);
  const wCur = parseWav(Buffer.from(await cur.blob.arrayBuffer()));
  const clicksCur = detectClicks(mono(wCur), wCur.sampleRate);
  const evSong = cs.evalPulse ? { ...song, bpm: song.bpm / cs.evalPulse, beats: song.beats.filter((_, i) => i % cs.evalPulse === 0), beatsPerBar: song.beatsPerBar / cs.evalPulse } : song;
  const evCur = evaluate(clicksCur, evSong);
  const old = await ai149(s);
  const wOld = parseWav(Buffer.from(await old.blob.arrayBuffer()));
  const clicksOld = detectClicks(mono(wOld), wOld.sampleRate);
  const evOld = evaluate(clicksOld, evSong);
  return {
    id: cs.id, desc: cs.desc, truth: { bpm: song.bpm, firstBeat: song.firstBeat, bpb: song.beatsPerBar },
    sel, target: cur.target,
    cur: { path: cur.path, grid: { ...cur.grid, firstBeat: +cur.grid.firstBeat.toFixed(4), confidence: +cur.grid.confidence.toFixed(3) }, wavRate: wCur.sampleRate, detectMs: cur.detectMs,
      sampleOnsetMs: cur.path === 'grade' ? sampleOnsetMs(sel.type, sel.subdivision) : 0, ...evCur },
    v149: { bpm: old.bpm, wavRate: wOld.sampleRate, ...evOld },
  };
}

const filter = process.argv[2] === 'all' ? undefined : process.argv[2];
const results = [];
for (const cs of CASES) {
  if (filter && !filter.split(',').includes(cs.id)) continue;
  const r = await runCase(cs);
  results.push(r);
  console.log(JSON.stringify(r));
}
fs.writeFileSync(new URL(`../results${filter ? '-' + filter.replace(/,/g, '_') : ''}.json`, import.meta.url), JSON.stringify(results, null, 1));

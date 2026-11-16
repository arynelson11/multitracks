// Medição com música REAL: as stems do demo (public/demo/*.mp3, decodificadas
// com ffmpeg pra demo-wav/). Sem gabarito de BPM: o "tempo real" é medido
// independentemente nos golpes da própria bateria (detector de ataque a 1 ms).
import './shims.mjs';
import { detectBeatGrid } from '../../src/lib/beatGrid';
import { generateManualClickTrackFromSample } from '../../src/lib/AudioAnalyzer';
import { analyzeBufferAndGenerateClick as analyze149 } from './v149/AudioAnalyzer';
import { FakeAudioBuffer } from './shims.mjs';
import { readWav, parseWav } from './wav.mjs';

const dir = new URL('../demo-wav/', import.meta.url).pathname;
const load = (id) => { const w = readWav(dir + id + '.wav'); return new FakeAudioBuffer(w.channels, w.sampleRate); };
const drums = load('bateria');
const sr = drums.sampleRate;

// Ataques da bateria: energia em janelas de 1 ms (passa-alta simples p/ caixa/chimbal + banda cheia),
// onset = subida > 6 dB em 5 ms acima do chão, refinado pra 1ª amostra >= -20 dB do pico local.
const x = drums.getChannelData(0);
const win = Math.round(sr * 0.001);
const env = [];
for (let i = 0; i + win <= x.length; i += win) { let s = 0; for (let k = 0; k < win; k++) s += x[i + k] * x[i + k]; env.push(Math.sqrt(s / win) + 1e-9); }
let gmax = 0; for (const e of env) gmax = Math.max(gmax, e);
const onsets = [];
for (let j = 6; j < env.length - 30; j++) {
  let before = 0; for (let k = j - 6; k < j - 1; k++) before = Math.max(before, env[k]);
  let after = 0, aj = j; for (let k = j; k < j + 25; k++) if (env[k] > after) { after = env[k]; aj = k; }
  if (after > 0.08 * gmax && after > 2.5 * before && (!onsets.length || j * win - onsets[onsets.length - 1].s > sr * 0.06)) {
    const s0 = j * win - 6 * win, s1 = aj * win + win;
    let pk = 0; for (let i = s0; i < s1; i++) pk = Math.max(pk, Math.abs(x[i]));
    let on = s0; for (let i = s0; i < s1; i++) if (Math.abs(x[i]) >= 0.1 * pk) { on = i; break; }
    onsets.push({ s: on, t: on / sr, pk });
    j = aj + 40;
  }
}

function detectClicks(y, r) {
  const out = []; const look = Math.round(r * 0.03), back = Math.round(r * 0.02), gap = Math.round(r * 0.04);
  let i = 0;
  while (i < y.length) {
    if (Math.abs(y[i]) < 0.01) { i++; continue; }
    let pk = 0; for (let j = i; j < Math.min(y.length, i + look); j++) pk = Math.max(pk, Math.abs(y[j]));
    let pre = 0; for (let j = Math.max(0, i - back); j < i; j++) pre = Math.max(pre, Math.abs(y[j]));
    if (pre >= 0.3 * pk) { i++; continue; }
    let on = i; for (let j = Math.max(0, i - back); j < Math.min(y.length, i + look); j++) if (Math.abs(y[j]) >= 0.1 * pk) { on = j; break; }
    out.push({ t: on / r, peak: pk }); i = on + gap;
  }
  return out;
}
const mono = (w) => { const m = new Float32Array(w.frames); for (const c of w.channels) for (let i = 0; i < w.frames; i++) m[i] += c[i] / w.numberOfChannels; return m; };

function compare(clicks, label, period) {
  // Pra cada click, ataque de bateria mais perto (só conta se estiver a < 1/4 de tempo)
  const errs = [];
  for (const c of clicks) {
    let best = null; for (const o of onsets) if (!best || Math.abs(o.t - c.t) < Math.abs(best.t - c.t)) best = o;
    if (best && Math.abs(best.t - c.t) < period / 4) errs.push((c.t - best.t) * 1000);
  }
  errs.sort((a, b) => a - b);
  const med = errs[Math.floor(errs.length / 2)];
  // Em quantos ataques fortes (top 30%) o click cai em cima (±25 ms) e quantos caem no meio-tempo
  const strong = [...onsets].sort((a, b) => b.pk - a.pk).slice(0, Math.ceil(onsets.length * 0.3));
  let onGrid = 0, onHalf = 0;
  for (const o of strong) {
    const near = clicks.reduce((b, c) => Math.abs(c.t - o.t) < Math.abs(b.t - o.t) ? c : b, clicks[0]);
    const d = Math.abs(near.t - o.t);
    if (d < 0.025) onGrid++; else if (Math.abs(d - period / 2) < 0.025) onHalf++;
  }
  console.log(JSON.stringify({ label, nClicks: clicks.length, clicksComAtaquePerto: errs.length, medianaMs: +med?.toFixed(2), p10: +errs[Math.floor(errs.length * 0.1)]?.toFixed(2), p90: +errs[Math.floor(errs.length * 0.9)]?.toFixed(2),
    ataquesFortes: strong.length, fortesNoClick: onGrid, fortesNoMeioTempo: onHalf, primeiroClick: +clicks[0].t.toFixed(3), primeiroAtaque: +onsets[0].t.toFixed(3) }));
}

console.log(JSON.stringify({ duracao: drums.duration, sr, ataquesBateria: onsets.length, primeiros: onsets.slice(0, 8).map(o => +o.t.toFixed(4)) }));
const chData = []; for (let c = 0; c < drums.numberOfChannels; c++) chData.push(drums.getChannelData(c));
for (const ts of ['4/4', '3/4']) {
  const bpb = ts === '4/4' ? 4 : 3;
  const g = detectBeatGrid(chData, sr, { beatsPerBar: bpb });
  console.log(JSON.stringify({ compasso: ts, grade: { ...g, firstBeat: +g.firstBeat.toFixed(4), confidence: +g.confidence.toFixed(3) } }));
  if (ts !== '4/4') continue;
  const { clickTrackUrl } = await generateManualClickTrackFromSample('Classic', 'quarter', g.bpm, drums.duration, true, '4/4', { firstBeat: g.firstBeat, downbeat: g.downbeat });
  const w = parseWav(Buffer.from(await (await (await fetch(clickTrackUrl)).blob()).arrayBuffer()));
  const clicks = detectClicks(mono(w), w.sampleRate);
  compare(clicks, 'v1.4.14 (grade)', 60 / g.bpm);
  const maxPk = Math.max(...clicks.map(c => c.peak));
  const acc = clicks.filter(c => c.peak >= 0.85 * maxPk).map(c => +c.t.toFixed(3));
  console.log(JSON.stringify({ acentos: acc.slice(0, 8) }));
  // intervalos entre ataques fortes (pra checar o BPM independente)
  const old = await analyze149(drums, () => {});
  const w2 = parseWav(Buffer.from(await (await (await fetch(old.clickTrackUrl)).blob()).arrayBuffer()));
  compare(detectClicks(mono(w2), w2.sampleRate), `v1.4.9 (bpm ${old.bpm}, inicio em 0:00)`, 60 / old.bpm);
}
// BPM independente: regressão linear dos ataques fortes de bumbo/caixa sobre a grade

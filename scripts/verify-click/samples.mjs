// Medição 1: atraso próprio de cada amostra de click e quantos "golpes" ela tem.
// Uso: node samples.mjs <pasta "public/Click Tracks">
import fs from 'node:fs';
import path from 'node:path';
import { readWav } from './wav.mjs';

const dir = process.argv[2];
const files = fs.readdirSync(dir).filter(f => f.endsWith('.wav')).sort();

function mono(w) {
  const m = new Float32Array(w.frames);
  for (const ch of w.channels) for (let i = 0; i < w.frames; i++) m[i] += ch[i] / w.numberOfChannels;
  return m;
}

const rows = [];
for (const f of files) {
  const w = readWav(path.join(dir, f));
  const m = mono(w);
  const sr = w.sampleRate;
  let peak = 0, peakAt = 0;
  for (let i = 0; i < m.length; i++) if (Math.abs(m[i]) > peak) { peak = Math.abs(m[i]); peakAt = i; }
  const firstOver = (db) => {
    const th = peak * Math.pow(10, db / 20);
    for (let i = 0; i < m.length; i++) if (Math.abs(m[i]) >= th) return i;
    return -1;
  };
  // Envelope RMS 1 ms, golpes = subidas acima de -20 dB do pico após >= 30 ms abaixo de -40 dB
  const win = Math.round(sr * 0.001);
  const env = [];
  for (let i = 0; i + win <= m.length; i += win) {
    let s = 0; for (let k = 0; k < win; k++) s += m[i + k] * m[i + k];
    env.push(Math.sqrt(s / win));
  }
  let envPeak = 0; for (const e of env) if (e > envPeak) envPeak = e;
  const hits = [];
  let quietMs = 1e9;
  for (let j = 0; j < env.length; j++) {
    const db = 20 * Math.log10((env[j] + 1e-12) / envPeak);
    if (db > -20 && quietMs >= 30) {
      // refina: primeira amostra acima de -30 dB do pico absoluto neste golpe
      let s0 = Math.max(0, (j - 3) * win);
      const th = peak * Math.pow(10, -30 / 20);
      let at = s0;
      for (let i = s0; i < Math.min(m.length, (j + 2) * win); i++) if (Math.abs(m[i]) >= th) { at = i; break; }
      // pico local nos 30 ms seguintes
      let lp = 0, lpAt = at;
      for (let i = at; i < Math.min(m.length, at + Math.round(sr * 0.03)); i++) if (Math.abs(m[i]) > lp) { lp = Math.abs(m[i]); lpAt = i; }
      hits.push({ onsetMs: +(at / sr * 1000).toFixed(2), peakMs: +(lpAt / sr * 1000).toFixed(2), peakDb: +(20 * Math.log10(lp / peak)).toFixed(1) });
      quietMs = 0;
    }
    if (db < -40) quietMs++; else quietMs = 0;
  }
  // energia útil: último ponto acima de -60 dB do pico
  let lastAbove = 0; const th60 = peak * 1e-3;
  for (let i = m.length - 1; i >= 0; i--) if (Math.abs(m[i]) >= th60) { lastAbove = i; break; }
  rows.push({
    file: f.replace('New Click -  ', ''),
    sr, ch: w.numberOfChannels, bits: w.bits, durMs: +(w.frames / sr * 1000).toFixed(1),
    dataOff: w.dataOff,
    first_m60dB_ms: +(firstOver(-60) / sr * 1000).toFixed(3),
    first_m20dB_ms: +(firstOver(-20) / sr * 1000).toFixed(3),
    first_m6dB_ms: +(firstOver(-6) / sr * 1000).toFixed(3),
    peakMs: +(peakAt / sr * 1000).toFixed(3),
    tailEndMs: +(lastAbove / sr * 1000).toFixed(1),
    hits,
  });
}
console.log(JSON.stringify(rows, null, 1));

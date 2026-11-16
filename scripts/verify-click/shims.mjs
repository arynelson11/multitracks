// Shims mínimos de Web Audio / fetch / Blob URL pra rodar o código REAL do app
// (AudioAnalyzer.ts, beatGrid.ts) em Node puro, sem navegador.
import fs from 'node:fs';
import path from 'node:path';
import { parseWav } from './wav.mjs';

export const PUBLIC_DIR = process.env.PUBLIC_DIR || path.resolve(new URL('.', import.meta.url).pathname, '../../../public');

export class FakeAudioBuffer {
  constructor(channels, sampleRate) {
    this._ch = channels;
    this.sampleRate = sampleRate;
    this.numberOfChannels = channels.length;
    this.length = channels[0].length;
    this.duration = this.length / sampleRate;
  }
  getChannelData(c) { return this._ch[c]; }
}

// Reamostragem linear (só usada se o WAV vier numa taxa diferente do contexto).
function resample(data, from, to) {
  if (from === to) return data;
  const n = Math.round(data.length * to / from);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = i * from / to;
    const k = Math.floor(x);
    const f = x - k;
    out[i] = (data[k] ?? 0) * (1 - f) + (data[k + 1] ?? 0) * f;
  }
  return out;
}

export const decodeLog = [];

class FakeAudioContext {
  constructor(opts = {}) { this.sampleRate = opts.sampleRate ?? 48000; this.state = 'running'; }
  async decodeAudioData(ab) {
    const w = parseWav(Buffer.from(ab));
    decodeLog.push({ fileRate: w.sampleRate, ctxRate: this.sampleRate, frames: w.frames, ch: w.numberOfChannels });
    return new FakeAudioBuffer(w.channels.map(c => resample(c, w.sampleRate, this.sampleRate)), this.sampleRate);
  }
  async close() { this.state = 'closed'; }
}

// OfflineAudioContext só com o que renderClickPositions usa: oscilador seno +
// ganho com setValueAtTime / exponentialRampToValueAtTime, start/stop.
class Param {
  constructor(v) { this.value = v; this.events = []; }
  setValueAtTime(v, t) { this.events.push({ type: 'set', v, t }); return this; }
  exponentialRampToValueAtTime(v, t) { this.events.push({ type: 'exp', v, t }); return this; }
  valueAt(t) {
    let v = this.value; let lastT = 0; let lastV = v;
    for (const e of this.events) {
      if (e.type === 'set') { if (t >= e.t) { v = e.v; lastT = e.t; lastV = e.v; } }
      else if (e.type === 'exp') {
        if (t >= e.t) { v = e.v; lastT = e.t; lastV = e.v; }
        else if (t > lastT) { v = lastV * Math.pow(e.v / lastV, (t - lastT) / (e.t - lastT)); return v; }
      }
    }
    return v;
  }
}
class FakeOsc {
  constructor() { this.frequency = new Param(440); this.startT = 0; this.stopT = Infinity; this.dest = null; }
  connect(n) { this.dest = n; return n; }
  start(t) { this.startT = t; }
  stop(t) { this.stopT = t; }
}
class FakeGain {
  constructor() { this.gain = new Param(1); this.dest = null; }
  connect(n) { this.dest = n; return n; }
}
class FakeOfflineAudioContext {
  constructor(ch, length, sampleRate) { this.ch = ch; this.length = length; this.sampleRate = sampleRate; this.oscs = []; this.destination = { dest: true }; }
  createOscillator() { const o = new FakeOsc(); this.oscs.push(o); return o; }
  createGain() { return new FakeGain(); }
  async startRendering() {
    const sr = this.sampleRate;
    const out = new Float32Array(this.length);
    for (const o of this.oscs) {
      const g = o.dest;
      // Chrome: início quantizado pro próximo quadro (round up).
      const s0 = Math.ceil(o.startT * sr - 1e-9);
      const s1 = Math.min(this.length, Math.ceil(o.stopT * sr - 1e-9));
      let ph = 0;
      for (let i = s0; i < s1; i++) {
        const t = i / sr;
        const f = o.frequency.valueAt(t);
        out[i] += Math.sin(ph) * g.gain.valueAt(t);
        ph += 2 * Math.PI * f / sr;
      }
    }
    return new FakeAudioBuffer([out], sr);
  }
}

const blobs = new Map();
let blobN = 0;

globalThis.window = globalThis;
globalThis.AudioContext = FakeAudioContext;
globalThis.OfflineAudioContext = FakeOfflineAudioContext;
URL.createObjectURL = (b) => { const u = `blob:fake/${++blobN}`; blobs.set(u, b); return u; };
URL.revokeObjectURL = (u) => { blobs.delete(u); };
globalThis.fetch = async (url) => {
  if (url.startsWith('blob:')) {
    const b = blobs.get(url);
    return { ok: !!b, blob: async () => b, arrayBuffer: async () => b.arrayBuffer() };
  }
  const rel = decodeURIComponent(url.replace(/^\.?\//, ''));
  const p = path.join(PUBLIC_DIR, rel);
  if (!fs.existsSync(p)) return { ok: false };
  const buf = fs.readFileSync(p);
  return { ok: true, arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) };
};

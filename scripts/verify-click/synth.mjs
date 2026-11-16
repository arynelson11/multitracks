// Músicas sintéticas com ataque conhecido. Cada golpe começa EXATAMENTE no
// instante da grade (rampa de 0,3 ms), então o "tempo real" é o início do golpe.

function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const RAMP = (Number(globalThis.process?.env?.RAMP_MS) || 0.3) / 1000;

function addKick(buf, sr, t0, amp) {
  const n0 = Math.round(t0 * sr);
  const len = Math.round(0.35 * sr);
  let ph = 0;
  for (let i = 0; i < len && n0 + i < buf.length; i++) {
    if (n0 + i < 0) continue;
    const t = i / sr;
    const f = 50 + 90 * Math.exp(-t / 0.03);
    ph += (2 * Math.PI * f) / sr;
    const env = Math.min(1, t / RAMP) * Math.exp(-t / 0.12);
    buf[n0 + i] += amp * env * Math.sin(ph + Math.PI / 2) * 0.9;
  }
}

function addSnare(buf, sr, t0, amp, rnd) {
  const n0 = Math.round(t0 * sr);
  const len = Math.round(0.25 * sr);
  for (let i = 0; i < len && n0 + i < buf.length; i++) {
    if (n0 + i < 0) continue;
    const t = i / sr;
    const a = Math.min(1, t / RAMP);
    const noise = (rnd() * 2 - 1) * Math.exp(-t / 0.05) * 0.5;
    const tone = Math.sin(2 * Math.PI * 190 * t) * Math.exp(-t / 0.04) * 0.45;
    buf[n0 + i] += amp * a * (noise + tone);
  }
}

function addHat(buf, sr, t0, amp, rnd) {
  const n0 = Math.round(t0 * sr);
  const len = Math.round(0.06 * sr);
  let prev = 0;
  for (let i = 0; i < len && n0 + i < buf.length; i++) {
    if (n0 + i < 0) continue;
    const t = i / sr;
    const x = rnd() * 2 - 1;
    const hp = x - prev; prev = x;
    buf[n0 + i] += amp * Math.min(1, t / RAMP) * hp * Math.exp(-t / 0.015) * 0.18;
  }
}

function addOpenHat(buf, sr, t0, amp, rnd) {
  const n0 = Math.round(t0 * sr);
  const len = Math.round(0.25 * sr);
  let prev = 0;
  for (let i = 0; i < len && n0 + i < buf.length; i++) {
    if (n0 + i < 0) continue;
    const t = i / sr;
    const x = rnd() * 2 - 1;
    const hp = x - prev; prev = x;
    buf[n0 + i] += amp * Math.min(1, t / RAMP) * hp * Math.exp(-t / 0.08) * 0.22;
  }
}

function addCrash(buf, sr, t0, amp, rnd) {
  const n0 = Math.round(t0 * sr);
  const len = Math.round(1.5 * sr);
  let prev = 0;
  for (let i = 0; i < len && n0 + i < buf.length; i++) {
    if (n0 + i < 0) continue;
    const t = i / sr;
    const x = rnd() * 2 - 1;
    const hp = x - prev; prev = x;
    buf[n0 + i] += amp * Math.min(1, t / RAMP) * hp * Math.exp(-t / 0.5) * 0.3;
  }
}

// Acorde de pad: ataque lento (250 ms), sustenta o compasso inteiro.
function addPadChord(buf, sr, t0, dur, freqs, amp) {
  const n0 = Math.round(t0 * sr);
  const len = Math.round(dur * sr);
  for (let i = 0; i < len && n0 + i < buf.length; i++) {
    if (n0 + i < 0) continue;
    const t = i / sr;
    const env = Math.min(1, t / 0.25) * Math.min(1, (dur - t) / 0.2);
    let s = 0;
    for (const f of freqs) s += Math.sin(2 * Math.PI * f * t) + 0.3 * Math.sin(2 * Math.PI * 2 * f * t + 0.5);
    buf[n0 + i] += amp * env * s / freqs.length;
  }
}

function addBassNote(buf, sr, t0, dur, f, amp) {
  const n0 = Math.round(t0 * sr);
  const len = Math.round(dur * sr);
  for (let i = 0; i < len && n0 + i < buf.length; i++) {
    if (n0 + i < 0) continue;
    const t = i / sr;
    const env = Math.min(1, t / 0.005) * Math.exp(-t / 0.8) * Math.min(1, (dur - t) / 0.02);
    buf[n0 + i] += amp * env * (Math.sin(2 * Math.PI * f * t) + 0.4 * Math.sin(2 * Math.PI * 2 * f * t));
  }
}

const CHORDS = [[261.6, 329.6, 392.0], [220.0, 261.6, 329.6], [174.6, 220.0, 261.6], [196.0, 246.9, 293.7]];
const BASS = [65.4, 55.0, 43.65, 49.0];

/**
 * Padrões em "passos" por compasso. Cada item: [passo, instrumento, amp].
 * stepsPerBeat define a grade dos passos.
 */
export const PATTERNS = {
  // 4/4 rock/pop: bumbo 1 e 3, caixa 2 e 4, chimbal em colcheias
  rock44: { beatsPerBar: 4, stepsPerBeat: 2, hits: [
    [0, 'k', 1], [4, 'k', 1], [2, 's', 1], [6, 's', 1],
    ...[0, 1, 2, 3, 4, 5, 6, 7].map(s => [s, 'h', s % 2 ? 0.6 : 1]),
  ] },
  // 4/4 sincopado (gospel/funk): bumbo no 1, "e do 2", "a do 3"; caixa 2 e 4; chimbal semicolcheias com acento no contratempo
  sync44: { beatsPerBar: 4, stepsPerBeat: 4, hits: [
    [0, 'k', 1], [6, 'k', 1], [10, 'k', 0.9], [11, 'k', 0.8], [14, 'k', 0.9],
    [4, 's', 1], [12, 's', 1], [7, 's', 0.35], [15, 's', 0.3],
    ...Array.from({ length: 16 }, (_, s) => [s, 'h', s % 4 === 2 ? 1 : 0.35]),
  ] },
  // 4/4 "one drop" (contratempo dominante): chimbal/skank forte só no "e", bumbo+caixa no 3
  offbeat44: { beatsPerBar: 4, stepsPerBeat: 2, hits: [
    [4, 'k', 1], [4, 's', 0.8],
    [1, 'h', 1], [3, 'h', 1], [5, 'h', 1], [7, 'h', 1],
    [1, 's', 0.45], [3, 's', 0.45], [5, 's', 0.45], [7, 's', 0.45],
  ] },
  // 4/4 disco/worship: bumbo em todo tempo, chimbal ABERTO forte no "e", caixa 2 e 4
  disco44: { beatsPerBar: 4, stepsPerBeat: 2, hits: [
    [0, 'k', 1], [2, 'k', 1], [4, 'k', 1], [6, 'k', 1], [2, 's', 1], [6, 's', 1],
    [1, 'o', 1], [3, 'o', 1], [5, 'o', 1], [7, 'o', 1],
  ] },
  // 4/4 pop sincopado leve: bumbo 1, "e do 2", 3; caixa 2 e 4; chimbal colcheias iguais
  popsync44: { beatsPerBar: 4, stepsPerBeat: 2, hits: [
    [0, 'k', 1], [3, 'k', 1], [4, 'k', 1], [2, 's', 1], [6, 's', 1],
    ...[0, 1, 2, 3, 4, 5, 6, 7].map(s => [s, 'h', 0.7]),
  ] },
  // 4/4 bumbo sincopado (1, "e do 2", "e do 3"), caixa 2 e 4, chimbal colcheias iguais
  kicksync44: { beatsPerBar: 4, stepsPerBeat: 2, hits: [
    [0, 'k', 1], [3, 'k', 1], [5, 'k', 1], [2, 's', 1], [6, 's', 1],
    ...[0, 1, 2, 3, 4, 5, 6, 7].map(s => [s, 'h', 0.7]),
  ] },
  // 4/4 semicolcheias no chimbal com acento NO tempo; bumbo 1 e "e do 3"; caixa 2 e 4
  hat16on44: { beatsPerBar: 4, stepsPerBeat: 4, hits: [
    [0, 'k', 1], [10, 'k', 1], [4, 's', 1], [12, 's', 1],
    ...Array.from({ length: 16 }, (_, s) => [s, 'h', s % 4 === 0 ? 1 : 0.4]),
  ] },
  // igual sync44, mas chimbal semicolcheia IGUAL (sem acento no contratempo)
  sync44even: { beatsPerBar: 4, stepsPerBeat: 4, hits: [
    [0, 'k', 1], [6, 'k', 1], [10, 'k', 0.9], [11, 'k', 0.8], [14, 'k', 0.9],
    [4, 's', 1], [12, 's', 1], [7, 's', 0.35], [15, 's', 0.3],
    ...Array.from({ length: 16 }, (_, s) => [s, 'h', 0.5]),
  ] },
  // 3/4 valsa: bumbo no 1, caixa 2 e 3, chimbal nos tempos
  waltz34: { beatsPerBar: 3, stepsPerBeat: 1, hits: [
    [0, 'k', 1], [1, 's', 0.7], [2, 's', 0.7], [0, 'h', 1], [1, 'h', 0.6], [2, 'h', 0.6],
  ] },
  // 6/8 (6 colcheias por compasso): bumbo no 1, caixa no 4, chimbal em todas
  sixeight: { beatsPerBar: 6, stepsPerBeat: 1, hits: [
    [0, 'k', 1], [3, 's', 1], ...[0, 1, 2, 3, 4, 5].map(s => [s, 'h', s === 0 || s === 3 ? 1 : 0.55]),
  ] },
};

/**
 * Gera as faixas de uma música sintética.
 * opts: { sr, duration, bpm, firstBeat, pattern, introBars (sem bateria), gain, noiseDb, jitterMs, seed }
 * Retorna { tracks: {name: Float32Array[]}, beats: number[] (todos os tempos reais), bars: number[] (inícios de compasso) }
 */
export function makeSong(opts) {
  const { sr = 48000, duration = 300, bpm, firstBeat = 0, pattern = 'rock44', introBars = 0,
    gain = 1, noiseDb = null, jitterMs = 0, seed = 1, withPad = true, withBass = true,
    crashEvery = 0, fillBeforeEntry = null } = opts;
  const P = PATTERNS[pattern];
  const rnd = rng(seed);
  const n = Math.round(duration * sr);
  const drums = new Float32Array(n);
  const pad = new Float32Array(n);
  const bass = new Float32Array(n);
  const beatDur = 60 / bpm;
  const barDur = beatDur * P.beatsPerBar;
  const stepDur = beatDur / P.stepsPerBeat;
  const beats = [];
  const bars = [];
  for (let b = 0; ; b++) {
    const t = firstBeat + b * beatDur;
    if (t >= duration - 0.5) break;
    beats.push(t);
  }
  for (let bar = 0; ; bar++) {
    const tb = firstBeat + bar * barDur;
    if (tb >= duration - 0.5) break;
    bars.push(tb);
    if (withPad) addPadChord(pad, sr, tb, barDur, CHORDS[bar % 4], 0.25);
    if (fillBeforeEntry && introBars > 0 && bar === introBars - 1) {
      // virada de caixa em semicolcheias a partir do tempo fillBeforeEntry (1-based) do compasso anterior à entrada
      for (let q = (fillBeforeEntry - 1) * 4; q < P.beatsPerBar * 4; q++) addSnare(drums, sr, tb + q * beatDur / 4, (0.5 + 0.5 * q / (P.beatsPerBar * 4)) * gain, rnd);
    }
    if (bar >= introBars && crashEvery && (bar - introBars) % crashEvery === 0) addCrash(drums, sr, tb, gain, rnd);
    if (bar >= introBars) {
      if (withBass) addBassNote(bass, sr, tb, barDur * 0.98, BASS[bar % 4], 0.35);
      for (const [step, inst, amp] of P.hits) {
        const j = jitterMs ? ((rnd() + rnd() + rnd() - 1.5) * 2 * jitterMs) / 1000 : 0;
        const t = tb + step * stepDur + j;
        if (inst === 'k') addKick(drums, sr, t, amp * gain);
        else if (inst === 's') addSnare(drums, sr, t, amp * gain, rnd);
        else if (inst === 'o') addOpenHat(drums, sr, t, amp * gain, rnd);
        else addHat(drums, sr, t, amp * gain, rnd);
      }
    }
  }
  // Faixas extras (pacotes sem "Bateria"): shaker 16 com acento no "e"; baixo em colcheias iguais.
  const shaker = new Float32Array(n);
  const bass8 = new Float32Array(n);
  for (let bar = introBars; bar < bars.length; bar++) {
    const tb = bars[bar];
    for (let q = 0; q < P.beatsPerBar * 4; q++) addHat(shaker, sr, tb + q * beatDur / 4, q % 4 === 2 ? 1 : 0.45, rnd);
    for (let q = 0; q < P.beatsPerBar * 2; q++) addBassNote(bass8, sr, tb + q * beatDur / 2, beatDur / 2 * 0.9, BASS[bar % 4], 0.35);
  }
  if (noiseDb !== null) {
    const a = Math.pow(10, noiseDb / 20);
    for (let i = 0; i < n; i++) drums[i] += (rnd() * 2 - 1) * a * 1.732;
  }
  const st = (m) => [m, Float32Array.from(m)];
  return { tracks: { drums: st(drums), pad: st(pad), bass: st(bass), shaker: st(shaker), bass8: st(bass8) }, beats, bars, sr, duration, bpm, firstBeat, beatsPerBar: P.beatsPerBar };
}

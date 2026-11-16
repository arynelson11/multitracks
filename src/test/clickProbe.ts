// Sonda de click pros testes: lê o WAV gerado, acha cada click no áudio e mede
// o erro contra a grade real da música sintética. Porte em TypeScript de
// `detectClicks` e `evaluate` (scripts/verify-click/harness.mjs) e do leitor de
// WAV (scripts/verify-click/wav.mjs), sem dependência de Node.

export interface WavData {
  sampleRate: number;
  numberOfChannels: number;
  frames: number;
  bits: number;
  channels: Float32Array[];
}

/** Lê WAV PCM 16/24/32 bits e float32. */
export function parseWav(buffer: ArrayBuffer): WavData {
  const dv = new DataView(buffer);
  const tag = (o: number) => String.fromCharCode(dv.getUint8(o), dv.getUint8(o + 1), dv.getUint8(o + 2), dv.getUint8(o + 3));
  if (tag(0) !== 'RIFF' || tag(8) !== 'WAVE') throw new Error('não é WAV');
  let off = 12;
  let fmt: { format: number; channels: number; sampleRate: number; bits: number } | null = null;
  let dataOff = -1;
  let dataLen = 0;
  while (off + 8 <= dv.byteLength) {
    const id = tag(off);
    const size = dv.getUint32(off + 4, true);
    if (id === 'fmt ') {
      fmt = {
        format: dv.getUint16(off + 8, true),
        channels: dv.getUint16(off + 10, true),
        sampleRate: dv.getUint32(off + 12, true),
        bits: dv.getUint16(off + 22, true),
      };
    } else if (id === 'data') {
      dataOff = off + 8;
      dataLen = Math.min(size, dv.byteLength - dataOff);
    }
    off += 8 + size + (size & 1);
  }
  if (!fmt || dataOff < 0) throw new Error('WAV sem fmt/data');
  const bps = fmt.bits / 8;
  const frames = Math.floor(dataLen / (bps * fmt.channels));
  const ch: Float32Array[] = [];
  for (let c = 0; c < fmt.channels; c++) ch.push(new Float32Array(frames));
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < fmt.channels; c++) {
      const p = dataOff + (i * fmt.channels + c) * bps;
      let v: number;
      if (fmt.format === 3 && fmt.bits === 32) v = dv.getFloat32(p, true);
      else if (fmt.bits === 16) v = dv.getInt16(p, true) / 32768;
      else if (fmt.bits === 24) {
        let x = dv.getUint8(p) | (dv.getUint8(p + 1) << 8) | (dv.getUint8(p + 2) << 16);
        if (x & 0x800000) x |= ~0xffffff;
        v = x / 8388608;
      } else if (fmt.bits === 32) v = dv.getInt32(p, true) / 2147483648;
      else throw new Error(`bits não suportado: ${fmt.bits}`);
      ch[c][i] = v;
    }
  }
  return { sampleRate: fmt.sampleRate, numberOfChannels: fmt.channels, frames, bits: fmt.bits, channels: ch };
}

/** Média dos canais (mesma conta do `mono` do harness). */
export function mixToMono(channels: readonly Float32Array[]): Float32Array {
  const frames = channels[0]?.length ?? 0;
  const m = new Float32Array(frames);
  for (const ch of channels) for (let i = 0; i < frames; i++) m[i] += ch[i] / channels.length;
  return m;
}

export interface DetectedClick {
  /** Início audível, em segundos: 1ª amostra a -20 dB (10%) do pico local do golpe. */
  t: number;
  peak: number;
}

/** Acha cada click: início audível = 1ª amostra >= -20 dB do pico local do golpe. */
export function detectClicks(x: Float32Array, sr: number): DetectedClick[] {
  const out: DetectedClick[] = [];
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

function nearest(arr: readonly DetectedClick[], t: number): DetectedClick {
  let lo = 0;
  let hi = arr.length - 1;
  while (hi - lo > 1) {
    const m = (lo + hi) >> 1;
    if (arr[m].t < t) lo = m;
    else hi = m;
  }
  return Math.abs(arr[lo].t - t) <= Math.abs(arr[hi].t - t) ? arr[lo] : arr[hi];
}

/** A grade real da música (o que `makeSong` devolve serve direto). */
export interface ClickTruth {
  bpm: number;
  firstBeat: number;
  /** Todos os tempos reais, em segundos. */
  beats: readonly number[];
  /** Inícios de compasso, em segundos. */
  bars: readonly number[];
  beatsPerBar: number;
  duration: number;
}

export interface ClickEvaluation {
  nClicks: number;
  nBeats: number;
  clicksPerBeat: number;
  /** Erro do click mais perto do 1º tempo, em ms (positivo = click atrasado). */
  first: number;
  firstClickAt: number;
  /** Erro do 1º click do arquivo contra a grade real estendida pra trás, em ms. */
  firstClickGridErr: number;
  mean: number;
  signedMean: number;
  max: number;
  lastErr: number;
  /** Tempos sem click a menos de 1/4 de tempo. */
  far: number;
  hasAccent: boolean;
  /** % dos compassos com o click acentuado no 1. */
  accentOn1: number;
  accentWrong: number;
  /** Em que tempo do compasso real o acento cai: tempo (1, 2, ...) ou 'fora' -> quantos clicks. */
  accentPos: Record<string, number>;
}

/** Compara os clicks achados no áudio com a grade real (mesmas contas do harness, em ms). */
export function evaluate(clicks: readonly DetectedClick[], song: ClickTruth): ClickEvaluation {
  if (!clicks.length) throw new Error('nenhum click no áudio');
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
  const isAcc = (c: DetectedClick) => hasAccent && c.peak >= 0.85 * maxPk;
  const accClicks = clicks.filter(isAcc);
  const barSet = song.bars;
  let barsAcc = 0;
  let barsChecked = 0;
  for (let b = 0; b < barSet.length; b++) {
    const c = nearest(clicks, barSet[b]);
    if (Math.abs(c.t - barSet[b]) > 0.25 * beatDur) continue;
    barsChecked++;
    if (isAcc(c)) barsAcc++;
  }
  // Em que tempo do compasso real o acento cai (moda)
  const posHist = new Map<string, number>();
  for (const c of accClicks) {
    const beatPos = Math.round((c.t - song.firstBeat) / beatDur);
    const p = ((beatPos % song.beatsPerBar) + song.beatsPerBar) % song.beatsPerBar;
    const key = Math.abs((c.t - song.firstBeat) / beatDur - beatPos) > 0.25 ? 'fora' : String(p + 1);
    posHist.set(key, (posHist.get(key) || 0) + 1);
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

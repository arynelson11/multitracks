// Etapa 1 do detector de tempo: ataques (onsets) por banda.
//
// Função de onset = subida de energia a ~200 quadros/s, sem o "chão" local e
// suavizada (ver cleanOnsets). Sai uma por banda:
// - `full` (banda cheia) e `low` (grave de 150 Hz), comprimidas em log: período,
//   fase e o "1" saem delas.
// - `kick` (bumbo) e `snare` (caixa), em energia linear: a etapa de tempo x
//   contratempo compara as duas em cima da grade. Linear porque o log iguala
//   golpe forte e fraco (o chimbal quase empata com a caixa).

const TARGET_FPS = 200;

/** Bumbo presente quando a banda abaixo de ~100 Hz tem pelo menos isto da energia da faixa. */
const KICK_MIN_SHARE = 0.1;
/** Caixa presente quando o corpo (150 a 300 Hz) e o ruído (acima de 2 kHz) têm, cada um, pelo menos isto da energia. */
const SNARE_MIN_SHARE = 0.02;

/**
 * O pico da função de onset aparece ~1,5 quadro antes do ataque (a janela tem 2
 * hops e compara com a anterior). Medido no teste sintético de calibração.
 */
export const ONSET_LAG_FRAMES = 1.5;

/** Funções de onset de uma faixa, todas com o mesmo tamanho e a mesma taxa. */
export interface OnsetBands {
  /** Quadros por segundo (taxa de amostragem / hop). */
  fps: number;
  /** Banda cheia. */
  full: Float32Array;
  /** Banda grave (passa-baixa de 1 polo em 150 Hz). */
  low: Float32Array;
  /** Bumbo: passa-baixa de 2 polos em 100 Hz, energia linear. Zeros quando `hasKick` é false. */
  kick: Float32Array;
  /**
   * Caixa: o ataque sai do ruído acima de 2 kHz (passa-alta de 2 polos), energia
   * linear. Zeros quando `hasSnare` é false.
   */
  snare: Float32Array;
  /** A faixa tem bumbo (energia abaixo de ~100 Hz). */
  hasKick: boolean;
  /** A faixa tem caixa: corpo de 150 a 300 Hz somado a ruído acima de 2 kHz. */
  hasSnare: boolean;
}

/** Coeficientes de um biquad de 2 polos (Butterworth, receita RBJ), já divididos por a0. */
interface Biquad {
  b0: number;
  b1: number;
  b2: number;
  a1: number;
  a2: number;
}

function biquad(type: 'lowpass' | 'highpass', f0: number, sampleRate: number): Biquad {
  const w0 = (2 * Math.PI * f0) / sampleRate;
  const cw = Math.cos(w0);
  const alpha = Math.sin(w0) / (2 * Math.SQRT1_2);
  const k = type === 'lowpass' ? (1 - cw) / 2 : (1 + cw) / 2;
  const a0 = 1 + alpha;
  return {
    b0: k / a0,
    b1: (type === 'lowpass' ? 2 * k : -2 * k) / a0,
    b2: k / a0,
    a1: (-2 * cw) / a0,
    a2: (1 - alpha) / a0,
  };
}

// Subida da energia em log. Antes do arquivo é silêncio (`prev` começa em 0):
// o golpe em 0,000 conta como ataque.
function onsetEnvelope(energy: Float32Array): Float32Array {
  let max = 0;
  for (let i = 0; i < energy.length; i++) if (energy[i] > max) max = energy[i];
  const out = new Float32Array(energy.length);
  if (max <= 0) return out;
  let prev = 0;
  for (let i = 0; i < energy.length; i++) {
    const cur = Math.log1p((1000 * energy[i]) / max);
    const d = cur - prev;
    out[i] = d > 0 ? d : 0;
    prev = cur;
  }
  return out;
}

// Subida da energia em escala linear (proporção do máximo), também a partir do silêncio.
function linearOnsetEnvelope(energy: Float32Array): Float32Array {
  let max = 0;
  for (let i = 0; i < energy.length; i++) if (energy[i] > max) max = energy[i];
  const out = new Float32Array(energy.length);
  if (max <= 0) return out;
  let prev = 0;
  for (let i = 0; i < energy.length; i++) {
    const cur = energy[i] / max;
    const d = cur - prev;
    out[i] = d > 0 ? d : 0;
    prev = cur;
  }
  return out;
}

// Tira o "chão" (média local de ~0,4 s) e suaviza com gaussiana de ~7 ms, pra
// tolerar a variação humana de alguns ms em cada batida.
function cleanOnsets(o: Float32Array, fps: number): Float32Array {
  const n = o.length;
  const half = Math.max(1, Math.round(fps * 0.2));
  const prefix = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) prefix[i + 1] = prefix[i] + o[i];
  const floored = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - half);
    const b = Math.min(n, i + half + 1);
    const v = o[i] - (prefix[b] - prefix[a]) / (b - a);
    floored[i] = v > 0 ? v : 0;
  }
  const sigma = 1.5;
  const radius = 4;
  const kernel: number[] = [];
  let ksum = 0;
  for (let k = -radius; k <= radius; k++) {
    const w = Math.exp(-0.5 * (k / sigma) ** 2);
    kernel.push(w);
    ksum += w;
  }
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let k = -radius; k <= radius; k++) {
      const j = i + k;
      if (j >= 0 && j < n) s += floored[j] * kernel[k + radius];
    }
    out[i] = s / ksum;
  }
  return out;
}

/** Valor da onset no quadro fracionário `x` (interpolação linear; 0 fora do array). */
export function sampleAt(o: Float32Array, x: number): number {
  if (x < 0 || x > o.length - 1) return 0;
  const i = Math.floor(x);
  const f = x - i;
  return i + 1 < o.length ? o[i] * (1 - f) + o[i + 1] * f : o[i];
}

/** Média da onset nos pontos phase + k*period, em quadros (a "afinação" da grade). */
export function combScore(o: Float32Array, period: number, phase: number): number {
  let s = 0;
  let c = 0;
  for (let x = phase; x < o.length; x += period) {
    s += sampleAt(o, x);
    c++;
  }
  return c > 0 ? s / c : 0;
}

/**
 * Funções de onset de uma faixa (os canais são somados em mono). `null` quando
 * não dá pra medir nada confiável: sem áudio, taxa inválida ou menos de 4 s.
 */
export function onsetBands(channels: Float32Array[], sampleRate: number): OnsetBands | null {
  if (!channels.length || !channels[0].length || sampleRate <= 0) return null;

  const hop = Math.max(1, Math.round(sampleRate / TARGET_FPS));
  const fps = sampleRate / hop;
  const len = channels[0].length;
  const chunks = Math.floor(len / hop);
  if (chunks < fps * 4) return null;

  // Energia por hop: banda cheia, grave ~150 Hz (o "1"), bumbo abaixo de ~100 Hz,
  // corpo da caixa (150 a 300 Hz) e ruído acima de 2 kHz.
  const cAll = new Float32Array(chunks);
  const cLow = new Float32Array(chunks);
  const cKick = new Float32Array(chunks);
  const cBody = new Float32Array(chunks);
  const cNoise = new Float32Array(chunks);
  const a = Math.exp((-2 * Math.PI * 150) / sampleRate);
  // Os quatro filtros ficam escritos no laço (estado em variáveis locais): com uma
  // função por amostra a análise ficava ~2,5 vezes mais lenta.
  const { b0: kb0, b1: kb1, b2: kb2, a1: ka1, a2: ka2 } = biquad('lowpass', 100, sampleRate);
  const { b0: hb0, b1: hb1, b2: hb2, a1: ha1, a2: ha2 } = biquad('highpass', 150, sampleRate);
  const { b0: lb0, b1: lb1, b2: lb2, a1: la1, a2: la2 } = biquad('lowpass', 300, sampleRate);
  const { b0: nb0, b1: nb1, b2: nb2, a1: na1, a2: na2 } = biquad('highpass', 2000, sampleRate);
  let kx1 = 0, kx2 = 0, ky1 = 0, ky2 = 0;
  let hx1 = 0, hx2 = 0, hy1 = 0, hy2 = 0;
  let lx1 = 0, lx2 = 0, ly1 = 0, ly2 = 0;
  let nx1 = 0, nx2 = 0, ny1 = 0, ny2 = 0;
  const nCh = channels.length;
  let lp = 0;
  for (let j = 0; j < chunks; j++) {
    let sAll = 0;
    let sLow = 0;
    let sKick = 0;
    let sBody = 0;
    let sNoise = 0;
    const base = j * hop;
    for (let i = 0; i < hop; i++) {
      let x = 0;
      for (let c = 0; c < nCh; c++) x += channels[c][base + i];
      x /= nCh;
      lp = (1 - a) * x + a * lp;
      sAll += x * x;
      sLow += lp * lp;
      // bumbo: passa-baixa em 100 Hz
      const ky = kb0 * x + kb1 * kx1 + kb2 * kx2 - ka1 * ky1 - ka2 * ky2;
      kx2 = kx1; kx1 = x; ky2 = ky1; ky1 = ky;
      sKick += ky * ky;
      // corpo da caixa: passa-alta em 150 Hz e passa-baixa em 300 Hz
      const hy = hb0 * x + hb1 * hx1 + hb2 * hx2 - ha1 * hy1 - ha2 * hy2;
      hx2 = hx1; hx1 = x; hy2 = hy1; hy1 = hy;
      const ly = lb0 * hy + lb1 * lx1 + lb2 * lx2 - la1 * ly1 - la2 * ly2;
      lx2 = lx1; lx1 = hy; ly2 = ly1; ly1 = ly;
      sBody += ly * ly;
      // ruído da caixa: passa-alta em 2 kHz
      const ny = nb0 * x + nb1 * nx1 + nb2 * nx2 - na1 * ny1 - na2 * ny2;
      nx2 = nx1; nx1 = x; ny2 = ny1; ny1 = ny;
      sNoise += ny * ny;
    }
    cAll[j] = sAll;
    cLow[j] = sLow;
    cKick[j] = sKick;
    cBody[j] = sBody;
    cNoise[j] = sNoise;
  }
  // Janela de 2 hops por quadro.
  const frames = chunks - 1;
  const eAll = new Float32Array(frames);
  const eLow = new Float32Array(frames);
  const eKick = new Float32Array(frames);
  const eNoise = new Float32Array(frames);
  let totAll = 0;
  let totKick = 0;
  let totBody = 0;
  let totNoise = 0;
  for (let n = 0; n < frames; n++) {
    eAll[n] = cAll[n] + cAll[n + 1];
    eLow[n] = cLow[n] + cLow[n + 1];
    eKick[n] = cKick[n] + cKick[n + 1];
    eNoise[n] = cNoise[n] + cNoise[n + 1];
    totAll += eAll[n];
    totKick += eKick[n];
    totBody += cBody[n] + cBody[n + 1];
    totNoise += eNoise[n];
  }
  const full = cleanOnsets(onsetEnvelope(eAll), fps);
  const low = cleanOnsets(onsetEnvelope(eLow), fps);
  // Presença pela fatia da energia da faixa: o chimbal (só agudo) não vira caixa
  // e o bumbo (vaza em 150 a 300 Hz, mas não tem ruído agudo) também não. O ataque
  // da caixa sai só do ruído agudo porque o bumbo, que começa em ~140 Hz, sobe junto
  // na banda de 150 a 300 Hz e empataria tempo e contratempo numa levada sincopada.
  const hasKick = totAll > 0 && totKick / totAll >= KICK_MIN_SHARE;
  const hasSnare = totAll > 0 && totBody / totAll >= SNARE_MIN_SHARE && totNoise / totAll >= SNARE_MIN_SHARE;
  const kick = hasKick ? cleanOnsets(linearOnsetEnvelope(eKick), fps) : new Float32Array(frames);
  const snare = hasSnare ? cleanOnsets(linearOnsetEnvelope(eNoise), fps) : new Float32Array(frames);
  return { fps, full, low, kick, snare, hasKick, hasSnare };
}

// Divide pelo máximo (array zerado continua zerado).
function normalized(o: Float32Array, n: number): Float32Array {
  let max = 0;
  for (let i = 0; i < n; i++) if (o[i] > max) max = o[i];
  const out = new Float32Array(n);
  if (max > 0) for (let i = 0; i < n; i++) out[i] = o[i] / max;
  return out;
}

/**
 * Junta os ataques de várias faixas de pulso (kit separado: KICK, SNARE, HIHAT):
 * cada banda de cada faixa dividida pelo próprio máximo e somadas banda a banda,
 * no tamanho da mais curta. Com uma faixa só, devolve ela mesma (sem dividir).
 * Todas precisam ter a mesma taxa (`fps`).
 */
export function sumOnsetBands(list: readonly OnsetBands[]): OnsetBands {
  if (!list.length) throw new Error('sumOnsetBands: nenhuma faixa');
  if (list.length === 1) return list[0];
  const { fps } = list[0];
  if (list.some(b => b.fps !== fps)) throw new Error('sumOnsetBands: faixas com taxas diferentes');
  const n = Math.min(...list.map(b => b.full.length));
  const sum = (pick: (b: OnsetBands) => Float32Array) => {
    const out = new Float32Array(n);
    for (const b of list) {
      const o = normalized(pick(b), n);
      for (let i = 0; i < n; i++) out[i] += o[i];
    }
    return out;
  };
  return {
    fps,
    full: sum(b => b.full),
    low: sum(b => b.low),
    kick: sum(b => b.kick),
    snare: sum(b => b.snare),
    hasKick: list.some(b => b.hasKick),
    hasSnare: list.some(b => b.hasSnare),
  };
}

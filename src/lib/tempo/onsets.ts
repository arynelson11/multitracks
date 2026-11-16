// Etapa 1 do detector de tempo: ataques (onsets) por banda.
//
// Função de onset = subida de energia, comprimida em log, a ~200 quadros/s, sem
// o "chão" local e suavizada (ver cleanOnsets). Sai uma por banda: cheia e grave
// (~150 Hz, pro bumbo). `kick` e `snare` são as bandas que a etapa de tempo x
// contratempo vai usar; na M1 ainda são cópias de `low` e `full` (a M2 troca
// pelos filtros próprios do bumbo e da caixa).

const TARGET_FPS = 200;

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
  /** Bumbo. M1: o mesmo array de `low`. */
  kick: Float32Array;
  /** Caixa. M1: o mesmo array de `full`. */
  snare: Float32Array;
}

function onsetEnvelope(energy: Float32Array): Float32Array {
  let max = 0;
  for (let i = 0; i < energy.length; i++) if (energy[i] > max) max = energy[i];
  const out = new Float32Array(energy.length);
  if (max <= 0) return out;
  let prev = Math.log1p((1000 * energy[0]) / max);
  for (let i = 1; i < energy.length; i++) {
    const cur = Math.log1p((1000 * energy[i]) / max);
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

  // Energia por hop (banda cheia e banda grave ~150 Hz pro bumbo).
  const cAll = new Float32Array(chunks);
  const cLow = new Float32Array(chunks);
  const a = Math.exp((-2 * Math.PI * 150) / sampleRate);
  const nCh = channels.length;
  let lp = 0;
  for (let j = 0; j < chunks; j++) {
    let sAll = 0;
    let sLow = 0;
    const base = j * hop;
    for (let i = 0; i < hop; i++) {
      let x = 0;
      for (let c = 0; c < nCh; c++) x += channels[c][base + i];
      x /= nCh;
      lp = (1 - a) * x + a * lp;
      sAll += x * x;
      sLow += lp * lp;
    }
    cAll[j] = sAll;
    cLow[j] = sLow;
  }
  // Janela de 2 hops por quadro.
  const frames = chunks - 1;
  const eAll = new Float32Array(frames);
  const eLow = new Float32Array(frames);
  for (let n = 0; n < frames; n++) {
    eAll[n] = cAll[n] + cAll[n + 1];
    eLow[n] = cLow[n] + cLow[n + 1];
  }
  const full = cleanOnsets(onsetEnvelope(eAll), fps);
  const low = cleanOnsets(onsetEnvelope(eLow), fps);
  return { fps, full, low, kick: low, snare: full };
}

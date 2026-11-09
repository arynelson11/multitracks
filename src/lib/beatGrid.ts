// Grade de tempo da música: BPM preciso + onde cai o primeiro tempo.
//
// Por que existe: o metrônomo do Separador era gerado com o 1º click colado em
// 0:00.000 do arquivo e com BPM inteiro digitado à mão. Música real quase nunca
// tem um tempo exatamente em 0:00, e meio BPM de erro vira ~0,75 s de atraso no
// fim de uma música de 3 min. Resultado: click "fora". Aqui a gente mede a grade
// direto do áudio (de preferência da bateria) pra o click nascer alinhado.
//
// Método: função de onset (subida de energia, comprimida em log) a ~200 quadros/s,
// tempo aproximado por autocorrelação e depois busca fina conjunta de período +
// fase maximizando a energia de onset que cai em cima da grade na música INTEIRA
// (é isso que mata a deriva). O tempo forte (o "1") sai da banda grave (bumbo).

export interface BeatGrid {
  /** BPM preciso (ex.: 119.87). */
  bpm: number;
  /** Segundos do primeiro tempo da grade, sempre em [0, 60/bpm). */
  firstBeat: number;
  /** Qual tempo (contado a partir de firstBeat, 0..beatsPerBar-1) é o "1" do compasso. */
  downbeat: number;
  /** 0..1. Abaixo de ~0.15 a música não tem pulso claro (o click ainda sai no BPM pedido). */
  confidence: number;
}

export interface BeatGridOptions {
  /** BPM de referência (do usuário). Se vier, só refina em volta dele (±0,8%). */
  nearBpm?: number;
  /** Tempos por compasso, pra achar o "1". Padrão 4. */
  beatsPerBar?: number;
}

const TARGET_FPS = 200;
// O pico da função de onset aparece ~1,5 quadro antes do ataque (a janela tem 2
// hops e compara com a anterior). Medido no teste sintético de calibração.
const ONSET_LAG_FRAMES = 1.5;

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

function sampleAt(o: Float32Array, x: number): number {
  if (x < 0 || x > o.length - 1) return 0;
  const i = Math.floor(x);
  const f = x - i;
  return i + 1 < o.length ? o[i] * (1 - f) + o[i + 1] * f : o[i];
}

// Soma média da onset nos pontos phase + k*period (a "afinação" da grade).
function combScore(o: Float32Array, period: number, phase: number): number {
  let s = 0;
  let c = 0;
  for (let x = phase; x < o.length; x += period) {
    s += sampleAt(o, x);
    c++;
  }
  return c > 0 ? s / c : 0;
}

function estimateTempo(o: Float32Array, fps: number): number {
  const minLag = Math.floor((fps * 60) / 200);
  const maxLag = Math.ceil((fps * 60) / 55);
  const n = o.length;
  let mean = 0;
  for (let i = 0; i < n; i++) mean += o[i];
  mean /= n || 1;
  let bestLag = Math.round((fps * 60) / 110);
  let best = -Infinity;
  for (let lag = minLag; lag <= maxLag; lag++) {
    let s = 0;
    for (let i = 0; i + lag < n; i++) s += (o[i] - mean) * (o[i + lag] - mean);
    s /= n - lag;
    const bpm = (fps * 60) / lag;
    // Preferência suave por andamentos comuns (centro 110 BPM, 1 oitava de desvio)
    // pra decidir entre 60 e 120, 80 e 160 etc. O usuário ainda tem 2× e ½×.
    const prior = Math.exp(-0.5 * (Math.log2(bpm / 110) / 1.0) ** 2);
    const score = s * prior;
    if (score > best) {
      best = score;
      bestLag = lag;
    }
  }
  return (fps * 60) / bestLag;
}

export function detectBeatGrid(
  channels: Float32Array[],
  sampleRate: number,
  opts: BeatGridOptions = {}
): BeatGrid {
  const beatsPerBar = Math.max(1, opts.beatsPerBar ?? 4);
  const fallback: BeatGrid = { bpm: opts.nearBpm ?? 120, firstBeat: 0, downbeat: 0, confidence: 0 };
  if (!channels.length || !channels[0].length || sampleRate <= 0) return fallback;

  const hop = Math.max(1, Math.round(sampleRate / TARGET_FPS));
  const fps = sampleRate / hop;
  const len = channels[0].length;
  const chunks = Math.floor(len / hop);
  if (chunks < fps * 4) return fallback; // menos de 4 s: não dá pra medir nada confiável

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
  const o = cleanOnsets(onsetEnvelope(eAll), fps);
  const oLow = cleanOnsets(onsetEnvelope(eLow), fps);

  const roughBpm = opts.nearBpm && opts.nearBpm > 0 ? opts.nearBpm : estimateTempo(o, fps);
  const range = opts.nearBpm ? 0.008 : 0.025;
  const P0 = (fps * 60) / roughBpm;

  // Busca grossa: período em passos de 0,05% e fase em passos de 1 quadro.
  let bestP = P0;
  let bestPhase = 0;
  let best = -Infinity;
  const coarseStep = P0 * 0.0005;
  for (let P = P0 * (1 - range); P <= P0 * (1 + range); P += coarseStep) {
    for (let ph = 0; ph < P; ph += 1) {
      const s = combScore(o, P, ph);
      if (s > best) {
        best = s;
        bestP = P;
        bestPhase = ph;
      }
    }
  }
  // Busca fina em volta do melhor ponto. A grade é ancorada no tempo mais perto
  // do MEIO da música: assim mexer no período gira a grade em torno do centro em
  // vez de arrastar o começo. Ancorando no início, período e fase se compensavam
  // (grade certa no meio, ~13 ms adiantada no começo: visto no teste sintético).
  const mid = o.length / 2;
  const anchor0 = bestPhase + Math.round((mid - bestPhase) / bestP) * bestP;
  const fineP0 = bestP;
  let bestAnchor = anchor0;
  for (let P = fineP0 - 2 * coarseStep; P <= fineP0 + 2 * coarseStep; P += coarseStep / 10) {
    for (let an = anchor0 - 3; an <= anchor0 + 3; an += 0.1) {
      const ph = ((an % P) + P) % P;
      const s = combScore(o, P, ph);
      if (s > best) {
        best = s;
        bestP = P;
        bestAnchor = an;
      }
    }
  }
  bestPhase = ((bestAnchor % bestP) + bestP) % bestP;

  // Confiança: quanto a melhor fase se destaca da média das fases nesse período.
  let phaseMean = 0;
  let phaseCount = 0;
  for (let ph = 0; ph < bestP; ph += 1) {
    phaseMean += combScore(o, bestP, ph);
    phaseCount++;
  }
  phaseMean /= phaseCount || 1;
  const confidence = best > 0 ? Math.max(0, Math.min(1, (best - phaseMean) / best)) : 0;

  const period = bestP / fps;
  const bpm = 60 / period;
  let firstBeat = (bestPhase + ONSET_LAG_FRAMES) / fps;
  firstBeat = ((firstBeat % period) + period) % period;

  // O "1": posição do compasso com mais energia de bumbo. Em compasso par o bumbo
  // costuma cair no 1 E no 3 (empate), então o desempate é onde a música começa:
  // introdução quase sempre entra no tempo 1.
  const barSums = new Array(beatsPerBar).fill(0);
  const beatOnsets: number[] = [];
  for (let k = 0; ; k++) {
    const x = (firstBeat + k * period) * fps - ONSET_LAG_FRAMES;
    if (x > oLow.length - 1) break;
    barSums[k % beatsPerBar] += sampleAt(oLow, x);
    beatOnsets.push(sampleAt(o, x));
  }
  let downbeat = 0;
  for (let m = 1; m < beatsPerBar; m++) if (barSums[m] > barSums[downbeat]) downbeat = m;
  if (beatsPerBar % 2 === 0 && beatOnsets.length > 0) {
    const sorted = [...beatOnsets].sort((x, y) => x - y);
    const strong = sorted[Math.floor(sorted.length * 0.9)] * 0.3;
    const startBeat = beatOnsets.findIndex(v => v > strong);
    const alt = (downbeat + beatsPerBar / 2) % beatsPerBar;
    const pairClose = Math.abs(barSums[alt] - barSums[downbeat]) < 0.35 * barSums[downbeat];
    if (pairClose && startBeat >= 0 && startBeat % beatsPerBar === alt) downbeat = alt;
  }

  return { bpm: Math.round(bpm * 100) / 100, firstBeat, downbeat, confidence };
}

/** BPM pra mostrar: inteiro quando está a menos de 0,05 de um inteiro, senão 1 casa. */
export function formatBpm(bpm: number): string {
  const r = Math.round(bpm);
  return Math.abs(bpm - r) < 0.05 ? String(r) : bpm.toFixed(1);
}

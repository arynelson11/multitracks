const KEYS = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

// Krumhansl-Schmuckler key profiles
const MAJOR_PROFILE = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MINOR_PROFILE = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

export function detectKey(buffer: AudioBuffer): string {
  const sampleRate = buffer.sampleRate;
  const downsample = 8;
  const effSampleRate = sampleRate / downsample;

  // Mix to mono
  const ch0 = buffer.getChannelData(0);
  let mono: Float32Array;
  if (buffer.numberOfChannels >= 2) {
    const ch1 = buffer.getChannelData(1);
    mono = new Float32Array(ch0.length);
    for (let i = 0; i < ch0.length; i++) mono[i] = (ch0[i] + ch1[i]) * 0.5;
  } else {
    mono = new Float32Array(ch0);
  }

  // Downsample and use first 20 seconds
  const maxLen = Math.min(mono.length, Math.floor(sampleRate * 20));
  const downLen = Math.floor(maxLen / downsample);
  const signal = new Float32Array(downLen);
  for (let i = 0; i < downLen; i++) signal[i] = mono[i * downsample];

  // Chromagram via Goertzel algorithm (octaves 2–6)
  const chromagram = new Float32Array(12);
  for (let pc = 0; pc < 12; pc++) {
    let energy = 0;
    for (let octave = 2; octave <= 6; octave++) {
      const freq = 261.63 * Math.pow(2, octave - 4 + pc / 12);
      if (freq >= effSampleRate / 2) continue;
      const omega = 2 * Math.PI * freq / effSampleRate;
      const coeff = 2 * Math.cos(omega);
      let s1 = 0, s2 = 0;
      for (let n = 0; n < downLen; n++) {
        const s0 = signal[n] + coeff * s1 - s2;
        s2 = s1;
        s1 = s0;
      }
      energy += s1 * s1 + s2 * s2 - coeff * s1 * s2;
    }
    chromagram[pc] = energy;
  }

  // Pearson correlation
  function pearson(a: number[], b: number[]): number {
    const n = a.length;
    let sumA = 0, sumB = 0;
    for (let i = 0; i < n; i++) { sumA += a[i]; sumB += b[i]; }
    const mA = sumA / n, mB = sumB / n;
    let num = 0, vA = 0, vB = 0;
    for (let i = 0; i < n; i++) {
      const da = a[i] - mA, db = b[i] - mB;
      num += da * db; vA += da * da; vB += db * db;
    }
    return num / (Math.sqrt(vA * vB) || 1);
  }

  let bestKey = 'C';
  let bestScore = -Infinity;
  for (let root = 0; root < 12; root++) {
    const rotated = Array.from({ length: 12 }, (_, i) => chromagram[(root + i) % 12]);
    const score = Math.max(pearson(rotated, MAJOR_PROFILE), pearson(rotated, MINOR_PROFILE));
    if (score > bestScore) { bestScore = score; bestKey = KEYS[root]; }
  }
  return bestKey;
}

// Converte um AudioBuffer em um arquivo Wav (Blob) que pode ser tocado pelo navegador.
function audioBufferToWavBlob(buffer: AudioBuffer): Blob {
  const numOfChan = buffer.numberOfChannels;
  const length = buffer.length * numOfChan * 2 + 44;
  const bufferArray = new ArrayBuffer(length);
  const view = new DataView(bufferArray);
  const channels = [];
  let offset = 0;
  let pos = 0;
  let i;
  let sample;

  function setUint16(data: number) {
    view.setUint16(offset, data, true);
    offset += 2;
  }
  function setUint32(data: number) {
    view.setUint32(offset, data, true);
    offset += 4;
  }

  // Header RIFF
  setUint32(0x46464952); // "RIFF"
  setUint32(length - 8); // file length - 8
  setUint32(0x45564157); // "WAVE"
  setUint32(0x20746d66); // "fmt "
  setUint32(16);         // length
  setUint16(1);          // PCM
  setUint16(numOfChan);
  setUint32(buffer.sampleRate);
  setUint32(buffer.sampleRate * 2 * numOfChan); // avg bytes
  setUint16(numOfChan * 2); // block align
  setUint16(16);         // 16-bit
  setUint32(0x61746164); // "data"
  setUint32(length - pos - 4); // chunk length

  for (i = 0; i < buffer.numberOfChannels; i++) {
    channels.push(buffer.getChannelData(i));
  }

  while (pos < buffer.length) {
    for (i = 0; i < numOfChan; i++) {
      sample = Math.max(-1, Math.min(1, channels[i][pos]));
      sample = (0.5 + sample < 0 ? sample * 32768 : sample * 32767) | 0;
      view.setInt16(offset, sample, true);
      offset += 2;
    }
    pos++;
  }

  return new Blob([bufferArray], { type: "audio/wav" });
}

// ═══════════════════════════════════════════════════════════════════════
// NOVO ALGORITMO DE DETECÇÃO DE BPM — Spectral Flux + Autocorrelação
// ═══════════════════════════════════════════════════════════════════════

/**
 * Detecta BPM usando Spectral Flux Onset Detection + Autocorrelação.
 * Muito mais preciso que o music-tempo para faixas reais de bateria/baixo.
 */
function detectBPM(audioBuffer: AudioBuffer): { bpm: number; beats: number[] } {
  const sampleRate = audioBuffer.sampleRate;

  // 1) Mix to mono
  const ch0 = audioBuffer.getChannelData(0);
  let mono: Float32Array;
  if (audioBuffer.numberOfChannels >= 2) {
    const ch1 = audioBuffer.getChannelData(1);
    mono = new Float32Array(ch0.length);
    for (let i = 0; i < ch0.length; i++) mono[i] = (ch0[i] + ch1[i]) * 0.5;
  } else {
    mono = new Float32Array(ch0);
  }

  // 2) Calcular onset envelope via energia em janelas curtas
  const hopSize = Math.round(sampleRate * 0.01); // 10ms hop
  const windowSize = Math.round(sampleRate * 0.023); // ~23ms window
  const numFrames = Math.floor((mono.length - windowSize) / hopSize);
  const onsetEnvelope = new Float32Array(numFrames);

  for (let frame = 0; frame < numFrames; frame++) {
    const start = frame * hopSize;
    let energy = 0;
    for (let j = 0; j < windowSize; j++) {
      const s = mono[start + j];
      energy += s * s;
    }
    onsetEnvelope[frame] = Math.sqrt(energy / windowSize);
  }

  // 3) Diferenciação (half-wave rectification) — detectar apenas subidas de energia
  const diff = new Float32Array(numFrames);
  for (let i = 1; i < numFrames; i++) {
    const d = onsetEnvelope[i] - onsetEnvelope[i - 1];
    diff[i] = d > 0 ? d : 0;
  }

  // 4) Low-pass filter na onset function para suavizar
  const smoothed = new Float32Array(numFrames);
  const smoothWindow = 5;
  for (let i = 0; i < numFrames; i++) {
    let sum = 0;
    let count = 0;
    for (let j = -smoothWindow; j <= smoothWindow; j++) {
      const idx = i + j;
      if (idx >= 0 && idx < numFrames) {
        sum += diff[idx];
        count++;
      }
    }
    smoothed[i] = sum / count;
  }

  // 5) Autocorrelação na onset envelope suavizada
  // Range de BPM: 60-200 BPM
  const framesPerSecond = sampleRate / hopSize;
  const minBPM = 60;
  const maxBPM = 200;
  const minLag = Math.floor(framesPerSecond * 60 / maxBPM);
  const maxLag = Math.ceil(framesPerSecond * 60 / minBPM);

  // Usar apenas uma janela de análise (os primeiros 30s ou toda a música)
  const analysisFrames = Math.min(numFrames, Math.floor(30 * framesPerSecond));
  const autocorr = new Float32Array(maxLag + 1);

  for (let lag = minLag; lag <= maxLag; lag++) {
    let sum = 0;
    let count = 0;
    for (let i = 0; i < analysisFrames - lag; i++) {
      sum += smoothed[i] * smoothed[i + lag];
      count++;
    }
    autocorr[lag] = count > 0 ? sum / count : 0;
  }

  // 6) Encontrar picos na autocorrelação
  interface BpmCandidate {
    bpm: number;
    score: number;
    lag: number;
  }
  const candidates: BpmCandidate[] = [];

  for (let lag = minLag + 1; lag < maxLag; lag++) {
    // Pico local
    if (autocorr[lag] > autocorr[lag - 1] && autocorr[lag] > autocorr[lag + 1]) {
      const bpmVal = (framesPerSecond * 60) / lag;
      candidates.push({ bpm: Math.round(bpmVal), score: autocorr[lag], lag });
    }
  }

  // Ordenar por score
  candidates.sort((a, b) => b.score - a.score);

  if (candidates.length === 0) {
    // Fallback: pegar o lag com maior autocorrelação
    let bestLag = minLag;
    let bestVal = -Infinity;
    for (let lag = minLag; lag <= maxLag; lag++) {
      if (autocorr[lag] > bestVal) {
        bestVal = autocorr[lag];
        bestLag = lag;
      }
    }
    const bpm = Math.round((framesPerSecond * 60) / bestLag);
    return { bpm, beats: generateBeatsFromBPM(bpm, audioBuffer.duration) };
  }

  // 7) Selecionar melhor candidato, preferindo BPMs comuns de música
  // Músicas geralmente ficam entre 80-160 BPM
  let bestBpm = candidates[0].bpm;
  const topScore = candidates[0].score;

  // Verificar se algum candidato no range 80-160 tem score similar (>70% do top)
  for (const c of candidates) {
    if (c.bpm >= 80 && c.bpm <= 170 && c.score > topScore * 0.7) {
      bestBpm = c.bpm;
      break;
    }
  }

  // 8) Verificar harmônicas: se 2x do BPM encontrado tem score alto, pode ser que
  // estamos detectando metade do tempo real
  const doubleBpmLag = Math.round(framesPerSecond * 60 / (bestBpm * 2));
  if (doubleBpmLag >= minLag && doubleBpmLag <= maxLag) {
    const doubleScore = autocorr[doubleBpmLag];
    if (doubleScore > topScore * 0.85 && bestBpm * 2 <= 200) {
      // O dobro é quase tão forte, verificar se faz mais sentido musical
      if (bestBpm < 80) {
        bestBpm = bestBpm * 2;
      }
    }
  }

  // 9) Verificar sub-harmônica: se metade do BPM tem score alto, pode ser que
  // estamos detectando o dobro
  const halfBpmLag = Math.round(framesPerSecond * 60 / (bestBpm / 2));
  if (halfBpmLag >= minLag && halfBpmLag <= maxLag) {
    const halfScore = autocorr[halfBpmLag];
    if (halfScore > topScore * 0.85 && bestBpm > 160) {
      bestBpm = Math.round(bestBpm / 2);
    }
  }

  // 10) Refinar com resolução mais fina em torno do candidato
  const refinedBpm = refineBPM(smoothed, analysisFrames, framesPerSecond, bestBpm);

  // 11) Gerar posições de beats
  const beats = generateBeatsFromBPM(refinedBpm, audioBuffer.duration);

  return { bpm: refinedBpm, beats };
}

/**
 * Refina o BPM com resolução de 0.5 BPM em torno do valor candidato
 */
function refineBPM(
  envelope: Float32Array,
  analysisFrames: number,
  framesPerSecond: number,
  roughBpm: number
): number {
  let bestBpm = roughBpm;
  let bestScore = -Infinity;

  // Testar BPMs com resolução de 0.5 num range de ±5 BPM
  for (let bpmTest = roughBpm - 5; bpmTest <= roughBpm + 5; bpmTest += 0.5) {
    if (bpmTest < 40 || bpmTest > 250) continue;
    const lag = framesPerSecond * 60 / bpmTest;
    const lagFloor = Math.floor(lag);
    const lagCeil = lagFloor + 1;
    const frac = lag - lagFloor;

    // Interpolação linear da autocorrelação
    let sum = 0;
    let count = 0;
    for (let i = 0; i < analysisFrames - lagCeil; i++) {
      const valFloor = envelope[i] * envelope[i + lagFloor];
      const valCeil = envelope[i] * envelope[i + lagCeil];
      sum += valFloor * (1 - frac) + valCeil * frac;
      count++;
    }
    const score = count > 0 ? sum / count : 0;

    if (score > bestScore) {
      bestScore = score;
      bestBpm = bpmTest;
    }
  }

  return Math.round(bestBpm);
}

/**
 * Gera posições de beats uniformemente espaçadas a partir do BPM
 */
function generateBeatsFromBPM(bpm: number, duration: number): number[] {
  const secondsPerBeat = 60 / bpm;
  const beats: number[] = [];
  let t = 0;
  while (t < duration) {
    beats.push(t);
    t += secondsPerBeat;
  }
  return beats;
}

// Gera posições de click a partir de beats detectados + extrapolação
function buildClickPositions(beats: number[], bpm: number, duration: number): number[] {
  const secondsPerBeat = 60 / bpm;
  const positions: number[] = [];

  if (beats.length > 0) {
    // Extrapolate backward from first beat to t=0
    let t = beats[0];
    while (t - secondsPerBeat >= -0.01) {
      t -= secondsPerBeat;
      if (t >= 0) positions.push(t);
    }
    // Add all detected beats
    for (const b of beats) {
      if (b < duration) positions.push(b);
    }
    // Extrapolate forward from last beat
    const lastBeat = beats[beats.length - 1];
    t = lastBeat + secondsPerBeat;
    while (t < duration) {
      positions.push(t);
      t += secondsPerBeat;
    }
  } else {
    // No beats detected: pure mathematical grid from 0
    let t = 0;
    while (t < duration) {
      positions.push(t);
      t += secondsPerBeat;
    }
  }

  return positions.sort((a, b) => a - b);
}

function renderClickPositions(positions: number[], duration: number, sampleRate: number): Promise<AudioBuffer> {
  const length = Math.ceil(duration * sampleRate);
  const offlineCtx = new OfflineAudioContext(1, length, sampleRate);
  for (const pos of positions) {
    const osc = offlineCtx.createOscillator();
    const gain = offlineCtx.createGain();
    osc.frequency.setValueAtTime(1000, pos);
    gain.gain.setValueAtTime(0.9, pos);
    gain.gain.exponentialRampToValueAtTime(0.001, pos + 0.05);
    osc.connect(gain);
    gain.connect(offlineCtx.destination);
    osc.start(pos);
    osc.stop(pos + 0.06);
  }
  return offlineCtx.startRendering();
}

// Analisa um AudioBuffer já decodificado (sem precisar de arquivo/URL)
export async function analyzeBufferAndGenerateClick(
  audioBuffer: AudioBuffer,
  onProgress: (msg: string) => void
): Promise<{ bpm: number, clickTrackUrl: string }> {
  try {
    onProgress("Preparando áudio para análise...");

    onProgress("Analisando os tempos da música (onset detection + autocorrelação)...");

    const { bpm, beats } = detectBPM(audioBuffer);

    onProgress(`BPM detectado: ${bpm}. Gerando click sincronizado...`);

    const positions = buildClickPositions(beats, bpm, audioBuffer.duration);
    const rendered = await renderClickPositions(positions, audioBuffer.duration, audioBuffer.sampleRate);
    const clickBlob = audioBufferToWavBlob(rendered);
    const clickTrackUrl = URL.createObjectURL(clickBlob);

    return { bpm, clickTrackUrl };
  } catch (error) {
    console.error("Erro na análise de BPM", error);
    return { bpm: 120, clickTrackUrl: '' };
  }
}

// Mantido para compatibilidade (caso ainda seja chamado com URL)
export async function analyzeAudioAndGenerateClick(
  audioUrl: string,
  onProgress: (msg: string) => void
): Promise<{ bpm: number, clickTrackUrl: string }> {
  try {
    const AudioContext = window.AudioContext || (window as any).webkitAudioContext;
    const ctx = new AudioContext();
    onProgress("Decodificando áudio...");
    const response = await fetch(audioUrl);
    const arrayBuffer = await response.arrayBuffer();
    const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
    return analyzeBufferAndGenerateClick(audioBuffer, onProgress);
  } catch (error) {
    console.error("Erro ao decodificar áudio para análise", error);
    return { bpm: 120, clickTrackUrl: '' };
  }
}

export async function generateManualClickTrack(
  bpm: number,
  durationInSeconds: number,
  onProgress: (msg: string) => void
): Promise<{ bpm: number; clickTrackUrl: string }> {
  try {
    const sampleRate = 44100;
    const length = sampleRate * durationInSeconds;
    const offlineCtx = new OfflineAudioContext(1, length, sampleRate);

    onProgress(`Sintetizando faixa de Metrônomo Manual (${bpm} BPM)...`);

    const secondsPerBeat = 60 / bpm;
    let beatTime = 0;

    // Gerar os blips até o fim da trilha
    while (beatTime < durationInSeconds) {
      const osc = offlineCtx.createOscillator();
      const gain = offlineCtx.createGain();
      
      // Beep de 1000Hz, caindo rápido em 50ms
      osc.frequency.setValueAtTime(1000, beatTime);
      osc.frequency.exponentialRampToValueAtTime(0.001, beatTime + 0.05);

      gain.gain.setValueAtTime(1, beatTime);
      gain.gain.exponentialRampToValueAtTime(0.001, beatTime + 0.05);

      osc.connect(gain);
      gain.connect(offlineCtx.destination);

      osc.start(beatTime);
      osc.stop(beatTime + 0.05);

      beatTime += secondsPerBeat;
    }

    onProgress("Convertendo áudio sintetizado...");
    const renderedBuffer = await offlineCtx.startRendering();
    const clickBlob = audioBufferToWavBlob(renderedBuffer);
    const clickTrackUrl = URL.createObjectURL(clickBlob);

    return { bpm, clickTrackUrl };
  } catch (error) {
    console.error("Erro ao gerar metrônomo manual", error);
    return { bpm, clickTrackUrl: '' };
  }
}

// Voz guia do Separador, fora da tela (Parte 3): o catálogo das falas, o WAV de 16 bits, a
// mistura das marcações num canal e a detecção das seções. Tudo puro, sem React; o áudio
// decodificado (e o cache dele) fica com quem chama, pelo `decode`. Usado pelo Separador de
// reserva e pelo painel SEPARAÇÃO do palco.
import { FAMILY_COLOR, channelFamily, resolveChannelRole } from '../channelNames'
import { APP_GENERATED_NAMES } from '../generatedChannels'

export interface VoiceCue { id: string; time: number; label: string; file: string }
export interface GuideCueOption { label: string; file: string }

export const GUIDE_SECTIONS: readonly GuideCueOption[] = [
  { label: 'Intro', file: 'Song Sections/Portugese - Intro.wav' },
  { label: 'Verso', file: 'Song Sections/Portugese - Verse.wav' },
  { label: 'Verso 1', file: 'Song Sections/Portugese - Verse 1.wav' },
  { label: 'Verso 2', file: 'Song Sections/Portugese - Verse 2.wav' },
  { label: 'Verso 3', file: 'Song Sections/Portugese - Verse 3.wav' },
  { label: 'Verso 4', file: 'Song Sections/Portugese - Verse 4.wav' },
  { label: 'Verso 5', file: 'Song Sections/Portugese - Verse 5.wav' },
  { label: 'Verso 6', file: 'Song Sections/Portugese - Verse 6.wav' },
  { label: 'Pré-Refrão', file: 'Song Sections/Portugese - Pre Chorus.wav' },
  { label: 'Pré-Refrão 1', file: 'Song Sections/Portugese - Pre Chorus 1.wav' },
  { label: 'Pré-Refrão 2', file: 'Song Sections/Portugese - Pre Chorus 2.wav' },
  { label: 'Pré-Refrão 3', file: 'Song Sections/Portugese - Pre Chorus 3.wav' },
  { label: 'Pré-Refrão 4', file: 'Song Sections/Portugese - Pre Chorus 4.wav' },
  { label: 'Refrão', file: 'Song Sections/Portugese - Chorus.wav' },
  { label: 'Refrão 1', file: 'Song Sections/Portugese - Chorus 1.wav' },
  { label: 'Refrão 2', file: 'Song Sections/Portugese - Chorus 2.wav' },
  { label: 'Refrão 3', file: 'Song Sections/Portugese - Chorus 3.wav' },
  { label: 'Refrão 4', file: 'Song Sections/Portugese - Chorus 4.wav' },
  { label: 'Ponte', file: 'Song Sections/Portugese - Bridge.wav' },
  { label: 'Ponte 1', file: 'Song Sections/Portugese - Bridge 1.wav' },
  { label: 'Ponte 2', file: 'Song Sections/Portugese - Bridge 2.wav' },
  { label: 'Ponte 3', file: 'Song Sections/Portugese - Bridge 3.wav' },
  { label: 'Ponte 4', file: 'Song Sections/Portugese - Bridge 4.wav' },
  { label: 'Pós-Refrão', file: 'Song Sections/Portugese - Post Chorus.wav' },
  { label: 'Breakdown', file: 'Song Sections/Portugese - Breakdown.wav' },
  { label: 'Interlúdio', file: 'Song Sections/Portugese - Interlude.wav' },
  { label: 'Outro', file: 'Song Sections/Portugese - Outro.wav' },
  { label: 'Final', file: 'Song Sections/Portugese - Ending.wav' },
  { label: 'Acapella', file: 'Song Sections/Portugese - Acapella.wav' },
  { label: 'Solo', file: 'Song Sections/Portugese - Solo.wav' },
  { label: 'Refrain', file: 'Song Sections/Portugese - Refrain.wav' },
  { label: 'Rap', file: 'Song Sections/Portugese - Rap.wav' },
  { label: 'Tag', file: 'Song Sections/Portugese - Tag.wav' },
  { label: 'Virada', file: 'Song Sections/Portugese - Turnaround.wav' },
  { label: 'Vamp', file: 'Song Sections/Portugese - Vamp.wav' },
  { label: 'Exortação', file: 'Song Sections/Portugese - Exhortation.wav' },
  { label: 'Instrumental', file: 'Song Sections/Portugese - Instrumental.wav' },
  { label: '1', file: 'Song Sections/Portugese - 1.wav' },
  { label: '2', file: 'Song Sections/Portugese - 2.wav' },
  { label: '3', file: 'Song Sections/Portugese - 3.wav' },
  { label: '4', file: 'Song Sections/Portugese - 4.wav' },
  { label: '5', file: 'Song Sections/Portugese - 5.wav' },
  { label: '6', file: 'Song Sections/Portugese - 6.wav' },
]

export const GUIDE_DYNAMICS: readonly GuideCueOption[] = [
  { label: 'All In', file: 'Dynamic Cues/Portugese - All In.wav' },
  { label: 'Baixo', file: 'Dynamic Cues/Portugese - Bass.wav' },
  { label: 'Grande Final', file: 'Dynamic Cues/Portugese - Big Ending.wav' },
  { label: 'Break', file: 'Dynamic Cues/Portugese - Break.wav' },
  { label: 'Breakdown', file: 'Dynamic Cues/Portugese - Breakdown.wav' },
  { label: 'Build', file: 'Dynamic Cues/Portugese - Build.wav' },
  { label: 'Canal', file: 'Dynamic Cues/Portugese - Channel.wav' },
  { label: 'Click', file: 'Dynamic Cues/Portugese - Click.wav' },
  { label: 'Bateria Entra', file: 'Dynamic Cues/Portugese - Drums In.wav' },
  { label: 'Bateria', file: 'Dynamic Cues/Portugese - Drums.wav' },
  { label: 'Exortação', file: 'Dynamic Cues/Portugese - Exhortation.wav' },
  { label: 'Guitarra', file: 'Dynamic Cues/Portugese - Guitar.wav' },
  { label: 'Hits', file: 'Dynamic Cues/Portugese - Hits.wav' },
  { label: 'Hold', file: 'Dynamic Cues/Portugese - Hold.wav' },
  { label: 'Tom Abaixa', file: 'Dynamic Cues/Portugese - Key Change Down.wav' },
  { label: 'Tom Sobe', file: 'Dynamic Cues/Portugese - Key Change Up.wav' },
  { label: 'Teclado', file: 'Dynamic Cues/Portugese - Keys.wav' },
  { label: 'Última Vez', file: 'Dynamic Cues/Portugese - Last Time.wav' },
  { label: 'Pad', file: 'Dynamic Cues/Portugese - Pad.wav' },
  { label: 'Crescendo', file: 'Dynamic Cues/Portugese - Slowly Build.wav' },
  { label: 'Suave', file: 'Dynamic Cues/Portugese - Softly.wav' },
  { label: 'Swell', file: 'Dynamic Cues/Portugese - Swell.wav' },
]

export function guideUrl(file: string): string {
  // BASE_URL = '/' na web, './' no desktop (file://). Caminho absoluto quebra no Electron.
  const encoded = `Portugese Guides/${file}`.split('/').map(s => encodeURIComponent(s)).join('/')
  return `${import.meta.env.BASE_URL}${encoded}`
}

export function formatCueTime(secs: number): string {
  const m = Math.floor(secs / 60)
  const s = Math.floor(secs % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

/** 'm:ss' ou 'm:ss.d' em segundos, nunca negativo (a regra do campo de tempo de hoje). */
export function parseCueTime(raw: string): number {
  const parts = raw.split(':')
  return Math.max(0, (parseInt(parts[0]) || 0) * 60 + (parseFloat(parts[1] || '0') || 0))
}

export function float32ToWav(samples: Float32Array, sampleRate: number): Blob {
  const buffer = new ArrayBuffer(44 + samples.length * 2)
  const view = new DataView(buffer)
  const ws = (off: number, str: string) => { for (let i = 0; i < str.length; i++) view.setUint8(off + i, str.charCodeAt(i)) }
  ws(0, 'RIFF'); view.setUint32(4, 36 + samples.length * 2, true); ws(8, 'WAVE')
  ws(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true)
  view.setUint16(22, 1, true); view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true)
  ws(36, 'data'); view.setUint32(40, samples.length * 2, true)
  let peak = 0; for (let i = 0; i < samples.length; i++) peak = Math.max(peak, Math.abs(samples[i]))
  const scale = peak > 1 ? 1 / peak : 1
  for (let i = 0; i < samples.length; i++) view.setInt16(44 + i * 2, Math.max(-32768, Math.min(32767, samples[i] * scale * 32767)), true)
  return new Blob([buffer], { type: 'audio/wav' })
}

/** O que a mistura precisa do áudio de uma fala (um AudioBuffer serve). */
export type GuideAudio = Pick<AudioBuffer, 'numberOfChannels' | 'length' | 'getChannelData'>
export type DecodeGuide = (url: string) => Promise<GuideAudio | null>

/**
 * Mistura as falas das marcações num WAV mono de 44100 Hz com `ceil(durationSec * 44100)`
 * amostras. Fala que não decodifica fica de fora; sem marcações, nulo.
 */
export async function renderVoiceGuideWav(cues: readonly VoiceCue[], durationSec: number, decode: DecodeGuide): Promise<Blob | null> {
  if (cues.length === 0) return null
  const sr = 44100
  const output = new Float32Array(Math.ceil(durationSec * sr))
  for (const cue of cues) {
    const buffer = await decode(guideUrl(cue.file))
    if (!buffer) continue
    const start = Math.floor(cue.time * sr)
    const mono = new Float32Array(buffer.length)
    for (let c = 0; c < buffer.numberOfChannels; c++) {
      const ch = buffer.getChannelData(c)
      for (let i = 0; i < ch.length; i++) mono[i] += ch[i] / buffer.numberOfChannels
    }
    for (let i = 0; i < mono.length && start + i < output.length; i++) output[start + i] += mono[i]
  }
  return float32ToWav(output, sr)
}

export type MonoSource = Pick<AudioBuffer, 'numberOfChannels' | 'length' | 'sampleRate' | 'duration' | 'getChannelData'>

/**
 * Detecção das seções pela energia (o algoritmo de hoje do Separador, sem mudar nenhuma conta):
 * blocos de 2 s, suavização, fronteiras, teto de 12 seções, rótulos de louvor e a contagem 1 a 4
 * antes do Intro quando há espaço.
 */
export function detectVoiceCues(buffer: MonoSource, bpmText: string, now: () => number = Date.now): VoiceCue[] {
  // 2-second chunks for finer resolution (pre-choruses can be as short as 8s)
  const CHUNK_SECS = 2;
  const chunkSamples = CHUNK_SECS * buffer.sampleRate;
  const numChunks = Math.floor(buffer.duration / CHUNK_SECS);
  const totalDur = buffer.duration;

  // Mix to mono
  const mono = new Float32Array(buffer.length);
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const ch = buffer.getChannelData(c);
    for (let i = 0; i < ch.length; i++) mono[i] += ch[i] / buffer.numberOfChannels;
  }

  // RMS per 2s chunk
  const rms: number[] = [];
  for (let i = 0; i < numChunks; i++) {
    const start = i * chunkSamples;
    const end = Math.min(start + chunkSamples, mono.length);
    let sum = 0;
    for (let s = start; s < end; s++) sum += mono[s] * mono[s];
    rms.push(Math.sqrt(sum / (end - start)));
  }

  const maxRms = Math.max(...rms, 0.001);
  const norm = rms.map(v => v / maxRms);

  // Smooth with ±5 chunk window (±10s) for stability
  const SMOOTH = 5;
  const smoothed = norm.map((_, i) => {
    const sl = norm.slice(Math.max(0, i - SMOOTH), Math.min(norm.length, i + SMOOTH + 1));
    return sl.reduce((a, b) => a + b, 0) / sl.length;
  });

  // Section energy = average of all chunks in that section (from boundary to next)
  const sectionEnergy = (startChunk: number, endChunk: number) => {
    const sl = smoothed.slice(startChunk, Math.min(numChunks, endChunk));
    return sl.length > 0 ? sl.reduce((a, b) => a + b, 0) / sl.length : 0;
  };

  // Detect boundaries: look for sustained energy change over ±8 chunks (±16s)
  const MIN_GAP_CHUNKS = Math.max(7, Math.floor(14 / CHUNK_SECS)); // min 14s between sections
  // Threshold adaptativo: proporcional à variação real do sinal (desvio-padrão),
  // com piso de 0.06. Songs mais dinâmicas exigem salto maior pra contar como seção.
  const meanS = smoothed.reduce((a, b) => a + b, 0) / (smoothed.length || 1);
  const stdS = Math.sqrt(smoothed.reduce((a, v) => a + (v - meanS) * (v - meanS), 0) / (smoothed.length || 1));
  const THRESHOLD = Math.max(0.06, stdS * 0.6);

  const boundaries: { time: number; startChunk: number }[] = [{ time: 0, startChunk: 0 }];

  for (let i = MIN_GAP_CHUNKS; i < numChunks - 2; i++) {
    const lastChunk = boundaries[boundaries.length - 1].startChunk;
    if (i - lastChunk < MIN_GAP_CHUNKS) continue;
    const half = Math.floor(MIN_GAP_CHUNKS / 2);
    const before = sectionEnergy(Math.max(0, i - half), i);
    const after = sectionEnergy(i, Math.min(numChunks, i + half));
    if (Math.abs(after - before) > THRESHOLD) {
      boundaries.push({ time: i * CHUNK_SECS, startChunk: i });
    }
  }

  // Compute energy for each section (from this boundary start to the next boundary start)
  const withEnergy = boundaries.map((b, idx) => {
    const nextChunk = idx < boundaries.length - 1 ? boundaries[idx + 1].startChunk : numChunks;
    return { time: b.time, startChunk: b.startChunk, energy: sectionEnergy(b.startChunk, nextChunk) };
  });

  // Cap at 12 sections: always remove the section with smallest energy delta to neighbors
  while (withEnergy.length > 12) {
    let minIdx = 1;
    let minScore = Infinity;
    for (let i = 1; i < withEnergy.length - 1; i++) {
      const score = Math.abs(withEnergy[i].energy - withEnergy[i - 1].energy)
                  + Math.abs(withEnergy[i].energy - withEnergy[i + 1].energy);
      if (score < minScore) { minScore = score; minIdx = i; }
    }
    withEnergy.splice(minIdx, 1);
  }

  const allE = withEnergy.map(b => b.energy);
  const minE = Math.min(...allE);
  const maxE = Math.max(...allE);
  const eRange = maxE - minE || 1;
  const ne = (e: number) => (e - minE) / eRange; // normalize 0–1

  // ─── Worship-structure-aware labeling ───────────────────────────────────
  // Typical flow: Intro → V → PreC → C → [V → PreC →] C → Ponte → C → Final
  // Rules (applied in order for each section i, skipping first and last):
  //   1. Chorus : ne(energy) ≥ 0.62  (high energy peak)
  //   2. Pré-Refrão: section JUST BEFORE a Chorus, ne ≥ 0.32 (building energy)
  //   3. Ponte  : ne ≤ 0.30, position ≥ 55% of song, not yet used
  //   4. Interlúdio: ne ≤ 0.22, position < 55%, appears after at least one chorus
  //   5. Verso  : everything else (medium energy sections)
  const CHORUS_THR = 0.62;
  const PRE_THR    = 0.32;
  const BRIDGE_THR = 0.30;
  const INTER_THR  = 0.22;

  // First pass: mark chorus positions so we can identify pre-choruses
  const isChorus = withEnergy.map(b => ne(b.energy) >= CHORUS_THR);

  let chorusCount = 0, verseCount = 0, preChorusCount = 0;
  let bridgeUsed = false, interludeUsed = false;
  let chorusSeenCount = 0;

  const detectedCues: VoiceCue[] = withEnergy.map((b, idx) => {
    const ts = now();

    if (idx === 0) {
      return { id: `ad-${ts}-${idx}`, time: b.time, label: 'Intro', file: 'Song Sections/Portugese - Intro.wav' };
    }
    if (idx === withEnergy.length - 1) {
      return { id: `ad-${ts}-${idx}`, time: b.time, label: 'Final', file: 'Song Sections/Portugese - Ending.wav' };
    }

    const e = ne(b.energy);
    const pos = b.time / totalDur;
    const nextIsChorus = idx < withEnergy.length - 1 && isChorus[idx + 1];

    // 1. Chorus
    if (isChorus[idx]) {
      chorusCount++;
      chorusSeenCount++;
      const n = Math.min(chorusCount, 4);
      return { id: `ad-${ts}-${idx}`, time: b.time, label: `Refrão ${chorusCount}`, file: `Song Sections/Portugese - Chorus ${n}.wav` };
    }

    // 2. Pré-Refrão: building section right before a chorus
    if (nextIsChorus && e >= PRE_THR) {
      preChorusCount++;
      const sfx = preChorusCount > 1 ? ` ${preChorusCount}` : '';
      return { id: `ad-${ts}-${idx}`, time: b.time, label: `Pré-Refrão${sfx}`, file: `Song Sections/Portugese - Pre Chorus${sfx}.wav` };
    }

    // 3. Ponte (Bridge): low/medium energy in second half of song
    if (pos >= 0.55 && e <= BRIDGE_THR && !bridgeUsed) {
      bridgeUsed = true;
      return { id: `ad-${ts}-${idx}`, time: b.time, label: 'Ponte', file: 'Song Sections/Portugese - Bridge.wav' };
    }

    // 4. Interlúdio: quiet moment in first half after at least one chorus
    if (pos < 0.55 && e <= INTER_THR && !interludeUsed && chorusSeenCount > 0) {
      interludeUsed = true;
      return { id: `ad-${ts}-${idx}`, time: b.time, label: 'Interlúdio', file: 'Song Sections/Portugese - Interlude.wav' };
    }

    // 5. Verso (default for medium sections)
    verseCount++;
    const vn = Math.min(verseCount, 6);
    return { id: `ad-${ts}-${idx}`, time: b.time, label: `Verso ${verseCount}`, file: `Song Sections/Portugese - Verse ${vn}.wav` };
  });

  // Add 1,2,3,4 count-in before Intro when song has space before it
  const bpmNum = parseInt(bpmText) || 120;
  const beat = 60 / bpmNum;
  const intro = detectedCues.find(c => c.label === 'Intro');
  if (intro && intro.time > beat) {
    for (let n = 1; n <= 4; n++) {
      const t = intro.time - (5 - n) * beat;
      if (t >= 0) detectedCues.push({ id: `ad-ci${n}-${now()}`, time: t, label: String(n), file: `Song Sections/Portugese - ${n}.wav` });
    }
    detectedCues.sort((a, b) => a.time - b.time);
  }

  return detectedCues
}

// Nomes dos canais que o app gera (o click do motor, o do Separador e a voz guia).
const GENERATED_NAMES = APP_GENERATED_NAMES

/**
 * A faixa que a detecção escuta: a da família Vocal; sem ela, a primeira Normal que não é gerada
 * pelo app. Serve pras faixas do Separador (`vocals`) e pros canais do palco (id aleatório).
 */
export function voiceSourceTrack<T extends { id: string; name: string }>(tracks: readonly T[]): T | undefined {
  return tracks.find(s => channelFamily({ id: s.id, name: s.name }) === 'vocal')
    || tracks.find(s => !['click', 'metronome', 'voiceguide'].includes(s.id)
      && !GENERATED_NAMES.includes(s.name)
      && resolveChannelRole({ id: s.id, name: s.name }) === 'normal')
}

/** A cor que a voz guia gravava antes (o mesmo valor do âmbar de alerta, `ps-alert`). */
const OLD_GUIDE_AMBER = '#fbbf24'

/**
 * A cor de uma faixa da separação na tela (Ruling SEP-cor-guia, sep-2 I4): âmbar é só alerta, então
 * a voz guia gravada no âmbar antigo aparece na cor da família Guia (pedra), a mesma do painel do
 * palco. As outras faixas ficam com a cor delas (dado).
 */
export function stemColor(stem: { id: string; color: string }): string {
  return stem.id === 'voiceguide' && stem.color.toLowerCase() === OLD_GUIDE_AMBER ? FAMILY_COLOR.guia : stem.color
}

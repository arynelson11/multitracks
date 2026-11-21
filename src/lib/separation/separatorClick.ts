// Contas do click e do BPM do Separador, fora da tela (Parte 3): de qual faixa medir a grade, a
// frase do resultado, o plano do click (BPM, primeiro tempo e o "1"), a geração com prazo e os
// botões de BPM (TAP, +1, -1, 2x e metade). Tudo puro; o estado e o cache da grade ficam com quem
// chama. Usado pelo Separador de reserva e pelo painel SEPARAÇÃO do palco.
import { generateManualClickTrackFromSample } from '../AudioAnalyzer'
import { separatorGridUsable } from '../autoClick'
import { detectBeatGrid, formatBpm, type BeatGrid } from '../beatGrid'
import { channelFamily, resolveChannelRole } from '../channelNames'
import type { ClickLibrarySelection } from '../clickLibrary'

export type SeparatorMeter = '3/4' | '4/4' | '5/4' | '6/8' | '7/8' | '12/8'
export const SEPARATOR_METERS: readonly SeparatorMeter[] = ['3/4', '4/4', '5/4', '6/8', '7/8', '12/8']
export const BEATS_PER_BAR: Record<SeparatorMeter, number> = { '3/4': 3, '4/4': 4, '5/4': 5, '6/8': 6, '7/8': 7, '12/8': 12 }

// Nomes dos canais que o app gera. A T7 junta os três em src/lib/generatedChannels.ts.
const GENERATED_NAMES = ['Metrônomo', 'Voz Guia', 'Click gerado']

type Track = { id: string; name: string }
const family = (t: Track) => channelFamily({ id: t.id, name: t.name })

/**
 * Faixa usada pra medir a grade: bateria é a referência; sem ela, instrumental, depois baixo,
 * depois a primeira Normal que não é vocal nem gerada pelo app. Entende as faixas do Separador
 * (ids `drums`, `no_vocals`, `bass`) e os canais do palco (id aleatório, pelo nome).
 */
export function pickGridSource<T extends Track>(tracks: readonly T[]): T | undefined {
  const notGenerated = (s: T) => !['metronome', 'click', 'voiceguide', 'vocals'].includes(s.id)
    && !GENERATED_NAMES.includes(s.name)
    && family(s) !== 'vocal'
    && resolveChannelRole({ id: s.id, name: s.name }) === 'normal'
  return tracks.find(s => s.id === 'drums')
    || tracks.find(s => family(s) === 'bateria')
    || tracks.find(s => s.id === 'no_vocals')
    || tracks.find(s => s.name.trim().toLowerCase() === 'instrumental')
    || tracks.find(s => s.id === 'bass')
    || tracks.find(s => family(s) === 'baixo')
    || tracks.find(notGenerated)
}

/** Mede BPM exato, primeiro tempo e o "1" no áudio decodificado (o mesmo que está tocando). */
export function measureGrid(channels: Float32Array[], sampleRate: number, opts: { nearBpm?: number; beatsPerBar: number }): BeatGrid {
  return detectBeatGrid(channels, sampleRate, opts)
}

/** O BPM pra mostrar e a frase do resultado da detecção (os dois textos de hoje). */
export function bpmReport(grid: BeatGrid, sourceName: string): { bpm: string; info: string } {
  return {
    bpm: formatBpm(grid.bpm),
    info: !separatorGridUsable(grid)
      ? `Pulso pouco claro nessa música (${sourceName}). Confira o BPM no TAP.`
      : `${grid.bpm.toFixed(2)} BPM medido na faixa ${sourceName}.`,
  }
}

export interface ClickPlan { bpm: number; firstBeat: number; downbeat: number }

/**
 * Com a grade boa vale o BPM dela, o primeiro tempo dela mais o SYNC e o "1" dela mais o
 * deslocamento; sem ela, o BPM digitado (abaixo de 20 ou inválido vira 120) a partir de 0:00.
 */
export function clickPlan(i: { typedBpm: string; offsetMs: number; downbeatShift: number; grid: BeatGrid | null }): ClickPlan {
  const typed = parseFloat(i.typedBpm)
  const bpmNum = Number.isFinite(typed) && typed >= 20 ? typed : 120
  const aligned = separatorGridUsable(i.grid) ? i.grid : null
  return {
    bpm: aligned ? aligned.bpm : bpmNum,
    firstBeat: (aligned ? aligned.firstBeat : 0) + i.offsetMs / 1000,
    downbeat: (aligned ? aligned.downbeat : 0) + i.downbeatShift,
  }
}

/** Gera o WAV do click pelo gerador com prazo (a amostra que não chega cai no prazo). */
export async function generateSeparatorClick(i: {
  plan: ClickPlan; durationSec: number; sel: ClickLibrarySelection; accentBeat1: boolean; meter: SeparatorMeter
}): Promise<string> {
  const { plan, durationSec, sel: clickSel, accentBeat1, meter } = i
  const { bpm, firstBeat, downbeat } = plan
  const { clickTrackUrl } = await generateManualClickTrackFromSample(
    clickSel.type, clickSel.subdivision, bpm, durationSec, accentBeat1, meter, { firstBeat, downbeat }
  )
  if (!clickTrackUrl) throw new Error('Falha ao gerar metrônomo')
  return clickTrackUrl
}

/** SYNC: ajuste fino do click em ms, de -500 a 500. */
export function nudgeOffset(current: number, deltaMs: number): number {
  return Math.max(-500, Math.min(500, current + deltaMs))
}

/** TAP: guarda as 8 últimas batidas e calcula o BPM pela média dos intervalos. */
export function tapTempo(taps: readonly number[], now: number): { taps: number[]; bpm: string | null } {
  const next = [...taps, now]
  if (next.length > 8) next.shift()
  if (next.length < 2) return { taps: next, bpm: null }
  const gaps = next.slice(1).map((t, idx) => t - next[idx])
  const avg = gaps.reduce((a, b) => a + b, 0) / gaps.length
  return { taps: next, bpm: String(Math.round(60000 / avg)) }
}

/** +1 e -1: inteiro de 40 a 300 (vazio conta como 120). */
export function stepBpm(text: string, delta: 1 | -1): string {
  return String(Math.max(40, Math.min(300, Math.round(parseFloat(text) || 120) + delta)))
}

/** 2x e metade, no formato do BPM, de 40 a 300. */
export function scaleBpm(text: string, factor: 2 | 0.5): string {
  return formatBpm(Math.max(40, Math.min(300, (parseFloat(text) || 120) * factor)))
}

/** Ao sair do campo: inválido vira 120; o resto encaixa entre 40 e 300. */
export function normalizeBpm(text: string): string {
  const n = parseFloat(text)
  return isNaN(n) ? '120' : formatBpm(Math.max(40, Math.min(300, n)))
}

/** O nome do andamento que aparece ao lado do BPM. */
export function tempoName(b: number): string {
  if (b < 60) return 'Largo'
  if (b < 76) return 'Adagio'
  if (b < 108) return 'Andante'
  if (b < 112) return 'Moderato'
  if (b < 120) return 'Allegretto'
  if (b < 156) return 'Allegro'
  if (b < 176) return 'Vivace'
  return 'Presto'
}

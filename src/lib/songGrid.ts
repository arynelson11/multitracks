// Grade da música (Parte 2): barras de compasso, encaixe das seções na barra ou no pulso do
// click, seções em trechos contínuos e o aviso âmbar quando a grade falta ou foi assumida.
// Puro: sem React e sem Web Audio. Tempos em segundos da música.
import type { Marker } from '../types'
import {
  TIME_SIGNATURES, gridHasPhase, isCompound, pulsesPerBar, signatureForPulses,
  type GridSource, type GridWarning, type MeterSource, type SectionSpan, type SongGrid, type TimeSignature,
} from './stageContracts'
import { DOTTED_PULSE_MAX_BPM } from './clickMeter'

/** Folga de arredondamento nas comparações de tempo (1 microssegundo). */
const EPS = 1e-6
const MIN_BPM = 30
const MAX_BPM = 300
const GRID_SOURCES: readonly GridSource[] = ['click', 'bpm']
const METER_SOURCES: readonly MeterSource[] = ['manual', 'salvo', 'acento', 'padrao']

// ---------- Pulso e compasso ----------

/** Duração de um pulso do click (60 / bpm). */
export function pulseSeconds(g: SongGrid): number {
  return 60 / g.bpm
}

/** Duração de um compasso: os pulsos do compasso vezes o pulso. */
export function barSeconds(g: SongGrid): number {
  return pulseSeconds(g) * pulsesPerBar(g.signature)
}

/** Barra de compasso mais perto de `t`. A grade continua antes do primeiro 1 (pode dar tempo negativo). */
export function nearestBarLine(t: number, g: SongGrid): number {
  const bar = barSeconds(g)
  return g.firstDownbeat + Math.round((t - g.firstDownbeat) / bar) * bar
}

/**
 * Compasso que contém `t`: 0 é o que começa no primeiro 1; antes dele, a anacruse, é -1. Com
 * a fase em `[0, compasso)` (como saem `gridFromClick`, `withMeter` e `sanitizeGrid`), de 0:00
 * em diante nunca dá menos que -1.
 */
export function barIndexAt(t: number, g: SongGrid): number {
  return Math.floor((t - g.firstDownbeat) / barSeconds(g) + 1e-9)
}

// ---------- Encaixe ----------

function knownSignature(s: unknown): TimeSignature | null {
  return TIME_SIGNATURES.find((x) => x === s) ?? null
}

/** Mesma regra do `sanitizeGrid`, sem montar objeto: grade quebrada conta como sem grade. */
function isUsableGrid(g: SongGrid): boolean {
  return Number.isFinite(g.bpm) && g.bpm >= MIN_BPM && g.bpm <= MAX_BPM
    && Number.isFinite(g.firstDownbeat) && g.firstDownbeat >= 0 && knownSignature(g.signature) !== null
}

/**
 * Encaixa `t` na barra mais perto quando a grade sabe onde cai o 1 e a barra está a no máximo
 * 1/4 de compasso; senão devolve `t`. `t <= 0` é sempre 0 (marca em 0:00 nunca mexe), e a
 * barra antes de 0:00 encaixa em 0: o encaixe nunca devolve tempo negativo. Só a barra: o início
 * de seção que fica longe dela vai pro pulso no `sectionSpans`.
 */
export function snapToBar(t: number, g: SongGrid | null): number {
  if (t <= 0) return 0
  if (!g || !gridHasPhase(g) || !isUsableGrid(g)) return t
  const line = nearestBarLine(t, g)
  return Math.abs(line - t) <= barSeconds(g) / 4 + EPS ? Math.max(0, line) : t
}

// ---------- Seções ----------

/** Como o início do trecho caiu na grade: na barra, no pulso do click, ou cru (sem grade com fase). */
export type SpanSnap = 'bar' | 'pulse' | 'raw'

/**
 * Trecho de seção: o `SectionSpan` da T1 mais o jeito do encaixe do início. A T11 usa o
 * `snappedTo` do trecho seguinte pra saber se o fim deste (o `switchAt`) cai no pulso do click:
 * `'bar'` e `'pulse'` caem; `'raw'` só sai sem grade com fase, ou em 0:00 fora da grade.
 */
export interface SnappedSpan extends SectionSpan { snappedTo: SpanSnap }

/** Pulso do click mais perto de `t` (mesma conta da barra: fase mais um número inteiro de pulsos). */
function nearestPulseLine(t: number, g: SongGrid): number {
  const pulse = pulseSeconds(g)
  return g.firstDownbeat + Math.round((t - g.firstDownbeat) / pulse) * pulse
}

/**
 * Último pulso antes de `limit`, pela conta direta (fase + j pulsos), nunca somando intervalos.
 * Pode dar antes de 0:00 em áudio curtíssimo (quem chama trata). Só com grade usável (pulso > 0).
 */
function lastPulseBefore(limit: number, g: SongGrid): number {
  const pulse = pulseSeconds(g)
  let j = Math.ceil((limit - g.firstDownbeat) / pulse) - 1
  while (g.firstDownbeat + j * pulse >= limit) j--
  return g.firstDownbeat + j * pulse
}

function hasUsablePhase(g: SongGrid | null): g is SongGrid {
  return g !== null && gridHasPhase(g) && isUsableGrid(g)
}

/** 0:00 nunca mexe; diz se 0:00 já cai na barra ou no pulso da grade. */
function atZero(g: SongGrid | null): { time: number; snappedTo: SpanSnap } {
  if (!hasUsablePhase(g)) return { time: 0, snappedTo: 'raw' }
  if (Math.abs(nearestBarLine(0, g)) <= EPS) return { time: 0, snappedTo: 'bar' }
  return { time: 0, snappedTo: Math.abs(nearestPulseLine(0, g)) <= EPS ? 'pulse' : 'raw' }
}

/**
 * Início de uma seção (decisão do coordenador, spec 4.4 "sem sair do tempo"): com grade de
 * click, a barra mais perto até 1/4 de compasso (como o `snapToBar`); mais longe, o pulso mais
 * perto. Barra ou pulso antes de 0:00 vira 0:00; pulso depois do fim do áudio vira o último
 * pulso antes do fim. Sem grade com fase, a marca crua.
 */
function snapSectionStart(t: number, g: SongGrid | null, duration: number): { time: number; snappedTo: SpanSnap } {
  if (t <= 0) return atZero(g)
  if (!hasUsablePhase(g)) return { time: t, snappedTo: 'raw' }
  const bar = nearestBarLine(t, g)
  if (Math.abs(bar - t) <= barSeconds(g) / 4 + EPS && bar < duration) return bar <= 0 ? atZero(g) : { time: bar, snappedTo: 'bar' }
  const near = nearestPulseLine(t, g)
  const pulse = near < duration ? near : lastPulseBefore(duration, g)
  return pulse <= 0 ? atZero(g) : { time: pulse, snappedTo: 'pulse' }
}

interface SpanEntry { span: SnappedSpan; markerId: string | null }

/**
 * Trechos das seções com a marca de cada um. Regras além do plano, pra nenhum trecho sair do
 * áudio nem ficar vazio: duas marcas no mesmo compasso (ou pulso) deixariam um trecho vazio, que
 * sai (fica a de depois); marca colada no fim do áudio sai; a última termina no fim do áudio
 * quando a barra encaixada do fim não fica depois do início dela.
 */
function spanEntries(markers: readonly Marker[], duration: number, grid: SongGrid | null): SpanEntry[] {
  if (!Number.isFinite(duration) || duration <= 0) return []
  // As marcas da nuvem chegam sem limpeza (any[]): item nulo ou sem tempo numérico fica de fora.
  const valid = markers
    .filter((m) => m != null && Number.isFinite(m.time) && m.time >= 0 && m.time < duration)
    .sort((a, b) => a.time - b.time)
  const kept: { start: number; snappedTo: SpanSnap; markerId: string | null }[] = []
  for (const m of valid) {
    const s = snapSectionStart(m.time, grid, duration)
    if (s.time > duration - EPS) continue
    while (kept.length > 0 && s.time - kept[kept.length - 1].start <= EPS) kept.pop()
    kept.push({ start: s.time, snappedTo: s.snappedTo, markerId: typeof m.id === 'string' ? m.id : null })
  }
  if (kept.length === 0) return []
  const lastStart = kept[kept.length - 1].start
  const tail = snapToBar(duration, grid)
  const lastEnd = tail <= duration && tail > lastStart + EPS ? tail : duration
  return kept.map((k, i) => ({
    span: { index: i, start: k.start, end: i + 1 < kept.length ? kept[i + 1].start : lastEnd, snappedTo: k.snappedTo },
    markerId: k.markerId,
  }))
}

/**
 * Seções da música em trechos contínuos e encaixados. Marca com tempo não finito ou fora de
 * `[0, duration)` é ignorada. `start`: com grade de click, a barra mais perto até 1/4 de
 * compasso (`'bar'`), senão o pulso mais perto (`'pulse'`); sem grade com fase, a marca crua
 * (`'raw'`); marca em 0:00 nunca mexe. `end` é o início da seguinte; a última termina em
 * `snapToBar(duration)` se isso não passar de `duration`, senão em `duration` (o fim da última
 * pode ficar fora do pulso). `index` é a posição nesta lista (o índice que o palco, a banda e o
 * motor usam), não a posição da marca em `markers`.
 */
export function sectionSpans(markers: readonly Marker[], duration: number, grid: SongGrid | null): SnappedSpan[] {
  return spanEntries(markers, duration, grid).map((e) => e.span)
}

/** Marca que deu origem ao trecho `spanIndex` de `sectionSpans` (o modo EDITAR mexe na marca); nula fora da lista. */
export function markerIdForSpan(markers: readonly Marker[], duration: number, grid: SongGrid | null, spanIndex: number): string | null {
  return spanEntries(markers, duration, grid)[spanIndex]?.markerId ?? null
}

/**
 * Seção que toca em `t`, com `spans` em ordem (como saem de `sectionSpans`): -1 antes da
 * primeira (ou sem seções). Depois do fim da última continua
 * a última (a final segue acesa até o áudio acabar). No início exato de um trecho, um erro de
 * arredondamento de até 1 microssegundo já conta como o trecho novo.
 */
export function sectionIndexAt(spans: readonly SectionSpan[], t: number): number {
  let found = -1
  for (const s of spans) {
    if (s.start <= t + EPS) found = s.index
    else break
  }
  return found
}

// ---------- Grade a partir do BPM salvo e do click ----------

/** Grade só com o BPM salvo (sem fase: a contagem fica ancorada no 1 de destino). Nula com bpm fora de [30, 300]. */
export function gridFromBpm(bpm: number, savedSignature?: TimeSignature | null): SongGrid | null {
  if (!Number.isFinite(bpm) || bpm < MIN_BPM || bpm > MAX_BPM) return null
  const saved = knownSignature(savedSignature)
  return { bpm, firstDownbeat: 0, signature: saved ?? '4/4', countEvery: 1, source: 'bpm', meterSource: saved ? 'salvo' : 'padrao' }
}

/**
 * O que a grade precisa da leitura da faixa de click (a `ClickAnalysis` da T3 encaixa por
 * estrutura). `bpm` em tempos (semínima no simples, semínima pontuada no composto);
 * `subdivision` = pulsos do click por tempo; `compound` = o tempo é a semínima pontuada.
 */
export interface ClickAnalysisLike {
  bpm: number; subdivision: 1 | 2 | 3; compound: boolean
  firstPulse: number; pulsesPerBar: number | null; firstDownbeat: number | null
}

/**
 * Pulsos da grade por minuto no compasso que vale: tempos no simples, colcheias no 6/8 e no
 * 12/8 (a grade conta 6 e 12 pulsos neles). Leitura feita num quadro diferente do compasso
 * salvo (a T27 deve ler o click já com o compasso salvo): no composto, o click lido no
 * simples vira colcheia pelo andamento, como no clickMeter; no simples, a leitura composta
 * vira semínima de 2 colcheias.
 */
function gridPulseBpm(a: ClickAnalysisLike, signature: TimeSignature): number {
  if (isCompound(signature)) {
    if (a.compound) return a.bpm * 3
    const clickPulses = a.bpm * a.subdivision
    return clickPulses < DOTTED_PULSE_MAX_BPM ? clickPulses * 3 : clickPulses
  }
  return a.compound ? (a.bpm * 3) / 2 : a.bpm
}

/**
 * Traz `x` pra dentro de `[0, bar)`. Fase não finita continua NaN (nunca inventa o 1); com
 * compasso inválido `x` fica como veio. Nos dois casos o `sanitizeGrid` recusa a grade.
 */
function intoFirstBar(x: number, bar: number): number {
  if (!Number.isFinite(x)) return NaN
  if (!Number.isFinite(bar) || bar <= 0) return x
  if (x >= 0 && x < bar) return x // já dentro: o número não muda (ida e volta pelo repertório fica igual)
  const r = x - Math.floor(x / bar) * bar
  return r >= 0 && r < bar ? r : 0
}

/**
 * Grade lida na faixa de click. Compasso: o salvo (`'salvo'`), senão o que o acento mostrou
 * (`'acento'`), senão 4/4 (`'padrao'`; 6/8 quando a leitura é composta). O BPM da grade sai
 * em tempos no compasso simples e em colcheias no composto, com a contagem de 3 em 3 (o tempo
 * do composto): a contagem nunca conta colcheias. O primeiro 1 (`firstDownbeat`, ou o primeiro
 * tempo sem acento) vai pra dentro do primeiro compasso do compasso que vale. Leitura com
 * `firstPulse` ou `firstDownbeat` não finito é leitura quebrada: a fase sai NaN, a grade é
 * recusada pelo `sanitizeGrid` e o `gridWarning` dá `'sem-grade'` (nunca um 1 chutado em 0:00).
 */
export function gridFromClick(a: ClickAnalysisLike, savedSignature?: TimeSignature | null): SongGrid {
  const saved = knownSignature(savedSignature)
  const accent = a.pulsesPerBar === null ? null : signatureForPulses(a.pulsesPerBar)
  const signature = saved ?? accent ?? (a.compound ? '6/8' : '4/4')
  const meterSource: MeterSource = saved ? 'salvo' : accent ? 'acento' : 'padrao'
  const bpm = gridPulseBpm(a, signature)
  const bar = (60 / bpm) * pulsesPerBar(signature)
  const phaseOk = Number.isFinite(a.firstPulse) && (a.firstDownbeat == null || Number.isFinite(a.firstDownbeat))
  const firstDownbeat = phaseOk ? intoFirstBar(a.firstDownbeat ?? a.firstPulse, bar) : NaN
  return { bpm, firstDownbeat, signature, countEvery: isCompound(signature) ? 3 : 1, source: 'click', meterSource }
}

// ---------- Compasso manual ----------

/**
 * Compasso escolhido no modo EDITAR. Contar de 3 em 3 só vale no composto; BPM, fase e origem
 * ficam. O 1 volta pra dentro do primeiro compasso do compasso novo (as barras são as mesmas),
 * pra `barIndexAt` de 0:00 em diante nunca passar da anacruse (-1).
 */
export function withMeter(g: SongGrid, signature: TimeSignature, countEvery: 1 | 3): SongGrid {
  const next: SongGrid = { ...g, signature, countEvery: isCompound(signature) ? countEvery : 1, meterSource: 'manual' }
  return { ...next, firstDownbeat: intoFirstBar(g.firstDownbeat, barSeconds(next)) }
}

/** "Ler o click de novo": BPM e fase vêm da leitura nova; o compasso manual de antes, se havia, continua. */
export function keepManualMeter(next: SongGrid, previous: SongGrid | null): SongGrid {
  return previous?.meterSource === 'manual' ? withMeter(next, previous.signature, previous.countEvery) : next
}

// ---------- Aviso e sanitização ----------

/** Aviso âmbar da célula de tempo. Grade quebrada (que o `sanitizeGrid` recusa) também é sem grade. */
export function gridWarning(g: SongGrid | null): GridWarning | null {
  if (!g || !sanitizeGrid(g)) return 'sem-grade'
  if (g.source === 'bpm') return 'sem-click-lido'
  if (g.meterSource === 'padrao') return 'compasso-assumido'
  return null
}

/**
 * Grade vinda de fora (repertório salvo, cache): bpm finito em [30, 300], `firstDownbeat` finito
 * e `>= 0`, compasso, `countEvery`, `source` e `meterSource` conhecidos; senão nula. Devolve uma
 * grade nova só com os campos dela, com as mesmas regras do `withMeter`: 3 em 3 fora do composto
 * vira 1 e o 1 volta pra dentro do primeiro compasso (`[0, compasso)`, mesmas barras).
 */
export function sanitizeGrid(raw: unknown): SongGrid | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const { bpm, firstDownbeat, countEvery } = r
  const signature = knownSignature(r.signature)
  const source = GRID_SOURCES.find((x) => x === r.source)
  const meterSource = METER_SOURCES.find((x) => x === r.meterSource)
  if (typeof bpm !== 'number' || !Number.isFinite(bpm) || bpm < MIN_BPM || bpm > MAX_BPM) return null
  if (typeof firstDownbeat !== 'number' || !Number.isFinite(firstDownbeat) || firstDownbeat < 0) return null
  if (countEvery !== 1 && countEvery !== 3) return null
  if (!signature || !source || !meterSource) return null
  const bar = (60 / bpm) * pulsesPerBar(signature)
  return { bpm, firstDownbeat: intoFirstBar(firstDownbeat, bar), signature, countEvery: isCompound(signature) ? countEvery : 1, source, meterSource }
}

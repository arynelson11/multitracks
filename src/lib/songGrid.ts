// Grade da música (Parte 2): barras de compasso, encaixe das seções na barra, seções em
// trechos contínuos e o aviso âmbar quando a grade falta ou foi assumida.
// Puro: sem React e sem Web Audio. Tempos em segundos da música.
import type { Marker } from '../types'
import {
  TIME_SIGNATURES, gridHasPhase, isCompound, pulsesPerBar, signatureForPulses,
  type GridSource, type GridWarning, type MeterSource, type SectionSpan, type SongGrid, type TimeSignature,
} from './stageContracts'

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

/** Compasso que contém `t`: 0 é o que começa no primeiro 1; antes dele, a anacruse, é -1. */
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
 * barra antes de 0:00 encaixa em 0: o encaixe nunca devolve tempo negativo.
 */
export function snapToBar(t: number, g: SongGrid | null): number {
  if (t <= 0) return 0
  if (!g || !gridHasPhase(g) || !isUsableGrid(g)) return t
  const line = nearestBarLine(t, g)
  return Math.abs(line - t) <= barSeconds(g) / 4 + EPS ? Math.max(0, line) : t
}

// ---------- Seções ----------

interface SpanEntry { span: SectionSpan; markerId: string | null }

/**
 * Trechos das seções com a marca de cada um. Regras além do plano, pra nenhum trecho sair do
 * áudio nem ficar vazio: o início que o encaixe jogaria pra depois do fim fica na marca crua;
 * duas marcas no mesmo compasso deixam um trecho vazio, que sai (fica a de depois); a última
 * termina no fim do áudio quando a barra encaixada do fim não fica depois do início dela.
 */
function spanEntries(markers: readonly Marker[], duration: number, grid: SongGrid | null): SpanEntry[] {
  if (!Number.isFinite(duration) || duration <= 0) return []
  // As marcas da nuvem chegam sem limpeza (any[]): item nulo ou sem tempo numérico fica de fora.
  const valid = markers
    .filter((m) => m != null && Number.isFinite(m.time) && m.time >= 0 && m.time < duration)
    .sort((a, b) => a.time - b.time)
  if (valid.length === 0) return []
  const starts = valid.map((m) => {
    const s = snapToBar(m.time, grid)
    return s < duration ? s : m.time
  })
  const lastStart = starts[starts.length - 1]
  const tail = snapToBar(duration, grid)
  const lastEnd = tail <= duration && tail > lastStart + EPS ? tail : duration
  const out: SpanEntry[] = []
  valid.forEach((m, i) => {
    const start = starts[i]
    const end = i + 1 < starts.length ? starts[i + 1] : lastEnd
    if (end - start > EPS) out.push({ span: { index: out.length, start, end }, markerId: typeof m.id === 'string' ? m.id : null })
  })
  return out
}

/**
 * Seções da música em trechos contínuos e encaixados. Marca com tempo não finito ou fora de
 * `[0, duration)` é ignorada; `start` é a marca encaixada (`snapToBar`); `end` é o início da
 * seguinte; a última termina em `snapToBar(duration)` se isso não passar de `duration`, senão
 * em `duration`. `index` é a posição nesta lista (o índice que o palco, a banda e o motor usam),
 * não a posição da marca em `markers`.
 */
export function sectionSpans(markers: readonly Marker[], duration: number, grid: SongGrid | null): SectionSpan[] {
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

/** O que a grade precisa da leitura da faixa de click (a `ClickAnalysis` da T3 encaixa por estrutura). */
export interface ClickAnalysisLike { bpm: number; firstPulse: number; pulsesPerBar: number | null; firstDownbeat: number | null }

/** Traz `x` pra dentro de `[0, bar)`. Compasso inválido: só tira o negativo e o não finito. */
function intoFirstBar(x: number, bar: number): number {
  if (!Number.isFinite(x)) return 0
  if (!Number.isFinite(bar) || bar <= 0) return Math.max(0, x)
  const r = ((x % bar) + bar) % bar
  return r < bar ? r : 0
}

/**
 * Grade lida na faixa de click. Compasso: o salvo (`'salvo'`), senão o que o acento mostrou
 * (`'acento'`), senão 4/4 (`'padrao'`). O primeiro 1 (`firstDownbeat`, ou o primeiro pulso sem
 * acento) vai pra dentro do primeiro compasso do compasso que vale.
 */
export function gridFromClick(a: ClickAnalysisLike, savedSignature?: TimeSignature | null): SongGrid {
  const saved = knownSignature(savedSignature)
  const accent = a.pulsesPerBar === null ? null : signatureForPulses(a.pulsesPerBar)
  const signature = saved ?? accent ?? '4/4'
  const meterSource: MeterSource = saved ? 'salvo' : accent ? 'acento' : 'padrao'
  const bar = (60 / a.bpm) * pulsesPerBar(signature)
  const firstDownbeat = intoFirstBar(a.firstDownbeat ?? a.firstPulse, bar)
  return { bpm: a.bpm, firstDownbeat, signature, countEvery: 1, source: 'click', meterSource }
}

// ---------- Compasso manual ----------

/** Compasso escolhido no modo EDITAR. Contar de 3 em 3 só vale no composto; BPM, fase e origem ficam. */
export function withMeter(g: SongGrid, signature: TimeSignature, countEvery: 1 | 3): SongGrid {
  return { ...g, signature, countEvery: isCompound(signature) ? countEvery : 1, meterSource: 'manual' }
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
 * grade nova só com os campos dela, com a mesma regra do `withMeter`: 3 em 3 fora do composto vira 1.
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
  return { bpm, firstDownbeat, signature, countEvery: isCompound(signature) ? countEvery : 1, source, meterSource }
}

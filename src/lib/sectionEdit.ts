// Modo EDITAR do palco (Parte 2): marcar, ajustar e remover seções nas marcas da música.
// Puro: sem React. Toda função devolve uma lista nova, em ordem de tempo, e nunca muta a
// recebida nem as marcas dela. As operações são por `markerId` (a T29 traduz o índice do
// bloco na tela com `markerIdForSpan`).
import type { Marker } from '../types'
import { colorForSection, normalizeSectionName } from './sectionTypes'
import { barSeconds, sanitizeGrid, snapToBar } from './songGrid'
import { gridHasPhase, type SongGrid } from './stageContracts'

/** Sem fase (sem grade ou só o BPM salvo): marca nova a menos disso de outra troca o nome dela. */
const NEAR_NO_PHASE_S = 0.5
/** Folga entre uma seção ajustada e a vizinha, pra as duas nunca caírem no mesmo ponto. */
const NEIGHBOR_GAP_S = 0.1

/** Marca com tempo de verdade. As marcas da nuvem chegam sem limpeza: item nulo ou sem tempo numérico não conta. */
function hasTime(m: Marker | null | undefined): m is Marker {
  return m != null && Number.isFinite(m.time)
}

/** Cópia em ordem de tempo (estável); marca sem tempo numérico vai pro fim, na ordem em que veio. */
function byTime(markers: readonly Marker[]): Marker[] {
  const at = (m: Marker) => (hasTime(m) ? m.time : Infinity)
  return [...markers].sort((a, b) => {
    const x = at(a)
    const y = at(b)
    return x === y ? 0 : x < y ? -1 : 1
  })
}

/** A grade sabe onde cai o 1 (click lido e grade usável): só aí o encaixe e o compasso valem. */
function phaseGrid(grid: SongGrid | null): SongGrid | null {
  return grid !== null && gridHasPhase(grid) && sanitizeGrid(grid) !== null ? grid : null
}

/**
 * Marca uma seção em `time` (a posição ouvida), já encaixada na barra (`snapToBar`). Se já há
 * uma marca a menos de meio compasso (sem fase, 0,5 s), troca o nome e a cor dela (a mais perto)
 * em vez de criar outra; o tempo e o resto dela ficam. Nome limitado a 14 caracteres
 * (`normalizeSectionName`) e cor pelo tipo (`colorForSection`). Nome vazio ou tempo que não é
 * número não criam nada.
 */
export function addSectionAt(markers: readonly Marker[], time: number, label: string, grid: SongGrid | null, newId: () => string): Marker[] {
  const name = normalizeSectionName(label)
  if (!name || !Number.isFinite(time)) return byTime(markers)
  const t = snapToBar(time, grid)
  const g = phaseGrid(grid)
  const near = g ? barSeconds(g) / 2 : NEAR_NO_PHASE_S
  let hit: Marker | null = null
  for (const m of markers) {
    if (!hasTime(m) || Math.abs(m.time - t) >= near) continue
    if (!hit || Math.abs(m.time - t) < Math.abs(hit.time - t)) hit = m
  }
  const color = colorForSection(name)
  if (hit) {
    const target = hit
    return byTime(markers.map((m) => (m === target ? { ...m, label: name, color } : m)))
  }
  return byTime([...markers, { id: newId(), time: t, label: name, color }])
}

/**
 * Anda a seção `bars` compassos (positivo pra frente). Com fase, compasso inteiro e o resultado
 * encaixado na barra; se o pedido passaria da vizinha, anda só os compassos que cabem (nunca um
 * pedaço de compasso). Sem fase, `bars` segundos sem encaixe, parando na vizinha. Nunca chega
 * a menos de 0,1 s da vizinha (com fase, contada onde ela encaixa no palco) nem antes de 0:00,
 * e nunca anda pro lado contrário do pedido. Só o tempo da marca muda.
 */
export function nudgeSection(markers: readonly Marker[], markerId: string, bars: number, grid: SongGrid | null): Marker[] {
  const sorted = byTime(markers)
  const i = sorted.findIndex((m) => m != null && m.id === markerId)
  const m = sorted[i]
  if (i < 0 || !hasTime(m) || !Number.isFinite(bars) || bars === 0) return sorted

  const g = phaseGrid(grid)
  const where = (x: Marker) => (g ? snapToBar(x.time, g) : x.time)
  const prev = i > 0 && hasTime(sorted[i - 1]) ? sorted[i - 1] : null
  const next = i + 1 < sorted.length && hasTime(sorted[i + 1]) ? sorted[i + 1] : null
  const lo = prev ? where(prev) + NEIGHBOR_GAP_S : 0
  const hi = next ? where(next) - NEIGHBOR_GAP_S : Infinity
  const dir = Math.sign(bars)

  let time = m.time
  if (g) {
    const bar = barSeconds(g)
    for (let k = bars; Math.sign(k) === dir; k -= dir) {
      const t = snapToBar(m.time + k * bar, g)
      if (t >= lo && t <= hi) { time = t; break }
    }
  } else {
    const t = Math.min(hi, Math.max(lo, m.time + bars))
    time = dir > 0 ? Math.max(m.time, t) : Math.min(m.time, t)
  }
  if (time === m.time) return sorted
  return byTime(sorted.map((x) => (x === m ? { ...x, time } : x)))
}

/** Tira a marca `markerId`; as outras ficam como estão (marca que não existe: a lista igual). */
export function removeSection(markers: readonly Marker[], markerId: string): Marker[] {
  return byTime(markers.filter((m) => m == null || m.id !== markerId))
}

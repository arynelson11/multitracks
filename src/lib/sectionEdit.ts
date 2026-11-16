// Modo EDITAR do palco (Parte 2): marcar, ajustar e remover seções nas marcas da música.
// Puro: sem React. Toda função devolve uma lista nova, em ordem de tempo, e nunca muta a
// recebida nem as marcas dela. As operações são por `markerId` (a T29 traduz o índice do
// bloco na tela com `markerIdForSpan`).
import type { Marker } from '../types'
import { colorForSection, defaultSectionName, normalizeSectionName } from './sectionTypes'
import { barSeconds, markerIdForSpan, sanitizeGrid, sectionSpans, snapToBar } from './songGrid'
import { gridHasPhase, type SongGrid } from './stageContracts'

/** Sem fase (sem grade ou só o BPM salvo): marca nova a menos disso de outra troca o nome dela. */
const NEAR_NO_PHASE_S = 0.5
/** Sem fase: folga entre uma seção ajustada e a vizinha, pra as duas nunca caírem no mesmo ponto. */
const NEIGHBOR_GAP_S = 0.1
/** Sem fase: a última seção fica com pelo menos isso antes do fim do áudio (com fase, 1 compasso). */
const END_NO_PHASE_S = 1
/** Folga de arredondamento nas comparações de tempo (1 microssegundo, a mesma do songGrid). */
const EPS = 1e-6

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
 * Marca uma seção em `time` (a posição ouvida), já encaixada na barra (`snapToBar`), com nome
 * limitado a 14 caracteres (`normalizeSectionName`) e cor pelo tipo (`colorForSection`). Se já
 * há uma marca a menos de meio compasso (sem fase, 0,5 s), muda a mais perto em vez de criar
 * outra; o tempo, o id e a letra dela ficam. MARCAR (`label` é um tipo) muda o TIPO dela: a cor
 * vira a do tipo; o nome só acompanha quando ainda é o nome padrão de um tipo ("Verso 2" vira
 * "Refrão 2"), e nome próprio fica como está (Ruling T16-nome-proprio). `label` que não é tipo
 * é um nome dado por quem chamou e troca o nome. Nome vazio ou tempo que não é número não criam nada.
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
    const relabeled = renamedForType(target.label, name)
    return byTime(markers.map((m) => (m === target ? { ...m, label: relabeled, color } : m)))
  }
  return byTime([...markers, { id: newId(), time: t, label: name, color }])
}

/**
 * Nome da seção que muda pro tipo `name`: nome padrão vira o padrão do tipo novo, com o mesmo
 * número; nome próprio fica. Se `name` não é um tipo, é o nome novo.
 */
function renamedForType(old: string, name: string): string {
  const type = defaultSectionName(name)
  if (!type || type.number !== null) return name
  const before = typeof old === 'string' ? defaultSectionName(old) : null
  if (!before) return typeof old === 'string' ? old : name
  return normalizeSectionName(before.number === null ? type.type : `${type.type} ${before.number}`)
}

/**
 * Seções como o palco mostra, com a marca de cada uma: o mesmo `sectionSpans` da T2 (início na
 * barra, no pulso ou cru). Marca escondida (no mesmo ponto de outra, ou depois do fim) não entra.
 */
function stageSections(markers: readonly Marker[], duration: number, grid: SongGrid | null): { id: string | null; start: number }[] {
  return sectionSpans(markers, duration, grid).map((s) => ({ id: markerIdForSpan(markers, duration, grid, s.index), start: s.start }))
}

/**
 * Anda a seção `bars` compassos (positivo pra frente), contando tudo pelo encaixe do palco
 * (`sectionSpans`, Ruling T16-encaixe). Com fase, vai pra barra seguinte (ou anterior) de onde
 * ela aparece no palco e dali mais `|bars| - 1` compassos; se o pedido passaria da vizinha, anda
 * só os compassos que cabem (nunca um pedaço). Sem fase, `bars` segundos sem encaixe, parando a
 * 0,1 s da vizinha. Nunca antes de 0:00, nunca pro lado contrário do pedido, e pra frente a
 * última seção fica com pelo menos 1 compasso (sem fase, 1 s) antes do fim do áudio (Ruling
 * T16-fim). Movimento que faria alguma seção sumir do palco ou trocar de ordem não acontece.
 * Marca que não aparece no palco, ou `duration` que não é um número positivo: nada muda.
 * Só o tempo da marca muda.
 */
export function nudgeSection(markers: readonly Marker[], markerId: string, bars: number, grid: SongGrid | null, duration: number): Marker[] {
  const sorted = byTime(markers)
  const steps = Math.round(Math.abs(bars))
  if (!Number.isFinite(bars) || steps === 0 || !Number.isFinite(duration) || duration <= 0) return sorted
  const m = sorted.find((x) => x != null && x.id === markerId)
  if (!m || !hasTime(m)) return sorted

  const before = stageSections(sorted, duration, grid)
  const at = before.findIndex((s) => s.id === markerId)
  if (at < 0) return sorted
  const from = before[at].start
  const prev = at > 0 ? before[at - 1].start : null
  const next = at + 1 < before.length ? before[at + 1].start : null
  const dir = bars > 0 ? 1 : -1
  const order = before.map((s) => s.id)

  const moved = (time: number) => byTime(sorted.map((x) => (x === m ? { ...x, time } : x)))
  // Confere no próprio palco: as seções de antes continuam todas lá, na mesma ordem.
  const keeps = (list: Marker[]) => {
    const known = new Set(order)
    const after = stageSections(list, duration, grid).map((s) => s.id).filter((id) => known.has(id))
    return after.length === order.length && after.every((id, i) => id === order[i])
  }
  const accept = (t: number): Marker[] | null => {
    if (dir > 0 ? t <= from + EPS : t >= from - EPS) return null
    const list = moved(t)
    return keeps(list) ? list : null
  }

  const g = phaseGrid(grid)
  if (g) {
    const bar = barSeconds(g)
    const pos = (from - g.firstDownbeat) / bar
    // Barra seguinte (ou anterior) a onde a seção aparece; numa barra, a do lado.
    const first = dir > 0 ? Math.floor(pos + 1e-9) + 1 : Math.ceil(pos - 1e-9) - 1
    for (let k = steps; k >= 1; k--) {
      const t = Math.max(0, g.firstDownbeat + (first + dir * (k - 1)) * bar)
      if (dir > 0 && (next !== null ? t >= next - EPS : t > duration - bar + EPS)) continue
      if (dir < 0 && prev !== null && t <= prev + EPS) continue
      const list = accept(t)
      if (list) return list
    }
    return sorted
  }

  const t = dir > 0
    ? Math.min(next !== null ? next - NEIGHBOR_GAP_S : duration - END_NO_PHASE_S, from + bars)
    : Math.max(prev !== null ? prev + NEIGHBOR_GAP_S : 0, from + bars)
  return accept(t) ?? sorted
}

/** Tira a marca `markerId`; as outras ficam como estão (marca que não existe: a lista igual). */
export function removeSection(markers: readonly Marker[], markerId: string): Marker[] {
  return byTime(markers.filter((m) => m == null || m.id !== markerId))
}

// BPM que a pessoa vê no palco (a faixa do meio e o compasso do EDITAR usam a mesma regra).
import { displayBpmFromPulseBpm } from '../../lib/stageContracts'
import type { SongGrid } from '../../lib/stageContracts'

/**
 * BPM exibido, sempre a semínima (Ruling T3-BPM, Ruling T13-bpm). A grade guarda o BPM do PULSO
 * (a colcheia no x/8: o "Fé" em 6/8 tem a grade em 156), então passa pela conversão única do
 * contrato (156 em 6/8 = 78, 140 em 7/8 = 70). Sem grade, ou com o BPM dela quebrado, o BPM salvo
 * da música, que já é a semínima; nulo sem nenhum dos dois.
 */
export function shownBpm(grid: SongGrid | null, songBpm: number | null): number | null {
  const fromGrid = grid ? displayBpmFromPulseBpm(grid.bpm, grid.signature) : NaN
  if (Number.isFinite(fromGrid)) return fromGrid
  return songBpm !== null && Number.isFinite(songBpm) && songBpm > 0 ? songBpm : null
}

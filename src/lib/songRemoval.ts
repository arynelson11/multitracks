// Quem vira a música atual quando uma sai do repertório (D4: tirar música vale pra todos). O motor
// e o App usam a mesma conta: o motor pra trocar, o App pra o Livre conferir antes se a troca
// passa no portão das músicas do mês (ajuste do coordenador na T17 da Parte 3).

/** Nenhuma música atual: a VS fica parada sem música, como o repertório vazio. */
export const NO_CURRENT_SONG = -1

/**
 * Tirando a música atual, a que vinha depois dela vira a atual (ou a anterior, se ela era a
 * última), com o índice no repertório já sem ela. Nulo quando nenhuma vira a atual por isso:
 * tirou outra música, tirou a única, a música não está no repertório ou não havia música atual.
 */
export function songOpenedByRemoval<S extends { id: string }>(playlist: readonly S[], activeIndex: number, removedId: string): { index: number; song: S } | null {
  const removedIndex = playlist.findIndex((s) => s.id === removedId)
  if (removedIndex === -1 || removedIndex !== activeIndex) return null
  const rest = playlist.filter((s) => s.id !== removedId)
  if (rest.length === 0) return null
  const index = Math.min(removedIndex, rest.length - 1)
  return { index, song: rest[index] }
}

/**
 * O portão recusa a troca que tirar a música faria? Só quando sai a atual e a que viraria a atual
 * não passa em `canOpen` (no Livre, o mês cheio e ela ainda não contada). Quem paga passa um
 * portão que sempre abre.
 */
export function removalOpensRefusedSong<S extends { id: string }>(playlist: readonly S[], activeIndex: number, removedId: string, canOpen: (song: S) => boolean): boolean {
  const opened = songOpenedByRemoval(playlist, activeIndex, removedId)
  return opened !== null && !canOpen(opened.song)
}

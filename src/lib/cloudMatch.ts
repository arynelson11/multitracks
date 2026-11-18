// Qual música da nuvem é a música do aparelho, pra gravar marcadores e letra (do admin) nela.
// Só pela id da nuvem que o download grava na música (`sourceId`): achar pelo nome com "contém"
// gravava em outra música da biblioteca de todo mundo ("Santo" dentro de "Santo Espírito").

/**
 * Música da nuvem com a id `song.sourceId`. Sem `sourceId` (música importada do aparelho, ou
 * baixada antes de a id existir) ou com uma id que não está mais na lista: nulo, e o que se
 * editou fica só no aparelho.
 */
export function cloudSongOf<T extends { id: string }>(cloudSongs: readonly T[], song: { sourceId?: string }): T | null {
  const id = song.sourceId
  if (!id) return null
  return cloudSongs.find((cs) => cs.id === id) ?? null
}

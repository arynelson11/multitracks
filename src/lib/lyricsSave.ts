// Gravar a letra e a cifra do editor (manutenção 2026-11-27): sempre na música da id que o editor
// guardou ao abrir, mesmo que a música ativa tenha mudado no meio (o operador trocou, o AUTO passou
// pra próxima, a banda escolheu pelo celular). O caminho é o de antes: o aparelho primeiro e a nuvem
// só pela id que o download gravou (sourceId), nunca pelo nome. Se a música saiu do repertório,
// nada é gravado e o editor avisa.
import { cloudSongOf } from './cloudMatch'
import type { Song } from '../types'

export type LyricsData = { lyrics: string | null; lyricsSynced: string | null; chords: string | null }

/**
 * O que o editor precisa da música (revisão das telas, M6): a id, o nome e o artista e a duração da
 * busca, e os três textos. Nunca a música inteira, que segura os canais (o áudio decodificado, os nós
 * do som e os arquivos) enquanto o editor está aberto.
 */
export type LyricsSong = Pick<Song, 'id' | 'name' | 'artist' | 'duration' | 'lyrics' | 'lyricsSynced' | 'chords'>

export function lyricsSongOf(song: LyricsSong): LyricsSong {
  return { id: song.id, name: song.name, artist: song.artist, duration: song.duration, lyrics: song.lyrics, lyricsSynced: song.lyricsSynced, chords: song.chords }
}

/** true: na nuvem e no aparelho; false: só no aparelho; 'missing': a música saiu do repertório, nada gravado. */
export type LyricsSaveResult = boolean | 'missing'

export interface LyricsSaveDeps {
  playlist: readonly { id: string; sourceId?: string }[]
  setLocal: (songId: string, data: LyricsData) => void
  fetchCloudSongs: () => Promise<readonly { id: string }[]>
  updateSong: (cloudId: string, updates: { lyrics: string | null; lyrics_synced: string | null; chords: string | null }) => Promise<boolean>
}

export async function saveSongLyrics(songId: string, data: LyricsData, deps: LyricsSaveDeps): Promise<LyricsSaveResult> {
  const song = deps.playlist.find((s) => s.id === songId)
  if (!song) return 'missing'
  // Estado local (reflete no follower e persiste no IndexedDB).
  deps.setLocal(song.id, data)
  // Nuvem: só a música com a id que o download gravou (sourceId). Sem ela, fica só no aparelho.
  if (!song.sourceId) return false
  try {
    const match = cloudSongOf(await deps.fetchCloudSongs(), song)
    if (match) return await deps.updateSong(match.id, { lyrics: data.lyrics, lyrics_synced: data.lyricsSynced, chords: data.chords })
  } catch (e) {
    console.error('Falha ao salvar letra/cifra na nuvem:', e)
  }
  return false
}

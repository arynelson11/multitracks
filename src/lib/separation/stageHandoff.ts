// Abrir a separação no palco (Parte 3): o que o Separador entrega ao App e as contas da entrega.
// O nome, o BPM e o tom que o palco recebe, as faixas que abrem (só as remotas), o mixer salvo de
// cada uma e o download das faixas, tudo ou nada (uma falha derruba o conjunto: nada entra pela
// metade no repertório). Tudo puro; o fetch entra por parâmetro.
import type { SavedSeparation, SavedStem } from '../../hooks/useSeparationLibrary'
import type { ChannelStartState, SeparationLink } from '../../types'
import { KEY_NAMES } from '../keyNames'

/** O que o Separador entrega ao App. `files` nulo: a separação já está no repertório, só pular. */
export interface StageSeparationOpen { sep: SavedSeparation; files: File[] | null; justSeparated: boolean }

export interface StageSeparationMeta { name: string; artist?: string; bpm?: number; originalKey?: string; separation: SeparationLink }

export const OPEN_ERROR_TEXT = 'Não deu pra baixar as faixas da separação. Confira a internet e tente de novo.'

/**
 * Nome "Artista - Música" quando há artista (como a Biblioteca), "Sem título" sem nome. BPM "120"
 * e tom "C" são o padrão sem valor da separação (P6): o palco recebe sem eles e lê sozinho.
 */
export function separationStageMeta(sep: SavedSeparation): StageSeparationMeta {
  const title = sep.songName?.trim() || 'Sem título'
  const artist = sep.artist?.trim() || undefined
  const n = Number(sep.bpm)
  const bpm = sep.bpm !== '120' && sep.bpm?.trim() !== '' && Number.isFinite(n) && n >= 20 && n <= 300 ? n : undefined
  const originalKey = sep.songKey && sep.songKey !== 'C' && KEY_NAMES.includes(sep.songKey) ? sep.songKey : undefined
  return {
    name: artist ? `${artist} - ${title}` : title,
    artist,
    bpm,
    originalKey,
    separation: { id: sep.id, createdAt: sep.createdAt },
  }
}

/** As faixas que abrem no palco: só as com URL http(s) (a local, blob:, não sobrevive), na ordem. */
export function stemsToOpen(sep: SavedSeparation): SavedStem[] {
  return sep.stems.filter((s) => /^https?:\/\//.test(s.url))
}

/** O mixer salvo de cada faixa, na ordem; sem estado, vazio (o motor usa o padrão). */
export function separationChannelStates(stems: readonly SavedStem[]): (ChannelStartState | undefined)[] {
  return stems.map((s) => (s.state ? { volume: s.state.volume, muted: s.state.muted, soloed: s.state.soloed, pan: s.state.pan } : undefined))
}

/**
 * Baixa as faixas uma por vez (memória do iPad), cada uma como `<nome>.wav` ("Faixa N" sem nome),
 * com o tipo do arquivo ou `audio/wav`. Qualquer falha ou `abort` lança e nada é devolvido.
 */
export async function fetchSeparationFiles(
  stems: readonly SavedStem[],
  i: { fetchImpl?: typeof fetch; signal?: AbortSignal; onProgress?(done: number, total: number): void } = {},
): Promise<File[]> {
  if (stems.length === 0) throw new Error('Nenhuma faixa pra abrir')
  const doFetch = i.fetchImpl ?? fetch
  const files: File[] = []
  i.onProgress?.(0, stems.length)
  for (let n = 0; n < stems.length; n++) {
    if (i.signal?.aborted) throw new DOMException('Cancelado', 'AbortError')
    const stem = stems[n]
    const res = await doFetch(stem.url, { signal: i.signal })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const blob = await res.blob()
    if (i.signal?.aborted) throw new DOMException('Cancelado', 'AbortError')
    const name = stem.name?.trim() || `Faixa ${n + 1}`
    files.push(new File([blob], `${name}.wav`, { type: blob.type || 'audio/wav' }))
    i.onProgress?.(n + 1, stems.length)
  }
  return files
}

/** Posição da música que veio desta separação no repertório; -1 sem. */
export function findSeparationSong(playlist: readonly { separation?: { id: string } }[], sepId: string): number {
  return playlist.findIndex((s) => s.separation?.id === sepId)
}

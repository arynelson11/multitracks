// Abrir a separação no palco (Parte 3): o que o Separador entrega ao App e as contas da entrega.
// O nome, o BPM e o tom que o palco recebe, as faixas que abrem (só as remotas), o mixer salvo de
// cada uma e o download das faixas, tudo ou nada (uma falha derruba o conjunto: nada entra pela
// metade no repertório). Cada faixa é gravada no aparelho enquanto desce (Ruling SEP-memoria,
// manutenção 2026-11-27) e só a id dela segue pro App. Tudo puro; o fetch e o aparelho entram por
// parâmetro.
import type { SavedSeparation, SavedStem } from '../../hooks/useSeparationLibrary'
import type { ChannelStartState, SeparationLink } from '../../types'
import { KEY_NAMES } from '../keyNames'

/** Uma faixa já gravada no aparelho (a id é a do canal no repertório) e o nome do arquivo. */
export interface StoredStem { id: string; name: string }

/** Onde as faixas descem: `put` grava no aparelho e devolve a id; `discard` tira as que não vão entrar. */
export interface StemStore {
  put(file: File): Promise<string>
  discard(ids: readonly string[]): Promise<void>
}

/** O que o Separador entrega ao App. `stems` nulo: a separação já está no repertório, só pular. */
export interface StageSeparationOpen { sep: SavedSeparation; stems: StoredStem[] | null; justSeparated: boolean }

export interface StageSeparationMeta { name: string; artist?: string; bpm?: number; originalKey?: string; separation: SeparationLink }

export const OPEN_ERROR_TEXT = 'Não deu pra baixar as faixas da separação. Confira a internet e tente de novo.'
/** O servidor respondeu que uma faixa não existe mais (4xx, sep-2 I3): a internet não é o problema. */
export const OPEN_MISSING_TEXT = 'Uma das faixas dessa separação não está mais na nuvem. Abra aqui no Separador pra usar as outras.'

/** O servidor respondeu com erro ao baixar uma faixa (o status vai junto, sep-2 I3). */
export class SeparationFetchError extends Error {
  readonly status: number
  constructor(status: number) {
    super(`HTTP ${status}`)
    this.status = status
  }
}

/** A frase do erro ao abrir no palco: faixa que não existe mais (4xx) ou falta de internet (o resto). */
export function openErrorText(e: unknown): string {
  return e instanceof SeparationFetchError && e.status >= 400 && e.status < 500 ? OPEN_MISSING_TEXT : OPEN_ERROR_TEXT
}

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
 * Baixa as faixas uma por vez, cada uma como `<nome>.wav` ("Faixa N" sem nome), com o tipo do
 * arquivo ou `audio/wav`, e grava cada uma no aparelho (`store.put`) antes de pedir a próxima: só
 * uma faixa crua fica na memória por vez (memória do iPad, Ruling SEP-memoria). Devolve as ids e os
 * nomes. Qualquer falha (rede, servidor, gravar no aparelho) ou `abort`, inclusive depois da última,
 * tira do aparelho o que já tinha sido gravado (`store.discard`) e lança: nada entra pela metade.
 */
export async function fetchSeparationStems(
  stems: readonly SavedStem[],
  i: { store: StemStore; fetchImpl?: typeof fetch; signal?: AbortSignal; onProgress?(done: number, total: number): void },
): Promise<StoredStem[]> {
  if (stems.length === 0) throw new Error('Nenhuma faixa pra abrir')
  const doFetch = i.fetchImpl ?? fetch
  const stored: StoredStem[] = []
  const cancelled = () => new DOMException('Cancelado', 'AbortError')
  try {
    i.onProgress?.(0, stems.length)
    for (let n = 0; n < stems.length; n++) {
      if (i.signal?.aborted) throw cancelled()
      const stem = stems[n]
      const res = await doFetch(stem.url, { signal: i.signal })
      if (!res.ok) throw new SeparationFetchError(res.status)
      const blob = await res.blob()
      if (i.signal?.aborted) throw cancelled()
      const name = `${stem.name?.trim() || `Faixa ${n + 1}`}.wav`
      stored.push({ id: await i.store.put(new File([blob], name, { type: blob.type || 'audio/wav' })), name })
      i.onProgress?.(n + 1, stems.length)
    }
    // O Voltar chegou enquanto a última gravava: também não entra.
    if (i.signal?.aborted) throw cancelled()
    return stored
  } catch (e) {
    await i.store.discard(stored.map((s) => s.id)).catch((err: unknown) => { console.error('[Separação] não deu pra tirar as faixas gravadas', err) })
    throw e
  }
}

/** Posição da música que veio desta separação no repertório; -1 sem. */
export function findSeparationSong(playlist: readonly { separation?: { id: string } }[], sepId: string): number {
  return playlist.findIndex((s) => s.separation?.id === sepId)
}

/**
 * A separação que chegou com as faixas (sep-1 C1): espera o motor pronto e o repertório salvo
 * restaurado; se o repertório restaurado já tem essa separação, só pula pra ela (sem carregar de
 * novo, P7); senão, carrega.
 */
export function pendingSeparationStep(
  sepId: string,
  engine: { isReady: boolean; isRestoring: boolean },
  playlist: readonly { separation?: { id: string } }[],
): 'esperar' | 'pular' | 'carregar' {
  if (!engine.isReady || engine.isRestoring) return 'esperar'
  return findSeparationSong(playlist, sepId) >= 0 ? 'pular' : 'carregar'
}

/** O palco não conseguiu abrir nenhuma faixa da separação (sep-1 M3). */
export const STAGE_LOAD_ERROR_TEXT = 'Não deu pra abrir as faixas dessa separação no palco. Tente de novo em Minhas separações.'

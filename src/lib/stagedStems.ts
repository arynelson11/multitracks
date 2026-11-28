// Faixas gravadas no aparelho antes de entrarem no repertório (manutenção 2026-11-27, Ruling
// SEP-memoria). A separação que abre no palco desce faixa por faixa direto pras chaves por faixa do
// repertório (as mesmas do loadFiles), então nunca ficam todas as faixas cruas na memória juntas.
// Quem gravou fica anotado numa lista (a sessão, isto é, esta abertura do app, e a hora): se o app
// cair entre o download e a música entrar, a restauração seguinte tira o que nenhuma música usa.
// O cache offline das músicas da biblioteca não serve aqui: ele é preso a uma música da nuvem (o
// índice e o sourceId) e não sai quando a música sai do repertório.
import { del, get, set } from 'idb-keyval'

/** Esta abertura do app. O que outra sessão anotou e nenhuma música usa sai na restauração. */
const SESSION = crypto.randomUUID()

/** Outra sessão recente pode ser outra aba baixando agora: só sai depois deste tempo. */
export const STAGED_STALE_MS = 60 * 60 * 1000

type StagedEntry = { id: string; session: string; at: number }

export const stagedRegistryKey = (filesKey: string) => `${filesKey}:staged`

const readList = async (filesKey: string): Promise<StagedEntry[]> => {
  const list = await get<unknown>(stagedRegistryKey(filesKey))
  return Array.isArray(list) ? list.filter((e): e is StagedEntry => !!e && typeof (e as StagedEntry).id === 'string') : []
}

// As mudanças na lista vão uma de cada vez (ler, mudar e gravar), pra nenhuma anotação se perder.
let queue: Promise<unknown> = Promise.resolve()
function updateList(filesKey: string, change: (list: StagedEntry[]) => StagedEntry[]): Promise<void> {
  const run = queue.then(async () => { await set(stagedRegistryKey(filesKey), change(await readList(filesKey))) })
  queue = run.catch(() => {})
  return run
}

/** Grava uma faixa no aparelho, na chave por faixa do repertório, e devolve a id dela (a do canal). */
export async function putStagedStem(filesKey: string, fileKey: (id: string) => string, file: File): Promise<string> {
  const id = crypto.randomUUID()
  // A lista antes do arquivo: se o app cair entre os dois, sobra só a anotação (inofensiva).
  await updateList(filesKey, (list) => [...list, { id, session: SESSION, at: Date.now() }])
  await set(fileKey(id), file)
  return id
}

/** Tira do aparelho as faixas que não vão entrar no repertório. */
export async function discardStagedStems(filesKey: string, fileKey: (id: string) => string, ids: readonly string[]): Promise<void> {
  if (ids.length === 0) return
  await Promise.all(ids.map((id) => del(fileKey(id))))
  const gone = new Set(ids)
  await updateList(filesKey, (list) => list.filter((e) => !gone.has(e.id)))
}

/**
 * Na restauração: o que outra sessão (já antiga) deixou anotado sai do aparelho se nenhuma música do
 * repertório usa; o que uma música usa fica (ela entrou). As anotações desta sessão não mudam.
 */
export async function sweepStagedStems(filesKey: string, fileKey: (id: string) => string, usedIds: ReadonlySet<string>): Promise<void> {
  const now = Date.now()
  // Sem hora (anotação estragada) conta como antiga.
  const stale = (await readList(filesKey)).filter((e) => e.session !== SESSION && !(now - e.at < STAGED_STALE_MS))
  if (stale.length === 0) return
  await Promise.all(stale.filter((e) => !usedIds.has(e.id)).map((e) => del(fileKey(e.id))))
  const done = new Set(stale.map((e) => e.id))
  await updateList(filesKey, (list) => list.filter((e) => !done.has(e.id)))
}

// Faixas gravadas no aparelho antes de entrarem no repertório (manutenção 2026-11-27, Ruling
// SEP-memoria). A separação que abre no palco desce faixa por faixa direto pras chaves por faixa do
// repertório (as mesmas do loadFiles), então nunca ficam todas as faixas cruas na memória juntas.
// Quem gravou fica anotado numa lista (a sessão, isto é, esta abertura do app, e a hora): se o app
// cair entre o download e a música entrar, a restauração seguinte tira o que nenhuma música usa.
// O cache offline das músicas da biblioteca não serve aqui: ele é preso a uma música da nuvem (o
// índice e o sourceId) e não sai quando a música sai do repertório.
import { del, get, set } from 'idb-keyval'

/**
 * Uma id nova. `crypto.randomUUID` só existe em contexto seguro: o celular da banda abre o app por
 * http://<IP da rede local>, onde ele falta (revisão do item 4, C1). Lá vão 16 bytes do
 * `crypto.getRandomValues` em hex.
 */
function newId(): string {
  const c = globalThis.crypto
  if (typeof c.randomUUID === 'function') return c.randomUUID()
  return Array.from(c.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('')
}

/**
 * Esta abertura do app, criada na primeira vez que precisa (nunca ao carregar o módulo, que entra no
 * pacote principal pelo motor). O que outra sessão anotou e nenhuma música usa sai na restauração.
 */
let session: string | null = null
const sessionId = () => (session ??= newId())

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
  const id = newId()
  // A lista antes do arquivo: se o app cair entre os dois, sobra só a anotação (inofensiva).
  await updateList(filesKey, (list) => [...list, { id, session: sessionId(), at: Date.now() }])
  await set(fileKey(id), file)
  return id
}

/**
 * A música entrou no repertório (o registro provisório do loadFiles já aponta pras faixas): a
 * anotação sai da lista e o arquivo fica. Daí em diante a limpeza nunca olha pra essas faixas, nem
 * quando outra aba grava um repertório sem a música (revisão do item 4, I1).
 */
export async function releaseStagedStems(filesKey: string, ids: readonly string[]): Promise<void> {
  if (ids.length === 0) return
  const entered = new Set(ids)
  await updateList(filesKey, (list) => list.filter((e) => !entered.has(e.id)))
}

/** Tira do aparelho as faixas que não vão entrar no repertório. */
export async function discardStagedStems(filesKey: string, fileKey: (id: string) => string, ids: readonly string[]): Promise<void> {
  if (ids.length === 0) return
  await Promise.all(ids.map((id) => del(fileKey(id))))
  const gone = new Set(ids)
  await updateList(filesKey, (list) => list.filter((e) => !gone.has(e.id)))
}

/**
 * Na restauração: o que outra sessão (já antiga) deixou anotado é faixa que nunca entrou em música
 * (a que entra sai da lista no registro provisório); sai do aparelho se nenhuma música do repertório
 * usa, por garantia. As anotações desta sessão não mudam.
 */
export async function sweepStagedStems(filesKey: string, fileKey: (id: string) => string, usedIds: ReadonlySet<string>): Promise<void> {
  const now = Date.now()
  // Sem hora (anotação estragada) conta como antiga.
  const stale = (await readList(filesKey)).filter((e) => e.session !== sessionId() && !(now - e.at < STAGED_STALE_MS))
  if (stale.length === 0) return
  await Promise.all(stale.filter((e) => !usedIds.has(e.id)).map((e) => del(fileKey(e.id))))
  const done = new Set(stale.map((e) => e.id))
  await updateList(filesKey, (list) => list.filter((e) => !done.has(e.id)))
}

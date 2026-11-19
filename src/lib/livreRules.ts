import { brtMonth } from './separationUsage'

// Regras puras do Livre no aparelho (spec 5 e 6). O que custa dinheiro (separação, checkout)
// o servidor barra; o resto do Livre é contado aqui, sem React e sem armazenamento: o store
// (livreStore.ts) guarda, o hook (useLivre) junta com o motor. Mês e dia sempre os de Brasília.
//
// As funções que mudam estado devolvem o mesmo objeto quando nada muda, pra quem guarda o
// resultado em estado do React não renderizar à toa.

// Os limites que abrem a tela de limite. A mesma lista vive no servidor (OFFER_TRIGGERS em
// api/_lib/offer.ts) e no CHECK do SQL da oferta: mudar aqui é mudar lá.
export type LimitKind = 'separations' | 'stage-songs' | 'live' | 'repertoire' | 'download'
export const LIMIT_KINDS: readonly LimitKind[] = ['separations', 'stage-songs', 'live', 'repertoire', 'download']

// Os lugares do anúncio da casa (AD_PLACEMENTS no servidor, mesma lista).
export type AdPlacement = 'home' | 'separation-done' | 'limit' | 'badge'

// O estado do motor que decide se pode aparecer tela por cima.
export type EngineBusy = { isPlaying: boolean; isCountingIn: boolean }

// Parado de verdade: nem tocando nem na pré-contagem. Só assim aparece anúncio, oferta,
// aviso de limite ou qualquer tela por cima.
export function isQuiet(e: EngineBusy): boolean {
  return !e.isPlaying && !e.isCountingIn
}

// ── Músicas diferentes do mês no palco ──
// Cada música vira uma chave (D3): `cloud:<id da nuvem>`, `song:<id no repertório>` ou
// `sep:<id da separação>`. O registro do mês guarda as chaves já abertas.

export type StageLedger = { month: string; keys: readonly string[] }

// O registro guardado, se for do mês pedido. Outro mês (o mês virou), formato errado ou
// nada guardado: o mês começa vazio. Chave repetida conta uma vez só.
export function stageLedgerFor(raw: unknown, month: string): StageLedger {
  const empty: StageLedger = { month, keys: [] }
  if (!raw || typeof raw !== 'object') return empty
  const r = raw as Record<string, unknown>
  if (r.month !== month || !Array.isArray(r.keys)) return empty
  if (!r.keys.every((k): k is string => typeof k === 'string')) return empty
  return { month, keys: [...new Set(r.keys)] }
}

export type OpenDecision = { allowed: true; counts: boolean } | { allowed: false }

// Pode abrir a música? Já contada no mês: abre sem contar de novo. Separação do mês
// (`freeThisMonth`): sempre abre e não conta, mesmo com o mês cheio. Senão abre e conta
// enquanto houver vaga; com o mês cheio, a nova é barrada.
export function decideOpen(l: StageLedger, key: string, limit: number, opts: { freeThisMonth?: boolean } = {}): OpenDecision {
  if (l.keys.includes(key)) return { allowed: true, counts: false }
  if (opts.freeThisMonth) return { allowed: true, counts: false }
  if (l.keys.length < limit) return { allowed: true, counts: true }
  return { allowed: false }
}

// O registro com a música aberta. Abrir de novo a mesma não muda nada.
export function withOpened(l: StageLedger, key: string): StageLedger {
  if (l.keys.includes(key)) return l
  return { month: l.month, keys: [...l.keys, key] }
}

// Quantas das músicas do mês já foram usadas, pro contador. A música restaurada ao abrir o
// app conta sem ser barrada, então a lista pode passar do limite: o número para nele.
export function stageUsed(l: StageLedger, limit: number): number {
  return Math.min(l.keys.length, limit)
}

// O metrônomo infinito (useAudioEngine, createEndlessMetronomeSong): um canal só, com esse
// nome, e 10 horas de duração. Não é música e não conta.
const ENDLESS_METRONOME_CHANNEL = 'Metronomo Loop'
const ENDLESS_METRONOME_DURATION = 36000

export function stageSongKey(song: { id: string; sourceId?: string; duration: number; channels: readonly { name: string }[] }): string | null {
  const endless = song.duration === ENDLESS_METRONOME_DURATION
    && song.channels.length === 1
    && song.channels[0].name === ENDLESS_METRONOME_CHANNEL
  if (endless) return null
  if (song.sourceId) return `cloud:${song.sourceId}`
  return `song:${song.id}`
}

export function separationKey(id: string): string {
  return `sep:${id}`
}

// A separação foi feita no mês de Brasília de agora? (`createdAt` em milissegundos, como o
// SavedSeparation guarda.) Data estragada não é do mês.
export function separationIsThisMonth(createdAt: number, now: Date): boolean {
  if (!Number.isFinite(createdAt)) return false
  return brtMonth(new Date(createdAt)) === brtMonth(now)
}

// ── Minutos do Ao Vivo do dia ──
// Soma do dia de Brasília. Quem chama decide quando o relógio corre (Ruling R16-mudada: só
// com pelo menos um celular da banda conectado); aqui só a soma com teto por passo, pra o
// computador dormindo não gastar os minutos de uma vez.

export type LiveLedger = { day: string; usedMs: number }

export const LIVE_TICK_CAP_MS = 5000

// O registro guardado, se for do dia pedido. Outro dia (passou a meia-noite de Brasília),
// formato errado ou tempo estranho: o dia começa zerado.
export function liveLedgerFor(raw: unknown, day: string): LiveLedger {
  const empty: LiveLedger = { day, usedMs: 0 }
  if (!raw || typeof raw !== 'object') return empty
  const r = raw as Record<string, unknown>
  if (r.day !== day || typeof r.usedMs !== 'number' || !Number.isFinite(r.usedMs) || r.usedMs < 0) return empty
  return { day, usedMs: r.usedMs }
}

// Soma um passo do relógio. Passo negativo, NaN ou infinito não soma; passo maior que o teto
// soma só o teto.
export function addLiveTime(l: LiveLedger, deltaMs: number): LiveLedger {
  const step = Number.isFinite(deltaMs) && deltaMs > 0 ? Math.min(deltaMs, LIVE_TICK_CAP_MS) : 0
  if (step === 0) return l
  return { day: l.day, usedMs: l.usedMs + step }
}

export function liveRemainingMs(l: LiveLedger, limitMs: number): number {
  return Math.max(0, limitMs - l.usedMs)
}

// ── Anúncio da casa ──
// No máximo um anúncio grande por sessão, sempre com a música parada e só no Livre.

// Tela inicial: uma vez por dia de Brasília.
export function shouldShowHomeAd(i: { isLivre: boolean; quiet: boolean; lastHomeDay: string | null; today: string; bigAdThisSession: boolean }): boolean {
  return i.isLivre && i.quiet && !i.bigAdThisSession && i.lastHomeDay !== i.today
}

// Fim da separação: só logo depois de separar.
export function shouldShowSeparationAd(i: { isLivre: boolean; quiet: boolean; justSeparated: boolean; bigAdThisSession: boolean }): boolean {
  return i.isLivre && i.quiet && i.justSeparated && !i.bigAdThisSession
}

// ── Fila que só mostra tela com a música parada (D6) ──
// `shown` é a tela aberta; `pending` é a que espera a música parar. Nunca há tela aberta
// com a música tocando.

export type QuietQueue<T> = { pending: T | null; shown: T | null }

// Pedido de tela. Parado: aparece na hora. Tocando: espera, e o pedido mais novo vence.
export function queueRequest<T>(q: QuietQueue<T>, item: T, quiet: boolean): QuietQueue<T> {
  if (quiet) return { pending: null, shown: item }
  if (q.pending === item && q.shown === null) return q
  return { pending: item, shown: null }
}

// O motor mudou. Parou com pedido esperando: a tela aparece (uma vez). Começou a tocar com
// a tela aberta: a tela sai e não volta sozinha.
export function queueSettle<T>(q: QuietQueue<T>, quiet: boolean): QuietQueue<T> {
  if (quiet && q.pending !== null) return { pending: null, shown: q.pending }
  if (!quiet && q.shown !== null) return { pending: q.pending, shown: null }
  return q
}

// A pessoa fechou a tela.
export function queueDismiss<T>(q: QuietQueue<T>): QuietQueue<T> {
  if (q.shown === null) return q
  return { pending: q.pending, shown: null }
}

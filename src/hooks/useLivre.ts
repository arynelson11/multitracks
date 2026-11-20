import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import {
  addLiveTime,
  decideOpen,
  isQuiet,
  liveRemainingMs,
  queueDismiss,
  queueRequest,
  queueSettle,
  stageUsed,
  type EngineBusy,
  type LimitKind,
  type QuietQueue,
} from '../lib/livreRules'
import { livreVersion, readLiveLedger, readStageLedger, recordStageSong, subscribeLivre, writeLiveLedger } from '../lib/livreStore'
import { liveDailyLimitMs, maxStageSongsPerMonth, planTier } from '../lib/plans'
import { brtDay, brtMonth } from '../lib/separationUsage'

// Hook do Livre (Parte 3, spec 5 e 6): junta num lugar só o que o Livre conta no aparelho.
// As músicas diferentes do mês no palco, os 10 minutos do Ao Vivo do dia e a fila da tela de
// limite, que só aparece com o motor parado. As regras são de livreRules.ts e a conta fica no
// livreStore.ts (por conta, compartilhada entre as telas). Conta paga ou admin: tudo aberto,
// nenhuma tela de limite, nada gravado e nenhum timer.
//
// O hook não recebe nada do motor além de `busy` (tocando ou na pré-contagem): não tem como
// parar o som. Limite nenhum para a música; ele só vale na hora de abrir a próxima.

export type LivreState = {
  /** Conta no Livre e sem admin: só aqui há limite, selo e tela de limite. */
  isLivre: boolean
  /** Músicas diferentes do mês de Brasília no palco. Fora do Livre: `{ used: 0, limit: Infinity }`. */
  stage: { used: number; limit: number }
  /** Pode abrir a música? Não grava. Chave nula (metrônomo infinito) sempre abre. */
  canOpenSong(key: string | null, opts?: { freeThisMonth?: boolean }): boolean
  /** Ainda há vaga no mês pra uma música que não foi aberta? */
  canOpenNewSong(): boolean
  /** A música virou a atual: grava na conta do mês. Nunca barra (a restaurada conta mesmo com o mês cheio). */
  noteSongOpened(key: string | null, opts?: { freeThisMonth?: boolean }): void
  /** Minutos do Ao Vivo do dia de Brasília. Fora do Livre: `{ remainingMs: Infinity, limitMs: null }`. */
  live: { remainingMs: number; limitMs: number | null }
  /** Ainda há minutos do Ao Vivo hoje? Fora do Livre, sempre. */
  canStartLive(): boolean
  /** A tela de limite a mostrar agora; nula com a música tocando ou na pré-contagem. */
  limit: LimitKind | null
  /** Pede a tela. Parado aparece na hora; tocando espera a música parar. Fora do Livre não faz nada. */
  requestLimit(kind: LimitKind): void
  closeLimit(): void
}

export type UseLivreInput = {
  userId: string | null
  plan: string
  isAdmin: boolean
  /** O estado do motor desta tela. Tela por cima só com os dois falsos. */
  busy: EngineBusy
  /**
   * Os 10 minutos do Ao Vivo do Livre correm só com isto verdadeiro. Ruling R16-mudada: passar
   * verdadeiro SÓ com a sessão ligada (HOST ou código remoto) E pelo menos um celular da banda
   * conectado; abrir o HOST sem celular não gasta. Só uma tela passa verdadeiro (o palco do
   * App); as outras (Separador) passam falso, senão o tempo contaria em dobro.
   */
  liveActive: boolean
  /**
   * Os minutos acabaram com `liveActive` ligado: chamado uma vez por esgotamento, pra desligar a
   * sessão (a banda sai). Nunca mexer no motor aqui. A versão mais nova é a chamada.
   */
  onLiveExpired(): void
  /** Relógio (testes). Padrão: a hora do aparelho. */
  now?: () => Date
}

const LIVE_TICK_MS = 1000
const NO_QUEUE: QuietQueue<LimitKind> = { pending: null, shown: null }
const deviceNow = () => new Date()

// A fila da tela de limite (D6) e de que conta ela é. O estado do motor chega por props, então
// a fila assenta na renderização (Ruling R8, sem setState em efeito): todo pedido entra como
// pendente e a renderização, que vê o motor de agora, mostra se estiver parado; motor que
// começa tira a tela aberta, que não volta sozinha. Assim um pedido que chega junto com o play
// espera em vez de se perder. Trocar de conta ou de plano esvazia a fila.
type LimitQueue = { queue: QuietQueue<LimitKind>; isLivre: boolean; userId: string | null }

export function useLivre(i: UseLivreInput): LivreState {
  const { userId, plan, isAdmin, liveActive, onLiveExpired } = i
  const now = i.now ?? deviceNow
  const isLivre = !isAdmin && planTier(plan) === 'free'
  const stageLimit = isLivre ? maxStageSongsPerMonth(plan) : Infinity
  const liveLimitMs = isLivre ? liveDailyLimitMs(plan) : null
  const quiet = isQuiet(i.busy)

  // Versão mais nova do relógio e do callback pros timers e funções; atualizada só em efeito,
  // nunca na renderização (react-hooks/refs).
  const nowRef = useRef(now)
  const onLiveExpiredRef = useRef(onLiveExpired)
  useEffect(() => {
    nowRef.current = now
    onLiveExpiredRef.current = onLiveExpired
  })

  // Renderiza de novo quando qualquer tela grava (ou outra janela, pelo evento `storage`).
  useSyncExternalStore(subscribeLivre, livreVersion)
  let used = 0
  let remainingMs = liveLimitMs ?? Infinity
  if (isLivre && userId !== null) {
    const at = now()
    used = stageUsed(readStageLedger(userId, brtMonth(at)), stageLimit)
    if (liveLimitMs !== null) remainingMs = liveRemainingMs(readLiveLedger(userId, brtDay(at)), liveLimitMs)
  }

  const [q, setQ] = useState<LimitQueue>(() => ({ queue: NO_QUEUE, isLivre, userId }))
  const settledQueue = queueSettle(q.queue, quiet)
  let settled = q
  if (q.isLivre !== isLivre || q.userId !== userId) {
    settled = { queue: NO_QUEUE, isLivre, userId }
    setQ(settled)
  } else if (settledQueue !== q.queue) {
    settled = { ...q, queue: settledQueue }
    setQ(settled)
  }
  const limit = isLivre && quiet ? settled.queue.shown : null

  // O `setQ` é estável; vai nas dependências porque o compilador do React (lint
  // preserve-manual-memoization) não o reconhece assim com o setState na renderização.
  const requestLimit = useCallback((kind: LimitKind) => {
    setQ((prev) => {
      if (!prev.isLivre) return prev
      const next = queueRequest(prev.queue, kind, false)
      return next === prev.queue ? prev : { ...prev, queue: next }
    })
  }, [setQ])

  const closeLimit = useCallback(() => {
    setQ((prev) => {
      const next = queueDismiss(prev.queue)
      return next === prev.queue ? prev : { ...prev, queue: next }
    })
  }, [setQ])

  // As funções leem a conta guardada na hora da chamada: duas telas e a virada do mês nunca
  // decidem com número velho. Sem conta (userId nulo) não há onde contar: nada barra nem grava.
  const canOpenSong = useCallback((key: string | null, opts?: { freeThisMonth?: boolean }) => {
    if (!isLivre || key === null || userId === null) return true
    return decideOpen(readStageLedger(userId, brtMonth(nowRef.current())), key, stageLimit, opts).allowed
  }, [isLivre, userId, stageLimit])

  const canOpenNewSong = useCallback(() => {
    if (!isLivre || userId === null) return true
    return readStageLedger(userId, brtMonth(nowRef.current())).keys.length < stageLimit
  }, [isLivre, userId, stageLimit])

  const noteSongOpened = useCallback((key: string | null, opts?: { freeThisMonth?: boolean }) => {
    if (!isLivre || key === null || userId === null) return
    const month = brtMonth(nowRef.current())
    const d = decideOpen(readStageLedger(userId, month), key, stageLimit, opts)
    // Já contada no mês ou separação do mês: não grava. Nova com vaga conta. Nova com o mês
    // cheio (a música restaurada ao abrir o app, D3) também conta, porque já está aberta.
    if (d.allowed && !d.counts) return
    recordStageSong(userId, key, month)
  }, [isLivre, userId, stageLimit])

  const canStartLive = useCallback(() => {
    if (liveLimitMs === null || userId === null) return true
    return liveRemainingMs(readLiveLedger(userId, brtDay(nowRef.current())), liveLimitMs) > 0
  }, [userId, liveLimitMs])

  // Relógio do Ao Vivo (D5 com a R16-mudada): a cada segundo soma o tempo passado desde o passo
  // anterior (teto de 5 s por passo, o computador dormindo não gasta) no dia de Brasília e grava.
  // Ao chegar a zero: desliga a sessão pelo callback, pede a tela `live` e para de contar. Ligar
  // de novo já sem minutos esgota no primeiro segundo.
  const liveRunning = isLivre && liveActive && liveLimitMs !== null && userId !== null
  useEffect(() => {
    if (!liveRunning || userId === null || liveLimitMs === null) return
    let last = nowRef.current().getTime()
    const id = setInterval(() => {
      const at = nowRef.current()
      const step = at.getTime() - last
      last = at.getTime()
      const next = addLiveTime(readLiveLedger(userId, brtDay(at)), step)
      writeLiveLedger(userId, next)
      if (liveRemainingMs(next, liveLimitMs) > 0) return
      clearInterval(id)
      onLiveExpiredRef.current()
      requestLimit('live')
    }, LIVE_TICK_MS)
    return () => clearInterval(id)
  }, [liveRunning, userId, liveLimitMs, requestLimit])

  const stage = useMemo(() => ({ used, limit: stageLimit }), [used, stageLimit])
  const live = useMemo(() => ({ remainingMs, limitMs: liveLimitMs }), [remainingMs, liveLimitMs])

  return useMemo(() => ({
    isLivre,
    stage,
    canOpenSong,
    canOpenNewSong,
    noteSongOpened,
    live,
    canStartLive,
    limit,
    requestLimit,
    closeLimit,
  }), [isLivre, stage, canOpenSong, canOpenNewSong, noteSongOpened, live, canStartLive, limit, requestLimit, closeLimit])
}

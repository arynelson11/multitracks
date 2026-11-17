import Replicate from 'replicate'
import { addDays, brtToday } from '../billing.js'
import { getUsdBrl, getUsdBrlOn, type FxRate } from '../fx.js'
import {
  HARDWARE_USD_PER_SECOND,
  PRICES_CHECKED_AT,
  PRICES_SOURCE,
  sweepPendingCosts,
  type ReplicatePredictionLike,
} from '../aiCost.js'
import { AdminError, day, int, type AdminCtx, type AdminHandlers } from './http.js'

// Custos de IA (Task 24).
// * ai-costs (GET): os trabalhos de um período em dias de Brasília, somados
//   pelo banco (admin_ai_costs, T10). Antes de somar: (1) atualiza o câmbio do
//   dia (getUsdBrl, T11), que é o que apaga o alerta de câmbio velho da Visão
//   geral; (2) roda uma varredura curta que completa os custos que faltam
//   (sweepPendingCosts, T12), com o R$ de cada trabalho pela PTAX do dia de
//   Brasília dele (Ruling ADM-T12-fx-dia). O servidor acrescenta page,
//   pageSize, a tabela de preços e o resultado da varredura; não recalcula
//   nada do que o banco somou.
// * ai-costs-sweep (POST): o botão "Completar custos que faltam" da T19, uma
//   varredura maior, sem somar.
// Teto de tempo: o adminApi corta o GET em 15 s e a função tem maxDuration de
// 30 s. Cada varredura tem um prazo final pra tudo que sai pra rede (Replicate
// e Banco Central): cada consulta tem o próprio teto e nunca passa do prazo,
// porque a varredura só confere o orçamento entre um trabalho e outro.
// Nada do Replicate nem do banco vai pra resposta: só contagens e frases
// prontas; o detalhe fica no log, sem dado pessoal.

const PAGE_SIZE = 50
const MAX_PAGE = 1000
// Contando o dia inicial e o final: o ano bissexto inteiro cabe.
const MAX_DAYS = 366
// Trabalho mais novo que isso pode estar sendo consultado agora pelo app (o
// check-separation grava o custo quando ele termina).
const OLDER_THAN_MS = 600_000

type SweepLimits = {
  limit: number
  // a varredura não começa trabalho novo depois disso (contado do início dela)
  budgetMs: number
  // nenhuma consulta pra fora passa disso (contado do início do pedido)
  deadlineMs: number
  fxTimeoutMs: number
  replicateTimeoutMs: number
}

// Abrir a aba: câmbio do dia em até 2 s, varredura de 4 s, e às 8 s do pedido
// tudo que sai pra rede já terminou. Pior caso perto de 9 s com as gravações e
// a soma no banco, bem abaixo dos 15 s do adminApi mesmo com a função fria.
const OPEN_FX_TIMEOUT_MS = 2000
const OPEN: SweepLimits = { limit: 20, budgetMs: 4000, deadlineMs: 8000, fxTimeoutMs: 2000, replicateTimeoutMs: 3000 }

// Botão: orçamento de 20 s e prazo final de 25 s, abaixo do maxDuration de 30 s.
const BUTTON_DEFAULT_LIMIT = 50
const BUTTON_MAX_LIMIT = 100
const BUTTON: Omit<SweepLimits, 'limit'> = { budgetMs: 20_000, deadlineMs: 25_000, fxTimeoutMs: 3000, replicateTimeoutMs: 5000 }

const MSG_INVERTED = 'A data inicial precisa vir antes da final.'
const MSG_TOO_LONG = 'Escolha um período de até um ano.'
const MSG_NO_REPLICATE = 'Servidor sem a chave do Replicate. A varredura não rodou; avise o suporte.'

type SweepCounts = { recorded: number; unknown: number; failed: number; brlCompleted: number; more: boolean }
type OpenSweep = SweepCounts & { skipped: boolean }

// skipped: a varredura não rodou (servidor sem a chave do Replicate) ou parou
// com erro do banco antes de contar. Os números saem do mesmo jeito.
const SKIPPED: OpenSweep = { recorded: 0, unknown: 0, failed: 0, brlCompleted: 0, more: false, skipped: true }

type ReplicateClient = { predictions: { get: (id: string, opts?: { signal?: AbortSignal }) => Promise<unknown> } }

// Id que o Replicate gera: letras e números. Qualquer outra coisa
// nem vai pro endereço da consulta.
const REPLICATE_ID_RE = /^[A-Za-z0-9]{1,64}$/
// O Replicate recusa o id (não existe mais, ou id inválido): a linha fecha como
// unknown, senão ocupa a janela da varredura pra sempre. 401, 403, 429 e 5xx
// são do servidor ou do Replicate, não do trabalho: a linha fica pra próxima.
const ID_REFUSED = new Set([400, 404, 410, 422])

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

const errText = (e: unknown): string => (e instanceof Error ? `${e.name}: ${e.message}` : 'erro sem mensagem').slice(0, 300)

// Primeiro e último dia do mês de Brasília de hoje (mesma regra do Financeiro).
function currentMonth(now: Date): { from: string; to: string } {
  const today = brtToday(now)
  const from = `${today.slice(0, 7)}-01`
  const nextMonth = new Date(Date.UTC(Number(today.slice(0, 4)), Number(today.slice(5, 7)), 1)).toISOString().slice(0, 10)
  return { from, to: addDays(nextMonth, -1) }
}

// Dias do período contando os dois extremos (2026-11-16 a 2026-11-16 dá 1).
const daysInRange = (from: string, to: string): number => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400_000) + 1

// total é bigint: número no JSON, ou texto se passar do inteiro seguro.
function countOf(v: unknown): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' && /^\d+$/.test(v) ? Number(v) : Number.NaN
  return Number.isSafeInteger(n) && n >= 0 ? n : Number.NaN
}

function replicateToken(): string | null {
  const token = process.env.REPLICATE_API_TOKEN?.trim()
  return token ? token : null
}

function httpStatusOf(e: unknown): number | null {
  const status = (e as { response?: { status?: unknown } } | null)?.response?.status
  return typeof status === 'number' ? status : null
}

// predictions.get com teto de tempo (o SDK não tem teto e repete sozinho em
// 429 e 5xx). Id recusado pelo Replicate vira null (fecha como unknown); o
// resto lança, e a varredura conta em failed e para.
function predictionGetter(client: ReplicateClient, timeoutMs: number, remainingMs: () => number) {
  return async (id: string): Promise<ReplicatePredictionLike | null> => {
    if (!REPLICATE_ID_RE.test(id)) return null
    const ms = Math.min(timeoutMs, remainingMs())
    if (ms <= 0) throw new Error('sem tempo pra consultar o Replicate nesta varredura')
    const ctrl = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        ctrl.abort()
        reject(new Error(`Replicate sem resposta em ${ms} ms`))
      }, ms)
    })
    try {
      const prediction = await Promise.race([client.predictions.get(id, { signal: ctrl.signal }), timeout])
      if (!isObject(prediction) || typeof prediction.status !== 'string') throw new Error('resposta do Replicate fora do formato')
      return prediction as ReplicatePredictionLike
    } catch (e) {
      const status = httpStatusOf(e)
      if (status !== null && ID_REFUSED.has(status)) return null
      throw e
    } finally {
      clearTimeout(timer)
    }
  }
}

// PTAX do dia de Brasília do trabalho (Ruling ADM-T12-fx-dia). Sem tempo no
// prazo, só o que já está guardado (storedOnly): sem consultar o Banco Central
// e sem log, porque não houve falha; o trabalho fica sem real e a próxima
// varredura completa. Câmbio nulo depois de consultar vai pro log (o
// getUsdBrlOn não avisa quando o Banco Central responde fora do formato item
// por item).
function fxOnDay(ctx: AdminCtx, timeoutMs: number, remainingMs: () => number) {
  return async (jobDay: string): Promise<FxRate | null> => {
    const ms = Math.min(timeoutMs, remainingMs())
    if (ms <= 0) return getUsdBrlOn(ctx.db, jobDay, { now: ctx.now, storedOnly: true })
    const fx = await getUsdBrlOn(ctx.db, jobDay, { now: ctx.now, timeoutMs: ms })
    if (!fx) {
      console.warn(`[admin] custos de IA: sem PTAX de venda pro dia ${jobDay} (Banco Central fora, resposta fora do formato ou cotação do dia ainda não saiu); o trabalho fica sem real até a próxima varredura`)
    }
    return fx
  }
}

async function sweep(ctx: AdminCtx, token: string, limits: SweepLimits, startedAt: number): Promise<SweepCounts> {
  const remainingMs = () => startedAt + limits.deadlineMs - Date.now()
  const client: ReplicateClient = new Replicate({ auth: token })
  return sweepPendingCosts(
    ctx.db,
    predictionGetter(client, limits.replicateTimeoutMs, remainingMs),
    fxOnDay(ctx, limits.fxTimeoutMs, remainingMs),
    { now: ctx.now, limit: limits.limit, budgetMs: limits.budgetMs, olderThanMs: OLDER_THAN_MS },
  )
}

// Consulta (no máximo a cada 6 horas) e grava a PTAX de hoje. Nunca derruba a aba.
async function refreshTodayFx(ctx: AdminCtx): Promise<void> {
  const today = brtToday(ctx.now)
  let fx: FxRate | null = null
  try {
    fx = await getUsdBrl(ctx.db, { now: ctx.now, timeoutMs: OPEN_FX_TIMEOUT_MS })
  } catch (e) {
    console.error('[admin] custos de IA: câmbio do dia falhou:', errText(e))
  }
  if (!fx || fx.stale) {
    const kept = fx ? `vale o último guardado, de ${fx.date}` : 'nenhum câmbio guardado'
    console.warn(`[admin] custos de IA: câmbio de ${today} não atualizado (Banco Central fora ou resposta fora do formato); ${kept}`)
  }
}

async function openSweep(ctx: AdminCtx, startedAt: number): Promise<OpenSweep> {
  const token = replicateToken()
  if (!token) return { ...SKIPPED }
  try {
    return { ...(await sweep(ctx, token, OPEN, startedAt)), skipped: false }
  } catch (e) {
    console.error('[admin] custos de IA: varredura parou com erro, os números saem do mesmo jeito:', errText(e))
    return { ...SKIPPED }
  }
}

const pricesTable = () => ({
  checkedAt: PRICES_CHECKED_AT,
  source: PRICES_SOURCE,
  table: Object.entries(HARDWARE_USD_PER_SECOND).map(([hardware, usdPerSecond]) => ({ hardware, usdPerSecond })),
})

async function listAiCosts(ctx: AdminCtx): Promise<unknown> {
  const startedAt = Date.now()
  const month = currentMonth(ctx.now)
  const from = day(ctx.query, 'from', { label: 'a data inicial', optional: true }) ?? month.from
  const to = day(ctx.query, 'to', { label: 'a data final', optional: true }) ?? month.to
  const page = int(ctx.query, 'page', { label: 'a página', min: 1, max: MAX_PAGE, fallback: 1 })
  const days = daysInRange(from, to)
  if (days < 1) throw new AdminError(400, MSG_INVERTED)
  if (days > MAX_DAYS) throw new AdminError(400, MSG_TOO_LONG)

  // Câmbio de hoje antes da varredura: o trabalho de hoje já acha a PTAX guardada.
  await refreshTodayFx(ctx)
  const sweepResult = await openSweep(ctx, startedAt)

  const { data, error } = await ctx.db.rpc('admin_ai_costs', {
    p_from: from,
    p_to: to,
    p_limit: PAGE_SIZE,
    p_offset: (page - 1) * PAGE_SIZE,
  })
  if (error) throw new Error(`Falha no banco (admin_ai_costs): ${error.message}`)

  // Fora do formato vira erro, nunca uma tela com número pela metade.
  const d = isObject(data) ? data : null
  const total = countOf(d?.total)
  const range = d?.range
  if (
    !d || !Number.isSafeInteger(total) || !isObject(range) || typeof range.from !== 'string' || typeof range.to !== 'string'
    || !isObject(d.totals) || !Array.isArray(d.byUser) || !Array.isArray(d.byModel) || !isObject(d.fx) || !Array.isArray(d.rows)
  ) throw new Error('admin_ai_costs devolveu fora do formato')

  return {
    range: { from: range.from, to: range.to },
    totals: d.totals,
    byUser: d.byUser,
    byModel: d.byModel,
    fx: d.fx,
    rows: d.rows,
    total,
    page,
    pageSize: PAGE_SIZE,
    prices: pricesTable(),
    sweep: sweepResult,
  }
}

async function sweepNow(ctx: AdminCtx): Promise<SweepCounts> {
  const startedAt = Date.now()
  const limit = int(ctx.body, 'limit', { label: 'o limite', min: 1, max: BUTTON_MAX_LIMIT, fallback: BUTTON_DEFAULT_LIMIT })
  const token = replicateToken()
  if (!token) throw new AdminError(500, MSG_NO_REPLICATE)
  const r = await sweep(ctx, token, { ...BUTTON, limit }, startedAt)
  return { recorded: r.recorded, unknown: r.unknown, failed: r.failed, brlCompleted: r.brlCompleted, more: r.more }
}

export const handlers: AdminHandlers = {
  'ai-costs': {
    method: 'GET',
    fields: ['from', 'to', 'page'],
    run: listAiCosts,
  },
  'ai-costs-sweep': {
    method: 'POST',
    fields: ['limit'],
    run: sweepNow,
  },
}

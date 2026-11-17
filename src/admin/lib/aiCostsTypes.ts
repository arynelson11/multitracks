// Custos de IA (`?action=ai-costs` e `?action=ai-costs-sweep`), cópia do front do contrato da seção
// Arquitetura B do plano. O backend não importa de src/, então os dois lados mantêm o mesmo formato.

/** Um trabalho de separação gravado em `predictions`. */
export type AiJob = {
  replicateId: string
  createdAt: string
  /** Nulo = conta excluída (o trabalho fica pro custo de meses passados). */
  userId: string | null
  email: string | null
  /** model_name do demucs: htdemucs ou htdemucs_6s. */
  model: string | null
  stemCount: number | null
  /** starting, processing, succeeded, failed, canceled ou unknown (o Replicate não sabe do trabalho). */
  status: string | null
  predictSeconds: number | null
  hardware: string | null
  costUsd: number | null
  costBrl: number | null
  fxRate: number | null
  fxDate: string | null
}

export type AiCosts = {
  range: { from: string; to: string }
  totals: {
    jobs: number
    succeeded: number
    failed: number
    canceled: number
    unknown: number
    withoutCost: number
    costUsd: number
    costBrl: number
    avgBrlPerSucceeded: number | null
    predictSeconds: number
  }
  /** 50 de maior custo; userId nulo = conta excluída. */
  byUser: { userId: string | null; email: string | null; jobs: number; costBrl: number }[]
  byModel: { model: string | null; stemCount: number | null; jobs: number; costBrl: number; avgSeconds: number | null }[]
  fx: { minDate: string | null; maxDate: string | null }
  rows: AiJob[]
  total: number
  page: number
  pageSize: number
  // Do servidor:
  prices: { checkedAt: string; source: string; table: { hardware: string; usdPerSecond: number }[] }
  sweep: { recorded: number; unknown: number; failed: number; brlCompleted: number; more: boolean; skipped: boolean }
}

/** Resposta de `ai-costs-sweep`. */
export type AiCostsSweep = { recorded: number; unknown: number; failed: number; brlCompleted: number; more: boolean }

const isNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const isCount = (v: unknown): v is number => isNumber(v) && v >= 0
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const isListOfRecords = (v: unknown): boolean => Array.isArray(v) && v.every(isRecord)

/**
 * Trabalho com custo: dólar e real gravados. O que tem dólar e não tem real (gravado sem câmbio)
 * conta como sem custo e fica fora da soma, como no servidor (regra "Trabalho sem custo").
 */
export function hasCost(job: Pick<AiJob, 'costUsd' | 'costBrl'>): boolean {
  return isNumber(job.costUsd) && isNumber(job.costBrl)
}

const TOTAL_COUNTS = ['jobs', 'succeeded', 'failed', 'canceled', 'unknown', 'withoutCost', 'costUsd', 'costBrl', 'predictSeconds']

/**
 * A resposta tem a forma que a tela usa (Ruling ADM-T7-forma): números onde a tela soma, conta e
 * pagina, e listas de objetos. Fora disso a aba mostra a frase pronta, em vez de quebrar no render.
 */
export function isAiCosts(v: unknown): v is AiCosts {
  if (!isRecord(v)) return false
  const { range, totals, fx, prices } = v
  if (!isRecord(range) || typeof range.from !== 'string' || typeof range.to !== 'string') return false
  if (!isRecord(totals) || !TOTAL_COUNTS.every((k) => isCount(totals[k]))) return false
  if (totals.avgBrlPerSucceeded !== null && !isNumber(totals.avgBrlPerSucceeded)) return false
  if (!isRecord(fx)) return false
  if (!isRecord(prices) || typeof prices.checkedAt !== 'string' || typeof prices.source !== 'string') return false
  return isListOfRecords(prices.table) && isListOfRecords(v.byUser) && isListOfRecords(v.byModel) && isListOfRecords(v.rows)
    && isCount(v.total) && isCount(v.page) && isCount(v.pageSize) && (v.pageSize as number) > 0
}

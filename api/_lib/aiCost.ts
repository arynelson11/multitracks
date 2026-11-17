// Custo de IA por trabalho (separação no Replicate), gravado na tabela predictions.
// O Replicate cobra os modelos públicos só pelo tempo de processamento
// (metrics.predict_time) vezes o preço por segundo do hardware em que o modelo roda.
// O custo em R$ usa a PTAX de venda pura do dia de Brasília do trabalho (completed_at,
// ou created_at), ou a do último dia útil antes dele (api/_lib/fx.ts), sem IOF nem
// spread; nunca o câmbio de outro dia.
// Versão sem preço conhecido fica sem custo (tudo nulo) e é contada à parte no painel;
// nunca entra na soma como zero.

import type { SupabaseClient } from '@supabase/supabase-js'
import { addDays, brtToday } from './billing.js'
import type { FxRate } from './fx.js'

// Versão do cjwbw/demucs que o app usa (api/separate-audio.ts passa a importar daqui na T23).
export const DEMUCS_VERSION = '25a173108cff36ef9f80f854c162d01df9e6528be175794b81158fa03836d953'

// Conferido em 2026-11-17:
// - replicate.com/pricing, tabela "Hardware pricing": "Nvidia T4 GPU", identificador
//   gpu-t4, US$ 0.000225/sec (US$ 0.81/hr).
// - replicate.com/cjwbw/demucs (versão 25a17310, a mais recente do modelo):
//   "This model runs on Nvidia T4 GPU hardware."
// Preço mudou no Replicate ou o app trocou de versão: confira de novo e atualize as três
// constantes e a data juntos.
export const PRICES_SOURCE = 'https://replicate.com/pricing'
export const PRICES_CHECKED_AT = '2026-11-17'

export const HARDWARE_USD_PER_SECOND: Record<string, number> = {
  'gpu-t4': 0.000225,
}

export const VERSION_HARDWARE: Record<string, { model: string; hardware: string; source: string }> = {
  [DEMUCS_VERSION]: { model: 'cjwbw/demucs', hardware: 'gpu-t4', source: 'https://replicate.com/cjwbw/demucs' },
}

export type JobCost = {
  hardware: string | null
  usdPerSecond: number | null
  costUsd: number | null
  costBrl: number | null
  fxRate: number | null
  fxDate: string | null
}

export type ReplicatePredictionLike = {
  id: string
  model?: string | null
  version?: string | null
  status: string
  input?: unknown
  metrics?: { predict_time?: number } | null
  completed_at?: string | null
}

type JobStatus = 'starting' | 'processing' | 'succeeded' | 'failed' | 'canceled' | 'unknown'

const KNOWN_STATUSES = new Set<string>(['starting', 'processing', 'succeeded', 'failed', 'canceled'])
const TERMINAL_STATUSES = new Set<string>(['succeeded', 'failed', 'canceled'])

const round = (value: number, places: number): number => {
  const f = 10 ** places
  return Math.round(value * f) / f
}

const isNonNegative = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0

export function isTerminal(status: string | null | undefined): boolean {
  return typeof status === 'string' && TERMINAL_STATUSES.has(status)
}

// Status que o Replicate devolve fora da lista do banco vira 'unknown' (e conta como final),
// pra linha nenhuma ficar sem custo pra sempre ocupando a janela da varredura.
function normalizeStatus(status: string | null | undefined): JobStatus {
  return typeof status === 'string' && KNOWN_STATUSES.has(status) ? (status as JobStatus) : 'unknown'
}

export function jobCost(
  input: { version: string | null; status: string | null; predictSeconds: number | null },
  fx: FxRate | null,
  prices: Record<string, number> = HARDWARE_USD_PER_SECOND,
  versions: Record<string, { model: string; hardware: string; source: string }> = VERSION_HARDWARE,
): JobCost {
  const empty: JobCost = { hardware: null, usdPerSecond: null, costUsd: null, costBrl: null, fxRate: null, fxDate: null }
  const entry = input.version != null && Object.hasOwn(versions, input.version) ? versions[input.version] : null
  if (!entry) return empty
  const usdPerSecond = Object.hasOwn(prices, entry.hardware) ? prices[entry.hardware] : null
  if (!isNonNegative(usdPerSecond)) return { ...empty, hardware: entry.hardware }

  let costUsd: number | null = null
  if (isNonNegative(input.predictSeconds)) costUsd = round(input.predictSeconds * usdPerSecond, 6)
  else if (input.status === 'failed' || input.status === 'canceled') costUsd = 0
  if (costUsd == null) return { ...empty, hardware: entry.hardware, usdPerSecond }

  const rate = fx && Number.isFinite(fx.rate) && fx.rate > 0 ? fx.rate : null
  if (rate == null || !fx) return { ...empty, hardware: entry.hardware, usdPerSecond, costUsd }
  return { hardware: entry.hardware, usdPerSecond, costUsd, costBrl: round(costUsd * rate, 4), fxRate: rate, fxDate: fx.date }
}

export function stemCountFromInput(input: unknown): 2 | 4 | 6 | null {
  if (!input || typeof input !== 'object') return null
  const { two_stems: twoStems, model_name: modelName } = input as Record<string, unknown>
  if (typeof twoStems === 'string' && twoStems.trim() !== '') return 2
  if (modelName === 'htdemucs_6s') return 6
  if (modelName === 'htdemucs') return 4
  return null
}

// predictions.model é o model_name do demucs (htdemucs ou htdemucs_6s), nunca o
// "dono/nome" do Replicate: sem o input na resposta, fica nulo.
function modelNameFromInput(input: unknown): string | null {
  if (!input || typeof input !== 'object') return null
  const modelName = (input as Record<string, unknown>).model_name
  return typeof modelName === 'string' && modelName.trim() !== '' ? modelName.trim() : null
}

type StoredRow = { model: string | null; version: string | null; stem_count: number | null; cost_recorded_at: string | null }

// fx é a PTAX do dia de Brasília do trabalho (getUsdBrlOn) ou null; com null, o
// trabalho fica só com o dólar e a varredura completa o R$ depois.
export async function recordPredictionResult(
  db: SupabaseClient,
  p: ReplicatePredictionLike,
  fx: FxRate | null,
  now: Date,
): Promise<'recorded' | 'already' | 'not_terminal' | 'unknown_row'> {
  const status = normalizeStatus(p.status)
  if (status === 'starting' || status === 'processing') return 'not_terminal'

  const { data, error } = await db
    .from('predictions')
    .select('model, version, stem_count, cost_recorded_at')
    .eq('replicate_id', p.id)
    .maybeSingle()
  if (error) throw new Error(`Não deu pra ler o trabalho ${p.id}: ${error.message}`)
  const row = data as StoredRow | null
  if (!row) return 'unknown_row'
  if (row.cost_recorded_at != null) return 'already'

  const rawSeconds = p.metrics?.predict_time
  const predictSeconds = isNonNegative(rawSeconds) ? round(rawSeconds, 3) : null
  const version = row.version ?? (typeof p.version === 'string' && p.version !== '' ? p.version : null)
  const cost = jobCost({ version, status, predictSeconds }, fx)

  const payload: Record<string, unknown> = {
    status,
    predict_seconds: predictSeconds,
    hardware: cost.hardware,
    usd_per_second: cost.usdPerSecond,
    cost_usd: cost.costUsd,
    fx_usd_brl: cost.fxRate,
    fx_date: cost.fxDate,
    cost_brl: cost.costBrl,
    completed_at: typeof p.completed_at === 'string' ? p.completed_at : null,
    cost_recorded_at: now.toISOString(),
  }
  if (row.model == null) payload.model = modelNameFromInput(p.input)
  if (row.version == null) payload.version = version
  if (row.stem_count == null) payload.stem_count = stemCountFromInput(p.input)

  // O filtro cost_recorded_at nulo faz a gravação valer uma vez só, mesmo com duas
  // consultas do mesmo trabalho correndo juntas.
  const { data: updated, error: updErr } = await db
    .from('predictions')
    .update(payload)
    .eq('replicate_id', p.id)
    .is('cost_recorded_at', null)
    .select('replicate_id')
  if (updErr) throw new Error(`Não deu pra gravar o custo do trabalho ${p.id}: ${updErr.message}`)
  return Array.isArray(updated) && updated.length > 0 ? 'recorded' : 'already'
}

// Fecha a linha sem custo (404 do Replicate ou gravação que falhou), pra ela sair da janela.
async function markUnknown(db: SupabaseClient, id: string, now: Date): Promise<boolean> {
  const { error } = await db
    .from('predictions')
    .update({ status: 'unknown', cost_recorded_at: now.toISOString() })
    .eq('replicate_id', id)
    .is('cost_recorded_at', null)
  if (error) console.error('[aiCost] não deu pra marcar o trabalho como unknown:', id, error.message)
  return !error
}

// Dia de Brasília do trabalho: o primeiro instante que der pra ler (completed_at, depois created_at).
function jobDay(...instants: unknown[]): string | null {
  for (const v of instants) {
    if (typeof v !== 'string') continue
    const t = Date.parse(v)
    if (Number.isFinite(t)) return brtToday(new Date(t))
  }
  return null
}

// Cotação que serve pro dia: do próprio dia ou de até 8 dias antes (o último dia útil,
// mesma janela do getUsdBrlOn). Qualquer outra vira null.
const FX_MAX_DAYS_BEFORE = 8
function fxUsableFor(fx: FxRate | null, day: string): fx is FxRate {
  return !!fx && Number.isFinite(fx.rate) && fx.rate > 0 && typeof fx.date === 'string'
    && fx.date <= day && fx.date >= addDays(day, -FX_MAX_DAYS_BEFORE)
}

export async function sweepPendingCosts(
  db: SupabaseClient,
  getPrediction: (id: string) => Promise<ReplicatePredictionLike | null>,
  getFx: (day: string) => Promise<FxRate | null>,
  opts: { now: Date; limit: number; budgetMs: number; olderThanMs: number; clock?: () => number },
): Promise<{ recorded: number; unknown: number; failed: number; brlCompleted: number; more: boolean }> {
  const clock = opts.clock ?? Date.now
  const startedAt = clock()
  const overBudget = () => clock() - startedAt > opts.budgetMs
  const limit = Math.max(0, Math.floor(opts.limit))
  const out = { recorded: 0, unknown: 0, failed: 0, brlCompleted: 0, more: false }

  // Câmbio por dia, pedido uma vez por dia nesta varredura. Um dia que já passou sem
  // câmbio quer dizer Banco Central fora: os dias novos desta varredura ficam sem R$
  // sem consultar de novo (cada consulta pode levar segundos).
  const today = brtToday(opts.now)
  const fxByDay = new Map<string, Promise<FxRate | null>>()
  let fxDown = false
  const fxFor = (day: string | null): Promise<FxRate | null> => {
    if (!day) return Promise.resolve(null)
    const known = fxByDay.get(day)
    if (known) return known
    if (fxDown) return Promise.resolve(null)
    const pending = getFx(day).then(
      (fx) => (fxUsableFor(fx, day) ? fx : null),
      (e: unknown) => {
        console.error('[aiCost] câmbio indisponível na varredura:', day, e instanceof Error ? e.message : 'erro')
        return null
      },
    ).then((fx) => {
      if (!fx && day < today) fxDown = true
      return fx
    })
    fxByDay.set(day, pending)
    return pending
  }

  // 1) Completa o R$ de quem já tem o dólar, com o câmbio do dia do trabalho (sem
  // chamar o Replicate). Sem câmbio pra aquele dia, fica pra próxima varredura.
  {
    const { data, error } = await db
      .from('predictions')
      .select('replicate_id, cost_usd, created_at, completed_at')
      .gte('cost_usd', 0)
      .is('cost_brl', null)
      .order('created_at', { ascending: true })
      .limit(limit + 1)
    if (error) throw new Error(`Não deu pra ler os trabalhos sem custo em real: ${error.message}`)
    const rows = (data ?? []) as { replicate_id: string; cost_usd: number | string | null; created_at: unknown; completed_at: unknown }[]
    if (rows.length > limit) out.more = true
    for (const r of rows.slice(0, limit)) {
      if (overBudget()) { out.more = true; break }
      const usd = Number(r.cost_usd)
      if (r.cost_usd == null || !Number.isFinite(usd) || usd < 0) continue
      const fx = await fxFor(jobDay(r.completed_at, r.created_at))
      if (!fx) continue
      // .select: só conta o que esta varredura gravou (duas abas varrendo juntas).
      const { data: hit, error: updErr } = await db
        .from('predictions')
        .update({ cost_brl: round(usd * fx.rate, 4), fx_usd_brl: fx.rate, fx_date: fx.date })
        .eq('replicate_id', r.replicate_id)
        .is('cost_brl', null)
        .select('replicate_id')
      if (updErr) {
        console.error('[aiCost] não deu pra completar o real do trabalho:', r.replicate_id, updErr.message)
        out.failed += 1
      } else if (Array.isArray(hit) && hit.length > 0) {
        out.brlCompleted += 1
      }
    }
  }

  // 2) Trabalhos sem custo gravado, das mais velhas pras mais novas.
  const cutoff = new Date(opts.now.getTime() - opts.olderThanMs).toISOString()
  const { data, error } = await db
    .from('predictions')
    .select('replicate_id, created_at')
    .is('cost_recorded_at', null)
    .lt('created_at', cutoff)
    .order('created_at', { ascending: true })
    .limit(limit + 1)
  if (error) throw new Error(`Não deu pra ler os trabalhos sem custo: ${error.message}`)
  const pending = (data ?? []) as { replicate_id: string; created_at: unknown }[]
  if (pending.length > limit) out.more = true

  for (const { replicate_id: id, created_at: createdAt } of pending.slice(0, limit)) {
    if (overBudget()) { out.more = true; break }

    let prediction: ReplicatePredictionLike | null
    try {
      prediction = await getPrediction(id)
    } catch (e) {
      // Replicate fora ou lento: a linha fica pra próxima varredura e esta para aqui.
      console.error('[aiCost] Replicate não respondeu na varredura:', id, e instanceof Error ? e.message : 'erro')
      out.failed += 1
      out.more = true
      break
    }

    if (prediction == null) {
      // 404 do Replicate: o trabalho não existe mais lá, fecha sem custo.
      if (await markUnknown(db, id, opts.now)) out.unknown += 1
      else out.failed += 1
      continue
    }

    try {
      const status = normalizeStatus(prediction.status)
      const running = status === 'starting' || status === 'processing'
      const fx = running ? null : await fxFor(jobDay(prediction.completed_at, createdAt))
      const result = await recordPredictionResult(db, { ...prediction, id }, fx, opts.now)
      if (result === 'recorded') {
        if (status === 'unknown') out.unknown += 1
        else out.recorded += 1
      }
    } catch (e) {
      console.error('[aiCost] falha ao gravar o custo na varredura:', id, e instanceof Error ? e.message : 'erro')
      await markUnknown(db, id, opts.now)
      out.failed += 1
    }
  }

  return out
}

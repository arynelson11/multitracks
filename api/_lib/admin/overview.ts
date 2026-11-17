import { brtToday } from '../billing.js'
import { getStoredUsdBrl } from '../fx.js'
import { isPlanKey, PLAN_PRICING, type PlanKey } from '../pricing.js'
import type { AdminCtx, AdminHandlers } from './http.js'

// Visão geral (Task 15): os números do mês vêm de admin_overview (T22) e a
// contagem das Pendências de admin_review_queue (T5). O servidor acrescenta:
// * month.label: o nome do mês ("novembro de 2026").
// * mrrBrl: assinaturas pagas ativas que renovam vezes o preço da tabela única
//   (PLAN_PRICING), o anual dividido por 12 (D18).
// * marginBrl: receita líquida menos o custo de IA do mês.
// * fx: o câmbio guardado (getStoredUsdBrl, T11), sem consultar o Banco
//   Central; quem atualiza o câmbio é a aba Custos de IA. Sem conseguir ler o
//   guardado, vale o que o admin_overview trouxe. ageDays em dias de Brasília.
// * alerts: manual e auto da fila; bloqueados com assinatura ativa;
//   withoutCostPending, os trabalhos sem custo do mês que a varredura de Custos
//   de IA ainda completa (aiCost.withoutCostPending do próprio admin_overview,
//   pela mesma função do admin_ai_costs; Rulings ADM-sem-custo-visao e
//   ADM-sem-custo-sql): o já tentado sem preço conhecido não acende alerta,
//   porque não há o que fazer. O aiCost.withoutCost (a nota da margem) segue
//   com o total. fxOld com câmbio de mais de 4 dias ou sem câmbio, porque o
//   custo em R$ dos trabalhos novos é feito com ele.
// Resposta do banco fora do formato vira erro inesperado (o detalhe vai pro
// log): nunca um número inventado no lugar do que faltou.

type Obj = Record<string, unknown>
type Counts = Partial<Record<PlanKey, number>>
type Fx = { date: string; rate: number }

const FX_OLD_DAYS = 4
const DAY_MS = 86400_000
const NO_DATA = 'sem dado'
const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/
const MONTHS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro']

const round2 = (value: number): number => Math.round(value * 100) / 100

// Instante UTC da meia-noite do dia AAAA-MM-DD, ou null se o dia não existe
// no calendário (2026-02-30 não passa).
function dayMs(day: unknown): number | null {
  if (typeof day !== 'string') return null
  const m = DAY_RE.exec(day)
  if (!m) return null
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])]
  const t = Date.UTC(y, mo - 1, d)
  const back = new Date(t)
  return back.getUTCFullYear() === y && back.getUTCMonth() === mo - 1 && back.getUTCDate() === d ? t : null
}

export function mrrBrl(activeByPlan: Counts): number {
  let total = 0
  for (const [key, count] of Object.entries(activeByPlan)) {
    if (!isPlanKey(key) || typeof count !== 'number' || !Number.isFinite(count)) continue
    const { value, cycle } = PLAN_PRICING[key]
    total += count * (cycle === 'YEARLY' ? value / 12 : value)
  }
  return round2(total)
}

export function monthLabel(startDay: string): string {
  const t = dayMs(startDay)
  if (t === null) return NO_DATA
  const d = new Date(t)
  return `${MONTHS[d.getUTCMonth()]} de ${d.getUTCFullYear()}`
}

// Dias de Brasília entre o dia do câmbio e hoje. Data depois de hoje conta 0.
export function fxAgeDays(fxDate: string | null, now: Date): number | null {
  const fx = dayMs(fxDate)
  const today = dayMs(brtToday(now))
  if (fx === null || today === null) return null
  return Math.max(0, Math.round((today - fx) / DAY_MS))
}

// ── Leitura conferida do que o banco devolveu

const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v)
const outOfFormat = (where: string): Error => new Error(`${where} devolveu fora do formato`)

function section(src: Obj, key: string, where: string): Obj {
  const v = src[key]
  if (!isObj(v)) throw outOfFormat(`${where}.${key}`)
  return v
}

function amount(src: Obj, key: string, where: string): number {
  const v = src[key]
  if (typeof v !== 'number' || !Number.isFinite(v)) throw outOfFormat(`${where}.${key}`)
  return v
}

function count(src: Obj, key: string, where: string): number {
  const v = src[key]
  if (!Number.isSafeInteger(v) || (v as number) < 0) throw outOfFormat(`${where}.${key}`)
  return v as number
}

function day(src: Obj, key: string, where: string): string {
  const v = src[key]
  if (dayMs(v) === null) throw outOfFormat(`${where}.${key}`)
  return v as string
}

// Quantidade por plano: só os 4 planos da tabela, cada um um inteiro de 0 pra cima.
function countsByPlan(src: Obj, key: string, where: string): Counts {
  const v = section(src, key, where)
  for (const [plan, n] of Object.entries(v)) {
    if (!isPlanKey(plan) || !Number.isSafeInteger(n) || (n as number) < 0) throw outOfFormat(`${where}.${key}`)
  }
  return v as Counts
}

function fxOf(v: unknown): Fx | null {
  if (!isObj(v)) return null
  const { date, rate } = v
  if (dayMs(date) === null || typeof rate !== 'number' || !Number.isFinite(rate) || rate <= 0) return null
  return { date: date as string, rate }
}

async function rpc(ctx: AdminCtx, name: string, args: Record<string, unknown>): Promise<unknown> {
  const { data, error } = await ctx.db.rpc(name, args)
  if (error) throw new Error(`Falha no banco (${name}): ${error.message}`)
  return data
}

async function overview(ctx: AdminCtx): Promise<unknown> {
  const [raw, queue, stored] = await Promise.all([
    rpc(ctx, 'admin_overview', { p_now: ctx.now.toISOString() }),
    rpc(ctx, 'admin_review_queue', {}),
    getStoredUsdBrl(ctx.db, ctx.now),
  ])

  const where = 'admin_overview'
  if (!isObj(raw)) throw outOfFormat(where)
  const month = section(raw, 'month', where)
  const start = day(month, 'start', `${where}.month`)
  const end = day(month, 'end', `${where}.month`)
  const revenue = section(raw, 'revenue', where)
  const subscribers = section(raw, 'subscribers', where)
  const cancellations = section(raw, 'cancellations', where)
  const aiCost = section(raw, 'aiCost', where)
  const activeByPlan = countsByPlan(subscribers, 'activeByPlan', `${where}.subscribers`)
  const blockedWithActiveSub = count(subscribers, 'blockedWithActiveSub', `${where}.subscribers`)
  const netBrl = amount(revenue, 'netBrl', `${where}.revenue`)
  const costBrl = amount(aiCost, 'costBrl', `${where}.aiCost`)
  const withoutCost = count(aiCost, 'withoutCost', `${where}.aiCost`)
  // Os pendentes são parte do total (mesma consulta); mais que o total é fora do formato.
  const withoutCostPending = count(aiCost, 'withoutCostPending', `${where}.aiCost`)
  if (withoutCostPending > withoutCost) throw outOfFormat(`${where}.aiCost.withoutCostPending`)

  if (!isObj(queue)) throw outOfFormat('admin_review_queue')
  const queueCounts = section(queue, 'counts', 'admin_review_queue')
  const manual = count(queueCounts, 'manual', 'admin_review_queue.counts')
  const auto = count(queueCounts, 'auto', 'admin_review_queue.counts')

  const fx = stored ? { date: stored.date, rate: stored.rate } : fxOf(raw.fx)
  const ageDays = fxAgeDays(fx?.date ?? null, ctx.now)

  return {
    month: { start, end, label: monthLabel(start) },
    revenue,
    mrrBrl: mrrBrl(activeByPlan),
    subscribers,
    cancellations,
    aiCost,
    marginBrl: round2(netBrl - costBrl),
    fx: { date: fx?.date ?? null, rate: fx?.rate ?? null, ageDays },
    alerts: { manual, auto, blockedWithActiveSub, withoutCostPending, fxOld: ageDays === null || ageDays > FX_OLD_DAYS },
  }
}

export const handlers: AdminHandlers = {
  overview: {
    method: 'GET',
    fields: [],
    run: overview,
  },
}

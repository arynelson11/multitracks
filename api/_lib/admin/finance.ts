import { addDays, brtToday } from '../billing.js'
import { AdminError, day, int, oneOf, type AdminCtx, type AdminHandlers } from './http.js'

// Financeiro (Task 14): as cobranças de um período em dias de Brasília, com os
// totais, a receita por mês (12 meses até o fim do período) e as vencidas
// (admin_finance, SQL da T22). Os números saem do banco pelo status real e
// pelo valor pago: receita é cobrança paga com data de pagamento no período,
// estorno conta à parte. O servidor só confere a entrada, confere a forma da
// resposta e acrescenta page e pageSize; não recalcula nem arredonda nada.
// Sem from e to, o mês atual de Brasília (23:30 do dia 30 em Brasília ainda é
// o dia 30, mesmo já sendo dia 1º em UTC). Só uma das datas: a outra vem do
// mês atual.

const PAGE_SIZE = 50
const MAX_PAGE = 1000
// Contando o dia inicial e o final: o ano bissexto inteiro cabe.
const MAX_DAYS = 366

const STATUSES = ['all', 'paid', 'pending', 'overdue', 'refunded', 'deleted'] as const

const MSG_INVERTED = 'A data inicial precisa vir antes da final.'
const MSG_TOO_LONG = 'Escolha um período de até um ano.'

type FinancePage = {
  range: { from: string; to: string }
  totals: Record<string, unknown>
  byMonth: unknown[]
  overdue: unknown[]
  rows: unknown[]
  total: number
  page: number
  pageSize: number
}

// Primeiro e último dia do mês de Brasília de hoje.
function currentMonth(now: Date): { from: string; to: string } {
  const today = brtToday(now)
  const from = `${today.slice(0, 7)}-01`
  const nextMonth = new Date(Date.UTC(Number(today.slice(0, 4)), Number(today.slice(5, 7)), 1)).toISOString().slice(0, 10)
  return { from, to: addDays(nextMonth, -1) }
}

// Dias do período contando os dois extremos (2026-11-16 a 2026-11-16 dá 1).
const daysInRange = (from: string, to: string): number => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400_000) + 1

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

// total é bigint: número no JSON, ou texto se passar do inteiro seguro.
function countOf(v: unknown): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' && /^\d+$/.test(v) ? Number(v) : Number.NaN
  return Number.isSafeInteger(n) && n >= 0 ? n : Number.NaN
}

async function listFinance(ctx: AdminCtx): Promise<FinancePage> {
  const month = currentMonth(ctx.now)
  const from = day(ctx.query, 'from', { label: 'a data inicial', optional: true }) ?? month.from
  const to = day(ctx.query, 'to', { label: 'a data final', optional: true }) ?? month.to
  const status = oneOf(ctx.query, 'status', STATUSES, { label: 'o status', fallback: 'all' })
  const page = int(ctx.query, 'page', { label: 'a página', min: 1, max: MAX_PAGE, fallback: 1 })
  const days = daysInRange(from, to)
  if (days < 1) throw new AdminError(400, MSG_INVERTED)
  if (days > MAX_DAYS) throw new AdminError(400, MSG_TOO_LONG)

  const { data, error } = await ctx.db.rpc('admin_finance', {
    p_from: from,
    p_to: to,
    p_status: status,
    p_limit: PAGE_SIZE,
    p_offset: (page - 1) * PAGE_SIZE,
  })
  if (error) throw new Error(`Falha no banco (admin_finance): ${error.message}`)

  // Fora do formato vira erro, nunca uma tela com número pela metade.
  const d = isObject(data) ? data : null
  const total = countOf(d?.total)
  const range = d?.range
  if (
    !d || !Number.isSafeInteger(total) || !isObject(range) || typeof range.from !== 'string' || typeof range.to !== 'string'
    || !isObject(d.totals) || !Array.isArray(d.byMonth) || !Array.isArray(d.overdue) || !Array.isArray(d.rows)
  ) throw new Error('admin_finance devolveu fora do formato')

  return {
    range: { from: range.from, to: range.to },
    totals: d.totals,
    byMonth: d.byMonth,
    overdue: d.overdue,
    rows: d.rows,
    total,
    page,
    pageSize: PAGE_SIZE,
  }
}

export const handlers: AdminHandlers = {
  finance: {
    method: 'GET',
    fields: ['from', 'to', 'status', 'page'],
    run: listFinance,
  },
}

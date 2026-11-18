import { oneOf, type AdminCtx, type AdminHandlers } from './http.js'
import { countOf, isObject, PAGE_SIZE, readPage, readPeriod } from './period.js'

// Financeiro (Task 14): as cobranças de um período em dias de Brasília, com os
// totais, a receita por mês (12 meses até o fim do período) e as vencidas
// (admin_finance, SQL da T22). Os números saem do banco pelo status real e
// pelo valor pago: receita é cobrança paga com data de pagamento no período,
// estorno conta à parte. O servidor só confere a entrada, confere a forma da
// resposta e acrescenta page e pageSize; não recalcula nem arredonda nada.
// Período e página seguem a regra comum de period.ts (mês de Brasília por
// padrão, até um ano, 50 por página), a mesma de Custos de IA.

const STATUSES = ['all', 'paid', 'pending', 'overdue', 'refunded', 'deleted'] as const

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

async function listFinance(ctx: AdminCtx): Promise<FinancePage> {
  const { from, to } = readPeriod(ctx.query, ctx.now)
  const status = oneOf(ctx.query, 'status', STATUSES, { label: 'o status', fallback: 'all' })
  const page = readPage(ctx.query)

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

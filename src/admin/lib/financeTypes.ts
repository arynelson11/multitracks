// Financeiro (`?action=finance`), cópia do front do contrato da seção Arquitetura B do plano.
// O backend não importa de src/, então os dois lados mantêm o mesmo formato. Aqui ficam também
// as contas da tela (período, barras, rótulos), que um .tsx não pode exportar.
import { EMPTY } from './fmt'
import { monthRange } from './period'

export type PlanKey = 'essencial_mensal' | 'essencial_anual' | 'pro_mensal' | 'pro_anual'

export type FinanceRow = {
  paymentId: string
  userId: string | null
  email: string | null
  planKey: string | null
  status: string
  value: number | null
  netValue: number | null
  dueDate: string | null
  paymentDate: string | null
  confirmedDate: string | null
  refundedAt: string | null
  lastEvent: string
  lastEventAt: string
}

export type FinanceOverdue = {
  paymentId: string
  userId: string | null
  email: string | null
  planKey: string | null
  dueDate: string
  value: number | null
}

export type FinanceMonth = { month: string; grossBrl: number; netBrl: number; byPlan: Partial<Record<PlanKey, number>> }

export type FinanceTotals = {
  grossBrl: number
  netBrl: number
  paidCount: number
  // estornos confirmados no período, já fora do recebido
  refundedBrl: number
  overdueBrl: number
  overdueCount: number
  // cobranças do período em estorno pedido, estorno em andamento ou contestação, fora do recebido e do estornado
  disputedCount: number
}

// page e pageSize vêm do servidor. byMonth: os 12 meses até `to`.
export type FinancePage = {
  range: { from: string; to: string }
  totals: FinanceTotals
  byMonth: FinanceMonth[]
  overdue: FinanceOverdue[]
  rows: FinanceRow[]
  total: number
  page: number
  pageSize: number
}

/** Filtro de status que o servidor aceita (`status=`). */
export type FinanceStatus = 'all' | 'paid' | 'pending' | 'overdue' | 'refunded' | 'deleted'

export type FinancePeriod = 'month' | 'last_month' | 'last_12'

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const isCount = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0
const hasPaymentId = (v: unknown) => isObject(v) && typeof v.paymentId === 'string' && v.paymentId !== ''

/**
 * A resposta tem a forma que a tela usa (Ruling ADM-T7-forma): período, totais, listas de objetos
 * (cada cobrança com o id dela) e números de página. Fora disso a aba mostra a frase pronta, em vez
 * de quebrar no render. Um número que falte dentro dos totais ou de uma linha não derruba a página:
 * aparece como `sem dado`. A exceção é totals.disputedCount: a linha das cobranças em estorno ou
 * contestação só aparece com alguma, e sem o número o que saiu do recebido sumiria sem explicação.
 */
export function isFinancePage(v: unknown): v is FinancePage {
  if (!isObject(v)) return false
  const { range, totals, byMonth, overdue, rows } = v
  return isObject(range) && typeof range.from === 'string' && typeof range.to === 'string'
    && isObject(totals) && isCount(totals.disputedCount)
    && Array.isArray(byMonth) && byMonth.every((m) => isObject(m) && typeof m.month === 'string')
    && Array.isArray(overdue) && overdue.every(hasPaymentId)
    && Array.isArray(rows) && rows.every(hasPaymentId)
    && isCount(v.total) && isCount(v.page) && isCount(v.pageSize) && v.pageSize > 0
}

/** `from` e `to` (dias de Brasília) de cada período, a partir de hoje em Brasília. */
export function periodRange(period: FinancePeriod, today: string): { from: string; to: string } {
  if (period === 'last_month') return monthRange(today, -1)
  const current = monthRange(today, 0)
  // Os 11 meses anteriores mais este: no máximo 366 dias, dentro do teto do servidor.
  if (period === 'last_12') return { from: monthRange(today, -11).from, to: current.to }
  return current
}

const isAmount = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

/**
 * Largura de cada barra em % do maior valor. Valor ausente (null, undefined, texto, NaN) fica fora
 * da escala e vira null: a tela mostra `sem dado` sem barra, e os outros meses mantêm a proporção.
 */
export function barWidths(values: unknown[]): (number | null)[] {
  const known = values.map((v) => (isAmount(v) ? Math.max(0, v) : null))
  const max = Math.max(0, ...known.filter((v): v is number => v !== null))
  return known.map((v) => (v === null ? null : max > 0 ? (v / max) * 100 : 0))
}

const MONTHS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']
const MONTH_RE = /^(\d{4})-(\d{2})(?:-\d{2})?$/

/** `2026-11` (ou `2026-11-01`) vira `nov/2026`. Outro formato aparece como veio. */
export function monthLabel(month: string): string {
  const m = MONTH_RE.exec(month)
  const name = m ? MONTHS[Number(m[2]) - 1] : undefined
  if (!m || !name) return month || EMPTY
  return `${name}/${m[1]}`
}

const PLAN_ORDER: string[] = ['essencial_mensal', 'essencial_anual', 'pro_mensal', 'pro_anual']

/** Valores por plano na ordem da tabela de preços; plano desconhecido vem depois, como veio. */
export function planEntries(byPlan: unknown): { key: string; value: unknown }[] {
  if (!isObject(byPlan)) return []
  const rank = (key: string) => {
    const i = PLAN_ORDER.indexOf(key)
    return i === -1 ? PLAN_ORDER.length : i
  }
  return Object.entries(byPlan)
    .sort(([a], [b]) => rank(a) - rank(b))
    .map(([key, value]) => ({ key, value }))
}

const COUNT = new Intl.NumberFormat('pt-BR')

/** Quantidade inteira; ausente aparece como `sem dado`, nunca como 0. */
export function fmtCount(v: unknown): string {
  return isAmount(v) ? COUNT.format(v) : EMPTY
}

/** Dia do pagamento de uma cobrança: a confirmação, ou o pagamento (mesma regra do servidor). */
export function paidDay(row: Pick<FinanceRow, 'confirmedDate' | 'paymentDate'>): string | null {
  return row.confirmedDate ?? row.paymentDate ?? null
}

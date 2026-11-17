import { addDays, brtToday } from '../billing.js'
import { AdminError, day, int } from './http.js'

// Período e página das listas do admin (Financeiro e Custos de IA): a mesma
// regra e as mesmas frases nas duas abas (Ruling ADM-T24-periodo).
// * Dias de Brasília. Sem from e to, o mês atual de Brasília (23:30 do dia 30
//   em Brasília ainda é o dia 30, mesmo já sendo dia 1º em UTC). Só uma das
//   datas: a outra vem do mês atual.
// * Até 366 dias contando o dia inicial e o final: o ano bissexto inteiro cabe.
// * Página de 1 a 1000, com 50 linhas por página.

export const PAGE_SIZE = 50
const MAX_PAGE = 1000
const MAX_DAYS = 366

const MSG_INVERTED = 'A data inicial precisa vir antes da final.'
const MSG_TOO_LONG = 'Escolha um período de até um ano.'

export type Period = { from: string; to: string }

// Primeiro e último dia do mês de Brasília de hoje.
export function currentMonth(now: Date): Period {
  const today = brtToday(now)
  const from = `${today.slice(0, 7)}-01`
  const nextMonth = new Date(Date.UTC(Number(today.slice(0, 4)), Number(today.slice(5, 7)), 1)).toISOString().slice(0, 10)
  return { from, to: addDays(nextMonth, -1) }
}

// Dias do período contando os dois extremos (2026-11-16 a 2026-11-16 dá 1).
export const daysInRange = (from: string, to: string): number =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400_000) + 1

// from e to da query, conferidos. Lança AdminError(400) com a frase pronta.
export function readPeriod(query: Record<string, unknown>, now: Date): Period {
  const month = currentMonth(now)
  const from = day(query, 'from', { label: 'a data inicial', optional: true }) ?? month.from
  const to = day(query, 'to', { label: 'a data final', optional: true }) ?? month.to
  const days = daysInRange(from, to)
  if (days < 1) throw new AdminError(400, MSG_INVERTED)
  if (days > MAX_DAYS) throw new AdminError(400, MSG_TOO_LONG)
  return { from, to }
}

// page da query, de 1 a 1000; sem ela, a primeira.
export function readPage(query: Record<string, unknown>): number {
  return int(query, 'page', { label: 'a página', min: 1, max: MAX_PAGE, fallback: 1 })
}

export const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

// total é bigint: número no JSON, ou texto se passar do inteiro seguro.
export function countOf(v: unknown): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' && /^\d+$/.test(v) ? Number(v) : Number.NaN
  return Number.isSafeInteger(n) && n >= 0 ? n : Number.NaN
}

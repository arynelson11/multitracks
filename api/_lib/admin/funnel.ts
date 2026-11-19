import { AdminError, int, type AdminCtx, type AdminHandlers } from './http.js'
import { monthLabel } from './overview.js'

// Funil (Parte 3, T2): cadastro, primeira separação, pagante, oferta e anúncio
// de cada mês, de admin_funnel (db/supabase_admin_funil.sql, T1), do mais novo
// pro mais antigo. As regras de cada número (coorte pelo mês de Brasília, conta
// admin fora, pagante pela regra do isFirstSubscription) moram no SQL.
// O servidor acrescenta:
// * months: de 1 a 24, padrão 6, conferido antes de chamar o banco (o banco
//   recusa de novo fora disso).
// * label de cada mês: o nome do mês ("novembro de 2026").
// Cada número do banco é conferido; fora do formato vira erro inesperado (o
// detalhe vai pro log): nunca um número inventado no lugar do que faltou.
// Só os campos do contrato saem, mesmo que o banco mande outro.

export type FunnelMonth = {
  month: string // AAAA-MM
  label: string
  signups: number
  firstSeparation: number
  paying: number
  medianDaysToPay: number | null
  offersShown: number
  offersUsed: number
  adsShown: number
  adsClicked: number
}

type Obj = Record<string, unknown>

const DEFAULT_MONTHS = 6
const MIN_MONTHS = 1
const MAX_MONTHS = 24
const MSG_MONTHS = `Escolha de ${MIN_MONTHS} a ${MAX_MONTHS} meses.`
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/
const WHERE = 'admin_funnel'

// Quantos meses o admin pediu na query: vazio vale o padrão.
export function funnelMonths(query: Record<string, string>): number {
  try {
    return int(query, 'months', { label: 'os meses', min: MIN_MONTHS, max: MAX_MONTHS, fallback: DEFAULT_MONTHS })
  } catch {
    throw new AdminError(400, MSG_MONTHS)
  }
}

// ── Leitura conferida do que o banco devolveu

const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v)
const outOfFormat = (where: string): Error => new Error(`${where} devolveu fora do formato`)

function count(src: Obj, key: string, where: string): number {
  const v = src[key]
  if (!Number.isSafeInteger(v) || (v as number) < 0) throw outOfFormat(`${where}.${key}`)
  return v as number
}

// Parte da coorte: não pode passar do número de cadastros do mês.
function partOfSignups(src: Obj, key: string, signups: number, where: string): number {
  const v = count(src, key, where)
  if (v > signups) throw outOfFormat(`${where}.${key}`)
  return v
}

function median(src: Obj, key: string, where: string): number | null {
  const v = src[key]
  if (v === null) return null
  if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) throw outOfFormat(`${where}.${key}`)
  return v
}

function funnelMonth(raw: unknown, index: number): FunnelMonth {
  const where = `${WHERE}.months[${index}]`
  if (!isObj(raw)) throw outOfFormat(where)
  const month = raw.month
  if (typeof month !== 'string' || !MONTH_RE.test(month)) throw outOfFormat(`${where}.month`)
  const signups = count(raw, 'signups', where)
  return {
    month,
    label: monthLabel(`${month}-01`),
    signups,
    firstSeparation: partOfSignups(raw, 'firstSeparation', signups, where),
    paying: partOfSignups(raw, 'paying', signups, where),
    medianDaysToPay: median(raw, 'medianDaysToPay', where),
    offersShown: count(raw, 'offersShown', where),
    offersUsed: count(raw, 'offersUsed', where),
    adsShown: count(raw, 'adsShown', where),
    adsClicked: count(raw, 'adsClicked', where),
  }
}

async function funnel(ctx: AdminCtx): Promise<{ months: FunnelMonth[] }> {
  const p_months = funnelMonths(ctx.query)
  const { data, error } = await ctx.db.rpc('admin_funnel', { p_now: ctx.now.toISOString(), p_months })
  if (error) throw new Error(`Falha no banco (${WHERE}): ${error.message}`)
  if (!isObj(data) || !Array.isArray(data.months)) throw outOfFormat(WHERE)
  return { months: data.months.map(funnelMonth) }
}

export const handlers: AdminHandlers = {
  funnel: {
    method: 'GET',
    fields: ['months'],
    run: funnel,
  },
}

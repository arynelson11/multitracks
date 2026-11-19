// Funil do Livre (`?action=funnel`, Parte 3), cópia do front do contrato de api/_lib/admin/funnel.ts.
// O front não importa de api/, então os dois lados mantêm o mesmo formato.
// * Cadastros, primeira separação e pagantes contam pelo mês do cadastro (Brasília); ofertas e
//   anúncios, pelo mês do evento. Os meses vêm do mais novo pro mais antigo.
// * medianDaysToPay: mediana em dias do cadastro ao primeiro pagamento; nula sem pagante no mês.

export type FunnelMonth = {
  month: string // AAAA-MM
  label: string // "novembro de 2026", do servidor
  signups: number
  firstSeparation: number
  paying: number
  medianDaysToPay: number | null
  offersShown: number
  offersUsed: number
  adsShown: number
  adsClicked: number
}

export type Funnel = { months: FunnelMonth[] }

const COUNTS = ['signups', 'firstSeparation', 'paying', 'offersShown', 'offersUsed', 'adsShown', 'adsClicked'] as const

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const isCount = (v: unknown): boolean => Number.isSafeInteger(v) && (v as number) >= 0

function isFunnelMonth(v: unknown): v is FunnelMonth {
  if (!isObj(v)) return false
  if (typeof v.month !== 'string' || typeof v.label !== 'string') return false
  if (!COUNTS.every((key) => isCount(v[key]))) return false
  const median = v.medianDaysToPay
  return median === null || (typeof median === 'number' && Number.isFinite(median) && median >= 0)
}

/**
 * A resposta tem a forma que a tela usa: todo mês com o nome e os números do contrato. O servidor
 * já confere cada número; aqui, qualquer um fora do formato vira a frase pronta com Tentar de novo,
 * nunca um número inventado no lugar do que faltou.
 */
export function isFunnel(v: unknown): v is Funnel {
  return isObj(v) && Array.isArray(v.months) && v.months.every(isFunnelMonth)
}

/** Parte do todo em porcentagem inteira arredondada (`'67%'`); sem base (zero cadastro), null. */
export function pctOf(n: number, of: number): string | null {
  if (!Number.isFinite(n) || !Number.isFinite(of) || of <= 0) return null
  return `${Math.round((n / of) * 100)}%`
}

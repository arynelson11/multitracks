// Formatação das telas novas do admin. Valor que falta aparece como `sem dado`, nunca travessão.
// Dias (AAAA-MM-DD) são dias de Brasília e não passam por `new Date`, que leria como UTC
// e mostraria um dia antes no navegador.

export const EMPTY = 'sem dado'

const TZ = 'America/Sao_Paulo'
const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/

const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })
const USD = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'USD' })
const USD_TINY = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 4,
  maximumFractionDigits: 4,
})
const BRT_PARTS = new Intl.DateTimeFormat('en-GB', {
  timeZone: TZ,
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
})

const isNumber = (v: number | null | undefined): v is number => typeof v === 'number' && Number.isFinite(v)

export function fmtBRL(v: number | null): string {
  return isNumber(v) ? BRL.format(v) : EMPTY
}

/** Custo de IA: abaixo de US$ 0,01 mostra 4 casas, pra um trabalho barato não virar US$ 0,00. */
export function fmtUSD(v: number | null): string {
  if (!isNumber(v)) return EMPTY
  return v !== 0 && Math.abs(v) < 0.01 ? USD_TINY.format(v) : USD.format(v)
}

/** Partes de um instante em Brasília, ou null se a data não for válida. */
function brtParts(iso: string): Record<'day' | 'month' | 'year' | 'hour' | 'minute', string> | null {
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return null
  const parts = BRT_PARTS.formatToParts(new Date(t))
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? ''
  return { day: get('day'), month: get('month'), year: get('year'), hour: get('hour'), minute: get('minute') }
}

/** `2026-12-01` vira `01/12/2026`. Um instante completo mostra o dia dele em Brasília. */
export function fmtDay(d: string | null): string {
  if (!d) return EMPTY
  const m = DAY_RE.exec(d)
  if (m) return `${m[3]}/${m[2]}/${m[1]}`
  const p = brtParts(d)
  return p ? `${p.day}/${p.month}/${p.year}` : EMPTY
}

/** Instante ISO como `dd/mm/aaaa hh:mm` no horário de Brasília. */
export function fmtDateTimeBR(iso: string | null): string {
  if (!iso) return EMPTY
  const p = brtParts(iso)
  return p ? `${p.day}/${p.month}/${p.year} ${p.hour}:${p.minute}` : EMPTY
}

const PLAN_LABELS: Record<string, string> = {
  free: 'Livre',
  essencial_mensal: 'Pro Mensal',
  essencial_anual: 'Pro Anual',
  pro_mensal: 'Studio Mensal',
  pro_anual: 'Studio Anual',
}

/** Nome do plano na marca. Chave desconhecida aparece como veio, pra não esconder um plano estranho. */
export function planLabel(key: string | null): string {
  if (!key) return EMPTY
  return PLAN_LABELS[key] ?? key
}

const PAYMENT_STATUS_LABELS: Record<string, string> = {
  PENDING: 'em aberto',
  CONFIRMED: 'confirmada',
  RECEIVED: 'recebida',
  RECEIVED_IN_CASH: 'recebida em dinheiro',
  OVERDUE: 'vencida',
  REFUNDED: 'estornada',
  REFUND_REQUESTED: 'estorno pedido',
  REFUND_IN_PROGRESS: 'estorno em andamento',
  DELETED: 'removida',
  CHARGEBACK_REQUESTED: 'contestação',
}

/** Status da cobrança no Asaas em português; um status novo aparece em minúsculas. */
export function paymentStatusLabel(status: string | null): string {
  if (!status) return EMPTY
  return PAYMENT_STATUS_LABELS[status] ?? status.toLowerCase()
}

const CANCEL_SOURCE_LABELS: Record<string, string> = {
  user: 'pelo app',
  user_refund: 'arrependimento',
  unpaid: 'falta de pagamento',
  refund: 'estorno',
  asaas: 'no painel do Asaas',
  superseded: 'troca de plano',
  duplicate: 'compra repetida',
  admin: 'pelo admin',
  account_deleted: 'conta excluída',
}

/** Por que a assinatura foi cancelada (`cancel_source`). */
export function cancelSourceLabel(source: string | null): string {
  if (!source) return EMPTY
  return CANCEL_SOURCE_LABELS[source] ?? source
}

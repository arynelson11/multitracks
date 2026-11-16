// Dias de Brasília no front (AAAA-MM-DD). A conta é feita com números (Date.UTC), nunca lendo
// o texto do dia com `new Date`, que usaria o fuso do navegador. Usado pelos períodos das abas
// e pelo fim da cortesia na confirmação.

const BRT_DAY = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Sao_Paulo',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})
const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/

function parseDay(day: string): { y: number; m: number; d: number } {
  const match = DAY_RE.exec(day)
  if (!match) throw new Error(`Dia fora do formato AAAA-MM-DD: ${day}`)
  return { y: Number(match[1]), m: Number(match[2]), d: Number(match[3]) }
}

/** Dia de um instante UTC montado por Date.UTC (o mês aqui começa em 0). */
function utcDay(t: number): string {
  const at = new Date(t)
  const mm = String(at.getUTCMonth() + 1).padStart(2, '0')
  const dd = String(at.getUTCDate()).padStart(2, '0')
  return `${at.getUTCFullYear()}-${mm}-${dd}`
}

/** Hoje em Brasília (AAAA-MM-DD). */
export function brtTodayLocal(now: Date = new Date()): string {
  const parts = BRT_DAY.formatToParts(now)
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? ''
  return `${get('year')}-${get('month')}-${get('day')}`
}

/** `day` mais `n` dias (n pode ser negativo). */
export function addDaysLocal(day: string, n: number): string {
  const { y, m, d } = parseDay(day)
  return utcDay(Date.UTC(y, m - 1, d + n))
}

/** Primeiro e último dia do mês de `day` andado `offsetMonths` meses (-1 = mês passado). */
export function monthRange(day: string, offsetMonths: number): { from: string; to: string } {
  const { y, m } = parseDay(day)
  return {
    from: utcDay(Date.UTC(y, m - 1 + offsetMonths, 1)),
    // Dia 0 do mês seguinte é o último dia deste.
    to: utcDay(Date.UTC(y, m + offsetMonths, 0)),
  }
}

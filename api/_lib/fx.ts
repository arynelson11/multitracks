import type { SupabaseClient } from '@supabase/supabase-js'
import { addDays, brtToday } from './billing.js'

// Câmbio do dia: PTAX de venda do Banco Central (API Olinda, pública, sem
// chave), guardada em fx_rates (db/supabase_admin_custos.sql, T10). O custo em
// R$ usa a PTAX pura, sem IOF nem spread do cartão (D16).
//
// * O Banco Central é consultado no máximo a cada 6 horas; dentro disso vale a
//   linha guardada.
// * Se a consulta falhar ou vier vazia, vale a última guardada, de qualquer
//   idade, marcada como stale; a tela mostra a data dela.
// * O dia é o de Brasília.
// * Nada aqui lança: sem câmbio nenhum, o resultado é null.

export type FxRate = { rate: number; date: string; stale: boolean }

const FX_TABLE = 'fx_rates'
const FX_SOURCE = 'bcb_ptax_venda'
const REFRESH_MS = 6 * 3600_000
const DEFAULT_TIMEOUT_MS = 3000
const LOOKBACK_DAYS = 7
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

type StoredRow = { rate: number; date: string; fetchedAt: string }

// "2026-11-16" → "11-16-2026", o formato que a API Olinda pede.
function olindaDate(date: string): string {
  const [y, m, d] = date.split('-')
  return `${m}-${d}-${y}`
}

export function ptaxPeriodUrl(from: string, to: string): string {
  return (
    'https://olinda.bcb.gov.br/olinda/servico/PTAX/versao/v1/odata/' +
    'CotacaoDolarPeriodo(dataInicial=@dataInicial,dataFinalCotacao=@dataFinalCotacao)' +
    `?@dataInicial='${olindaDate(from)}'&@dataFinalCotacao='${olindaDate(to)}'` +
    '&$format=json&$select=cotacaoVenda,dataHoraCotacao'
  )
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

function fetchedRecently(fetchedAt: string, now: Date): boolean {
  const t = Date.parse(fetchedAt)
  return Number.isFinite(t) && now.getTime() - t < REFRESH_MS
}

// Linha mais recente até o dia `today` (Brasília). Erro de banco conta como
// nada guardado.
async function readLatest(db: SupabaseClient, today: string): Promise<StoredRow | null> {
  try {
    const { data, error } = await db
      .from(FX_TABLE)
      .select('rate_date, usd_brl, fetched_at')
      .lte('rate_date', today)
      .order('rate_date', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (error) {
      console.warn('[fx] cambio guardado nao lido:', error.message)
      return null
    }
    if (!data) return null
    const row = data as { rate_date?: unknown; usd_brl?: unknown; fetched_at?: unknown }
    const rate = Number(row.usd_brl)
    const date = typeof row.rate_date === 'string' ? row.rate_date.slice(0, 10) : ''
    if (!Number.isFinite(rate) || rate <= 0 || !DATE_RE.test(date)) return null
    return { rate, date, fetchedAt: typeof row.fetched_at === 'string' ? row.fetched_at : '' }
  } catch (e) {
    console.warn('[fx] cambio guardado nao lido:', errMsg(e))
    return null
  }
}

// Consulta o Banco Central com teto de tempo. O teto vale mesmo se o fetch não
// respeitar o aviso de cancelar. Devolve uma cotação por dia, da mais antiga
// pra mais nova; lança em qualquer falha (quem chama trata).
async function fetchPtax(url: string, fetchFn: typeof fetch, timeoutMs: number): Promise<{ date: string; rate: number }[]> {
  const ctrl = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      ctrl.abort()
      reject(new Error(`Banco Central sem resposta em ${timeoutMs} ms`))
    }, timeoutMs)
  })
  const request = (async () => {
    const res = await fetchFn(url, { signal: ctrl.signal, headers: { accept: 'application/json' } })
    if (!res.ok) throw new Error(`Banco Central respondeu ${res.status}`)
    return (await res.json()) as unknown
  })()
  try {
    const body = await Promise.race([request, timeout])
    const value = (body as { value?: unknown } | null)?.value
    if (!Array.isArray(value)) throw new Error('resposta do Banco Central fora do formato')
    const byDate = new Map<string, { at: string; rate: number }>()
    for (const item of value as { cotacaoVenda?: unknown; dataHoraCotacao?: unknown }[]) {
      const rate = item?.cotacaoVenda
      const at = item?.dataHoraCotacao
      if (typeof rate !== 'number' || !Number.isFinite(rate) || rate <= 0) continue
      if (typeof at !== 'string' || !DATE_RE.test(at.slice(0, 10))) continue
      const date = at.slice(0, 10)
      const seen = byDate.get(date)
      if (!seen || at > seen.at) byDate.set(date, { at, rate })
    }
    return [...byDate.entries()]
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([date, { rate }]) => ({ date, rate }))
  } finally {
    clearTimeout(timer)
  }
}

// Câmbio pra gravar custo: consulta o Banco Central quando o guardado tem mais
// de 6 horas. Nunca lança.
export async function getUsdBrl(
  db: SupabaseClient,
  deps: { now: Date; fetchFn?: typeof fetch; timeoutMs?: number },
): Promise<FxRate | null> {
  const { now } = deps
  const today = brtToday(now)
  const latest = await readLatest(db, today)
  if (latest && fetchedRecently(latest.fetchedAt, now)) return { rate: latest.rate, date: latest.date, stale: false }

  let quotes: { date: string; rate: number }[] = []
  try {
    const fetchFn = deps.fetchFn ?? globalThis.fetch
    quotes = await fetchPtax(ptaxPeriodUrl(addDays(today, -LOOKBACK_DAYS), today), fetchFn, deps.timeoutMs ?? DEFAULT_TIMEOUT_MS)
  } catch (e) {
    console.warn('[fx] consulta ao Banco Central falhou, vale o ultimo guardado:', errMsg(e))
  }

  const newest = quotes[quotes.length - 1]
  if (!newest) return latest ? { rate: latest.rate, date: latest.date, stale: true } : null

  // Sem conseguir gravar, a cotação nova vale mesmo assim; a próxima chamada
  // consulta de novo.
  try {
    const fetchedAt = now.toISOString()
    const { error } = await db
      .from(FX_TABLE)
      .upsert(quotes.map((q) => ({ rate_date: q.date, usd_brl: q.rate, source: FX_SOURCE, fetched_at: fetchedAt })), { onConflict: 'rate_date' })
    if (error) console.warn('[fx] cambio novo nao gravado:', error.message)
  } catch (e) {
    console.warn('[fx] cambio novo nao gravado:', errMsg(e))
  }
  return { rate: newest.rate, date: newest.date, stale: false }
}

// Só o câmbio já guardado, sem consultar o Banco Central (a consulta que o
// usuário faz no fim da separação nunca espera o Banco Central). stale quando a
// linha foi buscada há mais de 6 horas. Erro ou nada guardado: null.
export async function getStoredUsdBrl(db: SupabaseClient, now: Date): Promise<FxRate | null> {
  const latest = await readLatest(db, brtToday(now))
  if (!latest) return null
  return { rate: latest.rate, date: latest.date, stale: !fetchedRecently(latest.fetchedAt, now) }
}

// ── Câmbio do dia de um trabalho (custo de IA, T12) ──
//
// O R$ de cada trabalho usa a PTAX de venda do dia de Brasília dele, ou a do
// último dia útil antes dele (fim de semana e feriado não têm PTAX), nunca a de
// outro dia. Sem cotação pra aquele dia, o resultado é null e o trabalho fica
// sem R$ até a próxima varredura.

const DAY_LOOKBACK_DAYS = 8

// Entre `from` (exclusivo) e `to` (inclusivo) só há sábado e domingo, então
// `from` é o último dia útil até `to`. Feriado não entra aqui: esse caso fica
// pro Banco Central confirmar.
function onlyWeekendAfter(from: string, to: string): boolean {
  let gap = 0
  for (let d = addDays(from, 1); d <= to; d = addDays(d, 1)) {
    gap += 1
    const weekday = new Date(`${d}T12:00:00Z`).getUTCDay()
    if (gap > 2 || (weekday !== 0 && weekday !== 6)) return false
  }
  return true
}

// Grava as cotações consultadas sem enganar o getUsdBrl, que trata a linha mais
// nova buscada há menos de 6 horas como "o Banco Central foi consultado agora".
// Janela que termina hoje é a mesma consulta dele e grava tudo; janela de um dia
// passado só grava o que é mais velho que a cotação mais nova já guardada.
async function storeQuotes(db: SupabaseClient, quotes: { date: string; rate: number }[], day: string, today: string, now: Date): Promise<void> {
  let toStore = quotes
  if (day < today) {
    const latest = await readLatest(db, today)
    toStore = latest ? quotes.filter((q) => q.date < latest.date) : []
  }
  if (toStore.length === 0) return
  try {
    const fetchedAt = now.toISOString()
    const { error } = await db
      .from(FX_TABLE)
      .upsert(toStore.map((q) => ({ rate_date: q.date, usd_brl: q.rate, source: FX_SOURCE, fetched_at: fetchedAt })), { onConflict: 'rate_date' })
    if (error) console.warn('[fx] cambio do dia nao gravado:', error.message)
  } catch (e) {
    console.warn('[fx] cambio do dia nao gravado:', errMsg(e))
  }
}

// PTAX de venda do dia `day` (AAAA-MM-DD, Brasília) ou do último dia útil antes
// dele. Lê fx_rates; sem o dia guardado, consulta o Banco Central (janela de 8
// dias até `day`) e grava. Banco Central fora, ou hoje antes de a PTAX sair:
// null. Nunca lança.
export async function getUsdBrlOn(
  db: SupabaseClient,
  day: string,
  deps: { now?: Date; fetchFn?: typeof fetch; timeoutMs?: number } = {},
): Promise<FxRate | null> {
  const now = deps.now ?? new Date()
  const today = brtToday(now)
  if (!DATE_RE.test(day) || !Number.isFinite(Date.parse(`${day}T00:00:00Z`)) || day > today) return null

  const stored = await readLatest(db, day)
  if (stored && onlyWeekendAfter(stored.date, day)) return { rate: stored.rate, date: stored.date, stale: false }

  let quotes: { date: string; rate: number }[]
  try {
    const fetchFn = deps.fetchFn ?? globalThis.fetch
    quotes = await fetchPtax(ptaxPeriodUrl(addDays(day, -DAY_LOOKBACK_DAYS), day), fetchFn, deps.timeoutMs ?? DEFAULT_TIMEOUT_MS)
  } catch (e) {
    console.warn('[fx] consulta ao Banco Central falhou, o trabalho fica sem real por enquanto:', errMsg(e))
    return null
  }
  const inWindow = quotes.filter((q) => q.date <= day)
  const newest = inWindow[inWindow.length - 1]
  if (!newest) return null
  await storeQuotes(db, inWindow, day, today, now)

  // Dia que já passou: a mais nova que o Banco Central tem até ele é a do último
  // dia útil. Hoje: só a do próprio dia (ou a de sexta no fim de semana).
  if (newest.date === day || day < today || onlyWeekendAfter(newest.date, day)) {
    return { rate: newest.rate, date: newest.date, stale: false }
  }
  return null
}

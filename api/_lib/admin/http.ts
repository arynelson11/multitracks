import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { applyCors } from '../cors.js'
import { verifyAdmin } from '../auth.js'
import { AsaasError, asaasFromEnv, type AsaasApi, type AsaasErrorKind } from '../asaas.js'
import { BillingError, type BillingErrorCode } from '../billing.js'

// Roteador das ações do admin: /api/admin-stats?action=<nome>.
// * Toda ação é conferida no servidor pelo papel (verifyAdmin lê
//   profiles.is_admin com a chave de serviço). O front só esconde botão.
// * Ação nova entra num módulo de api/_lib/admin e no registry.ts, nunca como
//   arquivo novo em api/: o plano Hobby da Vercel aceita no máximo 12 funções.
// * GET lê a query; POST lê o corpo JSON. Campo que a ação não declarou é
//   recusado com 400 (Ruling ADM-T3-estrito). Nenhuma ação espalha ctx.body
//   ou ctx.query nos argumentos de uma RPC: cada campo passa por um validador.
// * Nenhuma resposta fica em cache.
// * Erro vira frase pronta em português, sem detalhe do banco nem do Asaas; a
//   mensagem original vai só pro log.

export type AdminCtx = {
  db: SupabaseClient
  asaas: AsaasApi | null
  admin: { userId: string; email: string }
  now: Date
  query: Record<string, string>
  body: Record<string, unknown>
  // Instante (ms) em que o pedido chegou ao roteador, antes de conferir o papel: o prazo total
  // das ações com o Asaas conta daqui (ASAAS_DEADLINE_MS). Sem ele (ctx montado à mão), conta do now.
  startedAt?: number
}

// Prazo total das chamadas ao Asaas numa ação do admin (cancelar e trocar de plano): depois disto,
// contado do começo do pedido, nenhuma chamada nova começa. Com 5 s de teto por chamada
// (asaasFromEnv(5000) abaixo), a última termina por volta dos 25 s e sobra tempo pra gravar no banco,
// marcar a ficha e fechar o registro antes do maxDuration de 30 s da função (vercel.json).
export const ASAAS_DEADLINE_MS = 20_000

export type AdminHandler = {
  method: 'GET' | 'POST'
  // Campos que a ação aceita: da query no GET, do corpo no POST. Qualquer
  // outro é recusado antes de rodar. Ação sem entrada declara [].
  fields: readonly string[]
  run: (ctx: AdminCtx) => Promise<unknown>
}
export type AdminHandlers = Record<string, AdminHandler>

// Erro com o status HTTP e a frase que o admin vai ler.
export class AdminError extends Error {
  readonly status: number
  constructor(status: number, message: string) {
    super(message)
    this.name = 'AdminError'
    this.status = status
  }
}

const MSG_UNEXPECTED = 'Erro inesperado no servidor.'
const MSG_NO_DB = 'Servidor sem configuração do banco.'
const MSG_MISCONFIGURED = 'Configuração do servidor incompleta. Avise o suporte.'
const MSG_SESSION = 'Sessão inválida ou expirada. Entre de novo.'
const MSG_FORBIDDEN = 'Esta conta não é admin.'

// Frase em português pra recusa do verifyAdmin (que fala inglês pros outros
// endpoints). O texto original vai pro log quando é falha do servidor.
function authRefusal(status: number, original: string): { status: number; error: string } {
  if (status === 401) return { status, error: MSG_SESSION }
  if (status === 403) return { status, error: MSG_FORBIDDEN }
  console.error('[admin] conferencia do admin falhou:', String(original).slice(0, 200))
  return { status: status >= 500 ? status : 500, error: MSG_MISCONFIGURED }
}

// ── O que pode passar pra resposta e pro registro (Ruling ADM-T3-permitidas).
// Lista do que PODE passar, nunca do que bloquear: frase nova de quem quer que
// seja cai na frase genérica sozinha.
// * AdminError: frase escrita nos módulos do admin.
// * BillingError com código marcado como seguro: a Fase 3 escreve essas frases
//   à mão, em português (o teste confere no billing.ts).
// * Falha do Asaas (BillingError asaas_* ou AsaasError): frase genérica e o
//   status HTTP do Asaas quando se sabe, nunca o texto do Asaas nem do cliente.
// * misconfigured: frase genérica (pode citar nome de variável de ambiente).
// * Todo o resto (db_error, código novo, erro qualquer): erro inesperado.
// O detalhe vai sempre pro log (roteador e withAudit).

const SAFE_BILLING_CODES: ReadonlySet<BillingErrorCode> = new Set<BillingErrorCode>(['not_found', 'pending_stop', 'partial'])

const ASAAS_PHRASE: Record<AsaasErrorKind, string> = {
  rejected: 'O Asaas recusou o pedido.',
  unavailable: 'O Asaas não respondeu.',
  not_found: 'O Asaas não achou o que foi pedido.',
}

// Só pra achar o status: o cliente do Asaas (toAsaasError) escreve
// "Asaas recusou (400)", "Asaas respondeu 503" e "não encontrado no Asaas".
// Frase que não bate aqui não vaza: só fica com status "sem dado".
function asaasStatusInText(text: string): number | null {
  const m = /Asaas recusou \((\d{3})\)|Asaas respondeu (\d{3})/.exec(text)
  if (m) return Number(m[1] ?? m[2])
  return /não encontrado no Asaas/.test(text) ? 404 : null
}

const asaasMessage = (kind: AsaasErrorKind, status: number | null): string =>
  `${ASAAS_PHRASE[kind]} Status do Asaas: ${status ?? 'sem dado'}.`

export type AsaasFailure = { status: number | null; message: string }

// Falha do Asaas (AsaasError cru, ou BillingError asaas_* da Fase 3) com a
// frase genérica e o status HTTP do Asaas (null quando não se sabe). null se
// o erro não é do Asaas.
export function asaasFailure(e: unknown): AsaasFailure | null {
  if (e instanceof AsaasError) {
    const status = e.status ?? null
    return { status, message: asaasMessage(e.kind, status) }
  }
  if (e instanceof BillingError && (e.code === 'asaas_rejected' || e.code === 'asaas_unavailable')) {
    const status = asaasStatusInText(e.message)
    const kind: AsaasErrorKind = status === 404 ? 'not_found' : e.code === 'asaas_rejected' ? 'rejected' : 'unavailable'
    return { status, message: asaasMessage(kind, status) }
  }
  return null
}

// AdminError marcado com uncertain: true (resultado incerto, Ruling
// ADM-T16-incerto) leva a marca pro corpo, pra a tela segurar o Confirmar.
export function toHttpError(e: unknown): { status: number; error: string; uncertain?: true } {
  if (e instanceof AdminError) {
    return (e as { uncertain?: unknown }).uncertain === true
      ? { status: e.status, error: e.message, uncertain: true }
      : { status: e.status, error: e.message }
  }
  if (e instanceof BillingError) {
    if (SAFE_BILLING_CODES.has(e.code)) return { status: e.httpStatus, error: e.message }
    if (e.code === 'misconfigured') return { status: e.httpStatus, error: MSG_MISCONFIGURED }
    const asaas = asaasFailure(e)
    if (asaas) return { status: e.httpStatus, error: asaas.message }
  }
  return { status: 500, error: MSG_UNEXPECTED }
}

// Junta os módulos de ações. Nome repetido é erro de quem escreveu o módulo e
// derruba o carregamento (melhor que uma ação esconder a outra).
export function mergeHandlers(...maps: AdminHandlers[]): AdminHandlers {
  const entries: [string, AdminHandler][] = []
  const seen = new Set<string>()
  for (const map of maps) {
    for (const [name, handler] of Object.entries(map)) {
      if (seen.has(name)) throw new Error(`Ação repetida no admin: ${name}`)
      seen.add(name)
      entries.push([name, handler])
    }
  }
  return Object.fromEntries(entries)
}

// ── Validadores da entrada (query ou corpo). Lançam AdminError(400) com a frase
// pronta. O rótulo vem como o admin lê: 'a nota', 'o id da cobrança'.

type Src = Record<string, unknown>

const own = (src: Src, key: string): unknown => (Object.hasOwn(src, key) ? src[key] : undefined)
const isMissing = (v: unknown): boolean => v === undefined || v === null || (typeof v === 'string' && v.trim() === '')
const capitalize = (label: string): string => label.charAt(0).toUpperCase() + label.slice(1)
const invalid = (message: string): AdminError => new AdminError(400, message)
const badFormat = (label: string): AdminError => invalid(`${capitalize(label)} está em formato inválido.`)

// Recusa campo que a ação não declarou (Ruling ADM-T3-estrito). O roteador
// chama isto antes de rodar a ação, com os fields dela.
export function onlyKeys(src: Src, allowed: readonly string[]): void {
  const extra = Object.keys(src).filter((k) => !allowed.includes(k)).map((k) => k.slice(0, 40))
  if (extra.length === 1) throw invalid(`Campo não esperado: ${extra[0]}.`)
  if (extra.length > 1) throw invalid(`Campos não esperados: ${extra.slice(0, 5).join(', ')}.`)
}

type StrOpts = { label: string; min?: number; max?: number; pattern?: RegExp; optional?: boolean }

// Texto sem os espaços das pontas. Tamanho em caracteres (emoji conta 1, como
// o char_length do Postgres).
export function str(src: Src, key: string, opts: StrOpts & { optional: true }): string | null
export function str(src: Src, key: string, opts: StrOpts): string
export function str(src: Src, key: string, opts: StrOpts): string | null {
  const raw = own(src, key)
  if (isMissing(raw)) {
    if (opts.optional) return null
    throw invalid(`Preencha ${opts.label}.`)
  }
  if (typeof raw !== 'string') throw badFormat(opts.label)
  const value = raw.trim()
  const length = Array.from(value).length
  if (opts.min != null && length < opts.min) throw invalid(`${capitalize(opts.label)} precisa ter pelo menos ${opts.min} caracteres.`)
  if (opts.max != null && length > opts.max) throw invalid(`${capitalize(opts.label)} pode ter no máximo ${opts.max} caracteres.`)
  if (opts.pattern && !opts.pattern.test(value)) throw badFormat(opts.label)
  return value
}

type IntOpts = { label: string; min: number; max: number; optional?: boolean; fallback?: number }

// Inteiro do corpo (número) ou da query (texto só com dígitos).
export function int(src: Src, key: string, opts: IntOpts & { fallback: number }): number
export function int(src: Src, key: string, opts: IntOpts & { optional: true }): number | null
export function int(src: Src, key: string, opts: IntOpts): number
export function int(src: Src, key: string, opts: IntOpts): number | null {
  const raw = own(src, key)
  const outOfRange = invalid(`${capitalize(opts.label)} precisa ser um número de ${opts.min} a ${opts.max}.`)
  if (isMissing(raw)) {
    if (opts.fallback !== undefined) return opts.fallback
    if (opts.optional) return null
    throw outOfRange
  }
  const n = typeof raw === 'number' ? raw
    : typeof raw === 'string' && /^-?\d+$/.test(raw.trim()) ? Number(raw.trim())
    : Number.NaN
  if (!Number.isSafeInteger(n) || n < opts.min || n > opts.max) throw outOfRange
  return n
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Id de conta. Sempre em minúsculas, como o Postgres devolve.
export function uuid(src: Src, key: string, label: string): string {
  return str(src, key, { label, pattern: UUID_RE }).toLowerCase()
}

export function oneOf<T extends string>(src: Src, key: string, values: readonly T[], opts: { label: string; fallback?: T }): T {
  const raw = own(src, key)
  if (isMissing(raw)) {
    if (opts.fallback !== undefined) return opts.fallback
    throw invalid(`Preencha ${opts.label}.`)
  }
  if (typeof raw === 'string' && (values as readonly string[]).includes(raw)) return raw as T
  throw badFormat(opts.label)
}

const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/

type DayOpts = { label: string; optional?: boolean }

// Dia AAAA-MM-DD que existe no calendário (2026-02-30 não passa).
export function day(src: Src, key: string, opts: DayOpts & { optional: true }): string | null
export function day(src: Src, key: string, opts: DayOpts): string
export function day(src: Src, key: string, opts: DayOpts): string | null {
  const raw = own(src, key)
  if (isMissing(raw)) {
    if (opts.optional) return null
    throw invalid(`Preencha ${opts.label}.`)
  }
  const value = typeof raw === 'string' ? raw.trim() : ''
  const m = DAY_RE.exec(value)
  if (m) {
    const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])]
    const t = new Date(Date.UTC(y, mo - 1, d))
    if (t.getUTCFullYear() === y && t.getUTCMonth() === mo - 1 && t.getUTCDate() === d) return value
  }
  throw badFormat(opts.label)
}

// ── Roteador

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v) && !Buffer.isBuffer(v)

// Só os valores em texto (o roteador já recusou campo repetido, que chega como lista).
function stringQuery(raw: unknown): Record<string, string> {
  if (!isObject(raw)) return {}
  return Object.fromEntries(Object.entries(raw).filter((e): e is [string, string] => typeof e[1] === 'string'))
}

// Corpo sempre objeto: JSON já lido pela Vercel, ou texto JSON; o resto vira {}.
function objectBody(raw: unknown): Record<string, unknown> {
  let value = raw
  if (typeof value === 'string' || Buffer.isBuffer(value)) {
    try {
      value = JSON.parse(value.toString())
    } catch {
      return {}
    }
  }
  return isObject(value) ? value : {}
}

function describeError(e: unknown): string {
  return e instanceof Error ? `${e.name}: ${e.message}`.slice(0, 300) : 'erro sem mensagem'
}

export function createAdminRouter(handlers: AdminHandlers): (req: any, res: any) => Promise<void> { // eslint-disable-line @typescript-eslint/no-explicit-any
  return async (req, res) => {
    const startedAt = Date.now()
    applyCors(req, res, 'GET,POST,OPTIONS')
    res.setHeader('Cache-Control', 'no-store')
    if (req.method === 'OPTIONS') {
      res.status(200).end()
      return
    }

    let action = ''
    try {
      // Antes de tudo, inclusive do nome da ação: quem não é admin não
      // descobre quais ações existem.
      const auth = await verifyAdmin(req)
      if (!auth.ok) {
        const refusal = authRefusal(auth.status, auth.error)
        res.status(refusal.status).json({ error: refusal.error })
        return
      }
      // Defesa a mais: ok sem o papel (se alguém trocar verifyAdmin por verifyUser) não passa.
      if (auth.isAdmin !== true) {
        res.status(403).json({ error: MSG_FORBIDDEN })
        return
      }

      const name = typeof req.query?.action === 'string' ? req.query.action : ''
      if (!Object.hasOwn(handlers, name)) {
        res.status(400).json({ error: `Ação desconhecida: ${name.slice(0, 60) || 'sem dado'}` })
        return
      }
      action = name
      const handler = handlers[name]
      if (req.method !== handler.method) {
        res.status(405).json({ error: `Esta ação usa ${handler.method}.` })
        return
      }

      // Só os campos que a ação declarou, no lugar certo (query no GET, corpo
      // no POST). O nome da ação é do roteador e não conta como campo.
      const queryInput = Object.fromEntries(Object.entries(isObject(req.query) ? req.query : {}).filter(([k]) => k !== 'action'))
      const body = objectBody(req.body)
      onlyKeys(queryInput, handler.method === 'GET' ? handler.fields : [])
      onlyKeys(body, handler.method === 'POST' ? handler.fields : [])
      const repeated = Object.keys(queryInput).find((k) => typeof queryInput[k] !== 'string')
      if (repeated !== undefined) throw invalid(`Campo repetido: ${repeated.slice(0, 40)}.`)

      const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL
      const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
      if (!supabaseUrl || !serviceKey) {
        console.error('[admin] sem env do Supabase (url ou chave de servico)')
        res.status(500).json({ error: MSG_NO_DB })
        return
      }

      const ctx: AdminCtx = {
        db: createClient(supabaseUrl, serviceKey),
        asaas: asaasFromEnv(5000),
        admin: { userId: auth.userId, email: auth.email },
        now: new Date(),
        query: stringQuery(queryInput),
        body,
        startedAt,
      }
      const result = await handler.run(ctx)
      res.status(200).json(result)
    } catch (e) {
      const out = toHttpError(e)
      if (out.status >= 500) console.error(`[admin] ${action || 'roteador'} falhou:`, describeError(e))
      res.status(out.status).json(out.uncertain ? { error: out.error, uncertain: true } : { error: out.error })
    }
  }
}

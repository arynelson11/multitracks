import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { applyCors } from '../cors.js'
import { verifyAdmin } from '../auth.js'
import { asaasFromEnv, type AsaasApi } from '../asaas.js'
import { BillingError } from '../billing.js'

// Roteador das ações do admin: /api/admin-stats?action=<nome>.
// * Toda ação é conferida no servidor pelo papel (verifyAdmin lê
//   profiles.is_admin com a chave de serviço). O front só esconde botão.
// * Ação nova entra num módulo de api/_lib/admin e no registry.ts, nunca como
//   arquivo novo em api/: o plano Hobby da Vercel aceita no máximo 12 funções.
// * GET lê a query; POST lê o corpo JSON. Nenhuma resposta fica em cache.
// * Erro vira frase pronta em português, sem detalhe do banco nem do Asaas; a
//   mensagem original vai só pro log.

export type AdminCtx = {
  db: SupabaseClient
  asaas: AsaasApi | null
  admin: { userId: string; email: string }
  now: Date
  query: Record<string, string>
  body: Record<string, unknown>
}

export type AdminHandler = { method: 'GET' | 'POST'; run: (ctx: AdminCtx) => Promise<unknown> }
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

export function toHttpError(e: unknown): { status: number; error: string } {
  if (e instanceof AdminError) return { status: e.status, error: e.message }
  // db_error traz o nome da função e a mensagem do Postgres: fica só no log.
  if (e instanceof BillingError && e.code !== 'db_error') return { status: e.httpStatus, error: e.message }
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

// Só os valores em texto (?a=1&a=2 chega como lista e fica de fora).
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

export type AdminRouterOptions = {
  // Painel antigo (?source=asaas|replicate), só até a T28. Roda depois da
  // conferência do admin e só em GET.
  legacy?: (req: any, res: any) => Promise<unknown> // eslint-disable-line @typescript-eslint/no-explicit-any
}

export function createAdminRouter(handlers: AdminHandlers, options: AdminRouterOptions = {}): (req: any, res: any) => Promise<void> { // eslint-disable-line @typescript-eslint/no-explicit-any
  return async (req, res) => {
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
        res.status(auth.status).json({ error: auth.error })
        return
      }

      if (options.legacy && req.method === 'GET' && req.query?.source !== undefined) {
        await options.legacy(req, res)
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
        query: stringQuery(req.query),
        body: objectBody(req.body),
      }
      const result = await handler.run(ctx)
      res.status(200).json(result)
    } catch (e) {
      const out = toHttpError(e)
      if (out.status >= 500) console.error(`[admin] ${action || 'roteador'} falhou:`, describeError(e))
      res.status(out.status).json({ error: out.error })
    }
  }
}

import { AsaasError, getSubscription, listSubscriptionPayments, type AsaasApi, type AsaasPayment } from '../asaas.js'
import { PAID_STATUSES, toBrtDate } from '../billing.js'
import { PLAN_LIMITS, effectivePlan } from '../plan.js'
import { PLAN_PRICING, isPlanKey, type PlanKey } from '../pricing.js'
import { AdminError, int, oneOf, str, uuid, type AdminCtx, type AdminHandlers } from './http.js'
import { lastErrorLabel } from './review.js'

// Assinantes (Task 25): a lista da aba e a ficha de uma conta.
// * subscribers: admin_list_subscribers (SQL da T21). "Todos" (all, none) e
//   parâmetro ausente viram null antes do rpc: null é sem filtro, nunca 400.
//   O SQL devolve { total, rows }; o servidor acrescenta page e pageSize.
// * subscriber: admin_subscriber_detail (T21). Nulo do banco = conta que não
//   existe (404). O servidor acrescenta quota.limit (null pra admin), plans
//   (a tabela única de preços) e a consulta ao Asaas na hora (D14, só GET):
//   asaasLive e as diferenças entre o app e o Asaas em frase pronta
//   (mismatches). Cada assinatura que não deu pra consultar volta com
//   ok: false e a frase do porquê, sem diferença nenhuma: a ficha nunca diz
//   que está tudo certo sem ter conferido.
// Nenhum texto do Asaas sai daqui: só os códigos de status e ciclo (letras
// maiúsculas), o valor e as datas; o último erro das pendências da conta passa
// por lastErrorLabel (Ruling ADM-T6-lastError). O detalhe vai pro log.

const PAGE_SIZE = 50
const MAX_PAGE = 1000
const MAX_SEARCH = 120
// No máximo 3 assinaturas consultadas, cada chamada com teto de 5 s, todas em
// paralelo: a ficha abre em até uns 5 s mesmo com o Asaas lento.
const MAX_ASAAS_LOOKUPS = 3
const ASAAS_TIMEOUT_MS = 5000

const PLAN_FILTERS = ['all', 'essencial_mensal', 'essencial_anual', 'pro_mensal', 'pro_anual'] as const
const STATUS_FILTERS = ['all', 'paid_active', 'ending', 'courtesy', 'free', 'blocked'] as const
const FLAG_FILTERS = ['none', 'review', 'red', 'due7', 'blocked', 'inactive30'] as const
const SORTS = ['created', 'separations', 'last_seen'] as const

const MSG_NOT_FOUND = 'Conta não encontrada.'
const MSG_ASAAS_SILENT = 'O Asaas não respondeu agora.'
const MSG_ASAAS_NO_KEY = 'Não deu pra consultar o Asaas: configuração do servidor incompleta. Avise o suporte.'

// Status da cobrança em aberto (a mesma lista de api/_lib/reconcile.ts).
const OPEN_STATUSES = new Set(['PENDING', 'OVERDUE', 'AWAITING_RISK_ANALYSIS'])
// Nome em português do status da assinatura no Asaas pra frase de diferença
// (o código em inglês nunca entra na frase). Status que não está aqui (novo do
// Asaas, ou resposta sem status) é um estado que o app não reconhece.
const STATUS_NAMES: Record<string, string> = { INACTIVE: 'inativa', EXPIRED: 'expirada' }
const UNKNOWN_STATE = 'num estado que o app não reconhece'

// Cópia no servidor da linha de assinatura da ficha (SubscriptionRow da seção B).
export type SubscriptionRow = {
  id: string
  kind: 'asaas' | 'courtesy'
  planKey: PlanKey
  cycle: 'MONTHLY' | 'YEARLY' | null
  status: 'active' | 'canceled'
  startedAt: string
  nextDueDate: string | null
  paidUntil: string | null
  accessUntil: string | null
  cancelSource: string | null
  canceledAt: string | null
  asaasSubscriptionId: string | null
  asaasStoppedAt: string | null
  lastPaidDueDate: string | null
  needsAdminReview: boolean
  adminNote: string | null
}

// O que a ficha mostra da assinatura no Asaas. value é null quando o Asaas não
// mandou um número (assinatura removida, resposta sem valor): a tela mostra
// "sem dado" em vez de um valor inventado.
export type AsaasLiveData = { status: string; value: number | null; cycle: string; openDueDate: string | null; deleted: boolean }
type AsaasLive = ({ subscriptionRef: string; ok: true } & AsaasLiveData) | { subscriptionRef: string; ok: false; error: string }

type Obj = Record<string, unknown>
const isObject = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v)
const isListOfObjects = (v: unknown): v is Obj[] => Array.isArray(v) && v.every(isObject)

// total é bigint: número no JSON, ou texto se passar do inteiro seguro.
function countOf(v: unknown): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' && /^\d+$/.test(v) ? Number(v) : Number.NaN
  return Number.isSafeInteger(n) && n >= 0 ? n : Number.NaN
}

// ── Frases das diferenças

// Espaço inquebrável do Intl ("R$ 119,90") vira espaço comum: a frase sai
// igual à escrita no plano e à que a tela compara.
const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })
// (U+00A0 e U+202F, montados pelo código pra o arquivo não ter espaço estranho)
const ODD_SPACES = new RegExp(`[${String.fromCharCode(0x00a0)}${String.fromCharCode(0x202f)}]`, 'g')
const brl = (v: number): string => BRL.format(v).replace(ODD_SPACES, ' ')

const CYCLE_NAMES: Record<string, string> = {
  WEEKLY: 'semanal',
  BIWEEKLY: 'quinzenal',
  MONTHLY: 'mensal',
  BIMONTHLY: 'bimestral',
  QUARTERLY: 'trimestral',
  SEMIANNUALLY: 'semestral',
  YEARLY: 'anual',
}
const cycleName = (cycle: string): string => (Object.hasOwn(CYCLE_NAMES, cycle) ? CYCLE_NAMES[cycle] : cycle.toLowerCase())

// AAAA-MM-DD (ou instante) como dd/mm/aaaa do dia de Brasília.
function brDay(v: string): string {
  const d = toBrtDate(v) ?? v
  return `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`
}

const cents = (v: number): number => Math.round(v * 100)

// Diferenças entre a linha do app e a assinatura no Asaas agora, nesta ordem:
// status, valor, ciclo e vencimento. Com a linha ativa no app, qualquer status
// do Asaas que não seja ACTIVE é diferença: inativa, expirada, removida, ou um
// estado que o app não reconhece (sem dizer o código). Removida no Asaas só
// fala do status: o valor e as cobranças de uma assinatura que não cobra mais
// não são diferença.
// O vencimento compara a cobrança em aberto do ciclo (openDueDate), nunca o
// nextDueDate da assinatura, que aponta pra próxima cobrança a ser gerada.
export function compareWithAsaas(row: SubscriptionRow, live: AsaasLiveData): string[] {
  const out: string[] = []
  const active = row.status === 'active'
  if (active && (live.deleted || live.status !== 'ACTIVE')) {
    const state = live.deleted ? 'removida' : Object.hasOwn(STATUS_NAMES, live.status) ? STATUS_NAMES[live.status] : UNKNOWN_STATE
    out.push(`No Asaas a assinatura está ${state}, mas no app ela está ativa.`)
  }
  if (row.status === 'canceled' && !live.deleted && live.status === 'ACTIVE') {
    out.push('O Asaas ainda cobra esta assinatura, mas no app ela está encerrada.')
  }
  if (live.deleted) return out

  const plan = isPlanKey(row.planKey) ? PLAN_PRICING[row.planKey] : null
  if (plan && typeof live.value === 'number' && Number.isFinite(live.value) && cents(live.value) !== cents(plan.value)) {
    out.push(`No Asaas o valor é ${brl(live.value)}, mas o plano no app é ${plan.label} (${brl(plan.value)}).`)
  }
  const appCycle = plan?.cycle ?? row.cycle
  if (appCycle && live.cycle && live.cycle !== appCycle) {
    out.push(`No Asaas o ciclo é ${cycleName(live.cycle)}, mas o plano no app é ${cycleName(appCycle)}.`)
  }
  const appDue = row.nextDueDate ? toBrtDate(row.nextDueDate) : null
  if (active && live.openDueDate && appDue && live.openDueDate !== appDue) {
    out.push(`No Asaas a cobrança em aberto vence em ${brDay(live.openDueDate)}, mas no app a próxima cobrança é ${brDay(appDue)}.`)
  }
  return out
}

// ── Asaas na hora

// Vencimento da cobrança em aberto do ciclo, a mesma regra da conferência
// diária (api/_lib/reconcile.ts): entre as cobranças não removidas de ciclo
// (vencimento original, senão o atual) depois do último pago, a em aberto de
// menor ciclo. Com cobrança paga de ciclo depois do último pago (pagamento que
// o app ainda não contou), null: o vencimento do app anda quando contar.
export function openDueDate(payments: AsaasPayment[], lastPaidDueDate: string | null): string | null {
  const live = payments.filter((p) => isObject(p) && p.deleted !== true)
  const cycle = (p: AsaasPayment): string => toBrtDate(p.originalDueDate) ?? toBrtDate(p.dueDate) ?? ''
  const lastPaid = (lastPaidDueDate ? toBrtDate(lastPaidDueDate) : null) ?? ''
  if (live.some((p) => PAID_STATUSES.has(p.status ?? '') && cycle(p) > lastPaid)) return null
  const open = live
    .filter((p) => OPEN_STATUSES.has(p.status ?? '') && cycle(p) > lastPaid)
    .sort((a, b) => (cycle(a) < cycle(b) ? -1 : cycle(a) > cycle(b) ? 1 : 0))[0]
  return open ? toBrtDate(open.dueDate) : null
}

// Só código do Asaas (ACTIVE, MONTHLY): texto de fora não vai pra resposta.
const CODE_RE = /^[A-Z_]{1,40}$/
const code = (v: unknown): string => (typeof v === 'string' && CODE_RE.test(v) ? v : '')

// A assinatura como a ficha lê (tipo local: o getSubscription da Fase 3 não
// tipa valor nem ciclo). null é 404: removida.
type AsaasSubscriptionLive = { status?: unknown; value?: unknown; cycle?: unknown; deleted?: unknown }

function readSubscription(sub: unknown): Omit<AsaasLiveData, 'openDueDate'> {
  if (sub === null) return { status: '', value: null, cycle: '', deleted: true }
  const s: AsaasSubscriptionLive = isObject(sub) ? sub : {}
  return {
    status: code(s.status),
    value: typeof s.value === 'number' && Number.isFinite(s.value) ? s.value : null,
    cycle: code(s.cycle),
    deleted: s.deleted === true,
  }
}

// Teto de tempo por chamada: passou, conta como Asaas sem resposta.
function withTimeout<T>(p: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new AsaasError('unavailable', `Asaas sem resposta (mais de ${ASAAS_TIMEOUT_MS} ms)`)), ASAAS_TIMEOUT_MS)
  })
  return Promise.race([p, late]).finally(() => clearTimeout(timer))
}

// Linhas pagas com assinatura no Asaas que ainda podem cobrar: ativas, ou
// encerradas sem a parada confirmada pelo Asaas. As mais novas primeiro (a
// ordem da ficha), no máximo 3.
function rowsToCheck(rows: SubscriptionRow[]): SubscriptionRow[] {
  return rows
    .filter((s) => s.kind === 'asaas' && typeof s.asaasSubscriptionId === 'string' && s.asaasSubscriptionId !== ''
      && (s.status === 'active' || (s.status === 'canceled' && !s.asaasStoppedAt)))
    .slice(0, MAX_ASAAS_LOOKUPS)
}

async function readLive(asaas: AsaasApi, row: SubscriptionRow): Promise<AsaasLive> {
  const id = row.asaasSubscriptionId as string
  try {
    const [sub, payments] = await Promise.all([withTimeout(getSubscription(asaas, id)), withTimeout(listSubscriptionPayments(asaas, id))])
    return { subscriptionRef: row.id, ok: true, ...readSubscription(sub), openDueDate: openDueDate(payments, row.lastPaidDueDate) }
  } catch (e) {
    if (!(e instanceof AsaasError)) throw e
    console.error(`[admin] subscriber: Asaas falhou (${e.kind}, status ${e.status ?? 'sem dado'}):`, e.message.slice(0, 200))
    return { subscriptionRef: row.id, ok: false, error: MSG_ASAAS_SILENT }
  }
}

async function asaasLiveFor(ctx: AdminCtx, rows: SubscriptionRow[]): Promise<AsaasLive[]> {
  const toCheck = rowsToCheck(rows)
  if (toCheck.length === 0) return []
  const asaas = ctx.asaas
  if (!asaas) {
    console.error('[admin] subscriber: servidor sem ASAAS_API_KEY, ficha sem a consulta ao Asaas')
    return toCheck.map((row) => ({ subscriptionRef: row.id, ok: false, error: MSG_ASAAS_NO_KEY }))
  }
  return Promise.all(toCheck.map((row) => readLive(asaas, row)))
}

// ── Lista

async function listSubscribers(ctx: AdminCtx) {
  const q = str(ctx.query, 'q', { label: 'a busca', max: MAX_SEARCH, optional: true })
  const plan = oneOf(ctx.query, 'plan', PLAN_FILTERS, { label: 'o plano', fallback: 'all' })
  const status = oneOf(ctx.query, 'status', STATUS_FILTERS, { label: 'o status', fallback: 'all' })
  const flag = oneOf(ctx.query, 'flag', FLAG_FILTERS, { label: 'a marcação', fallback: 'none' })
  const sort = oneOf(ctx.query, 'sort', SORTS, { label: 'a ordem', fallback: 'created' })
  const page = int(ctx.query, 'page', { label: 'a página', min: 1, max: MAX_PAGE, fallback: 1 })

  const { data, error } = await ctx.db.rpc('admin_list_subscribers', {
    p_search: q,
    p_plan: plan === 'all' ? null : plan,
    p_status: status === 'all' ? null : status,
    p_flag: flag === 'none' ? null : flag,
    p_sort: sort,
    p_limit: PAGE_SIZE,
    p_offset: (page - 1) * PAGE_SIZE,
  })
  if (error) throw new Error(`Falha no banco (admin_list_subscribers): ${error.message}`)

  // Fora do formato vira erro, nunca uma lista pela metade.
  const d = isObject(data) ? data : null
  const total = countOf(d?.total)
  if (!d || !Number.isSafeInteger(total) || !Array.isArray(d.rows)) throw new Error('admin_list_subscribers devolveu fora do formato')
  return { total, page, pageSize: PAGE_SIZE, rows: d.rows }
}

// ── Ficha

type DbDetail = {
  profile: Obj
  quota: Obj
  subscriptions: SubscriptionRow[]
  payments: Obj[]
  legacyPayments: Obj[]
  separations: Obj
  aiCost: Obj
  openActions: Obj[]
}

function detailOf(data: unknown): DbDetail {
  const d = isObject(data) ? data : null
  if (
    !d || !isObject(d.profile) || typeof d.profile.userId !== 'string' || !isObject(d.quota)
    || !isListOfObjects(d.subscriptions) || !isListOfObjects(d.payments) || !isListOfObjects(d.legacyPayments)
    || !isObject(d.separations) || !isObject(d.aiCost) || !isListOfObjects(d.openActions)
  ) throw new Error('admin_subscriber_detail devolveu fora do formato')
  return {
    profile: d.profile,
    quota: d.quota,
    subscriptions: d.subscriptions as SubscriptionRow[],
    payments: d.payments,
    legacyPayments: d.legacyPayments,
    separations: d.separations,
    aiCost: d.aiCost,
    openActions: d.openActions,
  }
}

// Limite do mês sem o extra (a tela soma o bonus à parte): pelo plano efetivo,
// e null pra admin, que não tem limite. Plano desconhecido conta como Livre,
// como a separação (api/separate-audio.ts).
function quotaLimit(profile: Obj, now: Date): number | null {
  if (profile.isAdmin === true) return null
  const plan = effectivePlan(
    typeof profile.plan === 'string' ? profile.plan : null,
    typeof profile.planExpiresAt === 'string' ? profile.planExpiresAt : null,
    now,
  )
  return Object.hasOwn(PLAN_LIMITS, plan) ? PLAN_LIMITS[plan] : PLAN_LIMITS.free
}

const PLANS = (Object.keys(PLAN_PRICING) as PlanKey[]).map((key) => {
  const p = PLAN_PRICING[key]
  return { key, label: p.label, value: p.value, cycle: p.cycle }
})

async function subscriberDetail(ctx: AdminCtx) {
  const userId = uuid(ctx.query, 'userId', 'a conta')
  const { data, error } = await ctx.db.rpc('admin_subscriber_detail', { p_user: userId })
  if (error) throw new Error(`Falha no banco (admin_subscriber_detail): ${error.message}`)
  if (data === null || data === undefined) throw new AdminError(404, MSG_NOT_FOUND)
  const d = detailOf(data)

  const asaasLive = await asaasLiveFor(ctx, d.subscriptions)
  const mismatches = asaasLive.flatMap((live) => {
    if (!live.ok) return []
    const row = d.subscriptions.find((s) => s.id === live.subscriptionRef)
    return row ? compareWithAsaas(row, live) : []
  })

  return {
    profile: d.profile,
    quota: { ...d.quota, limit: quotaLimit(d.profile, ctx.now) },
    subscriptions: d.subscriptions,
    payments: d.payments,
    legacyPayments: d.legacyPayments,
    separations: d.separations,
    aiCost: d.aiCost,
    openActions: d.openActions.map((a) => (Object.hasOwn(a, 'lastError') ? { ...a, lastError: lastErrorLabel(a.lastError) } : a)),
    plans: PLANS,
    asaasLive,
    mismatches,
  }
}

export const handlers: AdminHandlers = {
  subscribers: {
    method: 'GET',
    fields: ['q', 'plan', 'status', 'flag', 'sort', 'page'],
    run: listSubscribers,
  },
  subscriber: {
    method: 'GET',
    fields: ['userId'],
    run: subscriberDetail,
  },
}

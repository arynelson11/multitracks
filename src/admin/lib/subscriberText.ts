// Textos da aba Assinantes e da ficha: status e marcações em português, o último acesso (ou o
// último login, pra quem ainda não abriu esta versão do app), a data que importa em cada linha,
// a faixa da página e as opções dos filtros. Valor que falta aparece como `sem dado`.
import { EMPTY, fmtDateTimeBR, fmtDay, planLabel } from './fmt'
import type { PlanKey, SubscriberFlag, SubscriberRow, SubscriberStatus, SubscriptionRow } from './subscribersTypes'

// Só chave própria do mapa: um código como "constructor" não pode cair em nome herdado de objeto.
const own = (map: Record<string, string>, key: string): string | null => (Object.hasOwn(map, key) ? map[key] : null)

const STATUS_LABELS: Record<SubscriberStatus, string> = {
  paid_active: 'Pagando',
  ending: 'Até o fim do período',
  courtesy: 'Cortesia',
  free: 'Livre',
  blocked: 'Bloqueado',
}

const FLAG_LABELS: Record<SubscriberFlag, string> = {
  review: 'Para conferir',
  red: 'No vermelho',
  due7: 'Vence em 7 dias',
  blocked: 'Bloqueado',
  inactive30: 'Sumido há 30 dias',
}

/** Status da conta na lista. Um status novo aparece como veio, pra não esconder um caso estranho. */
export function statusLabel(status: string | null): string {
  if (!status) return EMPTY
  return own(STATUS_LABELS, status) ?? status
}

/** Marcação da linha. */
export function flagLabel(flag: string): string {
  return own(FLAG_LABELS, flag) ?? flag
}

/** Só a conferência e a cobrança vencida pedem o dono (âmbar); as outras marcações informam. */
export function flagNeedsYou(flag: string): boolean {
  return flag === 'review' || flag === 'red'
}

/**
 * `Último acesso dd/mm/aaaa hh:mm` (abertura do app, D20). Quem ainda não abriu esta versão não
 * tem acesso gravado e mostra o último login, com esse rótulo; sem os dois, `sem dado`.
 */
export function lastAccessText(row: { lastSeenAt: string | null; lastSignInAt: string | null }): string {
  const seen = fmtDateTimeBR(row.lastSeenAt)
  if (seen !== EMPTY) return `Último acesso ${seen}`
  const login = fmtDateTimeBR(row.lastSignInAt)
  if (login !== EMPTY) return `Último login ${login}`
  return EMPTY
}

export type DateText = { label: string; value: string }

/**
 * A data que importa na linha: a próxima cobrança de quem paga, o fim do acesso de quem cancelou
 * e o fim da cortesia. Livre e bloqueado só mostram uma data que exista.
 */
export function billingDateText(row: Pick<SubscriberRow, 'status' | 'nextDueDate' | 'accessUntil'>): DateText | null {
  switch (row.status) {
    case 'paid_active':
      return { label: 'Próxima cobrança', value: fmtDay(row.nextDueDate) }
    case 'ending':
      return { label: 'Acesso até', value: fmtDay(row.accessUntil) }
    case 'courtesy':
      return { label: 'Cortesia até', value: row.accessUntil ? fmtDay(row.accessUntil) : 'sem data para acabar' }
    default:
      if (row.nextDueDate) return { label: 'Próxima cobrança', value: fmtDay(row.nextDueDate) }
      if (row.accessUntil) return { label: 'Acesso até', value: fmtDay(row.accessUntil) }
      return null
  }
}

/** `51 a 100 de 132`. Página sem linhas não tem faixa. */
export function pageRangeText(p: { page: number; pageSize: number; total: number; rows: unknown[] }): string | null {
  if (p.rows.length === 0) return null
  const from = (p.page - 1) * p.pageSize + 1
  return `${from} a ${from + p.rows.length - 1} de ${p.total}`
}

const PROVIDERS: Record<string, string> = { email: 'e-mail e senha', google: 'Google', apple: 'Apple' }

/** Como a pessoa entra na conta. */
export function providerLabel(provider: string | null): string {
  if (!provider) return EMPTY
  return own(PROVIDERS, provider) ?? provider
}

const CYCLES: Record<string, string> = { MONTHLY: 'mensal', YEARLY: 'anual' }

/** Ciclo da cobrança (o do app e o do Asaas usam os mesmos códigos). */
export function cycleLabel(cycle: string | null): string {
  if (!cycle) return EMPTY
  return own(CYCLES, cycle) ?? cycle.toLowerCase()
}

const ASAAS_STATUS: Record<string, string> = { ACTIVE: 'ativa', INACTIVE: 'inativa', EXPIRED: 'expirada' }

/** Status da assinatura no Asaas agora; removida vale mais que o status. */
export function asaasStatusLabel(live: { status: string; deleted: boolean }): string {
  if (live.deleted) return 'removida'
  if (!live.status) return EMPTY
  return own(ASAAS_STATUS, live.status) ?? live.status.toLowerCase()
}

/** `Pro Mensal, assinatura paga` ou `Studio Anual, cortesia`. */
export function subscriptionTitle(s: Pick<SubscriptionRow, 'planKey' | 'kind'>): string {
  return `${planLabel(s.planKey)}, ${s.kind === 'courtesy' ? 'cortesia' : 'assinatura paga'}`
}

export function subscriptionStatusText(s: Pick<SubscriptionRow, 'status'>): string {
  return s.status === 'active' ? 'ativa' : 'encerrada'
}

/** Cota do mês como usadas / limite + extra; admin não tem limite. */
export function quotaText(q: { used: number; limit: number | null; bonus: number }): string {
  if (q.limit === null) return `${q.used} / sem limite`
  return q.bonus > 0 ? `${q.used} / ${q.limit} + ${q.bonus} extra` : `${q.used} / ${q.limit}`
}

/** Trabalhos que ficam fora da soma do custo, contados à parte. */
export function jobsWithoutCostText(n: number): string | null {
  if (!(n > 0)) return null
  return n === 1 ? '1 trabalho sem custo' : `${n} trabalhos sem custo`
}

// Opções dos filtros, com os valores que o servidor aceita (`all` e `none` não vão no pedido).
export type StatusFilter = 'all' | SubscriberStatus
export type FlagFilter = 'due7' | 'red' | 'review' | 'inactive30'
export type PlanFilter = 'all' | PlanKey
export type SortKey = 'created' | 'separations' | 'last_seen'

type Option<T extends string> = { value: T; label: string }

export const STATUS_FILTERS: Option<StatusFilter>[] = [
  { value: 'all', label: 'Todos' },
  { value: 'paid_active', label: 'Pagando' },
  { value: 'ending', label: 'Até o fim do período' },
  { value: 'courtesy', label: 'Cortesia' },
  { value: 'free', label: 'Livre' },
  { value: 'blocked', label: 'Bloqueados' },
]

export const FLAG_FILTERS: Option<FlagFilter>[] = [
  { value: 'due7', label: 'Vence em 7 dias' },
  { value: 'red', label: 'No vermelho' },
  { value: 'review', label: 'Para conferir' },
  { value: 'inactive30', label: 'Sumidos há 30 dias' },
]

const PLAN_KEYS: PlanKey[] = ['essencial_mensal', 'essencial_anual', 'pro_mensal', 'pro_anual']

export const PLAN_FILTERS: Option<PlanFilter>[] = [
  { value: 'all', label: 'Todos os planos' },
  ...PLAN_KEYS.map((key) => ({ value: key, label: planLabel(key) })),
]

export const SORT_OPTIONS: Option<SortKey>[] = [
  { value: 'created', label: 'Mais novos' },
  { value: 'separations', label: 'Mais separações' },
  { value: 'last_seen', label: 'Último acesso' },
]

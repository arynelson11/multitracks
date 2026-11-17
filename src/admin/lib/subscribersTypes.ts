// Assinantes (`?action=subscribers`) e a ficha de uma conta (`?action=subscriber`), cópia do front
// do contrato da seção Arquitetura B do plano. O backend não importa de src/, então os dois lados
// mantêm o mesmo formato. O tipo da ficha se chama SubscriberDetailData pra não bater com o nome
// do componente SubscriberDetail.
import type { ReactNode } from 'react'
import type { ReviewAction } from './reviewTypes'

export type PlanKey = 'essencial_mensal' | 'essencial_anual' | 'pro_mensal' | 'pro_anual'

export type SubscriberStatus = 'paid_active' | 'ending' | 'courtesy' | 'free' | 'blocked'

export type SubscriberFlag = 'review' | 'red' | 'due7' | 'blocked' | 'inactive30'

export type SubscriberRow = {
  userId: string
  email: string | null
  name: string | null
  plan: string
  courtesyPlan: string | null
  status: SubscriberStatus
  nextDueDate: string | null
  accessUntil: string | null
  separationsMonth: number
  createdAt: string
  lastSeenAt: string | null
  lastSignInAt: string | null
  flags: SubscriberFlag[]
}

export type SubscriberPage = { total: number; page: number; pageSize: number; rows: SubscriberRow[] }

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

// Mesmas colunas da linha do Financeiro (FinanceRow da seção B) mais a assinatura e o vencimento
// original. Fica escrita aqui pra ficha não depender do arquivo de tipos de outra aba.
export type SubscriberPayment = {
  paymentId: string
  userId: string | null
  email: string | null
  planKey: string | null
  status: string
  value: number | null
  netValue: number | null
  dueDate: string | null
  paymentDate: string | null
  confirmedDate: string | null
  refundedAt: string | null
  lastEvent: string
  lastEventAt: string
  subscriptionRef: string | null
  originalDueDate: string | null
}

export type LegacyPayment = { id: string; planKey: string; value: number; cycle: string | null; paidAt: string }

export type AsaasLive =
  | { subscriptionRef: string; ok: true; status: string; value: number; cycle: string; openDueDate: string | null; deleted: boolean }
  | { subscriptionRef: string; ok: false; error: string }

export type SubscriberDetailData = {
  profile: {
    userId: string
    email: string | null
    name: string | null
    provider: string | null
    plan: string
    planExpiresAt: string | null
    isAdmin: boolean
    blockedAt: string | null
    blockedReason: string | null
    createdAt: string
    lastSignInAt: string | null
    lastSeenAt: string | null
  }
  // limit vem do servidor (null pra admin).
  quota: { used: number; bonus: number; periodStart: string; resetsAt: string; limit: number | null }
  subscriptions: SubscriptionRow[]
  // As 50 mais novas.
  payments: SubscriberPayment[]
  legacyPayments: LegacyPayment[]
  separations: { month: number; total: number }
  aiCost: { monthBrl: number; totalBrl: number; jobsWithoutCost: number }
  openActions: ReviewAction[]
  // Do servidor: a tabela de preços, a consulta ao Asaas na hora e as diferenças achadas.
  plans: { key: PlanKey; label: string; value: number; cycle: 'MONTHLY' | 'YEARLY' }[]
  asaasLive: AsaasLive[]
  mismatches: string[]
}

/** O lugar das ações (T26) no topo da ficha: recebe a ficha desta conta e o recarregar. */
export type RenderActions = (detail: SubscriberDetailData, reload: () => void) => ReactNode

const isCount = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const isListOfObjects = (v: unknown): boolean => Array.isArray(v) && v.every(isObject)

/**
 * A lista tem a forma que a tela usa (Ruling ADM-T7-forma): números onde a tela conta páginas e
 * linhas com id e lista de marcações. Fora disso a aba mostra a frase pronta, em vez de quebrar.
 */
export function isSubscriberPage(v: unknown): v is SubscriberPage {
  if (!isObject(v)) return false
  return isCount(v.total) && isCount(v.page) && isCount(v.pageSize) && (v.pageSize as number) > 0
    && Array.isArray(v.rows)
    && v.rows.every((r) => isObject(r) && typeof r.userId === 'string' && Array.isArray(r.flags))
}

/** A ficha tem as partes que a tela percorre: o perfil com o id, os blocos e as listas. */
export function isSubscriberDetailData(v: unknown): v is SubscriberDetailData {
  if (!isObject(v)) return false
  return isObject(v.profile) && typeof v.profile.userId === 'string'
    && isObject(v.quota) && isObject(v.separations) && isObject(v.aiCost)
    && isListOfObjects(v.subscriptions) && isListOfObjects(v.payments) && isListOfObjects(v.legacyPayments)
    && isListOfObjects(v.openActions) && isListOfObjects(v.plans) && isListOfObjects(v.asaasLive)
    && Array.isArray(v.mismatches) && v.mismatches.every((m) => typeof m === 'string')
}

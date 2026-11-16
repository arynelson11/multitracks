import { vi } from 'vitest'
import { AsaasError, type AsaasApi, type AsaasPayment } from '../_lib/asaas.js'
import { createFakeDb, type FakeDb, type Row } from './fakeSupabase.js'

// Arnês dos testes de cobrança: Asaas falso (nenhuma chamada de rede) e um
// modelo simples das funções SQL de db/supabase_assinaturas.sql. O SQL de
// verdade foi testado num Postgres local descartável (ver relatório); aqui o
// foco é a ordem das chamadas do backend e quem ele deixa mexer em quê.

export const USER_A = '11111111-1111-4111-8111-111111111111'
export const USER_B = '22222222-2222-4222-8222-222222222222'
export const USER_C = '33333333-3333-4333-8333-333333333333'

type Route = (path: string, payload?: unknown) => unknown
export type FakeAsaas = AsaasApi & {
  get: ReturnType<typeof vi.fn>
  post: ReturnType<typeof vi.fn>
  put: ReturnType<typeof vi.fn>
  del: ReturnType<typeof vi.fn>
}

export const asaasDown = () => new AsaasError('unavailable', 'Asaas sem resposta (ECONNRESET)')
export const asaasRejected = (msg = 'recusado') => new AsaasError('rejected', `Asaas recusou (400): ${msg}`, 400)

export function createFakeAsaas(routes: { get?: Route; post?: Route; put?: Route; del?: Route } = {}): FakeAsaas {
  const wrap = (r?: Route) => vi.fn(async (path: string, payload?: unknown) => (r ? r(path, payload) : {}))
  return {
    get: wrap(routes.get ?? ((path) => (path.includes('/notifications') ? { data: [] } : { data: [], hasMore: false }))),
    post: wrap(routes.post),
    put: wrap(routes.put),
    del: wrap(routes.del ?? (() => ({ deleted: true }))),
  } as FakeAsaas
}

function periodEnd(due: string, cycle: string | null): string {
  const [y, m, d] = due.split('-').map(Number)
  const base = cycle === 'YEARLY' ? new Date(Date.UTC(y + 1, m - 1, d)) : new Date(Date.UTC(y, m, d))
  // fim do dia do próximo vencimento em Brasília = 03:00 UTC do dia seguinte
  return new Date(base.getTime() + 86400_000 + 3 * 3600_000).toISOString()
}

export function subRow(over: Partial<Row> & { id: string; user_id: string }): Row {
  return {
    kind: 'asaas', plan_key: 'essencial_mensal', cycle: 'MONTHLY', asaas_subscription_id: null,
    asaas_customer_id: null, status: 'active', paid_until: null, access_until: null, cancel_source: null,
    asaas_deleted_at: null, needs_admin_review: false, admin_note: null, created_at: '2026-11-01T12:00:00Z',
    last_paid_due_date: null,
    ...over,
  } as AsaasPayment & Record<string, unknown>
}

export function createBillingDb(tables: Record<string, Row[]> = {}, now: () => Date = () => new Date()): FakeDb {
  const db: FakeDb = createFakeDb({
    tables: { profiles: [], billing_subscriptions: [], pending_checkouts: [], payments: [], billing_payments: [], asaas_webhook_events: [], ...tables },
    rpc: {
      billing_upsert_subscription: (a) => {
        const rows = db.tables.billing_subscriptions
        const existing = rows.find((r) => r.id === a.p_id)
        if (existing && existing.user_id !== a.p_user_id) return 'owner_mismatch'
        if (a.p_subscription_id && rows.some((r) => r.asaas_subscription_id === a.p_subscription_id && r.id !== a.p_id)) return 'subscription_conflict'
        const due = (a.p_paid_due_date as string | null) ?? null
        if (existing) {
          existing.asaas_subscription_id ??= a.p_subscription_id ?? null
          existing.asaas_customer_id ??= a.p_customer_id ?? null
          if (due) existing.paid_until = periodEnd(due, existing.cycle as string)
        } else {
          rows.push(subRow({
            id: a.p_id as string, user_id: a.p_user_id as string, plan_key: a.p_plan_key, cycle: a.p_cycle,
            asaas_subscription_id: a.p_subscription_id ?? null, asaas_customer_id: a.p_customer_id ?? null,
            paid_until: due ? periodEnd(due, a.p_cycle as string) : null, created_at: now().toISOString(),
          }))
        }
        if (a.p_activate) {
          const prof = db.tables.profiles.find((p) => p.id === a.p_user_id)
          if (prof) { prof.plan = a.p_plan_key; prof.plan_expires_at = null }
        }
        return 'ok'
      },
      billing_end_subscription: (a) => {
        const r = db.tables.billing_subscriptions.find((x) => x.id === a.p_id)
        if (!r) return { result: 'not_found' }
        const needs = r.kind === 'asaas' && !r.asaas_deleted_at && a.p_source !== 'asaas'
        if (r.status === 'canceled') return { result: 'already_canceled', access_until: r.access_until, needs_asaas_delete: needs && r.cancel_source !== 'asaas', subscription_id: r.asaas_subscription_id }
        const fromPaid = a.p_paid_due_date ? periodEnd(a.p_paid_due_date as string, r.cycle as string) : null
        const candidates = [r.paid_until as string | null, fromPaid].filter((x): x is string => !!x).sort()
        let access = a.p_immediate ? now().toISOString() : candidates[candidates.length - 1] ?? now().toISOString()
        if (access < now().toISOString()) access = now().toISOString()
        Object.assign(r, { status: 'canceled', cancel_source: a.p_source, access_until: access, canceled_at: now().toISOString() })
        if (a.p_source === 'asaas') r.asaas_deleted_at = now().toISOString()
        const prof = db.tables.profiles.find((p) => p.id === r.user_id)
        if (prof) {
          if (access > now().toISOString()) prof.plan_expires_at = access
          else { prof.plan = 'free'; prof.plan_expires_at = null }
        }
        return { result: 'canceled', access_until: access, needs_asaas_delete: needs, subscription_id: r.asaas_subscription_id }
      },
      billing_payment_overdue: (a) => {
        const r = db.tables.billing_subscriptions.find((x) => x.id === a.p_id)
        if (!r) return { result: 'not_found' }
        if (r.status === 'canceled') return { result: 'already_canceled', needs_asaas_delete: !r.asaas_deleted_at, subscription_id: r.asaas_subscription_id }
        Object.assign(r, { status: 'canceled', cancel_source: 'unpaid', access_until: now().toISOString() })
        const prof = db.tables.profiles.find((p) => p.id === r.user_id)
        if (prof) { prof.plan = 'free'; prof.plan_expires_at = null }
        return { result: 'canceled_unpaid', needs_asaas_delete: !r.asaas_deleted_at, subscription_id: r.asaas_subscription_id }
      },
      billing_payment_refunded: (a) => {
        const r = db.tables.billing_subscriptions.find((x) => x.id === a.p_id)
        if (!r) return { result: 'not_found' }
        const needs = !r.asaas_deleted_at && r.cancel_source !== 'asaas'
        Object.assign(r, { status: 'canceled', cancel_source: r.cancel_source ?? 'refund', access_until: now().toISOString() })
        const prof = db.tables.profiles.find((p) => p.id === r.user_id)
        if (prof) { prof.plan = 'free'; prof.plan_expires_at = null }
        return { result: 'refunded', needs_asaas_delete: needs, subscription_id: r.asaas_subscription_id }
      },
      billing_payment_confirmed: (a) => {
        const r = db.tables.billing_subscriptions.find((x) => x.id === a.p_id)
        if (!r) return { result: 'not_found' }
        const end = periodEnd(a.p_due_date as string, r.cycle as string)
        if (r.status === 'canceled' && end > String(r.access_until ?? '')) {
          Object.assign(r, { access_until: end, needs_admin_review: true })
          return { result: 'late_after_cancel', access_until: end }
        }
        r.paid_until = end
        return { result: 'extended', paid_until: end }
      },
      billing_mark_asaas_deleted: (a) => {
        const r = db.tables.billing_subscriptions.find((x) => x.id === a.p_id)
        if (r) { r.asaas_deleted_at ??= now().toISOString(); r.asaas_subscription_id ??= a.p_subscription_id ?? null }
        return null
      },
      billing_flag_review: (a) => {
        const r = db.tables.billing_subscriptions.find((x) => x.id === a.p_id)
        if (r) { r.needs_admin_review = true; r.admin_note = a.p_note }
        return null
      },
      billing_change_plan: (a) => {
        const r = db.tables.billing_subscriptions.find((x) => x.id === a.p_id)
        if (!r) return { result: 'not_found' }
        if (r.status !== 'active') return { result: 'not_active' }
        Object.assign(r, { plan_key: a.p_plan_key, cycle: a.p_cycle })
        const prof = db.tables.profiles.find((p) => p.id === r.user_id)
        if (prof) prof.plan = a.p_plan_key
        return { result: 'changed', plan_key: a.p_plan_key }
      },
      billing_grant_courtesy: (a) => {
        const id = `cortesia:${db.tables.billing_subscriptions.length + 1}`
        db.tables.billing_subscriptions.push(subRow({ id, kind: 'courtesy', user_id: a.p_user_id as string, plan_key: a.p_plan_key, cycle: null, access_until: a.p_until ?? null }))
        return id
      },
    },
  })
  return db
}

// Cobrança do Asaas no formato que a API e o webhook mandam.
export function payment(over: Record<string, unknown> = {}): AsaasPayment & Record<string, unknown> {
  return {
    object: 'payment', id: 'pay_1', customer: 'cus_1', subscription: 'sub_1', checkoutSession: null,
    value: 49.9, netValue: 47.91, billingType: 'CREDIT_CARD', status: 'CONFIRMED',
    dueDate: '2026-11-16', paymentDate: null, confirmedDate: '2026-11-16', deleted: false,
    creditCard: { creditCardNumber: '8829', creditCardBrand: 'MASTERCARD', creditCardToken: 'tok-nao-guardar' },
    ...over,
  } as AsaasPayment & Record<string, unknown>
}

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

function nextDueDate(due: string, cycle: string | null): string {
  const [y, m, d] = due.split('-').map(Number)
  const base = cycle === 'YEARLY' ? new Date(Date.UTC(y + 1, m - 1, d)) : new Date(Date.UTC(y, m, d))
  return base.toISOString().slice(0, 10)
}

function periodEnd(due: string, cycle: string | null): string {
  const [y, m, d] = due.split('-').map(Number)
  const base = cycle === 'YEARLY' ? new Date(Date.UTC(y + 1, m - 1, d)) : new Date(Date.UTC(y, m, d))
  // fim do dia do próximo vencimento em Brasília = 03:00 UTC do dia seguinte
  return new Date(base.getTime() + 86400_000 + 3 * 3600_000).toISOString()
}

export function subRow(over: Partial<Row> & { id: string; user_id: string | null }): Row {
  return {
    kind: 'asaas', plan_key: 'essencial_mensal', cycle: 'MONTHLY', asaas_subscription_id: null,
    asaas_customer_id: null, status: 'active', paid_until: null, access_until: null, cancel_source: null,
    asaas_stopped_at: null, asaas_stop_kind: null, needs_admin_review: false, admin_note: null,
    started_at: '2026-11-01T12:00:00Z', created_at: '2026-11-01T12:00:00Z', last_paid_due_date: null, next_due_date: null,
    first_paid_at: null, checkout_created_at: null, checkout_paid_at: null, switch_confirmed: false,
    ...over,
  }
}

// Modelo das funções SQL de db/supabase_assinaturas.sql (simplificado; o SQL
// de verdade é testado em ~/playback-studio-work/cobranca-sql-tests).
export function createBillingDb(tables: Record<string, Row[]> = {}, now: () => Date = () => new Date()): FakeDb {
  let nextActionId = 1
  const iso = () => now().toISOString()
  const subs = () => db.tables.billing_subscriptions
  const sub = (id: unknown) => subs().find((x) => x.id === id)
  // billing_sync_profile: entre as pagas ativas, a de início mais recente; com
  // cortesia ativa, o MAIOR plano entre a paga e a cortesia (COB-R7; empate, a
  // paga), e a cortesia por cima de uma paga fica sem data no perfil; sem nada
  // ativo, a cancelada que ainda tem acesso.
  const rank = (plan: unknown) => (String(plan).startsWith('pro_') ? 2 : String(plan).startsWith('essencial_') ? 1 : 0)
  const byStart = (a: Row, b: Row) => (String(a.started_at) < String(b.started_at) ? 1 : -1)
  const sync = (userId: unknown) => {
    const prof = db.tables.profiles.find((p) => p.id === userId)
    if (!prof) return
    const mine = subs().filter((r) => r.user_id === userId)
    const live = mine.filter((r) => r.status === 'active' && (!r.access_until || String(r.access_until) > iso()))
    const paid = live.filter((r) => r.kind === 'asaas').sort((a, b) => (!a.access_until === !b.access_until ? byStart(a, b) : a.access_until ? 1 : -1))[0]
    const court = live.filter((r) => r.kind === 'courtesy').sort((a, b) => rank(b.plan_key) - rank(a.plan_key) || byStart(a, b))[0]
    if (court && (!paid || rank(court.plan_key) > rank(paid.plan_key))) {
      prof.plan = court.plan_key; prof.plan_expires_at = paid ? paid.access_until ?? null : court.access_until ?? null
      return
    }
    if (paid) { prof.plan = paid.plan_key; prof.plan_expires_at = paid.access_until ?? null; return }
    const grace = mine.filter((r) => r.status === 'canceled' && String(r.access_until ?? '') > iso()).sort(byStart)[0]
    if (grace) { prof.plan = grace.plan_key; prof.plan_expires_at = grace.access_until ?? null }
    else if (mine.length) { prof.plan = 'free'; prof.plan_expires_at = null }
  }
  const STOP_ACTIONS = ['delete_subscription', 'inactivate_subscription']
  const openStop = (ref: unknown) => db.tables.billing_pending_actions.find((x) => x.subscription_ref === ref && x.status === 'pending' && STOP_ACTIONS.includes(String(x.action)))
  // billing_flag_review: acumula as notas (não repete a mesma), como o SQL
  const flag = (ref: unknown, note: unknown) => {
    const r = sub(ref)
    if (!r) return
    r.needs_admin_review = true
    const prev = r.admin_note == null ? null : String(r.admin_note)
    r.admin_note = prev && prev.includes(String(note)) ? prev : [prev, note].filter((x) => x != null).join(' | ')
  }
  const enqueue = (ref: unknown, action: string, reason: string, extra: Partial<Row> = {}) => {
    const open = db.tables.billing_pending_actions.find((a) => a.subscription_ref === ref && a.action === action && a.status === 'pending')
    if (open) return open.id as number
    const r = sub(ref)
    const id = nextActionId++
    db.tables.billing_pending_actions.push({
      id, subscription_ref: ref, user_id: r?.user_id ?? null, action, reason, asaas_subscription_id: r?.asaas_subscription_id ?? null,
      asaas_payment_id: null, due_date: null, amount: null, auto_retry: true, status: 'pending', attempts: 0, last_error: null,
      next_attempt_at: iso(), ...extra,
    })
    return id
  }
  const markStopped = (ref: unknown, kind: string, subId?: unknown) => {
    const r = sub(ref)
    if (r) { r.asaas_stopped_at ??= iso(); r.asaas_stop_kind ??= kind; r.asaas_subscription_id ??= subId ?? null }
    for (const a of db.tables.billing_pending_actions) {
      if (a.subscription_ref === ref && a.status === 'pending' && STOP_ACTIONS.includes(String(a.action))) a.status = 'done'
    }
  }
  const db: FakeDb = createFakeDb({
    tables: { profiles: [], billing_subscriptions: [], pending_checkouts: [], payments: [], billing_payments: [], asaas_webhook_events: [], billing_pending_actions: [], ...tables },
    primaryKeys: { billing_pending_actions: 'id' },
    defaults: { asaas_webhook_events: () => ({ received_at: iso(), attempts: 0 }) },
    rpc: {
      billing_upsert_subscription: (a) => {
        const existing = sub(a.p_id)
        if (existing && existing.user_id !== a.p_user_id) return 'owner_mismatch'
        if (a.p_subscription_id && subs().some((r) => r.asaas_subscription_id === a.p_subscription_id && r.id !== a.p_id)) return 'subscription_conflict'
        const due = (a.p_paid_due_date as string | null) ?? null
        if (existing) {
          existing.asaas_subscription_id ??= a.p_subscription_id ?? null
          existing.asaas_customer_id ??= a.p_customer_id ?? null
          if (a.p_first_paid_at && (!existing.first_paid_at || String(a.p_first_paid_at) < String(existing.first_paid_at))) existing.first_paid_at = a.p_first_paid_at
          existing.checkout_created_at ??= a.p_checkout_created_at ?? null
          if (a.p_checkout_paid_at && (!existing.checkout_paid_at || String(a.p_checkout_paid_at) < String(existing.checkout_paid_at))) existing.checkout_paid_at = a.p_checkout_paid_at
          if (a.p_switch_confirmed) existing.switch_confirmed = true
          if (a.p_started_at && String(a.p_started_at) < String(existing.started_at)) existing.started_at = a.p_started_at
          if (due && (!existing.last_paid_due_date || due > String(existing.last_paid_due_date))) { existing.last_paid_due_date = due; existing.paid_until = periodEnd(due, existing.cycle as string) }
        } else {
          subs().push(subRow({
            id: a.p_id as string, user_id: a.p_user_id as string, plan_key: a.p_plan_key, cycle: a.p_cycle,
            asaas_subscription_id: a.p_subscription_id ?? null, asaas_customer_id: a.p_customer_id ?? null,
            last_paid_due_date: due, paid_until: due ? periodEnd(due, a.p_cycle as string) : null,
            started_at: (a.p_started_at as string | null) ?? iso(), created_at: iso(),
            first_paid_at: a.p_first_paid_at ?? null, checkout_created_at: a.p_checkout_created_at ?? null, switch_confirmed: !!a.p_switch_confirmed,
            checkout_paid_at: a.p_checkout_paid_at ?? null,
          }))
        }
        if (a.p_activate) sync(a.p_user_id)
        return 'ok'
      },
      billing_end_subscription: (a) => {
        const r = sub(a.p_id)
        if (!r) return { result: 'not_found' }
        const stopKind = a.p_stop === 'inactivate' ? 'inactivated' : 'deleted'
        if (r.status === 'canceled') {
          if (a.p_immediate && String(r.access_until ?? iso()) > iso()) { r.access_until = iso(); r.cancel_source = a.p_source; sync(r.user_id) }
          if (a.p_already_stopped) markStopped(r.id, stopKind)
          return { result: 'already_canceled', access_until: r.access_until, action_id: openStop(r.id)?.id ?? null }
        }
        const fromPaid = a.p_paid_due_date ? periodEnd(a.p_paid_due_date as string, r.cycle as string) : null
        const candidates = [r.paid_until as string | null, fromPaid].filter((x): x is string => !!x).sort()
        let access = a.p_immediate ? iso() : candidates[candidates.length - 1] ?? iso()
        if (access < iso()) access = iso()
        Object.assign(r, { status: 'canceled', cancel_source: a.p_source, access_until: access, canceled_at: iso() })
        let actionId: number | null = null
        if (r.kind === 'asaas') {
          if (a.p_source === 'asaas' || a.p_already_stopped) markStopped(r.id, stopKind)
          else if (!r.asaas_stopped_at) actionId = enqueue(r.id, a.p_stop === 'inactivate' ? 'inactivate_subscription' : 'delete_subscription', String(a.p_source))
        }
        // COB-R3: a nota pro admin na MESMA chamada do corte
        if (a.p_note != null) flag(r.id, a.p_note)
        sync(r.user_id)
        return { result: 'canceled', access_until: access, action_id: actionId }
      },
      billing_payment_overdue: (a) => {
        const r = sub(a.p_id)
        if (!r) return { result: 'not_found' }
        if (a.p_due_date && r.last_paid_due_date && String(r.last_paid_due_date) >= String(a.p_due_date)) return { result: 'ignored_paid' }
        if (r.status === 'canceled') return { result: 'already_canceled', action_id: openStop(r.id)?.id ?? null }
        Object.assign(r, { status: 'canceled', cancel_source: 'unpaid', access_until: iso() })
        // COB-R2: guarda a cobrança vencida desta decisão (a rede acha a do ciclo em billing_payments)
        const venc = a.p_payment_id ?? db.tables.billing_payments.find((b) => b.subscription_ref === r.id
          && ['PENDING', 'OVERDUE', 'AWAITING_RISK_ANALYSIS'].includes(String(b.status)) && (b.due_date === a.p_due_date || b.original_due_date === a.p_due_date))?.asaas_payment_id
        const actionId = r.kind === 'asaas' && !r.asaas_stopped_at
          ? enqueue(r.id, 'inactivate_subscription', String(a.p_reason ?? 'vencida'), { due_date: a.p_due_date, asaas_payment_id: venc ?? null })
          : null
        sync(r.user_id)
        return { result: 'canceled_unpaid', action_id: actionId }
      },
      billing_payment_refunded: (a) => {
        const r = sub(a.p_id)
        if (!r) return { result: 'not_found' }
        for (const x of db.tables.billing_pending_actions) if (x.subscription_ref === r.id && x.action === 'refund_payment' && x.status === 'pending') x.status = 'done'
        const actionId = r.asaas_stop_kind !== 'deleted' && r.cancel_source !== 'asaas' ? enqueue(r.id, 'delete_subscription', 'estorno') : null
        Object.assign(r, { status: 'canceled', cancel_source: r.status === 'canceled' ? r.cancel_source : 'refund', access_until: iso() })
        sync(r.user_id)
        return { result: 'refunded', action_id: actionId }
      },
      billing_payment_confirmed: (a) => {
        const r = sub(a.p_id)
        if (!r) return { result: 'not_found' }
        const due = a.p_due_date as string
        if (r.last_paid_due_date && due <= String(r.last_paid_due_date)) return { result: 'already_counted' }
        const end = periodEnd(due, r.cycle as string)
        Object.assign(r, { last_paid_due_date: due, paid_until: end })
        // como o SQL: o PAYMENT_CONFIRMED só traz o dia, gravado como meia-noite de Brasília (03:00 UTC)
        r.first_paid_at ??= `${String(a.p_paid_on ?? iso().slice(0, 10))}T03:00:00.000Z`
        if (r.status === 'active') { sync(r.user_id); return { result: 'extended', paid_until: end } }
        if (r.cancel_source === 'unpaid') {
          if (a.p_paid_on && String(a.p_paid_on) <= String(a.p_real_due ?? due) && !r.asaas_stopped_at) {
            Object.assign(r, { status: 'active', cancel_source: null, access_until: null })
            for (const x of db.tables.billing_pending_actions) if (x.subscription_ref === r.id && x.status === 'pending' && x.action === 'inactivate_subscription') x.status = 'canceled'
            flag(r.id, `corte desfeito: cobranca do vencimento ${due} paga em dia`)
            sync(r.user_id)
            return { result: 'reactivated' }
          }
          Object.assign(r, { access_until: end }); flag(r.id, `cobranca vencida paga depois (vencimento ${due}); sem renovacao`); sync(r.user_id)
          return { result: 'late_payment', access_until: end }
        }
        if (r.cancel_source === 'user' || r.cancel_source === 'asaas') {
          Object.assign(r, { access_until: end }); flag(r.id, `cobranca paga depois do cancelamento (vencimento ${due})`); sync(r.user_id)
          return { result: 'paid_after_cancel', access_until: end }
        }
        flag(r.id, `cobranca paga em assinatura encerrada (${String(r.cancel_source)}, vencimento ${due}): avaliar estorno`)
        return { result: 'flagged_closed' }
      },
      billing_enqueue_action: (a) => enqueue(a.p_ref, a.p_action as string, a.p_reason as string, {
        asaas_payment_id: a.p_payment_id ?? null, due_date: a.p_due_date ?? null, amount: a.p_amount ?? null, auto_retry: a.p_auto_retry ?? true,
        user_id: sub(a.p_ref)?.user_id ?? a.p_user_id ?? null,
      }),
      billing_undo_safety_cut: (a) => {
        const r = sub(a.p_id)
        if (!r || r.status !== 'canceled' || r.cancel_source !== 'unpaid' || r.asaas_stopped_at) return { result: 'not_applicable' }
        if (subs().some((o) => o.user_id === r.user_id && o.id !== r.id && o.kind === 'asaas' && o.status === 'active')) {
          flag(r.id, 'rede de seguranca: corte mantido porque ja existe outra assinatura paga ativa')
          return { result: 'refused_other_active' }
        }
        flag(r.id, `rede de seguranca desfeita: proxima cobranca real em ${String(a.p_real_due)}`)
        Object.assign(r, { status: 'active', cancel_source: null, access_until: null, next_due_date: a.p_real_due })
        for (const x of db.tables.billing_pending_actions) if (x.subscription_ref === r.id && x.status === 'pending' && x.action === 'inactivate_subscription') x.status = 'canceled'
        sync(r.user_id)
        return { result: 'undone' }
      },
      // COB-R2: a parada vale na hora; inativação concluída cria, na mesma
      // chamada, a pendência de remover as cobranças futuras (com a vencida
      // protegida) e devolve o id dela, mesmo se o aviso do Asaas já fechou a inativação.
      // COB-R1/R5: na rede, a cobrança do ciclo cortado já estava paga e contada:
      // corte indevido, desfaz e marca, nunca inativa (fecha a pendência).
      billing_undo_counted_cut: (a) => {
        const r = sub(a.p_id)
        if (!r) return { result: 'not_found' }
        for (const x of db.tables.billing_pending_actions) if (x.subscription_ref === r.id && x.status === 'pending' && x.action === 'inactivate_subscription') x.status = 'canceled'
        if (r.status !== 'canceled' || r.cancel_source !== 'unpaid' || !r.cycle || !r.last_paid_due_date) {
          flag(r.id, `rede de seguranca: cobranca do ciclo ${String(a.p_cut_due)} ja estava paga; nada desfeito e nada inativado, conferir`)
          return { result: 'not_applicable' }
        }
        const next = nextDueDate(String(r.last_paid_due_date), r.cycle as string)
        const end = periodEnd(String(r.last_paid_due_date), r.cycle as string)
        if (r.asaas_stopped_at) {
          if (!r.access_until || String(r.access_until) < end) r.access_until = end
          flag(r.id, `rede de seguranca: cobranca do ciclo ${String(a.p_cut_due)} ja estava paga (corte indevido); assinatura ja parada no Asaas, sem renovacao`)
          sync(r.user_id)
          return { result: 'restored_until_period_end', access_until: end }
        }
        Object.assign(r, { status: 'active', cancel_source: null, canceled_at: null, access_until: null, next_due_date: next })
        if (!r.paid_until || String(r.paid_until) < end) r.paid_until = end
        flag(r.id, `rede de seguranca desfeita: cobranca do ciclo ${String(a.p_cut_due)} ja estava paga (corte indevido); proximo vencimento ${next}`)
        sync(r.user_id)
        return { result: 'undone', next_due_date: next }
      },
      billing_action_done: (a) => {
        let x = db.tables.billing_pending_actions.find((y) => y.id === a.p_action_id && y.status === 'pending')
        if (x) x.status = 'done'
        else x = db.tables.billing_pending_actions.find((y) => y.id === a.p_action_id && y.status === 'done' && y.action === 'inactivate_subscription')
        if (!x) return null
        if (STOP_ACTIONS.includes(String(x.action))) markStopped(x.subscription_ref, x.action === 'delete_subscription' ? 'deleted' : 'inactivated', a.p_subscription_id)
        if (x.action !== 'inactivate_subscription') return null
        return enqueue(x.subscription_ref, 'delete_future_payments', String(x.reason), {
          asaas_payment_id: x.asaas_payment_id ?? null, due_date: x.due_date ?? null, asaas_subscription_id: sub(x.subscription_ref)?.asaas_subscription_id ?? null,
        })
      },
      billing_action_failed: (a) => {
        const x = db.tables.billing_pending_actions.find((y) => y.id === a.p_action_id && y.status === 'pending')
        if (x) { x.attempts = Number(x.attempts) + 1; x.last_error = a.p_error; x.next_attempt_at = new Date(now().getTime() + 600_000).toISOString() }
        return null
      },
      billing_mark_asaas_stopped: (a) => { markStopped(a.p_id, a.p_kind as string, a.p_subscription_id); return null },
      billing_flag_review: (a) => { flag(a.p_id, a.p_note); return null },
      billing_record_payment: (a) => {
        const rows = db.tables.billing_payments
        const ex = rows.find((x) => x.asaas_payment_id === a.p_payment_id)
        const rec = {
          asaas_payment_id: a.p_payment_id, user_id: a.p_user_id, subscription_ref: a.p_ref, asaas_subscription_id: a.p_subscription_id,
          asaas_checkout_id: a.p_checkout_id, asaas_customer_id: a.p_customer_id, status: a.p_status, billing_type: a.p_billing_type,
          value: a.p_value, net_value: a.p_net_value, original_value: a.p_original_value, interest_value: a.p_interest_value,
          due_date: a.p_due_date, original_due_date: a.p_original_due_date ?? a.p_due_date, payment_date: a.p_payment_date, confirmed_date: a.p_confirmed_date,
          last_event: a.p_event, last_event_at: a.p_event_at, refunded_at: a.p_event === 'PAYMENT_REFUNDED' ? iso() : (ex?.refunded_at ?? null),
        }
        if (!ex) { rows.push(rec); return 'recorded' }
        if (String(a.p_event_at) < String(ex.last_event_at)) return 'stale'
        Object.assign(ex, rec)
        return 'recorded'
      },
      billing_preview_access: (a) => {
        const r = sub(a.p_id)
        if (!r) return null
        const fromPaid = a.p_paid_due_date ? periodEnd(a.p_paid_due_date as string, r.cycle as string) : null
        return [r.paid_until as string | null, fromPaid].filter(Boolean).sort().pop() ?? null
      },
      billing_change_plan: (a) => {
        const r = sub(a.p_id)
        if (!r) return { result: 'not_found' }
        if (r.status !== 'active') return { result: 'not_active' }
        Object.assign(r, { plan_key: a.p_plan_key, cycle: a.p_cycle })
        sync(r.user_id)
        return { result: 'changed', plan_key: a.p_plan_key }
      },
      billing_grant_courtesy: (a) => {
        const id = `cortesia:${subs().length + 1}`
        subs().push(subRow({ id, kind: 'courtesy', user_id: a.p_user_id as string, plan_key: a.p_plan_key, cycle: null, access_until: a.p_until ?? null, started_at: iso() }))
        sync(a.p_user_id)
        return id
      },
      billing_daily_job: () => ({ cortadas_sem_pagamento: 0, planos_expirados: 0 }),
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

// COB-R8: prova EM TEMPO DE EXECUÇÃO de que um cenário do webhook nunca estorna
// nem passa pelo cancelamento do usuário. O Asaas falso registra toda chamada
// (vi.fn) e o banco falso registra RPCs e leituras. Devolve o que achou:
// * qualquer POST de estorno ao Asaas (caminho com "refund");
// * as marcas de cancelSubscriptionForUser: encerrar com motivo do usuário, do
//   admin ou da exclusão da conta; pedido de estorno (refund_payment); e as
//   pendências lidas por usuário, que é o primeiro passo dele (o webhook e o job
//   nunca filtram pendências por usuário).
export function forbiddenInWebhook(db: FakeDb, asaas: FakeAsaas | null): string[] {
  const out: string[] = []
  for (const [path] of (asaas?.post.mock.calls ?? []) as [string][]) {
    if (/refund/i.test(String(path))) out.push(`estorno no Asaas: POST ${path}`)
  }
  for (const c of db.rpcCalls) {
    if (c.name === 'billing_end_subscription' && ['user', 'user_refund', 'admin', 'account_deleted'].includes(String(c.args.p_source))) {
      out.push(`cancelamento do usuario: billing_end_subscription(${String(c.args.p_id)}, ${String(c.args.p_source)})`)
    }
    if (c.name === 'billing_enqueue_action' && c.args.p_action === 'refund_payment') out.push(`pedido de estorno: ${String(c.args.p_ref)}`)
  }
  for (const r of db.reads) {
    if (r.table === 'billing_pending_actions' && r.filters.some((f) => f.col === 'user_id')) out.push('pendencias lidas por usuario (cancelSubscriptionForUser)')
  }
  return out
}

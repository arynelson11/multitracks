import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRes, type FakeDb } from './fakeSupabase.js'
import { USER_A, asaasDown, createBillingDb, createFakeAsaas, payment, subRow, type FakeAsaas } from './billingHarness.js'

// Webhook do Asaas com Supabase e Asaas falsos. Cobre autenticidade, evento
// repetido e as regras do dono: vencida derruba no mesmo dia e cancela no
// Asaas, pagamento atrasado devolve o plano e marca pro admin, estorno volta
// pro Livre, todo pagamento fica guardado (sem dados do cartão).

const TOKEN = 'token-do-webhook-com-mais-de-32-caracteres-ok'
let db: FakeDb
let asaas: FakeAsaas | null
const createClient = vi.fn(() => db)

vi.mock('@supabase/supabase-js', () => ({ createClient: () => createClient() }))
vi.mock('../_lib/asaas.js', async (orig) => ({
  ...(await orig<typeof import('../_lib/asaas.js')>()),
  asaasFromEnv: () => asaas,
}))

async function post(body: Record<string, unknown>, token: string | null = TOKEN) {
  const { default: handler } = await import('../webhook/asaas.js')
  const res = createRes()
  const headers: Record<string, string> = {}
  if (token !== null) headers['asaas-access-token'] = token
  await handler({ method: 'POST', headers, body }, res)
  return res
}

const checkoutPaid = (id = 'evt_checkout_1') => ({
  id, event: 'CHECKOUT_PAID',
  checkout: { id: 'chk_1', status: 'PAID', customer: 'cus_1', subscription: { cycle: 'MONTHLY', nextDueDate: '2026-11-16T03:00:00+0000' } },
})

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-11-16T15:00:00Z'))
  vi.stubEnv('VITE_SUPABASE_URL', 'https://fake.supabase.co')
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'fake-service-role')
  vi.stubEnv('ASAAS_WEBHOOK_TOKEN', TOKEN)
  createClient.mockClear()
  asaas = createFakeAsaas()
  db = createBillingDb({
    profiles: [{ id: USER_A, plan: 'free', plan_expires_at: null }],
    pending_checkouts: [{ id: 'chk_1', user_id: USER_A, plan_key: 'essencial_mensal' }],
  })
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
})

describe('webhook do Asaas: autenticidade', () => {
  it('assinatura falsa (token errado) é rejeitada sem tocar no banco', async () => {
    const res = await post(checkoutPaid(), 'x'.repeat(TOKEN.length))
    expect(res.statusCode).toBe(401)
    expect(createClient).not.toHaveBeenCalled()
    expect(db.tables.profiles[0].plan).toBe('free')
  })

  it('sem token, ou com token de outro tamanho, também é rejeitado', async () => {
    expect((await post(checkoutPaid(), null)).statusCode).toBe(401)
    expect((await post(checkoutPaid(), 'curto')).statusCode).toBe(401)
    expect(createClient).not.toHaveBeenCalled()
  })
})

describe('webhook do Asaas: CHECKOUT_PAID', () => {
  it('ativa o plano, guarda o vínculo da assinatura e mantém pending_checkouts', async () => {
    const res = await post(checkoutPaid())
    expect(res.statusCode).toBe(200)
    expect(db.tables.profiles[0].plan).toBe('essencial_mensal')
    const upsert = db.rpcCalls.find((c) => c.name === 'billing_upsert_subscription')!
    expect(upsert.args).toMatchObject({ p_id: 'chk_1', p_user_id: USER_A, p_plan_key: 'essencial_mensal', p_cycle: 'MONTHLY', p_customer_id: 'cus_1', p_paid_due_date: '2026-11-16', p_activate: true })
    expect(db.tables.pending_checkouts).toHaveLength(1)
    expect(db.tables.payments[0]).toMatchObject({ id: 'chk_1', value: 49.9, cycle: 'MONTHLY' })
    // confere (e religa se preciso) os avisos de vencimento do próprio Asaas
    expect(asaas!.get).toHaveBeenCalledWith('/customers/cus_1/notifications')
  })

  it('webhook repetido (mesmo id de evento) é processado uma vez só', async () => {
    const a = await post(checkoutPaid('evt_dup'))
    const b = await post(checkoutPaid('evt_dup'))
    expect([a.statusCode, b.statusCode]).toEqual([200, 200])
    expect(b.body).toMatchObject({ duplicate: true })
    expect(db.rpcCalls.filter((c) => c.name === 'billing_upsert_subscription')).toHaveLength(1)
    expect(db.tables.asaas_webhook_events[0]).toMatchObject({ id: 'evt_dup', event: 'CHECKOUT_PAID' })
    expect(db.tables.asaas_webhook_events[0].processed_at).toBeTruthy()
  })

  it('mesmo CHECKOUT_PAID com id novo (reenvio sem id igual) continua idempotente', async () => {
    await post(checkoutPaid('evt_1'))
    await post(checkoutPaid('evt_2'))
    expect(db.tables.billing_subscriptions).toHaveLength(1)
    expect(db.tables.payments).toHaveLength(1)
    expect(db.tables.profiles[0].plan).toBe('essencial_mensal')
  })

  it('evento que falhou no meio é reprocessado quando o Asaas reenvia', async () => {
    db.failTable('payments', { message: 'timeout' })
    db.failTable('pending_checkouts', { message: 'timeout' })
    expect((await post(checkoutPaid('evt_retry'))).statusCode).toBe(500)
    db = createBillingDb({
      profiles: [{ id: USER_A, plan: 'free' }],
      pending_checkouts: [{ id: 'chk_1', user_id: USER_A, plan_key: 'essencial_mensal' }],
      asaas_webhook_events: [{ id: 'evt_retry', event: 'CHECKOUT_PAID', processed_at: null }],
    })
    const res = await post(checkoutPaid('evt_retry'))
    expect(res.statusCode).toBe(200)
    expect(res.body).not.toMatchObject({ duplicate: true })
    expect(db.tables.profiles[0].plan).toBe('essencial_mensal')
  })

  it('compra de um plano novo encerra a assinatura anterior no Asaas (não cobra duas vezes)', async () => {
    db.tables.billing_subscriptions.push(subRow({ id: 'chk_old', user_id: USER_A, asaas_subscription_id: 'sub_old', created_at: '2026-10-01T00:00:00Z' }))
    db.tables.pending_checkouts.push({ id: 'chk_new', user_id: USER_A, plan_key: 'pro_mensal' })
    const res = await post({ id: 'evt_new', event: 'CHECKOUT_PAID', checkout: { id: 'chk_new', customer: 'cus_1' } })
    expect(res.statusCode).toBe(200)
    const end = db.rpcCalls.find((c) => c.name === 'billing_end_subscription')!
    expect(end.args).toMatchObject({ p_id: 'chk_old', p_source: 'superseded', p_immediate: true })
    expect(asaas!.del).toHaveBeenCalledWith('/subscriptions/sub_old')
    expect(db.tables.billing_subscriptions.find((r) => r.id === 'chk_old')!.asaas_deleted_at).toBeTruthy()
  })
})

describe('webhook do Asaas: assinatura e cobranças', () => {
  beforeEach(() => {
    db.tables.profiles[0].plan = 'essencial_mensal'
    db.tables.billing_subscriptions.push(subRow({ id: 'chk_1', user_id: USER_A, asaas_subscription_id: 'sub_1', paid_until: '2026-12-17T03:00:00.000Z' }))
  })

  it('renovação vencida: volta pro Livre no mesmo dia e cancela a assinatura no Asaas', async () => {
    const res = await post({ id: 'evt_o1', event: 'PAYMENT_OVERDUE', payment: payment({ id: 'pay_2', status: 'OVERDUE', dueDate: '2026-12-16', confirmedDate: null }) })
    expect(res.statusCode).toBe(200)
    expect(db.rpcCalls.find((c) => c.name === 'billing_payment_overdue')!.args).toEqual({ p_id: 'chk_1', p_due_date: '2026-12-16' })
    expect(db.tables.profiles[0].plan).toBe('free')
    expect(asaas!.del).toHaveBeenCalledWith('/subscriptions/sub_1')
    expect(db.tables.billing_subscriptions[0].asaas_deleted_at).toBeTruthy()
    expect(db.tables.billing_payments[0]).toMatchObject({ asaas_payment_id: 'pay_2', status: 'OVERDUE', last_event: 'PAYMENT_OVERDUE', due_date: '2026-12-16' })
  })

  it('renovação vencida com o Asaas fora do ar: o corte vale e o webhook pede reenvio (500)', async () => {
    asaas!.del.mockRejectedValue(asaasDown())
    const res = await post({ id: 'evt_o2', event: 'PAYMENT_OVERDUE', payment: payment({ status: 'OVERDUE', dueDate: '2026-12-16' }) })
    expect(res.statusCode).toBe(500)
    expect(db.tables.profiles[0].plan).toBe('free')
    expect(db.tables.billing_subscriptions[0].asaas_deleted_at).toBeNull()
    // reenvio com o Asaas de volta termina o cancelamento
    asaas!.del.mockResolvedValue({ deleted: true })
    expect((await post({ id: 'evt_o2', event: 'PAYMENT_OVERDUE', payment: payment({ status: 'OVERDUE', dueDate: '2026-12-16' }) })).statusCode).toBe(200)
    expect(db.tables.billing_subscriptions[0].asaas_deleted_at).toBeTruthy()
  })

  it('pagamento atrasado depois do corte: plano volta até o fim daquele período e fica marcado pro admin', async () => {
    await post({ id: 'evt_o3', event: 'PAYMENT_OVERDUE', payment: payment({ status: 'OVERDUE', dueDate: '2026-12-16' }) })
    const res = await post({ id: 'evt_c3', event: 'PAYMENT_RECEIVED', payment: payment({ status: 'RECEIVED', dueDate: '2026-12-16', billingType: 'PIX', paymentDate: '2026-12-18' }) })
    expect(res.statusCode).toBe(200)
    expect(res.body).toMatchObject({ result: 'late_after_cancel' })
    expect(db.tables.billing_subscriptions[0].needs_admin_review).toBe(true)
  })

  it('guarda todo pagamento com o valor que o Asaas mandou e nunca os dados do cartão', async () => {
    await post({ id: 'evt_c4', event: 'PAYMENT_CONFIRMED', payment: payment({ id: 'pay_9', dueDate: '2026-12-16', value: 49.9, netValue: 47.91 }) })
    const row = db.tables.billing_payments.find((r) => r.asaas_payment_id === 'pay_9')!
    expect(row).toMatchObject({ user_id: USER_A, value: 49.9, net_value: 47.91, status: 'CONFIRMED', asaas_subscription_id: 'sub_1' })
    expect(JSON.stringify(db.tables.billing_payments)).not.toContain('tok-nao-guardar')
    expect(JSON.stringify(db.tables.billing_payments)).not.toContain('8829')
  })

  it('estorno do período atual: Livre na hora e assinatura cancelada no Asaas', async () => {
    const res = await post({ id: 'evt_r1', event: 'PAYMENT_REFUNDED', payment: payment({ status: 'REFUNDED', dueDate: '2026-11-16' }) })
    expect(res.statusCode).toBe(200)
    expect(db.tables.profiles[0].plan).toBe('free')
    expect(asaas!.del).toHaveBeenCalledWith('/subscriptions/sub_1')
    expect(db.tables.billing_payments[0].refunded_at).toBeTruthy()
  })

  it('assinatura removida pelo painel do Asaas: plano até o fim do período pago', async () => {
    const res = await post({ id: 'evt_s1', event: 'SUBSCRIPTION_DELETED', subscription: { id: 'sub_1', customer: 'cus_1', status: 'ACTIVE', deleted: true } })
    expect(res.statusCode).toBe(200)
    expect(db.rpcCalls.find((c) => c.name === 'billing_end_subscription')!.args).toMatchObject({ p_id: 'chk_1', p_source: 'asaas', p_immediate: false })
    expect(db.tables.profiles[0]).toMatchObject({ plan: 'essencial_mensal', plan_expires_at: '2026-12-17T03:00:00.000Z' })
    expect(asaas!.del).not.toHaveBeenCalled()
  })

  it('SUBSCRIPTION_DELETED do nosso próprio cancelamento só confirma a remoção', async () => {
    Object.assign(db.tables.billing_subscriptions[0], { status: 'canceled', cancel_source: 'user', access_until: '2026-12-17T03:00:00.000Z' })
    const res = await post({ id: 'evt_s2', event: 'SUBSCRIPTION_DELETED', subscription: { id: 'sub_1', deleted: true } })
    expect(res.body).toMatchObject({ result: 'already_canceled' })
    expect(db.rpcCalls.some((c) => c.name === 'billing_end_subscription')).toBe(false)
    expect(db.tables.billing_subscriptions[0].asaas_deleted_at).toBeTruthy()
  })

  it('assinatura sem dono conhecido não trava a fila (200)', async () => {
    asaas!.get.mockResolvedValue({ id: 'sub_x', checkoutSession: null })
    const res = await post({ id: 'evt_s3', event: 'SUBSCRIPTION_DELETED', subscription: { id: 'sub_x' } })
    expect(res.statusCode).toBe(200)
    expect(res.body).toMatchObject({ result: 'unresolved' })
  })

  it('cobrança avulsa (fora de assinatura) é ignorada e não é guardada', async () => {
    const res = await post({ id: 'evt_p1', event: 'PAYMENT_RECEIVED', payment: payment({ subscription: null, checkoutSession: null }) })
    expect(res.body).toMatchObject({ result: 'not_subscription' })
    expect(db.tables.billing_payments).toHaveLength(0)
  })

  it('evento que não interessa (CHECKOUT_CREATED) responde 200 sem abrir o banco', async () => {
    const res = await post({ id: 'evt_x', event: 'CHECKOUT_CREATED', checkout: { id: 'chk_9' } })
    expect(res.statusCode).toBe(200)
    expect(createClient).not.toHaveBeenCalled()
  })
})

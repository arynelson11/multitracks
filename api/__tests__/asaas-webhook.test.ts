import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRes, type FakeDb } from './fakeSupabase.js'
import { USER_A, asaasDown, asaasRejected, createBillingDb, createFakeAsaas, payment, subRow, type FakeAsaas } from './billingHarness.js'

// Webhook do Asaas com Supabase e Asaas falsos: autenticidade, evento gravado
// antes de processar (200 mesmo com o Asaas fora; 500 só se não gravar),
// idempotência, e as regras de cobrança da rodada 1 da revisão.

const TOKEN = 'token-do-webhook-com-mais-de-32-caracteres-ok'
const CRON = 'segredo-do-cron-com-tamanho-bom-1234567890'
let db: FakeDb
let asaas: FakeAsaas | null
const createClient = vi.fn(() => db)

vi.mock('@supabase/supabase-js', () => ({ createClient: () => createClient() }))
vi.mock('../_lib/asaas.js', async (orig) => ({
  ...(await orig<typeof import('../_lib/asaas.js')>()),
  asaasFromEnv: () => asaas,
}))

async function call(method: string, body: Record<string, unknown>, headers: Record<string, string>) {
  const { default: handler } = await import('../webhook/asaas.js')
  const res = createRes()
  await handler({ method, headers, body }, res)
  return res
}
const post = (body: Record<string, unknown>, token: string | null = TOKEN) =>
  call('POST', body, token === null ? {} : { 'asaas-access-token': token })
const cron = (secret = CRON) => call('GET', {}, { authorization: `Bearer ${secret}` })

const checkoutPaid = (id = 'evt_checkout_1') => ({
  id, event: 'CHECKOUT_PAID', dateCreated: '2026-11-16 12:00:00',
  checkout: { id: 'chk_1', status: 'PAID', customer: 'cus_1', subscription: { cycle: 'MONTHLY', nextDueDate: '2026-11-16T03:00:00+0000' } },
})
const payEvent = (id: string, event: string, p: Record<string, unknown>, when = '2026-12-16 12:00:00') => ({ id, event, dateCreated: when, payment: payment(p) })
const stopCalls = () => (asaas!.put.mock.calls as [string, unknown][]).filter(([path]) => path.startsWith('/subscriptions/'))

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-11-16T15:00:00Z'))
  vi.stubEnv('VITE_SUPABASE_URL', 'https://fake.supabase.co')
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'fake-service-role')
  vi.stubEnv('ASAAS_WEBHOOK_TOKEN', TOKEN)
  vi.stubEnv('CRON_SECRET', CRON)
  createClient.mockClear()
  asaas = createFakeAsaas()
  db = createBillingDb({
    profiles: [{ id: USER_A, plan: 'free', plan_expires_at: null }],
    pending_checkouts: [{ id: 'chk_1', user_id: USER_A, plan_key: 'essencial_mensal' }],
  }, () => new Date())
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
})

describe('autenticidade', () => {
  it('assinatura falsa (token errado) é rejeitada sem tocar no banco', async () => {
    const res = await post(checkoutPaid(), 'x'.repeat(TOKEN.length))
    expect(res.statusCode).toBe(401)
    expect(createClient).not.toHaveBeenCalled()
  })

  it('sem token, ou com token de outro tamanho, também é rejeitado', async () => {
    expect((await post(checkoutPaid(), null)).statusCode).toBe(401)
    expect((await post(checkoutPaid(), 'curto')).statusCode).toBe(401)
    expect(createClient).not.toHaveBeenCalled()
  })

  it('job diário sem o segredo do cron: 401', async () => {
    expect((await cron('errado-errado-errado-errado-errado-errado')).statusCode).toBe(401)
    expect(createClient).not.toHaveBeenCalled()
  })
})

describe('evento gravado antes de processar (I5)', () => {
  it('grava o evento sem dados do cartão e marca como processado', async () => {
    db.tables.billing_subscriptions.push(subRow({ id: 'chk_1', user_id: USER_A, asaas_subscription_id: 'sub_1', last_paid_due_date: '2026-11-16' }))
    const res = await post(payEvent('evt_p1', 'PAYMENT_CONFIRMED', { id: 'pay_2', dueDate: '2026-12-16', confirmedDate: '2026-12-16' }))
    expect(res.statusCode).toBe(200)
    const ev = db.tables.asaas_webhook_events[0]
    expect(ev).toMatchObject({ id: 'evt_p1', event: 'PAYMENT_CONFIRMED', status: 'done' })
    expect(JSON.stringify(ev.payload)).not.toContain('tok-nao-guardar')
    expect(JSON.stringify(ev.payload)).not.toContain('creditCard')
  })

  it('Asaas fora do ar no processamento: responde 200, o evento fica pra nova tentativa e o job termina', async () => {
    // assinatura sem vínculo e sem checkout no payload: precisa consultar o Asaas
    asaas!.get.mockRejectedValue(asaasDown())
    const body = { id: 'evt_s9', event: 'SUBSCRIPTION_DELETED', subscription: { id: 'sub_9', deleted: true } }
    const res = await post(body)
    expect(res.statusCode).toBe(200)
    expect(res.body).toMatchObject({ received: true, processed: false })
    expect(db.tables.asaas_webhook_events[0]).toMatchObject({ status: 'failed', attempts: 1 })
    // job diário reprocessa (o evento tem mais de 2 minutos)
    asaas!.get.mockResolvedValue({ id: 'sub_9', checkoutSession: null })
    vi.setSystemTime(new Date('2026-11-17T09:00:00Z'))
    db.tables.asaas_webhook_events[0].received_at = '2026-11-16T15:00:00.000Z'
    const job = await cron()
    expect(job.statusCode).toBe(200)
    expect(db.tables.asaas_webhook_events[0].status).toBe('done')
  })

  it('só responde 500 quando não consegue gravar o evento (aí o Asaas reenvia)', async () => {
    db.failTable('asaas_webhook_events', { message: 'connection refused' })
    expect((await post(checkoutPaid())).statusCode).toBe(500)
  })

  it('webhook repetido (mesmo id) é processado uma vez só', async () => {
    const a = await post(checkoutPaid('evt_dup'))
    const b = await post(checkoutPaid('evt_dup'))
    expect([a.statusCode, b.statusCode]).toEqual([200, 200])
    expect(b.body).toMatchObject({ duplicate: true })
    expect(db.rpcCalls.filter((c) => c.name === 'billing_upsert_subscription')).toHaveLength(1)
  })

  it('evento que falhou e chega de novo é reprocessado', async () => {
    db.tables.asaas_webhook_events.push({ id: 'evt_retry', event: 'CHECKOUT_PAID', status: 'failed', attempts: 1 })
    const res = await post(checkoutPaid('evt_retry'))
    expect(res.body).toMatchObject({ processed: true })
    expect(db.tables.profiles[0].plan).toBe('essencial_mensal')
  })
})

describe('CHECKOUT_PAID', () => {
  it('ativa o plano, guarda o vínculo e mantém pending_checkouts', async () => {
    const res = await post(checkoutPaid())
    expect(res.statusCode).toBe(200)
    expect(db.tables.profiles[0].plan).toBe('essencial_mensal')
    expect(db.rpcCalls.find((c) => c.name === 'billing_upsert_subscription')!.args).toMatchObject({
      p_id: 'chk_1', p_user_id: USER_A, p_plan_key: 'essencial_mensal', p_cycle: 'MONTHLY', p_customer_id: 'cus_1', p_paid_due_date: '2026-11-16', p_activate: true,
    })
    expect(db.tables.pending_checkouts).toHaveLength(1)
    expect(asaas!.get).toHaveBeenCalledWith('/customers/cus_1/notifications')
  })

  it('C1: assinante de antes desta versão que troca de plano tem a assinatura antiga adotada e encerrada', async () => {
    // pagou o Pro em agosto (sem linha em billing_subscriptions), agora paga o Studio
    db.tables.payments.push({ id: 'chk_old', user_id: USER_A, plan_key: 'essencial_mensal', asaas_checkout_id: 'chk_old', paid_at: '2026-08-01T12:00:00Z' })
    db.tables.profiles[0].plan = 'essencial_mensal'
    db.tables.pending_checkouts.push({ id: 'chk_new', user_id: USER_A, plan_key: 'pro_mensal' })
    asaas!.get.mockImplementation(async (path: string, params?: Record<string, unknown>) => {
      if (path === '/payments' && params?.checkoutSession === 'chk_old') return { data: [payment({ id: 'p_old', subscription: 'sub_old' })] }
      if (path === '/subscriptions/sub_old') return { id: 'sub_old', status: 'ACTIVE', customer: 'cus_1', checkoutSession: 'chk_old' }
      return { data: [] }
    })
    const res = await post({ id: 'evt_new', event: 'CHECKOUT_PAID', checkout: { id: 'chk_new', customer: 'cus_1' } })
    expect(res.statusCode).toBe(200)
    const old = db.tables.billing_subscriptions.find((r) => r.id === 'chk_old')!
    expect(old).toMatchObject({ started_at: '2026-08-01T12:00:00Z', status: 'canceled', cancel_source: 'superseded' })
    expect(asaas!.del).toHaveBeenCalledWith('/subscriptions/sub_old')
    expect(db.tables.profiles[0].plan).toBe('pro_mensal')
    // a renovação da antiga chega depois: nunca devolve o Pro (I2), só avisa o admin
    const late = await post(payEvent('evt_old_ren', 'PAYMENT_CONFIRMED', { id: 'p_old2', subscription: 'sub_old', dueDate: '2026-12-01', confirmedDate: '2026-12-01' }))
    expect(late.body).toMatchObject({ result: 'flagged_closed' })
    expect(db.tables.profiles[0].plan).toBe('pro_mensal')
  })

  it('troca de plano com o Asaas fora do ar: a remoção da antiga vira pendência e o próximo webhook tenta de novo (I1)', async () => {
    db.tables.billing_subscriptions.push(subRow({ id: 'chk_old', user_id: USER_A, asaas_subscription_id: 'sub_old', started_at: '2026-10-01T00:00:00Z' }))
    db.tables.pending_checkouts.push({ id: 'chk_new', user_id: USER_A, plan_key: 'pro_mensal' })
    asaas!.del.mockRejectedValue(asaasDown())
    const res = await post({ id: 'evt_new', event: 'CHECKOUT_PAID', checkout: { id: 'chk_new', customer: 'cus_1' } })
    expect(res.statusCode).toBe(200)
    expect(db.tables.profiles[0].plan).toBe('pro_mensal')
    const pend = db.tables.billing_pending_actions[0]
    expect(pend).toMatchObject({ subscription_ref: 'chk_old', action: 'delete_subscription', status: 'pending', attempts: 1 })
    // Asaas volta; o próximo webhook (qualquer um) termina a pendência vencida
    asaas!.del.mockResolvedValue({ deleted: true })
    pend.next_attempt_at = '2026-11-16T14:00:00.000Z'
    await post({ id: 'evt_outro', event: 'PAYMENT_CREATED', payment: payment({ subscription: null, checkoutSession: null }) })
    expect(db.tables.billing_pending_actions[0].status).toBe('done')
    expect(db.tables.billing_subscriptions.find((r) => r.id === 'chk_old')!.asaas_stopped_at).toBeTruthy()
  })

  it('CHECKOUT_PAID antigo reprocessado não encerra a assinatura mais nova', async () => {
    db.tables.billing_subscriptions.push(
      subRow({ id: 'chk_1', user_id: USER_A, status: 'canceled', cancel_source: 'superseded', started_at: '2026-10-01T00:00:00Z' }),
      subRow({ id: 'chk_new', user_id: USER_A, plan_key: 'pro_mensal', asaas_subscription_id: 'sub_new', started_at: '2026-11-10T00:00:00Z' }),
    )
    await post(checkoutPaid('evt_old_replay'))
    expect(db.rpcCalls.some((c) => c.name === 'billing_end_subscription')).toBe(false)
    expect(asaas!.del).not.toHaveBeenCalled()
  })
})

describe('assinatura e cobranças', () => {
  beforeEach(() => {
    db.tables.profiles[0].plan = 'essencial_mensal'
    db.tables.billing_subscriptions.push(subRow({ id: 'chk_1', user_id: USER_A, asaas_subscription_id: 'sub_1', last_paid_due_date: '2026-11-16', paid_until: '2026-12-17T03:00:00.000Z' }))
  })

  it('I2: linha do tempo do cartão. CONFIRMED estende; RECEIVED da liquidação ~30 dias depois não é pagamento atrasado', async () => {
    const c = await post(payEvent('evt_c', 'PAYMENT_CONFIRMED', { id: 'pay_2', dueDate: '2026-12-16', confirmedDate: '2026-12-16', status: 'CONFIRMED' }))
    expect(c.body).toMatchObject({ result: 'extended' })
    // usuário cancela depois; a liquidação do cartão chega 32 dias depois do CONFIRMED
    Object.assign(db.tables.billing_subscriptions[0], { status: 'canceled', cancel_source: 'admin', access_until: '2026-12-20T00:00:00.000Z' })
    vi.setSystemTime(new Date('2027-01-17T15:00:00Z'))
    const r = await post(payEvent('evt_r', 'PAYMENT_RECEIVED', { id: 'pay_2', dueDate: '2026-12-16', confirmedDate: '2026-12-16', paymentDate: '2027-01-17', status: 'RECEIVED' }, '2027-01-17 12:00:00'))
    expect(r.body).toMatchObject({ result: 'already_counted' })
    expect(db.tables.billing_subscriptions[0].needs_admin_review).toBe(false)
  })

  it('I3: renovação vencida corta no mesmo dia e INATIVA a assinatura no Asaas (não remove)', async () => {
    const res = await post(payEvent('evt_o1', 'PAYMENT_OVERDUE', { id: 'pay_2', status: 'OVERDUE', dueDate: '2026-12-16', confirmedDate: null }))
    expect(res.body).toMatchObject({ result: 'canceled_unpaid' })
    expect(db.tables.profiles[0].plan).toBe('free')
    expect(stopCalls()).toEqual([['/subscriptions/sub_1', { status: 'INACTIVE' }]])
    expect(asaas!.del).not.toHaveBeenCalled()
    expect(db.tables.billing_subscriptions[0]).toMatchObject({ asaas_stop_kind: 'inactivated' })
  })

  it('vencida com o Asaas fora do ar: o corte vale, responde 200 e a inativação fica pendente', async () => {
    asaas!.put.mockRejectedValue(asaasDown())
    const res = await post(payEvent('evt_o2', 'PAYMENT_OVERDUE', { status: 'OVERDUE', dueDate: '2026-12-16' }))
    expect(res.statusCode).toBe(200)
    expect(db.tables.profiles[0].plan).toBe('free')
    expect(db.tables.billing_pending_actions[0]).toMatchObject({ action: 'inactivate_subscription', status: 'pending', attempts: 1 })
    // job diário termina
    asaas!.put.mockResolvedValue({})
    db.tables.billing_pending_actions[0].next_attempt_at = '2026-11-16T00:00:00.000Z'
    expect((await cron()).statusCode).toBe(200)
    expect(db.tables.billing_pending_actions[0].status).toBe('done')
  })

  it('vencida paga com atraso: plano volta até o fim daquele período e fica marcado pro admin', async () => {
    await post(payEvent('evt_o3', 'PAYMENT_OVERDUE', { status: 'OVERDUE', dueDate: '2026-12-16' }))
    const res = await post(payEvent('evt_c3', 'PAYMENT_RECEIVED', { status: 'RECEIVED', dueDate: '2026-12-16', billingType: 'PIX', confirmedDate: '2026-12-18', paymentDate: '2026-12-18' }, '2026-12-18 10:00:00'))
    expect(res.body).toMatchObject({ result: 'late_payment' })
    expect(db.tables.billing_subscriptions[0].needs_admin_review).toBe(true)
  })

  it('guarda todo pagamento com o valor do Asaas e nunca os dados do cartão', async () => {
    await post(payEvent('evt_c4', 'PAYMENT_CONFIRMED', { id: 'pay_9', dueDate: '2026-12-16', value: 49.9, netValue: 47.91 }))
    const row = db.tables.billing_payments.find((r) => r.asaas_payment_id === 'pay_9')!
    expect(row).toMatchObject({ user_id: USER_A, value: 49.9, net_value: 47.91, status: 'CONFIRMED', asaas_subscription_id: 'sub_1' })
    expect(JSON.stringify(db.tables.billing_payments)).not.toContain('tok-nao-guardar')
  })

  it('estorno do período atual: Livre na hora e assinatura removida no Asaas', async () => {
    const res = await post(payEvent('evt_r1', 'PAYMENT_REFUNDED', { status: 'REFUNDED', dueDate: '2026-11-16' }))
    expect(res.body).toMatchObject({ result: 'refunded' })
    expect(db.tables.profiles[0].plan).toBe('free')
    expect(asaas!.del).toHaveBeenCalledWith('/subscriptions/sub_1')
  })

  it('assinatura removida pelo painel: plano até o fim do período pago', async () => {
    await post({ id: 'evt_s1', event: 'SUBSCRIPTION_DELETED', subscription: { id: 'sub_1', deleted: true } })
    expect(db.rpcCalls.find((c) => c.name === 'billing_end_subscription')!.args).toMatchObject({ p_id: 'chk_1', p_source: 'asaas', p_already_stopped: true })
    expect(db.tables.profiles[0]).toMatchObject({ plan: 'essencial_mensal', plan_expires_at: '2026-12-17T03:00:00.000Z' })
    expect(asaas!.del).not.toHaveBeenCalled()
  })

  it('SUBSCRIPTION_INACTIVATED do nosso próprio corte só confirma e fecha a pendência', async () => {
    asaas!.put.mockRejectedValue(asaasDown())
    await post(payEvent('evt_o4', 'PAYMENT_OVERDUE', { status: 'OVERDUE', dueDate: '2026-12-16' }))
    const res = await post({ id: 'evt_s2', event: 'SUBSCRIPTION_INACTIVATED', subscription: { id: 'sub_1', status: 'INACTIVE' } })
    expect(res.body).toMatchObject({ result: 'already_canceled' })
    expect(db.tables.billing_pending_actions[0].status).toBe('done')
    expect(db.tables.billing_subscriptions[0].asaas_stopped_at).toBeTruthy()
  })

  it('assinatura sem dono conhecido não trava a fila (200)', async () => {
    asaas!.get.mockResolvedValue({ id: 'sub_x', checkoutSession: null })
    const res = await post({ id: 'evt_s3', event: 'SUBSCRIPTION_DELETED', subscription: { id: 'sub_x' } })
    expect(res.statusCode).toBe(200)
    expect(res.body).toMatchObject({ result: 'unresolved' })
  })

  it('cobrança avulsa (fora de assinatura) é ignorada e não é guardada', async () => {
    const res = await post(payEvent('evt_p1', 'PAYMENT_RECEIVED', { subscription: null, checkoutSession: null }))
    expect(res.body).toMatchObject({ result: 'not_subscription' })
    expect(db.tables.billing_payments).toHaveLength(0)
  })

  it('evento que não interessa (CHECKOUT_CREATED) responde 200 sem abrir o banco', async () => {
    const res = await post({ id: 'evt_x', event: 'CHECKOUT_CREATED', checkout: { id: 'chk_9' } })
    expect(res.statusCode).toBe(200)
    expect(createClient).not.toHaveBeenCalled()
  })
})

describe('job diário (I6/I10)', () => {
  it('roda o job do banco, os eventos que falharam e as pendências', async () => {
    const res = await cron()
    expect(res.statusCode).toBe(200)
    expect(db.rpcCalls[0].name).toBe('billing_daily_job')
    expect(res.body).toMatchObject({ ok: true, events: { done: 0, failed: 0 }, pending: { done: 0, failed: 0 } })
  })

  it('rede de segurança: antes de inativar, confere no Asaas; se a cobrança foi paga, desfaz o corte', async () => {
    db.tables.billing_subscriptions.push(subRow({ id: 'chk_7', user_id: USER_A, asaas_subscription_id: 'sub_7', status: 'canceled', cancel_source: 'unpaid', last_paid_due_date: '2026-10-14' }))
    db.tables.billing_pending_actions.push({
      id: 99, subscription_ref: 'chk_7', user_id: USER_A, action: 'inactivate_subscription', reason: 'rede_de_seguranca',
      asaas_subscription_id: 'sub_7', due_date: '2026-11-14', auto_retry: true, status: 'pending', attempts: 0, next_attempt_at: '2026-11-16T00:00:00.000Z',
    })
    asaas!.get.mockResolvedValue({ data: [payment({ id: 'p7', subscription: 'sub_7', dueDate: '2026-11-14', confirmedDate: '2026-11-14', status: 'CONFIRMED' })], hasMore: false })
    await cron()
    expect(stopCalls()).toEqual([])
    expect(db.tables.billing_subscriptions.find((r) => r.id === 'chk_7')!.status).toBe('active')
    expect(db.tables.billing_pending_actions.find((a) => a.id === 99)!.status).toBe('canceled')
  })
})

describe('rodada 2: compra duplicada (I7)', () => {
  const twoTabs = (planB: string) => {
    db.tables.pending_checkouts.push({ id: 'chk_b', user_id: USER_A, plan_key: planB })
  }
  const paidAt = (id: string, when: string) => ({ id: `evt_${id}`, event: 'CHECKOUT_PAID', dateCreated: when, checkout: { id, customer: 'cus_1' } })

  it('duas abas no Livre, mesmo plano: fica a primeira, a segunda é cancelada e estornada, e o admin é avisado', async () => {
    twoTabs('essencial_mensal')
    asaas!.get.mockImplementation(async (path: string, params?: Record<string, unknown>) =>
      path === '/payments' && params?.checkoutSession === 'chk_b' ? { data: [payment({ id: 'pay_b', subscription: 'sub_b', status: 'CONFIRMED', value: 49.9 })] } : { data: [] })
    await post(paidAt('chk_1', '2026-11-16 12:00:00'))
    const res = await post(paidAt('chk_b', '2026-11-16 12:00:40'))
    expect(res.body).toMatchObject({ result: 'duplicate' })
    expect(db.tables.billing_subscriptions.find((r) => r.id === 'chk_1')!.status).toBe('active')
    const dup = db.tables.billing_subscriptions.find((r) => r.id === 'chk_b')!
    expect(dup).toMatchObject({ status: 'canceled', cancel_source: 'duplicate', needs_admin_review: true })
    expect(String(dup.admin_note)).toContain('compra duplicada estornada')
    expect(asaas!.post).toHaveBeenCalledWith('/payments/pay_b/refund', expect.any(Object))
    expect(db.tables.profiles[0].plan).toBe('essencial_mensal')
    expect(db.tables.billing_pending_actions.find((a) => a.subscription_ref === 'chk_b' && a.action === 'delete_subscription')).toBeTruthy()
  })

  it('mesmo plano com o estorno recusado: vira pedido pro admin', async () => {
    twoTabs('essencial_mensal')
    asaas!.get.mockImplementation(async (path: string, params?: Record<string, unknown>) =>
      path === '/payments' && params?.checkoutSession === 'chk_b' ? { data: [payment({ id: 'pay_b', status: 'CONFIRMED' })] } : { data: [] })
    asaas!.post.mockRejectedValue(asaasRejected('saldo insuficiente'))
    await post(paidAt('chk_1', '2026-11-16 12:00:00'))
    await post(paidAt('chk_b', '2026-11-16 12:00:40'))
    expect(db.tables.billing_pending_actions.find((a) => a.action === 'refund_payment')).toMatchObject({ subscription_ref: 'chk_b', reason: 'compra_duplicada', asaas_payment_id: 'pay_b', auto_retry: false })
    expect(String(db.tables.billing_subscriptions.find((r) => r.id === 'chk_b')!.admin_note)).toContain('estorno pendente pro admin')
  })

  it('a ordem vem da hora do pagamento: o aviso da segunda chegando antes não derruba a primeira', async () => {
    twoTabs('essencial_mensal')
    await post(paidAt('chk_b', '2026-11-16 12:00:40'))
    await post(paidAt('chk_1', '2026-11-16 12:00:00'))
    expect(db.tables.billing_subscriptions.find((r) => r.id === 'chk_1')!.status).toBe('active')
    expect(db.tables.billing_subscriptions.find((r) => r.id === 'chk_b')!.cancel_source).toBe('duplicate')
  })

  it('plano diferente fora do Alterar Plano: fica a nova e o admin recebe o valor do período antigo', async () => {
    twoTabs('pro_mensal')
    await post(paidAt('chk_1', '2026-11-16 12:00:00'))
    await post(paidAt('chk_b', '2026-11-16 12:01:00'))
    const old = db.tables.billing_subscriptions.find((r) => r.id === 'chk_1')!
    expect(old).toMatchObject({ status: 'canceled', cancel_source: 'superseded', needs_admin_review: true })
    expect(String(old.admin_note)).toContain('fora do Alterar Plano')
    expect(String(old.admin_note)).toContain('R$ 49,90')
    expect(db.tables.profiles[0].plan).toBe('pro_mensal')
    expect(asaas!.post).not.toHaveBeenCalled()
  })

  it('plano diferente pelo Alterar Plano confirmado: encerra a antiga sem marcar', async () => {
    db.tables.pending_checkouts.push({ id: 'chk_b', user_id: USER_A, plan_key: 'pro_mensal', switch_confirmed: true })
    await post(paidAt('chk_1', '2026-11-16 12:00:00'))
    await post(paidAt('chk_b', '2026-11-20 12:00:00'))
    expect(db.tables.billing_subscriptions.find((r) => r.id === 'chk_1')).toMatchObject({ cancel_source: 'superseded', needs_admin_review: false })
  })
})

describe('rodada 2: vencida paga com atraso antes da inativação (N1)', () => {
  beforeEach(() => {
    db.tables.profiles[0].plan = 'essencial_mensal'
    db.tables.billing_subscriptions.push(subRow({ id: 'chk_1', user_id: USER_A, asaas_subscription_id: 'sub_1', last_paid_due_date: '2026-11-16', paid_until: '2026-12-17T03:00:00.000Z' }))
  })

  it('aviso de vencida com o Asaas fora, pagamento atrasado chega, o job inativa mesmo assim e a pendência termina', async () => {
    asaas!.put.mockRejectedValue(asaasDown())
    await post(payEvent('evt_o', 'PAYMENT_OVERDUE', { status: 'OVERDUE', dueDate: '2026-12-16' }))
    const late = await post(payEvent('evt_l', 'PAYMENT_RECEIVED', { status: 'RECEIVED', dueDate: '2026-12-16', confirmedDate: '2026-12-19', paymentDate: '2026-12-19', billingType: 'PIX' }, '2026-12-19 10:00:00'))
    expect(late.body).toMatchObject({ result: 'late_payment' })
    expect(db.tables.billing_pending_actions[0].status).toBe('pending')
    asaas!.put.mockResolvedValue({})
    db.tables.billing_pending_actions[0].next_attempt_at = '2026-11-16T00:00:00.000Z'
    await cron()
    expect(stopCalls()).toContainEqual(['/subscriptions/sub_1', { status: 'INACTIVE' }])
    expect(db.tables.billing_pending_actions[0].status).toBe('done')
    expect(db.tables.billing_subscriptions[0].asaas_stopped_at).toBeTruthy()
  })

  it('rede de segurança com pagamento ATRASADO: plano até o fim do período, inativa no Asaas e fecha a pendência', async () => {
    Object.assign(db.tables.billing_subscriptions[0], { status: 'canceled', cancel_source: 'unpaid', access_until: '2026-11-16T00:00:00.000Z' })
    db.tables.billing_pending_actions.push({ id: 50, subscription_ref: 'chk_1', user_id: USER_A, action: 'inactivate_subscription', reason: 'rede_de_seguranca', asaas_subscription_id: 'sub_1', due_date: '2026-12-16', auto_retry: true, status: 'pending', attempts: 0, next_attempt_at: '2026-11-16T00:00:00.000Z' })
    asaas!.get.mockResolvedValue({ data: [payment({ id: 'p_l', subscription: 'sub_1', dueDate: '2026-12-16', confirmedDate: '2026-12-19', status: 'CONFIRMED' })], hasMore: false })
    await cron()
    expect(db.rpcCalls.find((c) => c.name === 'billing_payment_confirmed')!.args).toMatchObject({ p_due_date: '2026-12-16', p_paid_on: '2026-12-19' })
    expect(stopCalls()).toEqual([['/subscriptions/sub_1', { status: 'INACTIVE' }]])
    expect(db.tables.billing_pending_actions.find((a) => a.id === 50)!.status).toBe('done')
  })

  it('rede de segurança quando o vencimento mudou no painel: desfaz o corte sem inativar', async () => {
    Object.assign(db.tables.billing_subscriptions[0], { status: 'canceled', cancel_source: 'unpaid' })
    db.tables.billing_pending_actions.push({ id: 51, subscription_ref: 'chk_1', user_id: USER_A, action: 'inactivate_subscription', reason: 'rede_de_seguranca', asaas_subscription_id: 'sub_1', due_date: '2026-11-14', auto_retry: true, status: 'pending', attempts: 0, next_attempt_at: '2026-11-16T00:00:00.000Z' })
    asaas!.get.mockResolvedValue({ data: [payment({ id: 'p_n', subscription: 'sub_1', dueDate: '2026-11-25', confirmedDate: null, status: 'PENDING' })], hasMore: false })
    await cron()
    expect(stopCalls()).toEqual([])
    expect(db.tables.billing_subscriptions[0]).toMatchObject({ status: 'active', next_due_date: '2026-11-25' })
    expect(db.tables.billing_pending_actions.find((a) => a.id === 51)!.status).toBe('canceled')
  })
})

describe('rodada 2: cobrança removida (N2) e eventos esgotados (N5)', () => {
  beforeEach(() => {
    db.tables.billing_subscriptions.push(subRow({ id: 'chk_1', user_id: USER_A, asaas_subscription_id: 'sub_1', last_paid_due_date: '2026-11-16' }))
  })

  it('PAYMENT_DELETED grava a cobrança como apagada', async () => {
    await post(payEvent('evt_d1', 'PAYMENT_DELETED', { id: 'pay_d', status: 'PENDING', dueDate: '2026-12-16' }))
    expect(db.tables.billing_payments.find((r) => r.asaas_payment_id === 'pay_d')).toMatchObject({ status: 'DELETED', last_event: 'PAYMENT_DELETED' })
  })

  it('payload com deleted: true (em outro evento) também grava como apagada', async () => {
    await post(payEvent('evt_d2', 'PAYMENT_UPDATED', { id: 'pay_e', status: 'PENDING', dueDate: '2026-12-16', deleted: true }))
    expect(db.tables.billing_payments.find((r) => r.asaas_payment_id === 'pay_e')!.status).toBe('DELETED')
  })

  it('PAYMENT_RESTORED depois volta a contar como em aberto', async () => {
    await post(payEvent('evt_d3', 'PAYMENT_DELETED', { id: 'pay_f', status: 'PENDING', dueDate: '2026-12-16' }, '2026-11-20 10:00:00'))
    await post(payEvent('evt_d4', 'PAYMENT_RESTORED', { id: 'pay_f', status: 'PENDING', dueDate: '2026-12-16', deleted: false }, '2026-11-21 10:00:00'))
    expect(db.tables.billing_payments.find((r) => r.asaas_payment_id === 'pay_f')!.status).toBe('PENDING')
  })

  it('job não pega evento que já esgotou as tentativas e marca o que esgota', async () => {
    db.tables.asaas_webhook_events.push(
      { id: 'evt_velho', event: 'SUBSCRIPTION_DELETED', status: 'failed', attempts: 20, received_at: '2026-11-15T00:00:00.000Z', payload: { event: 'SUBSCRIPTION_DELETED', subscription: { id: 'sub_z' } } },
      { id: 'evt_quase', event: 'SUBSCRIPTION_DELETED', status: 'failed', attempts: 19, received_at: '2026-11-15T00:00:00.000Z', payload: { event: 'SUBSCRIPTION_DELETED', subscription: { id: 'sub_z' } } },
    )
    asaas!.get.mockRejectedValue(asaasDown())
    const job = await cron()
    expect(job.body).toMatchObject({ events: { done: 0, failed: 1 } })
    expect(db.tables.asaas_webhook_events.find((e) => e.id === 'evt_quase')!.status).toBe('exhausted')
    expect(db.tables.asaas_webhook_events.find((e) => e.id === 'evt_velho')!.attempts).toBe(20)
  })
})

describe('rodada 2: adoção de assinatura antiga (N7) e perfil no extended (N3)', () => {
  it('não achou a assinatura antiga no Asaas: caso pro admin', async () => {
    db.tables.payments.push({ id: 'chk_old', user_id: USER_A, plan_key: 'essencial_mensal', asaas_checkout_id: 'chk_old', paid_at: '2026-08-01T12:00:00Z' })
    db.tables.pending_checkouts.push({ id: 'chk_new', user_id: USER_A, plan_key: 'pro_mensal' })
    await post({ id: 'evt_n', event: 'CHECKOUT_PAID', checkout: { id: 'chk_new', customer: 'cus_1' } })
    expect(db.tables.billing_pending_actions.find((a) => a.action === 'admin_review')).toMatchObject({ subscription_ref: 'chk_old', user_id: USER_A, auto_retry: false })
  })

  it('assinatura antiga removida no Asaas (deleted: true) não é adotada', async () => {
    db.tables.payments.push({ id: 'chk_old', user_id: USER_A, plan_key: 'essencial_mensal', asaas_checkout_id: 'chk_old' })
    db.tables.pending_checkouts.push({ id: 'chk_new', user_id: USER_A, plan_key: 'pro_mensal' })
    asaas!.get.mockImplementation(async (path: string, params?: Record<string, unknown>) => {
      if (path === '/payments' && params?.checkoutSession === 'chk_old') return { data: [payment({ id: 'p_old', subscription: 'sub_old' })] }
      if (path === '/subscriptions/sub_old') return { id: 'sub_old', status: 'ACTIVE', deleted: true }
      return { data: [] }
    })
    await post({ id: 'evt_n2', event: 'CHECKOUT_PAID', checkout: { id: 'chk_new', customer: 'cus_1' } })
    expect(db.tables.billing_subscriptions.find((r) => r.id === 'chk_old')).toBeUndefined()
    expect(asaas!.del).not.toHaveBeenCalled()
  })

  it('PAYMENT_CONFIRMED que cria a linha antes do CHECKOUT_PAID já dá o plano no perfil', async () => {
    const res = await post(payEvent('evt_pc', 'PAYMENT_CONFIRMED', { id: 'pay_1', subscription: 'sub_1', checkoutSession: 'chk_1', dueDate: '2026-11-16', confirmedDate: '2026-11-16' }))
    expect(res.body).toMatchObject({ result: 'extended' })
    expect(db.tables.profiles[0].plan).toBe('essencial_mensal')
  })
})

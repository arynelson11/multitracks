import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRes, type FakeDb } from './fakeSupabase.js'
import { USER_A, asaasDown, asaasRejected, createBillingDb, createFakeAsaas, forbiddenInWebhook, payment, subRow, type FakeAsaas } from './billingHarness.js'

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
// COB-R8: em TODO cenário deste arquivo, em tempo de execução, o webhook e o job
// não estornam nada e não passam pelo cancelamento do usuário.
afterEach(() => {
  expect(forbiddenInWebhook(db, asaas)).toEqual([])
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
    db.tables.billing_subscriptions.push(subRow({ id: 'chk_old', user_id: USER_A, asaas_subscription_id: 'sub_old', started_at: '2026-10-01T00:00:00Z', first_paid_at: '2026-10-01T00:00:00Z', checkout_created_at: '2026-10-01T00:00:00Z' }))
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

describe('rodada 3: compra repetida sem estorno automático (COB-I7-v2)', () => {
  const paidAt = (id: string, when: string) => ({ id: `evt_${id}`, event: 'CHECKOUT_PAID', dateCreated: when, checkout: { id, customer: 'cus_1' } })

  it('duas abas no Livre, mesmo plano: fica a 1ª paga, a outra tem a renovação inativada e o admin estorna à mão', async () => {
    db.tables.pending_checkouts.push({ id: 'chk_b', user_id: USER_A, plan_key: 'essencial_mensal', created_at: '2026-11-16T11:59:30Z' })
    asaas!.get.mockImplementation(async (path: string, params?: Record<string, unknown>) =>
      path === '/payments' && params?.checkoutSession === 'chk_b'
        ? { data: [payment({ id: 'pay_b', subscription: 'sub_b', checkoutSession: 'chk_b', status: 'CONFIRMED', invoiceUrl: 'https://www.asaas.com/i/pay_b' })] }
        : { data: [] })
    await post(paidAt('chk_1', '2026-11-16 12:00:00'))
    const res = await post(paidAt('chk_b', '2026-11-16 12:00:40'))
    expect(res.body).toMatchObject({ result: 'duplicate' })
    expect(db.tables.billing_subscriptions.find((r) => r.id === 'chk_1')!.status).toBe('active')
    const dup = db.tables.billing_subscriptions.find((r) => r.id === 'chk_b')!
    expect(dup).toMatchObject({ status: 'canceled', cancel_source: 'duplicate', needs_admin_review: true })
    expect(String(dup.admin_note)).toContain('compra duplicada: estornar a mao')
    expect(String(dup.admin_note)).toContain('pay_b')
    expect(String(dup.admin_note)).toContain('https://www.asaas.com/i/pay_b')
    expect(db.tables.billing_pending_actions.find((a) => a.subscription_ref === 'chk_b')).toMatchObject({ action: 'inactivate_subscription' })
    expect(db.tables.profiles[0].plan).toBe('essencial_mensal')
    expect((asaas!.post.mock.calls as [string][]).some(([path]) => path.includes('/refund'))).toBe(false)
  })

  it('mesmo plano: uma linha sem pagamento confirmado não conta como a primeira', async () => {
    // a aba B virou linha antes (aviso de cobrança, ainda sem pagamento) e a A foi paga
    db.tables.pending_checkouts.push({ id: 'chk_b', user_id: USER_A, plan_key: 'essencial_mensal' })
    db.tables.billing_subscriptions.push(subRow({ id: 'chk_b', user_id: USER_A, asaas_subscription_id: 'sub_b', started_at: '2026-11-16T11:00:00Z' }))
    await post(paidAt('chk_1', '2026-11-16 12:00:00'))
    // a B não vira a primeira e espera o pagamento dela
    expect(db.tables.billing_subscriptions.find((r) => r.id === 'chk_1')!.status).toBe('active')
    expect(db.tables.billing_subscriptions.find((r) => r.id === 'chk_b')!.status).toBe('active')
    // o pagamento da B chega depois: ela é a repetida
    await post(payEvent('evt_pc_b', 'PAYMENT_CONFIRMED', { id: 'pay_b1', subscription: 'sub_b', checkoutSession: 'chk_b', dueDate: '2026-11-17', confirmedDate: '2026-11-17' }, '2026-11-17 10:00:00'))
    expect(db.tables.billing_subscriptions.find((r) => r.id === 'chk_1')!.status).toBe('active')
    expect(db.tables.billing_subscriptions.find((r) => r.id === 'chk_b')).toMatchObject({ status: 'canceled', cancel_source: 'duplicate', needs_admin_review: true })
  })

  it('planos diferentes: vale a ordem de criação do checkout, não a de chegada do aviso', async () => {
    // abriu o Studio por último, mas o aviso do Pro chegou depois (reprocessado)
    db.tables.pending_checkouts[0].created_at = '2026-11-16T11:59:00Z'
    db.tables.pending_checkouts.push({ id: 'chk_b', user_id: USER_A, plan_key: 'pro_mensal', created_at: '2026-11-16T11:59:50Z' })
    await post(paidAt('chk_b', '2026-11-16 12:01:00'))
    await post(paidAt('chk_1', '2026-11-16 12:00:00'))
    expect(db.tables.billing_subscriptions.find((r) => r.id === 'chk_b')!.status).toBe('active')
    const old = db.tables.billing_subscriptions.find((r) => r.id === 'chk_1')!
    expect(old).toMatchObject({ status: 'canceled', cancel_source: 'superseded', needs_admin_review: true })
    expect(String(old.admin_note)).toContain('R$ 49,90')
    expect(String(old.admin_note)).toContain('R$ 119,90')
    expect(db.tables.profiles[0].plan).toBe('pro_mensal')
  })

  it('plano diferente pelo Alterar Plano confirmado: encerra a antiga sem marcar', async () => {
    db.tables.pending_checkouts[0].created_at = '2026-11-01T00:00:00Z'
    db.tables.pending_checkouts.push({ id: 'chk_b', user_id: USER_A, plan_key: 'pro_mensal', switch_confirmed: true, created_at: '2026-11-20T00:00:00Z' })
    await post(paidAt('chk_1', '2026-11-16 12:00:00'))
    await post(paidAt('chk_b', '2026-11-20 12:00:00'))
    expect(db.tables.billing_subscriptions.find((r) => r.id === 'chk_1')).toMatchObject({ cancel_source: 'superseded', needs_admin_review: false })
  })

  it('Q8: a compra repetida não tira o arrependimento automático da que ficou', async () => {
    db.tables.pending_checkouts.push({ id: 'chk_b', user_id: USER_A, plan_key: 'essencial_mensal' })
    await post(paidAt('chk_1', '2026-11-16 12:00:00'))
    await post(paidAt('chk_b', '2026-11-16 12:00:40'))
    const { previewCancellation } = await import('../_lib/billing.js')
    db.tables.billing_subscriptions.find((r) => r.id === 'chk_1')!.asaas_subscription_id = 'sub_1'
    asaas!.get.mockResolvedValue({ data: [payment({ id: 'pay_1', subscription: 'sub_1', confirmedDate: '2026-11-16' })], hasMore: false })
    const preview = await previewCancellation({ db: db as never, asaas, now: () => new Date('2026-11-17T15:00:00Z') }, USER_A)
    expect(preview.outcome).toBe('refund_auto')
  })
})

describe('rodada 3: renovação inativada não cobra a cobrança futura já gerada', () => {
  it('ao inativar, remove a cobrança em aberto que ainda vai vencer e deixa a vencida', async () => {
    db.tables.profiles[0].plan = 'essencial_mensal'
    db.tables.billing_subscriptions.push(subRow({ id: 'chk_1', user_id: USER_A, asaas_subscription_id: 'sub_1', last_paid_due_date: '2026-10-16' }))
    asaas!.get.mockResolvedValue({ data: [
      payment({ id: 'p_venc', subscription: 'sub_1', dueDate: '2026-11-14', status: 'OVERDUE' }),
      payment({ id: 'p_fut', subscription: 'sub_1', dueDate: '2026-12-14', status: 'PENDING' }),
    ], hasMore: false })
    await post(payEvent('evt_o', 'PAYMENT_OVERDUE', { id: 'p_venc', status: 'OVERDUE', dueDate: '2026-11-14' }))
    expect(stopCalls()).toContainEqual(['/subscriptions/sub_1', { status: 'INACTIVE' }])
    expect(asaas!.del).toHaveBeenCalledWith('/payments/p_fut')
    expect(asaas!.del).not.toHaveBeenCalledWith('/payments/p_venc')
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

// Parte 3 (T13, rodada 1): o plano também ativa pela cobrança confirmada, então a oferta do
// primeiro mês não pode depender só do CHECKOUT_PAID.
describe('oferta do primeiro mês no PAYMENT_CONFIRMED (Parte 3)', () => {
  const restoreActions = () => db.tables.billing_pending_actions.filter((a) => a.action === 'restore_full_price')

  it('checkout com oferta e PAYMENT_CONFIRMED sem CHECKOUT_PAID: a pendência de voltar pro preço cheio nasce e troca', async () => {
    vi.stubEnv('OFFER_CPF_SECRET', '')
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'log').mockImplementation(() => {})
    db.tables.pending_checkouts[0] = { id: 'chk_1', user_id: USER_A, plan_key: 'essencial_mensal', offer_month: '2026-11', offer_value: 24.9 }
    db.tables.first_month_offers.push({ id: 1, user_id: USER_A, month: '2026-11', used_at: null, checkout_id: null, cpf_hash: null })
    const first = { id: 'pay_1', subscription: 'sub_1', checkoutSession: 'chk_1', value: 24.9, dueDate: '2026-11-16', originalDueDate: '2026-11-16', confirmedDate: '2026-11-16' }
    asaas!.get.mockImplementation(async (path: string, params?: Record<string, unknown>) =>
      (path === '/payments' && params?.subscription === 'sub_1' ? { data: [payment(first)], hasMore: false } : { data: [], hasMore: false }))
    const res = await post(payEvent('evt_pc', 'PAYMENT_CONFIRMED', first, '2026-11-16 12:00:05'))
    expect(res.body).toMatchObject({ processed: true, result: 'extended' })
    expect(db.tables.profiles[0].plan).toBe('essencial_mensal')
    expect(stopCalls()).toEqual([['/subscriptions/sub_1', { value: 49.9, cycle: 'MONTHLY', description: 'Playback Studio Pro (mensal)', updatePendingPayments: true }]])
    expect(restoreActions()).toEqual([expect.objectContaining({ subscription_ref: 'chk_1', status: 'done' })])
    expect(db.tables.product_events.filter((e) => e.kind === 'offer_used')).toHaveLength(1)
  })

  it('checkout sem oferta: o PAYMENT_CONFIRMED depois do CHECKOUT_PAID não faz consulta a mais', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    await post(checkoutPaid())
    const reads = db.reads.length
    const rpcs = db.rpcCalls.length
    await post(payEvent('evt_pc', 'PAYMENT_CONFIRMED', { id: 'pay_1', subscription: 'sub_1', checkoutSession: 'chk_1', dueDate: '2026-11-16', confirmedDate: '2026-11-16' }))
    await post(payEvent('evt_ren', 'PAYMENT_CONFIRMED', { id: 'pay_2', subscription: 'sub_1', checkoutSession: 'chk_1', dueDate: '2026-12-16', originalDueDate: '2026-12-16', confirmedDate: '2026-12-16' }))
    const after = db.reads.slice(reads)
    expect(after.filter((r) => r.table === 'pending_checkouts')).toEqual([])
    // as pendências que o webhook tenta no fim (por vencimento) não contam; a rede leria por checkout
    expect(after.filter((r) => r.table === 'billing_pending_actions' && r.filters.some((f) => f.col === 'subscription_ref'))).toEqual([])
    expect(db.rpcCalls.slice(rpcs).map((c) => c.name).filter((n) => n.startsWith('offer_') || n === 'billing_enqueue_action')).toEqual([])
    expect(restoreActions()).toEqual([])
  })
})

describe('rodada 3: rede de segurança por ciclo (Q2) e desfazer com conferência (Q3)', () => {
  beforeEach(() => {
    db.tables.profiles[0].plan = 'free'
    db.tables.billing_subscriptions.push(subRow({ id: 'chk_1', user_id: USER_A, asaas_subscription_id: 'sub_1', status: 'canceled', cancel_source: 'unpaid', last_paid_due_date: '2026-10-14' }))
    db.tables.billing_pending_actions.push({ id: 70, subscription_ref: 'chk_1', user_id: USER_A, action: 'inactivate_subscription', reason: 'rede_de_seguranca', asaas_subscription_id: 'sub_1', due_date: '2026-11-14', auto_retry: true, status: 'pending', attempts: 0, next_attempt_at: '2026-11-16T00:00:00.000Z' })
  })

  it('cobrança adiada no painel e paga na data nova é achada pelo ciclo (vencimento original)', async () => {
    asaas!.get.mockResolvedValue({ data: [payment({ id: 'p_ad', subscription: 'sub_1', dueDate: '2026-11-24', originalDueDate: '2026-11-14', confirmedDate: '2026-11-15', status: 'CONFIRMED' })], hasMore: false })
    await cron()
    expect(db.rpcCalls.find((c) => c.name === 'billing_payment_confirmed')!.args).toMatchObject({ p_due_date: '2026-11-14' })
    expect(stopCalls()).toEqual([])
  })

  it('Q3: com cobrança vencida sem pagamento (mesmo PENDING) não desfaz, mantém o corte e marca', async () => {
    asaas!.get.mockResolvedValue({ data: [
      payment({ id: 'p_old', subscription: 'sub_1', dueDate: '2026-11-10', originalDueDate: '2026-11-10', status: 'PENDING', confirmedDate: null }),
      payment({ id: 'p_new', subscription: 'sub_1', dueDate: '2026-11-25', originalDueDate: '2026-11-25', status: 'PENDING', confirmedDate: null }),
    ], hasMore: false })
    await cron()
    expect(db.rpcCalls.some((c) => c.name === 'billing_undo_safety_cut')).toBe(false)
    expect(db.tables.billing_subscriptions[0]).toMatchObject({ status: 'canceled', needs_admin_review: true })
    expect(stopCalls()).toContainEqual(['/subscriptions/sub_1', { status: 'INACTIVE' }])
  })
})

describe('rodada 3: nenhum caminho do webhook estorna', () => {
  // Complemento: a prova é a de tempo de execução (afterEach com forbiddenInWebhook, COB-R8).
  it('no código, o único estorno é o do botão de cancelar do usuário', async () => {
    const { readFileSync } = await import('node:fs')
    const src = readFileSync(new URL('../_lib/billing.ts', import.meta.url), 'utf8')
    const calls = src.split('refundPayment(').length - 1
    expect(calls).toBe(1)
    const at = src.indexOf('refundPayment(asaas')
    const cancelStart = src.indexOf('export async function cancelSubscriptionForUser')
    const cancelEnd = src.indexOf('// ── Prévia do cancelamento')
    expect(at).toBeGreaterThan(cancelStart)
    expect(at).toBeLessThan(cancelEnd)
    const webhookSrc = readFileSync(new URL('../webhook/asaas.ts', import.meta.url), 'utf8')
    expect(webhookSrc).not.toContain('refund')
    expect(webhookSrc).not.toContain('cancelSubscriptionForUser')
  })
})

describe('rodada 4: rede de segurança e troca de ciclo (COB-R1, R5)', () => {
  beforeEach(() => {
    db.tables.billing_pending_actions.push({ id: 80, subscription_ref: 'chk_1', user_id: USER_A, action: 'inactivate_subscription', reason: 'rede_de_seguranca', asaas_subscription_id: 'sub_1', asaas_payment_id: null, due_date: '2026-11-13', auto_retry: true, status: 'pending', attempts: 0, next_attempt_at: '2026-11-16T00:00:00.000Z' })
  })

  it('R1: cobrança do ciclo já paga e contada (already_counted) é corte indevido: desfaz e marca, nunca inativa', async () => {
    // anual: vencimento 04/11 adiado pra 13/11 e pago em 12/11; o vencimento ficou em 13/11 e a rede cortou
    db.tables.billing_subscriptions.push(subRow({ id: 'chk_1', user_id: USER_A, asaas_subscription_id: 'sub_1', plan_key: 'essencial_anual', cycle: 'YEARLY', status: 'canceled', cancel_source: 'unpaid', last_paid_due_date: '2026-11-04', next_due_date: '2026-11-13', access_until: '2026-11-16T06:15:00.000Z' }))
    asaas!.get.mockResolvedValue({ data: [payment({ id: 'p_ano', subscription: 'sub_1', dueDate: '2026-11-13', originalDueDate: '2026-11-04', confirmedDate: '2026-11-12', status: 'CONFIRMED', value: 454.8 })], hasMore: false })
    await cron()
    expect(db.rpcCalls.find((c) => c.name === 'billing_payment_confirmed')!.args).toMatchObject({ p_due_date: '2026-11-04' })
    expect(db.rpcCalls.find((c) => c.name === 'billing_undo_counted_cut')!.args).toMatchObject({ p_id: 'chk_1', p_cut_due: '2026-11-13' })
    expect(stopCalls()).toEqual([])
    expect(asaas!.del).not.toHaveBeenCalled()
    const row = db.tables.billing_subscriptions[0]
    expect(row).toMatchObject({ status: 'active', needs_admin_review: true, next_due_date: '2027-11-04' })
    expect(String(row.admin_note)).toContain('corte indevido')
    expect(db.tables.billing_pending_actions.find((a) => a.id === 80)!.status).toBe('canceled')
    expect(db.tables.profiles[0].plan).toBe('essencial_anual')
  })

  it('R5: pago em dia na rede (reactivated) desfaz e marca pro admin', async () => {
    db.tables.billing_subscriptions.push(subRow({ id: 'chk_1', user_id: USER_A, asaas_subscription_id: 'sub_1', status: 'canceled', cancel_source: 'unpaid', last_paid_due_date: '2026-10-13' }))
    asaas!.get.mockResolvedValue({ data: [payment({ id: 'p_n', subscription: 'sub_1', dueDate: '2026-11-13', originalDueDate: '2026-11-13', confirmedDate: '2026-11-13', status: 'CONFIRMED' })], hasMore: false })
    await cron()
    expect(stopCalls()).toEqual([])
    expect(db.tables.billing_subscriptions[0]).toMatchObject({ status: 'active', needs_admin_review: true })
    expect(String(db.tables.billing_subscriptions[0].admin_note)).toContain('corte desfeito')
  })

  it('R5: sem a cobrança do ciclo e sem próxima em aberto: mantém o corte, inativa e marca pro admin', async () => {
    db.tables.billing_subscriptions.push(subRow({ id: 'chk_1', user_id: USER_A, asaas_subscription_id: 'sub_1', status: 'canceled', cancel_source: 'unpaid', last_paid_due_date: '2026-10-13' }))
    asaas!.get.mockResolvedValue({ data: [payment({ id: 'p_old', subscription: 'sub_1', dueDate: '2026-10-13', originalDueDate: '2026-10-13', confirmedDate: '2026-10-13', status: 'RECEIVED' })], hasMore: false })
    await cron()
    expect(stopCalls()).toEqual([['/subscriptions/sub_1', { status: 'INACTIVE' }]])
    expect(db.tables.billing_subscriptions[0]).toMatchObject({ status: 'canceled', needs_admin_review: true })
    expect(String(db.tables.billing_subscriptions[0].admin_note)).toContain('corte mantido')
  })
})

describe('rodada 4: remoção da cobrança futura ao inativar (COB-R2)', () => {
  const pend = (action: string) => db.tables.billing_pending_actions.find((a) => a.action === action)!
  beforeEach(() => {
    db.tables.profiles[0].plan = 'essencial_mensal'
    db.tables.billing_subscriptions.push(subRow({ id: 'chk_1', user_id: USER_A, asaas_subscription_id: 'sub_1', last_paid_due_date: '2026-10-14' }))
  })

  it('a vencida da decisão fica guardada e nunca é removida, mesmo adiada depois pro futuro', async () => {
    asaas!.put.mockRejectedValue(asaasDown())
    await post(payEvent('evt_o', 'PAYMENT_OVERDUE', { id: 'p_venc', status: 'OVERDUE', dueDate: '2026-11-14' }))
    expect(pend('inactivate_subscription')).toMatchObject({ status: 'pending', asaas_payment_id: 'p_venc', due_date: '2026-11-14' })
    // com a inativação pendente, a vencida é adiada no painel (volta a PENDING com data futura)
    asaas!.put.mockResolvedValue({})
    asaas!.get.mockResolvedValue({ data: [
      payment({ id: 'p_venc', subscription: 'sub_1', dueDate: '2026-11-30', originalDueDate: null, status: 'PENDING' }),
      payment({ id: 'p_fut', subscription: 'sub_1', dueDate: '2026-12-14', originalDueDate: '2026-12-14', status: 'PENDING' }),
    ], hasMore: false })
    pend('inactivate_subscription').next_attempt_at = '2026-11-16T00:00:00.000Z'
    await cron()
    expect(stopCalls()).toContainEqual(['/subscriptions/sub_1', { status: 'INACTIVE' }])
    expect(asaas!.del).toHaveBeenCalledWith('/payments/p_fut')
    expect(asaas!.del).not.toHaveBeenCalledWith('/payments/p_venc')
    expect(db.tables.billing_subscriptions[0].asaas_stopped_at).toBeTruthy()
    expect(pend('delete_future_payments').status).toBe('done')
  })

  it('o Asaas recusa remover a futura: a inativação vale, a remoção vira pendência própria e o admin é marcado', async () => {
    asaas!.get.mockImplementation(async (path: string) => {
      if (path === '/payments/p_fut') return { id: 'p_fut', status: 'PENDING' }
      return { data: [
        payment({ id: 'p_venc', subscription: 'sub_1', dueDate: '2026-11-14', originalDueDate: '2026-11-14', status: 'OVERDUE' }),
        payment({ id: 'p_fut', subscription: 'sub_1', dueDate: '2026-12-14', originalDueDate: '2026-12-14', status: 'PENDING' }),
        payment({ id: 'p_fut2', subscription: 'sub_1', dueDate: '2027-01-14', originalDueDate: '2027-01-14', status: 'PENDING' }),
      ], hasMore: false }
    })
    asaas!.del.mockImplementation(async (path: string) => { if (path === '/payments/p_fut') throw asaasRejected('nao pode remover'); return { deleted: true } })
    await post(payEvent('evt_o', 'PAYMENT_OVERDUE', { id: 'p_venc', status: 'OVERDUE', dueDate: '2026-11-14' }))
    expect(stopCalls()).toEqual([['/subscriptions/sub_1', { status: 'INACTIVE' }]])
    expect(pend('inactivate_subscription').status).toBe('done')
    expect(db.tables.billing_subscriptions[0]).toMatchObject({ asaas_stop_kind: 'inactivated', needs_admin_review: true })
    expect(db.tables.billing_subscriptions[0].asaas_stopped_at).toBeTruthy()
    expect(String(db.tables.billing_subscriptions[0].admin_note)).toContain('p_fut')
    // a recusa não para as outras da lista
    expect(asaas!.del).toHaveBeenCalledWith('/payments/p_fut2')
    expect(pend('delete_future_payments')).toMatchObject({ status: 'pending', attempts: 1, asaas_payment_id: 'p_venc' })
  })

  it('recusa porque a futura foi paga entre a lista e a remoção: relê e não há o que remover', async () => {
    asaas!.get.mockImplementation(async (path: string) => {
      if (path === '/payments/p_fut') return { id: 'p_fut', status: 'CONFIRMED' }
      return { data: [payment({ id: 'p_fut', subscription: 'sub_1', dueDate: '2026-12-14', originalDueDate: '2026-12-14', status: 'PENDING' })], hasMore: false }
    })
    asaas!.del.mockRejectedValue(asaasRejected('ja paga'))
    await post(payEvent('evt_o', 'PAYMENT_OVERDUE', { id: 'p_venc', status: 'OVERDUE', dueDate: '2026-11-14' }))
    expect(pend('delete_future_payments').status).toBe('done')
    expect(db.tables.billing_subscriptions[0].needs_admin_review).toBe(false)
  })

  it('pagamento em dia que chega depois da inativação segue o N1 e nunca volta a ativa cobrando', async () => {
    await post(payEvent('evt_o', 'PAYMENT_OVERDUE', { id: 'p_venc', status: 'OVERDUE', dueDate: '2026-11-14' }))
    expect(db.tables.billing_subscriptions[0].asaas_stopped_at).toBeTruthy()
    const late = await post(payEvent('evt_c', 'PAYMENT_CONFIRMED', { id: 'p_venc', status: 'CONFIRMED', dueDate: '2026-11-14', confirmedDate: '2026-11-14' }, '2026-11-16 13:00:00'))
    expect(late.body).toMatchObject({ result: 'late_payment' })
    expect(db.tables.billing_subscriptions[0]).toMatchObject({ status: 'canceled', needs_admin_review: true })
    expect(db.tables.profiles[0].plan).toBe('essencial_mensal')
  })

  it('o aviso de inativada do próprio Asaas fecha a inativação enquanto ela roda: a remoção das futuras acontece mesmo assim', async () => {
    asaas!.put.mockImplementation(async () => {
      await db.rpc('billing_mark_asaas_stopped', { p_id: 'chk_1', p_kind: 'inactivated', p_subscription_id: 'sub_1' })
      return {}
    })
    asaas!.get.mockResolvedValue({ data: [payment({ id: 'p_fut', subscription: 'sub_1', dueDate: '2026-12-14', originalDueDate: '2026-12-14', status: 'PENDING' })], hasMore: false })
    await post(payEvent('evt_o', 'PAYMENT_OVERDUE', { id: 'p_venc', status: 'OVERDUE', dueDate: '2026-11-14' }))
    expect(asaas!.del).toHaveBeenCalledWith('/payments/p_fut')
  })
})

describe('rodada 4: corte e marcação na mesma chamada (COB-R3)', () => {
  const paidAt = (id: string, when: string) => ({ id: `evt_${id}`, event: 'CHECKOUT_PAID', dateCreated: when, checkout: { id, customer: 'cus_1' } })
  // a próxima chamada ao banco logo depois do corte cai (uma vez)
  const dropAfterCut = () => {
    const orig = db.rpc.bind(db)
    let armed = false
    let fired = false
    db.rpc = async (name: string, args: Record<string, unknown> = {}) => {
      if (armed) { armed = false; return { data: null, error: { message: 'queda entre o corte e a marcacao' } } }
      const res = await orig(name, args)
      if (!fired && name === 'billing_end_subscription' && ['duplicate', 'superseded'].includes(String(args.p_source))) { armed = true; fired = true }
      return res
    }
  }
  // o Asaas acha a assinatura de cada checkout pelas cobranças dele
  beforeEach(() => {
    asaas!.get.mockImplementation(async (path: string, params?: Record<string, unknown>) =>
      path === '/payments' && typeof params?.checkoutSession === 'string'
        ? { data: [payment({ id: `pay_${params.checkoutSession}`, subscription: `sub_${params.checkoutSession}`, checkoutSession: params.checkoutSession, status: 'CONFIRMED' })] }
        : { data: [], hasMore: false })
  })
  const nextDayJob = async () => {
    vi.setSystemTime(new Date('2026-11-17T09:30:00Z'))
    for (const p of db.tables.billing_pending_actions) p.next_attempt_at = '2026-11-16T00:00:00.000Z'
    await cron()
  }

  it('compra repetida: queda logo depois do corte e reprocessamento, a marcação existe', async () => {
    db.tables.pending_checkouts.push({ id: 'chk_b', user_id: USER_A, plan_key: 'essencial_mensal' })
    await post(paidAt('chk_1', '2026-11-16 12:00:00'))
    dropAfterCut()
    await post(paidAt('chk_b', '2026-11-16 12:00:40'))
    await nextDayJob()
    const dup = db.tables.billing_subscriptions.find((r) => r.id === 'chk_b')!
    expect(dup).toMatchObject({ status: 'canceled', cancel_source: 'duplicate', needs_admin_review: true })
    expect(String(dup.admin_note)).toContain('compra duplicada: estornar a mao (ficou a chk_1)')
    expect(dup.asaas_stopped_at).toBeTruthy()
  })

  it('troca fora do Alterar Plano: queda logo depois do corte e reprocessamento, a marcação existe', async () => {
    db.tables.pending_checkouts[0].created_at = '2026-11-16T11:59:00Z'
    db.tables.pending_checkouts.push({ id: 'chk_b', user_id: USER_A, plan_key: 'pro_mensal', created_at: '2026-11-16T11:59:50Z' })
    await post(paidAt('chk_1', '2026-11-16 12:00:00'))
    dropAfterCut()
    await post(paidAt('chk_b', '2026-11-16 12:01:00'))
    await nextDayJob()
    const old = db.tables.billing_subscriptions.find((r) => r.id === 'chk_1')!
    expect(old).toMatchObject({ status: 'canceled', cancel_source: 'superseded', needs_admin_review: true })
    expect(String(old.admin_note)).toContain('troca de plano fora do Alterar Plano')
    expect(old.asaas_stopped_at).toBeTruthy()
  })
})

describe('rodada 4: duas compras no mesmo dia (COB-R4)', () => {
  it('o PAYMENT_CONFIRMED só traz o dia: espera o CHECKOUT_PAID e fica a de hora exata mais antiga', async () => {
    db.tables.pending_checkouts[0].created_at = '2026-11-16T14:00:00Z'
    db.tables.pending_checkouts.push({ id: 'chk_b', user_id: USER_A, plan_key: 'essencial_mensal', created_at: '2026-11-16T14:30:00Z' })
    // A (chk_1) pagou às 12:00 e B às 12:05 (Brasília); o aviso de pagamento da B chega antes de tudo
    await post(payEvent('evt_pc_b', 'PAYMENT_CONFIRMED', { id: 'pay_b1', subscription: 'sub_b', checkoutSession: 'chk_b', dueDate: '2026-11-16', confirmedDate: '2026-11-16' }, '2026-11-16 12:05:01'))
    await post({ id: 'evt_cp_a', event: 'CHECKOUT_PAID', dateCreated: '2026-11-16 12:00:00', checkout: { id: 'chk_1', customer: 'cus_1' } })
    // mesmo dia e a B ainda sem a hora exata: ninguém é cortado ainda
    expect(db.tables.billing_subscriptions.filter((r) => r.status === 'active').map((r) => r.id).sort()).toEqual(['chk_1', 'chk_b'])
    await post({ id: 'evt_cp_b', event: 'CHECKOUT_PAID', dateCreated: '2026-11-16 12:05:00', checkout: { id: 'chk_b', customer: 'cus_1' } })
    expect(db.tables.billing_subscriptions.find((r) => r.id === 'chk_1')!.status).toBe('active')
    expect(db.tables.billing_subscriptions.find((r) => r.id === 'chk_b')).toMatchObject({ status: 'canceled', cancel_source: 'duplicate', needs_admin_review: true })
  })
})

describe('rodada 5: a rede só desfaz o corte com pagamento EM DIA e sem vencida em aberto (COB-S1, S2)', () => {
  beforeEach(() => {
    db.tables.profiles[0].plan = 'free'
    // a rede cortou pelo ciclo 14/11 (o aviso de vencida não chegou)
    db.tables.billing_subscriptions.push(subRow({ id: 'chk_1', user_id: USER_A, asaas_subscription_id: 'sub_1', status: 'canceled', cancel_source: 'unpaid', last_paid_due_date: '2026-10-14', next_due_date: '2026-11-14', access_until: '2026-11-16T06:15:00.000Z' }))
    db.tables.billing_pending_actions.push({ id: 90, subscription_ref: 'chk_1', user_id: USER_A, action: 'inactivate_subscription', reason: 'rede_de_seguranca', asaas_subscription_id: 'sub_1', asaas_payment_id: 'p_x', due_date: '2026-11-14', auto_retry: true, status: 'pending', attempts: 0, next_attempt_at: '2026-11-16T00:00:00.000Z' })
  })

  it('S1: vencida paga com atraso e contada ANTES da pendência: inativa no Asaas, plano até o fim do período, sem renovação', async () => {
    const paidLate = payment({ id: 'p_x', subscription: 'sub_1', dueDate: '2026-11-14', originalDueDate: '2026-11-14', confirmedDate: '2026-11-16', paymentDate: '2026-11-16', status: 'CONFIRMED' })
    asaas!.get.mockResolvedValue({ data: [paidLate, payment({ id: 'p_next', subscription: 'sub_1', dueDate: '2026-12-14', originalDueDate: '2026-12-14', confirmedDate: null, status: 'PENDING' })], hasMore: false })
    // o aviso do pagamento é processado primeiro; no mesmo pedido, a pendência roda
    const res = await post(payEvent('evt_late', 'PAYMENT_CONFIRMED', { id: 'p_x', dueDate: '2026-11-14', originalDueDate: '2026-11-14', confirmedDate: '2026-11-16', paymentDate: '2026-11-16', status: 'CONFIRMED' }, '2026-11-16 11:00:00'))
    expect(res.body).toMatchObject({ result: 'late_payment' })
    expect(stopCalls()).toEqual([['/subscriptions/sub_1', { status: 'INACTIVE' }]])
    expect(asaas!.del).toHaveBeenCalledWith('/payments/p_next')
    const row = db.tables.billing_subscriptions[0]
    expect(row).toMatchObject({ status: 'canceled', access_until: '2026-12-15T03:00:00.000Z' })
    expect(row.asaas_stopped_at).toBeTruthy()
    expect(String(row.admin_note)).toContain('acontece mesmo assim (feita em')
    expect(String(row.admin_note)).not.toContain('(pendente)')
    expect(String(row.admin_note)).not.toContain('corte indevido')
    expect(db.tables.billing_pending_actions.find((a) => a.id === 90)!.status).toBe('done')
    expect(db.tables.profiles[0]).toMatchObject({ plan: 'essencial_mensal', plan_expires_at: '2026-12-15T03:00:00.000Z' })
  })

  it('S1: ciclo já contado e pago em dia, mas com outra cobrança vencida sem pagamento: não desfaz, inativa e marca', async () => {
    Object.assign(db.tables.billing_subscriptions[0], { last_paid_due_date: '2026-11-14' })
    asaas!.get.mockResolvedValue({ data: [
      payment({ id: 'p_old', subscription: 'sub_1', dueDate: '2026-11-10', originalDueDate: '2026-11-10', confirmedDate: null, status: 'OVERDUE' }),
      payment({ id: 'p_x', subscription: 'sub_1', dueDate: '2026-11-14', originalDueDate: '2026-11-14', confirmedDate: '2026-11-13', status: 'CONFIRMED' }),
    ], hasMore: false })
    await cron()
    expect(db.rpcCalls.some((c) => c.name === 'billing_undo_counted_cut')).toBe(false)
    expect(stopCalls()).toEqual([['/subscriptions/sub_1', { status: 'INACTIVE' }]])
    // COB-FINAL: com outra vencida sem pagamento o corte fica (Livre), inativa e marca
    expect(db.tables.billing_subscriptions[0]).toMatchObject({ status: 'canceled', needs_admin_review: true, access_until: '2026-11-16T06:15:00.000Z' })
    expect(String(db.tables.billing_subscriptions[0].admin_note)).toContain('corte mantido, ha cobranca vencida sem pagamento')
    expect(db.tables.profiles[0].plan).toBe('free')
  })

  it('COB-FINAL (B1): ciclo pago em dia e ainda não contado, com o ciclo seguinte já vencido: não reativa, inativa e marca', async () => {
    // a pendência da rede atrasou um mês: o ciclo cortado (14/10) foi pago em dia e o aviso se perdeu; o de 14/11 venceu sem pagamento
    Object.assign(db.tables.billing_subscriptions[0], { last_paid_due_date: '2026-09-14', next_due_date: '2026-10-14' })
    Object.assign(db.tables.billing_pending_actions[0], { due_date: '2026-10-14', asaas_payment_id: 'p_out' })
    asaas!.get.mockResolvedValue({ data: [
      payment({ id: 'p_out', subscription: 'sub_1', dueDate: '2026-10-14', originalDueDate: '2026-10-14', confirmedDate: '2026-10-14', status: 'CONFIRMED' }),
      payment({ id: 'p_nov', subscription: 'sub_1', dueDate: '2026-11-14', originalDueDate: '2026-11-14', confirmedDate: null, status: 'OVERDUE' }),
    ], hasMore: false })
    await cron()
    expect(db.rpcCalls.some((c) => c.name === 'billing_payment_confirmed')).toBe(false)
    expect(stopCalls()).toEqual([['/subscriptions/sub_1', { status: 'INACTIVE' }]])
    expect(db.tables.billing_subscriptions[0]).toMatchObject({ status: 'canceled', needs_admin_review: true })
    expect(String(db.tables.billing_subscriptions[0].admin_note)).toContain('corte mantido, ha cobranca vencida sem pagamento')
    expect(db.tables.profiles[0].plan).toBe('free')
  })

  it('COB-FINAL (T2): cobrança antiga estornada não é dívida: não corta nem inativa quem paga', async () => {
    // o ciclo cortado (14/11) foi pago em dia e o aviso se perdeu; uma cobrança antiga foi estornada à mão
    asaas!.get.mockResolvedValue({ data: [
      payment({ id: 'p_estornada', subscription: 'sub_1', dueDate: '2026-09-14', originalDueDate: '2026-09-14', confirmedDate: '2026-09-14', status: 'REFUNDED' }),
      payment({ id: 'p_x', subscription: 'sub_1', dueDate: '2026-11-14', originalDueDate: '2026-11-14', confirmedDate: '2026-11-14', status: 'CONFIRMED' }),
    ], hasMore: false })
    await cron()
    expect(stopCalls()).toEqual([])
    expect(db.tables.billing_subscriptions[0]).toMatchObject({ status: 'active' })
    expect(db.tables.profiles[0].plan).toBe('essencial_mensal')
  })

  it('COB-PRE (a): cobrança do PRÓPRIO ciclo cortado estornada conta como não paga: não desfaz, inativa e marca', async () => {
    asaas!.get.mockResolvedValue({ data: [
      payment({ id: 'p_x', subscription: 'sub_1', dueDate: '2026-11-14', originalDueDate: '2026-11-14', confirmedDate: '2026-11-10', status: 'REFUNDED' }),
      payment({ id: 'p_next', subscription: 'sub_1', dueDate: '2026-12-14', originalDueDate: '2026-12-14', confirmedDate: null, status: 'PENDING' }),
    ], hasMore: false })
    await cron()
    expect(db.rpcCalls.some((c) => c.name === 'billing_undo_safety_cut' || c.name === 'billing_payment_confirmed')).toBe(false)
    expect(stopCalls()).toEqual([['/subscriptions/sub_1', { status: 'INACTIVE' }]])
    expect(db.tables.billing_subscriptions[0]).toMatchObject({ status: 'canceled', needs_admin_review: true })
    expect(String(db.tables.billing_subscriptions[0].admin_note)).toContain('a cobranca do ciclo 2026-11-14 foi estornada')
    expect(db.tables.profiles[0].plan).toBe('free')
  })

  it('S2: cobrança de um ciclo antigo adiada pra data do ciclo cortado não faz desfazer: vale a do ciclo pelo vencimento original', async () => {
    asaas!.get.mockResolvedValue({ data: [
      // ciclo 14/10, adiado no painel pra 14/11 e pago (já contado)
      payment({ id: 'p_old', subscription: 'sub_1', dueDate: '2026-11-14', originalDueDate: '2026-10-14', confirmedDate: '2026-11-10', status: 'CONFIRMED' }),
      // ciclo 14/11 de verdade, sem pagamento
      payment({ id: 'p_x', subscription: 'sub_1', dueDate: '2026-11-14', originalDueDate: '2026-11-14', confirmedDate: null, status: 'OVERDUE' }),
    ], hasMore: false })
    await cron()
    expect(db.rpcCalls.some((c) => c.name === 'billing_undo_counted_cut' || c.name === 'billing_undo_safety_cut')).toBe(false)
    expect(stopCalls()).toEqual([['/subscriptions/sub_1', { status: 'INACTIVE' }]])
    expect(db.tables.billing_subscriptions[0]).toMatchObject({ status: 'canceled', needs_admin_review: true })
    expect(String(db.tables.billing_subscriptions[0].admin_note)).toContain('corte mantido')
  })
})

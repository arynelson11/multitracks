import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { AsaasError } from '../_lib/asaas.js'
import { createRes, type FakeDb } from './fakeSupabase.js'
import { USER_A, USER_B, createBillingDb, createFakeAsaas, payment, subRow, type FakeAsaas } from './billingHarness.js'

// COB-RECONCILE: conferência diária entre o app e o Asaas
// (GET /api/webhook/asaas?action=reconcile, mesmo CRON_SECRET do job). No Asaas
// só GET; no banco só marcação pro admin. Cada teste confere, além da sua
// comparação, que nenhum caminho chamou PUT, POST ou DELETE no Asaas, escreveu
// direto numa tabela ou mudou plano ou acesso.

const CRON = 'segredo-do-cron-com-tamanho-bom-1234567890'
let db: FakeDb
let asaas: FakeAsaas | null

vi.mock('@supabase/supabase-js', () => ({ createClient: () => db }))
vi.mock('../_lib/asaas.js', async (orig) => ({
  ...(await orig<typeof import('../_lib/asaas.js')>()),
  asaasFromEnv: () => asaas,
}))

const OLD = '2026-11-10T00:00:00.000Z'
type Routes = { subs?: Record<string, unknown>; payments?: Record<string, unknown[]>; byCustomer?: Record<string, unknown[]>; byCheckout?: Record<string, string> }
function fakeAsaas(r: Routes = {}): FakeAsaas {
  return createFakeAsaas({
    get: (path, params) => {
      const q = (params ?? {}) as Record<string, unknown>
      const sub = /^\/subscriptions\/(.+)$/.exec(path)
      if (sub) {
        if (!(sub[1] in (r.subs ?? {}))) throw new AsaasError('not_found', 'não encontrado no Asaas', 404)
        return r.subs![sub[1]]
      }
      if (path === '/subscriptions' && typeof q.customer === 'string') return { data: r.byCustomer?.[q.customer] ?? [], hasMore: false }
      if (path === '/payments' && typeof q.subscription === 'string') return { data: r.payments?.[q.subscription] ?? [], hasMore: false }
      if (path === '/payments' && typeof q.checkoutSession === 'string') {
        const s = r.byCheckout?.[q.checkoutSession]
        return { data: s ? [payment({ id: `p_${q.checkoutSession}`, subscription: s, checkoutSession: q.checkoutSession })] : [] }
      }
      return { data: [], hasMore: false }
    },
  })
}

function snapshot() {
  return JSON.stringify({
    profiles: db.tables.profiles.map((p) => [p.id, p.plan, p.plan_expires_at]),
    subs: db.tables.billing_subscriptions.map((s) => [s.id, s.status, s.plan_key, s.access_until, s.paid_until, s.next_due_date, s.last_paid_due_date, s.cancel_source, s.asaas_stopped_at]),
    pending: db.tables.billing_pending_actions.filter((a) => a.action !== 'admin_review').map((a) => [a.id, a.status, a.attempts]),
  })
}

// Chama a conferência e prova o "só olha e marca".
async function reconcile(headers: Record<string, string> = { authorization: `Bearer ${CRON}` }, query: Record<string, string> = { action: 'reconcile' }) {
  const { default: handler } = await import('../webhook/asaas.js')
  const before = snapshot()
  const res = createRes()
  await handler({ method: 'GET', headers, body: {}, query }, res)
  if (asaas) {
    expect(asaas.put).not.toHaveBeenCalled()
    expect(asaas.post).not.toHaveBeenCalled()
    expect(asaas.del).not.toHaveBeenCalled()
  }
  expect(db.writes).toEqual([])
  for (const c of db.rpcCalls) {
    expect(['billing_flag_review', 'billing_enqueue_action']).toContain(c.name)
    if (c.name === 'billing_enqueue_action') expect(c.args).toMatchObject({ p_action: 'admin_review', p_auto_retry: false })
  }
  expect(snapshot()).toEqual(before)
  return res
}

const row = (over: Parameters<typeof subRow>[0]) => subRow({ asaas_customer_id: 'cus_1', updated_at: OLD, last_paid_due_date: '2026-11-14', next_due_date: '2026-12-14', first_paid_at: '2026-10-14T15:00:00.000Z', ...over })
const note = (id: string) => String(db.tables.billing_subscriptions.find((r) => r.id === id)!.admin_note ?? '')
const reviews = () => db.tables.billing_pending_actions.filter((a) => a.action === 'admin_review')

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-11-16T11:00:00Z'))
  vi.stubEnv('VITE_SUPABASE_URL', 'https://fake.supabase.co')
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'fake-service-role')
  vi.stubEnv('ASAAS_WEBHOOK_TOKEN', 'token-do-webhook-com-mais-de-32-caracteres-ok')
  vi.stubEnv('CRON_SECRET', CRON)
  db = createBillingDb({ profiles: [{ id: USER_A, plan: 'essencial_mensal', plan_expires_at: null }, { id: USER_B, plan: 'free', plan_expires_at: null }] }, () => new Date())
  asaas = fakeAsaas()
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
})

describe('conferência diária com o Asaas (COB-RECONCILE)', () => {
  it('sem o segredo do cron: 401 e nada é lido', async () => {
    const { default: handler } = await import('../webhook/asaas.js')
    const res = createRes()
    await handler({ method: 'GET', headers: { authorization: 'Bearer errado-errado-errado-errado-errado' }, body: {}, query: { action: 'reconcile' } }, res)
    expect(res.statusCode).toBe(401)
    expect(asaas!.get).not.toHaveBeenCalled()
  })

  it('tudo de acordo: nenhuma marcação', async () => {
    db.tables.billing_subscriptions.push(row({ id: 'chk_1', user_id: USER_A, asaas_subscription_id: 'sub_1' }))
    asaas = fakeAsaas({
      subs: { sub_1: { id: 'sub_1', status: 'ACTIVE', customer: 'cus_1', checkoutSession: 'chk_1' } },
      payments: { sub_1: [payment({ id: 'p1', dueDate: '2026-11-14', originalDueDate: '2026-11-14', confirmedDate: '2026-11-14' }), payment({ id: 'p2', dueDate: '2026-12-14', originalDueDate: '2026-12-14', confirmedDate: null, status: 'PENDING' })] },
      byCustomer: { cus_1: [{ id: 'sub_1', status: 'ACTIVE', customer: 'cus_1', checkoutSession: 'chk_1' }] },
    })
    const res = await reconcile()
    expect(res.statusCode).toBe(200)
    expect(res.body).toMatchObject({ ok: true, reconcile: { checked: 1, flagged: 0, reviews: 0, partial: false } })
    expect(db.rpcCalls).toEqual([])
  })

  it('(a)(b) ativa no app e parada no Asaas: marca que a renovação não vai ser cobrada', async () => {
    db.tables.billing_subscriptions.push(row({ id: 'chk_1', user_id: USER_A, asaas_subscription_id: 'sub_1' }))
    asaas = fakeAsaas({ subs: { sub_1: { id: 'sub_1', status: 'INACTIVE', customer: 'cus_1' } }, byCustomer: { cus_1: [] } })
    await reconcile()
    expect(note('chk_1')).toContain('conferencia: ativa no app, mas a assinatura sub_1 esta INACTIVE no Asaas')
  })

  it('encerrada no app e ainda ATIVA no Asaas, sem pendência de parar: marca pra parar à mão', async () => {
    db.tables.billing_subscriptions.push(row({ id: 'chk_1', user_id: USER_A, asaas_subscription_id: 'sub_1', status: 'canceled', cancel_source: 'user', access_until: '2026-12-15T03:00:00.000Z' }))
    asaas = fakeAsaas({ subs: { sub_1: { id: 'sub_1', status: 'ACTIVE', customer: 'cus_1', checkoutSession: 'chk_1' } }, byCustomer: { cus_1: [{ id: 'sub_1', status: 'ACTIVE', checkoutSession: 'chk_1' }] } })
    await reconcile()
    expect(note('chk_1')).toContain('conferencia: encerrada no app e ainda ATIVA no Asaas (sub_1)')
  })

  it('folga de 48 h: com a pendência de parar ainda tentando não marca; travada há mais de 48 h, marca', async () => {
    db.tables.billing_subscriptions.push(row({ id: 'chk_1', user_id: USER_A, asaas_subscription_id: 'sub_1', status: 'canceled', cancel_source: 'user', access_until: '2026-12-15T03:00:00.000Z' }))
    db.tables.billing_pending_actions.push({ id: 5, subscription_ref: 'chk_1', user_id: USER_A, action: 'delete_subscription', reason: 'user', status: 'pending', attempts: 3, auto_retry: true, created_at: '2026-11-15T12:00:00.000Z', next_attempt_at: '2026-11-16T12:00:00.000Z' })
    asaas = fakeAsaas({ subs: { sub_1: { id: 'sub_1', status: 'ACTIVE', customer: 'cus_1', checkoutSession: 'chk_1' } }, byCustomer: { cus_1: [{ id: 'sub_1', status: 'ACTIVE', checkoutSession: 'chk_1' }] } })
    await reconcile()
    expect(note('chk_1')).toBe('')
    db.tables.billing_pending_actions[0].created_at = '2026-11-13T12:00:00.000Z'
    await reconcile()
    expect(note('chk_1')).toContain('ainda ATIVA no Asaas')
  })

  it('(c) assinatura parada com cobrança futura em aberto: marca pra remover à mão, menos a vencida guardada', async () => {
    db.tables.billing_subscriptions.push(row({ id: 'chk_1', user_id: USER_A, asaas_subscription_id: 'sub_1', status: 'canceled', cancel_source: 'unpaid', access_until: '2026-11-15T00:00:00.000Z', asaas_stopped_at: '2026-11-15T00:00:00.000Z', last_paid_due_date: '2026-10-14', next_due_date: '2026-11-14' }))
    db.tables.billing_pending_actions.push({ id: 6, subscription_ref: 'chk_1', user_id: USER_A, action: 'inactivate_subscription', reason: 'vencida', status: 'done', asaas_payment_id: 'p_venc', due_date: '2026-11-14', attempts: 1, auto_retry: true, created_at: '2026-11-15T00:00:00.000Z' })
    asaas = fakeAsaas({
      subs: { sub_1: { id: 'sub_1', status: 'INACTIVE', customer: 'cus_1' } },
      payments: { sub_1: [
        payment({ id: 'p_venc', dueDate: '2026-11-30', originalDueDate: '2026-11-14', confirmedDate: null, status: 'PENDING' }),
        payment({ id: 'p_fut', dueDate: '2026-12-14', originalDueDate: '2026-12-14', confirmedDate: null, status: 'PENDING' }),
      ] },
      byCustomer: { cus_1: [] },
    })
    await reconcile()
    expect(note('chk_1')).toContain('conferencia: cobranca futura em aberto numa assinatura parada (p_fut)')
    expect(note('chk_1')).not.toContain('p_venc')
  })

  it('(c) com a remoção das futuras ainda tentando (menos de 48 h): não marca', async () => {
    db.tables.billing_subscriptions.push(row({ id: 'chk_1', user_id: USER_A, asaas_subscription_id: 'sub_1', status: 'canceled', cancel_source: 'unpaid', access_until: '2026-11-15T00:00:00.000Z', asaas_stopped_at: '2026-11-15T00:00:00.000Z' }))
    db.tables.billing_pending_actions.push({ id: 7, subscription_ref: 'chk_1', user_id: USER_A, action: 'delete_future_payments', reason: 'vencida', status: 'pending', attempts: 1, auto_retry: true, created_at: '2026-11-16T08:00:00.000Z', next_attempt_at: '2026-11-17T08:00:00.000Z' })
    asaas = fakeAsaas({ subs: { sub_1: { id: 'sub_1', status: 'INACTIVE' } }, payments: { sub_1: [payment({ id: 'p_fut', dueDate: '2026-12-14', confirmedDate: null, status: 'PENDING' })] }, byCustomer: { cus_1: [] } })
    await reconcile()
    expect(note('chk_1')).toBe('')
  })

  it('pagamento no Asaas que o app não contou: marca; pago hoje fica pra amanhã (folga)', async () => {
    db.tables.billing_subscriptions.push(row({ id: 'chk_1', user_id: USER_A, asaas_subscription_id: 'sub_1', status: 'canceled', cancel_source: 'unpaid', access_until: '2026-11-15T00:00:00.000Z', last_paid_due_date: '2026-10-14', next_due_date: '2026-11-14' }))
    asaas = fakeAsaas({
      subs: { sub_1: { id: 'sub_1', status: 'ACTIVE', customer: 'cus_1', checkoutSession: 'chk_1' } },
      payments: { sub_1: [payment({ id: 'p_x', dueDate: '2026-11-14', originalDueDate: '2026-11-14', confirmedDate: '2026-11-16', status: 'CONFIRMED' })] },
      byCustomer: { cus_1: [{ id: 'sub_1', status: 'ACTIVE', checkoutSession: 'chk_1' }] },
    })
    await reconcile()
    expect(note('chk_1')).not.toContain('nao contou')
    vi.setSystemTime(new Date('2026-11-17T11:00:00Z'))
    await reconcile()
    expect(note('chk_1')).toContain('conferencia: pagamento p_x no Asaas (ciclo 14/11/2026) que o app nao contou')
  })

  it('vencimento desencontrado entre o app e a cobrança em aberto do ciclo: marca', async () => {
    db.tables.billing_subscriptions.push(row({ id: 'chk_1', user_id: USER_A, asaas_subscription_id: 'sub_1', next_due_date: '2026-12-14' }))
    asaas = fakeAsaas({
      subs: { sub_1: { id: 'sub_1', status: 'ACTIVE', customer: 'cus_1', checkoutSession: 'chk_1' } },
      payments: { sub_1: [payment({ id: 'p2', dueDate: '2026-12-20', originalDueDate: '2026-12-14', confirmedDate: null, status: 'PENDING' })] },
      byCustomer: { cus_1: [{ id: 'sub_1', status: 'ACTIVE', checkoutSession: 'chk_1' }] },
    })
    await reconcile()
    expect(note('chk_1')).toContain('conferencia: vencimento desencontrado: no app 14/12/2026, no Asaas 20/12/2026 (cobranca p2)')
  })

  it('(f) duas assinaturas ATIVAS no Asaas pro mesmo cliente: marca as linhas', async () => {
    db.tables.billing_subscriptions.push(
      row({ id: 'chk_1', user_id: USER_A, asaas_subscription_id: 'sub_1' }),
      row({ id: 'chk_2', user_id: USER_A, asaas_subscription_id: 'sub_2' }),
    )
    const active = { status: 'ACTIVE', customer: 'cus_1' }
    asaas = fakeAsaas({
      subs: { sub_1: { id: 'sub_1', ...active, checkoutSession: 'chk_1' }, sub_2: { id: 'sub_2', ...active, checkoutSession: 'chk_2' } },
      byCustomer: { cus_1: [{ id: 'sub_1', ...active, checkoutSession: 'chk_1' }, { id: 'sub_2', ...active, checkoutSession: 'chk_2' }] },
    })
    await reconcile()
    expect(note('chk_1')).toContain('conferencia: 2 assinaturas ATIVAS no Asaas pro mesmo cliente (sub_1, sub_2): deixar so uma')
    expect(note('chk_2')).toContain('deixar so uma')
  })

  it('assinatura ATIVA no Asaas sem registro no app (cliente conhecido): caso pro admin', async () => {
    db.tables.billing_subscriptions.push(row({ id: 'chk_1', user_id: USER_A, asaas_subscription_id: 'sub_1' }))
    asaas = fakeAsaas({
      subs: { sub_1: { id: 'sub_1', status: 'ACTIVE', customer: 'cus_1', checkoutSession: 'chk_1' } },
      byCustomer: { cus_1: [{ id: 'sub_1', status: 'ACTIVE', checkoutSession: 'chk_1' }, { id: 'sub_9', status: 'ACTIVE', checkoutSession: 'chk_9' }] },
    })
    await reconcile()
    expect(reviews()).toContainEqual(expect.objectContaining({ subscription_ref: 'asaas:sub_9', user_id: USER_A, auto_retry: false }))
    expect(String(reviews().find((a) => a.subscription_ref === 'asaas:sub_9')!.reason)).toContain('ATIVA no Asaas sem registro no app')
  })

  it('(d) checkout antigo (em payments, sem linha) com a assinatura ATIVA no Asaas: caso pro admin', async () => {
    db.tables.payments.push({ id: 'chk_old', user_id: USER_B, plan_key: 'essencial_mensal', asaas_checkout_id: 'chk_old' })
    asaas = fakeAsaas({ byCheckout: { chk_old: 'sub_old' }, subs: { sub_old: { id: 'sub_old', status: 'ACTIVE', customer: 'cus_9', checkoutSession: 'chk_old' } } })
    await reconcile()
    expect(reviews()).toContainEqual(expect.objectContaining({ subscription_ref: 'asaas:sub_old', user_id: USER_B, auto_retry: false }))
  })

  it('folga de 2 h: linha mexida há pouco não é conferida', async () => {
    db.tables.billing_subscriptions.push(row({ id: 'chk_1', user_id: USER_A, asaas_subscription_id: 'sub_1', updated_at: '2026-11-16T10:00:00.000Z' }))
    asaas = fakeAsaas({ subs: { sub_1: { id: 'sub_1', status: 'INACTIVE' } } })
    const res = await reconcile()
    expect(res.body).toMatchObject({ reconcile: { checked: 0, skippedRecent: 1 } })
    expect(note('chk_1')).toBe('')
    expect(asaas.get).not.toHaveBeenCalledWith('/subscriptions/sub_1')
  })

  it('a mesma divergência no dia seguinte não repete a nota', async () => {
    db.tables.billing_subscriptions.push(row({ id: 'chk_1', user_id: USER_A, asaas_subscription_id: 'sub_1' }))
    asaas = fakeAsaas({ subs: { sub_1: { id: 'sub_1', status: 'INACTIVE' } }, byCustomer: { cus_1: [] } })
    await reconcile()
    const first = note('chk_1')
    db.tables.billing_subscriptions[0].updated_at = OLD
    vi.setSystemTime(new Date('2026-11-17T11:00:00Z'))
    await reconcile()
    expect(note('chk_1')).toBe(first)
  })

  it('resumo do banco: eventos esgotados e pendências com muitas tentativas', async () => {
    db.tables.asaas_webhook_events.push({ id: 'evt_x', event: 'PAYMENT_CONFIRMED', status: 'exhausted', attempts: 20 })
    db.tables.billing_pending_actions.push({ id: 8, subscription_ref: 'chk_z', user_id: USER_A, action: 'inactivate_subscription', reason: 'vencida', status: 'pending', attempts: 6, auto_retry: true, created_at: OLD, next_attempt_at: '2026-11-17T00:00:00.000Z' })
    const res = await reconcile()
    expect(res.body).toMatchObject({ reconcile: { summary: { exhaustedEvents: 1, stuckPending: 1 } } })
  })

  it('o cron da conferência está agendado com o mesmo segredo e também é reconhecido pelo cabeçalho do agendamento', async () => {
    const vercel = JSON.parse(readFileSync(new URL('../../vercel.json', import.meta.url), 'utf8')) as { crons: { path: string; schedule: string }[] }
    const { RECONCILE_CRON } = await import('../_lib/reconcile.js')
    expect(vercel.crons).toContainEqual({ path: '/api/webhook/asaas?action=reconcile', schedule: RECONCILE_CRON })
    expect(vercel.crons).toContainEqual({ path: '/api/webhook/asaas', schedule: '30 9 * * *' })
    db.tables.billing_subscriptions.push(row({ id: 'chk_1', user_id: USER_A, asaas_subscription_id: 'sub_1' }))
    asaas = fakeAsaas({ subs: { sub_1: { id: 'sub_1', status: 'INACTIVE' } }, byCustomer: { cus_1: [] } })
    const res = await reconcile({ authorization: `Bearer ${CRON}`, 'x-vercel-cron-schedule': RECONCILE_CRON }, {})
    expect(res.body).toMatchObject({ ok: true, reconcile: { checked: 1 } })
    expect(db.rpcCalls.some((c) => c.name === 'billing_daily_job')).toBe(false)
  })
})

describe('corte de tempo próprio', () => {
  it('para antes do limite e diz que ficou parcial', async () => {
    const { runReconcile } = await import('../_lib/reconcile.js')
    for (let i = 1; i <= 5; i++) db.tables.billing_subscriptions.push(row({ id: `chk_${i}`, user_id: USER_A, asaas_subscription_id: `sub_${i}` }))
    const subs = Object.fromEntries([1, 2, 3, 4, 5].map((i) => [`sub_${i}`, { id: `sub_${i}`, status: 'ACTIVE', checkoutSession: `chk_${i}` }]))
    asaas = fakeAsaas({ subs })
    let t = 0
    const out = await runReconcile({ db: db as never, asaas, now: () => new Date() }, { budgetMs: 25_000, clock: () => { t += 10_000; return t } })
    expect(out).toMatchObject({ partial: true })
    expect((out as { checked: number }).checked).toBeLessThan(5)
    expect(asaas.put).not.toHaveBeenCalled()
    expect(asaas.del).not.toHaveBeenCalled()
  })
})

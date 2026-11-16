import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { createRes, type FakeDb } from './fakeSupabase.js'
import { USER_A, createBillingDb, createFakeAsaas, payment, type FakeAsaas } from './billingHarness.js'

// COB-I7-v2: duas compras da mesma conta (duas abas, app antigo), avisos do
// Asaas em TODAS as ordens possíveis (CHECKOUT_PAID, PAYMENT_CONFIRMED e
// PAYMENT_CREATED de cada uma = 6 avisos, 720 ordens), com e sem uma falha de
// processamento no meio (reprocessada pelo job). Em todas: no fim, no máximo
// UMA assinatura paga ativa cobrando, a que fica é a certa, o admin recebe a
// marcação e nada é estornado.

const TOKEN = 'token-do-webhook-com-mais-de-32-caracteres-ok'
const CRON = 'segredo-do-cron-com-tamanho-bom-1234567890'
let db: FakeDb
let asaas: FakeAsaas
vi.mock('@supabase/supabase-js', () => ({ createClient: () => db }))
vi.mock('../_lib/asaas.js', async (orig) => ({
  ...(await orig<typeof import('../_lib/asaas.js')>()),
  asaasFromEnv: () => asaas,
}))

let handler: (req: unknown, res: unknown) => Promise<unknown>
beforeAll(async () => {
  // milhares de avisos: sem o log de cada um
  for (const m of ['log', 'warn', 'error'] as const) vi.spyOn(console, m).mockImplementation(() => {})
  vi.stubEnv('VITE_SUPABASE_URL', 'https://fake.supabase.co')
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'fake-service-role')
  vi.stubEnv('ASAAS_WEBHOOK_TOKEN', TOKEN)
  vi.stubEnv('CRON_SECRET', CRON)
  handler = (await import('../webhook/asaas.js')).default as typeof handler
})
afterEach(() => { vi.useRealTimers() })
const silence = () => { for (const m of ['log', 'warn', 'error'] as const) vi.spyOn(console, m).mockImplementation(() => {}) }

type Ev = Record<string, unknown>
function events(x: 'a' | 'b', minute: number): Ev[] {
  const at = (s: number) => `2026-11-16 12:${String(minute).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  return [
    { id: `evt_cp_${x}`, event: 'CHECKOUT_PAID', dateCreated: at(0), checkout: { id: `chk_${x}`, customer: 'cus_1' } },
    { id: `evt_pc_${x}`, event: 'PAYMENT_CONFIRMED', dateCreated: at(1), payment: payment({ id: `pay_${x}1`, subscription: `sub_${x}`, checkoutSession: `chk_${x}`, dueDate: '2026-11-16', confirmedDate: '2026-11-16', status: 'CONFIRMED' }) },
    { id: `evt_pr_${x}`, event: 'PAYMENT_CREATED', dateCreated: at(2), payment: payment({ id: `pay_${x}2`, subscription: `sub_${x}`, checkoutSession: null, dueDate: '2026-12-16', confirmedDate: null, status: 'PENDING' }) },
  ]
}

function permutations<T>(xs: T[]): T[][] {
  if (xs.length <= 1) return [xs]
  return xs.flatMap((x, i) => permutations([...xs.slice(0, i), ...xs.slice(i + 1)]).map((p) => [x, ...p]))
}

async function call(method: string, body: Ev, headers: Record<string, string>) {
  const res = createRes()
  await handler({ method, headers, body }, res)
  return res
}

async function run(order: Ev[], planB: string, failAt: number | null) {
  silence()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-11-16T15:30:00Z'))
  asaas = createFakeAsaas({
    get: (path, params) => {
      const q = (params ?? {}) as Record<string, unknown>
      if (path === '/subscriptions/sub_a') return { id: 'sub_a', checkoutSession: 'chk_a', status: 'ACTIVE' }
      if (path === '/subscriptions/sub_b') return { id: 'sub_b', checkoutSession: 'chk_b', status: 'ACTIVE' }
      if (path === '/payments' && typeof q.checkoutSession === 'string') {
        const x = String(q.checkoutSession).slice(-1)
        return { data: [payment({ id: `pay_${x}1`, subscription: `sub_${x}`, checkoutSession: q.checkoutSession, status: 'CONFIRMED' })] }
      }
      return { data: [], hasMore: false }
    },
  })
  db = createBillingDb({
    profiles: [{ id: USER_A, plan: 'free', plan_expires_at: null }],
    pending_checkouts: [
      { id: 'chk_a', user_id: USER_A, plan_key: 'essencial_mensal', created_at: '2026-11-16T14:59:00.000Z' },
      { id: 'chk_b', user_id: USER_A, plan_key: planB, created_at: '2026-11-16T14:59:30.000Z' },
    ],
  }, () => new Date())
  for (let i = 0; i < order.length; i++) {
    if (i === failAt) db.failTable('billing_subscriptions', { message: 'queda do banco no meio' })
    const res = await call('POST', order[i], { 'asaas-access-token': TOKEN })
    expect(res.statusCode).toBe(200)
    if (i === failAt) db.clearFailure('billing_subscriptions')
  }
  // job do dia seguinte reprocessa o que falhou e termina as pendências
  vi.setSystemTime(new Date('2026-11-17T09:30:00Z'))
  for (const p of db.tables.billing_pending_actions) p.next_attempt_at = '2026-11-16T00:00:00.000Z'
  await call('GET', {}, { authorization: `Bearer ${CRON}` })
  await call('GET', {}, { authorization: `Bearer ${CRON}` })
}

function check(planB: string, label: string) {
  const subs = db.tables.billing_subscriptions.filter((r) => r.kind === 'asaas')
  const active = subs.filter((r) => r.status === 'active')
  expect(active, label).toHaveLength(1)
  const keeperId = planB === 'essencial_mensal' ? 'chk_a' : 'chk_b'
  expect(active[0].id, label).toBe(keeperId)
  const other = subs.find((r) => r.id !== keeperId)!
  expect(other.status, label).toBe('canceled')
  expect(other.cancel_source, label).toBe(planB === 'essencial_mensal' ? 'duplicate' : 'superseded')
  // a outra parou de cobrar no Asaas e o admin sabe
  expect(other.asaas_stopped_at, label).toBeTruthy()
  expect(other.needs_admin_review, label).toBe(true)
  expect(db.tables.profiles[0].plan, label).toBe(planB === 'essencial_mensal' ? 'essencial_mensal' : 'pro_mensal')
  expect((asaas.post.mock.calls as [string][]).filter(([p]) => p.includes('/refund')), label).toEqual([])
  expect(db.tables.asaas_webhook_events.filter((e) => e.status !== 'done'), label).toEqual([])
}

const ORDERS = permutations([...events('a', 0), ...events('b', 0)])

describe('uma assinatura paga ativa por conta, em qualquer ordem de aviso (COB-I7-v2)', () => {
  it('há 720 ordens', () => { expect(ORDERS).toHaveLength(720) })

  for (const planB of ['essencial_mensal', 'pro_mensal']) {
    const kind = planB === 'essencial_mensal' ? 'mesmo plano' : 'planos diferentes'
    it(`${kind}: todas as ordens, sem falha`, async () => {
      for (const [n, order] of ORDERS.entries()) {
        await run(order, planB, null)
        check(planB, `${kind} ordem ${n}: ${order.map((e) => e.id).join(' ')}`)
      }
    }, 120_000)

    it(`${kind}: todas as ordens, com uma falha de processamento no meio e reprocessamento`, async () => {
      for (const [n, order] of ORDERS.entries()) {
        const failAt = n % order.length
        await run(order, planB, failAt)
        check(planB, `${kind} ordem ${n} falha no aviso ${failAt}: ${order.map((e) => e.id).join(' ')}`)
      }
    }, 120_000)
  }
})

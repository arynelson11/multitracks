import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { createRes, type FakeDb } from './fakeSupabase.js'
import { USER_A, createBillingDb, createFakeAsaas, forbiddenInWebhook, payment, type FakeAsaas } from './billingHarness.js'

// COB-I7-v2 com a rodada 4 (COB-R3, R4 e R8): duas compras da mesma conta (duas
// abas, app antigo), avisos do Asaas em TODAS as ordens possíveis
// (CHECKOUT_PAID, PAYMENT_CONFIRMED e PAYMENT_CREATED de cada uma = 6 avisos,
// 720 ordens), com horários de pagamento DISTINTOS no mesmo dia e o mesmo
// horário que o SQL grava (o PAYMENT_CONFIRMED só traz o dia: meia-noite de
// Brasília; o desempate é a hora exata do CHECKOUT_PAID). Cada ordem roda sem
// falha, com uma queda do banco num aviso (reprocessado pelo job) e com uma
// queda logo depois do corte (entre o corte e a marcação, no código antigo). Em
// todas, no fim:
// * exatamente UMA assinatura paga ativa, e é a certa (mesmo plano: a de
//   pagamento confirmado mais antigo; planos diferentes: o checkout criado por
//   último);
// * a outra encerrada, parada no Asaas, com a renovação já gerada removida (ou a
//   assinatura removida, na troca de plano) e a da que fica intocada;
// * o admin marcado, com a nota certa;
// * o perfil no plano certo, nenhum evento sobrando;
// * em tempo de execução: nenhum POST de estorno e nada do cancelamento do
//   usuário (forbiddenInWebhook).

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
type X = 'a' | 'b'
// Avisos de uma compra paga às 12:MM de Brasília (dateCreated sem fuso = Brasília).
function events(x: X, minute: number): Ev[] {
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

// Duas configurações, pra a regra não passar por acaso: na 1ª a compra aberta
// primeiro também é paga primeiro; na 2ª, a aberta primeiro é paga por último.
type Config = { name: string; paidMinute: Record<X, number>; keeperSamePlan: X; keeperOtherPlan: X }
const CREATED: Record<X, string> = { a: '2026-11-16T14:59:00.000Z', b: '2026-11-16T14:59:30.000Z' }
const CONFIGS: Config[] = [
  { name: 'A aberta e paga primeiro (12:00 e 12:05)', paidMinute: { a: 0, b: 5 }, keeperSamePlan: 'a', keeperOtherPlan: 'b' },
  { name: 'A aberta primeiro, B paga primeiro (12:00 e 12:05)', paidMinute: { a: 5, b: 0 }, keeperSamePlan: 'b', keeperOtherPlan: 'b' },
]

type Failure = 'nenhuma' | 'queda num aviso' | 'queda logo depois do corte'
const FAILURES: Failure[] = ['nenhuma', 'queda num aviso', 'queda logo depois do corte']

// A próxima chamada ao banco logo depois do primeiro corte cai (uma vez).
function dropAfterFirstCut(target: FakeDb) {
  const orig = target.rpc.bind(target)
  let armed = false
  let fired = false
  target.rpc = async (name: string, args: Record<string, unknown> = {}) => {
    if (armed) { armed = false; return { data: null, error: { message: 'queda logo depois do corte' } } }
    const res = await orig(name, args)
    if (!fired && name === 'billing_end_subscription' && ['duplicate', 'superseded'].includes(String(args.p_source))) { armed = true; fired = true }
    return res
  }
}

async function run(order: Ev[], planB: string, failure: Failure, failAt: number) {
  silence()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-11-16T15:30:00Z'))
  // Asaas falso com estado: as cobranças de cada assinatura e as que já saíram
  const removed = new Set<string>()
  const charges = (x: string) => [
    payment({ id: `pay_${x}1`, subscription: `sub_${x}`, checkoutSession: `chk_${x}`, dueDate: '2026-11-16', originalDueDate: '2026-11-16', status: 'CONFIRMED' }),
    payment({ id: `pay_${x}2`, subscription: `sub_${x}`, checkoutSession: null, dueDate: '2026-12-16', originalDueDate: '2026-12-16', status: 'PENDING', confirmedDate: null }),
  ].filter((p) => !removed.has(p.id))
  asaas = createFakeAsaas({
    get: (path, params) => {
      const q = (params ?? {}) as Record<string, unknown>
      const sub = /^\/subscriptions\/sub_([ab])$/.exec(path)
      if (sub) return { id: `sub_${sub[1]}`, checkoutSession: `chk_${sub[1]}`, status: 'ACTIVE' }
      const one = /^\/payments\/pay_([ab])([12])$/.exec(path)
      if (one) return charges(one[1]).find((p) => p.id === `pay_${one[1]}${one[2]}`) ?? { id: path.slice(10), status: 'PENDING', deleted: true }
      if (path === '/payments' && typeof q.checkoutSession === 'string') {
        return { data: charges(String(q.checkoutSession).slice(-1)).filter((p) => p.checkoutSession === q.checkoutSession) }
      }
      if (path === '/payments' && typeof q.subscription === 'string') return { data: charges(String(q.subscription).slice(-1)), hasMore: false }
      return { data: [], hasMore: false }
    },
    del: (path) => { removed.add(path.replace('/payments/', '')); return { deleted: true } },
  })
  db = createBillingDb({
    profiles: [{ id: USER_A, plan: 'free', plan_expires_at: null }],
    pending_checkouts: [
      { id: 'chk_a', user_id: USER_A, plan_key: 'essencial_mensal', created_at: CREATED.a },
      { id: 'chk_b', user_id: USER_A, plan_key: planB, created_at: CREATED.b },
    ],
  }, () => new Date())
  if (failure === 'queda logo depois do corte') dropAfterFirstCut(db)
  for (let i = 0; i < order.length; i++) {
    const drop = failure === 'queda num aviso' && i === failAt
    if (drop) db.failTable('billing_subscriptions', { message: 'queda do banco no meio' })
    const res = await call('POST', order[i], { 'asaas-access-token': TOKEN })
    expect(res.statusCode).toBe(200)
    if (drop) db.clearFailure('billing_subscriptions')
  }
  // job do dia seguinte reprocessa o que falhou e termina as pendências
  vi.setSystemTime(new Date('2026-11-17T09:30:00Z'))
  for (const p of db.tables.billing_pending_actions) p.next_attempt_at = '2026-11-16T00:00:00.000Z'
  await call('GET', {}, { authorization: `Bearer ${CRON}` })
  for (const p of db.tables.billing_pending_actions) p.next_attempt_at = '2026-11-16T00:00:00.000Z'
  await call('GET', {}, { authorization: `Bearer ${CRON}` })
}

function check(cfg: Config, planB: string, label: string) {
  const samePlan = planB === 'essencial_mensal'
  const k = samePlan ? cfg.keeperSamePlan : cfg.keeperOtherPlan
  const o: X = k === 'a' ? 'b' : 'a'
  const subs = db.tables.billing_subscriptions.filter((r) => r.kind === 'asaas')
  const active = subs.filter((r) => r.status === 'active')
  expect(active, label).toHaveLength(1)
  expect(active[0].id, label).toBe(`chk_${k}`)
  const other = subs.find((r) => r.id === `chk_${o}`)!
  expect(other.status, label).toBe('canceled')
  expect(other.cancel_source, label).toBe(samePlan ? 'duplicate' : 'superseded')
  // a outra parou de cobrar no Asaas e o admin sabe, com a nota certa (COB-R3)
  expect(other.asaas_stopped_at, label).toBeTruthy()
  expect(other.needs_admin_review, label).toBe(true)
  expect(String(other.admin_note), label).toContain(samePlan ? `compra duplicada: estornar a mao (ficou a chk_${k})` : 'troca de plano fora do Alterar Plano')
  expect(db.tables.profiles[0].plan, label).toBe(samePlan ? 'essencial_mensal' : 'pro_mensal')
  // a renovação já gerada da outra não cobra; a da que fica é intocada
  const puts = (asaas.put.mock.calls as [string, unknown][]).map(([p]) => p)
  const dels = (asaas.del.mock.calls as [string][]).map(([p]) => p)
  expect(puts.filter((p) => p === `/subscriptions/sub_${k}`), label).toEqual([])
  expect(dels.filter((p) => p.includes(`sub_${k}`) || p.includes(`pay_${k}`)), label).toEqual([])
  if (samePlan) {
    expect(puts, label).toContain(`/subscriptions/sub_${o}`)
    expect(dels, label).toContain(`/payments/pay_${o}2`)
    expect(dels, label).not.toContain(`/payments/pay_${o}1`)
  } else {
    expect(dels, label).toContain(`/subscriptions/sub_${o}`)
  }
  // COB-R8: em tempo de execução, nenhum estorno e nada do cancelamento do usuário
  expect(forbiddenInWebhook(db, asaas), label).toEqual([])
  expect(db.tables.asaas_webhook_events.filter((e) => e.status !== 'done'), label).toEqual([])
}

describe('uma assinatura paga ativa por conta, em qualquer ordem de aviso (COB-I7-v2, rodada 4)', () => {
  for (const cfg of CONFIGS) {
    const ORDERS = permutations([...events('a', cfg.paidMinute.a), ...events('b', cfg.paidMinute.b)])
    it(`${cfg.name}: há 720 ordens`, () => { expect(ORDERS).toHaveLength(720) })

    for (const planB of ['essencial_mensal', 'pro_mensal']) {
      const kind = planB === 'essencial_mensal' ? 'mesmo plano' : 'planos diferentes'
      for (const failure of FAILURES) {
        it(`${cfg.name}, ${kind}, falha: ${failure}`, async () => {
          for (const [n, order] of ORDERS.entries()) {
            const failAt = n % order.length
            await run(order, planB, failure, failAt)
            check(cfg, planB, `${cfg.name}, ${kind}, ${failure}${failure === 'queda num aviso' ? ` no aviso ${failAt}` : ''}, ordem ${n}: ${order.map((e) => e.id).join(' ')}`)
          }
        }, 180_000)
      }
    }
  }
})

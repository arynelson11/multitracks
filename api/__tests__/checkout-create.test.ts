import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRes, type FakeDb } from './fakeSupabase.js'
import { USER_A, createBillingDb, subRow } from './billingHarness.js'
import { PLAN_PRICING, type PlanKey } from '../_lib/pricing.js'

// Criar checkout: recusa (409) quando já existe assinatura ativa do mesmo
// plano (duas abas, app antigo) e nunca devolve detalhe do Asaas ao navegador.

const post = vi.fn()
let db: FakeDb
vi.mock('axios', () => ({ default: { create: () => ({ post }), isAxiosError: () => false } }))
vi.mock('@supabase/supabase-js', () => ({ createClient: () => db }))
vi.mock('../_lib/auth.js', () => ({
  verifyUser: vi.fn(async () => ({ ok: true, userId: USER_A, email: 'quem@igreja.com', isAdmin: false })),
}))

async function create(planKey: string, extra: Record<string, unknown> = {}) {
  const { default: handler } = await import('../checkout.js')
  const res = createRes()
  await handler({ method: 'POST', headers: { authorization: 'Bearer x' }, body: { planKey, ...extra } }, res)
  return res
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-11-16T15:00:00Z'))
  vi.stubEnv('ASAAS_API_KEY', 'fake-key')
  vi.stubEnv('VITE_SUPABASE_URL', 'https://fake.supabase.co')
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'fake-service-role')
  post.mockReset()
  post.mockResolvedValue({ data: { id: 'chk_9', link: 'https://asaas.test/c/chk_9' } })
  db = createBillingDb({ profiles: [{ id: USER_A, plan: 'free', plan_expires_at: null }] })
})
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs() })

describe('checkout: compra duplicada (I7)', () => {
  it('assinatura ativa do mesmo plano: 409 com mensagem clara e nenhum checkout no Asaas', async () => {
    db.tables.billing_subscriptions.push(subRow({ id: 'chk_1', user_id: USER_A, plan_key: 'essencial_mensal' }))
    const res = await create('essencial_mensal')
    expect(res.statusCode).toBe(409)
    expect((res.body as { error: string }).error).toContain('Você já tem o Pro Mensal ativo')
    expect(post).not.toHaveBeenCalled()
  })

  it('assinante de antes desta versão (só profiles.plan) também é barrado no mesmo plano', async () => {
    db.tables.profiles[0].plan = 'pro_anual'
    expect((await create('pro_anual')).statusCode).toBe(409)
    expect(post).not.toHaveBeenCalled()
  })

  it('outro plano (troca) segue normal', async () => {
    db.tables.billing_subscriptions.push(subRow({ id: 'chk_1', user_id: USER_A, plan_key: 'essencial_mensal' }))
    db.tables.profiles[0].plan = 'essencial_mensal'
    const res = await create('pro_mensal')
    expect(res.statusCode).toBe(200)
    expect(res.body).toEqual({ url: 'https://asaas.test/c/chk_9' })
  })

  it('assinatura cancelada ainda no período pago pode assinar de novo o mesmo plano', async () => {
    db.tables.billing_subscriptions.push(subRow({ id: 'chk_1', user_id: USER_A, status: 'canceled', access_until: '2026-12-17T03:00:00Z' }))
    Object.assign(db.tables.profiles[0], { plan: 'essencial_mensal', plan_expires_at: '2026-12-17T03:00:00Z' })
    expect((await create('essencial_mensal')).statusCode).toBe(200)
  })
})

describe('checkout: troca confirmada na tela (I7)', () => {
  it('grava se a pessoa confirmou o "Trocar de plano?"', async () => {
    await create('pro_mensal', { confirmedSwitch: true })
    expect(db.tables.pending_checkouts[0]).toMatchObject({ id: 'chk_9', plan_key: 'pro_mensal', switch_confirmed: true })
  })
  it('sem confirmação (Livre, app antigo) grava falso', async () => {
    await create('pro_mensal')
    expect(db.tables.pending_checkouts[0].switch_confirmed).toBe(false)
  })
})

describe('checkout: erro do Asaas', () => {
  it('não devolve detalhe do Asaas ao navegador', async () => {
    post.mockRejectedValue(Object.assign(new Error('Request failed'), { response: { data: { errors: [{ code: 'invalid_x', description: 'detalhe interno' }] } } }))
    const res = await create('pro_mensal')
    expect(res.statusCode).toBe(502)
    expect(JSON.stringify(res.body)).not.toContain('detalhe interno')
    expect(res.body).not.toHaveProperty('details')
  })
})

describe('checkout: item dentro dos limites do Asaas (NOME-ITEM)', () => {
  // docs.asaas.com/reference/criar-novo-checkout: items[].name até 30
  // caracteres, items[].description até 150. "Playback Studio Studio (mensal)"
  // tinha 31 e podia derrubar a venda do Studio Mensal.
  const planKeys = Object.keys(PLAN_PRICING) as PlanKey[]

  it('cobre os 4 planos que o checkout aceita', () => {
    expect([...planKeys].sort()).toEqual(['essencial_anual', 'essencial_mensal', 'pro_anual', 'pro_mensal'])
  })

  it.each(planKeys)('%s: name é o nome curto do plano (até 30) e description até 150', async (planKey) => {
    const plan = PLAN_PRICING[planKey]
    const res = await create(planKey)
    expect(res.statusCode).toBe(200)
    expect(post).toHaveBeenCalledTimes(1)
    const [path, payload] = post.mock.calls[0] as [string, { items: Array<Record<string, unknown>>; subscription: Record<string, unknown> }]
    expect(path).toBe('/checkouts')
    expect(payload.items).toHaveLength(1)
    const item = payload.items[0] as { name: string; description: string; quantity: number; value: number }
    expect(item.name).toBe(plan.label)
    expect(item.name.length).toBeLessThanOrEqual(30)
    expect(item.description).toBe(plan.description)
    expect(item.description.length).toBeLessThanOrEqual(150)
    // nada mais muda: valor, quantidade e ciclo seguem os mesmos
    expect(item.quantity).toBe(1)
    expect(item.value).toBe(plan.value)
    expect(payload.subscription.cycle).toBe(plan.cycle)
  })
})

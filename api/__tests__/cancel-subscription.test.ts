import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AsaasError } from '../_lib/asaas.js'
import { createRes, type FakeDb } from './fakeSupabase.js'
import { USER_A, USER_B, USER_C, asaasDown, asaasRejected, createBillingDb, createFakeAsaas, payment, subRow, type FakeAsaas } from './billingHarness.js'

// POST /api/checkout?action=cancel (botão "Cancelar assinatura"). O cancelamento
// mora no endpoint de checkout porque a Vercel do plano atual aceita no máximo
// 12 funções em api/ e já são 12. Supabase e Asaas falsos.

let db: FakeDb
let asaas: FakeAsaas | null
let authUser: string | null = USER_A

vi.mock('@supabase/supabase-js', () => ({ createClient: () => db }))
vi.mock('../_lib/auth.js', () => ({
  verifyUser: vi.fn(async () => authUser
    ? { ok: true, userId: authUser, email: 'quem@igreja.com', isAdmin: false }
    : { ok: false, status: 401, error: 'Missing Bearer token' }),
}))
vi.mock('../_lib/asaas.js', async (orig) => ({
  ...(await orig<typeof import('../_lib/asaas.js')>()),
  asaasFromEnv: () => asaas,
}))

async function cancel(body: Record<string, unknown> = {}) {
  const { default: handler } = await import('../checkout.js')
  const res = createRes()
  await handler({ method: 'POST', headers: { authorization: 'Bearer x' }, query: { action: 'cancel' }, body }, res)
  return res
}

// Cobranças do Asaas por assinatura (GET /payments?subscription=...)
function paymentsBySub(map: Record<string, Record<string, unknown>[]>) {
  return async (path: string, params?: unknown) => {
    const sub = (params as { subscription?: string } | undefined)?.subscription
    if (path === '/payments' && sub) return { data: map[sub] ?? [], hasMore: false }
    return { data: [], hasMore: false }
  }
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-11-16T15:00:00Z'))
  vi.stubEnv('VITE_SUPABASE_URL', 'https://fake.supabase.co')
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'fake-service-role')
  authUser = USER_A
  asaas = createFakeAsaas()
  db = createBillingDb({
    profiles: [
      { id: USER_A, plan: 'essencial_mensal', plan_expires_at: null },
      { id: USER_B, plan: 'pro_mensal', plan_expires_at: null },
      { id: USER_C, plan: 'free', plan_expires_at: null },
    ],
    billing_subscriptions: [
      subRow({ id: 'chk_a', user_id: USER_A, asaas_subscription_id: 'sub_a', paid_until: '2026-11-17T03:00:00.000Z' }),
      subRow({ id: 'chk_b', user_id: USER_B, plan_key: 'pro_mensal', asaas_subscription_id: 'sub_b', paid_until: '2026-12-11T03:00:00.000Z' }),
    ],
  })
  // A: assinou em 16/10, renovou em 16/11 (passou dos 7 dias da primeira compra)
  asaas.get.mockImplementation(paymentsBySub({
    sub_a: [
      payment({ id: 'pay_a1', subscription: 'sub_a', dueDate: '2026-10-16', confirmedDate: '2026-10-16', status: 'RECEIVED' }),
      payment({ id: 'pay_a2', subscription: 'sub_a', dueDate: '2026-11-16', confirmedDate: '2026-11-16', status: 'CONFIRMED' }),
    ],
    sub_b: [payment({ id: 'pay_b1', subscription: 'sub_b', dueDate: '2026-11-10', confirmedDate: '2026-11-10' })],
  }))
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
})

describe('cancelar assinatura: quem pode', () => {
  it('sem login: 401 e nada acontece', async () => {
    authUser = null
    const res = await cancel()
    expect(res.statusCode).toBe(401)
    expect(asaas!.del).not.toHaveBeenCalled()
    expect(db.rpcCalls).toHaveLength(0)
  })

  it('cancela só a assinatura de quem está logado, mesmo que o pedido traga o id de outra', async () => {
    const res = await cancel({ subscriptionId: 'sub_b', userId: USER_B, checkoutId: 'chk_b' })
    expect(res.statusCode).toBe(200)
    expect(asaas!.del).toHaveBeenCalledTimes(1)
    expect(asaas!.del).toHaveBeenCalledWith('/subscriptions/sub_a')
    const ends = db.rpcCalls.filter((c) => c.name === 'billing_end_subscription')
    expect(ends.map((c) => c.args.p_id)).toEqual(['chk_a'])
    expect(db.tables.billing_subscriptions.find((r) => r.id === 'chk_b')!.status).toBe('active')
    expect(db.tables.profiles.find((p) => p.id === USER_B)!.plan).toBe('pro_mensal')
  })

  it('quem não tem assinatura e manda o id da de outro recebe 404 e nada muda', async () => {
    authUser = USER_C
    const res = await cancel({ subscriptionId: 'sub_b', userId: USER_B })
    expect(res.statusCode).toBe(404)
    expect((res.body as { error: string }).error).toContain('Não encontramos uma assinatura ativa')
    expect(asaas!.del).not.toHaveBeenCalled()
    expect(asaas!.post).not.toHaveBeenCalled()
    expect(db.rpcCalls.some((c) => c.name === 'billing_end_subscription')).toBe(false)
    expect(db.tables.billing_subscriptions.find((r) => r.id === 'chk_b')!.status).toBe('active')
  })
})

describe('cancelar assinatura: o que acontece', () => {
  it('depois dos 7 dias: sem estorno, fica com o plano até o fim do período pago', async () => {
    const res = await cancel()
    expect(res.statusCode).toBe(200)
    expect(res.body).toMatchObject({ result: 'canceled', refunded: false, accessUntil: '2026-12-17T03:00:00.000Z', plan: 'essencial_mensal' })
    expect(asaas!.post).not.toHaveBeenCalled()
    expect(db.rpcCalls.find((c) => c.name === 'billing_end_subscription')!.args).toEqual({ p_id: 'chk_a', p_source: 'user', p_paid_due_date: '2026-11-16', p_immediate: false })
    expect(db.tables.profiles.find((p) => p.id === USER_A)).toMatchObject({ plan: 'essencial_mensal', plan_expires_at: '2026-12-17T03:00:00.000Z' })
    expect(db.tables.billing_subscriptions.find((r) => r.id === 'chk_a')!.asaas_deleted_at).toBeTruthy()
  })

  it('até 7 dias da primeira compra: estorna e volta pro Livre na hora', async () => {
    authUser = USER_B
    const res = await cancel()
    expect(res.statusCode).toBe(200)
    expect(res.body).toMatchObject({ result: 'canceled', refunded: true })
    expect(asaas!.post).toHaveBeenCalledWith('/payments/pay_b1/refund', { description: 'Arrependimento em ate 7 dias (cancelado pelo app)' })
    expect(asaas!.del).toHaveBeenCalledWith('/subscriptions/sub_b')
    // estorno antes de remover a assinatura
    expect(asaas!.post.mock.invocationCallOrder[0]).toBeLessThan(asaas!.del.mock.invocationCallOrder[0])
    expect(db.rpcCalls.find((c) => c.name === 'billing_end_subscription')!.args).toMatchObject({ p_source: 'user_refund', p_immediate: true })
    expect(db.tables.profiles.find((p) => p.id === USER_B)!.plan).toBe('free')
  })

  it('cancelar de novo devolve a mesma data, sem chamar o Asaas', async () => {
    await cancel()
    asaas!.get.mockClear(); asaas!.del.mockClear()
    const res = await cancel()
    expect(res.statusCode).toBe(200)
    expect(res.body).toMatchObject({ result: 'already_canceled', accessUntil: '2026-12-17T03:00:00.000Z' })
    expect(asaas!.del).not.toHaveBeenCalled()
  })
})

describe('cancelar assinatura: Asaas fora do ar (erro claro, nada pela metade)', () => {
  it('falha ao ler as cobranças: 502 e nada muda', async () => {
    asaas!.get.mockRejectedValue(asaasDown())
    const res = await cancel()
    expect(res.statusCode).toBe(502)
    expect((res.body as { error: string }).error).toContain('nada mudou')
    expect(asaas!.del).not.toHaveBeenCalled()
    expect(db.rpcCalls.some((c) => c.name === 'billing_end_subscription')).toBe(false)
    expect(db.tables.profiles.find((p) => p.id === USER_A)!.plan_expires_at).toBeNull()
  })

  it('falha ao remover a assinatura: 502 e nada muda', async () => {
    asaas!.del.mockRejectedValue(asaasDown())
    const res = await cancel()
    expect(res.statusCode).toBe(502)
    expect((res.body as { error: string }).error).toContain('nada mudou')
    expect(db.rpcCalls.some((c) => c.name === 'billing_end_subscription')).toBe(false)
    expect(db.tables.billing_subscriptions.find((r) => r.id === 'chk_a')!.status).toBe('active')
  })

  it('estorno recusado no arrependimento: nada cancelado, nada mudou', async () => {
    authUser = USER_B
    asaas!.post.mockRejectedValue(asaasRejected('saldo insuficiente'))
    const res = await cancel()
    expect(res.statusCode).toBe(502)
    expect((res.body as { error: string }).error).toContain('Nada foi cancelado')
    expect(asaas!.del).not.toHaveBeenCalled()
    expect(db.tables.profiles.find((p) => p.id === USER_B)!.plan).toBe('pro_mensal')
  })

  it('banco falha depois de cancelar no Asaas: avisa que nada mais será cobrado; tentar de novo conclui', async () => {
    const original = db.setRpc('billing_end_subscription', () => { throw new Error('connection reset') })!
    const res = await cancel()
    expect(res.statusCode).toBe(500)
    expect((res.body as { error: string }).error).toContain('nada mais será cobrado')
    // segunda tentativa: o Asaas responde 404 (já removida) e o registro termina
    db.setRpc('billing_end_subscription', original)
    asaas!.del.mockRejectedValue(new AsaasError('not_found', 'não encontrado no Asaas', 404))
    const again = await cancel()
    expect(again.statusCode).toBe(200)
    expect(db.tables.billing_subscriptions.find((r) => r.id === 'chk_a')!.status).toBe('canceled')
  })

  it('servidor sem a chave do Asaas: erro claro', async () => {
    asaas = null
    const res = await cancel()
    expect(res.statusCode).toBe(500)
    expect((res.body as { error: string }).error).toContain('indisponível')
  })
})

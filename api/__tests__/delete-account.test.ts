import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRes, type FakeDb } from './fakeSupabase.js'
import { USER_A, USER_C, asaasDown, createBillingDb, createFakeAsaas, payment, subRow, type FakeAsaas } from './billingHarness.js'

// Excluir a conta cancela a assinatura ANTES de apagar qualquer coisa
// (senão o cartão seguiria sendo cobrado por uma conta que não existe).
// Cancelamento imediato; dentro de 7 dias da primeira cobrança, com o mesmo
// estorno do arrependimento. Se o Asaas falhar, nada é apagado.

let db: FakeDb
let asaas: FakeAsaas | null
let authUser = USER_A
const deleteUser = vi.fn()

vi.mock('@supabase/supabase-js', () => ({ createClient: () => Object.assign(db, { auth: { admin: { deleteUser } } }) }))
vi.mock('../_lib/auth.js', () => ({
  verifyUser: vi.fn(async () => ({ ok: true, userId: authUser, email: 'quem@igreja.com', isAdmin: false })),
}))
vi.mock('../_lib/asaas.js', async (orig) => ({
  ...(await orig<typeof import('../_lib/asaas.js')>()),
  asaasFromEnv: () => asaas,
}))

async function remove() {
  const { default: handler } = await import('../delete-account.js')
  const res = createRes()
  await handler({ method: 'POST', headers: { authorization: 'Bearer x' }, body: {} }, res)
  return res
}

const paymentsOf = (list: Record<string, unknown>[]) => async (path: string) => (path === '/payments' ? { data: list, hasMore: false } : { data: [] })

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-11-16T15:00:00Z'))
  vi.stubEnv('VITE_SUPABASE_URL', 'https://fake.supabase.co')
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'fake-service-role')
  authUser = USER_A
  deleteUser.mockReset()
  deleteUser.mockResolvedValue({ data: {}, error: null })
  asaas = createFakeAsaas()
  db = createBillingDb({
    profiles: [{ id: USER_A, plan: 'essencial_mensal', plan_expires_at: null }, { id: USER_C, plan: 'free' }],
    billing_subscriptions: [subRow({ id: 'chk_a', user_id: USER_A, asaas_subscription_id: 'sub_a', paid_until: '2026-12-17T03:00:00.000Z' })],
  })
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
})

describe('excluir conta', () => {
  it('assinante depois dos 7 dias: cancela na hora no Asaas, sem estorno, e só então apaga', async () => {
    asaas!.get.mockImplementation(paymentsOf([
      payment({ id: 'p1', subscription: 'sub_a', dueDate: '2026-10-16', confirmedDate: '2026-10-16', status: 'RECEIVED' }),
      payment({ id: 'p2', subscription: 'sub_a', dueDate: '2026-11-16', confirmedDate: '2026-11-16' }),
    ]))
    const res = await remove()
    expect(res.statusCode).toBe(200)
    expect(asaas!.post).not.toHaveBeenCalled()
    expect(asaas!.del).toHaveBeenCalledWith('/subscriptions/sub_a')
    expect(db.rpcCalls.find((c) => c.name === 'billing_end_subscription')!.args).toMatchObject({ p_source: 'account_deleted', p_immediate: true, p_already_stopped: true })
    expect(deleteUser).toHaveBeenCalledWith(USER_A)
    expect(asaas!.del.mock.invocationCallOrder[0]).toBeLessThan(deleteUser.mock.invocationCallOrder[0])
  })

  it('assinante em até 7 dias da primeira cobrança: estorna como no arrependimento e apaga', async () => {
    asaas!.get.mockImplementation(paymentsOf([payment({ id: 'p1', subscription: 'sub_a', dueDate: '2026-11-12', confirmedDate: '2026-11-12' })]))
    const res = await remove()
    expect(res.statusCode).toBe(200)
    expect(asaas!.post).toHaveBeenCalledWith('/payments/p1/refund', expect.any(Object))
    expect(db.rpcCalls.find((c) => c.name === 'billing_end_subscription')!.args).toMatchObject({ p_source: 'user_refund', p_immediate: true })
    expect(deleteUser).toHaveBeenCalledWith(USER_A)
  })

  it('Asaas fora do ar: erro claro e nada é apagado', async () => {
    asaas!.get.mockRejectedValue(asaasDown())
    const res = await remove()
    expect(res.statusCode).toBe(502)
    expect((res.body as { error: string }).error).toContain('não foi excluída')
    expect(deleteUser).not.toHaveBeenCalled()
    expect(db.tables.profiles.find((p) => p.id === USER_A)).toBeTruthy()
    expect(db.writes.some((w) => w.table === 'profiles' && w.op === 'delete')).toBe(false)
  })

  it('I1: o Asaas não confirma a remoção: corta aqui, deixa pendente e NÃO apaga; na nova tentativa termina e apaga', async () => {
    asaas!.get.mockImplementation(paymentsOf([payment({ id: 'p2', subscription: 'sub_a', dueDate: '2026-10-16', confirmedDate: '2026-10-16' }), payment({ id: 'p3', subscription: 'sub_a', dueDate: '2026-11-16', confirmedDate: '2026-11-16' })]))
    asaas!.del.mockRejectedValue(asaasDown())
    const first = await remove()
    expect(first.statusCode).toBe(409)
    expect((first.body as { error: string }).error).toContain('não foi excluída')
    expect(deleteUser).not.toHaveBeenCalled()
    expect(db.tables.billing_pending_actions[0]).toMatchObject({ action: 'delete_subscription', status: 'pending' })
    asaas!.del.mockResolvedValue({ deleted: true })
    const again = await remove()
    expect(again.statusCode).toBe(200)
    expect(db.tables.billing_pending_actions[0].status).toBe('done')
    expect(deleteUser).toHaveBeenCalledWith(USER_A)
  })

  it('quem não tem assinatura apaga normalmente, sem falar com o Asaas', async () => {
    authUser = USER_C
    const res = await remove()
    expect(res.statusCode).toBe(200)
    expect(asaas!.get).not.toHaveBeenCalled()
    expect(deleteUser).toHaveBeenCalledWith(USER_C)
  })

  it('sem a chave do Asaas, quem não tem assinatura ainda consegue apagar', async () => {
    authUser = USER_C
    asaas = null
    expect((await remove()).statusCode).toBe(200)
    expect(deleteUser).toHaveBeenCalledWith(USER_C)
  })

  it('sem a chave do Asaas, assinante não apaga (a cobrança seguiria)', async () => {
    asaas = null
    const res = await remove()
    expect(res.statusCode).toBe(500)
    expect(deleteUser).not.toHaveBeenCalled()
  })

  it('a assinatura cancelou mas o login não apagou: avisa as duas coisas', async () => {
    authUser = USER_C
    deleteUser.mockResolvedValue({ data: null, error: { message: 'boom' } })
    const res = await remove()
    expect(res.statusCode).toBe(500)
    expect((res.body as { error: string }).error).toContain('Não foi possível excluir a conta')
  })
})

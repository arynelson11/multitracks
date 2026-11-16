import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createRes, type FakeDb } from './fakeSupabase.js'
import { USER_A, createBillingDb, createFakeAsaas, payment } from './billingHarness.js'

// Todas as datas de cobrança são do dia em Brasília (America/Sao_Paulo), não
// de UTC. 21:30 de 16/11 em Brasília já é 00:30 de 17/11 em UTC.
const BRT_2130 = new Date('2026-11-17T00:30:00Z')

const post = vi.fn()
let db: FakeDb
vi.mock('axios', () => ({
  default: { create: () => ({ post }), isAxiosError: () => false },
}))
vi.mock('@supabase/supabase-js', () => ({ createClient: () => db }))
vi.mock('../_lib/auth.js', () => ({
  verifyUser: vi.fn(async () => ({ ok: true, userId: USER_A, email: 'quem@igreja.com', isAdmin: false })),
}))

import { activateFromCheckout, brtToday, toBrtDate, withdrawalStatus } from '../_lib/billing.js'

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(BRT_2130)
  vi.stubEnv('ASAAS_API_KEY', 'fake-key')
  vi.stubEnv('VITE_SUPABASE_URL', 'https://fake.supabase.co')
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'fake-service-role')
  post.mockReset()
  post.mockResolvedValue({ data: { id: 'chk_1', link: 'https://asaas.test/c/chk_1' } })
  db = createBillingDb({ profiles: [{ id: USER_A, plan: 'free' }] }, () => BRT_2130)
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
})

describe('datas de cobrança no fuso de Brasília', () => {
  it('21:30 de Brasília ainda é o mesmo dia', () => {
    expect(brtToday(BRT_2130)).toBe('2026-11-16')
    expect(toBrtDate('2026-11-17T00:30:00Z')).toBe('2026-11-16')
    expect(toBrtDate('2026-11-17T00:30:00+0000')).toBe('2026-11-16')
  })

  it('checkout criado às 21:30 de Brasília manda a 1ª cobrança pra hoje, não pra amanhã', async () => {
    const { default: handler } = await import('../checkout.js')
    const res = createRes()
    await handler({ method: 'POST', headers: { authorization: 'Bearer x' }, body: { planKey: 'essencial_mensal' } }, res)
    expect(res.statusCode).toBe(200)
    const payload = post.mock.calls[0][1] as { subscription: { nextDueDate: string } }
    expect(payload.subscription.nextDueDate).toBe('2026-11-16')
  })

  it('ativação sem data do Asaas usa o dia de Brasília', async () => {
    await activateFromCheckout({ db: db as unknown as SupabaseClient, asaas: createFakeAsaas(), now: () => BRT_2130 }, { checkoutId: 'chk_1', userId: USER_A, planKey: 'essencial_mensal' })
    expect(db.rpcCalls[0].args.p_paid_due_date).toBe('2026-11-16')
  })

  it('7º dia do arrependimento vale até as 23:59 de Brasília', () => {
    const one = [payment({ confirmedDate: '2026-11-09', dueDate: '2026-11-09' })]
    expect(withdrawalStatus(one, BRT_2130)).not.toBeNull()
    // 00:30 de 17/11 em Brasília (03:30 UTC) já é o 8º dia
    expect(withdrawalStatus(one, new Date('2026-11-17T03:30:00Z'))).toBeNull()
  })
})

import { beforeEach, describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { BillingError, cancelSubscriptionForUser, changePlan, endCourtesy, grantCourtesy, latestPaidDueDate, toBrtDate, withdrawalStatus } from '../_lib/billing.js'
import type { FakeDb } from './fakeSupabase.js'
import { USER_A, USER_B, asaasDown, createBillingDb, createFakeAsaas, payment, subRow, type FakeAsaas } from './billingHarness.js'

// Funções de api/_lib/billing.ts que o futuro painel admin vai chamar.

const now = () => new Date('2026-11-16T15:00:00Z')
let db: FakeDb
let asaas: FakeAsaas
const deps = () => ({ db: db as unknown as SupabaseClient, asaas, now })

beforeEach(() => {
  asaas = createFakeAsaas()
  db = createBillingDb({
    profiles: [{ id: USER_A, plan: 'essencial_mensal', plan_expires_at: null }, { id: USER_B, plan: 'free' }],
    billing_subscriptions: [subRow({ id: 'chk_1', user_id: USER_A, asaas_subscription_id: 'sub_1', paid_until: '2026-12-17T03:00:00.000Z' })],
  }, now)
})

describe('changePlan', () => {
  it('troca valor e ciclo no Asaas (vale na próxima cobrança) e o plano na hora', async () => {
    const out = await changePlan(deps(), { userId: USER_A, newPlanKey: 'pro_anual' })
    expect(out).toEqual({ result: 'changed', planKey: 'pro_anual' })
    expect(asaas.put).toHaveBeenCalledWith('/subscriptions/sub_1', { value: 1078.8, cycle: 'YEARLY', description: 'Playback Studio Studio (anual)', updatePendingPayments: true })
    expect(db.tables.profiles[0].plan).toBe('pro_anual')
  })

  it('Asaas fora do ar: erro claro e o banco não muda', async () => {
    asaas.put.mockRejectedValue(asaasDown())
    await expect(changePlan(deps(), { userId: USER_A, newPlanKey: 'pro_anual' })).rejects.toMatchObject({ code: 'asaas_unavailable' })
    expect(db.rpcCalls.some((c) => c.name === 'billing_change_plan')).toBe(false)
    expect(db.tables.profiles[0].plan).toBe('essencial_mensal')
  })

  it('sem assinatura ativa: não encontrado', async () => {
    await expect(changePlan(deps(), { userId: USER_B, newPlanKey: 'pro_anual' })).rejects.toBeInstanceOf(BillingError)
    expect(asaas.put).not.toHaveBeenCalled()
  })
})

describe('cortesia', () => {
  it('dá um plano pago sem cobrança, com data pra acabar', async () => {
    const until = new Date('2027-01-31T03:00:00Z')
    const { courtesyId } = await grantCourtesy(deps(), { userId: USER_B, planKey: 'pro_mensal', until, note: 'parceiro de lançamento' })
    expect(courtesyId).toMatch(/^cortesia:/)
    expect(db.rpcCalls.at(-1)).toMatchObject({ name: 'billing_grant_courtesy', args: { p_user_id: USER_B, p_plan_key: 'pro_mensal', p_until: until.toISOString(), p_note: 'parceiro de lançamento' } })
    expect(asaas.post).not.toHaveBeenCalled()
  })

  it('encerra a cortesia na hora', async () => {
    const { courtesyId } = await grantCourtesy(deps(), { userId: USER_B, planKey: 'pro_mensal' })
    await endCourtesy(deps(), { courtesyId })
    expect(db.rpcCalls.at(-1)).toMatchObject({ name: 'billing_end_subscription', args: { p_id: courtesyId, p_source: 'admin', p_immediate: true } })
  })

  it('não aceita encerrar assinatura paga como se fosse cortesia', async () => {
    await expect(endCourtesy(deps(), { courtesyId: 'chk_1' })).rejects.toBeInstanceOf(BillingError)
  })
})

describe('cancelamento pelo admin', () => {
  it('pode cortar na hora (sem estorno automático)', async () => {
    asaas.get.mockResolvedValue({ data: [payment({ dueDate: '2026-11-16', confirmedDate: '2026-11-16' })], hasMore: false })
    const out = await cancelSubscriptionForUser(deps(), { userId: USER_A, source: 'admin', immediate: true })
    expect(out.refunded).toBe(false)
    expect(asaas.post).not.toHaveBeenCalled()
    expect(db.rpcCalls.find((c) => c.name === 'billing_end_subscription')!.args).toMatchObject({ p_source: 'admin', p_immediate: true })
  })
})

describe('regras de data', () => {
  it('converte as datas do Asaas pro dia de Brasília', () => {
    expect(toBrtDate('2026-11-16')).toBe('2026-11-16')
    expect(toBrtDate('2026-11-16 23:30:00')).toBe('2026-11-16')
    expect(toBrtDate('2026-11-16T03:00:00+0000')).toBe('2026-11-16')
    expect(toBrtDate('2026-11-16T02:00:00Z')).toBe('2026-11-15')
    expect(toBrtDate('16/11/2026')).toBeNull()
  })

  it('período pago vem da última cobrança paga (estornada não conta)', () => {
    expect(latestPaidDueDate([
      payment({ id: 'a', dueDate: '2026-10-16', status: 'RECEIVED' }),
      payment({ id: 'b', dueDate: '2026-11-16', status: 'CONFIRMED' }),
      payment({ id: 'c', dueDate: '2026-12-16', status: 'PENDING' }),
      payment({ id: 'd', dueDate: '2027-01-16', status: 'REFUNDED' }),
    ])).toBe('2026-11-16')
  })

  it('arrependimento: só a primeira compra e só até 7 dias depois', () => {
    const one = [payment({ confirmedDate: '2026-11-09', dueDate: '2026-11-09' })]
    expect(withdrawalStatus(one, new Date('2026-11-16T15:00:00Z'))).not.toBeNull() // 7º dia
    expect(withdrawalStatus(one, new Date('2026-11-17T15:00:00Z'))).toBeNull() // 8º dia
    const renewed = [payment({ id: 'p1', dueDate: '2026-10-16' }), payment({ id: 'p2', dueDate: '2026-11-16' })]
    expect(withdrawalStatus(renewed, new Date('2026-11-16T15:00:00Z'))).toBeNull()
    const refunded = [payment({ status: 'REFUNDED', confirmedDate: '2026-11-15' })]
    expect(withdrawalStatus(refunded, new Date('2026-11-16T15:00:00Z'))).toMatchObject({ alreadyRefunded: true })
  })
})

import { describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { PLAN_LIMITS, brtMonth, effectivePlan, getQuotaBonus, getUserPlan, quotaBonusFor } from '../_lib/plan.js'
import { createFakeDb } from './fakeSupabase.js'

const U = '11111111-1111-4111-8111-111111111111'
const now = new Date('2026-11-16T15:00:00Z')

describe('effectivePlan', () => {
  it('plano sem data de fim continua valendo', () => {
    expect(effectivePlan('essencial_mensal', null, now)).toBe('essencial_mensal')
  })
  it('plano cancelado vale até a data e depois é Livre', () => {
    expect(effectivePlan('pro_anual', '2026-12-17T03:00:00Z', now)).toBe('pro_anual')
    expect(effectivePlan('pro_anual', '2026-11-16T14:59:59Z', now)).toBe('free')
  })
  it('sem plano é Livre', () => {
    expect(effectivePlan(null, null, now)).toBe('free')
  })
})

describe('getUserPlan', () => {
  it('lê plano e data de fim do perfil', async () => {
    const db = createFakeDb({ tables: { profiles: [{ id: U, plan: 'essencial_mensal', plan_expires_at: '2020-01-01T00:00:00Z' }] } })
    await expect(getUserPlan(db as unknown as SupabaseClient, U)).resolves.toBe('free')
  })

  it('se a coluna nova ainda não existe (SQL não rodado), cai pro plano puro em vez de travar', async () => {
    let calls = 0
    const db = {
      from: () => ({
        select: (cols: string) => ({
          eq: () => ({
            maybeSingle: async () => {
              calls++
              return cols.includes('plan_expires_at')
                ? { data: null, error: { message: 'column profiles.plan_expires_at does not exist', code: '42703' } }
                : { data: { plan: 'pro_mensal' }, error: null }
            },
          }),
        }),
      }),
    }
    await expect(getUserPlan(db as unknown as SupabaseClient, U)).resolves.toBe('pro_mensal')
    expect(calls).toBe(2)
  })

  it('erro de banco de verdade propaga', async () => {
    const db = createFakeDb({ tables: { profiles: [] } })
    db.failTable('profiles', { message: 'connection refused' })
    await expect(getUserPlan(db as unknown as SupabaseClient, U)).rejects.toThrow('connection refused')
  })
})

describe('limites de separação por plano', () => {
  it('Livre 5, Pro 50 e Studio 150 por mês, mensal e anual iguais', () => {
    expect(PLAN_LIMITS).toEqual({ free: 5, essencial_mensal: 50, essencial_anual: 50, pro_mensal: 150, pro_anual: 150 })
  })
})

describe('brtMonth', () => {
  it('é o mês de Brasília, não o de UTC', () => {
    expect(brtMonth('2026-12-01T02:30:00Z')).toBe('2026-11')
    expect(brtMonth(new Date('2026-12-01T03:00:00Z'))).toBe('2026-12')
  })
})

describe('quotaBonusFor', () => {
  const NOV = '2026-11-01T03:00:00Z'

  it('cota extra dada em novembro vale em novembro', () => {
    expect(quotaBonusFor({ quota_bonus: 10, quota_bonus_period: NOV }, now)).toBe(10)
  })

  it('cota extra de outubro não vale em novembro', () => {
    expect(quotaBonusFor({ quota_bonus: 10, quota_bonus_period: '2026-10-01T03:00:00Z' }, now)).toBe(0)
  })

  it('quotaBonusFor na virada: vale às 23:30 de 30/11 em Brasília e some à 00:30 de 01/12', () => {
    const row = { quota_bonus: 10, quota_bonus_period: NOV }
    expect(quotaBonusFor(row, new Date('2026-12-01T02:30:00Z'))).toBe(10)
    expect(quotaBonusFor(row, new Date('2026-12-01T03:30:00Z'))).toBe(0)
  })

  it('o período do jeito que o banco devolve (+00:00) também casa', () => {
    expect(quotaBonusFor({ quota_bonus: 3, quota_bonus_period: '2026-11-01T03:00:00+00:00' }, now)).toBe(3)
  })

  it('sem linha, sem período, bônus zero, negativo ou data inválida dá 0', () => {
    expect(quotaBonusFor(null, now)).toBe(0)
    expect(quotaBonusFor({ quota_bonus: 10, quota_bonus_period: null }, now)).toBe(0)
    expect(quotaBonusFor({ quota_bonus: 0, quota_bonus_period: NOV }, now)).toBe(0)
    expect(quotaBonusFor({ quota_bonus: -4, quota_bonus_period: NOV }, now)).toBe(0)
    expect(quotaBonusFor({ quota_bonus: null, quota_bonus_period: NOV }, now)).toBe(0)
    expect(quotaBonusFor({ quota_bonus: 10, quota_bonus_period: 'ontem' }, now)).toBe(0)
  })
})

describe('getQuotaBonus', () => {
  it('lê a cota extra do perfil e aplica a regra do mês', async () => {
    const db = createFakeDb({ tables: { profiles: [{ id: U, quota_bonus: 7, quota_bonus_period: '2026-11-01T03:00:00Z' }] } })
    await expect(getQuotaBonus(db as unknown as SupabaseClient, U, now)).resolves.toBe(7)
    expect(db.reads).toEqual([{ table: 'profiles', filters: [{ col: 'id', op: 'eq', value: U }] }])
  })

  it('perfil sem linha dá 0', async () => {
    const db = createFakeDb({ tables: { profiles: [] } })
    await expect(getQuotaBonus(db as unknown as SupabaseClient, U, now)).resolves.toBe(0)
  })

  it('coluna ainda não criada (SQL do admin não rodado) dá 0 em vez de travar', async () => {
    const db = createFakeDb({ tables: { profiles: [] } })
    db.failTable('profiles', { message: 'column profiles.quota_bonus does not exist', code: '42703' })
    await expect(getQuotaBonus(db as unknown as SupabaseClient, U, now)).resolves.toBe(0)
  })

  it('erro de banco de verdade propaga', async () => {
    const db = createFakeDb({ tables: { profiles: [] } })
    db.failTable('profiles', { message: 'connection refused' })
    await expect(getQuotaBonus(db as unknown as SupabaseClient, U, now)).rejects.toThrow('connection refused')
  })
})

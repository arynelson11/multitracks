import { describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { effectivePlan, getUserPlan } from '../_lib/plan.js'
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

import { beforeEach, describe, expect, it, vi } from 'vitest'

type Res = { data: unknown; error: { message: string; code?: string } | null }
const answers: Record<string, Res> = {}
const selects: string[] = []
vi.mock('./supabase', () => ({
  supabase: {
    from: () => ({
      select: (cols: string) => ({
        eq: () => ({
          maybeSingle: async () => { selects.push(cols); return answers[cols] ?? { data: null, error: null } },
        }),
      }),
    }),
  },
}))

import { effectivePlan, fetchPlanState } from './planState'

beforeEach(() => {
  selects.length = 0
  for (const k of Object.keys(answers)) delete answers[k]
})

describe('effectivePlan (app)', () => {
  const now = new Date('2026-11-16T15:00:00Z')
  it('cancelado vale até a data e depois é Livre', () => {
    expect(effectivePlan('essencial_mensal', '2026-12-17T03:00:00Z', now)).toBe('essencial_mensal')
    expect(effectivePlan('essencial_mensal', '2026-11-16T14:00:00Z', now)).toBe('free')
    expect(effectivePlan('pro_anual', null, now)).toBe('pro_anual')
    expect(effectivePlan(undefined, null, now)).toBe('free')
  })
})

describe('fetchPlanState', () => {
  it('lê plano e data de fim', async () => {
    answers['plan, plan_expires_at'] = { data: { plan: 'pro_mensal', plan_expires_at: '2026-12-17T03:00:00Z' }, error: null }
    await expect(fetchPlanState('u')).resolves.toEqual({ plan: 'pro_mensal', planExpiresAt: '2026-12-17T03:00:00Z' })
  })

  it('sem a coluna nova no banco, cai pro plano puro (não derruba quem paga)', async () => {
    answers['plan, plan_expires_at'] = { data: null, error: { message: 'column profiles.plan_expires_at does not exist', code: '42703' } }
    answers['plan'] = { data: { plan: 'essencial_anual' }, error: null }
    await expect(fetchPlanState('u')).resolves.toEqual({ plan: 'essencial_anual', planExpiresAt: null })
    expect(selects).toEqual(['plan, plan_expires_at', 'plan'])
  })

  it('erro de banco devolve null (a tela mantém o que já tinha)', async () => {
    answers['plan, plan_expires_at'] = { data: null, error: { message: 'offline' } }
    await expect(fetchPlanState('u')).resolves.toBeNull()
  })
})

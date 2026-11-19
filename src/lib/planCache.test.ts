// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PLAN_CACHE_KEY, PLAN_CACHE_MAX_AGE_MS, clearPlanCache, readPlanCache, savePlanCache } from './planCache'

// Plano guardado no aparelho (spec 5, Ruling R2): o último plano conhecido da conta, com o
// papel de admin, vale offline até a data de fim do plano (effectivePlan, no useAuth) ou 30
// dias sem conferir, o que vier antes. Só a mesma conta lê o que guardou.
const U = 'u-pago'
const OUTRA = 'u-outra'
const DAY = 86_400_000
const T0 = new Date('2026-11-19T15:00:00Z')
const addMs = (d: Date, ms: number) => new Date(d.getTime() + ms)
const PRO = { plan: 'pro_mensal', planExpiresAt: null, isAdmin: false }

beforeEach(() => { localStorage.clear() })
afterEach(() => {
  vi.unstubAllGlobals()
  localStorage.clear()
})

describe('planCache: plano guardado no aparelho', () => {
  it('30 dias é o prazo sem conferir', () => {
    expect(PLAN_CACHE_MAX_AGE_MS).toBe(30 * DAY)
    expect(PLAN_CACHE_KEY).toBe('ps-plano-guardado')
  })

  it('guarda e devolve o plano da mesma conta', () => {
    savePlanCache(U, PRO, T0)
    expect(readPlanCache(U, T0)).toEqual({ plan: 'pro_mensal', planExpiresAt: null, isAdmin: false })
  })

  it('guarda a data de fim do plano junto (quem decide se já passou é o effectivePlan)', () => {
    savePlanCache(U, { plan: 'pro_mensal', planExpiresAt: '2026-11-20T03:00:00Z', isAdmin: false }, T0)
    expect(readPlanCache(U, addMs(T0, 5 * DAY))).toEqual({ plan: 'pro_mensal', planExpiresAt: '2026-11-20T03:00:00Z', isAdmin: false })
  })

  it('guarda o papel de admin da mesma conta, com o mesmo prazo de 30 dias', () => {
    savePlanCache(U, { plan: 'free', planExpiresAt: null, isAdmin: true }, T0)
    expect(readPlanCache(U, addMs(T0, 29 * DAY))?.isAdmin).toBe(true)
    expect(readPlanCache(U, addMs(T0, 30 * DAY + 60_000))).toBeNull()
  })

  it('outra conta não herda o plano guardado', () => {
    savePlanCache(U, PRO, T0)
    expect(readPlanCache(OUTRA, T0)).toBeNull()
  })

  it('guardar outra conta troca o registro: a primeira não lê mais nada', () => {
    savePlanCache(U, { plan: 'pro_mensal', planExpiresAt: null, isAdmin: true }, T0)
    savePlanCache(OUTRA, { plan: 'free', planExpiresAt: null, isAdmin: false }, T0)
    expect(readPlanCache(U, T0)).toBeNull()
    expect(readPlanCache(OUTRA, T0)).toEqual({ plan: 'free', planExpiresAt: null, isAdmin: false })
  })

  it('29 dias sem conferir ainda vale', () => {
    savePlanCache(U, PRO, T0)
    expect(readPlanCache(U, addMs(T0, 29 * DAY))).not.toBeNull()
  })

  it('30 dias e 1 minuto sem conferir: o plano guardado não vale', () => {
    savePlanCache(U, PRO, T0)
    expect(readPlanCache(U, addMs(T0, 30 * DAY + 60_000))).toBeNull()
  })

  it('sem registro devolve null', () => {
    expect(readPlanCache(U, T0)).toBeNull()
  })

  it('JSON estragado ou localStorage que lança devolve null e não quebra', () => {
    localStorage.setItem(PLAN_CACHE_KEY, '{nao e json')
    expect(readPlanCache(U, T0)).toBeNull()

    // Registro com formato errado (plano que não é texto, data de conferência inválida, papel que não é booleano).
    localStorage.setItem(PLAN_CACHE_KEY, JSON.stringify({ userId: U, plan: 3, planExpiresAt: null, isAdmin: false, checkedAt: T0.toISOString() }))
    expect(readPlanCache(U, T0)).toBeNull()
    localStorage.setItem(PLAN_CACHE_KEY, JSON.stringify({ userId: U, plan: 'pro_mensal', planExpiresAt: null, isAdmin: false, checkedAt: 'ontem' }))
    expect(readPlanCache(U, T0)).toBeNull()
    localStorage.setItem(PLAN_CACHE_KEY, JSON.stringify({ userId: U, plan: 'pro_mensal', planExpiresAt: 7, isAdmin: false, checkedAt: T0.toISOString() }))
    expect(readPlanCache(U, T0)).toBeNull()
    localStorage.setItem(PLAN_CACHE_KEY, JSON.stringify({ userId: U, plan: 'free', planExpiresAt: null, isAdmin: 'sim', checkedAt: T0.toISOString() }))
    expect(readPlanCache(U, T0)).toBeNull()
    localStorage.setItem(PLAN_CACHE_KEY, 'null')
    expect(readPlanCache(U, T0)).toBeNull()

    // O armazenamento que lança em tudo.
    const boom = () => { throw new Error('armazenamento indisponível') }
    vi.stubGlobal('localStorage', { getItem: boom, setItem: boom, removeItem: boom, clear: boom })
    expect(() => savePlanCache(U, PRO, T0)).not.toThrow()
    expect(readPlanCache(U, T0)).toBeNull()
    expect(() => clearPlanCache()).not.toThrow()

    // Sem armazenamento nenhum.
    vi.stubGlobal('localStorage', undefined)
    expect(() => savePlanCache(U, PRO, T0)).not.toThrow()
    expect(readPlanCache(U, T0)).toBeNull()
    expect(() => clearPlanCache()).not.toThrow()
  })

  it('clearPlanCache apaga', () => {
    savePlanCache(U, PRO, T0)
    clearPlanCache()
    expect(readPlanCache(U, T0)).toBeNull()
    expect(localStorage.getItem(PLAN_CACHE_KEY)).toBeNull()
  })
})

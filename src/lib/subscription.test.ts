import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./supabase', () => ({
  supabase: null,
  getAuthHeaders: async () => ({ 'Content-Type': 'application/json', Authorization: 'Bearer t' }),
}))
vi.mock('./api', () => ({ apiUrl: (p: string) => `https://app.test${p}` }))

import { accessDateLabel, brtTodayKey, cancelMySubscription, renewalNotice, syncBillingOnLogin, type MySubscription } from './subscription'

const base: MySubscription = {
  id: 'chk_1', kind: 'asaas', plan_key: 'essencial_mensal', cycle: 'MONTHLY', status: 'active',
  started_at: '2026-10-16T15:00:00Z', next_due_date: '2026-11-19', paid_until: '2026-11-20T03:00:00Z',
  access_until: null, cancel_source: null, canceled_at: null, created_at: '2026-10-16T15:00:00Z',
}
// 16/11/2026 meio-dia em Brasília
const now = new Date('2026-11-16T15:00:00Z')

describe('renewalNotice (aviso de vencimento do mensal)', () => {
  it('aparece a partir de 3 dias antes', () => {
    expect(renewalNotice(base, now)).toEqual({ daysLeft: 3, dueDate: '2026-11-19' })
    expect(renewalNotice({ ...base, next_due_date: '2026-11-20' }, now)).toBeNull()
  })
  it('aparece no dia do vencimento', () => {
    expect(renewalNotice({ ...base, next_due_date: '2026-11-16' }, now)).toEqual({ daysLeft: 0, dueDate: '2026-11-16' })
  })
  it('não aparece pra anual, cancelada, cortesia, vencimento passado ou sem data', () => {
    expect(renewalNotice({ ...base, cycle: 'YEARLY' }, now)).toBeNull()
    expect(renewalNotice({ ...base, status: 'canceled' }, now)).toBeNull()
    expect(renewalNotice({ ...base, kind: 'courtesy' }, now)).toBeNull()
    expect(renewalNotice({ ...base, next_due_date: '2026-11-15' }, now)).toBeNull()
    expect(renewalNotice({ ...base, next_due_date: null }, now)).toBeNull()
    expect(renewalNotice(null, now)).toBeNull()
  })
})

describe('fuso de Brasília', () => {
  it('21:30 de Brasília (já 17/11 em UTC) ainda conta como 16/11', () => {
    const late = new Date('2026-11-17T00:30:00Z')
    expect(brtTodayKey(late)).toBe('2026-11-16')
    expect(renewalNotice(base, late)).toEqual({ daysLeft: 3, dueDate: '2026-11-19' })
  })
})

describe('accessDateLabel', () => {
  it('mostra o último dia com acesso (o fim guardado é o começo do dia seguinte)', () => {
    expect(accessDateLabel('2026-12-17T03:00:00Z')).toBe('16/12/2026')
  })
})

describe('cancelMySubscription', () => {
  const fetchMock = vi.fn()
  beforeEach(() => { fetchMock.mockReset(); vi.stubGlobal('fetch', fetchMock) })
  afterEach(() => { vi.unstubAllGlobals() })

  it('chama a ação de cancelar do checkout com o login do usuário', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ result: 'canceled', accessUntil: '2026-12-17T03:00:00Z', refunded: false, plan: 'essencial_mensal' }) })
    const out = await cancelMySubscription()
    expect(out).toEqual({ ok: true, data: { result: 'canceled', accessUntil: '2026-12-17T03:00:00Z', refunded: false, plan: 'essencial_mensal' } })
    expect(fetchMock).toHaveBeenCalledWith('https://app.test/api/checkout?action=cancel', expect.objectContaining({ method: 'POST', headers: expect.objectContaining({ Authorization: 'Bearer t' }) }))
  })

  it('devolve a mensagem do servidor quando dá erro', async () => {
    fetchMock.mockResolvedValue({ ok: false, json: async () => ({ error: 'Não conseguimos falar com o sistema de pagamento agora.' }) })
    await expect(cancelMySubscription()).resolves.toEqual({ ok: false, error: 'Não conseguimos falar com o sistema de pagamento agora.' })
  })

  it('no login pede uma vez só pro servidor tentar de novo as pendências', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ ok: true }) })
    await syncBillingOnLogin('u-sync')
    await syncBillingOnLogin('u-sync')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0][0]).toBe('https://app.test/api/checkout?action=sync')
  })

  it('sem internet: mensagem clara de que nada mudou', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'))
    const out = await cancelMySubscription()
    expect(out.ok).toBe(false)
    expect(!out.ok && out.error).toContain('nada mudou')
  })
})

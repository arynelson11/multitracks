import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./supabase', () => ({
  supabase: null,
  getAuthHeaders: async () => ({ 'Content-Type': 'application/json', Authorization: 'Bearer t' }),
}))
vi.mock('./api', () => ({ apiUrl: (p: string) => `https://app.test${p}` }))

import { accessDateLabel, brtTodayKey, cancelMySubscription, cancelOutcomeLine, deleteAccountNotice, renewalNotice, syncBillingOnLogin, type MySubscription } from './subscription'

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

describe('textos de cancelamento e exclusão (I8, I9)', () => {
  it('excluir conta fora dos 7 dias: diz que o período pago é perdido, com data e valor', () => {
    const t = deleteAccountNotice({ outcome: 'until_period_end', plan: 'essencial_anual', accessUntil: '2027-11-11T03:00:00Z', amount: 454.8 }, 'essencial_anual')
    expect(t).toContain('perdido, sem devolução')
    expect(t).toContain('10/11/2027')
    expect(t).toContain('R$ 454,80')
    expect(t).not.toContain('—')
  })
  it('excluir conta na 1ª assinatura em até 7 dias: devolve o valor', () => {
    expect(deleteAccountNotice({ outcome: 'refund_auto', plan: 'essencial_mensal', accessUntil: null, amount: 49.9 }, 'essencial_mensal')).toContain('devolvemos R$ 49,90')
  })
  it('excluir conta em até 7 dias sem ser a 1ª: pedido de estorno pra equipe', () => {
    expect(deleteAccountNotice({ outcome: 'refund_request', plan: 'pro_mensal', accessUntil: null, amount: 119.9 }, 'pro_mensal')).toContain('pedido de estorno')
  })
  it('sem prévia: avisa a regra geral, inclusive o anual', () => {
    const t = deleteAccountNotice(null, 'essencial_anual')
    expect(t).toContain('perdido, sem devolução')
    expect(t).toContain('no anual, o resto do ano')
  })
  it('confirmação do cancelamento mostra só o desfecho daquela pessoa', () => {
    const auto = cancelOutcomeLine({ outcome: 'refund_auto', plan: 'essencial_mensal', accessUntil: null, amount: 49.9 }, 'Pro Mensal')
    expect(auto).toContain('primeira assinatura')
    expect(auto).toContain('devolvemos R$ 49,90')
    const req = cancelOutcomeLine({ outcome: 'refund_request', plan: 'essencial_mensal', accessUntil: '2026-12-17T03:00:00Z', amount: 49.9 }, 'Pro Mensal')
    expect(req).toContain('não é automático')
    const end = cancelOutcomeLine({ outcome: 'until_period_end', plan: 'essencial_mensal', accessUntil: '2026-12-17T03:00:00Z', amount: 49.9 }, 'Pro Mensal')
    expect(end).toContain('até 16/12/2026')
  })
})

describe('fetchMySubscription (N6)', () => {
  it('a assinatura paga ativa vem antes da cortesia ativa', async () => {
    vi.resetModules()
    const rows = [
      { id: 'cortesia:1', kind: 'courtesy', status: 'active', started_at: '2026-11-10T00:00:00Z', created_at: '2026-11-10T00:00:00Z' },
      { id: 'chk_1', kind: 'asaas', status: 'active', started_at: '2026-10-01T00:00:00Z', created_at: '2026-10-01T00:00:00Z' },
    ]
    vi.doMock('./supabase', () => ({ supabase: { from: () => ({ select: async () => ({ data: rows, error: null }) }) }, getAuthHeaders: async () => ({}) }))
    const mod = await import('./subscription')
    expect((await mod.fetchMySubscription())!.id).toBe('chk_1')
    vi.doUnmock('./supabase')
  })
})

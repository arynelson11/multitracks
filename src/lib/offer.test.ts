import { beforeEach, describe, expect, it, vi } from 'vitest'

const auth = { headers: { 'Content-Type': 'application/json', Authorization: 'Bearer t' } as Record<string, string> }
vi.mock('./supabase', () => ({ getAuthHeaders: async () => ({ ...auth.headers }) }))
vi.mock('./api', () => ({ apiUrl: (p: string) => `https://api.test${p}` }))

import { fetchOffer, toOfferView } from './offer'
import type { OfferResponse } from './offer'

const PRICES = { essencial_mensal: 24.9, pro_mensal: 59.9 }
const T0 = Date.parse('2026-11-20T12:00:00Z')
const HOUR = 3_600_000

const fetchMock = vi.fn()
const answer = (status: number, body: unknown) => ({ ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(body) })

beforeEach(() => {
  auth.headers = { 'Content-Type': 'application/json', Authorization: 'Bearer t' }
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})

describe('fetchOffer', () => {
  it('fetchOffer manda open e trigger pro /api/checkout?action=offer pelo apiUrl', async () => {
    const expiresAt = new Date(T0 + 48 * HOUR).toISOString()
    fetchMock.mockResolvedValue(answer(200, { status: 'active', expiresAt, prices: PRICES }))
    const r = await fetchOffer({ open: true, trigger: 'stage-songs' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://api.test/api/checkout?action=offer')
    expect(url).toContain('/api/checkout?action=offer')
    expect(init.method).toBe('POST')
    expect(init.headers.Authorization).toBe('Bearer t')
    expect(JSON.parse(init.body)).toEqual({ open: true, trigger: 'stage-songs' })
    expect(r).toEqual({ status: 'active', expiresAt, prices: PRICES })
  })

  it('sem open só lê: o corpo leva open falso e nenhum limite', async () => {
    fetchMock.mockResolvedValue(answer(200, { status: 'none', expiresAt: null, prices: PRICES }))
    const r = await fetchOffer({ open: false })
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ open: false })
    expect(r).toEqual({ status: 'none', expiresAt: null, prices: PRICES })
  })

  it('fetchOffer sem internet devolve null', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'))
    await expect(fetchOffer({ open: true, trigger: 'live' })).resolves.toBeNull()
  })

  it('erro do servidor, resposta que não é JSON ou fora do formato devolvem null', async () => {
    fetchMock.mockResolvedValueOnce(answer(403, { error: 'Sua conta está bloqueada.' }))
    await expect(fetchOffer({ open: false })).resolves.toBeNull()
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200, text: async () => '<html>' })
    await expect(fetchOffer({ open: false })).resolves.toBeNull()
    fetchMock.mockResolvedValueOnce(answer(200, { status: 'aberta', expiresAt: null, prices: PRICES }))
    await expect(fetchOffer({ open: false })).resolves.toBeNull()
    fetchMock.mockResolvedValueOnce(answer(200, { status: 'active', expiresAt: 'x', prices: { essencial_mensal: '24,90', pro_mensal: 59.9 } }))
    await expect(fetchOffer({ open: false })).resolves.toBeNull()
    fetchMock.mockResolvedValueOnce(answer(200, { status: 'active', expiresAt: 'x', prices: { essencial_mensal: 0, pro_mensal: 59.9 } }))
    await expect(fetchOffer({ open: false })).resolves.toBeNull()
    fetchMock.mockResolvedValueOnce(answer(200, { url: 'https://asaas.test/c/1' }))
    await expect(fetchOffer({ open: false })).resolves.toBeNull()
  })

  it('sem sessão não pergunta nada ao servidor', async () => {
    auth.headers = { 'Content-Type': 'application/json' }
    await expect(fetchOffer({ open: true, trigger: 'download' })).resolves.toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('toOfferView', () => {
  const r = (patch: Partial<OfferResponse>): OfferResponse => ({ status: 'active', expiresAt: new Date(T0 + HOUR).toISOString(), prices: PRICES, ...patch })

  it('toOfferView: active com expiresAt no futuro; expired, used, ineligible, none e null viram none', () => {
    const expiresAt = new Date(T0 + HOUR).toISOString()
    expect(toOfferView(r({ expiresAt }), T0)).toEqual({ status: 'active', expiresAt, prices: PRICES })
    for (const status of ['expired', 'used', 'ineligible', 'none'] as const) {
      expect(toOfferView(r({ status, expiresAt: null }), T0)).toEqual({ status: 'none' })
      // Mesmo com uma data no futuro, só o active vira oferta.
      expect(toOfferView(r({ status, expiresAt }), T0)).toEqual({ status: 'none' })
    }
    expect(toOfferView(null, T0)).toEqual({ status: 'none' })
  })

  it('active vencido pelo relógio, no segundo exato, sem data ou com data estragada vira none', () => {
    expect(toOfferView(r({ expiresAt: new Date(T0 - 1).toISOString() }), T0)).toEqual({ status: 'none' })
    expect(toOfferView(r({ expiresAt: new Date(T0).toISOString() }), T0)).toEqual({ status: 'none' })
    expect(toOfferView(r({ expiresAt: null }), T0)).toEqual({ status: 'none' })
    expect(toOfferView(r({ expiresAt: 'amanhã' }), T0)).toEqual({ status: 'none' })
  })
})

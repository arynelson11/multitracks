import { beforeEach, describe, expect, it, vi } from 'vitest'

const auth = { headers: { 'Content-Type': 'application/json', Authorization: 'Bearer t' } as Record<string, string>, fail: false }
vi.mock('./supabase', () => ({
  getAuthHeaders: async () => {
    if (auth.fail) throw new Error('sem sessão')
    return { ...auth.headers }
  },
}))
vi.mock('./api', () => ({ apiUrl: (p: string) => `https://api.test${p}` }))

import { trackAd } from './productEvents'

const fetchMock = vi.fn()
// Deixa o disparo (que não é esperado por ninguém) terminar.
const settle = () => new Promise((r) => setTimeout(r, 0))

beforeEach(() => {
  auth.headers = { 'Content-Type': 'application/json', Authorization: 'Bearer t' }
  auth.fail = false
  fetchMock.mockReset()
  fetchMock.mockResolvedValue({ ok: true, status: 200, text: async () => '{"ok":true}' })
  vi.stubGlobal('fetch', fetchMock)
})

describe('trackAd', () => {
  it('trackAd manda kind e placement e nunca lança sem internet', async () => {
    expect(trackAd('ad_shown', 'limit')).toBeUndefined()
    await settle()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://api.test/api/checkout?action=track')
    expect(init.method).toBe('POST')
    expect(init.headers.Authorization).toBe('Bearer t')
    expect(JSON.parse(init.body)).toEqual({ kind: 'ad_shown', placement: 'limit' })

    // Sem internet: o fetch falha e nada sobe (o Vitest acusaria a promessa rejeitada solta).
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'))
    expect(() => trackAd('ad_clicked', 'badge')).not.toThrow()
    await settle()
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ kind: 'ad_clicked', placement: 'badge' })
  })

  it('sem sessão não manda nada, e falha ao ler a sessão também não lança', async () => {
    auth.headers = { 'Content-Type': 'application/json' }
    trackAd('ad_shown', 'home')
    await settle()
    expect(fetchMock).not.toHaveBeenCalled()

    auth.fail = true
    expect(() => trackAd('ad_clicked', 'separation-done')).not.toThrow()
    await settle()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('servidor que recusa (400, 500) não muda nada pra quem chamou', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500, text: async () => '{"error":"x"}' })
    expect(() => trackAd('ad_clicked', 'limit')).not.toThrow()
    await settle()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})

// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, renderHook, waitFor, act } from '@testing-library/react'
import { AdminApiError, adminGet, adminPost } from './adminApi'
import { useAdminQuery } from '../hooks/useAdminQuery'

// No app de computador o apiUrl aponta pro domínio de produção; aqui o mock faz o mesmo.
vi.mock('../../lib/api', () => ({ apiUrl: (p: string) => 'https://playbackstudio.com.br' + p }))
vi.mock('../../lib/supabase', () => ({
  getAuthHeaders: async () => ({ Authorization: 'Bearer t', 'Content-Type': 'application/json' }),
}))

afterEach(cleanup)

const HEADERS = { Authorization: 'Bearer t', 'Content-Type': 'application/json' }
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
const mockFetch = () => vi.spyOn(globalThis, 'fetch')

async function errorOf(p: Promise<unknown>): Promise<AdminApiError> {
  try {
    await p
  } catch (e) {
    if (e instanceof AdminApiError) return e
    throw e
  }
  throw new Error('a chamada devia ter falhado')
}

describe('adminApi', () => {
  it('adminApi usa apiUrl (no computador vira https://playbackstudio.com.br/api/...)', async () => {
    const f = mockFetch().mockResolvedValue(json({ ok: true }))
    await expect(adminGet('review')).resolves.toEqual({ ok: true })
    expect(f).toHaveBeenCalledWith('https://playbackstudio.com.br/api/admin-stats?action=review', { headers: HEADERS })
  })

  it('adminGet monta os parâmetros e descarta undefined', async () => {
    const f = mockFetch().mockResolvedValue(json({ rows: [] }))
    await adminGet('subscribers', { q: 'ana maria', page: 2, plan: undefined })
    expect(f).toHaveBeenCalledWith(
      'https://playbackstudio.com.br/api/admin-stats?action=subscribers&q=ana+maria&page=2',
      { headers: HEADERS },
    )
  })

  it('adminPost manda o corpo em JSON', async () => {
    const f = mockFetch().mockResolvedValue(json({ result: 'resolved' }))
    const out = await adminPost<{ result: string }>('resolve-flag', { subscriptionRef: 'sub_1', note: 'conferi' })
    expect(out).toEqual({ result: 'resolved' })
    expect(f).toHaveBeenCalledWith('https://playbackstudio.com.br/api/admin-stats?action=resolve-flag', {
      method: 'POST',
      headers: HEADERS,
      body: JSON.stringify({ subscriptionRef: 'sub_1', note: 'conferi' }),
    })
  })

  it('401 vira mensagem de sessão expirada', async () => {
    mockFetch().mockResolvedValue(json({ error: 'Invalid or expired token' }, 401))
    const e = await errorOf(adminGet('review'))
    expect(e.status).toBe(401)
    expect(e.message).toBe('Sua sessão expirou. Entre de novo.')
  })

  it('403 vira mensagem de conta sem admin', async () => {
    mockFetch().mockResolvedValue(json({ error: 'Forbidden' }, 403))
    const e = await errorOf(adminGet('review'))
    expect(e.status).toBe(403)
    expect(e.message).toBe('Esta conta não é admin.')
  })

  it('falha de rede vira a mensagem de internet', async () => {
    mockFetch().mockRejectedValue(new TypeError('Failed to fetch'))
    const e = await errorOf(adminPost('retry-action', { actionId: 1 }))
    expect(e.status).toBe(0)
    expect(e.message).toBe('Não deu pra falar com o servidor. Confira a internet e tente de novo.')
  })

  it('409 usa o erro do servidor', async () => {
    mockFetch().mockResolvedValue(json({ error: 'Esta marcação já foi conferida.' }, 409))
    const e = await errorOf(adminPost('resolve-flag', { subscriptionRef: 'sub_1', note: 'ok!' }))
    expect(e.status).toBe(409)
    expect(e.message).toBe('Esta marcação já foi conferida.')
  })

  it('outro status sem erro no corpo vira erro inesperado com o código', async () => {
    mockFetch().mockResolvedValue(new Response('<html>falhou</html>', { status: 502 }))
    const e = await errorOf(adminGet('review'))
    expect(e.status).toBe(502)
    expect(e.message).toBe('Erro inesperado (código 502).')
  })
})

describe('useAdminQuery', () => {
  it('carrega e entrega os dados', async () => {
    mockFetch().mockResolvedValue(json({ total: 3 }))
    const { result } = renderHook(() => useAdminQuery<{ total: number }>('review'))
    expect(result.current.loading).toBe(true)
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.data).toEqual({ total: 3 })
    expect(result.current.error).toBeNull()
  })

  it('erro do servidor vira a mensagem pronta e desliga o carregando', async () => {
    mockFetch().mockResolvedValue(json({}, 403))
    const { result } = renderHook(() => useAdminQuery('review'))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.error).toBe('Esta conta não é admin.')
    expect(result.current.data).toBeNull()
  })

  it('resposta velha nunca sobrescreve a nova', async () => {
    const pending: Array<(r: Response) => void> = []
    mockFetch().mockImplementation(() => new Promise<Response>((resolve) => pending.push(resolve)))
    const { result, rerender } = renderHook(
      ({ q }: { q: string }) => useAdminQuery<{ q: string }>('subscribers', { q }),
      { initialProps: { q: 'velha' } },
    )
    await waitFor(() => expect(pending).toHaveLength(1))
    rerender({ q: 'nova' })
    await waitFor(() => expect(pending).toHaveLength(2))

    await act(async () => pending[1](json({ q: 'nova' })))
    await waitFor(() => expect(result.current.data).toEqual({ q: 'nova' }))
    await act(async () => pending[0](json({ q: 'velha' })))

    expect(result.current.data).toEqual({ q: 'nova' })
    expect(result.current.loading).toBe(false)
  })

  it('o mesmo parâmetro em objeto novo não busca de novo', async () => {
    const f = mockFetch().mockImplementation(async () => json({ ok: true }))
    const { result, rerender } = renderHook(({ page }: { page: number }) => useAdminQuery('audit', { page }), {
      initialProps: { page: 1 },
    })
    await waitFor(() => expect(result.current.loading).toBe(false))
    rerender({ page: 1 })
    rerender({ page: 1 })
    expect(f).toHaveBeenCalledTimes(1)
  })

  it('refetch busca de novo', async () => {
    let n = 0
    const f = mockFetch().mockImplementation(async () => json({ n: ++n }))
    const { result } = renderHook(() => useAdminQuery<{ n: number }>('review'))
    await waitFor(() => expect(result.current.data).toEqual({ n: 1 }))
    await act(() => result.current.refetch())
    expect(result.current.data).toEqual({ n: 2 })
    expect(f).toHaveBeenCalledTimes(2)
  })

  it('com enabled falso não chama o servidor', async () => {
    const f = mockFetch()
    const { result } = renderHook(() => useAdminQuery('review', undefined, { enabled: false }))
    await act(async () => {})
    expect(f).not.toHaveBeenCalled()
    expect(result.current.loading).toBe(false)
  })
})

// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, renderHook, waitFor, act } from '@testing-library/react'
import { AdminApiError, adminGet, adminPost } from './adminApi'
import { useAdminQuery } from '../hooks/useAdminQuery'

// No app de computador o apiUrl aponta pro domínio de produção; aqui o mock faz o mesmo.
vi.mock('../../lib/api', () => ({ apiUrl: (p: string) => 'https://playbackstudio.com.br' + p }))
// A renovação do token responde na hora, menos nos testes que seguram ela de propósito.
const auth = vi.hoisted(() => ({
  headers: vi.fn(
    async (): Promise<Record<string, string>> => ({ Authorization: 'Bearer t', 'Content-Type': 'application/json' }),
  ),
}))
vi.mock('../../lib/supabase', () => ({ getAuthHeaders: () => auth.headers() }))

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

const HEADERS = { Authorization: 'Bearer t', 'Content-Type': 'application/json' }
// Toda chamada leva o sinal do teto de tempo (Ruling ADM-T4-teto).
const SIGNAL = expect.any(AbortSignal)
const MSG_TIMEOUT_GET = 'O servidor demorou demais pra responder. Tente de novo.'
const MSG_NETWORK_GET = 'Não deu pra falar com o servidor. Confira a internet e tente de novo.'
const MSG_ACTION_LOST = 'A resposta do servidor não chegou. Confira no Registro se a ação foi feita antes de tentar de novo.'
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
const mockFetch = () => vi.spyOn(globalThis, 'fetch')

/** Cada chamada ao fetch fica parada até o teste responder, na ordem em que foi feita. */
function holdFetch(): Array<(r: Response) => void> {
  const pending: Array<(r: Response) => void> = []
  mockFetch().mockImplementation(() => new Promise<Response>((resolve) => pending.push(resolve)))
  return pending
}

/** Igual ao holdFetch, guardando também o endereço de cada chamada. */
function holdFetchWithUrl(): Array<{ url: string; resolve: (r: Response) => void }> {
  const pending: Array<{ url: string; resolve: (r: Response) => void }> = []
  mockFetch().mockImplementation(
    (input) => new Promise<Response>((resolve) => pending.push({ url: String(input), resolve })),
  )
  return pending
}
const qOf = (url: string) => new URL(url).searchParams.get('q')

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
    expect(f).toHaveBeenCalledWith('https://playbackstudio.com.br/api/admin-stats?action=review', {
      headers: HEADERS,
      signal: SIGNAL,
    })
  })

  it('adminGet monta os parâmetros e descarta undefined', async () => {
    const f = mockFetch().mockResolvedValue(json({ rows: [] }))
    await adminGet('subscribers', { q: 'ana maria', page: 2, plan: undefined })
    expect(f).toHaveBeenCalledWith(
      'https://playbackstudio.com.br/api/admin-stats?action=subscribers&q=ana+maria&page=2',
      { headers: HEADERS, signal: SIGNAL },
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
      signal: SIGNAL,
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
    const e = await errorOf(adminGet('review'))
    expect(e.status).toBe(0)
    expect(e.message).toBe('Não deu pra falar com o servidor. Confira a internet e tente de novo.')
  })

  it('falha de rede numa ação manda conferir o Registro antes de repetir', async () => {
    // A resposta pode ter se perdido depois de o servidor agir: repetir às cegas pode somar duas vezes.
    mockFetch().mockRejectedValue(new TypeError('Failed to fetch'))
    const e = await errorOf(adminPost('adjust-quota', { userId: 'u1', mode: 'add', amount: 5 }))
    expect(e.status).toBe(0)
    expect(e.message).toBe(MSG_ACTION_LOST)
    expect(e.uncertain).toBe(true)
  })

  it('GET pendurado desiste em 15 s, corta o pedido e manda tentar de novo', async () => {
    vi.useFakeTimers()
    const f = mockFetch().mockImplementation(() => new Promise<Response>(() => {}))
    let settled = false
    const p = errorOf(adminGet('review')).finally(() => {
      settled = true
    })
    await vi.advanceTimersByTimeAsync(14_999)
    expect(settled).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    const e = await p
    expect(e.status).toBe(0)
    expect(e.message).toBe(MSG_TIMEOUT_GET)
    expect((f.mock.calls[0][1] as RequestInit).signal?.aborted).toBe(true)
  })

  // Ruling ADM-T4-incerto: 35 s, acima do maxDuration de 30 s da função, pra ela já ter terminado
  // ou sido cortada quando a frase aparece.
  it('POST pendurado desiste em 35 s, manda conferir o Registro e marca o erro como incerto', async () => {
    vi.useFakeTimers()
    const f = mockFetch().mockImplementation(() => new Promise<Response>(() => {}))
    let settled = false
    const p = errorOf(adminPost('adjust-quota', { userId: 'u1', mode: 'add', amount: 5 })).finally(() => {
      settled = true
    })
    await vi.advanceTimersByTimeAsync(30_000)
    expect(settled).toBe(false)
    await vi.advanceTimersByTimeAsync(4_999)
    expect(settled).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    const e = await p
    expect(e.status).toBe(0)
    expect(e.message).toBe(MSG_ACTION_LOST)
    expect(e.uncertain).toBe(true)
    expect((f.mock.calls[0][1] as RequestInit).signal?.aborted).toBe(true)
  })

  it('o teto da ação conta a partir do fetch, depois da renovação do token', async () => {
    vi.useFakeTimers()
    auth.headers.mockImplementationOnce(() => new Promise((resolve) => setTimeout(() => resolve(HEADERS), 5_000)))
    const f = mockFetch().mockImplementation(() => new Promise<Response>(() => {}))
    let settled = false
    const p = errorOf(adminPost('adjust-quota', { userId: 'u1', mode: 'add', amount: 5 })).finally(() => {
      settled = true
    })
    await vi.advanceTimersByTimeAsync(4_999)
    expect(f).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(f).toHaveBeenCalledTimes(1)
    // 5 s de token + 34,999 s de fetch: ainda esperando.
    await vi.advanceTimersByTimeAsync(34_999)
    expect(settled).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    const e = await p
    expect(e.message).toBe(MSG_ACTION_LOST)
    expect(e.uncertain).toBe(true)
  })

  it('o teto da consulta também conta a partir do fetch, depois da renovação do token', async () => {
    vi.useFakeTimers()
    auth.headers.mockImplementationOnce(() => new Promise((resolve) => setTimeout(() => resolve(HEADERS), 5_000)))
    mockFetch().mockImplementation(() => new Promise<Response>(() => {}))
    let settled = false
    const p = errorOf(adminGet('review')).finally(() => {
      settled = true
    })
    await vi.advanceTimersByTimeAsync(5_000 + 14_999)
    expect(settled).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    const e = await p
    expect(e.message).toBe(MSG_TIMEOUT_GET)
    expect(e.uncertain).toBe(false)
  })

  it('renovação do token pendurada desiste em 15 s sem mandar a ação, e o erro não é incerto', async () => {
    vi.useFakeTimers()
    auth.headers.mockImplementationOnce(() => new Promise(() => {}))
    const f = mockFetch()
    let settled = false
    const p = errorOf(adminPost('adjust-quota', { userId: 'u1', mode: 'add', amount: 5 })).finally(() => {
      settled = true
    })
    await vi.advanceTimersByTimeAsync(14_999)
    expect(settled).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    const e = await p
    // Nada saiu pro servidor: a ação com certeza não foi feita, pode tentar de novo.
    expect(f).not.toHaveBeenCalled()
    expect(e.status).toBe(0)
    expect(e.message).toBe(MSG_NETWORK_GET)
    expect(e.uncertain).toBe(false)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('504 sem JSON numa ação dá a frase do Registro e marca o erro como incerto', async () => {
    // O 504 da Vercel vem em HTML: a função pode ter agido antes de ser cortada.
    mockFetch().mockResolvedValue(new Response('<html>Gateway Timeout</html>', { status: 504 }))
    const e = await errorOf(adminPost('change-plan', { userId: 'u1', planKey: 'pro_mensal' }))
    expect(e.status).toBe(504)
    expect(e.message).toBe(MSG_ACTION_LOST)
    expect(e.uncertain).toBe(true)
  })

  it('5xx com corpo sem a frase do servidor numa ação também é incerto', async () => {
    mockFetch().mockResolvedValue(json({ message: 'FUNCTION_INVOCATION_FAILED' }, 500))
    const e = await errorOf(adminPost('adjust-quota', { userId: 'u1', mode: 'add', amount: 5 }))
    expect(e.status).toBe(500)
    expect(e.message).toBe(MSG_ACTION_LOST)
    expect(e.uncertain).toBe(true)
  })

  it('resposta 200 sem corpo legível numa ação é incerta (o servidor pode ter feito)', async () => {
    mockFetch().mockResolvedValue(new Response('', { status: 200 }))
    const e = await errorOf(adminPost('adjust-quota', { userId: 'u1', mode: 'add', amount: 5 }))
    expect(e.status).toBe(200)
    expect(e.message).toBe(MSG_ACTION_LOST)
    expect(e.uncertain).toBe(true)
  })

  it('erro com a frase do nosso servidor numa ação não é incerto: a ação com certeza não foi feita', async () => {
    const cases: Array<[number, string]> = [
      [400, 'Escreva uma nota com pelo menos 3 caracteres.'],
      [409, 'Esta marcação já foi conferida.'],
      [500, 'Erro inesperado no servidor.'],
      [502, 'O Asaas não respondeu. Nada foi marcado.'],
    ]
    for (const [status, error] of cases) {
      mockFetch().mockResolvedValue(json({ error }, status))
      const e = await errorOf(adminPost('resolve-flag', { subscriptionRef: 'sub_1', note: 'ok!' }))
      expect(e.status).toBe(status)
      expect(e.message).toBe(error)
      expect(e.uncertain).toBe(false)
    }
    for (const status of [401, 403]) {
      mockFetch().mockResolvedValue(json({ error: 'x' }, status))
      expect((await errorOf(adminPost('resolve-flag', { subscriptionRef: 'sub_1', note: 'ok!' }))).uncertain).toBe(false)
    }
  })

  it('erro de consulta nunca é incerto, nem de rede nem 504 sem JSON', async () => {
    mockFetch().mockRejectedValue(new TypeError('Failed to fetch'))
    expect((await errorOf(adminGet('review'))).uncertain).toBe(false)
    mockFetch().mockResolvedValue(new Response('<html>Gateway Timeout</html>', { status: 504 }))
    const e = await errorOf(adminGet('review'))
    expect(e.message).toBe('Erro inesperado (código 504).')
    expect(e.uncertain).toBe(false)
  })

  it('resposta a tempo não deixa o teto disparar depois', async () => {
    vi.useFakeTimers()
    mockFetch().mockResolvedValue(json({ ok: true }))
    await expect(adminGet('review')).resolves.toEqual({ ok: true })
    expect(vi.getTimerCount()).toBe(0)
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

  // Ruling ADM-T4-id: dois pedidos nunca dividem o mesmo id. Fluxo da T8 e da T26: duas ações
  // terminam e cada uma chama refetch pela mesma closure, criada no mesmo render.
  it('dois refetch pela mesma closure: a velha chegando por último não sobrescreve a nova', async () => {
    const pending = holdFetch()
    const { result } = renderHook(() => useAdminQuery<{ v: string }>('review'))
    await waitFor(() => expect(pending).toHaveLength(1))
    await act(async () => pending[0](json({ v: 'inicial' })))
    await waitFor(() => expect(result.current.loading).toBe(false))

    const refetch = result.current.refetch
    let first!: Promise<void>
    let second!: Promise<void>
    act(() => {
      first = refetch()
      second = refetch()
    })
    await waitFor(() => expect(pending).toHaveLength(3))
    expect(result.current.loading).toBe(true)

    await act(async () => pending[2](json({ v: 'nova' })))
    await waitFor(() => expect(result.current.data).toEqual({ v: 'nova' }))
    expect(result.current.loading).toBe(false)
    await act(async () => pending[1](json({ v: 'velha' })))
    await act(async () => {
      await Promise.all([first, second])
    })
    expect(result.current.data).toEqual({ v: 'nova' })
    expect(result.current.loading).toBe(false)
  })

  it('dois refetch pela mesma closure: o carregando só desliga com a resposta mais nova', async () => {
    const pending = holdFetch()
    const { result } = renderHook(() => useAdminQuery<{ v: string }>('review'))
    await waitFor(() => expect(pending).toHaveLength(1))
    await act(async () => pending[0](json({ v: 'inicial' })))
    await waitFor(() => expect(result.current.loading).toBe(false))

    const refetch = result.current.refetch
    act(() => {
      void refetch()
      void refetch()
    })
    await waitFor(() => expect(pending).toHaveLength(3))
    await act(async () => pending[1](json({ v: 'velha' })))
    expect(result.current.loading).toBe(true)
    expect(result.current.data).toEqual({ v: 'inicial' })

    await act(async () => pending[2](json({ v: 'nova' })))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.data).toEqual({ v: 'nova' })
  })

  it('filtro A, depois B, depois A de novo: a velha de A chegando por último não sobrescreve a nova', async () => {
    const pending = holdFetch()
    const { result, rerender } = renderHook(
      ({ q }: { q: string }) => useAdminQuery<{ v: string }>('subscribers', { q }),
      { initialProps: { q: 'A' } },
    )
    await waitFor(() => expect(pending).toHaveLength(1))
    rerender({ q: 'B' })
    await waitFor(() => expect(pending).toHaveLength(2))
    rerender({ q: 'A' })
    await waitFor(() => expect(pending).toHaveLength(3))

    await act(async () => pending[2](json({ v: 'A nova' })))
    await waitFor(() => expect(result.current.data).toEqual({ v: 'A nova' }))
    expect(result.current.loading).toBe(false)
    await act(async () => pending[1](json({ v: 'B' })))
    await act(async () => pending[0](json({ v: 'A velha' })))
    expect(result.current.data).toEqual({ v: 'A nova' })
    expect(result.current.loading).toBe(false)
  })

  it('filtro A, depois B, depois A de novo: o carregando só desliga com a resposta mais nova', async () => {
    const pending = holdFetch()
    const { result, rerender } = renderHook(
      ({ q }: { q: string }) => useAdminQuery<{ v: string }>('subscribers', { q }),
      { initialProps: { q: 'A' } },
    )
    await waitFor(() => expect(pending).toHaveLength(1))
    rerender({ q: 'B' })
    await waitFor(() => expect(pending).toHaveLength(2))
    rerender({ q: 'A' })
    await waitFor(() => expect(pending).toHaveLength(3))

    await act(async () => pending[0](json({ v: 'A velha' })))
    await act(async () => pending[1](json({ v: 'B' })))
    expect(result.current.loading).toBe(true)
    expect(result.current.data).toBeNull()

    await act(async () => pending[2](json({ v: 'A nova' })))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.data).toEqual({ v: 'A nova' })
  })

  it('voltar a um filtro que já tinha resposta liga o carregando até o pedido novo chegar', async () => {
    const pending = holdFetch()
    const { result, rerender } = renderHook(
      ({ q }: { q: string }) => useAdminQuery<{ v: string }>('subscribers', { q }),
      { initialProps: { q: 'A' } },
    )
    await waitFor(() => expect(pending).toHaveLength(1))
    await act(async () => pending[0](json({ v: 'A 1' })))
    await waitFor(() => expect(result.current.loading).toBe(false))
    rerender({ q: 'B' })
    await waitFor(() => expect(pending).toHaveLength(2))
    rerender({ q: 'A' })
    await waitFor(() => expect(pending).toHaveLength(3))
    expect(result.current.loading).toBe(true)

    await act(async () => pending[1](json({ v: 'B' })))
    expect(result.current.loading).toBe(true)
    await act(async () => pending[2](json({ v: 'A 2' })))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.data).toEqual({ v: 'A 2' })
  })

  // Ruling ADM-T4-refetch: o refetch pede com a ação e os parâmetros de agora. Fluxo da T19:
  // "Completar custos que faltam" chama o refetch quando a varredura termina, e o período pode ter
  // mudado no meio; a T26 recarrega a ficha depois de cada ação.
  it('refetch de closure velha depois de trocar o filtro não trava o carregando nem mostra o dado do filtro velho', async () => {
    const pending = holdFetchWithUrl()
    const { result, rerender } = renderHook(
      ({ q }: { q: string }) => useAdminQuery<{ v: string | null }>('subscribers', { q }),
      { initialProps: { q: 'A' } },
    )
    await waitFor(() => expect(pending).toHaveLength(1))
    await act(async () => pending[0].resolve(json({ v: 'A' })))
    await waitFor(() => expect(result.current.loading).toBe(false))

    const staleRefetch = result.current.refetch
    rerender({ q: 'B' })
    await waitFor(() => expect(pending).toHaveLength(2))
    let done!: Promise<void>
    act(() => {
      done = staleRefetch()
    })
    await waitFor(() => expect(pending).toHaveLength(3))
    // Cada pedido responde o filtro que pediu, na ordem em que saiu.
    await act(async () => pending[1].resolve(json({ v: qOf(pending[1].url) })))
    await act(async () => pending[2].resolve(json({ v: qOf(pending[2].url) })))
    await act(async () => {
      await done
    })
    expect(result.current.loading).toBe(false)
    expect(result.current.data).toEqual({ v: 'B' })
    expect(qOf(pending[2].url)).toBe('B')
  })

  it('refetch de closure velha depois de trocar o filtro, com a resposta do refetch chegando primeiro', async () => {
    const pending = holdFetchWithUrl()
    const { result, rerender } = renderHook(
      ({ q }: { q: string }) => useAdminQuery<{ v: string | null }>('subscribers', { q }),
      { initialProps: { q: 'A' } },
    )
    await waitFor(() => expect(pending).toHaveLength(1))
    await act(async () => pending[0].resolve(json({ v: 'A' })))
    await waitFor(() => expect(result.current.loading).toBe(false))

    const staleRefetch = result.current.refetch
    rerender({ q: 'B' })
    await waitFor(() => expect(pending).toHaveLength(2))
    act(() => {
      void staleRefetch()
    })
    await waitFor(() => expect(pending).toHaveLength(3))
    await act(async () => pending[2].resolve(json({ v: qOf(pending[2].url) })))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.data).toEqual({ v: 'B' })
    // A resposta do pedido que perdeu a vez chega depois e não muda nada.
    await act(async () => pending[1].resolve(json({ v: 'B velha' })))
    expect(result.current.data).toEqual({ v: 'B' })
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

  it('GET pendurado: em 15 s a tela recebe a mensagem e o carregando desliga', async () => {
    vi.useFakeTimers()
    mockFetch().mockImplementation(() => new Promise<Response>(() => {}))
    const { result } = renderHook(() => useAdminQuery('review'))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(14_999)
    })
    expect(result.current.loading).toBe(true)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1)
    })
    expect(result.current.loading).toBe(false)
    expect(result.current.error).toBe(MSG_TIMEOUT_GET)
  })

  it('com enabled falso não chama o servidor', async () => {
    const f = mockFetch()
    const { result } = renderHook(() => useAdminQuery('review', undefined, { enabled: false }))
    await act(async () => {})
    expect(f).not.toHaveBeenCalled()
    expect(result.current.loading).toBe(false)
  })
})

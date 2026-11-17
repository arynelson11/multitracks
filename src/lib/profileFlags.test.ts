import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type Res = { data: unknown; error: { message: string; code?: string } | null }

const h = vi.hoisted(() => ({
  answer: null as Res | null,
  failRead: false,
  hold: null as Promise<void> | null,
  reads: [] as { table: string; cols: string; col: string; value: string }[],
  rpc: vi.fn(),
}))

vi.mock('./supabase', () => ({
  supabase: {
    from: (table: string) => ({
      select: (cols: string) => ({
        eq: (col: string, value: string) => ({
          maybeSingle: async () => {
            h.reads.push({ table, cols, col, value })
            if (h.hold) await h.hold
            if (h.failRead) throw new Error('rede caiu')
            return h.answer ?? { data: null, error: null }
          },
        }),
      }),
    }),
    rpc: h.rpc,
  },
}))

import { fetchProfileFlags, fetchProfileFlagsWithin, PROFILE_FLAGS_TIMEOUT_MS, shouldShowBlocked } from './profileFlags'

const NOT_ADMIN = { isAdmin: false, blockedAt: null }

beforeEach(() => {
  h.answer = null
  h.failRead = false
  h.hold = null
  h.reads.length = 0
  h.rpc.mockReset()
})

describe('fetchProfileFlags', () => {
  it('fetchProfileFlags devolve o papel e o bloqueio', async () => {
    h.answer = { data: { is_admin: true, blocked_at: '2026-11-17T15:00:00Z' }, error: null }
    await expect(fetchProfileFlags('u1')).resolves.toEqual({ isAdmin: true, blockedAt: '2026-11-17T15:00:00Z' })
    expect(h.reads).toEqual([{ table: 'profiles', cols: 'is_admin, blocked_at', col: 'id', value: 'u1' }])
  })

  it('coluna ausente devolve não admin', async () => {
    h.answer = { data: null, error: { code: '42703', message: 'column profiles.is_admin does not exist' } }
    await expect(fetchProfileFlags('u1')).resolves.toEqual(NOT_ADMIN)
  })

  it('erro do banco, sem linha ou falha de rede devolvem não admin', async () => {
    h.answer = { data: { is_admin: true, blocked_at: null }, error: { message: 'permission denied' } }
    await expect(fetchProfileFlags('u1')).resolves.toEqual(NOT_ADMIN)
    h.answer = { data: null, error: null }
    await expect(fetchProfileFlags('u1')).resolves.toEqual(NOT_ADMIN)
    h.answer = null
    h.failRead = true
    await expect(fetchProfileFlags('u1')).resolves.toEqual(NOT_ADMIN)
  })

  it('só o valor true dá admin', async () => {
    for (const value of ['true', 1, null, undefined]) {
      h.answer = { data: { is_admin: value, blocked_at: null }, error: null }
      await expect(fetchProfileFlags('u1')).resolves.toEqual(NOT_ADMIN)
    }
  })

  it('conta comum bloqueada devolve a data do bloqueio', async () => {
    h.answer = { data: { is_admin: false, blocked_at: '2026-11-10T12:00:00Z' }, error: null }
    await expect(fetchProfileFlags('u1')).resolves.toEqual({ isAdmin: false, blockedAt: '2026-11-10T12:00:00Z' })
  })
})

describe('touchLastSeen', () => {
  // A trava é do módulo: cada teste pega um módulo novo.
  const freshTouch = async () => {
    vi.resetModules()
    return (await import('./profileFlags')).touchLastSeen
  }

  it('touchLastSeen chama o banco uma vez só por conta', async () => {
    h.rpc.mockReturnValue(Promise.resolve({ data: null, error: null }))
    const touchLastSeen = await freshTouch()
    touchLastSeen('u1')
    touchLastSeen('u1')
    expect(h.rpc).toHaveBeenCalledTimes(1)
    expect(h.rpc).toHaveBeenCalledWith('touch_last_seen')
    // Outra conta entrando no mesmo app aberto também grava a última abertura dela.
    touchLastSeen('u2')
    touchLastSeen('u2')
    expect(h.rpc).toHaveBeenCalledTimes(2)
  })

  it('dispara o pedido sem esperar (o supabase-js só manda quando alguém chama then)', async () => {
    const then = vi.fn()
    h.rpc.mockReturnValue({ then })
    const touchLastSeen = await freshTouch()
    expect(touchLastSeen('u1')).toBeUndefined()
    expect(then).toHaveBeenCalledTimes(1)
  })

  it('erro do banco é ignorado', async () => {
    h.rpc.mockReturnValue(Promise.reject(new Error('function touch_last_seen does not exist')))
    const touchLastSeen = await freshTouch()
    expect(() => touchLastSeen('u1')).not.toThrow()
    await new Promise((r) => setTimeout(r, 0))

    h.rpc.mockReset()
    h.rpc.mockImplementation(() => { throw new Error('cliente quebrado') })
    const touchAgain = await freshTouch()
    expect(() => touchAgain('u1')).not.toThrow()
  })
})

describe('shouldShowBlocked', () => {
  const user = { id: 'u1' }
  const BLOCKED_AT = '2026-11-17T15:00:00Z'

  it('conta comum com login e bloqueio vê a tela de bloqueio', () => {
    expect(shouldShowBlocked({ user, blockedAt: BLOCKED_AT, isAdmin: false })).toBe(true)
  })

  it('admin com blockedAt preenchido não fica preso fora do app', () => {
    expect(shouldShowBlocked({ user, blockedAt: BLOCKED_AT, isAdmin: true })).toBe(false)
  })

  it('sem login não mostra a tela de bloqueio', () => {
    expect(shouldShowBlocked({ user: null, blockedAt: BLOCKED_AT, isAdmin: false })).toBe(false)
    expect(shouldShowBlocked({ user: undefined, blockedAt: BLOCKED_AT, isAdmin: false })).toBe(false)
  })

  it('sem bloqueio (ou leitura que falhou e voltou vazia) segue no app', () => {
    expect(shouldShowBlocked({ user, blockedAt: null, isAdmin: false })).toBe(false)
    expect(shouldShowBlocked({ user, blockedAt: '', isAdmin: false })).toBe(false)
    // Quem monta o App com um login falso sem o campo (testes antigos) também segue no app.
    expect(shouldShowBlocked({ user, blockedAt: undefined as unknown as null, isAdmin: false })).toBe(false)
  })
})

describe('fetchProfileFlagsWithin (teto da leitura do papel, Ruling ADM-T27-teto)', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('o teto é de 4 s', () => {
    expect(PROFILE_FLAGS_TIMEOUT_MS).toBe(4000)
  })

  it('leitura que chega antes do teto devolve o papel e não deixa relógio ligado', async () => {
    h.answer = { data: { is_admin: true, blocked_at: null }, error: null }
    await expect(fetchProfileFlagsWithin('u1')).resolves.toEqual({ isAdmin: true, blockedAt: null })
    expect(vi.getTimerCount()).toBe(0)
  })

  it('leitura que falha antes do teto segue a regra de hoje (não admin)', async () => {
    h.failRead = true
    await expect(fetchProfileFlagsWithin('u1')).resolves.toEqual(NOT_ADMIN)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('leitura pendurada: null aos 4 s, e a resposta atrasada não muda o resultado', async () => {
    let release = () => {}
    h.hold = new Promise<void>((r) => { release = r })
    h.answer = { data: { is_admin: true, blocked_at: '2026-11-17T15:00:00Z' }, error: null }
    let result: unknown = 'pendente'
    void fetchProfileFlagsWithin('u1').then((r) => { result = r })

    await vi.advanceTimersByTimeAsync(PROFILE_FLAGS_TIMEOUT_MS - 1)
    expect(result).toBe('pendente')
    await vi.advanceTimersByTimeAsync(1)
    expect(result).toBeNull()

    release()
    await vi.advanceTimersByTimeAsync(0)
    expect(result).toBeNull()
  })
})

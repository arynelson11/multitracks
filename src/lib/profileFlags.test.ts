import { beforeEach, describe, expect, it, vi } from 'vitest'

type Res = { data: unknown; error: { message: string; code?: string } | null }

const h = vi.hoisted(() => ({
  answer: null as Res | null,
  failRead: false,
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
            if (h.failRead) throw new Error('rede caiu')
            return h.answer ?? { data: null, error: null }
          },
        }),
      }),
    }),
    rpc: h.rpc,
  },
}))

import { fetchProfileFlags } from './profileFlags'

const NOT_ADMIN = { isAdmin: false, blockedAt: null }

beforeEach(() => {
  h.answer = null
  h.failRead = false
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

  it('touchLastSeen chama o banco uma vez só', async () => {
    h.rpc.mockReturnValue(Promise.resolve({ data: null, error: null }))
    const touchLastSeen = await freshTouch()
    touchLastSeen()
    touchLastSeen()
    expect(h.rpc).toHaveBeenCalledTimes(1)
    expect(h.rpc).toHaveBeenCalledWith('touch_last_seen')
  })

  it('dispara o pedido sem esperar (o supabase-js só manda quando alguém chama then)', async () => {
    const then = vi.fn()
    h.rpc.mockReturnValue({ then })
    const touchLastSeen = await freshTouch()
    expect(touchLastSeen()).toBeUndefined()
    expect(then).toHaveBeenCalledTimes(1)
  })

  it('erro do banco é ignorado', async () => {
    h.rpc.mockReturnValue(Promise.reject(new Error('function touch_last_seen does not exist')))
    const touchLastSeen = await freshTouch()
    expect(() => touchLastSeen()).not.toThrow()
    await new Promise((r) => setTimeout(r, 0))

    h.rpc.mockReset()
    h.rpc.mockImplementation(() => { throw new Error('cliente quebrado') })
    const touchAgain = await freshTouch()
    expect(() => touchAgain()).not.toThrow()
  })
})

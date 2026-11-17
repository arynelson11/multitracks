// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'

// Usa o useAuth de verdade: só o banco e a sincronização da cobrança são falsos.
type Row = { plan: string; plan_expires_at: string | null; is_admin: boolean; blocked_at: string | null }
type FakeSession = { user: { id: string; email: string }; access_token: string }

const h = vi.hoisted(() => ({
  session: null as FakeSession | null,
  rows: {} as Record<string, Row>,
  listeners: [] as ((event: string, session: unknown) => void)[],
  hold: null as Promise<void> | null,
}))

vi.mock('../../lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: async () => ({ data: { session: h.session } }),
      onAuthStateChange: (cb: (event: string, session: unknown) => void) => {
        h.listeners.push(cb)
        return { data: { subscription: { unsubscribe: () => {} } } }
      },
      signOut: async () => {},
    },
    from: () => ({
      select: () => ({
        eq: (_col: string, id: string) => ({
          maybeSingle: async () => {
            if (h.hold) await h.hold
            return { data: h.rows[id] ?? null, error: null }
          },
        }),
      }),
    }),
    rpc: () => Promise.resolve({ data: null, error: null }),
  },
  getAuthHeaders: async () => ({}),
}))
vi.mock('../../lib/subscription', () => ({ syncBillingOnLogin: async () => {} }))

import { useAdminGuard, type GuardStatus } from './useAdminGuard'

const OWNER = ['arynelson11', 'gmail.com'].join('@')
const row = (isAdmin: boolean): Row => ({ plan: 'pro_mensal', plan_expires_at: null, is_admin: isAdmin, blocked_at: null })
const sessionOf = (id: string, email: string): FakeSession => ({ user: { id, email }, access_token: 'tok' })

beforeEach(() => {
  h.session = null
  h.rows = {}
  h.listeners.length = 0
  h.hold = null
})
afterEach(cleanup)

describe('useAdminGuard', () => {
  it('useAdminGuard nega quem tem o e-mail do dono e is_admin falso', async () => {
    h.session = sessionOf('u-dono', OWNER)
    h.rows['u-dono'] = row(false)
    const { result } = renderHook(() => useAdminGuard())
    await waitFor(() => expect(result.current.status).not.toBe('loading'))
    expect(result.current.status).toBe('denied')
    expect(result.current.email).toBe(OWNER)
  })

  it('libera quem tem o papel de admin, com qualquer e-mail', async () => {
    h.session = sessionOf('u-adm', 'equipe@exemplo.com')
    h.rows['u-adm'] = row(true)
    const { result } = renderHook(() => useAdminGuard())
    await waitFor(() => expect(result.current.status).toBe('ok'))
  })

  it('sem perfil lido (linha ausente) não é admin', async () => {
    h.session = sessionOf('u-sem', 'sem@exemplo.com')
    const { result } = renderHook(() => useAdminGuard())
    await waitFor(() => expect(result.current.status).not.toBe('loading'))
    expect(result.current.status).toBe('denied')
  })

  it('sem login é anon', async () => {
    const { result } = renderHook(() => useAdminGuard())
    await waitFor(() => expect(result.current.status).toBe('anon'))
  })

  it('login nesta aba fica carregando até o papel chegar, sem mostrar acesso negado', async () => {
    const seen: GuardStatus[] = []
    const { result } = renderHook(() => {
      const guard = useAdminGuard()
      seen.push(guard.status)
      return guard
    })
    await waitFor(() => expect(result.current.status).toBe('anon'))

    let release = () => {}
    h.hold = new Promise<void>((r) => { release = r })
    h.rows['u-adm'] = row(true)
    act(() => { for (const cb of h.listeners) cb('SIGNED_IN', sessionOf('u-adm', 'equipe@exemplo.com')) })
    expect(result.current.status).toBe('loading')

    await act(async () => { release() })
    await waitFor(() => expect(result.current.status).toBe('ok'))
    expect(seen).not.toContain('denied')
  })

  it('o mesmo usuário de novo (renovação do token) não volta a carregar', async () => {
    h.session = sessionOf('u-adm', 'equipe@exemplo.com')
    h.rows['u-adm'] = row(true)
    const { result } = renderHook(() => useAdminGuard())
    await waitFor(() => expect(result.current.status).toBe('ok'))

    h.hold = new Promise<void>(() => {})
    act(() => { for (const cb of h.listeners) cb('TOKEN_REFRESHED', sessionOf('u-adm', 'equipe@exemplo.com')) })
    expect(result.current.status).toBe('ok')
  })
})

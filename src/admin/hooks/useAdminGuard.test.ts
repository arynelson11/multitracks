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
  failFor: null as string | null,
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
            if (id === h.failFor) return { data: null, error: { message: 'rede caiu' } }
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
import { useAuth } from '../../hooks/useAuth'

const OWNER = ['arynelson11', 'gmail.com'].join('@')
const row = (isAdmin: boolean): Row => ({ plan: 'pro_mensal', plan_expires_at: null, is_admin: isAdmin, blocked_at: null })
const sessionOf = (id: string, email: string): FakeSession => ({ user: { id, email }, access_token: 'tok' })

beforeEach(() => {
  h.session = null
  h.rows = {}
  h.listeners.length = 0
  h.hold = null
  h.failFor = null
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

describe('useAuth: papel e bloqueio da conta da sessão', () => {
  const emit = (event: string, session: FakeSession | null) => act(() => { for (const cb of h.listeners) cb(event, session) })
  const reloadPlan = () => act(async () => { window.dispatchEvent(new Event('playback-plan-changed')) })
  const blockedRow: Row = { plan: 'free', plan_expires_at: null, is_admin: false, blocked_at: '2026-11-10T12:00:00Z' }

  it('SIGNED_OUT zera o papel e o bloqueio', async () => {
    h.session = sessionOf('u-adm', 'equipe@exemplo.com')
    h.rows['u-adm'] = row(true)
    const admin = renderHook(() => useAuth())
    await waitFor(() => expect(admin.result.current.isAdmin).toBe(true))
    emit('SIGNED_OUT', null)
    expect(admin.result.current.isAdmin).toBe(false)
    expect(admin.result.current.user).toBeNull()
    admin.unmount()

    h.session = sessionOf('u-blq', 'bloqueado@exemplo.com')
    h.rows['u-blq'] = blockedRow
    const blocked = renderHook(() => useAuth())
    await waitFor(() => expect(blocked.result.current.blockedAt).toBe('2026-11-10T12:00:00Z'))
    emit('SIGNED_OUT', null)
    expect(blocked.result.current.blockedAt).toBeNull()
  })

  it('na falha de rede a mesma conta mantém o papel', async () => {
    h.session = sessionOf('u-adm', 'equipe@exemplo.com')
    h.rows['u-adm'] = row(true)
    const { result } = renderHook(() => useAuth())
    await waitFor(() => expect(result.current.isAdmin).toBe(true))
    h.failFor = 'u-adm'
    await reloadPlan()
    await act(async () => {})
    expect(result.current.isAdmin).toBe(true)
  })

  it('outra conta com a leitura falhando não herda o papel nem o bloqueio', async () => {
    h.session = sessionOf('u-blq', 'bloqueado@exemplo.com')
    h.rows['u-blq'] = blockedRow
    const blocked = renderHook(() => useAuth())
    await waitFor(() => expect(blocked.result.current.blockedAt).not.toBeNull())
    h.failFor = 'u-outra'
    emit('SIGNED_IN', sessionOf('u-outra', 'outra@exemplo.com'))
    await waitFor(() => expect(blocked.result.current.loading).toBe(false))
    expect(blocked.result.current.blockedAt).toBeNull()
    blocked.unmount()

    h.listeners.length = 0
    h.failFor = null
    h.session = sessionOf('u-adm', 'equipe@exemplo.com')
    h.rows['u-adm'] = row(true)
    const admin = renderHook(() => useAuth())
    await waitFor(() => expect(admin.result.current.isAdmin).toBe(true))
    h.failFor = 'u-outra'
    emit('SIGNED_IN', sessionOf('u-outra', 'outra@exemplo.com'))
    await waitFor(() => expect(admin.result.current.loading).toBe(false))
    expect(admin.result.current.user?.id).toBe('u-outra')
    expect(admin.result.current.isAdmin).toBe(false)
  })

  it('resposta atrasada da conta que saiu não devolve o papel', async () => {
    h.session = sessionOf('u-adm', 'equipe@exemplo.com')
    h.rows['u-adm'] = row(true)
    const { result } = renderHook(() => useAuth())
    await waitFor(() => expect(result.current.isAdmin).toBe(true))

    let release = () => {}
    h.hold = new Promise<void>((r) => { release = r })
    await reloadPlan()
    emit('SIGNED_OUT', null)
    expect(result.current.isAdmin).toBe(false)

    await act(async () => { release() })
    await act(async () => {})
    expect(result.current.isAdmin).toBe(false)
  })
})

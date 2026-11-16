// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'

// App desktop simulado: guarda o callback do deep link pra o teste disparar.
const { deepLink, auth } = vi.hoisted(() => ({
  deepLink: { cb: null as ((fragment: string) => void) | null },
  auth: {
    setSession: vi.fn(async (_tokens: { access_token: string; refresh_token: string }) => ({ data: {}, error: null })),
    resetPasswordForEmail: vi.fn(async (_email: string, _opts?: { redirectTo: string }) => ({ data: {}, error: null })),
  },
}))
vi.mock('../lib/desktop', () => ({
  isElectron: true,
  onDeepLinkAuth: (cb: (fragment: string) => void) => { deepLink.cb = cb; return () => {} },
}))
vi.mock('../lib/supabase', () => ({ supabase: { auth } }))

import { AuthPage } from './AuthPage'
import { finishPasswordRecovery, isPasswordRecovery } from '../lib/passwordRecovery'

afterEach(() => {
  cleanup()
  finishPasswordRecovery()
})

describe('AuthPage no app desktop: recuperar senha', () => {
  it('o link do email abre o app pelo playbackstudio:// e liga a tela Criar nova senha', async () => {
    render(<AuthPage />)
    await act(async () => {
      deepLink.cb?.('access_token=a&expires_in=3600&refresh_token=b&token_type=bearer&type=recovery')
    })
    expect(auth.setSession).toHaveBeenCalledWith({ access_token: 'a', refresh_token: 'b' })
    expect(isPasswordRecovery()).toBe(true)
  })

  it('login com Google pelo deep link não liga a tela de nova senha', async () => {
    render(<AuthPage />)
    await act(async () => { deepLink.cb?.('access_token=a&refresh_token=b&token_type=bearer') })
    expect(isPasswordRecovery()).toBe(false)
  })

  it('Esqueceu sua senha? no desktop manda o link voltar pro app', async () => {
    render(<AuthPage />)
    fireEvent.click(screen.getByText('Esqueceu sua senha?'))
    fireEvent.change(screen.getByPlaceholderText(/email/i), { target: { value: 'pessoa@exemplo.com' } })
    await act(async () => { fireEvent.submit(screen.getByPlaceholderText(/email/i).closest('form')!) })
    expect(auth.resetPasswordForEmail).toHaveBeenCalledWith('pessoa@exemplo.com', { redirectTo: 'playbackstudio://auth/callback' })
  })
})

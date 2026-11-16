// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'

// Desktop ou navegador simulado, com o callback do deep link guardado pra o teste disparar.
const { desktop, auth } = vi.hoisted(() => ({
  desktop: { electron: true, cb: null as ((fragment: string) => void) | null },
  auth: {
    setSession: vi.fn<(tokens: { access_token: string; refresh_token: string }) => Promise<{ data: object; error: { message: string } | null }>>(
      async () => ({ data: {}, error: null })),
    resetPasswordForEmail: vi.fn<(email: string, opts?: { redirectTo: string }) => Promise<{ data: object; error: null }>>(
      async () => ({ data: {}, error: null })),
    signUp: vi.fn<(creds: { email: string; password: string; options?: { emailRedirectTo?: string } }) => Promise<{ data: object; error: null }>>(
      async () => ({ data: {}, error: null })),
  },
}))
vi.mock('../lib/desktop', () => ({
  get isElectron() { return desktop.electron },
  onDeepLinkAuth: (cb: (fragment: string) => void) => { desktop.cb = cb; return () => {} },
}))
vi.mock('../lib/supabase', () => ({ supabase: { auth } }))

import { AuthPage } from './AuthPage'
import { finishPasswordRecovery, isPasswordRecovery } from '../lib/passwordRecovery'

const SITE = 'https://playbackstudio.com.br/'

afterEach(() => {
  cleanup()
  finishPasswordRecovery()
  vi.clearAllMocks()
  desktop.electron = true
})

const emailInput = () => screen.getByPlaceholderText('seu@email.com')
async function pedirRecuperacao() {
  render(<AuthPage />)
  fireEvent.click(screen.getByText('Esqueceu sua senha?'))
  fireEvent.change(emailInput(), { target: { value: 'pessoa@exemplo.com' } })
  await act(async () => { fireEvent.submit(emailInput().closest('form')!) })
}

describe('AuthPage: links do e-mail sempre voltam no site', () => {
  it('desktop: recuperar senha manda o link pro site e orienta a voltar ao app', async () => {
    await pedirRecuperacao()
    expect(auth.resetPasswordForEmail).toHaveBeenCalledWith('pessoa@exemplo.com', { redirectTo: SITE })
    expect(screen.getByText(/Abra o link do e-mail no navegador, crie a nova senha e volte ao app para entrar\./)).toBeTruthy()
  })

  it('navegador: recuperar senha também manda o link pro site', async () => {
    desktop.electron = false
    await pedirRecuperacao()
    expect(auth.resetPasswordForEmail).toHaveBeenCalledWith('pessoa@exemplo.com', { redirectTo: SITE })
  })

  it('cadastro manda o link de confirmação pro site (desktop e navegador)', async () => {
    for (const electron of [true, false]) {
      desktop.electron = electron
      render(<AuthPage />)
      fireEvent.click(screen.getByRole('button', { name: 'Criar conta' }))
      fireEvent.change(emailInput(), { target: { value: 'nova@exemplo.com' } })
      fireEvent.change(screen.getByPlaceholderText('Sua senha'), { target: { value: 'senhaforte1' } })
      await act(async () => { fireEvent.submit(emailInput().closest('form')!) })
      expect(auth.signUp).toHaveBeenLastCalledWith({ email: 'nova@exemplo.com', password: 'senhaforte1', options: { emailRedirectTo: SITE } })
      cleanup()
    }
  })
})

describe('AuthPage no desktop: deep link', () => {
  it('link de recuperar senha que chegue pelo app não loga nem abre a tela: orienta a usar o navegador', async () => {
    render(<AuthPage />)
    await act(async () => { desktop.cb?.('access_token=a&refresh_token=b&token_type=bearer&type=recovery') })
    expect(auth.setSession).not.toHaveBeenCalled()
    expect(isPasswordRecovery()).toBe(false)
    expect(document.body.textContent).toContain('Abra o link do e-mail no navegador, crie a nova senha e volte ao app para entrar.')
    expect(document.body.textContent).not.toMatch(/Erro ao (entrar com o|restaurar sessão do) Google/)
  })

  it('erro no login com Google continua dizendo Google', async () => {
    auth.setSession.mockResolvedValueOnce({ data: {}, error: { message: 'token inválido' } })
    render(<AuthPage />)
    await act(async () => { desktop.cb?.('access_token=a&refresh_token=b&token_type=bearer') })
    expect(auth.setSession).toHaveBeenCalledWith({ access_token: 'a', refresh_token: 'b' })
    expect(document.body.textContent).toContain('Erro ao entrar com o Google: token inválido')
  })
})

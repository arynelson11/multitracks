// @vitest-environment jsdom
// Login do /admin na web na linguagem do palco (Parte 3, faixa C): os mesmos campos, o mesmo
// pedido ao Supabase e as mesmas mensagens, agora com os campos e o botão do kit.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { AdminLogin } from './AdminLogin'
import { oldLanguageClasses } from '../test/psLanguage'

const h = vi.hoisted(() => ({
  signIn: vi.fn(),
  semSupabase: false,
}))
vi.mock('../lib/supabase', () => ({
  get supabase() {
    return h.semSupabase ? null : { auth: { signInWithPassword: h.signIn } }
  },
}))

afterEach(() => {
  cleanup()
  h.signIn.mockReset()
  h.semSupabase = false
})

function preencher() {
  render(<AdminLogin />)
  fireEvent.change(screen.getByLabelText('E-mail'), { target: { value: 'dono@playbackstudio.com.br' } })
  fireEvent.change(screen.getByLabelText('Senha'), { target: { value: 'segredo123' } })
}

describe('Login do admin: nada some', () => {
  it('título, e-mail e senha com o tipo e o preenchimento automático de antes', () => {
    render(<AdminLogin />)
    expect(screen.getByRole('heading', { level: 1, name: 'Painel do admin' })).toBeTruthy()
    const email = screen.getByLabelText('E-mail')
    expect([email.getAttribute('type'), email.getAttribute('autocomplete')]).toEqual(['email', 'email'])
    const senha = screen.getByLabelText('Senha')
    expect([senha.getAttribute('type'), senha.getAttribute('autocomplete')]).toEqual(['password', 'current-password'])
  })

  it('Entrar manda e-mail e senha ao Supabase', async () => {
    h.signIn.mockResolvedValue({ error: null })
    preencher()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Entrar' })) })
    expect(h.signIn).toHaveBeenCalledWith({ email: 'dono@playbackstudio.com.br', password: 'segredo123' })
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('senha errada avisa em alerta', async () => {
    h.signIn.mockResolvedValue({ error: { message: 'Invalid login' } })
    preencher()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Entrar' })) })
    expect(screen.getByRole('alert').textContent).toBe('E-mail ou senha inválidos.')
  })

  it('sem Supabase configurado avisa e não tenta entrar', async () => {
    h.semSupabase = true
    preencher()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Entrar' })) })
    expect(screen.getByRole('alert').textContent).toBe('Supabase não configurado.')
    expect(h.signIn).not.toHaveBeenCalled()
  })

  it('entrando: botão desligado e ocupado até a resposta', async () => {
    let soltar: (v: { error: null }) => void = () => {}
    h.signIn.mockImplementation(() => new Promise((r) => { soltar = r }))
    preencher()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Entrar' })) })
    const entrar = screen.getByRole('button', { name: 'Entrar' }) as HTMLButtonElement
    expect(entrar.disabled).toBe(true)
    expect(entrar.getAttribute('aria-busy')).toBe('true')
    await act(async () => { soltar({ error: null }) })
    expect((screen.getByRole('button', { name: 'Entrar' }) as HTMLButtonElement).disabled).toBe(false)
  })
})

describe('Login do admin: linguagem do palco', () => {
  it('só classes da linguagem nova, com o erro na tela', async () => {
    h.signIn.mockResolvedValue({ error: { message: 'x' } })
    preencher()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Entrar' })) })
    expect(oldLanguageClasses(document.body)).toEqual([])
  })
})

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

// Manutenção (2026-11-27): erro de rede no login não deixa o Entrar preso em "carregando".
describe('Login do admin: erro de rede', () => {
  const REDE = 'Não deu pra falar com o servidor agora. Confira a internet e tente de novo.'

  it('o pedido falhou de vez (lançou): o Entrar volta e a frase aparece', async () => {
    h.signIn.mockRejectedValue(new TypeError('Failed to fetch'))
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    preencher()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Entrar' })) })
    err.mockRestore()
    const entrar = screen.getByRole('button', { name: 'Entrar' }) as HTMLButtonElement
    expect(entrar.disabled).toBe(false)
    expect(entrar.getAttribute('aria-busy')).toBeNull()
    expect(screen.getByRole('alert').textContent).toBe(REDE)
  })

  it('o Supabase respondeu que não alcançou o servidor: a frase é a da internet, não a da senha', async () => {
    h.signIn.mockResolvedValue({ error: { name: 'AuthRetryableFetchError', status: 0, message: 'Failed to fetch' } })
    preencher()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Entrar' })) })
    expect(screen.getByRole('alert').textContent).toBe(REDE)
    expect((screen.getByRole('button', { name: 'Entrar' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('tentar de novo depois da falha limpa a frase e entra', async () => {
    h.signIn.mockRejectedValueOnce(new TypeError('Failed to fetch')).mockResolvedValueOnce({ error: null })
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    preencher()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Entrar' })) })
    err.mockRestore()
    expect(screen.getByRole('alert')).toBeTruthy()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Entrar' })) })
    expect(h.signIn).toHaveBeenCalledTimes(2)
    expect(screen.queryByRole('alert')).toBeNull()
  })
})

// Revisão das telas (M8): as formas reais do auth-js 2.97.0 no { error } e o console sem a senha.
describe('Login do admin: as respostas reais do Supabase', () => {
  const REDE = 'Não deu pra falar com o servidor agora. Confira a internet e tente de novo.'

  it('senha errada chega como AuthApiError 400: a frase da senha', async () => {
    h.signIn.mockResolvedValue({ error: { name: 'AuthApiError', status: 400, code: 'invalid_credentials', message: 'Invalid login credentials' } })
    preencher()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Entrar' })) })
    expect(screen.getByRole('alert').textContent).toBe('E-mail ou senha inválidos.')
  })

  it('servidor fora (503) chega como AuthRetryableFetchError: a frase da internet, pelo nome', async () => {
    h.signIn.mockResolvedValue({ error: { name: 'AuthRetryableFetchError', status: 503, message: 'Service Unavailable' } })
    preencher()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Entrar' })) })
    expect(screen.getByRole('alert').textContent).toBe(REDE)
  })

  it('o console nunca leva a senha, nem quando o erro carrega o pedido', async () => {
    const pedido = new Error('falhou no meio') as Error & { request?: unknown }
    pedido.request = { body: { email: 'dono@playbackstudio.com.br', password: 'segredo123' } }
    h.signIn.mockRejectedValue(pedido)
    const calls: unknown[][] = []
    const spies = (['error', 'warn', 'log', 'info', 'debug'] as const).map((m) => vi.spyOn(console, m).mockImplementation((...a: unknown[]) => { calls.push(a) }))
    preencher()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Entrar' })) })
    for (const sp of spies) sp.mockRestore()
    expect(calls.length).toBeGreaterThan(0)
    // Tudo o que foi pro console, a fundo (propriedades próprias de cada objeto, inclusive as do Error).
    const textos: string[] = []
    const visto = new Set<unknown>()
    const junta = (x: unknown): void => {
      if (typeof x === 'string') { textos.push(x); return }
      if (!x || typeof x !== 'object' || visto.has(x)) return
      visto.add(x)
      for (const k of Object.getOwnPropertyNames(x)) junta((x as Record<string, unknown>)[k])
    }
    calls.forEach((a) => a.forEach(junta))
    const dito = textos.join('\n')
    expect(dito).not.toContain('segredo123')
    expect(screen.getByRole('alert').textContent).toBe(REDE)
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

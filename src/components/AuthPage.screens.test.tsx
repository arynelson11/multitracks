// @vitest-environment jsdom
// Tela de entrar (entrar, criar conta e recuperar senha): o que ela faz hoje continua lá depois do
// restyle da Parte 3 (faixa B), e o visual novo usa as peças do kit e os tokens ps-*.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'

type AuthResult = { data: { url?: string } | object; error: { message: string } | null }
const { desktop, auth } = vi.hoisted(() => ({
  desktop: { electron: false },
  auth: {
    signInWithPassword: vi.fn<(c: { email: string; password: string }) => Promise<AuthResult>>(async () => ({ data: {}, error: null })),
    signUp: vi.fn<(c: { email: string; password: string; options?: object }) => Promise<AuthResult>>(async () => ({ data: {}, error: null })),
    resetPasswordForEmail: vi.fn<(e: string, o?: object) => Promise<AuthResult>>(async () => ({ data: {}, error: null })),
    signInWithOAuth: vi.fn<(o: { provider: string; options: Record<string, unknown> }) => Promise<AuthResult>>(async () => ({ data: { url: 'https://contas.exemplo/oauth' }, error: null })),
    setSession: vi.fn(async () => ({ data: {}, error: null })),
  },
}))
vi.mock('../lib/desktop', () => ({
  get isElectron() { return desktop.electron },
  onDeepLinkAuth: () => () => {},
}))
vi.mock('../lib/supabase', () => ({ supabase: { auth } }))

import { AuthPage } from './AuthPage'

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  desktop.electron = false
})

const email = () => screen.getByPlaceholderText('seu@email.com') as HTMLInputElement
const senha = () => screen.queryByPlaceholderText('Sua senha') as HTMLInputElement | null
const form = () => email().closest('form')!
const text = () => document.body.textContent ?? ''
async function submit() { await act(async () => { fireEvent.submit(form()) }) }

describe('AuthPage: nada some no restyle', () => {
  it('entrar: marca, textos, Google, campos com os atributos de hoje e os links', () => {
    render(<AuthPage />)
    for (const t of [
      'pronto pro', 'Toda música, todo', 'domingo, na sua mão.',
      'Separe qualquer música em multitracks prontas. Pra sua equipe chegar pronta no próximo culto.',
      'Subir sua primeira música', 'Ensaiar pronto pro domingo', 'Feito por quem toca.',
      'Bem-vindo de volta.', 'ou', 'mín 6', 'Não tem conta?',
    ]) expect(text()).toContain(t)
    expect(screen.getByRole('heading', { level: 2 }).textContent).toBe('Entrar')
    expect(screen.getByRole('button', { name: /Continuar com Google/ })).toBeTruthy()
    expect(email().type).toBe('email')
    expect(email().required).toBe(true)
    expect(senha()!.type).toBe('password')
    expect(senha()!.required).toBe(true)
    expect(senha()!.minLength).toBe(6)
    expect(screen.getByRole('button', { name: /^Entrar/ }).getAttribute('type')).toBe('submit')
    expect(screen.getByRole('button', { name: 'Esqueceu sua senha?' })).toBeTruthy()
    expect(screen.getAllByRole('button', { name: 'Criar conta' })).toHaveLength(1)
  })

  it('entrar chama o login com e-mail e senha; erro aparece; o botão fica desligado enquanto carrega', async () => {
    let finish: (r: AuthResult) => void = () => {}
    auth.signInWithPassword.mockImplementationOnce(() => new Promise((r) => { finish = r }))
    render(<AuthPage />)
    fireEvent.change(email(), { target: { value: 'pessoa@exemplo.com' } })
    fireEvent.change(senha()!, { target: { value: 'segredo1' } })
    await submit()
    expect(auth.signInWithPassword).toHaveBeenCalledWith({ email: 'pessoa@exemplo.com', password: 'segredo1' })
    const enviar = form().querySelector('button[type="submit"]') as HTMLButtonElement
    expect(enviar.disabled).toBe(true)
    await act(async () => { finish({ data: {}, error: { message: 'Invalid login credentials' } }) })
    expect(enviar.disabled).toBe(false)
    expect(text()).toContain('Invalid login credentials')
  })

  it('criar conta: título, texto, cadastro e mensagem; "Já tem conta? Entrar" volta', async () => {
    render(<AuthPage />)
    fireEvent.click(screen.getByRole('button', { name: 'Criar conta' }))
    expect(screen.getByRole('heading', { level: 2 }).textContent).toBe('Criar conta')
    expect(text()).toContain('Vamos te mostrar como deixar seu próximo domingo mais leve.')
    expect(screen.getByRole('button', { name: /Continuar com Google/ })).toBeTruthy()
    fireEvent.change(email(), { target: { value: 'nova@exemplo.com' } })
    fireEvent.change(senha()!, { target: { value: 'senhaforte1' } })
    await submit()
    expect(auth.signUp).toHaveBeenCalledTimes(1)
    expect(text()).toContain('Cadastro feito. Verifica seu email pra confirmar.')
    expect(text()).toContain('Já tem conta?')
    fireEvent.click(screen.getByRole('button', { name: 'Entrar' }))
    expect(screen.getByRole('heading', { level: 2 }).textContent).toBe('Entrar')
  })

  it('recuperar: sem Google e sem senha, envia as instruções e mostra a mensagem do navegador', async () => {
    render(<AuthPage />)
    fireEvent.click(screen.getByRole('button', { name: 'Esqueceu sua senha?' }))
    expect(screen.getByRole('heading', { level: 2 }).textContent).toBe('Recuperar senha')
    expect(text()).toContain('A gente envia instruções pro seu email.')
    expect(screen.queryByRole('button', { name: /Continuar com Google/ })).toBeNull()
    // O divisor "ou" entre o Google e o formulário (o texto exato, não a sílaba na página).
    expect(screen.queryByText('ou', { exact: true })).toBeNull()
    expect(senha()).toBeNull()
    expect(screen.getByRole('button', { name: /Enviar instruções/ })).toBeTruthy()
    fireEvent.change(email(), { target: { value: 'pessoa@exemplo.com' } })
    await submit()
    expect(auth.resetPasswordForEmail).toHaveBeenCalledTimes(1)
    expect(text()).toContain('Instruções de recuperação enviadas pro seu email.')
    fireEvent.click(screen.getByRole('button', { name: 'Entrar' }))
    expect(screen.getByRole('heading', { level: 2 }).textContent).toBe('Entrar')
  })

  it('Google no navegador volta pra mesma origem; no computador abre o navegador do sistema', async () => {
    render(<AuthPage />)
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Continuar com Google/ })) })
    expect(auth.signInWithOAuth).toHaveBeenLastCalledWith({ provider: 'google', options: { redirectTo: window.location.origin } })
    cleanup()
    desktop.electron = true
    const openExternalUrl = vi.fn()
    ;(window as unknown as { playbackDesktop: unknown }).playbackDesktop = { openExternalUrl }
    render(<AuthPage />)
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Continuar com Google/ })) })
    expect(auth.signInWithOAuth).toHaveBeenLastCalledWith({ provider: 'google', options: { redirectTo: 'playbackstudio://auth/callback', skipBrowserRedirect: true } })
    expect(openExternalUrl).toHaveBeenCalledWith('https://contas.exemplo/oauth')
    delete (window as unknown as { playbackDesktop?: unknown }).playbackDesktop
  })

  it('erro do Google aparece na tela', async () => {
    auth.signInWithOAuth.mockResolvedValueOnce({ data: {}, error: { message: 'provedor fora do ar' } })
    render(<AuthPage />)
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Continuar com Google/ })) })
    expect(text()).toContain('provedor fora do ar')
  })
})

/** Classes dos elementos da tela, sem as marcas (Wordmark e Domingo têm a identidade própria). */
function screenClasses(root: HTMLElement): string[] {
  const out: string[] = []
  for (const el of root.querySelectorAll<HTMLElement>('[class]')) {
    if (el.closest('.font-handwriting') || el.closest('span.font-display.inline-flex')) continue
    out.push(...el.className.toString().split(/\s+/).filter(Boolean))
  }
  return out
}
const OLD = /^(?:[a-z-]+:)*(?:bg|text|border|from|to|shadow|ring|placeholder)-(?:tinta|laranja|warm-\d+|bone|error|success|musgo)(?:[-/].*)?$|^font-display$/

describe('AuthPage: visual do palco', () => {
  it('campos do kit achados pelo rótulo, com o anel de foco na caixa', () => {
    render(<AuthPage />)
    expect(screen.getByLabelText('Email')).toBe(email())
    expect(screen.getByLabelText('Senha')).toBe(senha())
    expect(email().parentElement!.className).toContain('focus-within:outline-ps-or')
  })

  it('erro num aviso âmbar com role alert; mensagem com role status', async () => {
    auth.signInWithPassword.mockResolvedValueOnce({ data: {}, error: { message: 'Invalid login credentials' } })
    const { unmount } = render(<AuthPage />)
    fireEvent.change(email(), { target: { value: 'a@b.com' } })
    fireEvent.change(senha()!, { target: { value: 'segredo1' } })
    await submit()
    const alert = screen.getByRole('alert')
    expect(alert.textContent).toBe('Invalid login credentials')
    expect(alert.className).toContain('text-ps-alert')
    unmount()
    render(<AuthPage />)
    fireEvent.click(screen.getByRole('button', { name: 'Criar conta' }))
    fireEvent.change(email(), { target: { value: 'a@b.com' } })
    fireEvent.change(senha()!, { target: { value: 'segredo1' } })
    await submit()
    expect(screen.getByRole('status').textContent).toBe('Cadastro feito. Verifica seu email pra confirmar.')
  })

  it('o divisor "ou" aparece entre o Google e o formulário fora do recuperar senha', () => {
    render(<AuthPage />)
    const ou = screen.getByText('ou', { exact: true })
    const divisor = ou.parentElement!
    expect(divisor.children).toHaveLength(3)
    expect(divisor.firstElementChild!.className).toContain('bg-ps-line')
    expect(divisor.lastElementChild!.className).toContain('bg-ps-line')
  })

  // Revisão macro BC (BC1-M1): a região status fica sempre na página e só o texto entra nela
  // (região que nasce já com o texto muitas vezes não é lida pelo leitor de tela).
  it('a região status existe antes da mensagem e é a mesma que recebe o texto', async () => {
    render(<AuthPage />)
    fireEvent.click(screen.getByRole('button', { name: 'Criar conta' }))
    const antes = screen.getByRole('status')
    expect(antes.textContent).toBe('')
    fireEvent.change(email(), { target: { value: 'a@b.com' } })
    fireEvent.change(senha()!, { target: { value: 'segredo1' } })
    await submit()
    expect(screen.getByRole('status')).toBe(antes)
    expect(antes.textContent).toBe('Cadastro feito. Verifica seu email pra confirmar.')
  })

  it('o botão de enviar é o principal (laranja) e continua com nome enquanto carrega', async () => {
    auth.signInWithPassword.mockImplementationOnce(() => new Promise(() => {}))
    render(<AuthPage />)
    const enviar = () => form().querySelector('button[type="submit"]') as HTMLButtonElement
    expect(enviar().className).toContain('bg-ps-or')
    fireEvent.change(email(), { target: { value: 'a@b.com' } })
    fireEvent.change(senha()!, { target: { value: 'segredo1' } })
    await submit()
    expect(enviar().disabled).toBe(true)
    expect(screen.getByRole('button', { name: 'Entrar' })).toBe(enviar())
  })

  it('só tokens ps-* (nenhuma classe da paleta antiga) nos três modos, e fundo ps-ink', () => {
    const { container } = render(<AuthPage />)
    const modes = [() => {}, () => fireEvent.click(screen.getByRole('button', { name: 'Criar conta' })), () => {
      fireEvent.click(screen.getByRole('button', { name: 'Entrar' }))
      fireEvent.click(screen.getByRole('button', { name: 'Esqueceu sua senha?' }))
    }]
    for (const go of modes) {
      go()
      expect(screenClasses(container).filter((c) => OLD.test(c))).toEqual([])
    }
    expect((container.firstElementChild as HTMLElement).className).toContain('bg-ps-ink')
  })

  it('nenhum travessão na tela', () => {
    const { container } = render(<AuthPage />)
    expect(container.innerHTML).not.toContain(String.fromCharCode(0x2014))
  })
})

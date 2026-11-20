// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import {
  cancelPasswordRecovery, finishPasswordRecovery, isPasswordRecovery, startPasswordRecovery, watchPasswordRecovery,
  type RecoveryAuthClient,
} from './passwordRecovery'
import { usePasswordRecovery } from '../hooks/usePasswordRecovery'
import { NewPasswordPage } from '../components/NewPasswordPage'

// Cliente Supabase simulado: guarda quem escuta o onAuthStateChange e responde o updateUser.
function fakeClient(updateError: { message: string } | null = null) {
  const listeners: ((event: string) => void)[] = []
  const unsubscribe = vi.fn()
  const client = {
    auth: {
      onAuthStateChange: vi.fn((cb: (event: string) => void) => {
        listeners.push(cb)
        return { data: { subscription: { unsubscribe } } }
      }),
      updateUser: vi.fn<(attrs: { password: string }) => Promise<{ data: object; error: { message: string } | null }>>(
        async () => ({ data: {}, error: updateError })),
      signOut: vi.fn(async () => ({ error: null })),
    },
  }
  return { client: client as unknown as RecoveryAuthClient & typeof client, emit: (e: string) => listeners.forEach(l => l(e)), unsubscribe }
}

afterEach(() => {
  cleanup()
  finishPasswordRecovery()
})

describe('detectar a volta do link de recuperar senha', () => {
  it('#type=recovery no endereço, sem o evento do Supabase, NÃO abre a tela; com o evento, abre', async () => {
    window.location.hash = '#access_token=lixo&type=recovery'
    vi.resetModules()
    const fresh = await import('./passwordRecovery')
    expect(fresh.isPasswordRecovery()).toBe(false)
    const { client, emit } = fakeClient()
    const stop = fresh.watchPasswordRecovery(client)
    emit('PASSWORD_RECOVERY')
    expect(fresh.isPasswordRecovery()).toBe(true)
    stop()
    fresh.finishPasswordRecovery()
    window.location.hash = ''
  })

  it('a escuta do evento fica no carregamento do cliente Supabase (não depende da ordem do React)', async () => {
    const { readFileSync } = await import('node:fs')
    const src = readFileSync(`${process.cwd()}/src/lib/supabase.ts`, 'utf8')
    expect(src).toMatch(/if \(supabase\) watchPasswordRecovery\(supabase\)/)
  })

  it('o evento PASSWORD_RECOVERY do Supabase liga a tela; outros eventos não', () => {
    const { client, emit, unsubscribe } = fakeClient()
    const stop = watchPasswordRecovery(client)
    emit('SIGNED_IN')
    expect(isPasswordRecovery()).toBe(false)
    emit('PASSWORD_RECOVERY')
    expect(isPasswordRecovery()).toBe(true)
    stop()
    expect(unsubscribe).toHaveBeenCalled()
  })

  it('o hook acompanha o estado', () => {
    const { client, emit } = fakeClient()
    const stop = watchPasswordRecovery(client)
    function Probe() {
      return <span>{usePasswordRecovery() ? 'recuperando' : 'normal'}</span>
    }
    render(<Probe />)
    expect(screen.getByText('normal')).toBeTruthy()
    act(() => emit('PASSWORD_RECOVERY'))
    expect(screen.getByText('recuperando')).toBeTruthy()
    act(() => finishPasswordRecovery())
    expect(screen.getByText('normal')).toBeTruthy()
    act(() => startPasswordRecovery())
    expect(screen.getByText('recuperando')).toBeTruthy()
    stop()
  })

  it('desistir de trocar a senha sai da conta e desliga a tela', async () => {
    const { client } = fakeClient()
    startPasswordRecovery()
    await cancelPasswordRecovery(client)
    expect(client.auth.signOut).toHaveBeenCalled()
    expect(isPasswordRecovery()).toBe(false)
  })
})

describe('tela Criar nova senha', () => {
  const nova = () => screen.getByLabelText('Nova senha') as HTMLInputElement
  const repetir = () => screen.getByLabelText('Repita a nova senha') as HTMLInputElement
  const salvar = () => fireEvent.click(screen.getByRole('button', { name: 'Salvar nova senha' }))

  it('pede pelo menos 8 caracteres e não chama o Supabase', async () => {
    const { client } = fakeClient()
    render(<NewPasswordPage client={client} onDone={() => {}} onCancel={() => {}} />)
    fireEvent.change(nova(), { target: { value: 'abc12' } })
    fireEvent.change(repetir(), { target: { value: 'abc12' } })
    await act(async () => salvar())
    expect(screen.getByRole('alert').textContent).toBe('A senha precisa ter pelo menos 8 caracteres.')
    expect(client.auth.updateUser).not.toHaveBeenCalled()
  })

  it('as duas senhas precisam ser iguais', async () => {
    const { client } = fakeClient()
    render(<NewPasswordPage client={client} onDone={() => {}} onCancel={() => {}} />)
    fireEvent.change(nova(), { target: { value: 'senhaforte1' } })
    fireEvent.change(repetir(), { target: { value: 'senhaforte2' } })
    await act(async () => salvar())
    expect(screen.getByRole('alert').textContent).toBe('As duas senhas não são iguais.')
    expect(client.auth.updateUser).not.toHaveBeenCalled()
  })

  it('salva com updateUser({ password }) e mostra o sucesso; Continuar fecha a tela', async () => {
    const { client } = fakeClient()
    const onDone = vi.fn()
    render(<NewPasswordPage client={client} onDone={onDone} onCancel={() => {}} />)
    fireEvent.change(nova(), { target: { value: 'senhaforte1' } })
    fireEvent.change(repetir(), { target: { value: 'senhaforte1' } })
    await act(async () => salvar())
    expect(client.auth.updateUser).toHaveBeenCalledWith({ password: 'senhaforte1' })
    expect(screen.getByRole('status').textContent).toBe('Senha nova salva. Você já está conectado.')
    expect(screen.queryByRole('button', { name: 'Cancelar e voltar pra tela de entrar' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Continuar' }))
    expect(onDone).toHaveBeenCalled()
  })

  it('antes de salvar, Cancelar e voltar pra tela de entrar chama o cancelamento', () => {
    const { client } = fakeClient()
    const onCancel = vi.fn()
    render(<NewPasswordPage client={client} onDone={() => {}} onCancel={onCancel} />)
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar e voltar pra tela de entrar' }))
    expect(onCancel).toHaveBeenCalled()
    expect(client.auth.updateUser).not.toHaveBeenCalled()
  })

  it('erro do Supabase aparece em português (link vencido, senha igual à anterior)', async () => {
    const vencido = fakeClient({ message: 'Auth session missing!' })
    render(<NewPasswordPage client={vencido.client} onDone={() => {}} onCancel={() => {}} />)
    fireEvent.change(nova(), { target: { value: 'senhaforte1' } })
    fireEvent.change(repetir(), { target: { value: 'senhaforte1' } })
    await act(async () => salvar())
    expect(screen.getByRole('alert').textContent).toBe('O link de recuperação venceu. Peça um novo em Esqueceu sua senha?, na tela de entrar.')
    cleanup()

    const igual = fakeClient({ message: 'New password should be different from the old password.' })
    render(<NewPasswordPage client={igual.client} onDone={() => {}} onCancel={() => {}} />)
    fireEvent.change(nova(), { target: { value: 'senhaforte1' } })
    fireEvent.change(repetir(), { target: { value: 'senhaforte1' } })
    await act(async () => salvar())
    expect(screen.getByRole('alert').textContent).toBe('A senha nova precisa ser diferente da anterior.')
  })

  it('campos com 16px (o iPhone não dá zoom) e do tipo senha', () => {
    const { client } = fakeClient()
    render(<NewPasswordPage client={client} onDone={() => {}} onCancel={() => {}} />)
    for (const input of [nova(), repetir()]) {
      expect(input.type).toBe('password')
      // 16 px: o text-ps-md do campo do kit (antes, text-[16px]).
      expect(input.className.split(' ')).toContain('text-ps-md')
      expect(input.getAttribute('autocomplete')).toBe('new-password')
    }
  })
})

describe('tela Criar nova senha no visual do palco (Parte 3)', () => {
  const OLD = /^(?:[a-z-]+:)*(?:bg|text|border|placeholder)-(?:tinta|laranja|warm-\d+|bone|red-\d+)(?:[-/].*)?$|^font-display$/
  const own = (root: HTMLElement) => Array.from(root.querySelectorAll<HTMLElement>('[class]'))
    .filter((el) => !el.closest('span.font-display.inline-flex'))
    .flatMap((el) => el.className.toString().split(/\s+/).filter(Boolean))

  it('campos do kit, Salvar laranja, Cancelar discreto, erro em âmbar e só tokens ps-*', async () => {
    const { client } = fakeClient()
    const { container } = render(<NewPasswordPage client={client} onDone={() => {}} onCancel={() => {}} />)
    expect((container.firstElementChild as HTMLElement).className).toContain('bg-ps-ink')
    for (const name of ['Nova senha', 'Repita a nova senha']) expect(screen.getByLabelText(name).parentElement!.className).toContain('focus-within:outline-ps-or')
    expect(screen.getByRole('button', { name: 'Salvar nova senha' }).className).toContain('bg-ps-or')
    expect(screen.getByRole('button', { name: 'Cancelar e voltar pra tela de entrar' }).className).toContain('text-ps-mut')
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Salvar nova senha' })))
    expect(screen.getByRole('alert').className).toContain('text-ps-alert')
    expect(own(container).filter((c) => OLD.test(c))).toEqual([])
  })

  it('depois de salvar: Continuar laranja e a confirmação num aviso neutro', async () => {
    const { client } = fakeClient()
    const { container } = render(<NewPasswordPage client={client} onDone={() => {}} onCancel={() => {}} />)
    fireEvent.change(screen.getByLabelText('Nova senha'), { target: { value: 'senhaforte1' } })
    fireEvent.change(screen.getByLabelText('Repita a nova senha'), { target: { value: 'senhaforte1' } })
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Salvar nova senha' })))
    expect(screen.getByRole('status').className).toContain('bg-ps-s2')
    expect(screen.getByRole('button', { name: 'Continuar' }).className).toContain('bg-ps-or')
    expect(own(container).filter((c) => OLD.test(c))).toEqual([])
    expect(container.innerHTML).not.toContain(String.fromCharCode(0x2014))
  })
})

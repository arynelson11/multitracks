// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import {
  finishPasswordRecovery, hashIsRecovery, isPasswordRecovery, startPasswordRecovery, watchPasswordRecovery,
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
    },
  }
  return { client: client as unknown as RecoveryAuthClient & typeof client, emit: (e: string) => listeners.forEach(l => l(e)), unsubscribe }
}

afterEach(() => {
  cleanup()
  finishPasswordRecovery()
})

describe('detectar a volta do link de recuperar senha', () => {
  it('reconhece o type=recovery do endereço (fluxo do Supabase)', () => {
    expect(hashIsRecovery('#access_token=a&expires_in=3600&refresh_token=b&token_type=bearer&type=recovery')).toBe(true)
    expect(hashIsRecovery('#type=recovery&access_token=a')).toBe(true)
    expect(hashIsRecovery('#access_token=a&type=signup')).toBe(false)
    expect(hashIsRecovery('#error=access_denied&error_code=otp_expired')).toBe(false)
    expect(hashIsRecovery('')).toBe(false)
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

  it('o hook acompanha o estado e sem cliente (Supabase sem configurar) não quebra', () => {
    const { client, emit } = fakeClient()
    function Probe({ c }: { c: RecoveryAuthClient | null }) {
      return <span>{usePasswordRecovery(c) ? 'recuperando' : 'normal'}</span>
    }
    const { rerender } = render(<Probe c={client} />)
    expect(screen.getByText('normal')).toBeTruthy()
    act(() => emit('PASSWORD_RECOVERY'))
    expect(screen.getByText('recuperando')).toBeTruthy()
    act(() => finishPasswordRecovery())
    expect(screen.getByText('normal')).toBeTruthy()
    rerender(<Probe c={null} />)
    act(() => startPasswordRecovery())
    expect(screen.getByText('recuperando')).toBeTruthy()
  })
})

describe('tela Criar nova senha', () => {
  const nova = () => screen.getByLabelText('Nova senha') as HTMLInputElement
  const repetir = () => screen.getByLabelText('Repita a nova senha') as HTMLInputElement
  const salvar = () => fireEvent.click(screen.getByRole('button', { name: 'Salvar nova senha' }))

  it('pede pelo menos 8 caracteres e não chama o Supabase', async () => {
    const { client } = fakeClient()
    render(<NewPasswordPage client={client} onDone={() => {}} />)
    fireEvent.change(nova(), { target: { value: 'abc12' } })
    fireEvent.change(repetir(), { target: { value: 'abc12' } })
    await act(async () => salvar())
    expect(screen.getByRole('alert').textContent).toBe('A senha precisa ter pelo menos 8 caracteres.')
    expect(client.auth.updateUser).not.toHaveBeenCalled()
  })

  it('as duas senhas precisam ser iguais', async () => {
    const { client } = fakeClient()
    render(<NewPasswordPage client={client} onDone={() => {}} />)
    fireEvent.change(nova(), { target: { value: 'senhaforte1' } })
    fireEvent.change(repetir(), { target: { value: 'senhaforte2' } })
    await act(async () => salvar())
    expect(screen.getByRole('alert').textContent).toBe('As duas senhas não são iguais.')
    expect(client.auth.updateUser).not.toHaveBeenCalled()
  })

  it('salva com updateUser({ password }) e mostra o sucesso; Continuar fecha a tela', async () => {
    const { client } = fakeClient()
    const onDone = vi.fn()
    render(<NewPasswordPage client={client} onDone={onDone} />)
    fireEvent.change(nova(), { target: { value: 'senhaforte1' } })
    fireEvent.change(repetir(), { target: { value: 'senhaforte1' } })
    await act(async () => salvar())
    expect(client.auth.updateUser).toHaveBeenCalledWith({ password: 'senhaforte1' })
    expect(screen.getByRole('status').textContent).toBe('Senha nova salva. Você já está conectado.')
    fireEvent.click(screen.getByRole('button', { name: 'Continuar' }))
    expect(onDone).toHaveBeenCalled()
  })

  it('erro do Supabase aparece em português (link vencido, senha igual à anterior)', async () => {
    const vencido = fakeClient({ message: 'Auth session missing!' })
    render(<NewPasswordPage client={vencido.client} onDone={() => {}} />)
    fireEvent.change(nova(), { target: { value: 'senhaforte1' } })
    fireEvent.change(repetir(), { target: { value: 'senhaforte1' } })
    await act(async () => salvar())
    expect(screen.getByRole('alert').textContent).toBe('O link de recuperação venceu. Peça um novo em Esqueceu sua senha?, na tela de entrar.')
    cleanup()

    const igual = fakeClient({ message: 'New password should be different from the old password.' })
    render(<NewPasswordPage client={igual.client} onDone={() => {}} />)
    fireEvent.change(nova(), { target: { value: 'senhaforte1' } })
    fireEvent.change(repetir(), { target: { value: 'senhaforte1' } })
    await act(async () => salvar())
    expect(screen.getByRole('alert').textContent).toBe('A senha nova precisa ser diferente da anterior.')
  })

  it('campos com 16px (o iPhone não dá zoom) e do tipo senha', () => {
    const { client } = fakeClient()
    render(<NewPasswordPage client={client} onDone={() => {}} />)
    for (const input of [nova(), repetir()]) {
      expect(input.type).toBe('password')
      expect(input.className).toContain('text-[16px]')
      expect(input.getAttribute('autocomplete')).toBe('new-password')
    }
  })
})

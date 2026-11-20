// @vitest-environment jsdom
// Aba Perfil das Configurações: o que ela faz hoje continua lá depois do restyle da Parte 3 (faixa B).
// O "Excluir minha conta" segue com o prompt de hoje (decisão do dono, FATOS).
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { User } from '@supabase/supabase-js'

const { r2, sub } = vi.hoisted(() => ({
  r2: { uploadToR2: vi.fn<(bucket: string, path: string, file: File) => Promise<{ url: string | null; error: string | null }>>(async () => ({ url: 'https://cdn.exemplo/avatar.png', error: null })) },
  sub: {
    fetchCancelPreview: vi.fn(async () => ({ refund: false })),
    deleteAccountNotice: vi.fn(() => 'Sua assinatura é cancelada na hora.'),
  },
}))
vi.mock('../lib/r2', () => r2)
vi.mock('../lib/subscription', () => sub)

import { ProfileTab } from './ProfileTab'

const USER = { id: 'u1', email: 'pessoa@exemplo.com', created_at: '2026-07-10T12:00:00Z', user_metadata: { display_name: 'Ana' } } as unknown as User

function setup(patch: Partial<Parameters<typeof ProfileTab>[0]> = {}) {
  const p = {
    user: USER,
    userPlan: 'free',
    updateProfile: vi.fn(async () => ({})),
    updatePassword: vi.fn(async () => {}),
    signOutEverywhere: vi.fn(async () => {}),
    deleteAccount: vi.fn(async () => {}),
    onUpgrade: vi.fn(),
    onClose: vi.fn(),
    ...patch,
  }
  const utils = render(<ProfileTab {...p} />)
  return { ...utils, p }
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.clearAllMocks()
})

const text = () => document.body.textContent ?? ''
const nameInput = () => screen.getByPlaceholderText('Como você quer ser chamado') as HTMLInputElement
const pw1 = () => screen.getByPlaceholderText('Nova senha') as HTMLInputElement
const pw2 = () => screen.getByPlaceholderText('Confirmar nova senha') as HTMLInputElement
const btn = (name: RegExp | string) => screen.getByRole('button', { name }) as HTMLButtonElement

describe('ProfileTab: nada some no restyle', () => {
  it('foto (inicial sem foto), nome, e-mail, plano e membro desde', () => {
    const { container } = setup()
    expect(text()).toContain('Ana')
    expect(text()).toContain('pessoa@exemplo.com')
    expect(text()).toContain('Plano Livre')
    expect(text()).toContain('Membro desde julho de 2026')
    expect(container.querySelector('[title="Trocar foto"]')!.textContent).toContain('A')
    cleanup()
    const comFoto = { ...USER, user_metadata: { avatar_url: 'https://cdn.exemplo/eu.png' } } as unknown as User
    const r = setup({ user: comFoto })
    expect(r.container.querySelector('img')!.getAttribute('src')).toBe('https://cdn.exemplo/eu.png')
    expect(text()).toContain('pessoa')
  })

  it('conta sem data de criação (ou com data inválida): "Sem data de cadastro", nunca travessão nem "Invalid Date"', () => {
    for (const created_at of [undefined, '', 'data-quebrada']) {
      const semData = { ...USER, created_at } as unknown as User
      const { container } = setup({ user: semData })
      expect(container.textContent).toContain('Sem data de cadastro')
      expect(container.textContent).not.toContain('Membro desde')
      expect(container.textContent).not.toContain('Invalid Date')
      expect(container.innerHTML).not.toContain(String.fromCharCode(0x2014))
      cleanup()
    }
  })

  it('trocar foto: abre o seletor, envia pro R2, grava no perfil e mostra a foto nova', async () => {
    const click = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => {})
    const { container, p } = setup()
    fireEvent.click(container.querySelector('[title="Trocar foto"]')!)
    expect(click).toHaveBeenCalled()
    const file = new File(['x'], 'eu.jpg', { type: 'image/jpeg' })
    const input = container.querySelector('input[type="file"]') as HTMLInputElement
    expect(input.accept).toBe('image/*')
    await act(async () => { fireEvent.change(input, { target: { files: [file] } }) })
    expect(r2.uploadToR2).toHaveBeenCalledWith('avatars', expect.stringMatching(/^u1_\d+\.jpg$/), file)
    expect(p.updateProfile).toHaveBeenCalledWith({ avatarUrl: 'https://cdn.exemplo/avatar.png' })
    expect(container.querySelector('img')!.getAttribute('src')).toBe('https://cdn.exemplo/avatar.png')
  })

  it('foto que falha avisa com o alert de hoje', async () => {
    r2.uploadToR2.mockResolvedValueOnce({ url: null, error: 'falhou' })
    const alert = vi.spyOn(window, 'alert').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const { container } = setup()
    await act(async () => { fireEvent.change(container.querySelector('input[type="file"]')!, { target: { files: [new File(['x'], 'a.png')] } }) })
    expect(alert).toHaveBeenCalledWith('Não foi possível enviar a foto. Tente novamente.')
  })

  it('nome de exibição: salva sem espaços nas pontas, mensagem de salvo e de erro, digitar limpa a mensagem', async () => {
    const { p } = setup()
    fireEvent.change(nameInput(), { target: { value: '  Ana Paula  ' } })
    await act(async () => { fireEvent.click(btn(/Salvar/)) })
    expect(p.updateProfile).toHaveBeenCalledWith({ displayName: 'Ana Paula' })
    expect(text()).toContain('Nome salvo!')
    fireEvent.change(nameInput(), { target: { value: 'Ana' } })
    expect(text()).not.toContain('Nome salvo!')
    vi.mocked(p.updateProfile).mockRejectedValueOnce(new Error('x'))
    await act(async () => { fireEvent.click(btn(/Salvar/)) })
    expect(text()).toContain('Erro ao salvar o nome.')
  })

  // Revisão macro BC (BC1-M1): as regiões status do nome e da senha ficam sempre na página.
  it('as mensagens do nome e da senha entram em regiões status que já estavam na página', async () => {
    setup()
    const [nome, senha] = screen.getAllByRole('status')
    expect(nome.textContent).toBe('')
    expect(senha.textContent).toBe('')
    await act(async () => { fireEvent.click(btn(/Salvar/)) })
    expect(screen.getAllByRole('status')[0]).toBe(nome)
    expect(nome.textContent).toBe('Nome salvo!')
    fireEvent.change(pw1(), { target: { value: 'abc' } })
    fireEvent.change(pw2(), { target: { value: 'abc' } })
    await act(async () => { fireEvent.click(btn(/Atualizar/)) })
    expect(screen.getAllByRole('status')[1]).toBe(senha)
    expect(senha.textContent).toBe('A senha precisa de ao menos 6 caracteres.')
  })

  it('salvando o nome, o botão fica desligado', async () => {
    let done: () => void = () => {}
    const { p } = setup({ updateProfile: vi.fn(() => new Promise<unknown>((r) => { done = () => r({}) })) })
    await act(async () => { fireEvent.click(btn(/Salvar/)) })
    expect(btn(/Salvar/).disabled).toBe(true)
    await act(async () => { done() })
    expect(btn(/Salvar/).disabled).toBe(false)
    expect(p.updateProfile).toHaveBeenCalledTimes(1)
  })

  it('senha: desligado sem senha, mínimo 6, as duas iguais, atualiza e limpa, erro', async () => {
    const { p } = setup()
    expect(btn(/Atualizar/).disabled).toBe(true)
    fireEvent.change(pw1(), { target: { value: 'abc' } })
    fireEvent.change(pw2(), { target: { value: 'abc' } })
    await act(async () => { fireEvent.click(btn(/Atualizar/)) })
    expect(text()).toContain('A senha precisa de ao menos 6 caracteres.')
    fireEvent.change(pw1(), { target: { value: 'abcdef' } })
    fireEvent.change(pw2(), { target: { value: 'abcdeg' } })
    await act(async () => { fireEvent.click(btn(/Atualizar/)) })
    expect(text()).toContain('As senhas não conferem.')
    expect(p.updatePassword).not.toHaveBeenCalled()
    fireEvent.change(pw2(), { target: { value: 'abcdef' } })
    await act(async () => { fireEvent.click(btn(/Atualizar/)) })
    expect(p.updatePassword).toHaveBeenCalledWith('abcdef')
    expect(pw1().value).toBe('')
    expect(pw2().value).toBe('')
    expect(text()).toContain('Senha atualizada!')
    expect(pw1().type).toBe('password')
    expect(pw2().type).toBe('password')
    vi.mocked(p.updatePassword).mockRejectedValueOnce(new Error('x'))
    fireEvent.change(pw1(), { target: { value: 'abcdef' } })
    fireEvent.change(pw2(), { target: { value: 'abcdef' } })
    await act(async () => { fireEvent.click(btn(/Atualizar/)) })
    expect(text()).toContain('Erro ao atualizar a senha.')
  })

  it('Fazer upgrade só no Livre', () => {
    const { p } = setup()
    fireEvent.click(btn('Fazer upgrade'))
    expect(p.onUpgrade).toHaveBeenCalled()
    cleanup()
    setup({ userPlan: 'pro_mensal' })
    expect(screen.queryByRole('button', { name: 'Fazer upgrade' })).toBeNull()
    expect(text()).toContain('Plano Studio Mensal')
  })

  it('Sair de todos os dispositivos pergunta (confirm de hoje), sai e fecha; recusado, nada', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true)
    const { p } = setup()
    await act(async () => { fireEvent.click(btn(/Sair de todos os dispositivos/)) })
    expect(p.signOutEverywhere).not.toHaveBeenCalled()
    await act(async () => { fireEvent.click(btn(/Sair de todos os dispositivos/)) })
    expect(confirm).toHaveBeenLastCalledWith('Sair de todos os dispositivos? Você precisará entrar de novo em todos.')
    expect(p.signOutEverywhere).toHaveBeenCalled()
    expect(p.onClose).toHaveBeenCalled()
  })

  it('Excluir minha conta segue com o prompt EXCLUIR de hoje; assinante vê o aviso da assinatura', async () => {
    const prompt = vi.spyOn(window, 'prompt').mockReturnValueOnce('excluir').mockReturnValueOnce('EXCLUIR')
    const { p } = setup()
    await act(async () => { fireEvent.click(btn(/Excluir minha conta/)) })
    expect(p.deleteAccount).not.toHaveBeenCalled()
    expect(prompt.mock.calls[0][0]).toBe('Isto apaga sua conta permanentemente e não pode ser desfeito.\n\nDigite EXCLUIR para confirmar:')
    await act(async () => { fireEvent.click(btn(/Excluir minha conta/)) })
    expect(p.deleteAccount).toHaveBeenCalled()
    expect(p.onClose).toHaveBeenCalled()
    cleanup()
    prompt.mockReturnValueOnce(null)
    setup({ userPlan: 'pro_mensal' })
    await act(async () => { fireEvent.click(btn(/Excluir minha conta/)) })
    expect(sub.fetchCancelPreview).toHaveBeenCalled()
    expect(prompt.mock.calls[2][0]).toContain('Sua assinatura é cancelada na hora.')
  })

  it('Excluir que falha avisa com a mensagem e libera o botão', async () => {
    vi.spyOn(window, 'prompt').mockReturnValue('EXCLUIR')
    const alert = vi.spyOn(window, 'alert').mockImplementation(() => {})
    const { p } = setup({ deleteAccount: vi.fn(async () => { throw new Error('Asaas fora do ar') }) })
    await act(async () => { fireEvent.click(btn(/Excluir minha conta/)) })
    expect(alert).toHaveBeenCalledWith('Asaas fora do ar')
    expect(btn(/Excluir minha conta/).disabled).toBe(false)
    expect(p.onClose).not.toHaveBeenCalled()
  })
})

const OLD = /^(?:[a-z-]+:)*(?:bg|text|border|from|to|shadow|ring|placeholder)-(?:primary|secondary|laranja|tinta|warm-\d+|zinc-\d+|text-muted|white|black(?!\/)|border|red-\d+)(?:[-/].*)?$|^(?:daw-panel|daw-input|font-mono)$/
const own = (root: Element) => Array.from(root.querySelectorAll<HTMLElement>('[class]')).flatMap((el) => el.className.toString().split(/\s+/).filter(Boolean))

describe('ProfileTab: visual do palco', () => {
  it('campos do kit achados pelo rótulo', () => {
    setup()
    expect(screen.getByLabelText('Nome de exibição')).toBe(nameInput())
    expect(screen.getByLabelText('Nova senha')).toBe(pw1())
    expect(screen.getByLabelText('Confirmar nova senha')).toBe(pw2())
    for (const el of [nameInput(), pw1(), pw2()]) expect(el.parentElement!.className).toContain('focus-within:outline-ps-or')
  })

  it('botões do kit: Salvar e Fazer upgrade laranja, Excluir no âmbar de alerta, todos com 44 px', () => {
    const { container } = setup()
    expect(btn(/Salvar/).className).toContain('bg-ps-or')
    expect(btn('Fazer upgrade').className).toContain('bg-ps-or')
    expect(btn(/Excluir minha conta/).className).toContain('text-ps-alert')
    for (const b of container.querySelectorAll('button')) expect(b.className).toContain('min-h-ps-touch')
    expect(screen.getByRole('button', { name: 'Trocar foto' })).toBeTruthy()
  })

  it('só tokens ps-* (com e sem foto, com mensagens)', async () => {
    const { container } = setup()
    await act(async () => { fireEvent.click(btn(/Salvar/)) })
    expect(own(container).filter((c) => OLD.test(c))).toEqual([])
    expect(container.innerHTML).not.toContain(String.fromCharCode(0x2014))
  })
})

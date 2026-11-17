// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { MySubscription } from '../lib/subscription'

const fetchSubs = vi.fn()
const previewMock = vi.fn()
const openExternal = vi.fn()
vi.mock('../lib/subscription', async (orig) => ({
  ...(await orig<typeof import('../lib/subscription')>()),
  fetchMySubscriptions: () => fetchSubs(),
  fetchCancelPreview: () => previewMock(),
}))
vi.mock('../lib/desktop', async (orig) => ({
  ...(await orig<typeof import('../lib/desktop')>()),
  openExternalUrl: (url: string) => openExternal(url),
}))

import { BlockedScreen } from './BlockedScreen'

const TRAVESSAO = String.fromCharCode(0x2014)

const active: MySubscription = {
  id: 'chk_1', kind: 'asaas', plan_key: 'pro_mensal', cycle: 'MONTHLY', status: 'active',
  started_at: '2026-10-16T15:00:00Z', next_due_date: '2026-12-16', paid_until: '2026-12-17T03:00:00Z',
  access_until: null, cancel_source: null, canceled_at: null, created_at: '2026-10-16T15:00:00Z',
}
const grace: MySubscription = {
  ...active, status: 'canceled', cancel_source: 'user', canceled_at: '2026-11-10T15:00:00Z',
  access_until: '2026-12-17T03:00:00Z',
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-11-16T15:00:00Z'))
  fetchSubs.mockReset(); fetchSubs.mockResolvedValue([])
  previewMock.mockReset(); previewMock.mockResolvedValue(null)
  openExternal.mockReset()
})
afterEach(() => { cleanup(); vi.useRealTimers() })

const setup = (plan = 'pro_mensal') => {
  const onSignOut = vi.fn(async () => {})
  const onDeleteAccount = vi.fn(async () => {})
  const view = render(<BlockedScreen plan={plan} onSignOut={onSignOut} onDeleteAccount={onDeleteAccount} />)
  return { onSignOut, onDeleteAccount, ...view }
}

const confirmButton = () => screen.getByRole('button', { name: 'Excluir de vez' }) as HTMLButtonElement
const typeConfirmation = (text: string) =>
  fireEvent.change(screen.getByLabelText('Digite EXCLUIR para confirmar'), { target: { value: text } })

describe('BlockedScreen', () => {
  it('tela de bloqueado mostra o texto, a assinatura, Excluir minha conta e Sair', async () => {
    fetchSubs.mockResolvedValue([active])
    const { container } = setup()
    expect(screen.getByRole('heading', { name: 'Sua conta está bloqueada' })).toBeTruthy()
    expect(screen.getByText('Fale com a gente pelo WhatsApp para entender e resolver.')).toBeTruthy()
    // A assinatura da pessoa, com o botão de cancelar (o bloqueio não mexe na cobrança).
    expect(await screen.findByRole('button', { name: 'Cancelar assinatura' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Excluir minha conta' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Sair' })).toBeTruthy()
    expect(container.textContent).not.toContain(TRAVESSAO)
  })

  it('Sair chama onSignOut', () => {
    const { onSignOut, onDeleteAccount } = setup()
    fireEvent.click(screen.getByRole('button', { name: 'Sair' }))
    expect(onSignOut).toHaveBeenCalledTimes(1)
    expect(onDeleteAccount).not.toHaveBeenCalled()
  })

  it('Falar no WhatsApp abre o contato pelo openExternalUrl (funciona no app de computador)', () => {
    setup()
    fireEvent.click(screen.getByRole('button', { name: 'Falar no WhatsApp' }))
    expect(openExternal).toHaveBeenCalledTimes(1)
    expect(openExternal.mock.calls[0][0]).toMatch(/^https:\/\/wa\.me\/5522997249896\?text=/)
  })

  it('Excluir com EXCLUIR digitado chama onDeleteAccount, sem ele não chama', async () => {
    previewMock.mockResolvedValue({ outcome: 'until_period_end', plan: 'pro_mensal', accessUntil: '2026-12-17T03:00:00Z', amount: 49.9 })
    const { onDeleteAccount, container } = setup('pro_mensal')
    fireEvent.click(screen.getByRole('button', { name: 'Excluir minha conta' }))

    const dialog = screen.getByRole('dialog', { name: 'Excluir a conta?' })
    expect(dialog.textContent).toContain('Isto apaga sua conta permanentemente e não pode ser desfeito.')
    // O mesmo aviso do Perfil pra quem tem plano pago, com a prévia do servidor.
    await vi.waitFor(() => expect(dialog.textContent).toContain('Sua assinatura é cancelada na hora e nada mais é cobrado.'))
    expect(dialog.textContent).toContain('é perdido, sem devolução')
    expect(previewMock).toHaveBeenCalledTimes(1)

    expect(confirmButton().disabled).toBe(true)
    fireEvent.click(confirmButton())
    typeConfirmation('excluir')
    expect(confirmButton().disabled).toBe(true)
    fireEvent.click(confirmButton())
    expect(onDeleteAccount).not.toHaveBeenCalled()

    typeConfirmation('EXCLUIR')
    expect(confirmButton().disabled).toBe(false)
    fireEvent.click(confirmButton())
    expect(onDeleteAccount).toHaveBeenCalledTimes(1)
    expect(container.textContent).not.toContain(TRAVESSAO)
  })

  it('plano pago: espera o aviso da assinatura antes de deixar confirmar', async () => {
    let answer: (v: null) => void = () => {}
    previewMock.mockReturnValue(new Promise((r) => { answer = r }))
    const { onDeleteAccount } = setup('pro_mensal')
    fireEvent.click(screen.getByRole('button', { name: 'Excluir minha conta' }))
    expect(screen.getByRole('dialog').textContent).toContain('Conferindo o que acontece com a sua assinatura...')
    typeConfirmation('EXCLUIR')
    expect(confirmButton().disabled).toBe(true)

    // Sem prévia (servidor fora), vale o aviso geral do Perfil.
    answer(null)
    await vi.waitFor(() => expect(confirmButton().disabled).toBe(false))
    expect(screen.getByRole('dialog').textContent).toContain('Fora do prazo de 7 dias da primeira compra')
    fireEvent.click(confirmButton())
    expect(onDeleteAccount).toHaveBeenCalledTimes(1)
  })

  it('plano Livre: confirma sem consultar a assinatura', () => {
    const { onDeleteAccount } = setup('free')
    fireEvent.click(screen.getByRole('button', { name: 'Excluir minha conta' }))
    expect(previewMock).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog').textContent).not.toContain('Sua assinatura')
    typeConfirmation('EXCLUIR')
    fireEvent.click(confirmButton())
    expect(onDeleteAccount).toHaveBeenCalledTimes(1)
  })

  it('erro ao excluir mostra a frase e deixa tentar de novo', async () => {
    const { onDeleteAccount } = setup('free')
    onDeleteAccount.mockRejectedValueOnce(new Error('Não foi possível excluir agora.'))
    fireEvent.click(screen.getByRole('button', { name: 'Excluir minha conta' }))
    typeConfirmation('EXCLUIR')
    fireEvent.click(confirmButton())
    expect((await screen.findByRole('alert')).textContent).toBe('Não foi possível excluir agora.')
    expect(confirmButton().disabled).toBe(false)
    fireEvent.click(confirmButton())
    expect(onDeleteAccount).toHaveBeenCalledTimes(2)
  })

  it('Voltar fecha a confirmação sem excluir', () => {
    const { onDeleteAccount } = setup('free')
    fireEvent.click(screen.getByRole('button', { name: 'Excluir minha conta' }))
    typeConfirmation('EXCLUIR')
    fireEvent.click(screen.getByRole('button', { name: 'Voltar' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(onDeleteAccount).not.toHaveBeenCalled()
    // Abrir de novo começa do zero (o texto digitado não fica guardado).
    fireEvent.click(screen.getByRole('button', { name: 'Excluir minha conta' }))
    expect(confirmButton().disabled).toBe(true)
  })

  it('Assinar de novo na tela de bloqueado não abre nada', async () => {
    // O checkout recusa conta bloqueada (403): o botão do painel não leva a lugar nenhum.
    fetchSubs.mockResolvedValue([grace])
    const winOpen = vi.spyOn(window, 'open').mockImplementation(() => null)
    const { container } = setup()
    const again = await screen.findByRole('button', { name: 'Assinar de novo' })
    const before = container.innerHTML
    fireEvent.click(again)
    expect(container.innerHTML).toBe(before)
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(winOpen).not.toHaveBeenCalled()
    expect(openExternal).not.toHaveBeenCalled()
  })
})

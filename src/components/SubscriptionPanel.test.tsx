// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { MySubscription } from '../lib/subscription'

const fetchSub = vi.fn()
const cancelSub = vi.fn()
const previewMock = vi.fn()
vi.mock('../lib/subscription', async (orig) => ({
  ...(await orig<typeof import('../lib/subscription')>()),
  fetchMySubscription: () => fetchSub(),
  cancelMySubscription: () => cancelSub(),
  fetchCancelPreview: () => previewMock(),
}))

import { SubscriptionPanel } from './SubscriptionPanel'

const active: MySubscription = {
  id: 'chk_1', kind: 'asaas', plan_key: 'essencial_mensal', cycle: 'MONTHLY', status: 'active',
  started_at: '2026-10-16T15:00:00Z', next_due_date: '2026-12-16', paid_until: '2026-12-17T03:00:00Z',
  access_until: null, cancel_source: null, canceled_at: null, created_at: '2026-10-16T15:00:00Z',
}

beforeEach(() => { fetchSub.mockReset(); cancelSub.mockReset(); previewMock.mockReset(); previewMock.mockResolvedValue(null) })
afterEach(cleanup)

const setup = (props: Partial<Parameters<typeof SubscriptionPanel>[0]> = {}) => {
  const onChanged = vi.fn()
  const onOpenPricing = vi.fn()
  render(<SubscriptionPanel plan="essencial_mensal" planExpiresAt={null} onChanged={onChanged} onOpenPricing={onOpenPricing} {...props} />)
  return { onChanged, onOpenPricing }
}

describe('SubscriptionPanel', () => {
  it('mostra a próxima renovação e o botão Cancelar assinatura', async () => {
    fetchSub.mockResolvedValue(active)
    setup()
    expect(await screen.findByText(/Próxima renovação: 16\/12\/2026/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Cancelar assinatura' })).toBeTruthy()
  })

  it('sem prévia: pede confirmação com as regras, sem travessão', async () => {
    fetchSub.mockResolvedValue(active)
    setup()
    fireEvent.click(await screen.findByRole('button', { name: 'Cancelar assinatura' }))
    const dialog = screen.getByRole('dialog', { name: 'Cancelar a assinatura?' })
    await vi.waitFor(() => expect(dialog.textContent).toContain('até o fim do período que já pagou (16/12/2026)'))
    const text = dialog.textContent ?? ''
    expect(text).toContain('nada mais é cobrado')
    expect(text).toContain('primeira assinatura')
    expect(text).toContain('não são apagados')
    expect(text).not.toContain('—')
    expect(cancelSub).not.toHaveBeenCalled()
  })

  it('com prévia: mostra só o desfecho certo (ex.: pedido de estorno quando não é a primeira)', async () => {
    fetchSub.mockResolvedValue(active)
    previewMock.mockResolvedValue({ outcome: 'refund_request', plan: 'essencial_mensal', accessUntil: '2026-12-17T03:00:00Z', amount: 49.9 })
    setup()
    fireEvent.click(await screen.findByRole('button', { name: 'Cancelar assinatura' }))
    const dialog = screen.getByRole('dialog', { name: 'Cancelar a assinatura?' })
    await vi.waitFor(() => expect(dialog.textContent).toContain('não é automático'))
    expect(dialog.textContent).not.toContain('devolvemos o valor integral')
  })

  it('cortesia: mostra até quando vale e não tem botão de cancelar', async () => {
    fetchSub.mockResolvedValue({ ...active, kind: 'courtesy', cycle: null, access_until: '2027-01-31T03:00:00Z', next_due_date: null })
    setup({ planExpiresAt: '2027-01-31T03:00:00Z' })
    expect(await screen.findByText(/Plano de cortesia, sem cobrança\. Vale até 30\/01\/2027\./)).toBeTruthy()
    expect(screen.queryByText(/Assinatura cancelada/)).toBeNull()
    expect(screen.queryByRole('button', { name: 'Cancelar assinatura' })).toBeNull()
  })

  it('estorno recusado: avisa que a equipe faz o estorno', async () => {
    fetchSub.mockResolvedValue(active)
    cancelSub.mockResolvedValue({ ok: true, data: { result: 'canceled', accessUntil: null, refunded: false, refundFailed: true, plan: 'essencial_mensal' } })
    setup()
    fireEvent.click(await screen.findByRole('button', { name: 'Cancelar assinatura' }))
    fireEvent.click(screen.getByRole('button', { name: 'Sim, cancelar' }))
    expect(await screen.findByText(/a nossa equipe vai fazer e te avisa/)).toBeTruthy()
  })

  it('"Manter assinatura" fecha sem cancelar', async () => {
    fetchSub.mockResolvedValue(active)
    setup()
    fireEvent.click(await screen.findByRole('button', { name: 'Cancelar assinatura' }))
    fireEvent.click(screen.getByRole('button', { name: 'Manter assinatura' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(cancelSub).not.toHaveBeenCalled()
  })

  it('confirma, cancela e mostra até quando continua com o plano', async () => {
    fetchSub.mockResolvedValue(active)
    cancelSub.mockResolvedValue({ ok: true, data: { result: 'canceled', accessUntil: '2026-12-17T03:00:00Z', refunded: false, plan: 'essencial_mensal' } })
    const { onChanged } = setup()
    fireEvent.click(await screen.findByRole('button', { name: 'Cancelar assinatura' }))
    fireEvent.click(screen.getByRole('button', { name: 'Sim, cancelar' }))
    expect(await screen.findByText(/Assinatura cancelada\. Você continua com o Pro Mensal até 16\/12\/2026\. Nada mais será cobrado\./)).toBeTruthy()
    expect(onChanged).toHaveBeenCalled()
  })

  it('arrependimento: avisa do estorno e que já está no Livre', async () => {
    fetchSub.mockResolvedValue(active)
    cancelSub.mockResolvedValue({ ok: true, data: { result: 'canceled', accessUntil: '2026-11-16T15:00:00Z', refunded: true, plan: 'essencial_mensal' } })
    setup()
    fireEvent.click(await screen.findByRole('button', { name: 'Cancelar assinatura' }))
    fireEvent.click(screen.getByRole('button', { name: 'Sim, cancelar' }))
    expect(await screen.findByText(/valor devolvido/)).toBeTruthy()
    expect(screen.getByText(/já está no Livre/)).toBeTruthy()
  })

  it('erro do servidor aparece claro e dá pra tentar de novo', async () => {
    fetchSub.mockResolvedValue(active)
    cancelSub.mockResolvedValue({ ok: false, error: 'Não conseguimos falar com o sistema de pagamento agora. Sua assinatura não foi cancelada e nada mudou.' })
    setup()
    fireEvent.click(await screen.findByRole('button', { name: 'Cancelar assinatura' }))
    fireEvent.click(screen.getByRole('button', { name: 'Sim, cancelar' }))
    expect(await screen.findByRole('alert')).toBeTruthy()
    expect(screen.getByRole('alert').textContent).toContain('nada mudou')
    expect(screen.getByRole('button', { name: 'Sim, cancelar' })).toBeTruthy()
  })

  it('já cancelada: mostra até quando vale e o botão de assinar de novo', async () => {
    fetchSub.mockResolvedValue({ ...active, status: 'canceled', access_until: '2026-12-17T03:00:00Z' })
    const { onOpenPricing } = setup({ planExpiresAt: '2026-12-17T03:00:00Z' })
    expect(await screen.findByText(/Você continua com o Pro Mensal até 16\/12\/2026/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Cancelar assinatura' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Assinar de novo' }))
    expect(onOpenPricing).toHaveBeenCalled()
  })

  it('no Livre não mostra nada', () => {
    fetchSub.mockResolvedValue(null)
    previewMock.mockResolvedValue(null)
    const { container } = render(<SubscriptionPanel plan="free" planExpiresAt={null} onChanged={() => {}} onOpenPricing={() => {}} />)
    expect(container.textContent).toBe('')
  })
})

describe('SubscriptionPanel: rodada 2', () => {
  it('N6: com cortesia e assinatura paga ativas, mostra a paga com o botão de cancelar', async () => {
    // fetchMySubscription já escolhe a paga (src/lib/subscription.ts); aqui chega a paga
    fetchSub.mockResolvedValue(active)
    setup()
    expect(await screen.findByRole('button', { name: 'Cancelar assinatura' })).toBeTruthy()
    expect(screen.queryByText(/Plano de cortesia/)).toBeNull()
  })

  it('N1: cortada por falta de pagamento e paga com atraso diz que não renova', async () => {
    fetchSub.mockResolvedValue({ ...active, status: 'canceled', cancel_source: 'unpaid', access_until: '2027-01-06T03:00:00Z' })
    setup({ planExpiresAt: '2027-01-06T03:00:00Z' })
    expect(await screen.findByText(/não renova mais/)).toBeTruthy()
    expect(screen.getByText(/até 05\/01\/2027/)).toBeTruthy()
    expect(screen.queryByText(/Nada mais é cobrado/)).toBeNull()
  })
})

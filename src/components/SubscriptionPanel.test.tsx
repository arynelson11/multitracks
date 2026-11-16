// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { MySubscription } from '../lib/subscription'

const fetchSubs = vi.fn()
const cancelSub = vi.fn()
const previewMock = vi.fn()
vi.mock('../lib/subscription', async (orig) => ({
  ...(await orig<typeof import('../lib/subscription')>()),
  fetchMySubscriptions: () => fetchSubs(),
  cancelMySubscription: () => cancelSub(),
  fetchCancelPreview: () => previewMock(),
}))

import { SubscriptionPanel } from './SubscriptionPanel'

const active: MySubscription = {
  id: 'chk_1', kind: 'asaas', plan_key: 'essencial_mensal', cycle: 'MONTHLY', status: 'active',
  started_at: '2026-10-16T15:00:00Z', next_due_date: '2026-12-16', paid_until: '2026-12-17T03:00:00Z',
  access_until: null, cancel_source: null, canceled_at: null, created_at: '2026-10-16T15:00:00Z',
}
const courtesy = (until: string | null): MySubscription => ({
  ...active, id: 'cortesia:1', kind: 'courtesy', plan_key: 'pro_anual', cycle: null, started_at: '2026-11-10T00:00:00Z',
  next_due_date: null, paid_until: null, access_until: until,
})

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-11-16T15:00:00Z'))
  fetchSubs.mockReset(); cancelSub.mockReset(); previewMock.mockReset(); previewMock.mockResolvedValue(null)
})
afterEach(() => { cleanup(); vi.useRealTimers() })

const setup = (plan = 'essencial_mensal') => {
  const onChanged = vi.fn()
  const onOpenPricing = vi.fn()
  render(<SubscriptionPanel plan={plan} onChanged={onChanged} onOpenPricing={onOpenPricing} />)
  return { onChanged, onOpenPricing }
}

describe('SubscriptionPanel', () => {
  it('mostra a próxima renovação e o botão Cancelar assinatura', async () => {
    fetchSubs.mockResolvedValue([active])
    setup()
    expect(await screen.findByText(/Próxima renovação: 16\/12\/2026/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Cancelar assinatura' })).toBeTruthy()
  })

  it('sem prévia: pede confirmação com as regras, sem travessão', async () => {
    fetchSubs.mockResolvedValue([active])
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
    fetchSubs.mockResolvedValue([active])
    previewMock.mockResolvedValue({ outcome: 'refund_request', plan: 'essencial_mensal', accessUntil: '2026-12-17T03:00:00Z', amount: 49.9 })
    setup()
    fireEvent.click(await screen.findByRole('button', { name: 'Cancelar assinatura' }))
    const dialog = screen.getByRole('dialog', { name: 'Cancelar a assinatura?' })
    await vi.waitFor(() => expect(dialog.textContent).toContain('não é automático'))
    expect(dialog.textContent).not.toContain('devolvemos o valor integral')
  })

  it('"Manter assinatura" fecha sem cancelar', async () => {
    fetchSubs.mockResolvedValue([active])
    setup()
    fireEvent.click(await screen.findByRole('button', { name: 'Cancelar assinatura' }))
    fireEvent.click(screen.getByRole('button', { name: 'Manter assinatura' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(cancelSub).not.toHaveBeenCalled()
  })

  it('confirma, cancela e mostra até quando continua com o plano', async () => {
    fetchSubs.mockResolvedValue([active])
    cancelSub.mockResolvedValue({ ok: true, data: { result: 'canceled', accessUntil: '2026-12-17T03:00:00Z', refunded: false, plan: 'essencial_mensal' } })
    const { onChanged } = setup()
    fireEvent.click(await screen.findByRole('button', { name: 'Cancelar assinatura' }))
    fireEvent.click(screen.getByRole('button', { name: 'Sim, cancelar' }))
    expect(await screen.findByText(/Assinatura cancelada\. Você continua com o Pro Mensal até 16\/12\/2026\. Nada mais será cobrado\./)).toBeTruthy()
    expect(onChanged).toHaveBeenCalled()
  })

  it('arrependimento: avisa do estorno e que já está no Livre', async () => {
    fetchSubs.mockResolvedValue([active])
    cancelSub.mockResolvedValue({ ok: true, data: { result: 'canceled', accessUntil: '2026-11-16T15:00:00Z', refunded: true, plan: 'essencial_mensal' } })
    setup()
    fireEvent.click(await screen.findByRole('button', { name: 'Cancelar assinatura' }))
    fireEvent.click(screen.getByRole('button', { name: 'Sim, cancelar' }))
    expect(await screen.findByText(/valor devolvido/)).toBeTruthy()
    expect(screen.getByText(/já está no Livre/)).toBeTruthy()
  })

  it('estorno recusado: avisa que a equipe faz o estorno', async () => {
    fetchSubs.mockResolvedValue([active])
    cancelSub.mockResolvedValue({ ok: true, data: { result: 'canceled', accessUntil: null, refunded: false, refundFailed: true, plan: 'essencial_mensal' } })
    setup()
    fireEvent.click(await screen.findByRole('button', { name: 'Cancelar assinatura' }))
    fireEvent.click(screen.getByRole('button', { name: 'Sim, cancelar' }))
    expect(await screen.findByText(/a nossa equipe vai fazer e te avisa/)).toBeTruthy()
  })

  it('erro do servidor aparece claro e dá pra tentar de novo', async () => {
    fetchSubs.mockResolvedValue([active])
    cancelSub.mockResolvedValue({ ok: false, error: 'Não conseguimos falar com o sistema de pagamento agora. Sua assinatura não foi cancelada e nada mudou.' })
    setup()
    fireEvent.click(await screen.findByRole('button', { name: 'Cancelar assinatura' }))
    fireEvent.click(screen.getByRole('button', { name: 'Sim, cancelar' }))
    expect(await screen.findByRole('alert')).toBeTruthy()
    expect(screen.getByRole('alert').textContent).toContain('nada mudou')
    expect(screen.getByRole('button', { name: 'Sim, cancelar' })).toBeTruthy()
  })

  it('já cancelada: mostra até quando vale (pela linha) e o botão de assinar de novo', async () => {
    fetchSubs.mockResolvedValue([{ ...active, status: 'canceled', cancel_source: 'user', access_until: '2026-12-17T03:00:00Z' }])
    const { onOpenPricing } = setup()
    expect(await screen.findByText(/Você continua com o Pro Mensal até 16\/12\/2026/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Cancelar assinatura' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Assinar de novo' }))
    expect(onOpenPricing).toHaveBeenCalled()
  })

  it('cortada por falta de pagamento e paga com atraso: diz que não renova', async () => {
    fetchSubs.mockResolvedValue([{ ...active, status: 'canceled', cancel_source: 'unpaid', access_until: '2027-01-06T03:00:00Z' }])
    setup()
    expect(await screen.findByText(/não renova mais/)).toBeTruthy()
    expect(screen.getByText(/até 05\/01\/2027/)).toBeTruthy()
  })

  it('no Livre não mostra nada', async () => {
    fetchSubs.mockResolvedValue([])
    const { container } = render(<SubscriptionPanel plan="free" onChanged={() => {}} onOpenPricing={() => {}} />)
    await Promise.resolve()
    expect(container.textContent).toBe('')
  })

  it('assinou antes desta versão (sem linha) com plano pago: ainda tem o botão de cancelar', async () => {
    fetchSubs.mockResolvedValue([])
    setup('pro_mensal')
    expect(await screen.findByRole('button', { name: 'Cancelar assinatura' })).toBeTruthy()
  })
})

describe('SubscriptionPanel: decide pelas linhas, não pelo perfil (COB-N6/Q9)', () => {
  it('cortesia com data posterior à assinatura paga: a paga aparece com o botão e a cortesia à parte', async () => {
    fetchSubs.mockResolvedValue([courtesy('2027-03-01T03:00:00Z'), active])
    setup('pro_anual')
    expect(await screen.findByRole('button', { name: 'Cancelar assinatura' })).toBeTruthy()
    expect(screen.getByText(/Pro Mensal\. Próxima renovação: 16\/12\/2026/)).toBeTruthy()
    expect(screen.getByText(/Plano de cortesia \(Studio Anual\), sem cobrança\. Vale até 28\/02\/2027\./)).toBeTruthy()
    expect(screen.queryByText(/Assinatura cancelada/)).toBeNull()
  })

  it('COB-R6: sem assinatura paga na lista e com cortesia, o botão de cancelar continua (pode haver assinatura de antes desta versão, sem linha)', async () => {
    fetchSubs.mockResolvedValue([courtesy(null)])
    setup('pro_anual')
    expect(await screen.findByText(/Plano de cortesia \(Studio Anual\), sem cobrança\. Sem data para acabar\./)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Cancelar assinatura' })).toBeTruthy()
    // a cortesia em si não tem botão: ele fica fora do bloco dela
    expect(screen.getByText(/Plano de cortesia/).closest('div')!.querySelector('button')).toBeNull()
  })

  it('COB-R6: assinante antigo (sem linha paga) que recebe cortesia com data continua com o botão de cancelar', async () => {
    fetchSubs.mockResolvedValue([courtesy('2027-03-01T03:00:00Z')])
    setup('pro_anual')
    expect(await screen.findByText(/Vale até 28\/02\/2027/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Cancelar assinatura' })).toBeTruthy()
  })

  it('com a assinatura paga cancelada na lista, a cortesia não traz o botão de volta', async () => {
    fetchSubs.mockResolvedValue([courtesy(null), { ...active, status: 'canceled', cancel_source: 'user', access_until: '2026-11-10T03:00:00Z' }])
    setup('pro_anual')
    expect(await screen.findByText(/Plano de cortesia/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Cancelar assinatura' })).toBeNull()
  })

  it('o texto de "pagamento atrasado recebido" só aparece pela linha cortada, não por outra assinatura', async () => {
    // anual cancelada pelo botão ainda no período; nenhuma cortada por falta de pagamento
    fetchSubs.mockResolvedValue([{ ...active, id: 'chk_anual', plan_key: 'essencial_anual', cycle: 'YEARLY', status: 'canceled', cancel_source: 'user', access_until: '2027-06-01T03:00:00Z' }])
    setup('essencial_anual')
    expect(await screen.findByText(/Assinatura cancelada\. Você continua com o Pro Anual até 31\/05\/2027/)).toBeTruthy()
    expect(screen.queryByText(/pagamento atrasado/)).toBeNull()
  })
})

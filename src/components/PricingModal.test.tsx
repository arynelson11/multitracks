// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'

const auth = { user: { id: 'u1' }, userPlan: 'essencial_mensal', planExpiresAt: null as string | null }
vi.mock('../hooks/useAuth', () => ({ useAuth: () => auth }))
vi.mock('../lib/supabase', () => ({ getAuthHeaders: async () => ({ Authorization: 'Bearer t' }) }))
vi.mock('../lib/api', () => ({ apiUrl: (p: string) => p }))
const desktop = { isElectron: false, openExternalUrl: vi.fn() }
vi.mock('../lib/desktop', () => ({
  get isElectron() { return desktop.isElectron },
  openExternalUrl: (url: string) => desktop.openExternalUrl(url),
}))

import { PricingModal } from './PricingModal'

const fetchMock = vi.fn()
beforeEach(() => {
  desktop.isElectron = false
  desktop.openExternalUrl.mockReset()
  auth.userPlan = 'essencial_mensal'
  auth.planExpiresAt = null
  fetchMock.mockReset()
  fetchMock.mockResolvedValue({ ok: false, status: 500, statusText: 'x', text: async () => '{"error":"teste"}' })
  vi.stubGlobal('fetch', fetchMock)
  vi.stubGlobal('alert', vi.fn())
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

const card = (name: string) => screen.getByRole('heading', { name }).closest('div.relative') as HTMLElement

describe('PricingModal: Alterar Plano', () => {
  it('quem já paga vê, antes de confirmar, que o novo é cobrado cheio e o atual termina na hora', () => {
    render(<PricingModal isOpen onClose={() => {}} />)
    fireEvent.click(within(card('Studio Mensal')).getByRole('button', { name: 'Assinar Agora' }))
    const dialog = screen.getByRole('dialog', { name: 'Trocar de plano?' })
    expect(dialog.textContent).toContain('cobrado cheio')
    expect(dialog.textContent).toContain('Pro Mensal termina na hora')
    expect(dialog.textContent).toContain('sem desconto proporcional')
    expect(dialog.textContent).not.toContain('—')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('"Confirmar troca" segue pro checkout do plano escolhido; "Voltar" não', async () => {
    render(<PricingModal isOpen onClose={() => {}} />)
    fireEvent.click(within(card('Studio Mensal')).getByRole('button', { name: 'Assinar Agora' }))
    fireEvent.click(screen.getByRole('button', { name: 'Voltar' }))
    expect(fetchMock).not.toHaveBeenCalled()
    fireEvent.click(within(card('Studio Mensal')).getByRole('button', { name: 'Assinar Agora' }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar troca' }))
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled())
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ planKey: 'pro_mensal' })
  })

  it('o plano atual aparece como atual e não dá pra assinar de novo por cima', () => {
    render(<PricingModal isOpen onClose={() => {}} />)
    const btn = within(card('Pro Mensal')).getByRole('button', { name: 'Seu plano atual' }) as HTMLButtonElement
    expect(btn.disabled).toBe(true)
  })

  it('no Livre assina direto, sem o aviso de troca', async () => {
    auth.userPlan = 'free'
    render(<PricingModal isOpen onClose={() => {}} />)
    fireEvent.click(within(card('Pro Mensal')).getByRole('button', { name: 'Assinar Agora' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled())
  })
})

describe('PricingModal: app de computador', () => {
  it('abre o pagamento no navegador do sistema, não dentro da janela do app', async () => {
    desktop.isElectron = true
    auth.userPlan = 'free'
    fetchMock.mockResolvedValue({ ok: true, status: 200, statusText: 'OK', text: async () => '{"url":"https://asaas.test/c/chk_9"}' })
    const before = window.location.href
    render(<PricingModal isOpen onClose={() => {}} />)
    fireEvent.click(within(card('Pro Mensal')).getByRole('button', { name: 'Assinar Agora' }))
    await vi.waitFor(() => expect(desktop.openExternalUrl).toHaveBeenCalledWith('https://asaas.test/c/chk_9'))
    expect(window.location.href).toBe(before)
    expect(await screen.findByText(/Abrimos o pagamento no seu navegador/)).toBeTruthy()
  })
})

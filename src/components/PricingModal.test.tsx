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
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ planKey: 'pro_mensal', confirmedSwitch: true })
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

describe('PricingModal: primeiro mês com desconto', () => {
  const PRICES = { essencial_mensal: 24.9, pro_mensal: 59.9 }
  const answer = (status: number, body: unknown) => ({ ok: status >= 200 && status < 300, status, statusText: 'x', text: async () => JSON.stringify(body) })
  const activeOffer = () => answer(200, { status: 'active', expiresAt: new Date(Date.now() + 47 * 3_600_000).toISOString(), prices: PRICES })
  const route = (offer: () => unknown, checkout: () => unknown) => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url === '/api/checkout?action=offer') return offer()
      if (url === '/api/checkout') return checkout()
      throw new Error(`rota inesperada: ${url}`)
    })
  }
  const bodies = (path: string) => fetchMock.mock.calls.filter(([url]) => url === path).map(([, init]) => JSON.parse(init.body))
  const subscribe = (name: string) => fireEvent.click(within(card(name)).getByRole('button', { name: 'Assinar Agora' }))

  beforeEach(() => {
    auth.userPlan = 'free'
    desktop.isElectron = true
  })

  it('com a janela aberta, Pro Mensal mostra primeiro mês por R$ 24,90, Studio Mensal R$ 59,90, e assinar manda offer true', async () => {
    route(activeOffer, () => answer(200, { url: 'https://asaas.test/c/chk_1' }))
    render(<PricingModal isOpen onClose={() => {}} />)
    // Ao abrir, só lê a oferta: nunca abre janela.
    await vi.waitFor(() => expect(card('Pro Mensal').textContent).toContain('Primeiro mês por'))
    expect(bodies('/api/checkout?action=offer')).toEqual([{ open: false }])
    expect(card('Pro Mensal').textContent).toMatch(/Primeiro mês porR\$ 24,90/)
    expect(card('Pro Mensal').textContent).toContain('Depois R$ 49,90/mês')
    expect(card('Studio Mensal').textContent).toMatch(/Primeiro mês porR\$ 59,90/)
    expect(card('Studio Mensal').textContent).toContain('Depois R$ 119,90/mês')

    subscribe('Pro Mensal')
    await vi.waitFor(() => expect(desktop.openExternalUrl).toHaveBeenCalledWith('https://asaas.test/c/chk_1'))
    subscribe('Studio Mensal')
    await vi.waitFor(() => expect(bodies('/api/checkout')).toHaveLength(2))
    expect(bodies('/api/checkout')).toEqual([
      { planKey: 'essencial_mensal', confirmedSwitch: false, offer: true },
      { planKey: 'pro_mensal', confirmedSwitch: false, offer: true },
    ])
    expect(window.alert).not.toHaveBeenCalled()
  })

  it('anual nunca mostra a oferta e sem janela tudo fica como antes', async () => {
    route(activeOffer, () => answer(200, { url: 'https://asaas.test/c/chk_2' }))
    const r = render(<PricingModal isOpen onClose={() => {}} />)
    await vi.waitFor(() => expect(card('Pro Mensal').textContent).toContain('Primeiro mês por'))
    for (const name of ['Pro Anual', 'Studio Anual']) {
      expect(card(name).textContent).not.toContain('Primeiro mês')
      expect(card(name).textContent).not.toContain('Depois')
    }
    expect(card('Pro Anual').textContent).toContain('R$ 454,80/ano')
    subscribe('Pro Anual')
    await vi.waitFor(() => expect(bodies('/api/checkout')).toHaveLength(1))
    expect(bodies('/api/checkout')[0]).toEqual({ planKey: 'essencial_anual', confirmedSwitch: false })
    r.unmount()

    // Sem janela (o servidor responde none): preço cheio em todos e o checkout sem a oferta.
    fetchMock.mockClear()
    route(() => answer(200, { status: 'none', expiresAt: null, prices: PRICES }), () => answer(200, { url: 'https://asaas.test/c/chk_3' }))
    render(<PricingModal isOpen onClose={() => {}} />)
    await vi.waitFor(() => expect(bodies('/api/checkout?action=offer')).toHaveLength(1))
    expect(card('Pro Mensal').textContent).toContain('R$ 49,90/mês')
    expect(card('Studio Mensal').textContent).toContain('R$ 119,90/mês')
    expect(screen.queryByText(/Primeiro mês/)).toBeNull()
    subscribe('Pro Mensal')
    await vi.waitFor(() => expect(bodies('/api/checkout')).toHaveLength(1))
    expect(bodies('/api/checkout')[0]).toEqual({ planKey: 'essencial_mensal', confirmedSwitch: false })
  })

  it('leitura da oferta que falha mostra o preço cheio e o checkout vai sem a oferta', async () => {
    let offerCalls = 0
    fetchMock.mockImplementation(async (url: string) => {
      if (url === '/api/checkout?action=offer') { offerCalls++; throw new TypeError('Failed to fetch') }
      return answer(200, { url: 'https://asaas.test/c/chk_4' })
    })
    render(<PricingModal isOpen onClose={() => {}} />)
    await vi.waitFor(() => expect(offerCalls).toBe(1))
    expect(screen.queryByText(/Primeiro mês/)).toBeNull()
    subscribe('Pro Mensal')
    await vi.waitFor(() => expect(bodies('/api/checkout')).toHaveLength(1))
    expect(bodies('/api/checkout')[0]).toEqual({ planKey: 'essencial_mensal', confirmedSwitch: false })
  })

  it('oferta que terminou (409 offerEnded) tira o desconto, mostra a frase do servidor na tela e não abre o pagamento sozinha', async () => {
    const ENDED = 'A oferta do primeiro mês terminou. O preço agora é o cheio.'
    let checkout = () => answer(409, { error: ENDED, offerEnded: true })
    route(activeOffer, () => checkout())
    render(<PricingModal isOpen onClose={() => {}} />)
    await vi.waitFor(() => expect(card('Pro Mensal').textContent).toContain('Primeiro mês por'))
    subscribe('Pro Mensal')
    expect((await screen.findByRole('alert')).textContent).toBe(ENDED)
    expect(screen.queryByText(/Primeiro mês/)).toBeNull()
    expect(card('Pro Mensal').textContent).toContain('R$ 49,90/mês')
    expect(desktop.openExternalUrl).not.toHaveBeenCalled()
    expect(window.alert).not.toHaveBeenCalled()
    expect(bodies('/api/checkout')).toHaveLength(1)

    // A pessoa decide assinar pelo cheio: vai sem a oferta.
    checkout = () => answer(200, { url: 'https://asaas.test/c/chk_5' })
    subscribe('Pro Mensal')
    await vi.waitFor(() => expect(desktop.openExternalUrl).toHaveBeenCalledWith('https://asaas.test/c/chk_5'))
    expect(bodies('/api/checkout')[1]).toEqual({ planKey: 'essencial_mensal', confirmedSwitch: false })
  })

  it('409 sem offerEnded e 500 seguem no aviso de sempre, com a frase do servidor', async () => {
    const HAS = 'Você já tem o Pro Mensal ativo. Não precisa assinar de novo; para mudar, escolha outro plano.'
    route(activeOffer, () => answer(409, { error: HAS }))
    render(<PricingModal isOpen onClose={() => {}} />)
    await vi.waitFor(() => expect(card('Pro Mensal').textContent).toContain('Primeiro mês por'))
    subscribe('Pro Mensal')
    await vi.waitFor(() => expect(window.alert).toHaveBeenCalledWith(HAS))
    // O desconto continua: não foi a oferta que terminou.
    expect(card('Pro Mensal').textContent).toContain('Primeiro mês por')
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('quem já paga (troca de plano) não lê a oferta: o aviso de troca fala do preço cheio', async () => {
    auth.userPlan = 'essencial_mensal'
    route(activeOffer, () => answer(200, { url: 'https://asaas.test/c/chk_6' }))
    render(<PricingModal isOpen onClose={() => {}} />)
    await new Promise((r) => setTimeout(r, 0))
    expect(fetchMock).not.toHaveBeenCalled()
    expect(screen.queryByText(/Primeiro mês/)).toBeNull()
  })

  it('fechada não lê a oferta; ao abrir de novo lê outra vez', async () => {
    route(activeOffer, () => answer(200, { url: 'https://asaas.test/c/chk_7' }))
    const r = render(<PricingModal isOpen={false} onClose={() => {}} />)
    await new Promise((res) => setTimeout(res, 0))
    expect(fetchMock).not.toHaveBeenCalled()
    r.rerender(<PricingModal isOpen onClose={() => {}} />)
    await vi.waitFor(() => expect(bodies('/api/checkout?action=offer')).toHaveLength(1))
    r.rerender(<PricingModal isOpen={false} onClose={() => {}} />)
    r.rerender(<PricingModal isOpen onClose={() => {}} />)
    await vi.waitFor(() => expect(bodies('/api/checkout?action=offer')).toHaveLength(2))
  })
})

// @vitest-environment jsdom
import { StrictMode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'

// O fetch é falso; sessão, endereço da API e app de computador também. O resto (offer.ts,
// checkout.ts, productEvents.ts e a tela) é o de verdade.
vi.mock('../../lib/supabase', () => ({ supabase: null, getAuthHeaders: async () => ({ 'Content-Type': 'application/json', Authorization: 'Bearer t' }) }))
vi.mock('../../lib/api', () => ({ apiUrl: (p: string) => p }))
const desktop = { isElectron: true, openExternalUrl: vi.fn() }
vi.mock('../../lib/desktop', () => ({
  get isElectron() { return desktop.isElectron },
  openExternalUrl: (url: string) => desktop.openExternalUrl(url),
}))

import { LimitGate } from './LimitGate'
import { LIMIT_COPY } from './limitCopy'

const TRAVESSAO = String.fromCharCode(0x2014)
const HOUR = 3_600_000
const PRICES = { essencial_mensal: 24.9, pro_mensal: 59.9 }
const ENDED = 'A oferta do primeiro mês terminou. O preço agora é o cheio.'
const DOWN = 'Não deu para abrir o pagamento agora. Tente de novo em alguns minutos.'
const read = (p: string) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), 'utf8')

type Resp = { ok: boolean; status: number; text: () => Promise<string> }
const answer = (status: number, body: unknown): Resp => ({ ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(body) })
const activeOffer = () => answer(200, { status: 'active', expiresAt: new Date(Date.now() + 48 * HOUR).toISOString(), prices: PRICES })

// O servidor falso: cada rota responde pela fila dela (a última resposta se repete).
const routes: { offer: Array<() => Promise<Resp> | Resp>; checkout: Array<() => Promise<Resp> | Resp> } = { offer: [], checkout: [] }
const fetchMock = vi.fn()
const bodies = (path: string) =>
  fetchMock.mock.calls.filter(([url]) => url === path).map(([, init]) => JSON.parse(init.body))
const offerCalls = () => bodies('/api/checkout?action=offer')
const trackCalls = () => bodies('/api/checkout?action=track')
const checkoutCalls = () => bodies('/api/checkout')
const next = (q: Array<() => Promise<Resp> | Resp>) => (q.length > 1 ? q.shift()! : q[0])

const alertSpy = vi.fn()
beforeEach(() => {
  desktop.isElectron = true
  desktop.openExternalUrl.mockReset()
  alertSpy.mockReset()
  routes.offer = [activeOffer]
  routes.checkout = [() => answer(200, { url: 'https://asaas.test/c/chk_1' })]
  fetchMock.mockReset()
  fetchMock.mockImplementation(async (url: string) => {
    if (url === '/api/checkout?action=offer') return next(routes.offer)()
    if (url === '/api/checkout?action=track') return answer(200, { ok: true })
    if (url === '/api/checkout') return next(routes.checkout)()
    throw new Error(`rota inesperada: ${url}`)
  })
  vi.stubGlobal('fetch', fetchMock)
  vi.stubGlobal('alert', alertSpy)
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

function renderGate(kind: Parameters<typeof LimitGate>[0]['kind'] = 'stage-songs', strict = false) {
  const onClose = vi.fn()
  const onSeePlans = vi.fn()
  const ui = <LimitGate kind={kind} onClose={onClose} onSeePlans={onSeePlans} />
  render(strict ? <StrictMode>{ui}</StrictMode> : ui)
  return { onClose, onSeePlans }
}
const proButton = () => screen.queryByRole('button', { name: 'Assinar o Pro por R$ 24,90' })
const studioButton = () => screen.queryByRole('button', { name: 'Assinar o Studio por R$ 59,90' })
// Deixa as promessas pendentes andarem (respostas do fetch falso).
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)) })

describe('LimitGate', () => {
  it('LimitGate abre a janela com o tipo do limite e mostra o relógio', async () => {
    renderGate('stage-songs')
    expect(screen.getByRole('dialog', { name: LIMIT_COPY['stage-songs'].title })).toBeTruthy()
    const timer = await screen.findByRole('timer')
    expect(timer.textContent).toMatch(/^Termina em 4[78]:\d\d:\d\d$/)
    expect(offerCalls()).toEqual([{ open: true, trigger: 'stage-songs' }])
    expect(trackCalls()).toEqual([{ kind: 'ad_shown', placement: 'limit' }])
    expect(proButton()).toBeTruthy()
    expect(studioButton()).toBeTruthy()
    expect(checkoutCalls()).toEqual([])
  })

  it('abre a janela e grava o anúncio visto uma vez só, mesmo com o StrictMode montando duas vezes', async () => {
    renderGate('live', true)
    await screen.findByRole('timer')
    await flush()
    expect(offerCalls()).toEqual([{ open: true, trigger: 'live' }])
    expect(trackCalls()).toEqual([{ kind: 'ad_shown', placement: 'limit' }])
  })

  it('o celular a mais mostra o texto dele e abre a janela da oferta como o Ao Vivo (o servidor só aceita os 5 limites)', async () => {
    renderGate('live-devices')
    expect(screen.getByRole('dialog', { name: LIMIT_COPY['live-devices'].title })).toBeTruthy()
    expect(screen.getByText(LIMIT_COPY['live-devices'].body)).toBeTruthy()
    await screen.findByRole('timer')
    expect(offerCalls()).toEqual([{ open: true, trigger: 'live' }])
    expect(trackCalls()).toEqual([{ kind: 'ad_shown', placement: 'limit' }])
    // Assinar daqui é igual aos outros limites: o desconto e o anúncio clicado no lugar `limit`.
    fireEvent.click(await screen.findByRole('button', { name: 'Assinar o Pro por R$ 24,90' }))
    await screen.findByRole('dialog', { name: 'Pagamento aberto no navegador' })
    expect(checkoutCalls()).toEqual([{ planKey: 'essencial_mensal', confirmedSwitch: false, offer: true }])
    expect(trackCalls()).toEqual([{ kind: 'ad_shown', placement: 'limit' }, { kind: 'ad_clicked', placement: 'limit' }])
  })

  it('LimitGate: escolher o Pro chama startCheckout com offer true e grava ad_clicked limit', async () => {
    const { onClose } = renderGate('separations')
    fireEvent.click(await screen.findByRole('button', { name: 'Assinar o Pro por R$ 24,90' }))
    await screen.findByRole('dialog', { name: 'Pagamento aberto no navegador' })
    expect(checkoutCalls()).toEqual([{ planKey: 'essencial_mensal', confirmedSwitch: false, offer: true }])
    expect(trackCalls()).toEqual([{ kind: 'ad_shown', placement: 'limit' }, { kind: 'ad_clicked', placement: 'limit' }])
    expect(desktop.openExternalUrl).toHaveBeenCalledWith('https://asaas.test/c/chk_1')
    expect(screen.getByText('Depois de pagar, volte para o app: o plano atualiza sozinho em alguns instantes.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Entendi' }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('escolher o Studio manda o Studio Mensal (pro_mensal) com offer true', async () => {
    renderGate('download')
    fireEvent.click(await screen.findByRole('button', { name: 'Assinar o Studio por R$ 59,90' }))
    await screen.findByRole('dialog', { name: 'Pagamento aberto no navegador' })
    expect(checkoutCalls()).toEqual([{ planKey: 'pro_mensal', confirmedSwitch: false, offer: true }])
  })

  it('LimitGate: oferta que terminou no meio mostra a frase do servidor e tira os preços com desconto', async () => {
    routes.offer = [activeOffer, () => answer(200, { status: 'expired', expiresAt: null, prices: PRICES })]
    routes.checkout = [() => answer(409, { error: ENDED, offerEnded: true })]
    const { onSeePlans } = renderGate('repertoire')
    fireEvent.click(await screen.findByRole('button', { name: 'Assinar o Pro por R$ 24,90' }))
    expect((await screen.findByRole('alert')).textContent).toBe(ENDED)
    await flush()
    expect(proButton()).toBeNull()
    expect(studioButton()).toBeNull()
    expect(screen.queryByRole('timer')).toBeNull()
    // Busca de novo só lendo, sem abrir janela, e não abre pagamento nenhum sozinha.
    expect(offerCalls()).toEqual([{ open: true, trigger: 'repertoire' }, { open: false }])
    expect(checkoutCalls()).toHaveLength(1)
    expect(desktop.openExternalUrl).not.toHaveBeenCalled()
    expect(alertSpy).not.toHaveBeenCalled()
    // A pessoa decide: sem o desconto, vai pros planos com o preço cheio.
    fireEvent.click(screen.getByRole('button', { name: 'Ver os planos' }))
    expect(onSeePlans).toHaveBeenCalledTimes(1)
  })

  it('se a nova leitura ainda disser que a janela está aberta, a tela nunca mostra a frase de oferta terminada junto do desconto', async () => {
    routes.offer = [activeOffer]
    routes.checkout = [() => answer(409, { error: ENDED, offerEnded: true })]
    renderGate('stage-songs')
    fireEvent.click(await screen.findByRole('button', { name: 'Assinar o Pro por R$ 24,90' }))
    await vi.waitFor(() => expect(offerCalls()).toHaveLength(2))
    await screen.findByRole('button', { name: 'Assinar o Pro por R$ 24,90' })
    expect(screen.queryByRole('alert')).toBeNull()
    expect(desktop.openExternalUrl).not.toHaveBeenCalled()
  })

  it('409 sem offerEnded ("já tem este plano"), 400 e 500 mostram a frase do servidor na tela, sem alert, e o desconto fica', async () => {
    const HAS = 'Você já tem o Pro Mensal ativo. Não precisa assinar de novo; para mudar, escolha outro plano.'
    const BAD = 'A oferta do primeiro mês vale só no Pro Mensal e no Studio Mensal.'
    routes.checkout = [() => answer(409, { error: HAS }), () => answer(400, { error: BAD }), () => answer(500, { error: DOWN })]
    renderGate('stage-songs')
    for (const phrase of [HAS, BAD, DOWN]) {
      fireEvent.click(await screen.findByRole('button', { name: 'Assinar o Pro por R$ 24,90' }))
      await vi.waitFor(() => expect(screen.getByRole('alert').textContent).toBe(phrase))
      await flush()
      expect(proButton()).toBeTruthy()
      expect((proButton() as HTMLButtonElement).disabled).toBe(false)
    }
    expect(checkoutCalls()).toHaveLength(3)
    expect(offerCalls()).toHaveLength(1)
    expect(desktop.openExternalUrl).not.toHaveBeenCalled()
    expect(alertSpy).not.toHaveBeenCalled()
  })

  it('servidor que responde 200 sem o link mostra a frase padrão na tela (nada de sucesso calado)', async () => {
    routes.checkout = [() => answer(200, {})]
    renderGate('stage-songs')
    fireEvent.click(await screen.findByRole('button', { name: 'Assinar o Pro por R$ 24,90' }))
    expect((await screen.findByRole('alert')).textContent).toBe(DOWN)
    expect(screen.queryByRole('dialog', { name: 'Pagamento aberto no navegador' })).toBeNull()
  })

  it('enquanto o pagamento abre, os dois botões ficam desligados e o segundo clique não abre outro', async () => {
    let release: (r: Resp) => void = () => {}
    routes.checkout = [() => new Promise<Resp>((r) => { release = r })]
    renderGate('stage-songs')
    const pro = await screen.findByRole('button', { name: 'Assinar o Pro por R$ 24,90' })
    fireEvent.click(pro)
    fireEvent.click(pro)
    await flush()
    expect((proButton() as HTMLButtonElement).disabled).toBe(true)
    expect((studioButton() as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(studioButton() as HTMLButtonElement)
    expect(checkoutCalls()).toHaveLength(1)
    release(answer(200, { url: 'https://asaas.test/c/chk_1' }))
    await screen.findByRole('dialog', { name: 'Pagamento aberto no navegador' })
    expect(desktop.openExternalUrl).toHaveBeenCalledTimes(1)
  })

  it('LimitGate sem internet abre a tela sem oferta', async () => {
    fetchMock.mockImplementation(async () => { throw new TypeError('Failed to fetch') })
    const { onClose, onSeePlans } = renderGate('live')
    expect(screen.getByRole('dialog', { name: LIMIT_COPY.live.title })).toBeTruthy()
    await flush()
    await flush()
    expect(screen.queryByRole('timer')).toBeNull()
    expect(proButton()).toBeNull()
    expect(studioButton()).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Ver os planos' }))
    expect(onSeePlans).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: 'Agora não' }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('oferta que o servidor não abre (já assinou, usada, vencida) mostra a tela sem desconto', async () => {
    for (const status of ['ineligible', 'used', 'expired', 'none'] as const) {
      routes.offer = [() => answer(200, { status, expiresAt: null, prices: PRICES })]
      renderGate('download')
      await flush()
      expect(screen.queryByRole('timer')).toBeNull()
      expect(proButton()).toBeNull()
      cleanup()
    }
  })

  it('o arquivo da tela não tem travessão nem window.alert, prompt ou confirm', () => {
    const src = read('./LimitGate.tsx')
    expect(src).not.toContain(TRAVESSAO)
    expect(src).not.toMatch(/\b(alert|prompt|confirm)\s*\(/)
  })
})

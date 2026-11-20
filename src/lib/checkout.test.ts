import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./supabase', () => ({ getAuthHeaders: async () => ({ 'Content-Type': 'application/json', Authorization: 'Bearer t' }) }))
vi.mock('./api', () => ({ apiUrl: (p: string) => `https://api.test${p}` }))
const desktop = { isElectron: false, openExternalUrl: vi.fn() }
vi.mock('./desktop', () => ({
  get isElectron() { return desktop.isElectron },
  openExternalUrl: (url: string) => desktop.openExternalUrl(url),
}))

import { startCheckout } from './checkout'

const fetchMock = vi.fn()
const answer = (status: number, body: unknown) => ({ ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(body) })
const sentBody = () => JSON.parse(fetchMock.mock.calls[0][1].body)
// O app da web troca de página pelo window.location; aqui (sem navegador) ele é um objeto simples.
let page: { location: { href: string } }

beforeEach(() => {
  desktop.isElectron = false
  desktop.openExternalUrl.mockReset()
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
  page = { location: { href: 'https://app.test/' } }
  vi.stubGlobal('window', page)
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('startCheckout', () => {
  it('startCheckout com offer manda offer true e no Electron abre no navegador do sistema', async () => {
    desktop.isElectron = true
    fetchMock.mockResolvedValue(answer(200, { url: 'https://asaas.test/c/chk_1' }))
    const out = await startCheckout({ planKey: 'essencial_mensal', offer: true })
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://api.test/api/checkout')
    expect(init.method).toBe('POST')
    expect(init.headers.Authorization).toBe('Bearer t')
    expect(sentBody()).toEqual({ planKey: 'essencial_mensal', confirmedSwitch: false, offer: true })
    expect(desktop.openExternalUrl).toHaveBeenCalledWith('https://asaas.test/c/chk_1')
    expect(page.location.href).toBe('https://app.test/')
    expect(out).toEqual({ kind: 'opened', external: true })
  })

  it('sem a oferta o corpo é o de sempre ({ planKey, confirmedSwitch }) e na web vai pra página do pagamento', async () => {
    fetchMock.mockResolvedValue(answer(200, { url: 'https://asaas.test/c/chk_2' }))
    const out = await startCheckout({ planKey: 'pro_anual', confirmedSwitch: true })
    expect(sentBody()).toEqual({ planKey: 'pro_anual', confirmedSwitch: true })
    expect('offer' in sentBody()).toBe(false)
    expect(page.location.href).toBe('https://asaas.test/c/chk_2')
    expect(desktop.openExternalUrl).not.toHaveBeenCalled()
    expect(out).toEqual({ kind: 'opened', external: false })
  })

  it('offer falso não vai no corpo (o servidor cobra o cheio)', async () => {
    fetchMock.mockResolvedValue(answer(200, { url: 'https://asaas.test/c/chk_3' }))
    await startCheckout({ planKey: 'pro_mensal', offer: false })
    expect(sentBody()).toEqual({ planKey: 'pro_mensal', confirmedSwitch: false })
  })

  it('startCheckout com 409 offerEnded devolve error com offerEnded', async () => {
    desktop.isElectron = true
    fetchMock.mockResolvedValue(answer(409, { error: 'A oferta do primeiro mês terminou. O preço agora é o cheio.', offerEnded: true }))
    const out = await startCheckout({ planKey: 'pro_mensal', offer: true })
    expect(out).toEqual({ kind: 'error', message: 'A oferta do primeiro mês terminou. O preço agora é o cheio.', offerEnded: true })
    expect(desktop.openExternalUrl).not.toHaveBeenCalled()
    expect(page.location.href).toBe('https://app.test/')
  })

  it('409 sem offerEnded é o "já tem este plano": a frase do servidor, sem offerEnded', async () => {
    fetchMock.mockResolvedValue(answer(409, { error: 'Você já tem o Pro Mensal ativo. Não precisa assinar de novo; para mudar, escolha outro plano.' }))
    const out = await startCheckout({ planKey: 'essencial_mensal', offer: true })
    expect(out).toEqual({ kind: 'error', message: 'Você já tem o Pro Mensal ativo. Não precisa assinar de novo; para mudar, escolha outro plano.', offerEnded: false })
  })

  it('offerEnded só vale no 409: em outro status a resposta é um erro comum', async () => {
    fetchMock.mockResolvedValue(answer(500, { error: 'Não deu para abrir o pagamento agora. Tente de novo em alguns minutos.', offerEnded: true }))
    const out = await startCheckout({ planKey: 'essencial_mensal', offer: true })
    expect(out).toEqual({ kind: 'error', message: 'Não deu para abrir o pagamento agora. Tente de novo em alguns minutos.', offerEnded: false })
  })

  it('400 e 500 devolvem a frase do servidor', async () => {
    fetchMock.mockResolvedValueOnce(answer(400, { error: 'A oferta do primeiro mês vale só no Pro Mensal e no Studio Mensal.' }))
    expect(await startCheckout({ planKey: 'essencial_anual', offer: true })).toEqual({
      kind: 'error', message: 'A oferta do primeiro mês vale só no Pro Mensal e no Studio Mensal.', offerEnded: false,
    })
    fetchMock.mockResolvedValueOnce(answer(500, { error: 'Não deu para abrir o pagamento agora. Tente de novo em alguns minutos.' }))
    expect(await startCheckout({ planKey: 'essencial_mensal' })).toEqual({
      kind: 'error', message: 'Não deu para abrir o pagamento agora. Tente de novo em alguns minutos.', offerEnded: false,
    })
  })

  it('erro de rede vira frase em português e nada abre', async () => {
    desktop.isElectron = true
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'))
    const out = await startCheckout({ planKey: 'essencial_mensal', offer: true })
    expect(out.kind).toBe('error')
    if (out.kind !== 'error') return
    expect(out.offerEnded).toBe(false)
    expect(out.message).toBe('Não foi possível conectar com o servidor. Confira a internet e tente de novo.')
    expect(desktop.openExternalUrl).not.toHaveBeenCalled()
  })

  it('nenhuma resposta vira sucesso calado: 200 sem link, resposta que não é JSON e erro sem frase dão a frase padrão', async () => {
    const DOWN = { kind: 'error', message: 'Não deu para abrir o pagamento agora. Tente de novo em alguns minutos.', offerEnded: false }
    fetchMock.mockResolvedValueOnce(answer(200, {}))
    expect(await startCheckout({ planKey: 'essencial_mensal' })).toEqual(DOWN)
    fetchMock.mockResolvedValueOnce(answer(200, { url: '' }))
    expect(await startCheckout({ planKey: 'essencial_mensal' })).toEqual(DOWN)
    fetchMock.mockResolvedValueOnce({ ok: false, status: 502, text: async () => '<html>Bad Gateway</html>' })
    expect(await startCheckout({ planKey: 'essencial_mensal' })).toEqual(DOWN)
    fetchMock.mockResolvedValueOnce(answer(500, { error: '' }))
    expect(await startCheckout({ planKey: 'essencial_mensal' })).toEqual(DOWN)
    expect(page.location.href).toBe('https://app.test/')
  })

  it('resposta de erro que traga um link não abre nada', async () => {
    desktop.isElectron = true
    fetchMock.mockResolvedValue(answer(500, { url: 'https://asaas.test/c/chk_x', error: 'Não deu para abrir o pagamento agora. Tente de novo em alguns minutos.' }))
    const out = await startCheckout({ planKey: 'essencial_mensal', offer: true })
    expect(out.kind).toBe('error')
    expect(desktop.openExternalUrl).not.toHaveBeenCalled()
  })

  it('sessão vencida (401) pede pra entrar de novo, em português', async () => {
    fetchMock.mockResolvedValue(answer(401, { error: 'Invalid or expired token' }))
    const out = await startCheckout({ planKey: 'essencial_mensal', offer: true })
    expect(out).toEqual({ kind: 'error', message: 'Sua sessão expirou. Entre de novo na sua conta para assinar.', offerEnded: false })
  })
})

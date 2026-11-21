// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { LandingPage } from './LandingPage'
import { FAQS } from '../content/site'

afterEach(cleanup)
const renderLanding = () => render(<LandingPage onEnter={() => {}} />)
const text = () => document.body.textContent ?? ''

describe('LandingPage: textos', () => {
  it('sem depoimentos inventados nem estrelas', () => {
    renderLanding()
    expect(text()).not.toContain('Histórias de domingo')
    for (const nome of ['Lucas Ferreira', 'Ana Paula Costa', 'Rodrigo Melo']) expect(text()).not.toContain(nome)
  })

  it('sem promessas que o app não cumpre', () => {
    renderLanding()
    for (const frase of [
      'levada brasileira', 'Qualidade máxima', 'Prioridade no processamento',
      'Suporte prioritário', 'Suporte por email', 'Cancele direto pelo painel',
      'sem instalar nada. A interface', 'Progressive Web App', 'Voice guide', 'voice guide',
      'Biblioteca cloud', 'tokens',
    ]) expect(text()).not.toContain(frase)
  })

  it('"stems" só aparece como sinônimo explicado, nunca como termo principal', () => {
    renderLanding()
    expect((text().match(/stems/gi) ?? []).length).toBeLessThanOrEqual(1)
    const naFaq = FAQS.flatMap(f => `${f.q} ${f.a}`.match(/stems/gi) ?? [])
    expect(naFaq).toHaveLength(1)
    expect(FAQS[0].a).toMatch(/^É separar a música nas faixas individuais, as multitracks \(também chamadas de stems\)/)
  })

  it('fala com a igreja e usa VS', () => {
    renderLanding()
    expect(text()).toMatch(/igreja/)
    expect(text()).toMatch(/\bVS\b/)
  })

  it('diz o que é do Livre e o que é do Pro', () => {
    renderLanding()
    // Parte 3 (Livre como amostra): 3 separações em 4 ou 6 faixas, 3 músicas no palco e Ao Vivo com 1 celular.
    expect(text()).toContain('No Livre você separa 3 músicas por mês em 4 ou 6 faixas e toca até 3 músicas diferentes por mês no palco, com seções, tom, BPM e voz guia.')
    for (const item of [
      '3 separações de faixas por mês',
      'Separação em 4 ou 6 faixas',
      'Até 3 músicas diferentes por mês no palco',
      'Seções, troca de tom, BPM pela IA, click e voz guia',
      // Revisão macro 1b (I2): só quem controla tem teto; os outros celulares acompanham.
      'Modo Ao Vivo com 1 celular no controle (os outros acompanham), até 10 minutos por dia',
    ]) expect(text()).toContain(item)
    // M9: pago é o conjunto de pads da nuvem; o painel de pads do aparelho é de todos.
    expect(text()).toContain('Download das faixas, repertório com várias músicas, pads da nuvem, biblioteca na nuvem e Modo Ao Vivo com mais celulares no controle e sem limite de tempo ficam nos planos Pro e Studio.')
    expect(text()).toContain('Modo Ao Vivo no app de computador: a banda conecta por QR Code, até 4 celulares no controle')
    expect(text()).not.toContain('até 4 aparelhos')
    expect(text()).not.toContain('Modo Ao Vivo com 1 celular,')
    for (const velho of ['5 separações', '5 músicas', '2 faixas (voz e instrumental)', '(2 no Livre)', 'Nos planos Pro e Studio, mude o tom', 'No Pro, você marca as seções']) {
      expect(text()).not.toContain(velho)
    }
    // Selo Pro só no que continua pago: BPM e voz guia agora são de todos. O teleprompter nunca
    // teve trava de plano no código (o LETRA do palco abre pra todos), então também fica sem selo.
    const selo = (titulo: string) => screen.getByRole('heading', { name: new RegExp(`^${titulo}`) }).querySelector('span')?.textContent ?? null
    expect(selo('BPM detectado pela IA')).toBeNull()
    expect(selo('Voz guia automática')).toBeNull()
    expect(selo('Teleprompter de letras')).toBeNull()
    // Revisão macro 1b (I1): o Livre tem o Modo Ao Vivo com QR Code, então o QR Code fica sem selo.
    expect(selo('Banda conecta por QR Code')).toBeNull()
    for (const pago of ['Repertório com backup .zip', 'Download em WAV ou MP3']) expect(selo(pago)).toBe('Pro')
    // I3: o teleprompter descreve só o que existe (ninguém fora do admin sobe letra).
    expect(text()).toContain('Nas músicas com letra, a equipe acompanha a letra na tela, sincronizada com as seções, no palco ou pelo celular.')
    expect(text()).not.toMatch(/Suba a letra/)
    expect(selo('App desktop que toca offline')).toBeNull()
  })

  it('o selo do anual vale o desconto de verdade de cada plano', () => {
    renderLanding()
    expect(text()).toContain('até −25%')
    expect(text()).toContain('R$ 454,80 cobrado por ano. Economia de R$ 144,00 (24%)')
    expect(text()).toContain('R$ 1.078,80 cobrado por ano. Economia de R$ 360,00 (25%)')
    fireEvent.click(screen.getByRole('button', { name: 'Mensal' }))
    expect(text()).toContain('ou R$ 37,90/mês no anual (24% a menos)')
    expect(text()).toContain('ou R$ 89,90/mês no anual (25% a menos)')
  })

  it('preços batem com o FATOS', () => {
    renderLanding()
    fireEvent.click(screen.getByRole('button', { name: 'Mensal' }))
    expect(text()).toContain('49,90')
    expect(text()).toContain('119,90')
  })

  it('sem fidelidade não aparece (o anual é cobrado de uma vez); cancelar faz a assinatura deixar de renovar, sem multa', () => {
    renderLanding()
    expect(text()).not.toMatch(/fidelidade/i)
    const cancelar = FAQS.find(f => f.q === 'Posso cancelar quando quiser?')?.a ?? ''
    expect(cancelar).toMatch(/^Sim, sem multa: a assinatura deixa de renovar, no mensal e no anual\./)
    expect(cancelar).toContain('7 dias')
    // v1.4.18: a pessoa cancela sozinha no app; o atendimento ficou como alternativa.
    expect(cancelar).toContain('em Configurações, aba Assinatura, no botão Cancelar assinatura')
    expect(cancelar).toContain('continua com o plano até o fim do período já pago')
    expect(cancelar).toContain('na primeira assinatura da conta, o valor integral é estornado no cartão')
    expect(cancelar).not.toContain('Por enquanto')
    expect(text()).toContain('Cancele quando quiser: a assinatura deixa de renovar, sem multa')
  })

  it('todas as perguntas da FAQ aparecem, inclusive a de VS e a de cancelamento (com o atendimento como alternativa)', () => {
    renderLanding()
    for (const f of FAQS) expect(text()).toContain(f.q)
    expect(FAQS.find(f => f.q === 'Posso cancelar quando quiser?')?.a).toMatch(/WhatsApp .* email/)
  })
})

describe('LandingPage: estrutura acessível', () => {
  it('tem um <main> e o link de pular para o conteúdo', () => {
    renderLanding()
    expect(document.querySelectorAll('main#conteudo')).toHaveLength(1)
    expect(screen.getByRole('link', { name: 'Pular para o conteúdo' }).getAttribute('href')).toBe('#conteudo')
  })

  it('títulos não pulam nível (um h1, sem h4)', () => {
    renderLanding()
    const levels = [...document.querySelectorAll('h1,h2,h3,h4,h5,h6')].map(h => Number(h.tagName[1]))
    expect(levels.filter(l => l === 1)).toHaveLength(1)
    for (let i = 1; i < levels.length; i++) expect(levels[i] - levels[i - 1]).toBeLessThanOrEqual(1)
  })

  it('respostas da FAQ ficam no HTML, escondidas até abrir, com aria-expanded', () => {
    renderLanding()
    const pergunta = screen.getByRole('button', { name: FAQS[0].q })
    const resposta = document.getElementById(pergunta.getAttribute('aria-controls') ?? '')
    expect(resposta?.textContent).toBe(FAQS[0].a)
    expect(resposta?.hidden).toBe(true)
    expect(pergunta.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(pergunta)
    expect(pergunta.getAttribute('aria-expanded')).toBe('true')
    expect(resposta?.hidden).toBe(false)
    for (const f of FAQS) expect(text()).toContain(f.a)
  })
})

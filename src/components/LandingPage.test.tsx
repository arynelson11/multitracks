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
    expect(FAQS[0].a).toContain('também chamadas de multitracks ou stems')
  })

  it('fala com a igreja e usa VS', () => {
    renderLanding()
    expect(text()).toMatch(/igreja/)
    expect(text()).toMatch(/\bVS\b/)
  })

  it('diz o que é do Livre e o que é do Pro', () => {
    renderLanding()
    expect(text()).toContain('No Livre você separa 5 músicas por mês em 2 faixas')
    expect(text()).toContain('Download, BPM, voz guia, seções, troca de tom e Modo Ao Vivo ficam nos planos Pro e Studio.')
    expect(screen.getAllByText('Pro', { selector: 'span' }).length).toBeGreaterThanOrEqual(6)
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

  it('todas as perguntas da FAQ aparecem, inclusive a de VS e a de cancelamento pelo atendimento', () => {
    renderLanding()
    for (const f of FAQS) expect(text()).toContain(f.q)
    expect(FAQS.find(f => f.q === 'Posso cancelar quando quiser?')?.a).toMatch(/WhatsApp .* email/)
  })
})

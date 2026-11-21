// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PricingView } from './PricingView'
import type { PricingCardView, PricingViewProps } from './PricingView'
import { PRICING_PLANS } from './pricingCatalog'
import { oldLanguageClasses } from '../../test/psLanguage'

const TRAVESSAO = String.fromCharCode(0x2014)

afterEach(cleanup)

const cards = (over: (c: PricingCardView) => Partial<PricingCardView> = () => ({})): PricingCardView[] =>
  PRICING_PLANS.map((p) => {
    const base: PricingCardView = { ...p, offerPrice: null, current: false, loading: false, disabled: false }
    return { ...base, ...over(base) }
  })

function mount(over: Partial<PricingViewProps> = {}) {
  const p: PricingViewProps = {
    open: true, onClose: vi.fn(), switching: false, currentName: 'Livre', cards: cards(), openedExternally: false,
    pending: null, onConfirmSwitch: vi.fn(), onCancelSwitch: vi.fn(), onChoose: vi.fn(), ...over,
  }
  const r = render(<PricingView {...p} />)
  return { ...r, p }
}

const card = (name: string) => screen.getByRole('heading', { name }).closest('[data-plan-card]') as HTMLElement

describe('Planos (PricingView)', () => {
  it('fechada não renderiza nada; título e a linha de baixo mudam com quem já paga', () => {
    expect(mount({ open: false }).container.innerHTML).toBe('')
    cleanup()
    mount()
    expect(screen.getByRole('dialog', { name: 'Escolha seu Plano' }).textContent).toContain('Desbloqueie todo o poder do seu estúdio em nuvem')
    cleanup()
    mount({ switching: true, currentName: 'Pro Mensal' })
    expect(screen.getByRole('dialog', { name: 'Escolha seu Plano' }).textContent).toContain('Trocar de plano: o novo é cobrado cheio e o atual termina na hora, sem proporcional.')
  })

  it('os 4 cartões com nome, descrição, preço, período e recursos; Assinar Agora chama onChoose', () => {
    const { p } = mount()
    expect(document.querySelectorAll('[data-plan-card]')).toHaveLength(4)
    expect(card('Pro Mensal').textContent).toContain('Pra equipe que toca toda semana')
    expect(card('Pro Mensal').textContent).toContain('R$ 49,90/mês')
    expect(card('Pro Anual').textContent).toContain('R$ 454,80/ano')
    expect(card('Studio Mensal').textContent).toContain('R$ 119,90/mês')
    expect(card('Studio Anual').textContent).toContain('R$ 1.078,80/ano')
    expect(within(card('Studio Mensal')).getByText('150 separações de faixas por mês')).toBeTruthy()
    // Mais Popular só no Pro Mensal, e o botão dele é a ação principal.
    expect(within(card('Pro Mensal')).getByText('Mais Popular')).toBeTruthy()
    for (const name of ['Pro Anual', 'Studio Mensal', 'Studio Anual']) expect(within(card(name)).queryByText('Mais Popular')).toBeNull()
    fireEvent.click(within(card('Studio Anual')).getByRole('button', { name: 'Assinar Agora' }))
    expect(p.onChoose).toHaveBeenCalledWith('pro_anual')
  })

  it('Processando... no cartão abrindo e Seu plano atual desligado', () => {
    mount({ cards: cards((c) => (c.planKey === 'pro_mensal' ? { loading: true, disabled: true } : c.planKey === 'essencial_mensal' ? { current: true, disabled: true } : {})) })
    const busy = within(card('Studio Mensal')).getByRole('button', { name: /Processando\.\.\./ }) as HTMLButtonElement
    expect(busy.disabled).toBe(true)
    expect(busy.getAttribute('aria-busy')).toBe('true')
    const current = within(card('Pro Mensal')).getByRole('button', { name: 'Seu plano atual' }) as HTMLButtonElement
    expect(current.disabled).toBe(true)
  })

  it('com offerPrice, o primeiro mês aparece no cartão e o preço cheio continua escrito', () => {
    mount({ cards: cards((c) => (c.planKey === 'essencial_mensal' ? { offerPrice: 'R$ 24,90' } : c.planKey === 'pro_mensal' ? { offerPrice: 'R$ 59,90' } : {})) })
    expect(card('Pro Mensal').textContent).toMatch(/Primeiro mês porR\$ 24,90/)
    expect(card('Pro Mensal').textContent).toContain('Depois R$ 49,90/mês. Cancele quando quiser.')
    expect(card('Studio Mensal').textContent).toMatch(/Primeiro mês porR\$ 59,90/)
    expect(card('Studio Mensal').textContent).toContain('Depois R$ 119,90/mês. Cancele quando quiser.')
    for (const name of ['Pro Anual', 'Studio Anual']) expect(card(name).textContent).not.toContain('Primeiro mês')
  })

  it('Trocar de plano? é uma segunda janela com o texto de hoje; Voltar e Confirmar troca chamam as ações', () => {
    const { p } = mount({ switching: true, currentName: 'Pro Mensal', pending: { name: 'Studio Mensal', price: 'R$ 119,90', period: '/mês' } })
    const dialog = screen.getByRole('dialog', { name: 'Trocar de plano?' })
    expect(dialog.textContent).toContain('O Studio Mensal é cobrado cheio agora (R$ 119,90/mês). O Pro Mensal termina na hora, assim que o novo for pago, sem desconto proporcional do que já foi pago.')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Voltar' }))
    expect(p.onCancelSwitch).toHaveBeenCalledTimes(1)
    fireEvent.click(within(dialog).getByRole('button', { name: 'Confirmar troca' }))
    expect(p.onConfirmSwitch).toHaveBeenCalledTimes(1)
    // A janela dos Planos continua embaixo.
    expect(screen.getByRole('dialog', { name: 'Escolha seu Plano' })).toBeTruthy()
  })

  it('aberto no navegador, oferta que terminou e erro aparecem dentro da janela', () => {
    mount({ openedExternally: true, offerNote: 'A oferta do primeiro mês terminou.', message: 'Não deu para abrir o pagamento agora.' })
    const dialog = screen.getByRole('dialog', { name: 'Escolha seu Plano' })
    expect(within(dialog).getByRole('status').textContent).toContain('Abrimos o pagamento no seu navegador')
    expect(within(dialog).getAllByRole('alert').map((a) => a.textContent)).toEqual(['A oferta do primeiro mês terminou.', 'Não deu para abrir o pagamento agora.'])
  })

  it('o clique nos Planos não chega em quem monta eles (as Configurações não fecham juntas)', () => {
    const outer = vi.fn()
    const onChoose = vi.fn()
    const onClose = vi.fn()
    render(
      <div onClick={outer}>
        <PricingView open onClose={onClose} switching={false} currentName="Livre" cards={cards()} openedExternally={false}
          pending={null} onConfirmSwitch={vi.fn()} onCancelSwitch={vi.fn()} onChoose={onChoose} />
      </div>,
    )
    fireEvent.click(within(card('Pro Mensal')).getByRole('button', { name: 'Assinar Agora' }))
    expect(onChoose).toHaveBeenCalledWith('essencial_mensal')
    // Toque no fundo fecha só os Planos.
    fireEvent.click(screen.getByRole('dialog', { name: 'Escolha seu Plano' }).parentElement!)
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(outer).not.toHaveBeenCalled()
  })

  it('linguagem do palco e nenhum texto com travessão', () => {
    mount({
      openedExternally: true, message: 'erro', pending: { name: 'Studio Mensal', price: 'R$ 119,90', period: '/mês' },
      cards: cards((c) => (c.offerable ? { offerPrice: 'R$ 24,90' } : {})),
    })
    for (const dialog of screen.getAllByRole('dialog')) {
      expect(oldLanguageClasses(dialog)).toEqual([])
      expect(dialog.textContent).not.toContain(TRAVESSAO)
    }
    for (const f of ['PricingView.tsx', 'pricingCatalog.ts']) {
      expect(readFileSync(join(process.cwd(), 'src/components/pricing', f), 'utf8')).not.toContain(TRAVESSAO)
    }
  })
})

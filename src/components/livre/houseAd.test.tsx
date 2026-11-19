// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { HouseAdCard } from './HouseAdCard'
import type { HouseAdCardProps } from './HouseAdCard'
import { LivreBadge } from './LivreBadge'
import { HOME_AD, LIVRE_BADGE_REST, SEPARATION_AD, livreBadgeShort, livreBadgeText } from './adCopy'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

const TRAVESSAO = String.fromCharCode(0x2014)
const read = (p: string) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), 'utf8')

function renderCard(placement: HouseAdCardProps['placement']) {
  const onCta = vi.fn()
  const onDismiss = vi.fn()
  const r = render(<HouseAdCard placement={placement} onCta={onCta} onDismiss={onDismiss} />)
  return { ...r, onCta, onDismiss }
}

describe('cartão do anúncio da casa', () => {
  it('cartão da tela inicial mostra o resultado; Conhecer o Pro chama onCta e Agora não chama onDismiss', () => {
    const { onCta, onDismiss } = renderCard('home')
    const card = screen.getByRole('region', { name: 'O que o Pro faz por você' })
    expect(card.dataset.houseAd).toBe('home')
    expect(card.textContent).toContain('Seu culto inteiro no palco, a banda acompanhando no celular e cada faixa pronta pra levar pro ensaio.')

    fireEvent.click(screen.getByRole('button', { name: 'Conhecer o Pro' }))
    expect(onCta).toHaveBeenCalledTimes(1)
    expect(onDismiss).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Agora não' }))
    expect(onDismiss).toHaveBeenCalledTimes(1)
    expect(onCta).toHaveBeenCalledTimes(1)
  })

  it('cartão do fim da separação mostra No Pro você baixa essas faixas e salva na nuvem', () => {
    const { onCta, onDismiss } = renderCard('separation-done')
    const card = screen.getByRole('region', { name: 'No Pro você baixa essas faixas e salva na nuvem' })
    expect(card.dataset.houseAd).toBe('separation-done')
    // Só a frase: o texto do cartão da tela inicial não aparece aqui.
    expect(card.textContent).not.toContain(HOME_AD.body)
    fireEvent.click(screen.getByRole('button', { name: 'Conhecer o Pro' }))
    fireEvent.click(screen.getByRole('button', { name: 'Agora não' }))
    expect(onCta).toHaveBeenCalledTimes(1)
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })

  it('textos do anúncio como o plano manda', () => {
    expect(HOME_AD).toEqual({
      title: 'O que o Pro faz por você',
      body: 'Seu culto inteiro no palco, a banda acompanhando no celular e cada faixa pronta pra levar pro ensaio.',
      cta: 'Conhecer o Pro',
      dismiss: 'Agora não',
    })
    expect(SEPARATION_AD).toEqual({ title: 'No Pro você baixa essas faixas e salva na nuvem', cta: 'Conhecer o Pro', dismiss: 'Agora não' })
  })

  it('é um cartão no fluxo: Panel raised, sem som, sem vídeo, sem janela por cima e sem puxar o foco', () => {
    const { container } = renderCard('home')
    const card = container.firstElementChild as HTMLElement
    expect(card.className).toContain('bg-ps-raised')
    expect(container.querySelector('audio, video, iframe, [autoplay]')).toBeNull()
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(card.outerHTML).not.toMatch(/\b(fixed|absolute|sticky)\b|aria-modal/)
    expect(document.activeElement).toBe(document.body)
  })

  it('Conhecer o Pro é a ação principal (laranja) e os dois botões têm alvo de 44 px com largura pelo texto', () => {
    renderCard('separation-done')
    const cta = screen.getByRole('button', { name: 'Conhecer o Pro' })
    const dismiss = screen.getByRole('button', { name: 'Agora não' })
    expect(cta.className).toContain('bg-ps-or')
    expect(dismiss.className).not.toContain('bg-ps-or')
    for (const btn of [cta, dismiss]) {
      expect(btn.className).toContain('min-h-ps-touch')
      expect(btn.className).toContain('min-w-ps-touch')
      expect(btn.className.split(/\s+/).some((c) => /^w-\d|^w-\[/.test(c))).toBe(false)
    }
  })
})

describe('selo do Livre', () => {
  it('livreBadgeText(2, 3) é LIVRE · 2 de 3 músicas este mês', () => {
    expect(livreBadgeText(2, 3)).toBe('LIVRE · 2 de 3 músicas este mês')
    expect(livreBadgeText(0, 3)).toBe('LIVRE · 0 de 3 músicas este mês')
    expect(livreBadgeText(3, 3)).toBe('LIVRE · 3 de 3 músicas este mês')
  })

  it('livreBadgeText nunca mostra mais do que o limite nem número quebrado ou negativo', () => {
    expect(livreBadgeText(5, 3)).toBe('LIVRE · 3 de 3 músicas este mês')
    expect(livreBadgeText(-1, 3)).toBe('LIVRE · 0 de 3 músicas este mês')
    expect(livreBadgeText(1.7, 3)).toBe('LIVRE · 1 de 3 músicas este mês')
    expect(livreBadgeText(Number.NaN, 3)).toBe('LIVRE · 0 de 3 músicas este mês')
    expect(livreBadgeText(2, Number.NaN)).toBe('LIVRE · 0 de 0 músicas este mês')
  })

  it('o selo é um botão de 44 px que chama onClick', () => {
    const onClick = vi.fn()
    render(<LivreBadge used={2} limit={3} onClick={onClick} />)
    const btn = screen.getByRole('button', { name: 'LIVRE · 2 de 3 músicas este mês' })
    expect(btn.className).toContain('min-h-ps-touch')
    expect(btn.className).toContain('min-w-ps-touch')
    expect(btn.getAttribute('type')).toBe('button')
    expect(btn.title).toBe('Ver os planos')
    fireEvent.click(btn)
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('a pílula visível tem 22 px, no estilo do selo ONLINE e neutra (nem laranja, nem âmbar, nem musgo)', () => {
    render(<LivreBadge used={3} limit={3} onClick={() => {}} />)
    const btn = screen.getByRole('button')
    const pill = btn.querySelector('[data-livre-pill]') as HTMLElement
    expect(pill.textContent).toBe('LIVRE · 3 de 3 músicas este mês')
    expect(pill.className).toContain('h-[22px]')
    expect(pill.className).toContain('rounded-ps-pill')
    expect(pill.className).toContain('whitespace-nowrap')
    expect(pill.outerHTML).not.toMatch(/ps-or|ps-alert|ps-moss|red|#/)
    // O botão em volta só ganha o anel de foco laranja de todo botão do app.
    const own = btn.className.split(/\s+/).filter((c) => !c.startsWith('focus-visible:'))
    expect(own.join(' ')).not.toMatch(/ps-or|ps-alert|ps-moss|red|#/)
  })

  it('abaixo de 1280 px o selo mostra LIVRE · 2 de 3; o nome do botão continua com o texto inteiro', () => {
    render(<LivreBadge used={2} limit={3} onClick={() => {}} />)
    const btn = screen.getByRole('button')
    expect(btn.getAttribute('aria-label')).toBe('LIVRE · 2 de 3 músicas este mês')
    const rest = [...btn.querySelectorAll('span')].find((el) => el.textContent === ' músicas este mês')!
    expect(rest.className.split(/\s+/)).toEqual(['hidden', 'xl:inline'])
    expect(livreBadgeShort(2, 3) + LIVRE_BADGE_REST).toBe(livreBadgeText(2, 3))
    expect(livreBadgeShort(2, 3)).toBe('LIVRE · 2 de 3')
  })

  it('nenhum travessão e nenhum stems nos textos e nos arquivos do anúncio e do selo', () => {
    const texts = [...Object.values(HOME_AD), ...Object.values(SEPARATION_AD), livreBadgeText(2, 3)]
    for (const t of texts) {
      expect(t).not.toContain(TRAVESSAO)
      expect(t).not.toMatch(/stems?/i)
    }
    for (const file of ['./adCopy.ts', './HouseAdCard.tsx', './LivreBadge.tsx']) {
      expect(read(file)).not.toContain(TRAVESSAO)
      expect(read(file)).not.toMatch(/stems?/i)
    }
  })
})

// @vitest-environment jsdom
// Tour na linguagem do palco (Parte 3, faixa C): o balão muda de cara, o caminho não muda (anda,
// volta, pula passo sem alvo, teclas Esc e setas, spotlight no alvo). E todo alvo dos tours do app
// e do Separador continua tendo dono no código (um data-tour com aquele nome).
import { readFileSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { GuidedTour, type TourStep } from './GuidedTour'
import { oldLanguageClasses } from '../test/psLanguage'

const STEPS: TourStep[] = [
  { title: 'Bem-vindo', body: 'Vou te mostrar tudo.' },
  { target: 'a', title: 'Alvo A', body: 'O primeiro alvo.' },
  { target: 'b', title: 'Alvo B', body: 'Esse alvo não existe na página.' },
  { target: 'c', title: 'Alvo C', body: 'O último alvo.' },
]

function alvo(nome: string, rect = { top: 100, left: 200, width: 50, height: 20 }) {
  const el = document.createElement('div')
  el.dataset.tour = nome
  el.getBoundingClientRect = () => ({ ...rect, right: rect.left + rect.width, bottom: rect.top + rect.height, x: rect.left, y: rect.top, toJSON: () => ({}) })
  document.body.appendChild(el)
}

function abrir() {
  const onClose = vi.fn()
  render(<GuidedTour steps={STEPS} onClose={onClose} />)
  return { onClose }
}

const passo = () => screen.getByRole('dialog').getAttribute('aria-labelledby') && screen.getByRole('dialog').querySelector('h2')?.textContent

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn()
  alvo('a')
  alvo('c')
})
afterEach(() => {
  cleanup()
  document.body.innerHTML = ''
})

describe('Tour: nada some', () => {
  it('anda, volta, pula o passo sem alvo e conclui', () => {
    const { onClose } = abrir()
    expect(screen.getByRole('dialog', { name: 'Bem-vindo' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Passo anterior' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Próximo' }))
    expect(passo()).toBe('Alvo A')
    fireEvent.click(screen.getByRole('button', { name: 'Próximo' }))
    expect(passo()).toBe('Alvo C')
    fireEvent.click(screen.getByRole('button', { name: 'Passo anterior' }))
    expect(passo()).toBe('Alvo A')
    fireEvent.click(screen.getByRole('button', { name: 'Próximo' }))
    expect(onClose).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Concluir' }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('Esc fecha; seta pra direita e pra esquerda andam como os botões', () => {
    const { onClose } = abrir()
    fireEvent.keyDown(window, { key: 'ArrowRight' })
    expect(passo()).toBe('Alvo A')
    fireEvent.keyDown(window, { key: 'ArrowLeft' })
    expect(passo()).toBe('Bem-vindo')
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('Pular e Fechar terminam o tour; no passo do meio da tela o toque fora também', () => {
    const { onClose } = abrir()
    fireEvent.click(screen.getByRole('button', { name: 'Pular' }))
    fireEvent.click(screen.getByRole('button', { name: 'Fechar o tutorial' }))
    fireEvent.click(document.querySelector('[data-tour-backdrop]') as HTMLElement)
    expect(onClose).toHaveBeenCalledTimes(3)
  })

  it('o spotlight abraça o alvo com 8 px de folga e contorno laranja', () => {
    abrir()
    expect(document.querySelector('[data-tour-spotlight]')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Próximo' }))
    const luz = document.querySelector<HTMLElement>('[data-tour-spotlight]')!
    expect([luz.style.top, luz.style.left, luz.style.width, luz.style.height]).toEqual(['92px', '192px', '66px', '36px'])
    expect(luz.style.border).toContain('var(--color-ps-or)')
  })
})

describe('Tour: os alvos', () => {
  const ROOT = resolve(process.cwd(), 'src')
  const ler = (rel: string) => readFileSync(join(ROOT, rel), 'utf8')
  const stage = readdirSync(join(ROOT, 'components/stage')).filter((f) => f.endsWith('.tsx') && !f.includes('.test.'))
  const fontes = [ler('App.tsx'), ler('components/SeparatorStudio.tsx'), ...stage.map((f) => ler(`components/stage/${f}`))].join('\n')

  /** Todo nome que aparece num data-tour: data-tour="x" ou data-tour={... 'x' ...}. */
  const donos = new Set<string>()
  for (const m of fontes.matchAll(/data-tour=(?:"([\w-]+)"|\{([^}]*)\})/g)) {
    if (m[1]) donos.add(m[1])
    for (const q of (m[2] ?? '').matchAll(/'([\w-]+)'/g)) donos.add(q[1])
  }

  it.each(['App.tsx', 'components/SeparatorStudio.tsx'])('todo alvo do tour em %s tem um data-tour com o nome dele', (arquivo) => {
    const alvos = [...ler(arquivo).matchAll(/\btarget: '([\w-]+)'/g)].map((m) => m[1])
    expect(alvos.length).toBeGreaterThan(0)
    expect(alvos.filter((a) => !donos.has(a))).toEqual([])
  })
})

describe('Tour: linguagem do palco', () => {
  it('só classes da linguagem nova, com o balão no alvo e no meio', () => {
    abrir()
    expect(oldLanguageClasses(document.body)).toEqual([])
    fireEvent.click(screen.getByRole('button', { name: 'Próximo' }))
    expect(oldLanguageClasses(document.body)).toEqual([])
  })
})

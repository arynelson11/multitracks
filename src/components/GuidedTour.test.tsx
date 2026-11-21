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

// Revisão macro BC (BC3-7): cada tour acha o alvo no palco em que roda. O tour do palco antigo
// (TOUR_STEPS) usa os data-tour do App.tsx; o do palco novo (TOUR_STEPS_NEW_STAGE, feito do antigo
// pelas regras do flatMap) usa os das peças em stage/; o do Separador, os do SeparatorStudio.
describe('Tour: os alvos', () => {
  const ROOT = resolve(process.cwd(), 'src')
  const ler = (rel: string) => readFileSync(join(ROOT, rel), 'utf8')
  const stageFiles = readdirSync(join(ROOT, 'components/stage')).filter((f) => f.endsWith('.tsx') && !f.includes('.test.'))
  const APP = ler('App.tsx')

  /** Todo nome que aparece num data-tour: data-tour="x" ou data-tour={... 'x' ...}. */
  function donos(fonte: string): Set<string> {
    const out = new Set<string>()
    for (const m of fonte.matchAll(/data-tour=(?:"([\w-]+)"|\{([^}]*)\})/g)) {
      if (m[1]) out.add(m[1])
      for (const q of (m[2] ?? '').matchAll(/'([\w-]+)'/g)) out.add(q[1])
    }
    return out
  }
  /** Os alvos de um array de passos escrito no código (`const NOME: TourStep[] = [ ... ]`). */
  function alvosDe(fonte: string, nome: string): string[] {
    const inicio = fonte.indexOf(`const ${nome}: TourStep[] = [`)
    expect(inicio, `achei o ${nome}`).toBeGreaterThanOrEqual(0)
    const fim = fonte.indexOf('\n]', inicio)
    return [...fonte.slice(inicio, fim).matchAll(/\btarget: '([\w-]+)'/g)].map((m) => m[1])
  }

  const antigo = alvosDe(APP, 'TOUR_STEPS')
  const secoesNovo = alvosDe(APP, 'NEW_STAGE_SECTION_STEPS')
  /** O tour do palco novo, aplicando as regras do flatMap do App.tsx (`if (step.target === 'x') return ...`). */
  function alvosDoNovo(): string[] {
    const inicio = APP.indexOf('const TOUR_STEPS_NEW_STAGE: TourStep[] = TOUR_STEPS.flatMap(')
    expect(inicio, 'achei o TOUR_STEPS_NEW_STAGE').toBeGreaterThanOrEqual(0)
    const bloco = APP.slice(inicio, APP.indexOf('\n})', inicio))
    const regras = new Map<string, string[]>()
    for (const m of bloco.matchAll(/if \(step\.target === '([\w-]+)'\) return (.*)$/gm)) {
      const [, alvo, volta] = m
      if (volta.includes('NEW_STAGE_SECTION_STEPS')) regras.set(alvo, secoesNovo)
      else if (volta.trim() === '[]') regras.set(alvo, [])
      else if (/\[\{ \.\.\.step\b/.test(volta)) regras.set(alvo, [alvo])
      else {
        const troca = /\btarget: '([\w-]+)'/.exec(volta)
        expect(troca, `regra de ${alvo} sem alvo conhecido`).not.toBeNull()
        regras.set(alvo, [troca![1]])
      }
    }
    // Se o flatMap mudar de forma, o teste avisa em vez de passar sem conferir.
    expect([...regras.keys()].sort()).toEqual(['anotacoes', 'config', 'editar', 'secoes', 'setlist-area'])
    return antigo.flatMap((a) => regras.get(a) ?? [a])
  }

  it('o tour do palco antigo acha cada alvo no App.tsx', () => {
    expect(antigo.length).toBeGreaterThan(0)
    const app = donos(APP)
    expect(antigo.filter((a) => !app.has(a))).toEqual([])
  })

  it('o tour do palco novo acha cada alvo nas peças do palco (stage/*.tsx)', () => {
    const novo = alvosDoNovo()
    expect(novo).toContain('repertorios')
    expect(novo).not.toContain('setlist-area')
    expect(novo).not.toContain('anotacoes')
    const stage = donos(stageFiles.map((f) => ler(`components/stage/${f}`)).join('\n'))
    expect(novo.filter((a) => !stage.has(a))).toEqual([])
  })

  it('o tour do Separador acha cada alvo no SeparatorStudio', () => {
    const sep = ler('components/SeparatorStudio.tsx')
    // Parte 3 (faixa D): as telas do Separador viraram vistas em components/separator/.
    const vistas = readdirSync(join(ROOT, 'components/separator')).filter((f) => f.endsWith('.tsx') && !f.includes('.test.'))
    const alvos = alvosDe(sep, 'SEP_TOUR_STEPS')
    expect(alvos.length).toBeGreaterThan(0)
    const d = donos([sep, ...vistas.map((f) => ler(`components/separator/${f}`))].join('\n'))
    expect(alvos.filter((a) => !d.has(a))).toEqual([])
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

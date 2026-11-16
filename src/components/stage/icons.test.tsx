// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { Icon } from './icons'
import { ICON_NAMES } from './iconNames'

afterEach(cleanup)

const svgOf = (container: HTMLElement) => container.querySelector('svg')!

describe('ícones do palco', () => {
  it('lista fechada de 26 nomes, sem repetir', () => {
    expect(ICON_NAMES).toEqual([
      'mark', 'pause', 'start', 'prev', 'next', 'loop', 'metro', 'sliders', 'count', 'chl', 'chr', 'chd', 'x', 'inf',
      'pad', 'lyrics', 'edit', 'cloud', 'home', 'out', 'rev', 'trash', 'grip', 'plus', 'minus', 'check',
    ])
    expect(new Set(ICON_NAMES).size).toBe(ICON_NAMES.length)
  })
  it('todo ícone é SVG escondido do leitor de tela e sem texto', () => {
    for (const name of ICON_NAMES) {
      const { container } = render(<Icon name={name} />)
      expect(container.querySelector('svg')!.getAttribute('aria-hidden')).toBe('true')
      expect(container.textContent).toBe('')
      cleanup()
    }
  })
  it('traço do mockup: currentColor, espessura 2, pontas redondas, sem foco e sem <use>', () => {
    for (const name of ICON_NAMES) {
      const { container } = render(<Icon name={name} />)
      const svg = svgOf(container)
      expect(svg.getAttribute('focusable')).toBe('false')
      expect(svg.getAttribute('stroke')).toBe('currentColor')
      expect(svg.getAttribute('stroke-width')).toBe('2')
      expect(svg.getAttribute('stroke-linecap')).toBe('round')
      expect(svg.getAttribute('stroke-linejoin')).toBe('round')
      expect(svg.getAttribute('fill')).toBe('none')
      expect(svg.querySelector('use')).toBeNull()
      expect(svg.children.length).toBeGreaterThan(0)
      cleanup()
    }
  })
  it('cada nome tem desenho próprio', () => {
    const drawings = ICON_NAMES.map((name) => {
      const { container } = render(<Icon name={name} />)
      const html = svgOf(container).innerHTML
      cleanup()
      return html
    })
    expect(new Set(drawings).size).toBe(ICON_NAMES.length)
  })
  it('caixa de 24 em todos, menos a marca (caixa do mockup)', () => {
    for (const name of ICON_NAMES) {
      const { container } = render(<Icon name={name} />)
      expect(svgOf(container).getAttribute('viewBox')).toBe(name === 'mark' ? '10 10 44 44' : '0 0 24 24')
      cleanup()
    }
  })
  it('a classe de quem chama entra junto, sem perder o encolhimento travado', () => {
    const { container } = render(<Icon name="loop" className="size-4 text-ps-or" />)
    const cls = svgOf(container).getAttribute('class')!.split(' ')
    expect(cls).toEqual(expect.arrayContaining(['shrink-0', 'size-4', 'text-ps-or']))
  })
})

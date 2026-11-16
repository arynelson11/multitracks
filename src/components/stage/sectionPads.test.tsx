// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { SECTION_SHORTCUTS } from '../SectionBar'
import { FAMILY_COLOR } from '../../lib/channelNames'
import type { StageGates, StageSection, TransitionView } from '../../lib/stageContracts'
import { SectionPads } from './SectionPads'
import type { SectionPadsProps } from './SectionPads'
import { padMeta, padProgress, padTag } from './sectionPadMeta'

const TRAVESSAO = String.fromCharCode(0x2014)
const PROIBIDAS = /\b(next|play|cancel|start|repeat|section|edit|settings|upgrade)\b/i

// requestAnimationFrame falso: guarda os pedidos e solta um quadro por vez.
let pending = new Map<number, FrameRequestCallback>()
let nextId = 1
const frame = (t = 16) => {
  const due = [...pending.values()]
  pending = new Map()
  for (const cb of due) cb(t)
}

beforeEach(() => {
  pending = new Map()
  nextId = 1
  heard = 0
  position = 0
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    const id = nextId++
    pending.set(id, cb)
    return id
  })
  vi.stubGlobal('cancelAnimationFrame', (id: number) => { pending.delete(id) })
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

// 120 BPM em 4/4: um compasso = 2 s.
const SECTIONS: StageSection[] = [
  { index: 0, label: 'Intro', color: '#3b82f6', start: 0, end: 8, bars: 4 },
  { index: 1, label: 'Verso', color: '#10b981', start: 8, end: 22, bars: 7 },
  { index: 2, label: 'Refrão', color: '#FF6B35', start: 22, end: 38, bars: 8 },
  { index: 3, label: 'Ponte', color: '#8b5cf6', start: 38, end: 65.9, bars: 14 },
  { index: 4, label: 'Final', color: '#ec4899', start: 65.9, end: 80, bars: null },
]
// Pulo armado do Verso pro Refrão, contagem de 4 no último compasso (passo 0,5 s), troca em 22 s.
const T: TransitionView = {
  from: 1, to: 2, kind: 'proxima', plays: 1, switchAt: 22, countTimes: [20, 20.5, 21, 21.5], countLabels: [1, 2, 3, 4],
  countTotal: 4, barsLeft: 1, committed: true, clickAudible: true, hasGrid: true,
}
const REPETE3: TransitionView = { ...T, to: 1, kind: 'repete', plays: 3 }
const SELF_LOOP: TransitionView = { ...T, to: 1, kind: 'repete', plays: 'infinite', countTimes: [], countLabels: [], barsLeft: 3 }
const NO_GRID: TransitionView = { ...T, hasGrid: false, switchAt: 22, countTimes: [], countLabels: [], countTotal: 0, barsLeft: null }

const GATES: StageGates = { sections: true, infinite: true, maxRepeats: 9, bandSections: true }
const LIVRE: StageGates = { sections: false, infinite: false, maxRepeats: 4, bandSections: false }

let heard = 0
let position = 0
const clock = { heardNow: () => heard, position: () => position }

const props = (patch: Partial<SectionPadsProps> = {}): SectionPadsProps => ({
  sections: SECTIONS, currentSection: 1, intent: null, transition: null, isPlaying: true, landed: null, gates: GATES,
  clock, onTap: () => {}, onUpgrade: () => {}, ...patch,
})
const renderPads = (patch: Partial<SectionPadsProps> = {}) => render(<SectionPads {...props(patch)} />)
const pads = () => [...document.querySelectorAll('[data-section-pad]')] as HTMLButtonElement[]
const pad = (i: number) => document.querySelector(`[data-section-pad="${i}"]`) as HTMLButtonElement
const part = (i: number, name: string) => pad(i).querySelector(`[data-${name}]`) as HTMLElement | null

describe('meta de cada botão (padMeta)', () => {
  type Ctx = Parameters<typeof padMeta>[2]
  const ctx = (patch: Partial<Ctx> = {}): Ctx => ({ current: 1, position: 12.5, transition: null, heardNow: 10, ...patch })
  const cases: [string, StageSection, Ctx, string][] = [
    ['outra seção mostra o início', SECTIONS[2], ctx(), '0:22'],
    ['início depois de um minuto, sem arredondar pra cima', SECTIONS[4], ctx(), '1:05'],
    ['atual com compassos: compasso dentro da seção', SECTIONS[1], ctx(), 'comp. 3/7'],
    ['atual no fim fica presa no último compasso', SECTIONS[1], ctx({ position: 22 }), 'comp. 7/7'],
    ['atual antes do início fica no primeiro compasso', SECTIONS[1], ctx({ position: 7.9 }), 'comp. 1/7'],
    ['atual sem compassos: tempo dentro da seção e duração dela', SECTIONS[4], ctx({ current: 4, position: 78 }), '0:12/0:14'],
    ['armada esperando', SECTIONS[2], ctx({ transition: { ...T, barsLeft: 3 } }), 'em 3 comp.'],
    ['armada no último compasso, antes do primeiro bipe', SECTIONS[2], ctx({ transition: T, heardNow: 19.9 }), 'contagem'],
    ['armada contando', SECTIONS[2], ctx({ transition: T, heardNow: 20.6 }), 'contagem'],
    ['armada sem grade', SECTIONS[2], ctx({ transition: NO_GRID }), 'no fim da seção'],
    ['click desligado não muda a espera da botoeira (o alerta fica no aviso PRÓXIMA)', SECTIONS[2], ctx({ transition: { ...T, barsLeft: 3, clickAudible: false } }), 'em 3 comp.'],
    ['depois do 1 ouvido a armada já mostra o compasso dela', SECTIONS[2], ctx({ transition: T, heardNow: 22.01, position: 22.01 }), 'comp. 1/8'],
    ['REPETE na atual: a espera vence o compasso', SECTIONS[1], ctx({ transition: { ...REPETE3, barsLeft: 2 } }), 'em 2 comp.'],
    ['loop da própria seção não tem pulo pra esperar: mostra o compasso', SECTIONS[1], ctx({ transition: SELF_LOOP }), 'comp. 3/7'],
    ['outra seção com pulo armado pra outra', SECTIONS[3], ctx({ transition: T }), '0:38'],
  ]
  it.each(cases)('meta %s', (_, sec, c, text) => expect(padMeta(sec, sec.index, c)).toBe(text))

  it('progresso da seção entre 0 e 1, preso nas pontas', () => {
    expect(padProgress(SECTIONS[1], 15)).toBeCloseTo(0.5)
    expect(padProgress(SECTIONS[1], 2)).toBe(0)
    expect(padProgress(SECTIONS[1], 99)).toBe(1)
    expect(padProgress({ ...SECTIONS[1], end: 8 }, 8)).toBe(0)
    expect(padProgress(SECTIONS[1], Number.NaN)).toBe(0)
  })

  it('etiqueta: AGORA na atual (com loop no loop infinito dela), PRÓXIMA, REPETE e REPETE Nx no alvo', () => {
    expect(padTag(null, 1, 1)).toEqual({ kind: 'agora', text: 'AGORA', loop: false })
    expect(padTag(null, 2, 1)).toBeNull()
    expect(padTag({ target: 2, plays: 1 }, 2, 1)).toEqual({ kind: 'proxima', text: 'PRÓXIMA', loop: false })
    expect(padTag({ target: 1, plays: 1 }, 1, 1)).toEqual({ kind: 'repete', text: 'REPETE', loop: false })
    expect(padTag({ target: 1, plays: 3 }, 1, 1)).toEqual({ kind: 'repete', text: 'REPETE 3x', loop: false })
    expect(padTag({ target: 1, plays: 'infinite' }, 1, 1)).toEqual({ kind: 'agora', text: 'AGORA', loop: true })
    expect(padTag({ target: 2, plays: 'infinite' }, 2, 1)).toEqual({ kind: 'proxima', text: 'PRÓXIMA', loop: false })
  })
})

describe('botoeira de seções', () => {
  it('um botão por seção com tecla até 9', () => {
    const doze = Array.from({ length: 12 }, (_, i): StageSection => ({ index: i, label: `S${i + 1}`, color: '#10b981', start: i * 8, end: i * 8 + 8, bars: 4 }))
    renderPads({ sections: doze, currentSection: 0 })
    expect(pads()).toHaveLength(12)
    for (let i = 0; i < 12; i++) {
      const kbd = part(i, 'pad-key')
      if (i < 9) {
        expect(kbd?.textContent).toBe(String(i + 1))
        expect(pad(i).getAttribute('aria-keyshortcuts')).toBe(String(i + 1))
      } else {
        expect(kbd).toBeNull()
        expect(pad(i).getAttribute('aria-keyshortcuts')).toBeNull()
      }
      expect(pad(i).tagName).toBe('BUTTON')
      expect(pad(i).getAttribute('type')).toBe('button')
    }
  })

  it('tocar chama onTap com o índice da seção, tocando e parado', () => {
    const onTap = vi.fn()
    renderPads({ onTap })
    fireEvent.click(pad(2))
    expect(onTap).toHaveBeenLastCalledWith(2)
    cleanup()
    renderPads({ onTap, isPlaying: false })
    fireEvent.click(pad(0))
    expect(onTap).toHaveBeenLastCalledWith(0)
    expect(onTap).toHaveBeenCalledTimes(2)
  })

  it('AGORA na cor da seção na atual; PRÓXIMA branca e aria-pressed só na armada', () => {
    renderPads({ intent: { target: 2, plays: 1 }, transition: T })
    expect(part(1, 'pad-tag')?.textContent).toBe('AGORA')
    expect(part(1, 'pad-tag')?.className).toContain('bg-(--ps-c)')
    expect(pad(1).style.getPropertyValue('--ps-c')).toBe('#10b981')
    expect(pad(1).dataset.state).toBe('atual')
    expect(part(2, 'pad-tag')?.textContent).toBe('PRÓXIMA')
    expect(part(2, 'pad-tag')?.className).toContain('bg-ps-arm')
    expect(pad(2).dataset.state).toBe('armada')
    expect(pads().map((b) => b.getAttribute('aria-pressed'))).toEqual(['false', 'false', 'true', 'false', 'false'])
    for (const i of [0, 3, 4]) expect(part(i, 'pad-tag')).toBeNull()
  })

  it('armada mostra REPETE 3x e o número da contagem', () => {
    heard = 20.6 // segundo bipe ouvido
    position = 20.6
    renderPads({ intent: { target: 1, plays: 3 }, transition: REPETE3 })
    expect(part(1, 'pad-tag')?.textContent).toBe('REPETE 3x') // REPETE no lugar do AGORA
    expect(pad(1).querySelectorAll('[data-pad-tag]')).toHaveLength(1)
    expect(pad(1).dataset.state).toBe('repete')
    expect(pad(1).getAttribute('aria-pressed')).toBe('true')
    expect(part(1, 'pad-big')?.textContent).toBe('2')
    expect(part(1, 'pad-big')?.getAttribute('aria-hidden')).toBe('true')
    expect(part(1, 'pad-meta')?.textContent).toBe('contagem')
    heard = 21.6
    frame()
    expect(part(1, 'pad-big')?.textContent).toBe('4')
    // No "1" ouvido a contagem acabou: número apaga e a meta volta pro compasso.
    heard = 22.01
    position = 8.01
    frame()
    expect(part(1, 'pad-big')?.textContent).toBe('')
    expect(part(1, 'pad-meta')?.textContent).toBe('comp. 1/7')
  })

  it('número da contagem só na armada e só com a conta do mesmo alvo', () => {
    heard = 20.6
    renderPads({ intent: { target: 2, plays: 1 }, transition: T })
    expect(part(2, 'pad-big')?.textContent).toBe('2')
    for (const i of [0, 1, 3, 4]) expect(part(i, 'pad-big')).toBeNull()
    cleanup()
    // Alvo trocado e a conta do motor ainda do alvo antigo: nada de número nem espera velha.
    renderPads({ intent: { target: 3, plays: 1 }, transition: T })
    expect(part(3, 'pad-big')?.textContent).toBe('')
    expect(part(3, 'pad-meta')?.textContent).toBe('0:38')
    expect(part(2, 'pad-meta')?.textContent).toBe('0:22')
  })

  it('loop da própria seção: AGORA com o ícone de loop, sem o listrado do armado', () => {
    renderPads({ intent: { target: 1, plays: 'infinite' }, transition: SELF_LOOP })
    const tag = part(1, 'pad-tag') as HTMLElement
    expect(tag.textContent).toBe('AGORA')
    expect(tag.querySelector('svg')).not.toBeNull()
    expect(pad(1).dataset.state).toBe('loop')
    expect(pad(1).className).not.toContain('repeating-linear-gradient')
    expect(pad(1).getAttribute('aria-pressed')).toBe('true') // tocar de novo desliga o loop
    expect(pad(1).getAttribute('aria-label')).toContain('em loop')
    expect(part(1, 'pad-big')).toBeNull()
  })

  it('armado com listras de color-mix do --color-ps-arm, borda fixa e as animações da T1', () => {
    renderPads({ intent: { target: 2, plays: 1 }, transition: T })
    const c = pad(2).className
    expect(c).toContain('bg-[image:repeating-linear-gradient(-45deg,color-mix(in_srgb,var(--color-ps-arm)')
    expect(c).toContain('animate-[var(--animate-ps-stripes),var(--animate-ps-armglow)]')
    // Borda branca própria: com movimento reduzido as animações param e ela fica.
    expect(c).toMatch(/(^|\s)inset-ring-2(\s|$)/)
    expect(c).toContain('inset-ring-ps-arm')
    expect(pad(1).className).not.toContain('animate-[')
  })

  it('brilho de pousou na seção que pousou, de novo a cada pouso', () => {
    const { rerender } = renderPads({ landed: { index: 2, at: 22 }, currentSection: 2 })
    const glow = part(2, 'pad-land') as HTMLElement
    expect(glow.className).toContain('animate-ps-land')
    expect(pad(2).style.getPropertyValue('--ps-c')).toBe('#FF6B35') // ps-land lê a cor da seção em --ps-c
    for (const i of [0, 1, 3, 4]) expect(part(i, 'pad-land')).toBeNull()
    rerender(<SectionPads {...props({ landed: { index: 2, at: 38 }, currentSection: 2 })} />)
    expect(part(2, 'pad-land')).not.toBe(glow) // camada nova: a animação recomeça
  })

  it('progresso e meta da atual saem do relógio a cada quadro', () => {
    position = 12.5
    renderPads()
    const fill = part(1, 'pad-fill') as HTMLElement
    expect(fill.style.transform).toBe('scaleX(0.321)')
    expect(part(1, 'pad-meta')?.textContent).toBe('comp. 3/7')
    position = 19
    frame()
    expect(fill.style.transform).toBe('scaleX(0.786)')
    expect(part(1, 'pad-meta')?.textContent).toBe('comp. 6/7')
    for (const i of [0, 2, 3, 4]) expect(part(i, 'pad-fill')).toBeNull()
    expect(part(2, 'pad-meta')?.textContent).toBe('0:22')
  })

  it('Livre mostra o convite e abre o upgrade', () => {
    const onUpgrade = vi.fn()
    const onTap = vi.fn()
    const { container } = renderPads({ gates: LIVRE, onUpgrade, onTap })
    expect(pads()).toHaveLength(0)
    expect(container.textContent).toContain('Marque as seções da música e troque de parte ao vivo sem parar a VS.')
    fireEvent.click(screen.getByRole('button', { name: 'Conhecer os planos' }))
    expect(onUpgrade).toHaveBeenCalledTimes(1)
    expect(onTap).not.toHaveBeenCalled()
    expect(container.querySelector('[data-tour="secoes"]')).not.toBeNull()
  })

  it('pago sem seções: aviso pra marcar no EDITAR', () => {
    const { container } = renderPads({ sections: [], currentSection: -1 })
    expect(pads()).toHaveLength(0)
    expect(container.textContent).toContain('Esta música ainda não tem seções. Marque no EDITAR.')
    expect(container.querySelectorAll('button')).toHaveLength(0)
    expect(container.querySelector('[data-tour="secoes"]')).not.toBeNull()
  })

  it('ponto do tour e nome do grupo no contêiner', () => {
    const { container } = renderPads()
    const group = container.querySelector('[data-tour="secoes"]') as HTMLElement
    expect(group.getAttribute('role')).toBe('group')
    expect(group.getAttribute('aria-label')).toBe('Seções da música')
    expect(group.contains(pad(0))).toBe(true)
  })

  it('nome longo nunca é cortado', () => {
    // O jsdom não mede: a altura do nome vem de uma régua falsa (8 caracteres por linha a 16 px, 12 a 14 px).
    const desc = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight')
    Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
      configurable: true,
      get(this: HTMLElement) {
        if (!this.hasAttribute('data-pad-name')) return 0
        const small = this.dataset.fit === 'small'
        return Math.ceil((this.textContent ?? '').length / (small ? 12 : 8)) * (small ? 14 : 16) * 1.1
      },
    })
    try {
      const longos = [{ ...SECTIONS[0], label: 'Pré-Refrão 2' }, { ...SECTIONS[1], label: 'Ponte Instrumental Final' }]
      renderPads({ sections: longos, currentSection: 0 })
      for (const i of [0, 1]) {
        const name = part(i, 'pad-name') as HTMLElement
        expect(name.className).not.toMatch(/truncate|text-ellipsis|line-clamp|whitespace-nowrap|overflow-hidden|overflow-clip/)
        expect(name.className).toContain('break-words')
        expect(name.className).toContain('text-ps-md')
        expect(name.className).toContain('data-[fit=small]:text-[14px]')
      }
      expect(part(0, 'pad-name')?.textContent).toBe('Pré-Refrão 2')
      expect(part(0, 'pad-name')?.dataset.fit).toBeUndefined() // 2 linhas a 16 px: fica
      expect(part(1, 'pad-name')?.dataset.fit).toBe('small') // 3 linhas a 16 px: desce pra 14 px
      expect(part(1, 'pad-name')?.textContent).toBe('Ponte Instrumental Final')
    } finally {
      if (desc) Object.defineProperty(HTMLElement.prototype, 'offsetHeight', desc)
    }
  })

  it('tecla some quando a etiqueta não cabe ao lado dela (nunca uma por cima da outra)', () => {
    // Régua falsa: tecla de 18 px no começo; etiqueta de 77 px encostada à direita de um botão de largura variável.
    let inner = 200
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
      if (this.hasAttribute('data-pad-key')) return new DOMRect(18, 6, 18, 18)
      if (this.hasAttribute('data-pad-tag')) return new DOMRect(18 + inner - 77, 6, 77, 18)
      return new DOMRect(0, 0, 0, 0)
    })
    const { rerender } = renderPads({ intent: { target: 1, plays: 9 }, transition: REPETE3 })
    expect(pad(1).dataset.tight).toBe('false')
    inner = 96 // 18 + 4 + 77 = 99 > 96
    rerender(<SectionPads {...props({ intent: { target: 1, plays: 9 }, transition: { ...REPETE3, plays: 9 } })} />)
    expect(pad(1).dataset.tight).toBe('true')
    expect(part(1, 'pad-key')?.className).toContain('group-data-[tight=true]:hidden')
    // Sem etiqueta a tecla sempre aparece.
    expect(pad(3).dataset.tight).toBe('false')
  })

  it('a botoeira rola de lado e mantém a AGORA à vista', () => {
    const doze = Array.from({ length: 12 }, (_, i): StageSection => ({ index: i, label: `S${i + 1}`, color: '#10b981', start: i * 8, end: i * 8 + 8, bars: 4 }))
    // Régua falsa: botões de 104 px com 8 px entre eles, depois de 16 px de margem; janela de 400 px.
    const leftOf = (el: HTMLElement) => 16 + Number(el.dataset.sectionPad) * 112
    vi.spyOn(HTMLElement.prototype, 'offsetLeft', 'get').mockImplementation(function (this: HTMLElement) {
      return this.hasAttribute('data-section-pad') ? leftOf(this) : 0
    })
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockImplementation(function (this: HTMLElement) {
      return this.hasAttribute('data-section-pad') ? 104 : 0
    })
    vi.spyOn(Element.prototype, 'clientWidth', 'get').mockImplementation(function (this: Element) {
      return this.hasAttribute('data-tour') ? 400 : 0
    })
    const { rerender } = renderPads({ sections: doze, currentSection: 0 })
    const group = document.querySelector('[data-tour="secoes"]') as HTMLElement
    expect(group.className).toContain('overflow-x-auto')
    expect(group.scrollLeft).toBe(0)
    rerender(<SectionPads {...props({ sections: doze, currentSection: 9 })} />)
    // AGORA (S10) vai de 1024 a 1128: rola até ela caber inteira com a margem de 16 px.
    expect(group.scrollLeft).toBe(16 + 9 * 112 + 104 + 16 - 400)
    rerender(<SectionPads {...props({ sections: doze, currentSection: 2 })} />)
    expect(group.scrollLeft).toBe(16 + 2 * 112 - 16)
  })

  it('largura mínima de 104 px, largura pelo texto e altura de toque', () => {
    const { container } = renderPads({ intent: { target: 2, plays: 1 }, transition: T })
    const FIXED_WIDTH = /(^|\s)w-(?!auto(\s|$)|full(\s|$))/
    for (const b of pads()) {
      expect(b.className).toContain('min-w-[104px]')
      expect(b.className).not.toMatch(FIXED_WIDTH)
      expect(b.className).toContain('min-h-[clamp(64px,8vh,82px)]')
    }
    // Colunas iguais quando cabe; quando não cabe, cada botão fica com o que o texto pede e a fileira rola.
    expect((container.querySelector('[data-tour="secoes"]') as HTMLElement).className).toContain('auto-cols-[minmax(min-content,1fr)]')
  })

  it('sem palavra proibida em inglês e sem travessão', () => {
    heard = 20.6
    const { container } = renderPads({ intent: { target: 1, plays: 3 }, transition: REPETE3, isPlaying: true })
    const textos = [container.textContent ?? '']
    for (const playing of [true, false]) {
      cleanup()
      const r = renderPads({ intent: { target: 2, plays: 1 }, transition: { ...T, hasGrid: false }, isPlaying: playing })
      textos.push(r.container.textContent ?? '')
      for (const el of r.container.querySelectorAll('[aria-label],[title]')) {
        for (const attr of ['aria-label', 'title']) textos.push(el.getAttribute(attr) ?? '')
      }
    }
    cleanup()
    const livre = renderPads({ gates: LIVRE })
    textos.push(livre.container.textContent ?? '')
    cleanup()
    textos.push(renderPads({ sections: [] }).container.textContent ?? '')
    for (const t of textos) {
      expect(t).not.toContain(TRAVESSAO)
      expect(t).not.toMatch(PROIBIDAS)
    }
  })

  it('dicas dizem o que o toque faz: armar tocando, ir pro início parado, cancelar na armada', () => {
    renderPads({ intent: { target: 2, plays: 1 }, transition: T })
    expect(pad(3).title).toBe('Armar Ponte (tecla 4). Toque de novo pra cancelar.')
    expect(pad(2).title).toBe('Cancelar o pulo pra Refrão (tecla 3)')
    expect(pad(1).title).toBe('Repetir Verso (tecla 2)')
    expect(pad(2).getAttribute('aria-label')).toBe('Refrão, próxima')
    expect(pad(1).getAttribute('aria-label')).toBe('Verso, agora')
    cleanup()
    renderPads({ isPlaying: false })
    expect(pad(3).title).toBe('Ir pro início de Ponte (tecla 4)')
  })
})

describe('cores (Ruling T21)', () => {
  it('cor de família de canal não repete cor de seção', () => {
    const secoes = SECTION_SHORTCUTS.map((s) => s.color.toLowerCase())
    for (const cor of Object.values(FAMILY_COLOR)) expect(secoes).not.toContain(cor.toLowerCase())
  })
})

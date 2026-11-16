// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { SECTION_SHORTCUTS } from '../SectionBar'
import { FAMILY_COLOR } from '../../lib/channelNames'
import type { StageGates, StageSection, TransitionView } from '../../lib/stageContracts'
import { SectionPads } from './SectionPads'
import type { SectionPadsProps } from './SectionPads'
import { padMeta, padProgress, padReserve, padTag } from './sectionPadMeta'

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
const scroller = () => document.querySelector('[data-pads-scroller]') as HTMLElement
const before = () => document.querySelector('[data-pads-more="antes"]') as HTMLButtonElement | null
const after = () => document.querySelector('[data-pads-more="depois"]') as HTMLButtonElement | null

// Régua falsa (o jsdom não mede): largura útil da fileira e o que cada botão pede na largura livre.
function ruler(track: number, need: (pad: HTMLElement) => number = () => 104) {
  const widthCalls = { n: 0 }
  vi.spyOn(Element.prototype, 'clientWidth', 'get').mockImplementation(function (this: Element) {
    return this.hasAttribute('data-pads-track') ? track : 0
  })
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockImplementation(function (this: HTMLElement) {
    if (!this.hasAttribute('data-section-pad')) return 0
    widthCalls.n++
    return need(this)
  })
  return widthCalls
}

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

  it('6/8 contado em tempos: o número segue o countState (1 e 2)', () => {
    const SEIS_OITO: TransitionView = { ...T, countTimes: [21, 21.5], countLabels: [1, 2], countTotal: 2 }
    heard = 21.1
    renderPads({ intent: { target: 2, plays: 1 }, transition: SEIS_OITO })
    expect(part(2, 'pad-big')?.textContent).toBe('1')
    heard = 21.6
    frame()
    expect(part(2, 'pad-big')?.textContent).toBe('2')
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

  it('nome que não cabe em 2 linhas nem a 14 px alarga a reserva só daquele botão, em vez de quebrar em 3', () => {
    // Régua falsa: 5 caracteres por linha a 16 px; a 14 px, um caractere a cada 10 px de largura além de 48 px.
    const desc = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight')
    Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
      configurable: true,
      get(this: HTMLElement) {
        if (!this.hasAttribute('data-pad-name')) return 0
        const pad = this.closest('[data-section-pad]') as HTMLElement
        const small = this.dataset.fit === 'small'
        const perLine = small ? Math.floor(((parseFloat(pad.style.width) || 104) - 48) / 10) : 5
        return Math.ceil((this.textContent ?? '').length / perLine) * (small ? 14 : 16) * 1.1
      },
    })
    try {
      ruler(300)
      renderPads({ sections: [{ ...SECTIONS[0], label: 'Verso Lento 12' }, SECTIONS[1]] })
      // 104 -> 112 (6 por linha, 3 linhas) -> 120 (7 por linha, 2 linhas); o vizinho curto fica nos 104 dele.
      expect(pad(0).style.width).toBe('120px')
      expect(pad(1).style.width).toBe('104px')
      expect(part(0, 'pad-name')?.dataset.fit).toBe('small')
      expect(part(1, 'pad-name')?.dataset.fit).toBeUndefined()
    } finally {
      if (desc) Object.defineProperty(HTMLElement.prototype, 'offsetHeight', desc)
    }
  })

  it('cada botão reserva o estado mais largo DELE (metas dele, REPETE 9x, LOOP e a tecla); "no fim da seção" só em música sem grade', () => {
    const longa = [SECTIONS[0], { ...SECTIONS[1], end: 248, bars: 120 }, { ...SECTIONS[2], start: 248, end: 264 }]
    renderPads({ sections: longa })
    for (const i of [0, 1, 2]) {
      const sizer = part(i, 'pad-sizer') as HTMLElement
      expect(sizer.getAttribute('aria-hidden')).toBe('true')
      expect(sizer.className).toContain('invisible')
      expect(sizer.className).toContain('h-0')
      const t = sizer.textContent ?? ''
      for (const w of ['contagem', 'em 999 comp.', 'REPETE 9x', 'PRÓXIMA', 'AGORA', 'no fim da seção']) expect(t).toContain(w)
      // A tecla entra na mesma linha da etiqueta reservada: ela nunca precisa sair.
      expect(sizer.querySelectorAll('kbd').length).toBeGreaterThan(0)
      expect(sizer.querySelector('svg')).not.toBeNull() // AGORA com o ícone de loop
    }
    // O compasso de cada um é o dele: só o Verso reserva "comp. 120/120".
    expect(part(1, 'pad-sizer')?.textContent).toContain('comp. 120/120')
    expect(part(0, 'pad-sizer')?.textContent).toContain('comp. 4/4')
    expect(part(0, 'pad-sizer')?.textContent).not.toContain('comp. 120/120')
    cleanup()
    // Com grade, o estado sem grade não entra.
    renderPads({ sections: longa, hasGrid: true })
    for (const i of [0, 1, 2]) expect(part(i, 'pad-sizer')?.textContent).not.toContain('no fim da seção')

    expect(padReserve(longa[0], longa, 9, true)).toEqual({ metas: ['0:00', 'comp. 4/4', 'em 999 comp.'], tags: ['PRÓXIMA', 'REPETE', 'REPETE 9x'] })
    expect(padReserve(longa[1], longa, 9, false).metas).toEqual(['0:08', 'comp. 120/120', 'em 999 comp.', 'no fim da seção'])
    // Seção sem compassos (Final, 14,1 s): o "m:ss/m:ss" dela.
    expect(padReserve(SECTIONS[4], SECTIONS, 9, true).metas).toEqual(['1:05', '0:14/0:14', 'em 99 comp.'])
    expect(padReserve(SECTIONS[0], SECTIONS, Infinity, true).tags).toEqual(['PRÓXIMA', 'REPETE', 'REPETE 99x'])
    expect(padReserve(SECTIONS[0], SECTIONS, 1, true).tags).toEqual(['PRÓXIMA', 'REPETE'])
  })

  it('armar, contar, pousar, REPETE e LOOP (com e sem grade, seção de 120 comp.) não mudam a largura de nenhum botão nem medem de novo', () => {
    const longa = SECTIONS.map((s, i) => (i === 3 ? { ...s, bars: 120 } : s))
    const calls = ruler(1000, (b) => (b.dataset.sectionPad === '3' ? 150 : 104))
    const { rerender } = renderPads({ sections: longa })
    const widths = () => pads().map((b) => b.style.width)
    const w0 = widths()
    expect(w0).toEqual(['104px', '104px', '104px', '150px', '104px']) // cada um com a dele, sem esticar
    const keys0 = pads().map((b) => b.querySelector('[data-pad-key]')?.className)
    calls.n = 0
    const SEIS_OITO: TransitionView = { ...T, countTimes: [21, 21.5], countLabels: [1, 2], countTotal: 2 }
    const passos: Array<[Partial<SectionPadsProps>, number]> = [
      [{ intent: { target: 2, plays: 1 }, transition: { ...T, barsLeft: 118 } }, 10],
      [{ intent: { target: 2, plays: 1 }, transition: T }, 20.6],
      [{ intent: { target: 2, plays: 1 }, transition: SEIS_OITO }, 21.6],
      [{ intent: { target: 2, plays: 1 }, transition: NO_GRID }, 10],
      [{ intent: { target: 1, plays: 9 }, transition: { ...REPETE3, plays: 9 } }, 20.6],
      [{ intent: { target: 1, plays: 1 }, transition: { ...NO_GRID, to: 1, kind: 'repete' } }, 10],
      [{ intent: { target: 1, plays: 'infinite' }, transition: { ...SELF_LOOP, hasGrid: false } }, 10],
      [{ currentSection: 2, landed: { index: 2, at: 22 } }, 22.1],
      [{ currentSection: 3 }, 60],
      [{ currentSection: 2, isPlaying: false }, 22.1],
    ]
    for (const [patch, h] of passos) {
      heard = h
      position = h
      rerender(<SectionPads {...props({ sections: longa, ...patch })} />)
      frame()
      expect(widths()).toEqual(w0)
      // A tecla fica nas 9 primeiras em todo estado.
      expect(pads().map((b) => b.querySelector('[data-pad-key]')?.className)).toEqual(keys0)
    }
    expect(calls.n).toBe(0) // trocar de estado nunca mede de novo
  })

  it('parado nunca mostra botão pela metade: a janela termina no último botão inteiro, encaixe obrigatório e indicadores nas pontas', () => {
    const doze = Array.from({ length: 12 }, (_, i): StageSection => ({ index: i, label: `S${i + 1}`, color: '#10b981', start: i * 8, end: i * 8 + 8, bars: 4 }))
    ruler(600)
    renderPads({ sections: doze, currentSection: 1 })
    // 600 - 2 x (52 + 8) = 480 de janela: 4 botões de 104 (440 px) e 40 px vazios; o 5º, que caberia pela metade, some.
    expect(pads().every((b) => b.style.width === '104px')).toBe(true)
    expect(scroller().style.width).toBe('480px')
    expect(scroller().className).toContain('snap-x')
    expect(scroller().className).toContain('snap-mandatory')
    expect(scroller().className).toContain('overflow-x-auto')
    for (const b of pads()) expect(b.className).toContain('snap-start')
    expect(pads().map((b) => b.dataset.out)).toEqual(['false', 'false', 'false', 'false', ...Array(8).fill('true')])
    for (const b of pads()) expect(b.className).toContain('data-[out=true]:invisible')
    // Folga no fim pra a última página começar num botão: 480 - 440 - 8.
    expect((document.querySelector('[data-pads-spacer]') as HTMLElement).style.width).toBe('32px')
    expect(scroller().scrollLeft).toBe(0)
    expect(before()?.disabled).toBe(true)
    expect(after()?.textContent).toBe('8')
    expect(after()?.getAttribute('aria-label')).toBe('Ver 8 seções depois')
    for (const b of [before(), after()]) expect(b?.className).toContain('min-w-[52px]')
    fireEvent.click(after() as HTMLButtonElement) // pagina pela quantidade visível
    expect(scroller().scrollLeft).toBe(4 * 112)
    expect(before()?.textContent).toBe('4')
    expect(after()?.textContent).toBe('4')
    fireEvent.click(after() as HTMLButtonElement)
    expect(scroller().scrollLeft).toBe(8 * 112)
    expect(after()?.disabled).toBe(true)
    expect(before()?.getAttribute('aria-label')).toBe('Ver 8 seções antes')
    fireEvent.click(before() as HTMLButtonElement)
    expect(scroller().scrollLeft).toBe(4 * 112)
    // Rolar à mão: a conta e o que aparece seguem o botão do começo da janela.
    scroller().scrollLeft = 5 * 112
    fireEvent.scroll(scroller())
    expect(before()?.textContent).toBe('5')
    expect(after()?.textContent).toBe('3')
    expect(pads().map((b) => b.dataset.out).join('')).toBe(['true', 'true', 'true', 'true', 'true', 'false', 'false', 'false', 'false', 'true', 'true', 'true'].join(''))
  })

  it('larguras diferentes: cada página começa num botão e termina no último que cabe inteiro', () => {
    const doze = Array.from({ length: 12 }, (_, i): StageSection => ({ index: i, label: `S${i + 1}`, color: '#10b981', start: i * 8, end: i * 8 + 8, bars: 4 }))
    // Botões de 104 px, menos o 3º (200) e o 6º (160): começos em 0, 112, 224, 432, 544, 656, 824, 936, 1048...
    ruler(600, (b) => (b.dataset.sectionPad === '2' ? 200 : b.dataset.sectionPad === '5' ? 160 : 104))
    renderPads({ sections: doze, currentSection: 0 })
    const out = () => pads().map((b) => (b.dataset.out === 'true' ? 0 : 1)).join('')
    expect(out()).toBe('111000000000') // 0 a 2 (424 px); o 3º começa em 432 e não cabe inteiro
    expect(after()?.textContent).toBe('9')
    fireEvent.click(after() as HTMLButtonElement)
    expect(scroller().scrollLeft).toBe(432)
    expect(out()).toBe('000111000000')
    expect(before()?.textContent).toBe('3')
    expect(after()?.textContent).toBe('6')
    fireEvent.click(after() as HTMLButtonElement)
    expect(scroller().scrollLeft).toBe(824)
    expect(out()).toBe('000000111100')
    fireEvent.click(after() as HTMLButtonElement) // última página: 8 a 11 (a 12ª termina a 440 px do começo)
    expect(scroller().scrollLeft).toBe(1048)
    expect(after()?.disabled).toBe(true)
    expect((document.querySelector('[data-pads-spacer]') as HTMLElement).style.width).toBe('32px')
    fireEvent.click(before() as HTMLButtonElement) // volta a página que termina logo antes do 8
    expect(scroller().scrollLeft).toBe(656)
    expect(out()).toBe('000001110000')
    expect(before()?.textContent).toBe('5')
    expect(after()?.textContent).toBe('4')
  })

  it('AGORA trazida pra vista já encaixada; o alvo armado também, quando cabe junto com ela', () => {
    const doze = Array.from({ length: 12 }, (_, i): StageSection => ({ index: i, label: `S${i + 1}`, color: '#10b981', start: i * 8, end: i * 8 + 8, bars: 4 }))
    ruler(600)
    const { rerender } = renderPads({ sections: doze, currentSection: 1 })
    expect(scroller().scrollLeft).toBe(0)
    rerender(<SectionPads {...props({ sections: doze, currentSection: 1, intent: { target: 4, plays: 1 } })} />)
    expect(scroller().scrollLeft).toBe(112) // S2 a S5: atual e alvo à vista
    rerender(<SectionPads {...props({ sections: doze, currentSection: 1, intent: { target: 8, plays: 1 } })} />)
    expect(scroller().scrollLeft).toBe(112) // alvo longe: a AGORA manda
    rerender(<SectionPads {...props({ sections: doze, currentSection: 9 })} />)
    expect(scroller().scrollLeft).toBe(6 * 112)
    expect(before()?.textContent).toBe('6')
    expect(after()?.textContent).toBe('2')
  })

  it('tudo cabe: sem indicadores, sem esticar e sem rolar (a sobra fica vazia à direita)', () => {
    ruler(1000)
    const { container } = renderPads()
    expect(before()).toBeNull()
    expect(after()).toBeNull()
    expect(pads().every((b) => b.style.width === '104px')).toBe(true)
    expect(pads().every((b) => b.dataset.out === 'false')).toBe(true)
    expect(container.querySelectorAll('button')).toHaveLength(5)
  })

  it('largura mínima de 104 px, largura pelo texto e altura de toque', () => {
    const { container } = renderPads({ intent: { target: 2, plays: 1 }, transition: T })
    const FIXED_WIDTH = /(^|\s)w-(?!auto(\s|$)|full(\s|$))/
    for (const b of pads()) {
      expect(b.className).toContain('min-w-[104px]')
      expect(b.className).not.toMatch(FIXED_WIDTH)
      expect(b.className).toContain('min-h-[clamp(64px,8vh,82px)]')
    }
    // Largura igual pra todos, vinda da reserva medida do texto (nunca uma classe de largura fixa).
    expect(container.querySelectorAll('[data-pad-sizer]')).toHaveLength(SECTIONS.length)
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

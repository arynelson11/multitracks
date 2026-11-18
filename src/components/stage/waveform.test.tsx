// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { ComponentProps } from 'react'
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { FAMILY_COLOR } from '../../lib/channelNames'
import type { StageSection } from '../../lib/stageContracts'
import { SECTION_SHORTCUTS } from '../SectionBar'
import { WaveformSections } from './WaveformSections'
import { arcPath, arcRise, computePeaks, INLINE_TAG_GAP, liftForRise, lighter, placeLabels } from './wavePeaks'
import type { LabelBox, LabelSpot } from './wavePeaks'

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
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    const id = nextId++
    pending.set(id, cb)
    return id
  })
  vi.stubGlobal('cancelAnimationFrame', (id: number) => { pending.delete(id) })
  // O jsdom não tem canvas: getContext nulo, como no teste do brief (e sem aviso no console).
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => null)
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

// Música de 100 s: os blocos ficam em % iguais aos segundos.
const SECTIONS: StageSection[] = [
  { index: 0, label: 'Intro', color: '#3b82f6', start: 0, end: 10, bars: 4 },
  { index: 1, label: 'Verso', color: '#10b981', start: 10, end: 25, bars: 8 },
  { index: 2, label: 'Refrão', color: '#FF6B35', start: 25, end: 50, bars: 16 },
  { index: 3, label: 'Ponte', color: '#8b5cf6', start: 50, end: 70, bars: 8 },
  { index: 4, label: 'Final', color: '#ec4899', start: 70, end: 100, bars: 8 },
]

let position = 0
const clock = { position: () => position }
type Props = ComponentProps<typeof WaveformSections>
const props = (o: Partial<Props> = {}): Props => ({
  peaks: null, duration: 100, sections: SECTIONS, currentSection: 1, isPlaying: true, intent: null, loopOn: false,
  barLines: null, sectionsAllowed: true, clock, onTapSection: vi.fn(), onSeek: vi.fn(), ...o,
})
const renderWave = (o: Partial<Props> = {}) => {
  const p = props(o)
  const r = render(<WaveformSections {...p} />)
  return { ...r, p, rerenderWith: (more: Partial<Props>) => r.rerender(<WaveformSections {...p} {...more} />) }
}
const blocks = (c: HTMLElement) => [...c.querySelectorAll<HTMLButtonElement>('[data-block]')]
const tagOf = (b: HTMLElement) => b.querySelector('[data-tag]')?.textContent ?? null
const regua = (c: HTMLElement) => c.querySelector<HTMLElement>('[data-testid="regua"]')!
const pointer = (el: HTMLElement, type: string, clientX: number) => fireEvent(el, new MouseEvent(type, { bubbles: true, clientX }))
const rect = (left: number, width: number) => ({ left, width, top: 0, height: 44, right: left + width, bottom: 44, x: left, y: 0, toJSON: () => ({}) }) as DOMRect

/** Tamanho falso da onda (o jsdom não faz layout): largura, altura e a largura de cada selo, etiqueta e rótulo da régua. */
function fakeLayout(w: number, h: number, widths: { selo: number; tag: number; ruler: number }) {
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(w)
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(h)
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    if (this.dataset.selo !== undefined) return rect(0, widths.selo)
    if (this.dataset.tag !== undefined) return rect(0, widths.tag)
    if (this.dataset.rulerLabel !== undefined) return rect(0, widths.ruler)
    return rect(0, 0)
  })
}

describe('wavePeaks', () => {
  it('picos normalizados', () => expect([...computePeaks(new Float32Array([0, 0.5, -1, 0.25]), 2)]).toEqual([0.5, 1]))

  it('vazio dá zeros e amostra que falta conta 0', () => {
    expect([...computePeaks(new Float32Array(0), 3)]).toEqual([0, 0, 0])
    expect([...computePeaks(new Float32Array([0.5]), 3)]).toEqual([1, 0, 0])
    expect(computePeaks(new Float32Array([1, 1]), 0).length).toBe(0)
  })

  it('mesma conta do computePeaks antigo do SectionBar (o palco antigo desenha igual)', () => {
    // Cópia do algoritmo que saiu do SectionBar.tsx (ele recebia o AudioBuffer e lia o canal 0).
    const old = (data: Float32Array, buckets: number): number[] => {
      const block = Math.floor(data.length / buckets) || 1
      const peaks: number[] = []
      let max = 0.0001
      for (let i = 0; i < buckets; i++) {
        let peak = 0
        const start = i * block
        for (let j = 0; j < block; j++) {
          const v = Math.abs(data[start + j] || 0)
          if (v > peak) peak = v
        }
        peaks.push(peak)
        if (peak > max) max = peak
      }
      return peaks.map((p) => p / max)
    }
    let seed = 7
    const data = Float32Array.from({ length: 48_017 }, () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647 * 1.6 - 0.8 })
    for (const buckets of [1100, 7, 50_000]) {
      const now = computePeaks(data, buckets)
      const before = old(data, buckets)
      expect(now.length).toBe(before.length)
      for (let i = 0; i < before.length; i++) expect(Math.abs(now[i] - before[i])).toBeLessThan(1e-6)
    }
  })

  it('seta: curva do v6 com subida de 24 + 22% da distância, no mínimo 26, até o teto', () => {
    expect(arcPath(100, 300, 100, 60)).toBe('M100.0 100.0 C100.0 40.0 300.0 40.0 300.0 93.0')
    expect(arcPath(300, 100, 100, 60)).toBe('M300.0 100.0 C300.0 40.0 100.0 40.0 100.0 93.0')
    expect(arcPath(100, 110, 100, 60)).toBe('M100.0 100.0 C100.0 73.8 110.0 73.8 110.0 93.0')
    expect(arcPath(100, 106, 100, 60)).toBe('') // perto demais: sem curva
  })

  it('seta achata abaixo de 26 quando o teto é menor (selo no caminho)', () => {
    expect(arcPath(0, 1000, 100, 10)).toBe('M0.0 100.0 C0.0 90.0 1000.0 90.0 1000.0 93.0')
    expect(arcPath(0, 1000, 100, -5)).toBe('M0.0 100.0 C0.0 100.0 1000.0 100.0 1000.0 93.0')
  })

  it('altura exata da curva acima da base e a subida que cabe numa altura', () => {
    // Curva: 3t(1-t) * subida + 7t³ (a ponta termina 7 px acima da base).
    const sampled = (lift: number) => Math.max(...Array.from({ length: 10_001 }, (_, i) => { const t = i / 10_000; return 3 * t * (1 - t) * lift + 7 * t ** 3 }))
    for (const lift of [0, 5, 7, 10, 26, 40, 120]) expect(arcRise(lift)).toBeCloseTo(sampled(lift), 3)
    expect(arcRise(26)).toBeCloseTo(20.49, 1)
    for (const rise of [7, 9, 13, 20, 60]) {
      const lift = liftForRise(rise)
      expect(arcRise(lift)).toBeLessThanOrEqual(rise + 1e-6)
      expect(arcRise(lift + 0.05)).toBeGreaterThan(rise)
    }
    expect(liftForRise(6.9)).toBe(0) // nem a ponta cabe: sem curva
    expect(liftForRise(Infinity)).toBe(Infinity) // nada no caminho: vale a subida do v6
  })

  it('parte tocada: cor da seção com 28% de branco', () => {
    expect(lighter('#3b82f6')).toBe('rgb(114,165,249)')
    expect(lighter('#FF6B35')).toBe('rgb(255,148,110)')
    expect(lighter('#0f0')).toBe('rgb(71,255,71)')
    expect(lighter('rgb(16, 185, 129)')).toBe('rgb(83,205,164)')
    expect(lighter('var(--x)')).toBe('var(--x)')
  })

  it('selos que se encostariam descem de linha; quem tem etiqueta vai primeiro', () => {
    const box = (x: number, width: number, o: Partial<LabelBox> = {}): LabelBox => ({ x, width, priority: 2, ...o })
    const rowsOf = (r: (LabelSpot | null)[]) => r.map((s) => (s ? s.row : null))
    expect(rowsOf(placeLabels([box(0, 100), box(200, 100)], 3, 8))).toEqual([0, 0])
    expect(rowsOf(placeLabels([box(0, 100), box(104, 100)], 3, 8))).toEqual([0, 1]) // 4 px de folga é pouco
    expect(rowsOf(placeLabels([box(0, 100), box(108, 100)], 3, 8))).toEqual([0, 0]) // 8 px de folga basta
    // A armada (etiqueta embaixo, 2 linhas) entra primeiro; a vizinha que encostaria nela desce pra 3ª linha.
    expect(placeLabels([box(0, 120), box(100, 120, { tagWidth: 60, priority: 0 })], 3, 8))
      .toEqual([{ row: 2, x: 0, inline: false }, { row: 0, x: 100, inline: false }])
    // A etiqueta embaixo ocupa a linha de baixo só na largura dela: a vizinha da direita cabe ali.
    expect(placeLabels([box(0, 120, { tagWidth: 60, priority: 0 }), box(100, 120)], 3, 8))
      .toEqual([{ row: 0, x: 0, inline: false }, { row: 1, x: 100, inline: false }])
  })

  it('sem lugar embaixo, a etiqueta vai ao lado; sem lugar nenhum, o selo fica de fora (os importantes por último)', () => {
    const box = (x: number, width: number, o: Partial<LabelBox> = {}): LabelBox => ({ x, width, priority: 2, ...o })
    // Duas linhas: com a etiqueta embaixo a vizinha da esquerda sobraria; com a etiqueta ao lado, cabe.
    expect(placeLabels([box(0, 120), box(100, 120, { tagWidth: 60, priority: 0 })], 2, 8))
      .toEqual([{ row: 1, x: 0, inline: false }, { row: 0, x: 100, inline: true }])
    expect(placeLabels([box(0, 120, { tagWidth: 60, priority: 0 })], 1, 8)).toEqual([{ row: 0, x: 0, inline: true }])
    expect(placeLabels([box(0, 120), box(50, 120)], 1, 8)).toEqual([{ row: 0, x: 0, inline: false }, null])
    expect(placeLabels([box(0, 120), box(50, 120, { priority: 1 })], 1, 8)).toEqual([null, { row: 0, x: 50, inline: false }])
    // A atual posta primeiro quebraria a alternância; da esquerda pra direita todos cabem em 2 linhas.
    const four = [box(0, 120), box(100, 120), box(200, 120), box(300, 120, { priority: 1 })]
    expect(placeLabels(four, 2, 8).map((s) => s?.row)).toEqual([0, 1, 0, 1])
  })

  it('perto da borda o selo recua pra caber inteiro (com a etiqueta ao lado, recua mais)', () => {
    const box = (x: number, width: number, o: Partial<LabelBox> = {}): LabelBox => ({ x, width, priority: 2, ...o })
    expect(placeLabels([box(950, 100)], 1, 8, 6, 994)).toEqual([{ row: 0, x: 894, inline: false }])
    expect(placeLabels([box(950, 100, { tagWidth: 60, priority: 0 })], 2, 8, 6, 994)).toEqual([{ row: 0, x: 894, inline: false }])
    expect(placeLabels([box(950, 100, { tagWidth: 60, priority: 0 })], 1, 8, 6, 994)).toEqual([{ row: 0, x: 830, inline: true }])
    expect(placeLabels([box(-20, 50)], 1, 8, 6, 994)).toEqual([{ row: 0, x: 6, inline: false }])
  })
})

// Ruling T18-selos: a etiqueta (PRÓXIMA, REPETE, LOOP) é obstáculo como o selo; o selo comum que
// colide com ela some (nunca o da atual nem o da armada) e nada se encosta nem fica por cima.
describe('selos x etiqueta', () => {
  type Foot = { owner: number; row: number; l: number; r: number }
  /** O que cada selo ocupa na onda: o selo, e a etiqueta embaixo (linha de baixo) ou ao lado (mesma linha). */
  const footprints = (boxes: readonly LabelBox[], spots: readonly (LabelSpot | null)[]): Foot[] => spots.flatMap((s, i) => {
    if (!s) return []
    const b = boxes[i]
    if (b.tagWidth === undefined) return [{ owner: i, row: s.row, l: s.x, r: s.x + b.width }]
    if (s.inline) return [{ owner: i, row: s.row, l: s.x, r: s.x + b.width + INLINE_TAG_GAP + b.tagWidth }]
    return [{ owner: i, row: s.row, l: s.x, r: s.x + b.width }, { owner: i, row: s.row + 1, l: s.x, r: s.x + b.tagWidth }]
  })
  const clashes = (feet: Foot[], gap: number) => feet.flatMap((a, i) => feet.slice(i + 1)
    .filter((b) => a.owner !== b.owner && a.row === b.row && !(a.r + gap <= b.l || b.r + gap <= a.l))
    .map((b) => `${a.owner}x${b.owner} na linha ${a.row}`))

  it('1024x740 com pulo armado e nomes de 14: uma linha só, a PRÓXIMA ao lado, o selo vizinho que colide some', () => {
    // Medidas do Chrome em 1024x740: onda de 992 px, 9 seções iguais (110,2 px), selos de 92 a 107 px, PRÓXIMA de 66,8 px.
    const bw = 992 / 9
    const widths = [98, 102.2, 98.2, 92.5, 104.3, 108.4, 106.9, 101.6, 104.5]
    const boxes: LabelBox[] = widths.map((width, i) => ({ x: i * bw + 7, width, priority: i === 6 ? 0 : i === 3 ? 1 : 2 }))
    boxes[6].tagWidth = 66.8
    const spots = placeLabels(boxes, 1, 8, 6, 986)
    // A armada fica com a PRÓXIMA ao lado; a atual aparece; a vizinha da direita, que a PRÓXIMA cobriria, some.
    expect(spots[6]).toEqual({ row: 0, x: 6 * bw + 7, inline: true })
    expect(spots[3]).not.toBeNull()
    expect(spots[7]).toBeNull()
    expect(clashes(footprints(boxes, spots), 8)).toEqual([])
  })

  it('varredura: nenhum selo encosta em selo ou etiqueta, e a atual e a armada só somem se nem sozinhas couberem', () => {
    let seed = 7
    const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648 }
    let cases = 0
    let hiddenCommon = 0
    for (let k = 0; k < 3000; k++) {
      const n = 3 + Math.floor(rnd() * 12)
      const width = 600 + rnd() * 1300
      const rows = 1 + Math.floor(rnd() * 3)
      const bw = width / n
      const armed = Math.floor(rnd() * n)
      const current = Math.floor(rnd() * n)
      const boxes: LabelBox[] = Array.from({ length: n }, (_, i) => ({
        x: i * bw + 7, width: 40 + rnd() * 90, priority: i === armed ? 0 : i === current ? 1 : 2,
      }))
      boxes[armed].tagWidth = [50, 66.8, 70, 84][Math.floor(rnd() * 4)]
      const spots = placeLabels(boxes, rows, 8, 6, width - 6)
      expect(clashes(footprints(boxes, spots), 8)).toEqual([])
      for (const s of spots) if (s) expect(s.x).toBeGreaterThanOrEqual(6)
      // Atual e armada: se as duas cabem sozinhas, continuam aparecendo com todas as outras.
      const important = boxes.map((_, i) => i).filter((i) => boxes[i].priority < 2)
      const alone = placeLabels(important.map((i) => boxes[i]), rows, 8, 6, width - 6)
      if (alone.every((s) => s !== null)) for (const i of important) expect(spots[i]).not.toBeNull()
      hiddenCommon += spots.filter((s, i) => s === null && boxes[i].priority === 2).length
      cases++
    }
    expect(cases).toBe(3000)
    expect(hiddenCommon).toBeGreaterThan(0) // a varredura passa por casos apertados de verdade
  })

  it('na onda de uma linha só, o selo vizinho escondido continua no nome e na dica do bloco', () => {
    // 1024x740: onda de 992 x 95 px (uma linha de selos), 9 seções iguais, selos de 100 px, PRÓXIMA de 66,8 px.
    fakeLayout(992, 95, { selo: 100, tag: 66.8, ruler: 30 })
    const nine: StageSection[] = Array.from({ length: 9 }, (_, i) => ({
      index: i, label: `Seção Número ${i + 1}`, color: '#10b981', start: i * 10, end: (i + 1) * 10, bars: 4,
    }))
    const { container } = renderWave({ sections: nine, duration: 90, currentSection: 3, intent: { target: 6, plays: 1 } })
    const b = blocks(container)
    const selo = (i: number) => b[i].querySelector<HTMLElement>('[data-selo]')!
    const tag = b[6].querySelector<HTMLElement>('[data-tag]')!
    // A armada e a atual aparecem; a PRÓXIMA fica ao lado do selo da armada, na mesma linha.
    expect(selo(6).dataset.fit).toBeUndefined()
    expect(selo(3).dataset.fit).toBeUndefined()
    expect(tag.dataset.fit).toBeUndefined()
    expect(tag.style.top).toBe('12px')
    expect(tag.style.left).toBe(`${7 + 100 + INLINE_TAG_GAP}px`)
    // A vizinha da direita, que a PRÓXIMA cobriria, some; o nome dela continua no bloco.
    expect(selo(7).dataset.fit).toBe('none')
    expect(b[7].getAttribute('aria-label')).toBe('Armar Seção Número 8')
    expect(b[7].getAttribute('title')).toBe('Armar Seção Número 8')
    // Os outros cabem na linha: só a que colide sai.
    expect(b.filter((x) => x.querySelector<HTMLElement>('[data-selo]')!.dataset.fit === 'none')).toHaveLength(1)
  })

  // Ruling T18-proxima-toque: a etiqueta ao lado do selo da armada passa por cima do bloco vizinho
  // (1024x740, uma linha de selos). Ela não tem ação própria: o toque nesse ponto é do bloco de baixo.
  it('a PRÓXIMA não pega o toque: no ponto dela, em cima do bloco vizinho, o toque troca o alvo e não cancela o pulo', () => {
    const W = 992
    fakeLayout(W, 95, { selo: 100, tag: 66.8, ruler: 30 })
    const nine: StageSection[] = Array.from({ length: 9 }, (_, i) => ({
      index: i, label: `Seção Número ${i + 1}`, color: '#10b981', start: i * 10, end: (i + 1) * 10, bars: 4,
    }))
    const onTapSection = vi.fn()
    const { container } = renderWave({ sections: nine, duration: 90, currentSection: 3, intent: { target: 6, plays: 1 }, onTapSection })
    const b = blocks(container)
    const tag = b[6].querySelector<HTMLElement>('[data-tag]')!
    expect(tag.textContent).toBe('PRÓXIMA')
    // Geometria (o jsdom não faz layout): blocos pela % do style, acima da faixa da régua (44 px); a
    // etiqueta pelo left e top dela dentro do bloco armado, com a largura medida no Chrome.
    type Box = { l: number; r: number; t: number; b: number }
    const blockBox = (el: HTMLElement): Box => {
      const l = (parseFloat(el.style.left) / 100) * W
      return { l, r: l + (parseFloat(el.style.width) / 100) * W, t: 0, b: 95 - 44 }
    }
    const tl = blockBox(b[6]).l + parseFloat(tag.style.left)
    const tt = parseFloat(tag.style.top)
    const tagBox: Box = { l: tl, r: tl + 66.8, t: tt, b: tt + 18 }
    const x = (tagBox.l + tagBox.r) / 2
    const y = (tagBox.t + tagBox.b) / 2
    // O meio da etiqueta fica em cima do bloco vizinho (o 8º), não do armado.
    expect(x).toBeGreaterThan(blockBox(b[7]).l)
    expect(x).toBeLessThan(blockBox(b[7]).r)
    // Quem recebe o toque nesse ponto, como o navegador escolhe: o de cima que aceita ponteiro (a
    // etiqueta, z-3, fica acima dos blocos; entre os blocos, o último no DOM fica por cima).
    const takesPointer = (el: HTMLElement) => el.closest('.pointer-events-none') === null
    const inside = (k: Box) => x >= k.l && x <= k.r && y >= k.t && y <= k.b
    const stack: Array<{ el: HTMLElement; box: Box }> = [{ el: tag, box: tagBox }, ...b.map((el) => ({ el, box: blockBox(el) })).reverse()]
    const hit = stack.find(({ el, box }) => takesPointer(el) && inside(box))!.el
    expect(hit).toBe(b[7])
    fireEvent.click(hit)
    // Troca o alvo pro bloco de baixo; tocar na armada (6) cancelaria o pulo.
    expect(onTapSection).toHaveBeenCalledTimes(1)
    expect(onTapSection).toHaveBeenCalledWith(7)
  })

  it('nenhuma etiqueta (PRÓXIMA, REPETE, LOOP) pega o toque: o bloco de baixo recebe', () => {
    const { container, rerenderWith } = renderWave({ intent: { target: 2, plays: 1 } })
    const tagEl = () => container.querySelector<HTMLElement>('[data-tag]')!
    expect(tagEl().textContent).toBe('PRÓXIMA')
    expect(tagEl().className).toMatch(/\bpointer-events-none\b/)
    rerenderWith({ intent: { target: 1, plays: 2 } })
    expect(tagEl().textContent).toBe('REPETE')
    expect(tagEl().className).toMatch(/\bpointer-events-none\b/)
    rerenderWith({ intent: { target: 1, plays: 'infinite' }, loopOn: true })
    expect(tagEl().textContent).toContain('LOOP')
    expect(tagEl().className).toMatch(/\bpointer-events-none\b/)
  })
})

describe('WaveformSections', () => {
  it('blocos na posição da seção, estado atual e armado', () => {
    const { container, rerenderWith } = renderWave({ intent: { target: 2, plays: 1 } })
    const b = blocks(container)
    expect(b).toHaveLength(5)
    expect(b[2].style.left).toBe('25%')
    expect(b[2].style.width).toBe('25%')
    expect(b[1].dataset.state).toBe('atual')
    expect(b[2].dataset.state).toBe('armada')
    expect(b[0].dataset.state).toBeUndefined()
    expect(tagOf(b[2])).toBe('PRÓXIMA')
    expect(tagOf(b[1])).toBeNull()
    // Armado: listras andando + borda pulsando (animações da T1) e borda fixa própria pro movimento reduzido.
    expect(b[2].className).toContain('animate-[var(--animate-ps-stripes),var(--animate-ps-armglow)]')
    expect(b[2].className).toContain('inset-ring-ps-arm')
    expect(b[2].className).toContain('color-mix(in_srgb,var(--color-ps-arm)')
    expect(b[2].style.getPropertyValue('--ps-c')).toBe('#FF6B35')
    expect(b[1].getAttribute('aria-pressed')).toBe('false')
    expect(b[2].getAttribute('aria-pressed')).toBe('true')

    rerenderWith({ intent: { target: 1, plays: 2 } }) // intenção na atual: REPETE
    expect(b[1].dataset.state).toBe('repete')
    expect(tagOf(b[1])).toBe('REPETE')
    expect(tagOf(b[2])).toBeNull()
    expect(b[2].dataset.state).toBeUndefined()
  })

  it('LOOP no atual com loop, sem listras de armado', () => {
    const { container } = renderWave({ intent: { target: 1, plays: 'infinite' }, loopOn: true })
    const b = blocks(container)
    expect(b[1].dataset.state).toBe('atual')
    expect(b[1].dataset.loop).toBe('true')
    expect(tagOf(b[1])).toBe('LOOP')
    expect(b[1].className).not.toContain('animate-[')
    expect(b[1].querySelector('[data-tag] svg')).not.toBeNull() // ícone em SVG
  })

  it('rótulo de acessibilidade muda tocando e parado', () => {
    const { container, rerenderWith } = renderWave({ isPlaying: true })
    expect(blocks(container).map((b) => b.getAttribute('aria-label'))).toEqual(['Armar Intro', 'Armar Verso', 'Armar Refrão', 'Armar Ponte', 'Armar Final'])
    rerenderWith({ isPlaying: false })
    expect(blocks(container).map((b) => b.getAttribute('aria-label'))).toEqual(['Ir para Intro', 'Ir para Verso', 'Ir para Refrão', 'Ir para Ponte', 'Ir para Final'])
    expect(blocks(container).every((b) => b.tagName === 'BUTTON' && b.type === 'button')).toBe(true)
  })

  it('toque no bloco arma; parado, tocar e arrastar na régua busca na hora', () => {
    const { container, p } = renderWave({ isPlaying: false })
    fireEvent.click(blocks(container)[2])
    expect(p.onTapSection).toHaveBeenCalledWith(2)
    fireEvent.click(blocks(container)[3].querySelector('[data-selo]')!) // o selo faz parte do bloco
    expect(p.onTapSection).toHaveBeenLastCalledWith(3)

    const r = regua(container)
    vi.spyOn(r, 'getBoundingClientRect').mockReturnValue(rect(100, 1000))
    pointer(r, 'pointerdown', 600)
    expect(p.onSeek).toHaveBeenLastCalledWith(50) // meio da régua = duration / 2
    pointer(r, 'pointermove', 850)
    expect(p.onSeek).toHaveBeenLastCalledWith(75)
    pointer(r, 'pointermove', 0)
    expect(p.onSeek).toHaveBeenLastCalledWith(0) // antes da régua: presa no início
    pointer(r, 'pointermove', 5000)
    expect(p.onSeek).toHaveBeenLastCalledWith(100) // depois: presa no fim
    pointer(r, 'pointerup', 5000)
    const calls = vi.mocked(p.onSeek).mock.calls.length
    pointer(r, 'pointermove', 300)
    expect(vi.mocked(p.onSeek).mock.calls.length).toBe(calls) // soltou: mexer não busca
    expect(r.className).toContain('touch-none') // arrastar com o dedo não rola a tela
  })

  it('tocando, o toque na régua só busca ao soltar o dedo, uma vez, no ponto do toque (Ruling I1-regua)', () => {
    const { container, p } = renderWave({ isPlaying: true })
    const r = regua(container)
    vi.spyOn(r, 'getBoundingClientRect').mockReturnValue(rect(100, 1000))
    pointer(r, 'pointerdown', 600)
    expect(p.onSeek).not.toHaveBeenCalled() // o dedo encostou: nada ainda
    pointer(r, 'pointermove', 607) // menos de 8 px de lado ainda é toque
    expect(p.onSeek).not.toHaveBeenCalled()
    pointer(r, 'pointerup', 607)
    expect(p.onSeek).toHaveBeenCalledTimes(1)
    expect(p.onSeek).toHaveBeenLastCalledWith(50)
    pointer(r, 'pointermove', 900)
    pointer(r, 'pointerup', 900)
    expect(p.onSeek).toHaveBeenCalledTimes(1) // soltou: nada mais
  })

  it('tocando, o arrasto na régua mostra a prévia no playhead e busca uma vez ao soltar', () => {
    fakeLayout(1000, 140, { selo: 60, tag: 60, ruler: 30 })
    position = 10
    const { container, p } = renderWave({ isPlaying: true })
    const r = regua(container)
    const ph = container.querySelector<HTMLElement>('[data-playhead]')!
    vi.spyOn(r, 'getBoundingClientRect').mockReturnValue(rect(0, 1000))
    expect(ph.style.transform).toBe('translateX(100.0px)')
    pointer(r, 'pointerdown', 300)
    pointer(r, 'pointermove', 500)
    pointer(r, 'pointermove', 700)
    frame()
    expect(p.onSeek).not.toHaveBeenCalled() // arrastando: nenhuma busca, nem por movimento
    expect(ph.style.transform).toBe('translateX(700.0px)') // a prévia anda com o dedo
    position = 11 // a música segue tocando por baixo da prévia
    frame()
    expect(ph.style.transform).toBe('translateX(700.0px)')
    pointer(r, 'pointerup', 750)
    expect(p.onSeek).toHaveBeenCalledTimes(1)
    expect(p.onSeek).toHaveBeenLastCalledWith(75) // onde o dedo soltou
    position = 75
    frame()
    expect(ph.style.transform).toBe('translateX(750.0px)')
    position = 0
  })

  it('tocando, arrasto cancelado ou que sai da régua não busca e a prévia some', () => {
    fakeLayout(1000, 140, { selo: 60, tag: 60, ruler: 30 })
    position = 20
    const { container, p } = renderWave({ isPlaying: true })
    const r = regua(container)
    const ph = container.querySelector<HTMLElement>('[data-playhead]')!
    vi.spyOn(r, 'getBoundingClientRect').mockReturnValue(rect(0, 1000))
    pointer(r, 'pointerdown', 300)
    pointer(r, 'pointermove', 800)
    fireEvent.pointerCancel(r)
    pointer(r, 'pointerup', 800)
    frame()
    expect(ph.style.transform).toBe('translateX(200.0px)') // voltou pra posição ouvida
    pointer(r, 'pointerdown', 300)
    pointer(r, 'pointermove', 900)
    fireEvent.pointerLeave(r)
    pointer(r, 'pointerup', 900)
    expect(p.onSeek).not.toHaveBeenCalled()
    position = 0
  })

  it('blocos terminam onde a faixa de toque da régua começa, e a faixa inteira tem a cara da régua', () => {
    const { container, p } = renderWave()
    const r = regua(container)
    const area = container.querySelector<HTMLElement>('[role="group"]')!
    const look = container.querySelector<HTMLElement>('[data-ruler]')!
    // Faixa de toque: 44 px a partir do fundo. Blocos: do topo até 44 px do fundo. Nenhum pixel com dois sentidos.
    expect(r.className).toMatch(/(^| )bottom-0( |$)/)
    expect(r.className).toMatch(/(^| )h-ps-touch( |$)/)
    expect(area.className).toMatch(/(^| )bottom-ps-touch( |$)/)
    expect(area.className).toMatch(/(^| )top-0( |$)/)
    // O que se vê bate com o que o toque faz: o fundo da régua cobre os 44 px, com a fronteira em cima.
    expect(look.className).toMatch(/(^| )bottom-0( |$)/)
    expect(look.className).toMatch(/(^| )h-ps-touch( |$)/)
    expect(look.className).toContain('border-t')
    expect(look.className).toContain('bg-ps-line/35')
    // Toque no pé do bloco arma (o botão vai até a fronteira); a régua é a única que busca.
    fireEvent.click(blocks(container)[2])
    expect(p.onTapSection).toHaveBeenCalledWith(2)
    expect(p.onSeek).not.toHaveBeenCalled()
  })

  it('parado, sair da régua sem captura solta o arrasto', () => {
    const { container, p } = renderWave({ isPlaying: false })
    const r = regua(container)
    vi.spyOn(r, 'getBoundingClientRect').mockReturnValue(rect(0, 1000))
    pointer(r, 'pointerdown', 100)
    fireEvent.pointerLeave(r)
    pointer(r, 'pointermove', 900)
    expect(p.onSeek).toHaveBeenCalledTimes(1)
    // A onda isola as camadas dela (selos, régua, playhead) do resto da tela.
    expect(container.querySelector('[data-waveform]')!.className).toContain('isolate')
  })

  it('seta só quando o alvo é outra seção', () => {
    const arc = (c: HTMLElement) => c.querySelector('[data-arc]')
    const { container, rerenderWith } = renderWave({ intent: { target: 3, plays: 1 } })
    expect(arc(container)).not.toBeNull()
    rerenderWith({ intent: { target: 0, plays: 1 } }) // pulo pra trás também
    expect(arc(container)).not.toBeNull()
    rerenderWith({ intent: { target: 1, plays: 1 } }) // REPETE a atual
    expect(arc(container)).toBeNull()
    rerenderWith({ intent: { target: 1, plays: 'infinite' }, loopOn: true })
    expect(arc(container)).toBeNull()
    rerenderWith({ intent: null, loopOn: false })
    expect(arc(container)).toBeNull()
    rerenderWith({ intent: { target: 9, plays: 1 } }) // alvo fora da lista
    expect(arc(container)).toBeNull()
  })

  it('seta desenhada do fim da atual ao começo da armada', () => {
    fakeLayout(1000, 140, { selo: 60, tag: 60, ruler: 30 })
    const { container } = renderWave({ intent: { target: 3, plays: 1 } })
    const svg = container.querySelector('[data-arc]')!
    // Verso acaba em 25 s (250 px); a Ponte começa em 50 s (500 px). Base 32 px acima do fundo, na faixa da régua.
    expect(svg.querySelector('[data-arc-dash]')!.getAttribute('d')).toMatch(/^M250\.0 108\.0 C250\.0 [\d.]+ 500\.0 [\d.]+ 500\.0 101\.0$/)
    expect(svg.querySelector('[data-arc-dot]')!.getAttribute('cx')).toBe('250.0')
    expect(svg.querySelector('[data-arc-head]')!.getAttribute('d')).toContain('L500.0 107.0')
  })

  it('bolinha e ponta da seta a 12 px da borda', () => {
    fakeLayout(1000, 140, { selo: 60, tag: 60, ruler: 30 })
    const { container } = renderWave({ currentSection: 4, intent: { target: 0, plays: 1 } }) // Final (até 100 s) volta pra Intro (0 s)
    expect(container.querySelector('[data-arc-dot]')!.getAttribute('cx')).toBe('988.0')
    expect(container.querySelector('[data-arc-head]')!.getAttribute('d')).toContain('L12.0 107.0')
  })

  it('onda de 140 px: a seta passa abaixo do selo da 3ª linha, sem encostar', () => {
    // 10 seções de 10 s (blocos de 100 px), selos de 120 px: a Interlúdio (7) cai na 3ª linha, entre a atual e a armada.
    const many: StageSection[] = Array.from({ length: 10 }, (_, i) => ({ index: i, label: `Seção ${i + 1}`, color: '#10b981', start: i * 10, end: i * 10 + 10, bars: 4 }))
    fakeLayout(1000, 140, { selo: 120, tag: 60, ruler: 30 })
    const { container } = renderWave({ sections: many, currentSection: 1, intent: { target: 8, plays: 1 } })
    const selos = blocks(container).map((b, k) => ({ k, el: b.querySelector<HTMLElement>('[data-selo]')! }))
    const bottoms = selos.filter(({ el }) => el.dataset.fit !== 'none').map(({ k, el }) => ({ k, l: k * 100 + parseFloat(el.style.left), b: parseFloat(el.style.top) + 22 }))
    const third = bottoms.filter((x) => x.b === 10 + 2 * 28 + 22)
    expect(third.length).toBeGreaterThan(0)
    const nums = container.querySelector('[data-arc-dash]')!.getAttribute('d')!.match(/-?[\d.]+/g)!.map(Number)
    expect(nums).toHaveLength(8)
    const [mx, my, c1x, c1y, c2x, c2y, ex, ey] = nums
    expect([mx, my, c1x, c2x, ex, ey]).toEqual([200, 108, 200, 800, 800, 101]) // fim do 2º bloco ao começo do 9º
    expect(c1y).toBe(c2y)
    // Ponto mais alto da curva, com o meio-traço de 3 px do contorno escuro.
    const lift = 108 - c1y
    const top = 108 - arcRise(lift) - 3
    for (const s of bottoms) if (s.l < 808 && s.l + 120 > 192) expect(top - s.b).toBeGreaterThanOrEqual(4)
    expect(arcRise(lift)).toBeGreaterThan(7) // ainda é curva, só mais rasa
  })

  it('layout só quando mudam seções, nomes, intenção, compassos ou tamanho; nunca por renderização igual nem por quadro', () => {
    fakeLayout(1000, 140, { selo: 60, tag: 60, ruler: 30 })
    const measure = vi.mocked(HTMLElement.prototype.getBoundingClientRect)
    const { rerenderWith } = renderWave({ barLines: [0, 10, 20, 30] })
    const first = measure.mock.calls.length
    expect(first).toBeGreaterThan(0)
    // O App renderiza a cada quadro tocando, com arrays novos de mesmo conteúdo.
    for (let i = 0; i < 5; i++) {
      rerenderWith({ sections: SECTIONS.map((s) => ({ ...s })), barLines: [0, 10, 20, 30], intent: null })
      frame()
    }
    expect(measure.mock.calls.length).toBe(first)
    rerenderWith({ sections: SECTIONS.map((s) => (s.index === 2 ? { ...s, label: 'Refrão Final' } : { ...s })), barLines: [0, 10, 20, 30] })
    const renamed = measure.mock.calls.length
    expect(renamed).toBeGreaterThan(first)
    rerenderWith({ sections: SECTIONS.map((s) => (s.index === 2 ? { ...s, label: 'Refrão Final' } : { ...s })), barLines: [0, 10, 20, 30], intent: { target: 3, plays: 1 } })
    expect(measure.mock.calls.length).toBeGreaterThan(renamed) // armou: etiqueta e seta mudam
  })

  it('Livre: sem blocos', () => {
    const { container } = renderWave({ sectionsAllowed: false, intent: { target: 3, plays: 1 } })
    expect(blocks(container)).toHaveLength(0)
    expect(container.querySelectorAll('button')).toHaveLength(0)
    expect(container.querySelector('[data-arc]')).toBeNull()
    expect(regua(container)).not.toBeNull()
    expect(container.querySelectorAll('canvas')).toHaveLength(2) // a onda continua
  })

  it('playhead e parte tocada andam pelo relógio, sem renderizar', () => {
    fakeLayout(1000, 140, { selo: 60, tag: 60, ruler: 30 })
    position = 25
    const { container } = renderWave()
    const ph = container.querySelector<HTMLElement>('[data-playhead]')!
    const played = container.querySelector<HTMLElement>('canvas[data-wave="tocada"]')!
    expect(ph.style.transform).toBe('translateX(250.0px)') // já pinta depois da renderização
    expect(played.style.clipPath).toBe('inset(0 75.000% 0 0)')
    position = 60
    frame()
    expect(ph.style.transform).toBe('translateX(600.0px)')
    expect(played.style.clipPath).toBe('inset(0 40.000% 0 0)')
    position = 1e9 // depois do fim: preso no fim
    frame()
    expect(ph.style.transform).toBe('translateX(1000.0px)')
    position = 0
  })

  it('onda na cor da seção a 34%, tocada mais clara, linhas de compasso e canvas no devicePixelRatio', () => {
    fakeLayout(300, 140, { selo: 60, tag: 60, ruler: 30 })
    vi.stubGlobal('devicePixelRatio', 2)
    // O jsdom não carrega o CSS: os tokens que o canvas lê vêm do :root, como no navegador.
    document.documentElement.style.setProperty('--color-ps-bone', '#E8E8EC')
    document.documentElement.style.setProperty('--color-ps-mut', '#9d9da8')
    onTestFinished(() => {
      document.documentElement.style.removeProperty('--color-ps-bone')
      document.documentElement.style.removeProperty('--color-ps-mut')
    })
    type Op = { style: string; alpha: number; x: number; w: number; h: number }
    const ops = new Map<HTMLCanvasElement, Op[]>()
    vi.mocked(HTMLCanvasElement.prototype.getContext).mockImplementation(function (this: HTMLCanvasElement) {
      const list: Op[] = []
      ops.set(this, list)
      const ctx = {
        fillStyle: '', globalAlpha: 1, setTransform: () => {}, clearRect: () => {},
        fillRect(x: number, _y: number, w: number, h: number) { list.push({ style: String(ctx.fillStyle), alpha: ctx.globalAlpha, x, w, h }) },
      }
      return ctx as unknown as CanvasRenderingContext2D
    } as unknown as HTMLCanvasElement['getContext']) // o getContext tem uma assinatura por tipo de contexto; o falso só faz o 2d
    const peaks = new Float32Array(100).fill(1)
    const { container } = renderWave({ peaks, barLines: [0, 10, 20, 30, 40] })
    const base = container.querySelector<HTMLCanvasElement>('canvas[data-wave="base"]')!
    const played = container.querySelector<HTMLCanvasElement>('canvas[data-wave="tocada"]')!
    expect([base.width, base.height]).toEqual([600, 280])
    const wave = (ops.get(base) ?? []).filter((o) => o.w === 2)
    const lines = (ops.get(base) ?? []).filter((o) => o.w === 1)
    expect(wave.length).toBe(100) // uma barra de 2 px a cada 3 px
    const first = wave[0] // 0 s: Intro
    expect([first.style, first.alpha]).toEqual(['#3b82f6', 0.34])
    // A cor vem do meio da barra: 147 px (49,3 s) ainda é Refrão; 150 px (50,3 s) já é Ponte.
    expect(wave.find((o) => o.x === 147)?.style).toBe('#FF6B35')
    expect(wave.find((o) => o.x === 150)?.style).toBe('#8b5cf6')
    const playedOps = (ops.get(played) ?? []).filter((o) => o.w === 2)
    expect(playedOps[0].style).toBe(lighter('#3b82f6'))
    expect(playedOps[0].alpha).toBe(1)
    expect(lines.map((o) => o.x)).toEqual([0, 30, 60, 90, 120])
    expect(lines[0].alpha).toBeGreaterThan(lines[1].alpha) // a cada 4 compassos, mais forte
    expect(lines[4].alpha).toBe(lines[0].alpha)
  })

  it.each([[140, 3], [132, 2]])('selos nunca se encostam: onda de %i px (%i linhas), dentro da onda e sem cortar o nome', (h) => {
    // 10 seções de 10 s numa onda de 1000 px (blocos de 100 px) com selos de 120 px: não cabem lado a lado.
    const many: StageSection[] = Array.from({ length: 10 }, (_, i) => ({ index: i, label: `Seção ${i + 1}`.padEnd(14, 'x'), color: '#10b981', start: i * 10, end: i * 10 + 10, bars: 4 }))
    fakeLayout(1000, h, { selo: 120, tag: 60, ruler: 30 })
    const { container } = renderWave({ sections: many, currentSection: 4, intent: { target: 5, plays: 1 } })
    const placed: Array<{ k: number; l: number; r: number; t: number; b: number }> = []
    blocks(container).forEach((b, k) => {
      const left = k * 100
      const selo = b.querySelector<HTMLElement>('[data-selo]')!
      expect(selo.className).not.toMatch(/truncate|text-ellipsis|line-clamp|overflow-hidden/)
      expect(selo.className).toContain('whitespace-nowrap')
      expect(selo.dataset.fit).toBeUndefined() // aqui todos cabem (em 2 linhas, a etiqueta vai ao lado)
      const x = left + parseFloat(selo.style.left)
      const top = parseFloat(selo.style.top)
      placed.push({ k, l: x, r: x + 120, t: top, b: top + 22 })
      const tag = b.querySelector<HTMLElement>('[data-tag]')
      if (!tag) return
      const tx = left + parseFloat(tag.style.left)
      const tt = parseFloat(tag.style.top)
      if (tt === top + 2) expect(tx).toBe(x + 120 + 4) // ao lado, na altura do selo
      else expect([tt, tx]).toEqual([top + 28, x]) // embaixo (v5)
      placed.push({ k, l: tx, r: tx + 60, t: tt, b: tt + 18 })
    })
    for (const a of placed) {
      expect(a.l).toBeGreaterThanOrEqual(6)
      expect(a.r).toBeLessThanOrEqual(1000 - 6)
      expect(a.b).toBeLessThanOrEqual(h - 22 - 30) // fora da faixa da seta e da faixa de toque da régua
    }
    for (let i = 0; i < placed.length; i++) for (let j = i + 1; j < placed.length; j++) {
      const a = placed[i]
      const c = placed[j]
      const gap = a.k === c.k ? 4 : 8
      expect(a.r + gap <= c.l || c.r + gap <= a.l || a.b <= c.t || c.b <= a.t).toBe(true)
    }
  })

  it('selo da última seção curta não passa da borda direita', () => {
    const tail: StageSection[] = [
      { index: 0, label: 'Verso', color: '#10b981', start: 0, end: 97, bars: 8 },
      { index: 1, label: 'Final', color: '#ec4899', start: 97, end: 100, bars: 1 },
    ]
    fakeLayout(1000, 140, { selo: 80, tag: 60, ruler: 30 })
    const { container } = renderWave({ sections: tail, currentSection: 0 })
    const selo = blocks(container)[1].querySelector<HTMLElement>('[data-selo]')!
    expect(970 + parseFloat(selo.style.left) + 80).toBeLessThanOrEqual(994)
    // Bloco de 30 px: marcado pro verificador (exceção aceita), com a área de toque igual ao próprio retângulo.
    expect(blocks(container)[1].dataset.narrow).toBe('true')
    expect(blocks(container)[0].dataset.narrow).toBe('false')
    for (const b of blocks(container)) expect(b.className).not.toMatch(/(^| )([a-z-]+\[[^\]]*\]:)*before:/)
  })

  it('toque perto da divisa arma o bloco em que caiu (nada alarga um bloco por cima do vizinho)', () => {
    const tail: StageSection[] = [
      { index: 0, label: 'Verso', color: '#10b981', start: 0, end: 97, bars: 8 },
      { index: 1, label: 'Final', color: '#ec4899', start: 97, end: 100, bars: 1 },
    ]
    fakeLayout(1000, 140, { selo: 80, tag: 60, ruler: 30 })
    const { container, p } = renderWave({ sections: tail, currentSection: 0 })
    const [verso, final] = blocks(container)
    // Nenhum filho do bloco ocupa área fora dele além do selo (que mostra o nome da própria seção).
    for (const b of [verso, final]) for (const el of b.querySelectorAll<HTMLElement>('*')) {
      if (el.closest('[data-selo],[data-tag]')) continue
      expect(el.getAttribute('class') ?? '').not.toMatch(/absolute|fixed/)
    }
    fireEvent.click(final)
    expect(p.onTapSection).toHaveBeenLastCalledWith(1)
    fireEvent.click(verso)
    expect(p.onTapSection).toHaveBeenLastCalledWith(0)
  })

  it('rótulos da régua a cada 30 s, sem encostar um no outro nem na borda', () => {
    fakeLayout(1000, 140, { selo: 60, tag: 60, ruler: 30 })
    const visible = (c: HTMLElement) => [...c.querySelectorAll<HTMLElement>('[data-ruler-label]')].filter((l) => l.dataset.fit !== 'none').map((l) => l.textContent)
    const { container, rerenderWith } = renderWave({ duration: 100 })
    expect(visible(container)).toEqual(['0:00', '0:30', '1:00', '1:30'])
    rerenderWith({ duration: 92 }) // 1:30 cairia em 983 px e passaria da borda
    expect(visible(container)).toEqual(['0:00', '0:30', '1:00'])
    rerenderWith({ duration: 1200 }) // 20 min: 25 px entre rótulos, sobra um sim, um não
    const v = visible(container)
    expect(v.slice(0, 3)).toEqual(['0:00', '1:00', '2:00'])
    expect(v.length).toBe(20)
  })

  it('texto em português, sem travessão', () => {
    const { container } = renderWave({ intent: { target: 3, plays: 1 } })
    renderWave({ intent: { target: 1, plays: 'infinite' }, loopOn: true, isPlaying: false })
    const all = document.body
    const texts = [all.textContent ?? '', ...[...all.querySelectorAll('[aria-label],[title]')].flatMap((e) => [e.getAttribute('aria-label') ?? '', e.getAttribute('title') ?? ''])]
    expect(container.textContent).toContain('PRÓXIMA')
    for (const t of texts) {
      expect(t).not.toContain(TRAVESSAO)
      expect(t).not.toMatch(PROIBIDAS)
    }
  })

  it('nenhuma cor de família repete cor de seção', () => {
    // O CSS dos tokens lido do arquivo (o Vitest troca import de .css por vazio; no jsdom o import.meta.url não é file:).
    const tokensCss = readFileSync(resolve(process.cwd(), 'src/styles/ps-tokens.css'), 'utf8')
    const tokenColors = [...tokensCss.matchAll(/--color-ps-sec-[a-z]+:\s*(#[0-9a-f]{6})/gi)].map((m) => m[1].toLowerCase())
    const sectionColors = new Set([...SECTION_SHORTCUTS.map((s) => s.color.toLowerCase()), ...tokenColors])
    expect(tokenColors).toHaveLength(6)
    expect(sectionColors.size).toBe(6) // tokens e atalhos são as mesmas 6 cores
    for (const [family, color] of Object.entries(FAMILY_COLOR)) expect(sectionColors.has(color.toLowerCase()), family).toBe(false)
  })
})

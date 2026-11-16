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
import { arcPath, computePeaks, lighter, placeLabels } from './wavePeaks'
import type { LabelBox } from './wavePeaks'

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
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockImplementation(function (this: HTMLElement) {
    if (this.dataset.selo !== undefined) return widths.selo
    if (this.dataset.tag !== undefined) return widths.tag
    if (this.dataset.rulerLabel !== undefined) return widths.ruler
    return 0
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

  it('seta: curva do v6 com subida entre 26 e o teto', () => {
    expect(arcPath(100, 300, 100, 60)).toBe('M100.0 100.0 C100.0 40.0 300.0 40.0 300.0 93.0')
    expect(arcPath(300, 100, 100, 60)).toBe('M300.0 100.0 C300.0 40.0 100.0 40.0 100.0 93.0')
    expect(arcPath(100, 110, 100, 60)).toBe('M100.0 100.0 C100.0 73.8 110.0 73.8 110.0 93.0')
    expect(arcPath(0, 1000, 100, 10)).toBe('M0.0 100.0 C0.0 70.0 1000.0 70.0 1000.0 93.0') // teto nunca abaixo de 30
    expect(arcPath(100, 106, 100, 60)).toBe('') // perto demais: sem curva
  })

  it('parte tocada: cor da seção com 28% de branco', () => {
    expect(lighter('#3b82f6')).toBe('rgb(114,165,249)')
    expect(lighter('#FF6B35')).toBe('rgb(255,148,110)')
    expect(lighter('#0f0')).toBe('rgb(71,255,71)')
    expect(lighter('rgb(16, 185, 129)')).toBe('rgb(83,205,164)')
    expect(lighter('var(--x)')).toBe('var(--x)')
  })

  it('selos que se encostariam descem de linha; quem tem etiqueta vai primeiro; sem lugar fica de fora', () => {
    const box = (x: number, width: number, span: 1 | 2 = 1, priority = 2): LabelBox => ({ x, width, span, priority })
    expect(placeLabels([box(0, 100), box(200, 100)], 3, 8)).toEqual([0, 0])
    expect(placeLabels([box(0, 100), box(104, 100)], 3, 8)).toEqual([0, 1]) // 4 px de folga é pouco
    expect(placeLabels([box(0, 100), box(108, 100)], 3, 8)).toEqual([0, 0]) // 8 px de folga basta
    // A armada (2 linhas) entra primeiro; a vizinha que encostaria nela desce pra 3ª linha.
    expect(placeLabels([box(0, 120), box(100, 120, 2, 0)], 3, 8)).toEqual([2, 0])
    expect(placeLabels([box(0, 120), box(100, 120, 2, 0)], 2, 8)).toEqual([null, 0])
    expect(placeLabels([box(0, 120, 2, 0)], 1, 8)).toEqual([null])
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

  it('toque no bloco arma; arrastar na régua busca', () => {
    const { container, p, rerenderWith } = renderWave()
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

    rerenderWith({ isPlaying: false }) // parado também busca
    pointer(regua(container), 'pointerdown', 350)
    expect(p.onSeek).toHaveBeenLastCalledWith(25)
    expect(r.className).toContain('touch-none') // arrastar com o dedo não rola a tela
  })

  it('faixa de toque da régua tem 44 px e fica acima dos blocos', () => {
    const { container } = renderWave()
    const r = regua(container)
    expect(r.className).toContain('h-ps-touch')
    expect(r.className).toContain('bottom-0')
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
    // Verso acaba em 25 s (250 px); a Ponte começa em 50 s (500 px). Base 12 px acima da régua (140 - 22 - 12).
    expect(svg.querySelector('[data-arc-dash]')!.getAttribute('d')).toMatch(/^M250\.0 106\.0 C250\.0 [\d.]+ 500\.0 [\d.]+ 500\.0 99\.0$/)
    expect(svg.querySelector('[data-arc-dot]')!.getAttribute('cx')).toBe('250.0')
    expect(svg.querySelector('[data-arc-head]')!.getAttribute('d')).toContain('L500.0 105.0')
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

  it('selos nunca se encostam: descem de linha, ficam dentro da onda e não cortam o nome', () => {
    // 10 seções de 10 s numa onda de 1000 px (blocos de 100 px) com selos de 120 px.
    const many: StageSection[] = Array.from({ length: 10 }, (_, i) => ({ index: i, label: `Seção ${i + 1}`.padEnd(14, 'x'), color: '#10b981', start: i * 10, end: i * 10 + 10, bars: 4 }))
    fakeLayout(1000, 140, { selo: 120, tag: 60, ruler: 30 })
    const { container } = renderWave({ sections: many, currentSection: 4, intent: { target: 5, plays: 1 } })
    const placed: Array<{ l: number; r: number; t: number; b: number }> = []
    blocks(container).forEach((b, i) => {
      const left = i * 100
      const selo = b.querySelector<HTMLElement>('[data-selo]')!
      expect(selo.className).not.toMatch(/truncate|text-ellipsis|line-clamp|overflow-hidden/)
      expect(selo.className).toContain('whitespace-nowrap')
      if (selo.dataset.fit === 'none') return
      const x = left + parseFloat(selo.style.left)
      const top = parseFloat(selo.style.top)
      placed.push({ l: x, r: x + 120, t: top, b: top + 22 })
      const tag = b.querySelector<HTMLElement>('[data-tag]')
      if (tag) {
        const tt = parseFloat(tag.style.top)
        expect(tt).toBe(top + 28)
        placed.push({ l: left + parseFloat(tag.style.left), r: left + parseFloat(tag.style.left) + 60, t: tt, b: tt + 18 })
      }
    })
    expect(placed.length).toBeGreaterThanOrEqual(10) // a armada (com etiqueta) e a atual sempre aparecem
    for (const a of placed) {
      expect(a.l).toBeGreaterThanOrEqual(6)
      expect(a.r).toBeLessThanOrEqual(1000 - 6)
      expect(a.b).toBeLessThanOrEqual(140 - 22 - 30) // fora da faixa da seta e da régua
    }
    for (let i = 0; i < placed.length; i++) for (let j = i + 1; j < placed.length; j++) {
      const a = placed[i]
      const c = placed[j]
      const apart = a.r + 8 <= c.l || c.r + 8 <= a.l || a.b <= c.t || c.b <= a.t
      expect(apart).toBe(true)
    }
    expect(blocks(container)[4].querySelector<HTMLElement>('[data-selo]')!.dataset.fit).toBeUndefined()
    expect(blocks(container)[5].querySelector<HTMLElement>('[data-selo]')!.dataset.fit).toBeUndefined()
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
    expect(blocks(container)[1].dataset.narrow).toBe('true') // bloco de 30 px: área de toque alargada pra 44
    expect(blocks(container)[0].dataset.narrow).toBe('false')
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

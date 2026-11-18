import { Fragment, useEffect, useLayoutEffect, useRef } from 'react'
import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react'
import { armLabel, isSelfLoop } from '../../lib/sectionArm'
import type { ArmIntent, StageClock, StageSection } from '../../lib/stageContracts'
import { cx } from '../ui'
import { Icon } from './icons'
import { setFlag } from './stageDom'
import { useFrame } from './useFrame'
import { arcPath, arcRise, INLINE_TAG_GAP, liftForRise, lighter, placeLabels } from './wavePeaks'
import type { LabelBox } from './wavePeaks'

export interface WaveformSectionsProps {
  peaks: Float32Array | null; duration: number; sections: StageSection[]; currentSection: number; isPlaying: boolean
  intent: ArmIntent | null; loopOn: boolean; barLines: number[] | null; sectionsAllowed: boolean
  clock: Pick<StageClock, 'position'>; onTapSection(i: number): void; onSeek(t: number): void
}

/** Rótulos da régua nos 22 px de baixo da onda (v5). */
const RULER = 22
/**
 * Faixa da régua: 44 px a partir do fundo (alvo de toque). Os blocos terminam onde ela começa e
 * ela inteira tem a cara da régua, com a fronteira em cima: cada pixel com um sentido só
 * (tocar num bloco arma; só a régua busca). Mesmo valor de `h-ps-touch`/`bottom-ps-touch`.
 */
const ZONE = 44
/** Rótulo da régua a cada 30 s. */
const RULER_STEP = 30
/** Rótulo da régua longe dos cantos arredondados (raio de 16 px) e a 10 px do vizinho. */
const RULER_FIRST = 12
const RULER_EDGE = 14
const RULER_GAP = 10
/** Selo a 10 px do topo e 7 px do começo do bloco (v5); linhas de 28 px (selo de 22 + 6, o anel da atual passa 3,5 px). */
const ROW_TOP = 10
const ROW = 28
const LABEL_X = 7
/** Folga do selo até a borda da onda e até o selo vizinho na mesma linha. */
const EDGE = 6
const GAP = 8
/** Selo termina pelo menos 8 px acima da faixa da régua. */
const ROWS_END = ZONE + 8
const MAX_ROWS = 4
/** Seta: base 32 px acima do fundo (bolinha e ponta dentro da faixa da régua), a 12 px das bordas. */
const ARC_BASE = 32
const ARC_EDGE = 12
/** A curva passa a 4 px ou mais de qualquer selo, contando o meio-traço (3 px) do contorno escuro. */
const ARC_CLEAR = 4
const ARC_STROKE = 3
/** Bloco mais estreito que o alvo de toque: só marcado (`data-narrow`) pro verificador da T20; a área de toque é o próprio retângulo. */
const TOUCH = 44
/** Tocando, o dedo na régua só vira arrasto depois de andar isto de lado (o mesmo do fader); antes é toque. */
const RULER_DRAG_PX = 8

type BlockState = 'atual' | 'armada' | 'repete'
type BlockTag = 'PRÓXIMA' | 'REPETE' | 'LOOP'
/** Bloco de uma seção na onda: começo e largura em fração da música. */
interface Block { s: StageSection; left: number; width: number; state: BlockState | undefined; tag: BlockTag | null; loop: boolean }
/** Selo posto na tela (px), pra seta não passar por cima. */
interface Placed { l: number; r: number; bottom: number }
/** Dedo na régua: se a VS tocava quando ele encostou, onde encostou e se já virou arrasto. */
interface RulerPress { playing: boolean; downX: number; dragging: boolean }

const clamp01 = (v: number) => Math.min(1, Math.max(0, v))
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
const pct = (f: number) => `${+(f * 100).toFixed(4)}%`
const fmt = (sec: number) => {
  const s = Math.max(0, Math.floor(sec))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

// v5 .blk: tinta da seção a 6% (atual 14%, armada 12% com listras brancas andando), divisória
// escura à direita. O armado tem a borda branca fixa (inset-ring) por baixo da que pulsa: com
// movimento reduzido as animações param e a borda fica.
const BLOCK =
  'absolute inset-y-0 cursor-pointer shadow-[inset_-1px_0_0_var(--color-ps-ink-0)] transition-[background-color] duration-150 hover:bg-[color-mix(in_srgb,var(--ps-c)_17%,transparent)] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ps-or'
const TINT: Record<BlockState | 'outra', string> = {
  outra: 'bg-[color-mix(in_srgb,var(--ps-c)_6%,transparent)]',
  atual: 'bg-[color-mix(in_srgb,var(--ps-c)_14%,transparent)]',
  armada: 'bg-[color-mix(in_srgb,var(--ps-c)_12%,transparent)]',
  repete: 'bg-[color-mix(in_srgb,var(--ps-c)_12%,transparent)]',
}
const ARMED =
  'bg-[repeating-linear-gradient(-45deg,color-mix(in_srgb,var(--color-ps-arm)_10%,transparent)_0_7px,transparent_7px_14px)] inset-ring-2 inset-ring-ps-arm animate-[var(--animate-ps-stripes),var(--animate-ps-armglow)]'
// v5 .blk.looping:before: barrinha clara no topo do bloco com loop.
const LOOP_BAR =
  "data-[loop=true]:after:absolute data-[loop=true]:after:inset-x-0.5 data-[loop=true]:after:top-0 data-[loop=true]:after:h-[3px] data-[loop=true]:after:rounded-b-[2px] data-[loop=true]:after:bg-ps-bone data-[loop=true]:after:content-['']"
// v5 .lb: selo na cor da seção com o nome inteiro numa linha (nunca corta nem põe reticências).
// A linha (top) e o deslocamento (left) vêm da conta dos selos, escritos direto no DOM.
const SELO =
  'absolute left-[7px] top-[10px] z-[3] flex h-[22px] items-center whitespace-nowrap rounded-ps-xs bg-(--ps-c) px-[7px] text-ps-sm leading-none font-extrabold tracking-[0.05em] text-ps-ink-0 data-[fit=none]:hidden'
const SELO_CURRENT = 'shadow-[0_0_0_2px_var(--color-ps-ink-0),0_0_0_3.5px_var(--ps-c)]'
// v5 .tg / .lp: etiqueta embaixo do selo. Armado em branco; LOOP com contorno claro. Sem ação
// própria, não pega o toque (Ruling T18-proxima-toque): ao lado do selo ela passa por cima do bloco
// vizinho, e o toque ali é do vizinho (troca o alvo), nunca da armada (cancelaria o pulo).
const TAG =
  'pointer-events-none absolute left-[7px] top-[38px] z-[3] flex h-[18px] items-center gap-1 whitespace-nowrap rounded-ps-xs px-1.5 text-ps-micro leading-none font-extrabold tracking-[0.1em] data-[fit=none]:hidden'
const TAG_TONE: Record<BlockTag, string> = {
  'PRÓXIMA': 'bg-ps-arm text-ps-ink',
  REPETE: 'bg-ps-arm text-ps-ink',
  LOOP: 'bg-ps-ink-0/80 text-ps-bone inset-ring-[1.5px] inset-ring-ps-bone',
}

/** Valor de um token ps-* (a onda é desenhada no canvas, que não lê classe). */
function token(el: Element, name: string): string {
  return getComputedStyle(el).getPropertyValue(name).trim() || getComputedStyle(document.documentElement).getPropertyValue(name).trim()
}

/**
 * Onda grande do palco novo (v5 linhas 109 a 140, v6 buildWave): forma de onda na cor da
 * seção a 34% com a parte tocada mais clara, linhas de compasso, blocos das seções (tocar
 * arma; parado, vai pra seção), selo com o nome, etiqueta PRÓXIMA, REPETE ou LOOP, seta
 * tracejada do fim da atual até a armada e régua embaixo (parado, encostar e arrastar buscam; tocando,
 * a busca vale uma vez ao soltar o dedo, com a prévia no playhead durante o arrasto).
 * Playhead e parte tocada andam por useFrame, direto no DOM. Os selos que não cabem lado a
 * lado descem de linha (nunca se encostam, nunca cortam o nome). Sem `sectionsAllowed`: só a
 * onda e a régua.
 */
export function WaveformSections({
  peaks, duration, sections, currentSection, isPlaying, intent, loopOn, barLines, sectionsAllowed, clock, onTapSection, onSeek,
}: WaveformSectionsProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  const baseRef = useRef<HTMLCanvasElement>(null)
  const playedRef = useRef<HTMLCanvasElement>(null)
  const blocksRef = useRef<HTMLDivElement>(null)
  const rulerRef = useRef<HTMLDivElement>(null)
  const arcRef = useRef<SVGSVGElement>(null)
  const playheadRef = useRef<HTMLDivElement>(null)
  const widthRef = useRef(0)
  const lastFracRef = useRef<number | null>(null)
  const drawnRef = useRef<{ key: string; peaks: Float32Array | null } | null>(null)
  const pressRef = useRef<RulerPress | null>(null)
  // Prévia do arrasto tocando (segundos da música): o playhead mostra ela até soltar o dedo.
  const previewRef = useRef<number | null>(null)
  const lastSeekRef = useRef<number | null>(null)
  const layoutRef = useRef<() => void>(() => {})

  const dur = Number.isFinite(duration) && duration > 0 ? duration : 0
  const showBlocks = sectionsAllowed && dur > 0
  const selfLoop = isSelfLoop(intent, currentSection)
  const target = intent ? sections.find((s) => s.index === intent.target) : undefined
  const armedIndex = target && !selfLoop ? target.index : null
  const kind = armedIndex !== null ? armLabel(intent, currentSection)?.kind : undefined
  const looping = loopOn || selfLoop
  const current = sections.find((s) => s.index === currentSection)

  const blocks: Block[] = showBlocks
    ? sections.flatMap((s) => {
      const left = clamp01(s.start / dur)
      const right = clamp01(s.end / dur)
      if (!(right > left)) return []
      const isCurrent = s.index === currentSection
      const isArmed = s.index === armedIndex
      const state: BlockState | undefined = isArmed ? (isCurrent ? 'repete' : 'armada') : isCurrent ? 'atual' : undefined
      const tag: BlockTag | null = isArmed ? (kind === 'repete' ? 'REPETE' : 'PRÓXIMA') : isCurrent && looping ? 'LOOP' : null
      return [{ s, left, width: right - left, state, tag, loop: isCurrent && looping }]
    })
    : []
  // Seta: do fim da atual até o começo da armada, só quando o alvo é outra seção.
  const arcFrom = showBlocks && armedIndex !== null && armedIndex !== currentSection && current ? current : null
  const arcTo = arcFrom ? target ?? null : null
  const rulerTimes: number[] = []
  for (let t = 0; dur > 0 && t < dur; t += RULER_STEP) rulerTimes.push(t)

  /** Playhead e parte tocada pela posição ouvida. Só escreve quando muda. */
  const paint = () => {
    const ph = playheadRef.current
    const played = playedRef.current
    if (!ph || !played) return
    const pos = previewRef.current ?? clock.position()
    const f = dur > 0 && Number.isFinite(pos) ? clamp01(pos / dur) : 0
    // Só escreve quando o playhead anda um pixel do aparelho (tocando, ~0,07 px por quadro numa música de 5 min).
    const w = widthRef.current
    const step = w > 0 ? Math.round(f * w * (window.devicePixelRatio || 1)) : f
    if (step === lastFracRef.current) return
    lastFracRef.current = step
    ph.style.transform = `translateX(${(f * widthRef.current).toFixed(1)}px)`
    played.style.clipPath = `inset(0 ${((1 - f) * 100).toFixed(3)}% 0 0)`
  }

  /** Canvas no devicePixelRatio; redesenha só quando muda tamanho, picos, seções ou compassos. */
  const drawWave = (root: HTMLElement, w: number, h: number) => {
    const base = baseRef.current
    const played = playedRef.current
    if (!base || !played || !(w > 0 && h > 0)) return
    const dpr = window.devicePixelRatio || 1
    const secKey = showBlocks ? sections.map((s) => `${s.start}:${s.end}:${s.color}`).join('|') : ''
    const key = `${w}x${h}@${dpr}|${dur}|${secKey}|${barLines ? barLines.join(',') : ''}`
    if (drawnRef.current && drawnRef.current.key === key && drawnRef.current.peaks === peaks) return
    drawnRef.current = { key, peaks }
    for (const c of [base, played]) {
      c.width = Math.round(w * dpr)
      c.height = Math.round(h * dpr)
    }
    const a = base.getContext('2d')
    const p = played.getContext('2d')
    if (!a || !p) return
    a.setTransform(dpr, 0, 0, dpr, 0, 0)
    p.setTransform(dpr, 0, 0, dpr, 0, 0)
    a.clearRect(0, 0, w, h)
    p.clearRect(0, 0, w, h)
    const blocksBottom = h - ZONE
    const line = token(root, '--color-ps-bone')
    const neutral = token(root, '--color-ps-mut')

    // Linhas de compasso, a cada 4 mais fortes. Compasso a menos de 6 px do outro: só as fortes.
    if (barLines && barLines.length > 0 && dur > 0 && line) {
      const span = barLines[barLines.length - 1] - barLines[0]
      const dense = barLines.length > 1 && (span / dur) * w / (barLines.length - 1) < 6
      a.fillStyle = line
      barLines.forEach((t, i) => {
        if (!(t >= 0 && t <= dur)) return
        const strong = i % 4 === 0
        if (!strong && dense) return
        a.globalAlpha = strong ? 0.07 : 0.025
        a.fillRect(Math.round((t / dur) * w), 0, 1, blocksBottom)
      })
      a.globalAlpha = 1
    }

    // Onda: uma barra de 2 px a cada 3 px, com o maior pico do trecho; cor da seção no meio da barra.
    if (peaks && peaks.length > 0 && dur > 0) {
      const top = showBlocks ? 40 : 12
      const bottom = blocksBottom - 6
      const mid = (top + bottom) / 2
      const amp = Math.max(8, (bottom - top) / 2)
      const n = peaks.length
      const light = new Map<string, string>()
      for (let x = 0; x < w; x += 3) {
        const i0 = Math.min(n - 1, Math.floor((x / w) * n))
        const i1 = Math.max(i0 + 1, Math.min(n, Math.floor(((x + 3) / w) * n)))
        let peak = 0
        for (let i = i0; i < i1; i++) if (peaks[i] > peak) peak = peaks[i]
        const t = ((x + 1) / w) * dur
        const color = (showBlocks ? sections.find((s) => t >= s.start && t < s.end)?.color : undefined) ?? neutral
        if (!color) continue
        let bright = light.get(color)
        if (!bright) { bright = lighter(color); light.set(color, bright) }
        const bh = Math.max(1, Math.min(1, peak) * amp)
        a.globalAlpha = 0.34
        a.fillStyle = color
        a.fillRect(x, mid - bh, 2, bh * 2)
        p.globalAlpha = 1
        p.fillStyle = bright
        p.fillRect(x, mid - bh, 2, bh * 2)
      }
      a.globalAlpha = 1
    }
  }

  /** Selos e etiquetas: mede, escolhe a linha de cada um (placeLabels) e escreve top/left. */
  const placeSelos = (w: number, h: number): Placed[] => {
    const container = blocksRef.current
    if (!container || !(w > 0 && h > 0)) return []
    const els = [...container.querySelectorAll<HTMLElement>('[data-block]')]
    const rows = clamp(Math.floor((h - ROWS_END - ROW_TOP - 22) / ROW) + 1, 1, MAX_ROWS)
    // Largura exata (offsetWidth arredonda e o selo podia passar meio pixel da folga).
    const widthOf = (el: HTMLElement | null) => (el ? el.getBoundingClientRect().width : 0)
    const measured = els.map((el, k) => {
      const b = blocks[k]
      const selo = el.querySelector<HTMLElement>('[data-selo]')
      const tag = el.querySelector<HTMLElement>('[data-tag]')
      const leftPx = (b?.left ?? 0) * w
      setFlag(el, 'narrow', (b?.width ?? 0) * w < TOUCH)
      if (selo) delete selo.dataset.fit
      if (tag) delete tag.dataset.fit
      const seloW = widthOf(selo)
      const box: LabelBox = { x: leftPx + LABEL_X, width: seloW, priority: tag ? 0 : b?.state ? 1 : 2 }
      if (tag) box.tagWidth = widthOf(tag)
      return { selo, tag, leftPx, seloW, box }
    })
    const spots = placeLabels(measured.map((m) => m.box), rows, GAP, EDGE, w - EDGE)
    const placed: Placed[] = []
    measured.forEach(({ selo, tag, leftPx, seloW, box }, k) => {
      const spot = spots[k]
      if (spot === null) {
        if (selo) selo.dataset.fit = 'none'
        if (tag) tag.dataset.fit = 'none'
        return
      }
      const top = ROW_TOP + ROW * spot.row
      if (selo) { selo.style.left = `${spot.x - leftPx}px`; selo.style.top = `${top}px` }
      placed.push({ l: spot.x, r: spot.x + seloW, bottom: top + 22 })
      if (!tag) return
      const tagW = box.tagWidth ?? 0
      // Embaixo do selo (v5) ou, sem lugar, ao lado dele, centrada na altura do selo (22 x 18).
      const tagX = spot.inline ? spot.x + seloW + INLINE_TAG_GAP : spot.x
      const tagTop = spot.inline ? top + 2 : top + ROW
      tag.style.left = `${tagX - leftPx}px`
      tag.style.top = `${tagTop}px`
      placed.push({ l: tagX, r: tagX + tagW, bottom: tagTop + 18 })
    })
    return placed
  }

  /** Rótulos da régua: aparece quem cabe sem encostar no anterior nem na borda. */
  const fitRuler = (w: number) => {
    const band = rulerRef.current
    if (!band || !(w > 0) || !(dur > 0)) return
    let lastRight = -Infinity
    for (const el of band.querySelectorAll<HTMLElement>('[data-ruler-label]')) {
      delete el.dataset.fit
      const x = Math.max(RULER_FIRST, (Number(el.dataset.t) / dur) * w + 5)
      const lw = el.getBoundingClientRect().width
      if (x >= lastRight + RULER_GAP && x + lw <= w - RULER_EDGE) {
        lastRight = x + lw
        el.style.left = `${x}px`
      } else {
        el.dataset.fit = 'none'
      }
    }
  }

  /**
   * Seta (v6 drawArc). Nunca passa por cima nem por baixo de selo: a subida é a do v6 até o
   * ponto em que a curva (com o contorno) fica 4 px abaixo do selo mais baixo no caminho; com
   * pouco espaço ela achata abaixo de 26. Os selos terminam 8 px acima da faixa da régua, então
   * sempre sobra curva (13 px ou mais de altura).
   */
  const drawArc = (w: number, h: number, placed: Placed[]) => {
    const svg = arcRef.current
    if (!svg || !arcFrom || !arcTo || !(w > 0 && h > 0)) return
    const baseY = h - ARC_BASE
    const x1 = clamp((arcFrom.end / dur) * w, ARC_EDGE, w - ARC_EDGE)
    const x2 = clamp((arcTo.start / dur) * w, ARC_EDGE, w - ARC_EDGE)
    // Bolinha (raio 4,5), ponta (6,5 pra cada lado) e traço passam um pouco das pontas da curva.
    const lo = Math.min(x1, x2) - 8
    const hi = Math.max(x1, x2) + 8
    const under = placed.reduce((m, p) => (p.r > lo && p.l < hi ? Math.max(m, p.bottom) : m), -Infinity)
    const v6Top = Math.max(30, h - RULER - 60)
    const room = baseY - under - ARC_CLEAR - ARC_STROKE
    // Décimo pra baixo: o caminho escreve a subida com uma casa e não pode subir além da conta.
    const cap = Math.floor(Math.min(v6Top, liftForRise(room)) * 10) / 10
    const d = arcRise(cap) <= room ? arcPath(x1, x2, baseY, cap) : ''
    const f = (n: number) => n.toFixed(1)
    svg.querySelector('[data-arc-bg]')?.setAttribute('d', d)
    svg.querySelector('[data-arc-dash]')?.setAttribute('d', d)
    const dot = svg.querySelector('[data-arc-dot]')
    dot?.setAttribute('cx', f(x1))
    dot?.setAttribute('cy', f(baseY))
    svg.querySelector('[data-arc-head]')?.setAttribute('d', `M${f(x2 - 6.5)} ${f(baseY - 11)} L${f(x2)} ${f(baseY - 1)} L${f(x2 + 6.5)} ${f(baseY - 11)}Z`)
  }

  const layout = () => {
    const root = rootRef.current
    if (!root) return
    const w = root.clientWidth
    const h = root.clientHeight
    if (w !== widthRef.current) widthRef.current = w
    lastFracRef.current = null
    drawWave(root, w, h)
    const placed = placeSelos(w, h)
    fitRuler(w)
    drawArc(w, h, placed)
    paint()
  }
  // O ResizeObserver e as fontes chamam sempre a conta mais nova (só troca a referência).
  useLayoutEffect(() => { layoutRef.current = layout })
  // A conta (medir selos, desenhar, seta) só roda quando muda o que ela usa, antes de pintar a
  // tela; nunca numa renderização igual (o App renderiza a cada quadro tocando, com arrays novos
  // de mesmo conteúdo) nem por quadro. Tamanho e fontes: ResizeObserver e fonts.ready abaixo.
  const sectionsKey = sections.map((s) => `${s.index}|${s.start}|${s.end}|${s.color}|${s.label}`).join(';')
  const barsKey = barLines ? `${barLines.length}|${barLines[0]}|${barLines[barLines.length >> 1]}|${barLines[barLines.length - 1]}` : '-'
  const intentKey = intent ? `${intent.target}|${intent.plays}` : '-'
  const layoutKey = `${dur}#${sectionsAllowed}#${currentSection}#${loopOn}#${intentKey}#${barsKey}#${sectionsKey}`
  useLayoutEffect(() => { layoutRef.current() }, [layoutKey, peaks])
  useFrame(paint) // a posição muda tocando e também parado (busca pela régua, ir pro início)
  // Janela mudou de tamanho ou as fontes chegaram: refaz a conta (sem renderizar o React).
  useEffect(() => {
    const root = rootRef.current
    let alive = true
    document.fonts?.ready.then(() => { if (alive) layoutRef.current() })
    if (!root || typeof ResizeObserver === 'undefined') return () => { alive = false }
    const ro = new ResizeObserver(() => layoutRef.current())
    ro.observe(root)
    return () => { alive = false; ro.disconnect() }
  }, [])

  /** Segundos da música no ponto `clientX` da régua; nulo sem largura ou sem música. */
  const timeAt = (el: HTMLElement, clientX: number): number | null => {
    const r = el.getBoundingClientRect()
    if (!(r.width > 0) || !(dur > 0)) return null
    return clamp01((clientX - r.left) / r.width) * dur
  }
  const seekFrom = (el: HTMLElement, clientX: number) => {
    const t = timeAt(el, clientX)
    if (t === null || t === lastSeekRef.current) return
    lastSeekRef.current = t
    onSeek(t)
  }
  // Parado, como sempre: encostar e arrastar buscam na hora. Tocando (Ruling I1-regua), a busca não
  // tem volta: nada acontece ao encostar; o toque (até 8 px de lado) busca ao soltar, no ponto do
  // toque; o arrasto mostra a prévia no playhead e busca uma vez só, onde o dedo soltou. Cancelado
  // ou saindo da régua sem captura, não busca.
  const onRulerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button > 0) return
    pressRef.current = { playing: isPlaying, downX: e.clientX, dragging: false }
    previewRef.current = null
    lastSeekRef.current = null
    try {
      e.currentTarget.setPointerCapture?.(e.pointerId)
    } catch {
      // Sem captura o arrasto vale enquanto o dedo estiver em cima da régua (sair dela solta).
    }
    if (!isPlaying) seekFrom(e.currentTarget, e.clientX)
  }
  const onRulerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const press = pressRef.current
    if (!press) return
    if (!press.playing) { seekFrom(e.currentTarget, e.clientX); return }
    if (!press.dragging && Math.abs(e.clientX - press.downX) <= RULER_DRAG_PX) return
    press.dragging = true
    previewRef.current = timeAt(e.currentTarget, e.clientX)
    paint()
  }
  const stopDrag = () => {
    pressRef.current = null
    if (previewRef.current === null) return
    previewRef.current = null
    paint()
  }
  const onRulerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    const press = pressRef.current
    pressRef.current = null
    previewRef.current = null
    if (!press?.playing) return
    const t = timeAt(e.currentTarget, press.dragging ? e.clientX : press.downX)
    if (t !== null) onSeek(t)
    paint()
  }

  return (
    <div
      ref={rootRef}
      data-waveform=""
      className="relative isolate h-full w-full min-w-0 select-none overflow-hidden rounded-ps-2xl bg-ps-ink-0 font-ps-sans inset-ring inset-ring-ps-line"
    >
      <canvas ref={baseRef} data-wave="base" aria-hidden="true" className="pointer-events-none absolute inset-0 size-full" />
      <canvas ref={playedRef} data-wave="tocada" aria-hidden="true" className="pointer-events-none absolute inset-0 size-full [clip-path:inset(0_100%_0_0)]" />
      {showBlocks && (
        <div ref={blocksRef} role="group" aria-label="Seções na onda" className="absolute inset-x-0 top-0 bottom-ps-touch">
          {blocks.map((b) => {
            const name = isPlaying ? `Armar ${b.s.label}` : `Ir para ${b.s.label}`
            const armed = b.state === 'armada' || b.state === 'repete'
            return (
              <button
                key={b.s.index}
                type="button"
                data-block=""
                data-state={b.state}
                data-loop={b.loop ? 'true' : undefined}
                aria-label={name}
                aria-pressed={isPlaying ? armed : undefined}
                title={name}
                onClick={() => onTapSection(b.s.index)}
                className={cx(BLOCK, TINT[b.state ?? 'outra'], armed && ARMED, LOOP_BAR)}
                style={{ left: pct(b.left), width: pct(b.width), '--ps-c': b.s.color } as CSSProperties}
              >
                <span data-selo="" className={cx(SELO, b.state && b.state !== 'armada' && SELO_CURRENT)}>{b.s.label}</span>
                {b.tag && (
                  <span data-tag="" className={cx(TAG, TAG_TONE[b.tag])}>
                    {b.tag === 'LOOP' && <Icon name="loop" className="size-[11px]" />}
                    {b.tag}
                  </span>
                )}
              </button>
            )
          })}
        </div>
      )}
      {arcTo && (
        <svg ref={arcRef} data-arc="" aria-hidden="true" className="pointer-events-none absolute inset-0 z-[2] size-full overflow-visible">
          <path data-arc-bg="" className="fill-none stroke-ps-ink-0 opacity-65 [stroke-linecap:round] [stroke-width:6]" />
          <path data-arc-dash="" className="fill-none stroke-ps-arm [stroke-dasharray:7_6] [stroke-linecap:round] [stroke-width:2.5]" />
          <circle data-arc-dot="" r="4.5" className="fill-ps-ink-0 stroke-ps-arm [stroke-width:2]" />
          <path data-arc-head="" className="fill-ps-arm stroke-ps-ink-0/60 [stroke-width:1]" />
        </svg>
      )}
      <div ref={rulerRef} data-ruler="" aria-hidden="true" className="pointer-events-none absolute inset-x-0 bottom-0 h-ps-touch border-t border-ps-line bg-ps-line/35">
        <div className="absolute inset-x-0 bottom-0 h-[22px]">
        {rulerTimes.map((t) => (
          <Fragment key={t}>
            <span className="absolute -top-px h-1.5 w-px bg-ps-line-2" style={{ left: pct(t / dur) }} />
            <span
              data-ruler-label="" data-t={t}
              className="ps-num absolute inset-y-0 flex items-center whitespace-nowrap text-ps-micro leading-none font-semibold text-ps-dim data-[fit=none]:hidden"
              style={{ left: `calc(${pct(t / dur)} + 5px)` }}
            >
              {fmt(t)}
            </span>
          </Fragment>
        ))}
        </div>
      </div>
      {/* Faixa de toque da régua: os mesmos 44 px da faixa que se vê; os blocos terminam em cima dela.
          Tocando, a busca vale ao soltar o dedo (Ruling I1-regua). */}
      <div
        data-testid="regua"
        title="Arraste pra buscar"
        className="absolute inset-x-0 bottom-0 z-[4] h-ps-touch cursor-ew-resize touch-none"
        onPointerDown={onRulerDown}
        onPointerMove={onRulerMove}
        onPointerUp={onRulerUp}
        onPointerCancel={stopDrag}
        onLostPointerCapture={stopDrag}
        onPointerLeave={stopDrag}
      />
      <div
        ref={playheadRef}
        data-playhead=""
        aria-hidden="true"
        className="pointer-events-none absolute inset-y-0 left-0 z-[5] -ml-px w-0.5 bg-ps-bone shadow-[0_0_10px_color-mix(in_srgb,var(--color-ps-bone)_80%,transparent)] will-change-transform before:absolute before:top-0 before:-left-[5px] before:border-x-[6px] before:border-t-[9px] before:border-x-transparent before:border-t-ps-bone before:content-['']"
      />
    </div>
  )
}

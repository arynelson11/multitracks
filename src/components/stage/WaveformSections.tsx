import { Fragment, useEffect, useLayoutEffect, useRef } from 'react'
import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react'
import { armLabel, isSelfLoop } from '../../lib/sectionArm'
import type { ArmIntent, StageClock, StageSection } from '../../lib/stageContracts'
import { cx } from '../ui'
import { Icon } from './icons'
import { setFlag } from './stageDom'
import { useFrame } from './useFrame'
import { arcPath, lighter, placeLabels } from './wavePeaks'
import type { LabelBox } from './wavePeaks'

export interface WaveformSectionsProps {
  peaks: Float32Array | null; duration: number; sections: StageSection[]; currentSection: number; isPlaying: boolean
  intent: ArmIntent | null; loopOn: boolean; barLines: number[] | null; sectionsAllowed: boolean
  clock: Pick<StageClock, 'position'>; onTapSection(i: number): void; onSeek(t: number): void
}

/** Régua embaixo da onda (v5). */
const RULER = 22
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
/** Fundo da área dos blocos fica pra bolinha e ponta da seta (e acima da faixa de toque da régua). */
const ARC_BAND = 30
const MAX_ROWS = 4
/** Alvo de toque mínimo: bloco mais estreito ganha área de toque de 44 px. */
const TOUCH = 44

type BlockState = 'atual' | 'armada' | 'repete'
type BlockTag = 'PRÓXIMA' | 'REPETE' | 'LOOP'
/** Bloco de uma seção na onda: começo e largura em fração da música. */
interface Block { s: StageSection; left: number; width: number; state: BlockState | undefined; tag: BlockTag | null; loop: boolean }
/** Selo posto na tela (px), pra seta não passar por cima. */
interface Placed { l: number; r: number; bottom: number }

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
// Bloco mais estreito que 44 px: área de toque invisível de 44 px centrada nele, por cima dos vizinhos.
const NARROW =
  "data-[narrow=true]:before:absolute data-[narrow=true]:before:inset-y-0 data-[narrow=true]:before:left-1/2 data-[narrow=true]:before:z-[1] data-[narrow=true]:before:w-ps-touch data-[narrow=true]:before:-translate-x-1/2 data-[narrow=true]:before:content-['']"
// v5 .blk.looping:before: barrinha clara no topo do bloco com loop.
const LOOP_BAR =
  "data-[loop=true]:after:absolute data-[loop=true]:after:inset-x-0.5 data-[loop=true]:after:top-0 data-[loop=true]:after:h-[3px] data-[loop=true]:after:rounded-b-[2px] data-[loop=true]:after:bg-ps-bone data-[loop=true]:after:content-['']"
// v5 .lb: selo na cor da seção com o nome inteiro numa linha (nunca corta nem põe reticências).
// A linha (top) e o deslocamento (left) vêm da conta dos selos, escritos direto no DOM.
const SELO =
  'absolute left-[7px] top-[10px] z-[3] flex h-[22px] items-center whitespace-nowrap rounded-ps-xs bg-(--ps-c) px-[7px] text-ps-sm leading-none font-extrabold tracking-[0.05em] text-ps-ink-0 data-[fit=none]:hidden'
const SELO_CURRENT = 'shadow-[0_0_0_2px_var(--color-ps-ink-0),0_0_0_3.5px_var(--ps-c)]'
// v5 .tg / .lp: etiqueta embaixo do selo. Armado em branco; LOOP com contorno claro.
const TAG =
  'absolute left-[7px] top-[38px] z-[3] flex h-[18px] items-center gap-1 whitespace-nowrap rounded-ps-xs px-1.5 text-ps-micro leading-none font-extrabold tracking-[0.1em] data-[fit=none]:hidden'
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
 * tracejada do fim da atual até a armada e régua embaixo (arrastar busca, tocando ou parado).
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
  const dragRef = useRef(false)
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
    const pos = clock.position()
    const f = dur > 0 && Number.isFinite(pos) ? clamp01(pos / dur) : 0
    if (f === lastFracRef.current) return
    lastFracRef.current = f
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
    const hb = h - RULER
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
        a.fillRect(Math.round((t / dur) * w), 0, 1, hb)
      })
      a.globalAlpha = 1
    }

    // Onda: uma barra de 2 px a cada 3 px, com o maior pico do trecho; cor da seção no meio da barra.
    if (peaks && peaks.length > 0 && dur > 0) {
      const top = showBlocks ? 44 : 12
      const bottom = hb - 8
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
    const rows = clamp(Math.floor((h - RULER - ARC_BAND - ROW_TOP - 22) / ROW) + 1, 1, MAX_ROWS)
    const measured = els.map((el, k) => {
      const b = blocks[k]
      const selo = el.querySelector<HTMLElement>('[data-selo]')
      const tag = el.querySelector<HTMLElement>('[data-tag]')
      const leftPx = (b?.left ?? 0) * w
      setFlag(el, 'narrow', (b?.width ?? 0) * w < TOUCH)
      if (selo) delete selo.dataset.fit
      if (tag) delete tag.dataset.fit
      const width = Math.max(selo?.offsetWidth ?? 0, tag?.offsetWidth ?? 0)
      // Perto da borda direita o selo recua pra caber inteiro na onda.
      const x = Math.max(EDGE, Math.min(leftPx + LABEL_X, w - EDGE - width))
      const box: LabelBox = { x, width, span: tag ? 2 : 1, priority: tag ? 0 : b?.state ? 1 : 2 }
      return { selo, tag, leftPx, box }
    })
    const rowOf = placeLabels(measured.map((m) => m.box), rows, GAP)
    const placed: Placed[] = []
    measured.forEach(({ selo, tag, leftPx, box }, k) => {
      const row = rowOf[k]
      if (row === null) {
        if (selo) selo.dataset.fit = 'none'
        if (tag) tag.dataset.fit = 'none'
        return
      }
      const left = `${(box.x - leftPx).toFixed(1)}px`
      if (selo) { selo.style.left = left; selo.style.top = `${ROW_TOP + ROW * row}px` }
      if (tag) { tag.style.left = left; tag.style.top = `${ROW_TOP + ROW * (row + 1)}px` }
      placed.push({ l: box.x, r: box.x + box.width, bottom: ROW_TOP + ROW * (row + box.span) - 6 })
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
      const lw = el.offsetWidth
      if (x >= lastRight + RULER_GAP && x + lw <= w - RULER_EDGE) {
        lastRight = x + lw
        el.style.left = `${x.toFixed(1)}px`
      } else {
        el.dataset.fit = 'none'
      }
    }
  }

  /** Seta (v6 drawArc), baixa o bastante pra passar por baixo dos selos que ela cruza. */
  const drawArc = (w: number, h: number, placed: Placed[]) => {
    const svg = arcRef.current
    if (!svg || !arcFrom || !arcTo || !(w > 0 && h > 0)) return
    const hb = h - RULER
    const baseY = hb - 12
    const x1 = clamp((arcFrom.end / dur) * w, 6, w - 6)
    const x2 = clamp((arcTo.start / dur) * w, 8, w - 8)
    const lo = Math.min(x1, x2)
    const hi = Math.max(x1, x2)
    const under = placed.reduce((m, p) => (p.r > lo && p.l < hi ? Math.max(m, p.bottom) : m), 0)
    const d = arcPath(x1, x2, baseY, Math.min(hb - 60, (baseY - under - 7) / 0.75))
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
  // Depois de cada renderização (antes de pintar a tela): desenha, acomoda os selos e pinta.
  useLayoutEffect(() => {
    layoutRef.current = layout
    layout()
  })
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

  const seekFrom = (el: HTMLElement, clientX: number) => {
    const r = el.getBoundingClientRect()
    if (!(r.width > 0) || !(dur > 0)) return
    const t = clamp01((clientX - r.left) / r.width) * dur
    if (t === lastSeekRef.current) return
    lastSeekRef.current = t
    onSeek(t)
  }
  const onRulerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button > 0) return
    dragRef.current = true
    lastSeekRef.current = null
    try {
      e.currentTarget.setPointerCapture?.(e.pointerId)
    } catch {
      // Sem captura o arrasto vale enquanto o dedo estiver em cima da régua.
    }
    seekFrom(e.currentTarget, e.clientX)
  }
  const onRulerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (dragRef.current) seekFrom(e.currentTarget, e.clientX)
  }
  const stopDrag = () => { dragRef.current = false }

  return (
    <div
      ref={rootRef}
      data-waveform=""
      className="relative h-full w-full min-w-0 select-none overflow-hidden rounded-ps-2xl bg-ps-ink-0 font-ps-sans inset-ring inset-ring-ps-line"
    >
      <canvas ref={baseRef} data-wave="base" aria-hidden="true" className="pointer-events-none absolute inset-0 size-full" />
      <canvas ref={playedRef} data-wave="tocada" aria-hidden="true" className="pointer-events-none absolute inset-0 size-full [clip-path:inset(0_100%_0_0)]" />
      {showBlocks && (
        <div ref={blocksRef} role="group" aria-label="Seções na onda" className="absolute inset-x-0 top-0 bottom-[22px]">
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
                className={cx(BLOCK, TINT[b.state ?? 'outra'], armed && ARMED, NARROW, LOOP_BAR)}
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
      <div ref={rulerRef} aria-hidden="true" className="pointer-events-none absolute inset-x-0 bottom-0 h-[22px] border-t border-ps-line bg-ps-line/35">
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
      {/* Faixa de toque da régua: os 22 px dela e mais 22 acima (44 px), por cima do pé dos blocos. */}
      <div
        data-testid="regua"
        title="Arraste pra buscar"
        className="absolute inset-x-0 bottom-0 z-[4] h-ps-touch cursor-ew-resize touch-none"
        onPointerDown={onRulerDown}
        onPointerMove={onRulerMove}
        onPointerUp={stopDrag}
        onPointerCancel={stopDrag}
        onLostPointerCapture={stopDrag}
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

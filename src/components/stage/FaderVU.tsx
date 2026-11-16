import { useRef, useState } from 'react'
import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent, ReactNode } from 'react'
import {
  FADER_MAX_DB, FADER_MAX_GAIN, FADER_MIN_DB, dbText, dragFader, faderToGain, gainToFader, gestureIntent, stepGainDb,
} from '../../lib/faderScale'
import { cx } from '../ui'
import { useFrame } from './useFrame'

export interface FaderVUProps {
  /** Ganho linear do canal ou do PRINCIPAL (1 = 0 dB). */
  gain: number
  /** Canal: um medidor no trilho. PRINCIPAL: trilho largo com L e R e a escala em dB ao lado. */
  variant: 'canal' | 'principal'
  /** Faixa atrás do trilho, do pé até a tampa (channelFaderFill da Parte 1). O PRINCIPAL não tem. */
  fill?: string
  /** Calado (M, Solo de outro canal, mudo geral): a linha da tampa perde a cor. */
  quiet: boolean
  /** Nível de 0 a 1 lido a cada quadro: um valor no canal, L e R no PRINCIPAL. */
  readLevel: () => number | { l: number; r: number }
  /** Nome acessível ("Volume Bateria"). */
  label: string
  onChange(gain: number): void
  className?: string
  /** Por cima do fader (balão da contagem no canal de Click). */
  children?: ReactNode
}

/** Folga em cima e embaixo do curso (o centro da tampa vai de 12 px do topo a 12 px do pé). */
const PAD_PX = 12
/** Medidor do v6: passo a cada 45 ms, sobe rápido (0,85) e desce devagar (0,25); o pico segura 700 ms e desce 0,02 por passo. */
const METER_TICK_MS = 45
const METER_ATTACK = 0.85
const METER_RELEASE = 0.25
const PEAK_HOLD_MS = 700
const PEAK_FALL = 0.02

interface Meter { v: number; pk: number; pt: number }

function stepMeter(m: Meter, level: number, now: number): void {
  const target = Number.isFinite(level) ? Math.min(1, Math.max(0, level)) : 0
  m.v += (target - m.v) * (target > m.v ? METER_ATTACK : METER_RELEASE)
  if (m.v >= m.pk) {
    m.pk = m.v
    m.pt = now
  } else if (now - m.pt > PEAK_HOLD_MS) {
    m.pk = Math.max(m.v, m.pk - PEAK_FALL)
  }
}

/** Escreve a variável só quando o valor (3 casas) muda. */
function writeVar(el: HTMLElement | null, name: string, value: number): void {
  if (!el) return
  const s = value.toFixed(3)
  if (el.style.getPropertyValue(name) !== s) el.style.setProperty(name, s)
}

/** Teclado (Ruling T14-teclado): setas ±1 dB, PageUp e PageDown ±6 dB; Home e End vão ao silêncio e ao topo. */
const KEY_DB: Partial<Record<string, number>> = { ArrowUp: 1, ArrowDown: -1, PageUp: 6, PageDown: -6 }
/** Valor acessível em dB, de −63 (o pé; o silêncio também fica aqui, com "−∞ dB" no texto) a +6. */
const ARIA_MIN_DB = Math.round(FADER_MIN_DB)

function ariaDb(g: number): number {
  if (!(g > 0)) return ARIA_MIN_DB
  return Math.min(FADER_MAX_DB, Math.max(ARIA_MIN_DB, Math.round(20 * Math.log10(g) * 10) / 10))
}

interface Drag { id: number; x0: number; y0: number; f0: number; g0: number; moving: boolean; sent: number }

/** Escala do PRINCIPAL: posição do fader (1 no topo) e o texto, com sinal de menos tipográfico. */
const SCALE: ReadonlyArray<{ f: number; text: string }> = [
  { f: 1, text: '+6' }, { f: 0.75, text: '0' }, { f: 0.375, text: '−12' }, { f: 0.1875, text: '−24' }, { f: 0, text: '−∞' },
]

// v5 .fd: área inteira é o alvo do arrasto (vertical); de lado, o navegador rola o mixer (touch-pan-x).
// Pega foco (teclado) com o anel laranja por dentro, pra não ser cortado pela caixa do mixer.
const ROOT =
  'group relative min-h-[60px] w-full flex-1 cursor-ns-resize touch-pan-x select-none rounded-ps-sm focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ps-or'
const TICKS = 'pointer-events-none absolute inset-y-3 left-1/2 -translate-x-1/2 bg-[image:repeating-linear-gradient(to_bottom,var(--color-ps-line)_0_1px,transparent_1px_12.5%)]'
const FILL = 'pointer-events-none absolute bottom-3 left-1/2 h-[calc((100%-24px)*var(--f))] w-[30px] -translate-x-1/2 rounded-t-[3px] bg-(image:--fill)'
const ZERO = 'pointer-events-none absolute top-[calc(12px+(100%-24px)*0.25)] left-1/2 h-px w-[38px] -translate-x-1/2 bg-ps-line-3'
const RAIL = 'pointer-events-none absolute inset-y-3 left-1/2 -translate-x-1/2 overflow-hidden bg-ps-ink-0 inset-ring inset-ring-ps-line'
// Nível segmentado (3 px aceso, 1 px apagado) revelado de baixo pra cima por --v.
const VU =
  'absolute inset-y-0.5 rounded-[3px] bg-[image:linear-gradient(to_top,var(--color-ps-moss)_0%,var(--color-ps-moss-hi)_52%,var(--color-ps-alert)_80%,var(--color-ps-mute)_97%)] [clip-path:inset(calc((1-var(--v,0))*100%)_0_0_0)] [mask-image:repeating-linear-gradient(to_top,var(--color-ps-ink)_0_3px,transparent_3px_4px)]'
const PEAK = 'absolute bottom-[calc(2px+(100%-6px)*var(--pk,0))] h-0.5 bg-ps-bone opacity-75'
// Tampa com a linha na cor do grupo (--c, posto pelo canal ou pelo PRINCIPAL); calada, cinza e sem brilho.
const CAP =
  'pointer-events-none absolute top-[calc(12px+(100%-24px)*(1-var(--f)))] left-1/2 z-[2] -translate-x-1/2 -translate-y-1/2 rounded-ps-xs bg-linear-to-b from-ps-s3 to-ps-s2 shadow-[inset_0_1px_0_var(--color-ps-line-2),0_0_0_1px_var(--color-ps-line-2),0_4px_10px_color-mix(in_srgb,var(--color-ps-ink-0)_70%,transparent)] group-hover:shadow-[inset_0_1px_0_var(--color-ps-line-2),0_0_0_1px_var(--color-ps-line-3),0_4px_12px_color-mix(in_srgb,var(--color-ps-ink-0)_80%,transparent)] before:absolute before:inset-x-1.5 before:top-1/2 before:-mt-[1.5px] before:h-[3px] before:rounded-[2px] before:bg-(--c) before:shadow-[0_0_8px_color-mix(in_srgb,var(--c)_60%,transparent)] group-data-[quiet=true]:before:bg-ps-dim group-data-[quiet=true]:before:shadow-none'
// Balão com o valor em dB, só durante o arrasto.
const DB =
  'ps-num pointer-events-none absolute bottom-[calc(100%+6px)] left-1/2 -translate-x-1/2 rounded-[5px] bg-ps-bone px-1.5 py-[3px] text-ps-micro leading-none font-bold whitespace-nowrap text-ps-ink opacity-0 transition-opacity duration-100 group-data-[dragging=true]:opacity-100'
// 18 px: o número mais largo (−12) cabe e fica a 4 px da tampa de 56 px (que começa em 22 px).
const SCALE_BOX = 'ps-num pointer-events-none absolute inset-y-3 left-0 w-[18px] text-ps-micro leading-none font-semibold text-ps-dim'

/**
 * Fader do mixer novo (v5 .fd): a tampa só anda ARRASTANDO na vertical (o arrasto começa depois
 * de 3 px, e só se a vertical domina: de lado é a rolagem do mixer; tocar sem arrastar não muda
 * nada; se o navegador cancela o gesto, o valor de antes volta) e o duplo clique volta a 0 dB; o
 * balão mostra o valor durante o arrasto. Com foco, o teclado ajusta em dB. O nível acende segmentado DENTRO do trilho, com marca de pico, lido a
 * cada quadro e escrito direto no DOM (sem estado do React). Marca de 0 dB em 3/4 do curso.
 */
export function FaderVU({ gain, variant, fill, quiet, readLevel, label, onChange, className, children }: FaderVUProps) {
  const master = variant === 'principal'
  const [dragF, setDragF] = useState<number | null>(null)
  const dragRef = useRef<Drag | null>(null)
  const meters = useRef<Meter[]>([{ v: 0, pk: 0, pt: 0 }, { v: 0, pk: 0, pt: 0 }])
  const lastTick = useRef(-Infinity)
  const vuEls = useRef<Array<HTMLElement | null>>([null, null])
  const peakEls = useRef<Array<HTMLElement | null>>([null, null])

  const f = dragF ?? gainToFader(gain)
  const shownGain = dragF === null ? gain : faderToGain(dragF)

  const step = (i: number, level: number, now: number) => {
    const m = meters.current[i]
    stepMeter(m, level, now)
    writeVar(vuEls.current[i], '--v', m.v)
    writeVar(peakEls.current[i], '--pk', m.pk)
  }
  useFrame((now) => {
    if (now - lastTick.current < METER_TICK_MS) return
    lastTick.current = now
    const lv = readLevel()
    if (typeof lv === 'number') {
      step(0, lv, now)
    } else {
      step(0, lv.l, now)
      step(1, lv.r, now)
    }
  })

  const endDrag = () => {
    dragRef.current = null
    setDragF(null)
  }
  /** Fim do gesto só pelo dedo que está arrastando (com dois dedos, soltar o outro não encerra). */
  const endOwn = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (dragRef.current && e.pointerId === dragRef.current.id) endDrag()
  }
  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button > 0) return
    try {
      e.currentTarget.setPointerCapture?.(e.pointerId)
    } catch {
      // Sem captura o arrasto vale enquanto o dedo estiver em cima do fader.
    }
    dragRef.current = { id: e.pointerId, x0: e.clientX, y0: e.clientY, f0: f, g0: gain, moving: false, sent: gain }
  }
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = dragRef.current
    if (!d || e.pointerId !== d.id) return
    const dy = d.y0 - e.clientY
    if (!d.moving) {
      const intent = gestureIntent(e.clientX - d.x0, dy)
      if (intent === 'espera') return
      if (intent === 'rolagem') {
        // O gesto é da rolagem do mixer: larga o dedo e não mexe no volume.
        try {
          e.currentTarget.releasePointerCapture?.(d.id)
        } catch {
          // Já sem captura.
        }
        endDrag()
        return
      }
      d.moving = true
    }
    const next = dragFader(d.f0, dy, e.currentTarget.clientHeight - 2 * PAD_PX)
    setDragF(next)
    const g = faderToGain(next)
    if (g !== d.sent) {
      d.sent = g
      onChange(g)
    }
  }
  // O navegador tomou o gesto (rolagem, outro app): o volume volta ao de antes do toque.
  const onPointerCancel = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = dragRef.current
    if (!d || e.pointerId !== d.id) return
    endDrag()
    if (d.moving && d.sent !== d.g0) onChange(d.g0)
  }
  const onDoubleClick = () => {
    endDrag()
    onChange(1)
  }
  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.altKey || e.ctrlKey || e.metaKey) return
    const delta = KEY_DB[e.key]
    let next: number
    if (delta !== undefined) next = stepGainDb(gain, delta)
    else if (e.key === 'Home') next = 0
    else if (e.key === 'End') next = FADER_MAX_GAIN
    else return
    // A tecla é do fader: nem a página rola nem o atalho do palco (setas buscam na música) recebe.
    e.preventDefault()
    e.stopPropagation()
    onChange(next)
  }

  const meterSlots = master ? (['l', 'r'] as const) : (['c'] as const)
  return (
    <div
      role="slider"
      aria-label={label}
      aria-orientation="vertical"
      aria-valuemin={ARIA_MIN_DB}
      aria-valuemax={FADER_MAX_DB}
      aria-valuenow={ariaDb(shownGain)}
      aria-valuetext={dbText(shownGain)}
      tabIndex={0}
      title="Arraste para ajustar. Duplo clique volta para 0 dB."
      data-fader={variant}
      data-quiet={quiet}
      data-dragging={dragF !== null}
      style={{ '--f': f.toFixed(4), ...(fill ? { '--fill': fill } : null) } as CSSProperties}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endOwn}
      onPointerCancel={onPointerCancel}
      onLostPointerCapture={endOwn}
      onDoubleClick={onDoubleClick}
      onKeyDown={onKeyDown}
      className={cx(ROOT, className)}
    >
      {master && (
        <div data-scale="" aria-hidden="true" className={SCALE_BOX}>
          {SCALE.map((s) => <span key={s.text} className="absolute right-0 -translate-y-1/2" style={{ top: `${(1 - s.f) * 100}%` }}>{s.text}</span>)}
        </div>
      )}
      <div aria-hidden="true" className={cx(TICKS, master ? 'w-10' : 'w-[30px]')} />
      {fill && <div data-fill="" aria-hidden="true" className={FILL} />}
      <div data-zero="" aria-hidden="true" className={ZERO} />
      <div data-rail="" aria-hidden="true" className={cx(RAIL, master ? 'w-5 rounded-ps-xs' : 'w-2.5 rounded-[5px]')}>
        {meterSlots.map((side, i) => (
          <div
            key={side}
            data-vu={side}
            ref={(el) => { vuEls.current[i] = el }}
            className={cx(VU, side === 'c' ? 'inset-x-0.5' : side === 'l' ? 'left-[3px] w-1.5' : 'right-[3px] w-1.5')}
          />
        ))}
        {meterSlots.map((side, i) => (
          <div
            key={side}
            data-peak={side}
            ref={(el) => { peakEls.current[i] = el }}
            className={cx(PEAK, side === 'c' ? 'inset-x-0.5' : side === 'l' ? 'left-[3px] w-1.5' : 'right-[3px] w-1.5')}
          />
        ))}
      </div>
      <div aria-hidden="true" className={cx(CAP, master ? 'h-6 w-14' : 'h-[22px] w-11')}>
        <span data-db="" className={DB}>{dbText(shownGain)}</span>
      </div>
      {children}
    </div>
  )
}

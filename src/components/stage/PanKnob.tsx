import { useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import { DRAG_START_PX, dragPan, panText } from '../../lib/faderScale'
import { cx } from '../ui'

export interface PanKnobProps {
  /** Pan do canal, de −1 (esquerda) a 1 (direita). */
  pan: number
  /** Falso com Click e Guia separados (e, em 4 ou mais saídas, nos canais de Click e Guia): apagado e sem arrasto. */
  editable: boolean
  /** Rótulo do canal, pro nome acessível ("Pan Bateria"). */
  label: string
  onChange(pan: number): void
}

const NO_PAN = 'Com Click e Guia separados o pan não decide a saída'
/** Giro máximo do knob pra cada lado, em graus (v6 knobSVG). */
const SWEEP_DEG = 135

/** Ponto do círculo de raio `r` em volta do centro do knob (14, 14), `deg` graus a partir do topo. */
function pt(deg: number, r: number): string {
  const t = ((deg - 90) * Math.PI) / 180
  return `${(14 + r * Math.cos(t)).toFixed(2)} ${(14 + r * Math.sin(t)).toFixed(2)}`
}

// v5 .pan: alvo de 44 px de altura (o v5 tinha 30), knob de 28 px e o valor ao lado em largura fixa
// de 4 caracteres (L100), pro knob não andar quando o valor muda.
const ROOT = 'flex min-h-ps-touch w-full shrink-0 items-center justify-center gap-1 touch-pan-x select-none'
const VALUE = 'ps-num min-w-[4ch] text-left text-ps-micro leading-none font-bold text-ps-bone data-[center=true]:text-ps-dim'

/**
 * Knob de pan do v5/v6: arco na cor do grupo do canal (--c, posto pelo canal), centro marcado
 * no topo e o valor L/C/R ao lado. Arrasta na vertical (sobe = direita) depois de 3 px; duplo
 * clique centraliza. Sem edição fica apagado, não arrasta e explica no title.
 */
export function PanKnob({ pan, editable, label, onChange }: PanKnobProps) {
  const [dragP, setDragP] = useState<number | null>(null)
  const dragRef = useRef<{ id: number; y0: number; p0: number; moving: boolean; sent: number } | null>(null)
  const p = dragP ?? (Number.isFinite(pan) ? Math.min(1, Math.max(-1, pan)) : 0)
  const text = panText(p)
  const a = p * SWEEP_DEG

  const endDrag = () => {
    dragRef.current = null
    setDragP(null)
  }
  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!editable || e.button > 0) return
    try {
      e.currentTarget.setPointerCapture?.(e.pointerId)
    } catch {
      // Sem captura o arrasto vale enquanto o dedo estiver em cima do knob.
    }
    dragRef.current = { id: e.pointerId, y0: e.clientY, p0: p, moving: false, sent: pan }
  }
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = dragRef.current
    if (!d || e.pointerId !== d.id) return
    const dy = d.y0 - e.clientY
    if (!d.moving && Math.abs(dy) < DRAG_START_PX) return
    d.moving = true
    const next = dragPan(d.p0, dy)
    setDragP(next)
    if (next !== d.sent) {
      d.sent = next
      onChange(next)
    }
  }
  const onDoubleClick = () => {
    if (!editable) return
    endDrag()
    onChange(0)
  }

  return (
    <div
      role="slider"
      aria-label={`Pan ${label}`}
      aria-valuemin={-100}
      aria-valuemax={100}
      aria-valuenow={Math.round(p * 100)}
      aria-valuetext={text}
      aria-disabled={editable ? undefined : true}
      title={editable ? 'Pan: arraste para cima ou para baixo. Duplo clique centraliza.' : NO_PAN}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onLostPointerCapture={endDrag}
      onDoubleClick={onDoubleClick}
      className={cx(ROOT, editable ? 'group/pan cursor-ns-resize' : 'cursor-default opacity-35')}
    >
      <svg viewBox="0 0 28 28" width="28" height="28" aria-hidden="true" focusable="false" className="size-7 shrink-0 overflow-visible" fill="none" strokeLinecap="round">
        <circle cx="14" cy="14" r="7.2" strokeWidth="1" className="fill-ps-s2 stroke-ps-line-2 group-hover/pan:stroke-ps-line-3" />
        <path d={`M${pt(-SWEEP_DEG, 10)} A10 10 0 1 1 ${pt(SWEEP_DEG, 10)}`} strokeWidth="2.5" className="stroke-ps-s3" />
        {Math.abs(a) >= 1 && <path data-knob-value="" d={`M${pt(0, 10)} A10 10 0 0 ${a > 0 ? 1 : 0} ${pt(a, 10)}`} strokeWidth="2.5" className="stroke-(--c)" />}
        <path data-knob-center="" d="M14 0.4V2.4" strokeWidth="1.5" className="stroke-ps-mut" />
        <path d={`M${pt(a, 1.5)} L${pt(a, 6)}`} strokeWidth="2" className="stroke-ps-bone" />
      </svg>
      <span data-pan-value="" data-center={text === 'C'} className={VALUE}>{text}</span>
    </div>
  )
}

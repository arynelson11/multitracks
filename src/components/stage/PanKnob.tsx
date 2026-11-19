import { useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from 'react'
import { dragPan, gestureIntent, panText, stepPan } from '../../lib/faderScale'
import { cx } from '../ui'

export interface PanKnobProps {
  /** Pan do canal, de −1 (esquerda) a 1 (direita). */
  pan: number
  /** Falso com Click e Guia separados (e, em 4 ou mais saídas, nos canais de Click e Guia): apagado e sem arrasto. */
  editable: boolean
  /** Rótulo do canal, pro nome acessível ("Pan Bateria"). */
  label: string
  onChange(pan: number): void
  /** Falso enquanto a camada do EDITAR CANAIS cobre o knob: sai do Tab e ignora o teclado. */
  focusable?: boolean
  /** Por que o knob está travado (title), quando `editable` é falso. Padrão: o de Click e Guia separados. */
  lockedTitle?: string
}

const NO_PAN = 'Com Click e Guia separados o pan não decide a saída'
/** Giro máximo do knob pra cada lado, em graus (v6 knobSVG). */
const SWEEP_DEG = 135
/** Passo das setas do teclado (direita soma, esquerda subtrai): 5 no valor mostrado. */
const KEY_STEP = 0.05

/** `p0`: de onde o arrasto conta; `orig`: o pan de antes do toque (volta nele se o navegador cancela). */
interface Drag { id: number; x0: number; y0: number; p0: number; orig: number; moving: boolean; sent: number }

/** Ponto do círculo de raio `r` em volta do centro do knob (14, 14), `deg` graus a partir do topo. */
function pt(deg: number, r: number): string {
  const t = ((deg - 90) * Math.PI) / 180
  return `${(14 + r * Math.cos(t)).toFixed(2)} ${(14 + r * Math.sin(t)).toFixed(2)}`
}

// v5 .pan: alvo de 44 px de altura (o v5 tinha 30), knob de 28 px e o valor ao lado em largura fixa
// de 4 caracteres (L100), pro knob não andar quando o valor muda.
const ROOT =
  'flex min-h-ps-touch w-full shrink-0 items-center justify-center gap-1 touch-pan-x select-none rounded-ps-sm focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ps-or'
const VALUE = 'ps-num min-w-[4ch] text-left text-ps-micro leading-none font-bold text-ps-bone data-[center=true]:text-ps-dim'

/**
 * Knob de pan do v5/v6: arco na cor do grupo do canal (--c, posto pelo canal), centro marcado
 * no topo e o valor L/C/R ao lado. Arrasta na vertical (sobe = direita) depois de 3 px, só se a
 * vertical domina (de lado é a rolagem do mixer); cancelado pelo navegador, volta ao de antes;
 * duplo clique centraliza; com foco, setas pra esquerda e pra direita. Sem edição fica apagado,
 * sem foco, não arrasta e explica no title.
 */
export function PanKnob({ pan, editable, label, onChange, focusable = true, lockedTitle = NO_PAN }: PanKnobProps) {
  const [dragP, setDragP] = useState<number | null>(null)
  const dragRef = useRef<Drag | null>(null)
  const p = dragP ?? (Number.isFinite(pan) ? Math.min(1, Math.max(-1, pan)) : 0)
  const text = panText(p)
  const a = p * SWEEP_DEG

  const endDrag = () => {
    dragRef.current = null
    setDragP(null)
  }
  /** Fim do gesto só pelo dedo que está arrastando. */
  const endOwn = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (dragRef.current && e.pointerId === dragRef.current.id) endDrag()
  }
  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!editable || e.button > 0) return
    try {
      e.currentTarget.setPointerCapture?.(e.pointerId)
    } catch {
      // Sem captura o arrasto vale enquanto o dedo estiver em cima do knob.
    }
    dragRef.current = { id: e.pointerId, x0: e.clientX, y0: e.clientY, p0: p, orig: pan, moving: false, sent: pan }
  }
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = dragRef.current
    if (!d || e.pointerId !== d.id) return
    const dy = d.y0 - e.clientY
    if (!d.moving) {
      const intent = gestureIntent(e.clientX - d.x0, dy)
      if (intent === 'espera') return
      if (intent === 'rolagem') {
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
    const next = dragPan(d.p0, dy)
    setDragP(next)
    if (next !== d.sent) {
      d.sent = next
      onChange(next)
    }
  }
  const onPointerCancel = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = dragRef.current
    if (!d || e.pointerId !== d.id) return
    endDrag()
    // Sem um valor de antes que seja número (dado estragado), não manda nada pro motor.
    if (d.moving && d.sent !== d.orig && Number.isFinite(d.orig)) onChange(d.orig)
  }
  const onDoubleClick = () => {
    if (!editable) return
    endDrag()
    onChange(0)
  }
  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!editable || !focusable || e.altKey || e.ctrlKey || e.metaKey) return
    const delta = e.key === 'ArrowRight' ? KEY_STEP : e.key === 'ArrowLeft' ? -KEY_STEP : null
    if (delta === null) return
    // A seta é do pan: o atalho do palco (buscar 5 s na música) não recebe.
    e.preventDefault()
    e.stopPropagation()
    onChange(stepPan(p, delta))
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
      tabIndex={editable ? (focusable ? 0 : -1) : undefined}
      title={editable ? 'Pan: arraste para cima ou para baixo. Duplo clique centraliza.' : lockedTitle}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endOwn}
      onPointerCancel={onPointerCancel}
      onLostPointerCapture={endOwn}
      onDoubleClick={onDoubleClick}
      onKeyDown={onKeyDown}
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

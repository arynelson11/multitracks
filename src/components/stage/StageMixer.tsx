import { useEffect, useRef, useState } from 'react'
import type React from 'react'
import { fitStrips } from '../../lib/faderScale'
import type { StageActions, StageChannel, StageClock, StageView } from '../../lib/stageContracts'
import { useTwoTapConfirm } from '../../hooks/useTwoTapConfirm'
import { cx } from '../ui'
import { ChannelStrip } from './ChannelStrip'
import { MasterStrip } from './MasterStrip'

export interface StageMixerProps { view: Pick<StageView, 'channels' | 'channelEditMode' | 'outputs' | 'click' | 'transition' | 'master'>; actions: StageActions; clock: StageClock }

/** Largura mínima do canal: 14 canais inteiros em 1280 px (mockup v5). */
const STRIP_MIN_PX = 76
/** No EDITAR CANAIS o canal fica mais largo, pra lixeira armada ("Apagar?") caber sem encostar nas bordas. */
const EDIT_STRIP_MIN_PX = 92
/** Folga de cada lado por dentro da caixa do mixer (px-1). */
const SCROLL_PAD_X_PX = 4

// Classes literais por largura mínima (o Tailwind só gera o que aparece escrito).
const FILL_SLOT: Record<number, string> = {
  [STRIP_MIN_PX]: 'min-w-[76px] flex-1 basis-0',
  [EDIT_STRIP_MIN_PX]: 'min-w-[92px] flex-1 basis-0',
}
const SLOT =
  'h-full shrink-0 snap-start rounded-ps-md transition-opacity duration-150 not-first:shadow-[-1px_0_0_var(--color-ps-line)] data-[dragging=true]:opacity-40 data-[drop-target=true]:inset-ring-2 data-[drop-target=true]:inset-ring-ps-line-3'

interface Drag { from: number; over: number }

/** Pan decide a saída? Não em "Click e Guia separados"; em "4 ou mais saídas", só nos canais normais. */
function panEditable(mode: StageView['outputs']['mode'], ch: StageChannel): boolean {
  if (mode === 'split2') return false
  return mode !== 'multi' || ch.role === 'normal'
}

/**
 * Mixer novo do palco (v5 .mixwrap): canais e o PRINCIPAL ao lado. Os canais dividem a largura;
 * com mais canais do que cabem inteiros (76 px no mínimo), cada um fica com a largura de um
 * canal inteiro e a fileira rola de lado, encaixando em canais inteiros. No EDITAR CANAIS:
 * lápis, alça de arrastar (ponteiro, vale no toque; as setas também movem) e lixeira de 2 toques.
 */
export function StageMixer({ view, actions, clock }: StageMixerProps) {
  const { channels, channelEditMode, outputs, click, transition, master } = view
  const scrollRef = useRef<HTMLDivElement>(null)
  const [innerWidth, setInnerWidth] = useState(0)
  const dragRef = useRef<Drag | null>(null)
  const [drag, setDrag] = useState<Drag | null>(null)

  // Trocar de música (outros canais) ou sair do EDITAR CANAIS desarma a lixeira.
  const resetKey = `${channelEditMode}|${channels.map((ch) => ch.id).join('|')}`
  const trash = useTwoTapConfirm((id) => actions.removeChannel(id), { resetKey })

  useEffect(() => {
    const el = scrollRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => setInnerWidth(Math.max(0, el.clientWidth - 2 * SCROLL_PAD_X_PX)))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const minWidth = channelEditMode ? EDIT_STRIP_MIN_PX : STRIP_MIN_PX
  const fit = fitStrips(innerWidth, 0, minWidth)
  // Sem medida ainda (primeiro quadro) os canais dividem a largura com o mínimo; o navegador rola o que sobrar.
  const scrolls = innerWidth > 0 && channels.length > fit.count

  /** Canal debaixo do ponteiro (pela borda direita de cada um); depois do último, o último. */
  const slotAt = (clientX: number): number => {
    const slots = scrollRef.current?.querySelectorAll<HTMLElement>('[data-strip-slot]')
    if (!slots || slots.length === 0) return 0
    for (let i = 0; i < slots.length; i++) if (clientX < slots[i].getBoundingClientRect().right) return i
    return slots.length - 1
  }
  const endDrag = () => {
    dragRef.current = null
    setDrag(null)
  }
  const handleFor = (i: number): React.HTMLAttributes<HTMLElement> => ({
    onPointerDown: (e) => {
      if (e.button > 0) return
      try {
        e.currentTarget.setPointerCapture?.(e.pointerId)
      } catch {
        // Sem captura o arrasto vale enquanto o ponteiro estiver em cima da alça.
      }
      dragRef.current = { from: i, over: i }
      setDrag(dragRef.current)
    },
    onPointerMove: (e) => {
      const d = dragRef.current
      if (!d || d.from !== i) return
      const over = slotAt(e.clientX)
      if (over === d.over) return
      dragRef.current = { from: i, over }
      setDrag(dragRef.current)
    },
    onPointerUp: () => {
      const d = dragRef.current
      endDrag()
      if (d && d.from === i && d.over !== d.from) actions.reorderChannel(d.from, d.over)
    },
    onPointerCancel: endDrag,
    onLostPointerCapture: endDrag,
    onKeyDown: (e) => {
      const to = e.key === 'ArrowLeft' ? i - 1 : e.key === 'ArrowRight' ? i + 1 : null
      if (to === null) return
      // As setas aqui movem o canal, não a música.
      e.preventDefault()
      e.stopPropagation()
      if (to >= 0 && to < channels.length) actions.reorderChannel(i, to)
    },
  })

  return (
    <section aria-label="Mixer" data-tour="mixer" className="flex h-full min-h-0 w-full gap-2.5 font-ps-sans">
      <div
        ref={scrollRef}
        data-mixer-scroll=""
        className="flex min-w-0 flex-1 snap-x snap-mandatory overflow-x-auto overflow-y-hidden rounded-ps-2xl bg-ps-well px-1 pt-2.5 pb-2 inset-ring inset-ring-ps-line"
      >
        {channels.length === 0 && <p className="m-auto px-4 text-center text-ps-sm text-ps-mut">Os canais da música aparecem aqui.</p>}
        {channels.map((ch, i) => (
          <div
            key={ch.id}
            data-strip-slot={i}
            data-dragging={drag?.from === i}
            data-drop-target={drag !== null && drag.over === i && drag.over !== drag.from}
            className={cx(SLOT, !scrolls && FILL_SLOT[minWidth])}
            style={scrolls ? { width: fit.width } : undefined}
          >
            <ChannelStrip
              ch={ch}
              panEditable={panEditable(outputs.mode, ch)}
              editMode={channelEditMode}
              clock={clock}
              count={ch.id === click.channelId ? transition : null}
              onVolume={(g) => actions.setVolume(ch.id, g)}
              onPan={(p) => actions.setPan(ch.id, p)}
              onMute={() => actions.toggleMute(ch.id)}
              onSolo={() => actions.toggleSolo(ch.id)}
              onEdit={() => actions.openChannelEdit(ch.id)}
              onRemove={() => trash.press(ch.id)}
              removeArmed={trash.armedId === ch.id}
              dragHandle={channelEditMode ? handleFor(i) : undefined}
            />
          </div>
        ))}
      </div>
      <MasterStrip
        master={master}
        channelEditMode={channelEditMode}
        clock={clock}
        onVolume={(g) => actions.setMasterVolume(g)}
        onToggleMute={() => actions.toggleMasterMute()}
        onToggleChannelEdit={() => actions.toggleChannelEditMode()}
      />
    </section>
  )
}

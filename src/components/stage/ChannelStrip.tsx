import { useEffect, useLayoutEffect, useRef } from 'react'
import type React from 'react'
import { channelFaderFill } from '../../lib/channelRoles'
import type { StageChannel, StageClock, TransitionView } from '../../lib/stageContracts'
import { countState } from '../../lib/transitionView'
import { ChannelTrashButton } from '../ChannelTrashButton'
import { Button, cx } from '../ui'
import { FaderVU } from './FaderVU'
import { Icon } from './icons'
import { PanKnob } from './PanKnob'
import { setFlag, setText } from './stageDom'
import { useFrame } from './useFrame'

export interface ChannelStripProps {
  ch: StageChannel; panEditable: boolean; editMode: boolean; clock: Pick<StageClock, 'level' | 'heardNow'>; count: TransitionView | null
  onVolume(gain: number): void; onPan(pan: number): void; onMute(): void; onSolo(): void; onEdit(): void; onRemove(): void; dragHandle?: React.HTMLAttributes<HTMLElement>
  /** Lixeira já tocada uma vez (useTwoTapConfirm no StageMixer, uma armada por vez): o próximo toque apaga. */
  removeArmed?: boolean
}

/** Linha do nome: 14 px. A área reserva sempre 2 linhas (Ruling T14), pra todas as faixas terem a mesma altura. */
const NAME_LINE_PX = 14
const NAME_MAX_LINES = 2

/** Nome em 11 px; se passar de 2 linhas na largura do canal, 10 px. Nunca corta: se ainda passar, a área cresce. */
function fitName(name: HTMLElement): void {
  delete name.dataset.fit
  if (name.offsetHeight > NAME_LINE_PX * (NAME_MAX_LINES + 0.5)) name.dataset.fit = 'small'
}

// Calado (M ou Solo de outro canal): pan, fader e nome apagados, como o v5 .ch.dim.
const DIM = 'opacity-[.38]'
// v5 .ms: M e S colados, 32 px de altura (exceção de toque aprovada no v5 pra 14 canais em 1280 px).
const MS =
  'h-8 min-w-0 flex-1 rounded-ps-sm text-ps-sm font-extrabold select-none transition-[background-color,color,box-shadow] duration-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ps-or'
const MS_OFF = 'bg-ps-s2 text-ps-mut inset-ring inset-ring-ps-line hover:text-ps-bone'
const M_ON = 'bg-ps-mute text-ps-ink shadow-[0_0_12px_color-mix(in_srgb,var(--color-ps-mute)_45%,transparent)]'
const S_ON = 'bg-ps-solo text-ps-ink shadow-[0_0_12px_color-mix(in_srgb,var(--color-ps-solo)_40%,transparent)]'
// Nome: 2 linhas sempre reservadas, quebra até dentro de palavra comprida, sem reticências.
const NAME =
  'min-h-[28px] w-full shrink-0 text-center text-ps-sm leading-[14px] font-semibold text-ps-bone wrap-anywhere data-[fit=small]:text-ps-micro'
// v5 .cb: balão branco com o número da contagem, no alto do fader do canal de Click.
const COUNT =
  'ps-num pointer-events-none absolute top-[26px] left-1/2 z-[3] size-[30px] -translate-x-1/2 -translate-y-1/2 scale-60 rounded-full bg-ps-arm text-center text-[15px] leading-[30px] font-extrabold text-ps-ink opacity-0 shadow-[0_0_14px_color-mix(in_srgb,var(--color-ps-arm)_50%,transparent)] transition-[opacity,scale] duration-100 data-[on=true]:scale-100 data-[on=true]:opacity-100'
// EDITAR CANAIS: por cima do pan, do fader e do M/S (o nome fica à vista), alça em cima e lixeira no pé.
const EDIT_LAYER =
  'absolute -inset-x-[3px] inset-y-0 z-10 flex flex-col items-center justify-between gap-1 overflow-y-auto rounded-ps-md bg-ps-ink-0/85 py-1 backdrop-blur-[2px]'
const GRIP =
  'inline-flex size-ps-touch shrink-0 cursor-grab touch-none items-center justify-center rounded-ps-lg bg-ps-s1 text-ps-mut inset-ring inset-ring-ps-line select-none hover:text-ps-bone active:cursor-grabbing focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ps-or'

/**
 * Canal do mixer novo (v5 .ch), de cima pra baixo: PAN, fader com o nível no trilho, M e S,
 * nome (até 2 linhas, sem reticências). A cor do grupo do canal (--c) pinta o arco do pan, a
 * linha da tampa e a faixa do fader; calado, a faixa fica cinza neutro (channelFaderFill) e o
 * canal apagado. No canal de Click, balão com o número da contagem ouvida (countState).
 */
export function ChannelStrip({
  ch, panEditable, editMode, clock, count, onVolume, onPan, onMute, onSolo, onEdit, onRemove, dragHandle, removeArmed = false,
}: ChannelStripProps) {
  const nameRef = useRef<HTMLSpanElement>(null)
  const countRef = useRef<HTMLSpanElement>(null)
  const quiet = ch.muted || ch.silenced

  const paintCount = () => {
    const el = countRef.current
    if (!el || !count) return
    const label = count.clickAudible && !ch.muted ? countState(count, clock.heardNow()).currentLabel : null
    setFlag(el, 'on', label !== null)
    setText(el, label === null ? '' : String(label))
  }
  // Depois de cada renderização: acerta o tamanho do nome e pinta o balão (sem esperar o quadro).
  useLayoutEffect(() => {
    if (nameRef.current) fitName(nameRef.current)
    paintCount()
  })
  useFrame(paintCount, count !== null)
  // A largura do canal muda com a janela e as fontes chegam depois: mede o nome de novo.
  useEffect(() => {
    const name = nameRef.current
    if (!name) return
    let alive = true
    const refit = () => { if (alive) fitName(name) }
    document.fonts?.ready.then(refit).catch(() => {})
    if (typeof ResizeObserver === 'undefined') return () => { alive = false }
    const ro = new ResizeObserver(refit)
    if (name.parentElement) ro.observe(name.parentElement)
    return () => {
      alive = false
      ro.disconnect()
    }
  }, [])

  return (
    <div
      role="group"
      aria-label={`Canal ${ch.label}`}
      data-channel-strip=""
      data-quiet={quiet}
      style={{ '--c': ch.color } as React.CSSProperties}
      className="flex h-full w-full min-w-0 flex-col items-center gap-1.5 px-[3px] font-ps-sans"
    >
      <div className="relative flex min-h-0 w-full flex-1 flex-col items-center gap-1.5">
        <div className={cx('w-full', quiet && DIM)}>
          <PanKnob pan={ch.pan} editable={panEditable} label={ch.label} onChange={onPan} />
        </div>
        <FaderVU
          variant="canal" gain={ch.volume} fill={channelFaderFill(ch.color, quiet)} quiet={quiet}
          readLevel={() => clock.level(ch.id)} label={`Volume ${ch.label}`} onChange={onVolume} className={quiet ? DIM : undefined}
        >
          {count !== null && <span ref={countRef} data-count="" aria-hidden="true" className={COUNT} />}
        </FaderVU>
        <div className="flex w-full max-w-[84px] shrink-0 gap-1">
          <button type="button" data-touch-exception="ms" aria-pressed={ch.muted} title="Mudo" onClick={onMute} className={cx(MS, ch.muted ? M_ON : MS_OFF)}>M</button>
          <button type="button" data-touch-exception="ms" aria-pressed={ch.soloed} title="Solo" onClick={onSolo} className={cx(MS, ch.soloed ? S_ON : MS_OFF)}>S</button>
        </div>
        {editMode && (
          <div data-edit-layer="" className={EDIT_LAYER}>
            <button {...dragHandle} type="button" aria-label={`Mover ${ch.label}`} title="Arraste para mudar a ordem. As setas também movem." className={GRIP}>
              <Icon name="grip" />
            </button>
            <Button aria-label={`Renomear e escolher papel de ${ch.label}`} title="Renomear e escolher papel" icon={<Icon name="edit" />} onClick={onEdit} />
            <ChannelTrashButton channelLabel={ch.label} armed={removeArmed} onPress={onRemove} />
          </div>
        )}
      </div>
      <span ref={nameRef} data-channel-name="" className={cx(NAME, quiet && DIM)}>{ch.label}</span>
    </div>
  )
}

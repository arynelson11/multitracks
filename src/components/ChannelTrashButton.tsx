import { Trash2 } from 'lucide-react'
import { cx } from './ui/cx'

interface ChannelTrashButtonProps {
  // Rótulo organizado do canal, o mesmo que aparece no mixer.
  channelLabel: string
  // Primeiro toque já dado: o próximo apaga (useTwoTapConfirm).
  armed: boolean
  onPress: () => void
}

// Lixeira do EDITAR CANAIS. Apagar o canal não tem volta, então pede segundo toque:
// armada, fica no âmbar do token de alerta (ps-alert) com "Apagar?". Largura pelo texto, alvo de 44px.
const BASE =
  'inline-flex shrink-0 items-center justify-center gap-1 min-h-ps-touch min-w-ps-touch rounded-ps-pill font-ps-sans text-ps-sm font-bold whitespace-nowrap select-none cursor-pointer transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ps-or'
const IDLE = 'bg-accent-red/20 text-accent-red hover:bg-accent-red/40'
const ARMED = 'px-2 bg-ps-alert text-ps-ink'

export function ChannelTrashButton({ channelLabel, armed, onPress }: ChannelTrashButtonProps) {
  const label = armed ? `Toque de novo para apagar o canal ${channelLabel}` : `Apagar o canal ${channelLabel}`
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={(e) => { e.stopPropagation(); onPress() }}
      className={cx(BASE, armed ? ARMED : IDLE)}
    >
      <Trash2 size={14} aria-hidden="true" />
      {armed && <span>Apagar?</span>}
    </button>
  )
}

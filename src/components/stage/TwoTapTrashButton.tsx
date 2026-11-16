import { useEffect, useId } from 'react'
import { useTwoTapConfirm } from '../../hooks/useTwoTapConfirm'
import { cx } from '../ui'
import { Icon } from './icons'

export interface TwoTapTrashButtonProps {
  /** Nome da ação no repouso (aria-label e title). Ex.: "Tirar Fé do repertório". */
  label: string
  /** Nome da ação armada (aria-label e title). Ex.: "Toque de novo para tirar Fé do repertório". */
  confirmLabel: string
  onConfirm(): void
}

// Aviso entre as ações de dois toques do palco: quem arma avisa e as outras desarmam (uma armada
// por vez, como as lixeiras de canal da Parte 1). O Novo do RepertoirePanel usa o mesmo nome.
const ARM_EVENT = 'ps-two-tap-arm'

// Mesma aparência da lixeira do EDITAR CANAIS (Parte 1): alvo de 44 px, largura pelo texto.
// Repouso neutro (vermelho é o M do mixer); armada no âmbar do token de alerta com "Apagar?".
const BASE =
  'inline-flex shrink-0 items-center justify-center gap-1 min-h-ps-touch min-w-ps-touch rounded-ps-pill font-ps-sans text-ps-sm font-bold whitespace-nowrap select-none cursor-pointer transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ps-or'
const IDLE = 'text-ps-mut hover:text-ps-bone hover:bg-ps-s2'
const ARMED = 'px-2 bg-ps-alert text-ps-ink'

/**
 * Lixeira genérica de dois toques: o primeiro arma (o texto vira "Apagar?" e o nome acessível
 * vira `confirmLabel`), o segundo, dentro de 3 s e depois de 350 ms, chama `onConfirm` uma vez.
 * Desarma sozinha no fim da janela, com Esc e quando outra ação de dois toques do palco arma.
 */
export function TwoTapTrashButton({ label, confirmLabel, onConfirm }: TwoTapTrashButtonProps) {
  const id = useId()
  const { armedId, press, disarm } = useTwoTapConfirm(() => onConfirm())
  const armed = armedId === id

  useEffect(() => {
    if (!armed) return
    document.dispatchEvent(new CustomEvent(ARM_EVENT, { detail: id }))
    const onOtherArmed = (e: Event) => { if ((e as CustomEvent<string>).detail !== id) disarm() }
    document.addEventListener(ARM_EVENT, onOtherArmed)
    return () => document.removeEventListener(ARM_EVENT, onOtherArmed)
  }, [armed, id, disarm])

  const name = armed ? confirmLabel : label
  return (
    <button
      type="button"
      aria-label={name}
      title={name}
      onClick={() => press(id)}
      // Tecla segurada repete o keydown e o navegador repete o clique: só o primeiro vale.
      onKeyDown={(e) => { if (e.repeat && (e.key === 'Enter' || e.key === ' ')) e.preventDefault() }}
      className={cx(BASE, armed ? ARMED : IDLE)}
    >
      <Icon name="trash" className="size-[15px]" />
      {armed && <span>Apagar?</span>}
    </button>
  )
}

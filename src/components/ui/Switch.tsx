import { useId } from 'react'
import type React from 'react'
import { cx } from './cx'

export interface SwitchProps {
  checked: boolean
  onChange(checked: boolean): void
  /** Nome do interruptor, à esquerda; tocar nele também alterna. */
  label: React.ReactNode
  /** Frase embaixo do nome (lida como descrição do interruptor). */
  description?: React.ReactNode
  hideLabel?: boolean
  disabled?: boolean
  id?: string
  title?: string
  /** Classe da linha inteira (nome, descrição e interruptor). */
  className?: string
}

const ROW = 'flex min-w-0 items-center justify-between gap-3'
const NAME = 'block text-ps-base font-bold text-ps-bone'
const DESCRIPTION = 'text-ps-base leading-snug text-pretty text-ps-mut'
// O botão é o alvo de 44 px; a trilha de 44 x 24 fica dentro dele.
const BUTTON =
  'inline-flex shrink-0 items-center justify-center min-h-ps-touch min-w-ps-touch rounded-ps-lg cursor-pointer select-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ps-or disabled:cursor-not-allowed'
// Fundo, anel e posição da bolinha saem do estado, pra variação não disputar com a base.
const TRACK = 'relative inline-flex h-6 w-11 items-center rounded-ps-pill inset-ring transition-colors duration-150 motion-reduce:transition-none'
const TRACK_OFF = 'bg-ps-s3 inset-ring-ps-line-2'
const TRACK_ON = 'bg-ps-or-soft inset-ring-ps-or-line'
const THUMB = 'size-[18px] rounded-full transition-transform duration-150 motion-reduce:transition-none'
const THUMB_OFF = 'translate-x-[3px] bg-ps-mut'
const THUMB_ON = 'translate-x-[23px] bg-ps-or'

/** Interruptor de liga e desliga (role switch): laranja ligado, cinza desligado. */
export function Switch({ checked, onChange, label, description, hideLabel, disabled, id, title, className }: SwitchProps) {
  const auto = useId()
  const buttonId = id ?? auto
  const labelId = `${buttonId}-nome`
  const descriptionId = description != null ? `${buttonId}-descricao` : undefined
  return (
    <div className={cx(ROW, disabled && 'opacity-35', className)}>
      <div className={hideLabel ? 'sr-only' : 'min-w-0'}>
        <label id={labelId} htmlFor={buttonId} className={cx(NAME, !disabled && 'cursor-pointer')}>{label}</label>
        {description != null && <p id={descriptionId} className={DESCRIPTION}>{description}</p>}
      </div>
      <button
        id={buttonId}
        type="button"
        role="switch"
        aria-checked={checked}
        aria-labelledby={labelId}
        aria-describedby={descriptionId}
        title={title}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={BUTTON}
      >
        <span aria-hidden="true" className={cx(TRACK, checked ? TRACK_ON : TRACK_OFF)}>
          <span className={cx(THUMB, checked ? THUMB_ON : THUMB_OFF)} />
        </span>
      </button>
    </div>
  )
}

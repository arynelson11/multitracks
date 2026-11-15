import type React from 'react'
import { cx } from './cx'

export interface ChipProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  on?: boolean
  small?: boolean
}

// Fundo, texto, anel e fonte saem do estado e do tamanho, pra variação não disputar com a base.
const BASE =
  'inline-flex items-center justify-center gap-1.5 min-w-ps-touch min-h-ps-touch px-2.5 rounded-ps-md tabular-nums whitespace-nowrap inset-ring active:scale-[0.96]'

const OFF = 'bg-ps-s2 text-ps-bone inset-ring-ps-line hover:inset-ring-ps-line-2'
const ON = 'bg-ps-or-soft text-ps-or inset-ring-ps-or-line'

const REGULAR = 'text-ps-base font-bold'
const SMALL = 'text-ps-sm tracking-[0.08em] font-extrabold'

export function Chip({ on = false, small = false, type = 'button', className, ...rest }: ChipProps) {
  return <button {...rest} type={type} className={cx(BASE, on ? ON : OFF, small ? SMALL : REGULAR, className)} />
}

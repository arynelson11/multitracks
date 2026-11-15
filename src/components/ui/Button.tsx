import type React from 'react'
import { cx } from './cx'

export type ButtonTone = 'default' | 'on' | 'armed' | 'alert' | 'primary' | 'ghost'

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  tone?: ButtonTone
  size?: 'md' | 'lg'
  pressed?: boolean
  icon?: React.ReactNode
}

// Sem altura mínima aqui: ela vem do tamanho, pra variação não disputar com a base.
// shrink-0: o min-w-ps-touch troca o piso automático do item flex e, sem ele, o texto vaza numa linha apertada.
const BASE =
  'inline-flex shrink-0 items-center justify-center gap-2 w-auto min-w-ps-touch px-ps-pad-x rounded-ps-lg font-ps-sans text-ps-sm font-bold tracking-[0.1em] whitespace-nowrap select-none transition-[background-color,box-shadow,color,transform] duration-150 active:scale-[0.96] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ps-or disabled:opacity-35 disabled:pointer-events-none'

const SIZES: Record<NonNullable<ButtonProps['size']>, string> = {
  md: 'min-h-ps-touch',
  lg: 'min-h-14',
}

const TONES: Record<ButtonTone, string> = {
  default: 'bg-ps-s1 text-ps-bone inset-ring inset-ring-ps-line hover:inset-ring-ps-line-2',
  on: 'bg-ps-or-soft text-ps-or inset-ring inset-ring-ps-or-line',
  armed: 'bg-ps-s1 text-ps-arm inset-ring-2 inset-ring-ps-arm',
  alert: 'bg-ps-alert-soft text-ps-alert inset-ring inset-ring-ps-alert-line',
  primary: 'bg-ps-or text-ps-on-or',
  ghost: 'bg-transparent text-ps-mut hover:text-ps-bone hover:bg-ps-s1',
}

export function Button({
  tone = 'default',
  size = 'md',
  pressed,
  icon,
  type = 'button',
  className,
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      {...rest}
      type={type}
      aria-pressed={pressed}
      className={cx(BASE, SIZES[size], TONES[tone], className)}
    >
      {icon != null && <span aria-hidden="true">{icon}</span>}
      {children}
    </button>
  )
}

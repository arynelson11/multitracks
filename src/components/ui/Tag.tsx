import type React from 'react'
import { cx } from './cx'

export type TagTone = 'neutral' | 'on' | 'live' | 'alert'

export type TagProps = React.HTMLAttributes<HTMLSpanElement> & {
  tone?: TagTone
  /** Número (BPM, contagem): fonte mono de largura fixa. */
  num?: boolean
  /** Luz antes do texto. Padrão: só no `live`. */
  dot?: boolean
}

// O selo ONLINE/OFFLINE da barra do palco. Fundo, texto e anel saem do tom, pra variação não disputar com a base.
const BASE =
  'inline-flex h-[22px] shrink-0 items-center gap-1.5 rounded-ps-pill px-[9px] text-ps-micro leading-none font-extrabold tracking-[0.14em] whitespace-nowrap inset-ring'

const TONES: Record<TagTone, string> = {
  neutral: 'bg-ps-s2 text-ps-mut inset-ring-ps-line-2',
  on: 'bg-ps-or-soft text-ps-or inset-ring-ps-or-line',
  live: 'bg-ps-moss/15 text-ps-moss-hi inset-ring-ps-moss/80',
  alert: 'bg-ps-alert-soft text-ps-alert inset-ring-ps-alert-line',
}

const DOTS: Record<TagTone, string> = {
  neutral: 'bg-ps-dim',
  on: 'bg-ps-or',
  live: 'bg-ps-moss-hi shadow-[0_0_6px_var(--color-ps-moss-hi)]',
  alert: 'bg-ps-alert',
}

/** Selo estático de metadado (tom, BPM, "N faixas", OFFLINE). Não é botão. Escreva o texto como deve aparecer. */
export function Tag({ tone = 'neutral', num = false, dot, className, children, ...rest }: TagProps) {
  const showDot = dot ?? tone === 'live'
  return (
    <span {...rest} className={cx(BASE, TONES[tone], num && 'ps-num', className)}>
      {showDot && <span aria-hidden="true" className={cx('size-1.5 shrink-0 rounded-full', DOTS[tone])} />}
      {children}
    </span>
  )
}

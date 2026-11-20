import type React from 'react'
import { cx } from './cx'

export type NoticeTone = 'info' | 'alert'

export type NoticeProps = React.HTMLAttributes<HTMLDivElement> & { tone?: NoticeTone }

const BASE = 'rounded-ps-md px-3 py-2 text-ps-base leading-snug text-pretty break-words inset-ring'

// Fundo, texto e anel saem do tom, pra variação não disputar com a base.
const TONES: Record<NoticeTone, string> = {
  info: 'bg-ps-s2 text-ps-bone inset-ring-ps-line',
  alert: 'bg-ps-alert-soft font-semibold text-ps-alert inset-ring-ps-alert-line',
}

/** Aviso em caixa: info (neutro) ou alert (âmbar). O papel (status, alert) é de quem usa. */
export function Notice({ tone = 'info', className, ...rest }: NoticeProps) {
  return <div {...rest} className={cx(BASE, TONES[tone], className)} />
}

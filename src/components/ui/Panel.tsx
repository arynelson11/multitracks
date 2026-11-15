import type React from 'react'
import { cx } from './cx'

export type PanelVariant = 'flat' | 'raised' | 'pop'

export type PanelProps = React.HTMLAttributes<HTMLDivElement> & { variant?: PanelVariant }

// O raio sai da variação (o pop é menor), pra não disputar com a base. Sem padding: quem usa passa.
const BASE = 'inset-ring'

const VARIANTS: Record<PanelVariant, string> = {
  flat: 'rounded-ps-2xl bg-ps-s1 inset-ring-ps-line',
  raised: 'rounded-ps-2xl bg-ps-raised inset-ring-ps-line',
  pop: 'bg-ps-pop rounded-ps-xl inset-ring-ps-line-2 shadow-ps-pop',
}

export function Panel({ variant = 'flat', className, ...rest }: PanelProps) {
  return <div {...rest} className={cx(BASE, VARIANTS[variant], className)} />
}

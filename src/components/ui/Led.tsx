import { cx } from './cx'

export type LedState = 'off' | 'on' | 'live' | 'alert' | 'armed'

export interface LedProps {
  state: LedState
  size?: 'sm' | 'md'
  label?: string
  className?: string
}

const BASE = 'inline-block shrink-0 rounded-full'

const SIZES: Record<NonNullable<LedProps['size']>, string> = {
  sm: 'size-1.5',
  md: 'size-2',
}

const STATES: Record<LedState, string> = {
  off: 'bg-ps-s3',
  on: 'bg-ps-or shadow-[0_0_8px_var(--color-ps-or)]',
  live: 'bg-ps-moss-hi shadow-[0_0_8px_var(--color-ps-moss-hi)] animate-ps-blink motion-reduce:animate-none',
  alert: 'bg-ps-alert shadow-[0_0_8px_var(--color-ps-alert)] animate-ps-blink motion-reduce:animate-none',
  armed: 'bg-ps-arm shadow-[0_0_8px_rgba(255,255,255,0.55)]',
}

/** Sem label é só decoração (escondido do leitor de tela); com label vira imagem com nome. */
export function Led({ state, size = 'md', label, className }: LedProps) {
  return (
    <span
      role={label ? 'img' : undefined}
      aria-label={label || undefined}
      aria-hidden={label ? undefined : true}
      className={cx(BASE, SIZES[size], STATES[state], className)}
    />
  )
}

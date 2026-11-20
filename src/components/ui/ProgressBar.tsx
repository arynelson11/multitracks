import { useId } from 'react'
import { cx } from './cx'

export interface ProgressBarProps {
  /** Nome da barra (o que está andando). */
  label: string
  /** Quanto já foi, de 0 a `max`. `null`: não dá pra saber quanto falta (a barra pisca). */
  value: number | null
  max?: number
  /** Texto do valor, lido pelo leitor de tela e mostrado ao lado do nome (ex.: "40%", "2 de 5"). */
  valueText?: string
  hideLabel?: boolean
  className?: string
}

const LABEL = 'text-ps-label font-bold uppercase tracking-[0.14em] text-ps-mut'
const TRACK = 'relative h-1.5 w-full overflow-hidden rounded-ps-pill bg-ps-s3'
const FILL = 'h-full rounded-ps-pill bg-ps-or'
const FILL_KNOWN = 'transition-[width] duration-300 motion-reduce:transition-none'
const FILL_UNKNOWN = 'w-1/3 animate-ps-blink motion-reduce:animate-none'

/** Barra de progresso (role progressbar): trilha s3, preenchimento laranja, 6 px de altura. */
export function ProgressBar({ label, value, max = 100, valueText, hideLabel = false, className }: ProgressBarProps) {
  const labelId = useId()
  const top = max > 0 ? max : 100
  const now = value == null || !Number.isFinite(value) ? null : Math.min(Math.max(value, 0), top)
  const pct = now == null ? null : +((now / top) * 100).toFixed(2)
  return (
    <div className={cx('flex min-w-0 flex-col gap-1.5', className)}>
      {!hideLabel && (
        <div className="flex flex-wrap items-baseline justify-between gap-x-3">
          <span id={labelId} className={LABEL}>{label}</span>
          {valueText != null && <span aria-hidden="true" className="ps-num text-ps-sm text-ps-mut">{valueText}</span>}
        </div>
      )}
      <div
        role="progressbar"
        aria-labelledby={hideLabel ? undefined : labelId}
        aria-label={hideLabel ? label : undefined}
        aria-valuemin={0}
        aria-valuemax={top}
        aria-valuenow={now ?? undefined}
        aria-valuetext={valueText}
        className={TRACK}
      >
        <div className={cx(FILL, pct == null ? FILL_UNKNOWN : FILL_KNOWN)} style={pct == null ? undefined : { width: `${pct}%` }} />
      </div>
    </div>
  )
}

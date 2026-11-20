import { useId } from 'react'
import type React from 'react'
import { cx } from './cx'

export type SliderProps = Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type' | 'value' | 'defaultValue' | 'onChange' | 'min' | 'max' | 'step' | 'size'> & {
  label: React.ReactNode
  hideLabel?: boolean
  value: number
  onChange(value: number): void
  min?: number
  max?: number
  step?: number
  /** Texto do valor (ex.: "80%"), lido pelo leitor de tela e mostrado ao lado do nome. */
  valueText?: string
  /** Classe do contêiner (nome e controle). */
  className?: string
  inputClassName?: string
}

const LABEL = 'text-ps-label font-bold uppercase tracking-[0.14em] text-ps-mut'

// O input tem 44 px de altura (o alvo); a trilha de 6 px e o polegar de 20 px são desenhados dentro.
// O preenchimento laranja até o valor sai da variável --ps-fill (WebKit) e do -moz-range-progress (Firefox).
const RANGE =
  'h-11 w-full min-w-0 cursor-pointer appearance-none rounded-ps-md bg-transparent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ps-or disabled:cursor-not-allowed disabled:opacity-35 ' +
  '[&::-webkit-slider-runnable-track]:h-1.5 [&::-webkit-slider-runnable-track]:rounded-ps-pill [&::-webkit-slider-runnable-track]:bg-[linear-gradient(to_right,var(--color-ps-or)_var(--ps-fill),var(--color-ps-s3)_var(--ps-fill))] ' +
  '[&::-webkit-slider-thumb]:-mt-[7px] [&::-webkit-slider-thumb]:size-5 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-ps-bone [&::-webkit-slider-thumb]:shadow-[0_0_0_2px_var(--color-ps-ink-0)] ' +
  '[&::-moz-range-track]:h-1.5 [&::-moz-range-track]:rounded-ps-pill [&::-moz-range-track]:bg-ps-s3 [&::-moz-range-progress]:h-1.5 [&::-moz-range-progress]:rounded-ps-pill [&::-moz-range-progress]:bg-ps-or ' +
  '[&::-moz-range-thumb]:size-5 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:bg-ps-bone'

/** Controle deslizante horizontal (input range): trilha s3, preenchido em laranja até o valor. */
export function Slider({ label, hideLabel = false, value, onChange, min = 0, max = 100, step = 1, valueText, className, inputClassName, id, style, ...rest }: SliderProps) {
  const auto = useId()
  const inputId = id ?? auto
  const span = max - min
  const pct = span > 0 ? Math.min(Math.max(((value - min) / span) * 100, 0), 100) : 0
  return (
    <div className={cx('flex min-w-0 flex-col gap-1', className)}>
      <div className={hideLabel ? 'sr-only' : 'flex flex-wrap items-baseline justify-between gap-x-3'}>
        <label htmlFor={inputId} className={LABEL}>{label}</label>
        {valueText != null && !hideLabel && <span aria-hidden="true" className="ps-num text-ps-sm text-ps-mut">{valueText}</span>}
      </div>
      <input
        {...rest}
        id={inputId}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        aria-valuetext={valueText}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{ ...style, '--ps-fill': `${+pct.toFixed(2)}%` } as React.CSSProperties}
        className={cx(RANGE, inputClassName)}
      />
    </div>
  )
}

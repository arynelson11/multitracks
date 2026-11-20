import { useRef } from 'react'
import type React from 'react'
import { cx } from './cx'

export interface SegmentedOption<T extends string> {
  value: T
  label: string
  disabled?: boolean
}

export interface SegmentedProps<T extends string> {
  options: SegmentedOption<T>[]
  value: T | null
  onChange: (value: T) => void
  'aria-label': string
  className?: string
}

const GROUP = 'inline-flex p-[3px] gap-0.5 rounded-ps-lg bg-ps-s1 inset-ring inset-ring-ps-line'

// A cor do texto sai do estado (selecionada x não), pra não disputar com a base.
// shrink-0: o min-w-[62px] troca o piso automático do item flex e, sem ele, o texto vaza num grupo apertado.
// Anel de foco laranja por dentro (o grupo é colado); desligada e não marcada fica a 35% (Parte 3).
const OPTION =
  'shrink-0 min-w-[62px] min-h-ps-touch px-3 rounded-[9px] text-ps-sm font-extrabold tracking-[0.1em] whitespace-nowrap focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ps-or disabled:cursor-not-allowed'
const OPTION_IDLE = 'text-ps-mut hover:text-ps-bone'
const OPTION_SELECTED = 'bg-ps-s3 text-ps-bone inset-ring inset-ring-ps-line-2'
// A marcada continua com cara de escolhida mesmo desligada (só leitura).
const OPTION_DISABLED = 'opacity-35'

/** Próxima opção habilitada a partir de `from`, andando `step` (1 ou -1) com volta. -1 se nenhuma. */
function nextEnabled<T extends string>(options: SegmentedOption<T>[], from: number, step: 1 | -1): number {
  const n = options.length
  for (let k = 1; k <= n; k++) {
    const i = (((from + step * k) % n) + n) % n
    if (!options[i].disabled) return i
  }
  return -1
}

/** Grupo de opções exclusivas (radiogroup) com tabindex itinerante e navegação por setas, Home e End. */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  'aria-label': ariaLabel,
  className,
}: SegmentedProps<T>) {
  const refs = useRef<Array<HTMLButtonElement | null>>([])

  const selected = options.findIndex((o) => o.value === value)
  // Só uma opção entra no Tab: a selecionada; sem seleção (ou selecionada desabilitada), a primeira habilitada.
  const tabStop = selected >= 0 && !options[selected].disabled ? selected : options.findIndex((o) => !o.disabled)

  const select = (i: number) => {
    if (i < 0) return
    onChange(options[i].value)
    refs.current[i]?.focus()
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>, i: number) => {
    let target: number
    switch (e.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        target = nextEnabled(options, i, 1)
        break
      case 'ArrowLeft':
      case 'ArrowUp':
        target = nextEnabled(options, i, -1)
        break
      case 'Home':
        target = nextEnabled(options, options.length - 1, 1)
        break
      case 'End':
        target = nextEnabled(options, 0, -1)
        break
      default:
        return
    }
    e.preventDefault()
    select(target)
  }

  return (
    <div role="radiogroup" aria-label={ariaLabel} className={cx(GROUP, className)}>
      {options.map((o, i) => {
        const isSelected = i === selected
        return (
          <button
            key={o.value}
            ref={(el) => {
              refs.current[i] = el
            }}
            type="button"
            role="radio"
            aria-checked={isSelected}
            tabIndex={i === tabStop ? 0 : -1}
            disabled={o.disabled}
            onClick={() => onChange(o.value)}
            onKeyDown={(e) => onKeyDown(e, i)}
            className={cx(OPTION, isSelected ? OPTION_SELECTED : OPTION_IDLE, o.disabled && !isSelected && OPTION_DISABLED)}
          >
            {o.label}
          </button>
        )
      })}
    </div>
  )
}

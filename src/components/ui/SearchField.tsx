import { useId } from 'react'
import { TextField } from './Field'
import type { TextFieldProps } from './Field'
import { IconButton } from './IconButton'
import { cx } from './cx'

export type SearchFieldProps = Omit<TextFieldProps, 'type' | 'icon' | 'trailing' | 'value' | 'onChange' | 'hideLabel'> & {
  value: string
  onChange(value: string): void
  /** Quem limpa a busca; sem ele, o limpar chama onChange(''). */
  onClear?(): void
  clearLabel?: string
  /** Padrão: escondido (a lupa e o placeholder dizem o que é); o leitor de tela lê o rótulo. */
  hideLabel?: boolean
}

const ICON = { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2.2, strokeLinecap: 'round', strokeLinejoin: 'round' } as const

/** Campo de busca: o TextField com type search, a lupa no começo e o limpar (44 px) no fim quando tem texto. */
export function SearchField({ value, onChange, onClear, clearLabel = 'Limpar a busca', hideLabel = true, id, inputClassName, ...rest }: SearchFieldProps) {
  const auto = useId()
  const inputId = id ?? auto
  const clear = () => {
    if (onClear) onClear()
    else onChange('')
    document.getElementById(inputId)?.focus()
  }
  return (
    <TextField
      {...rest}
      id={inputId}
      type="search"
      hideLabel={hideLabel}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      icon={<svg {...ICON} className="size-4"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>}
      trailing={value !== '' ? (
        <IconButton tone="ghost" aria-label={clearLabel} onClick={clear} icon={<svg {...ICON} className="size-4"><path d="M18 6 6 18M6 6l12 12" /></svg>} />
      ) : undefined}
      inputClassName={cx('[&::-webkit-search-cancel-button]:appearance-none', inputClassName)}
    />
  )
}

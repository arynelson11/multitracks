import { useRef } from 'react'
import type React from 'react'
import { cx } from './cx'

export interface TabItem<T extends string> {
  value: T
  label: string
  disabled?: boolean
}

export interface TabsProps<T extends string> {
  /** Base dos ids: a aba é `${id}-tab-${value}` e o painel (TabPanel) é `${id}-panel`. */
  id: string
  tabs: TabItem<T>[]
  value: T
  onChange: (value: T) => void
  'aria-label': string
  className?: string
}

// Grupo do v5 (.tabs): as abas descem de linha quando não cabem, nunca cortam nem rolam.
const LIST = 'flex flex-wrap gap-[3px] p-[3px] rounded-ps-lg bg-ps-s1 inset-ring inset-ring-ps-line'

// A cor sai do estado (atual x não), pra variação não disputar com a base.
// grow + shrink-0 + basis-auto: cada aba tem pelo menos a largura do texto e as da linha dividem a sobra.
const TAB =
  'inline-flex grow shrink-0 basis-auto items-center justify-center min-h-ps-touch min-w-ps-touch px-3 rounded-ps-md text-ps-label font-extrabold uppercase tracking-[0.12em] whitespace-nowrap select-none transition-colors duration-150 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ps-or disabled:cursor-not-allowed'
const TAB_IDLE = 'text-ps-mut hover:text-ps-bone'
const TAB_ON = 'bg-ps-or-soft text-ps-or inset-ring inset-ring-ps-or-line'
const TAB_DISABLED = 'opacity-35'

const tabIdOf = (id: string, value: string) => `${id}-tab-${value}`
const panelIdOf = (id: string) => `${id}-panel`

/** Próxima aba habilitada a partir de `from`, andando `step` com volta. -1 se nenhuma. */
function nextEnabled<T extends string>(tabs: TabItem<T>[], from: number, step: 1 | -1): number {
  const n = tabs.length
  for (let k = 1; k <= n; k++) {
    const i = (((from + step * k) % n) + n) % n
    if (!tabs[i].disabled) return i
  }
  return -1
}

/** Abas (tablist) com tabindex itinerante: setas com volta, Home e End; cada movimento já abre a aba. */
export function Tabs<T extends string>({ id, tabs, value, onChange, 'aria-label': ariaLabel, className }: TabsProps<T>) {
  const refs = useRef<Array<HTMLButtonElement | null>>([])
  const selected = tabs.findIndex((t) => t.value === value)
  const tabStop = selected >= 0 && !tabs[selected].disabled ? selected : tabs.findIndex((t) => !t.disabled)

  const select = (i: number) => {
    if (i < 0) return
    if (i !== selected) onChange(tabs[i].value)
    refs.current[i]?.focus()
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>, i: number) => {
    let target: number
    if (e.key === 'ArrowRight') target = nextEnabled(tabs, i, 1)
    else if (e.key === 'ArrowLeft') target = nextEnabled(tabs, i, -1)
    else if (e.key === 'Home') target = nextEnabled(tabs, tabs.length - 1, 1)
    else if (e.key === 'End') target = nextEnabled(tabs, 0, -1)
    else return
    e.preventDefault()
    select(target)
  }

  return (
    <div role="tablist" aria-label={ariaLabel} className={cx(LIST, className)}>
      {tabs.map((t, i) => {
        const on = i === selected
        return (
          <button
            key={t.value}
            ref={(el) => {
              refs.current[i] = el
            }}
            id={tabIdOf(id, t.value)}
            type="button"
            role="tab"
            aria-selected={on}
            aria-controls={panelIdOf(id)}
            tabIndex={i === tabStop ? 0 : -1}
            disabled={t.disabled}
            onClick={() => { if (!on) onChange(t.value) }}
            onKeyDown={(e) => onKeyDown(e, i)}
            className={cx(TAB, on ? TAB_ON : TAB_IDLE, t.disabled && !on && TAB_DISABLED)}
          >
            {t.label}
          </button>
        )
      })}
    </div>
  )
}

export type TabPanelProps = React.HTMLAttributes<HTMLDivElement> & {
  /** O mesmo `id` passado pras Tabs. */
  tabsId: string
  /** A aba aberta agora: o painel leva o nome dela. */
  value: string
}

/** Painel das abas: um só, com o conteúdo da aba aberta, ligado a ela por aria-labelledby. */
export function TabPanel({ tabsId, value, className, tabIndex = 0, ...rest }: TabPanelProps) {
  return (
    <div
      {...rest}
      id={panelIdOf(tabsId)}
      role="tabpanel"
      aria-labelledby={tabIdOf(tabsId, value)}
      tabIndex={tabIndex}
      className={cx('focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ps-or', className)}
    />
  )
}

import type { StemCount } from '../../lib/plans'
import { Icon } from '../stage/icons'
import { Button, Panel } from '../ui'
import { OPTIONS_COPY, STEM_OPTION_COPY } from './separatorCopy'

export interface SeparatorOptionsProps {
  /** As opções do plano (quem decide é o separationStemOptions; admin vê todas). */
  options: readonly StemCount[]
  onBack(): void
  onChoose(count: StemCount): void
}

function Group({ title, options, onChoose }: { title: string; options: readonly StemCount[]; onChoose(c: StemCount): void }) {
  if (options.length === 0) return null
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-ps-md font-bold text-ps-bone">{title}</h2>
      <div className="flex flex-col gap-2">
        {options.map((n) => (
          <Panel key={n} variant="raised" className="p-0">
            <button
              type="button"
              onClick={() => onChoose(n)}
              className="flex min-h-ps-touch w-full cursor-pointer flex-col items-start gap-1 rounded-ps-2xl px-5 py-4 text-left hover:bg-ps-s2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ps-or"
            >
              <span className="break-words text-ps-md font-bold leading-snug text-ps-bone">{STEM_OPTION_COPY[n]}</span>
              <span className="ps-num text-ps-sm text-ps-mut">{n} faixas</span>
            </button>
          </Panel>
        ))}
      </div>
    </section>
  )
}

/** Escolha de quantas faixas separar, com as opções do plano. */
export function SeparatorOptions({ options, onBack, onChoose }: SeparatorOptionsProps) {
  const basic = options.filter((n) => n === 2)
  const advanced = options.filter((n) => n !== 2)
  return (
    <div data-separator-options className="fixed inset-0 z-50 flex flex-col overflow-hidden bg-ps-ink font-ps-sans text-ps-bone">
      <header className="flex shrink-0 items-center border-b border-ps-line bg-ps-ink-0 px-ps-gutter py-1">
        <Button tone="ghost" icon={<Icon name="chl" />} onClick={onBack}>{OPTIONS_COPY.back}</Button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-ps-gutter py-8">
          <div className="flex flex-col gap-1">
            <h1 className="text-ps-lg font-extrabold leading-tight text-ps-bone">{OPTIONS_COPY.title}</h1>
            <p className="text-ps-base leading-snug text-ps-mut">{OPTIONS_COPY.subtitle}</p>
          </div>
          <Group title={OPTIONS_COPY.basic} options={basic} onChoose={onChoose} />
          <Group title={OPTIONS_COPY.advanced} options={advanced} onChoose={onChoose} />
        </div>
      </div>
    </div>
  )
}

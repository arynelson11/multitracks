import { Led, cx } from '../ui'
import { Icon } from './icons'

export interface BigButtonProps { kind: 'pad' | 'letra'; on: boolean; live: boolean; sub: string; onPress(): void }

const LABEL = { pad: 'PAD', letra: 'LETRA' } as const
const ICON = { pad: 'pad', letra: 'lyrics' } as const
const HINT = { pad: 'Abre e fecha o painel de pads', letra: 'Abre o teleprompter' } as const

// v5 .c-big: a célula tem 8 px de lado (o v5 tem 10) e o botão 6 px por dentro (o v5 tem 14), pra
// "teleprompter" caber com folga na coluna de 96 a 104 px de 1280. O botão ocupa a célula toda.
const CELL = 'relative flex min-w-0 flex-col px-2 py-3'
const BTN =
  'relative flex h-full w-full min-w-max min-h-ps-touch flex-col items-center justify-center gap-1.5 rounded-ps-xl px-1.5 font-ps-sans select-none transition-[background-color,box-shadow,color,transform] duration-150 active:scale-[0.97] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ps-or'
// PAD desligado vazado em laranja (v5 .bigbtn), LETRA neutro (v5 .bigbtn.ghost), ligado laranja cheio.
const OFF = { pad: 'bg-ps-s2 text-ps-or inset-ring-[1.5px] inset-ring-ps-or-line', letra: 'bg-ps-s2 text-ps-bone inset-ring inset-ring-ps-line hover:inset-ring-ps-line-2' } as const
const ON = 'bg-ps-or text-ps-on-or shadow-[0_0_24px_color-mix(in_srgb,var(--color-ps-or)_25%,transparent)]'

/**
 * PAD e LETRA da faixa do meio (mockup v5): ícone, rótulo grande e a linha de baixo (`sub`).
 * PAD aceso com o painel de pads aberto (`on`) e com o LED musgo piscando enquanto um pad toca
 * (`live`); LETRA abre o teleprompter. O toque só chama `onPress`.
 */
export function BigButton({ kind, on, live, sub, onPress }: BigButtonProps) {
  return (
    <div data-cell={kind} className={CELL}>
      <button
        type="button"
        data-tour={kind === 'pad' ? 'pads' : undefined}
        aria-pressed={kind === 'pad' ? on : undefined}
        aria-label={`${LABEL[kind]}: ${sub}`}
        title={HINT[kind]}
        onClick={() => onPress()}
        className={cx(BTN, on ? ON : OFF[kind])}
      >
        {kind === 'pad' && (
          <span data-led="" className="absolute top-2.5 right-2.5 flex">
            <Led state={live ? 'live' : 'off'} />
          </span>
        )}
        <Icon name={ICON[kind]} className="size-6" />
        <b className="text-[18px] leading-none font-extrabold tracking-[0.1em]">{LABEL[kind]}</b>
        <small className={cx('text-ps-micro leading-none font-bold tracking-[0.04em] whitespace-nowrap', on ? 'text-ps-on-or/75' : 'text-ps-mut')}>{sub}</small>
      </button>
    </div>
  )
}

// Tela inicial do app (o retorno do splash no App.tsx) na linguagem do palco. Só props: o App
// decide quando ela aparece (motor ainda não pronto, ou o INÍCIO tocado), liga o motor no
// Multitracks e abre o Separador. O anúncio da casa vem pronto em `ad` (o AdSlot da 1b decide
// se aparece; a vista não decide nada sobre anúncio).
import type React from 'react'
import { Loader2, Play, Wand2 } from 'lucide-react'
import { PlayMark } from '../brand/PlayMark'
import { Panel } from '../ui'
import { HOME_COPY } from './homeCopy'

export interface HomeScreenProps {
  /** O motor restaurando o repertório salvo: o ícone do Multitracks vira o spinner. */
  restoring: boolean
  onMultitracks(): void
  onSeparator(): void
  /** O AdSlot da 1b, embaixo dos dois botões. */
  ad?: React.ReactNode
}

// O cartão inteiro é o botão (como as opções do Separador): anel line-2, line-3 no mouse, foco laranja.
const CARD_BTN =
  'flex min-h-ps-touch w-full cursor-pointer flex-col items-center gap-2 rounded-ps-2xl px-6 py-5 text-center transition-[box-shadow,transform] duration-150 inset-ring inset-ring-ps-line-2 hover:inset-ring-ps-line-3 active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ps-or'

function HomeCard({ icon, label, sub, onClick, busy }: { icon: React.ReactNode; label: string; sub: string; onClick(): void; busy?: boolean }) {
  return (
    // flex: o botão ocupa a altura do cartão quando o do lado quebra mais linhas.
    <Panel variant="raised" className="flex min-w-0 flex-1 p-0">
      <button type="button" onClick={onClick} aria-busy={busy || undefined} className={CARD_BTN}>
        <span aria-hidden="true" className="mb-1 text-ps-bone">{icon}</span>
        <span className="break-words text-ps-lg leading-tight font-bold text-ps-bone">{label}</span>
        <span className="break-words text-ps-base leading-snug text-ps-mut">{sub}</span>
      </button>
    </Panel>
  )
}

export function HomeScreen({ restoring, onMultitracks, onSeparator, ad }: HomeScreenProps) {
  return (
    <div data-home-screen className="flex min-h-dvh w-full flex-col items-center justify-center bg-ps-ink px-ps-gutter py-10 font-ps-sans text-ps-bone">
      <Panel variant="raised" aria-hidden="true" className="mb-8 flex size-20 shrink-0 items-center justify-center">
        <PlayMark size="lg" />
      </Panel>
      <h1 className="mb-2 text-center text-3xl leading-tight font-extrabold tracking-tight break-words text-ps-bone sm:text-5xl">
        {HOME_COPY.title.brand} <i className="font-semibold text-ps-or">{HOME_COPY.title.accent}</i>
      </h1>
      <p className="ps-label mb-10 text-center">{HOME_COPY.tagline}</p>
      <div className="flex w-full max-w-md flex-col gap-4 sm:flex-row">
        <HomeCard
          icon={restoring
            ? <Loader2 data-home-icon="restoring" size={28} className="animate-spin motion-reduce:animate-none" />
            : <Play data-home-icon="play" size={28} fill="currentColor" />}
          label={HOME_COPY.multitracks.label}
          sub={HOME_COPY.multitracks.sub}
          busy={restoring}
          onClick={onMultitracks}
        />
        <HomeCard icon={<Wand2 size={28} />} label={HOME_COPY.separator.label} sub={HOME_COPY.separator.sub} onClick={onSeparator} />
      </div>
      {ad != null && <div data-home-ad className="mt-6 w-full max-w-md empty:hidden">{ad}</div>}
    </div>
  )
}

import { useLayoutEffect, useRef } from 'react'
import { GRID_WARNING_TEXT } from '../../lib/stageContracts'
import type { ArmIntent, GridWarning, StageClock, StageSection, TransitionView } from '../../lib/stageContracts'
import { countState, transitionWaitText } from '../../lib/transitionView'
import { Button, cx } from '../ui'
import { Icon } from './icons'
import { useFrame } from './useFrame'

export interface NextPillProps {
  transition: TransitionView | null; intent: ArmIntent | null; sections: StageSection[]; currentSection: number
  gridWarning: GridWarning | null; clock: Pick<StageClock, 'heardNow'>; onCancel(): void
}

/** Texto de espera de transitionWaitText que é alerta (âmbar): o operador não vai ouvir a contagem. */
const CLICK_OFF = 'CLICK DESLIGADO'
/** Até 4 bolinhas numa linha (os 96px do texto de espera); mais que isso (5/4, 6/8, 7/8, 12/8 contando todos os pulsos) quebram em duas. */
const DOTS_PER_ROW = 4
const DOT_COLS = ['', 'grid-cols-1', 'grid-cols-2', 'grid-cols-3', 'grid-cols-4', 'grid-cols-5', 'grid-cols-6']

/** "PRÓXIMA" pra outra seção; "REPETE" ou "REPETE 3x" quando o alvo é a seção que está tocando. */
function pillLabel(intent: ArmIntent, current: number): string {
  if (intent.target !== current) return 'PRÓXIMA'
  return typeof intent.plays === 'number' && intent.plays > 1 ? `REPETE ${intent.plays}x` : 'REPETE'
}

/** Marca de estado escrita direto no DOM (só quando muda), pra tela andar sem renderizar o React. */
function setFlag(el: HTMLElement, name: string, on: boolean) {
  const v = on ? 'true' : 'false'
  if (el.dataset[name] !== v) el.dataset[name] = v
}

// v5 .nextpill: fundo raised, borda branca de armado pulsando (borda fixa com movimento reduzido).
// Aparece com fade; some na hora (a transição só vale no estado visível), sem conteúdo velho sumindo.
// 60px no mínimo; cresce com a linha da grade ou duas linhas de bolinhas, sem texto encostar na borda.
const PILL = 'group relative flex shrink-0 items-center gap-3 min-h-[60px] py-2 pl-3.5 pr-2 rounded-ps-xl bg-ps-raised font-ps-sans'
const SHOWN = 'opacity-100 inset-ring-2 inset-ring-ps-arm animate-ps-armglow transition-[opacity,translate] duration-200'
const HIDDEN = 'opacity-0 translate-x-2.5 pointer-events-none'
const DOT =
  'ps-num grid size-[21px] place-items-center rounded-full inset-ring-[1.5px] inset-ring-ps-line-3 text-ps-sm leading-none font-extrabold text-transparent data-[on=true]:bg-ps-arm data-[on=true]:text-ps-ink data-[on=true]:shadow-[0_0_12px_color-mix(in_srgb,var(--color-ps-arm)_55%,transparent)]'
// v6 .np-wait: no lugar das bolinhas enquanto não conta; CLICK DESLIGADO em âmbar.
const WAIT =
  'ps-num hidden w-24 shrink-0 text-center text-ps-sm leading-tight font-bold text-ps-arm group-data-[waiting=true]:block data-[alert=true]:font-ps-sans data-[alert=true]:text-ps-micro data-[alert=true]:font-extrabold data-[alert=true]:tracking-[0.1em] data-[alert=true]:text-ps-alert'

/**
 * Aviso PRÓXIMA do transporte. Mostra o alvo armado na cor da seção, a contagem do último
 * compasso (bolinhas acesas pelo tempo OUVIDO) ou o texto de espera, e o aviso âmbar da grade.
 * Escondido sem pulo armado e no loop infinito da própria seção. Bolinhas e texto de espera
 * saem de transitionView.ts a cada quadro, escritos direto no DOM.
 */
export function NextPill({ transition, intent, sections, currentSection, gridWarning, clock, onCancel }: NextPillProps) {
  const pillRef = useRef<HTMLDivElement>(null)
  const dotsRef = useRef<HTMLDivElement>(null)
  const waitRef = useRef<HTMLSpanElement>(null)

  const section = intent ? sections.find((s) => s.index === intent.target) : undefined
  const selfLoop = intent !== null && intent.target === currentSection && intent.plays === 'infinite'
  const hidden = !intent || !section || selfLoop
  const shown = hidden ? null : transition // a conta do pulo, só quando o aviso aparece
  const total = shown ? Math.min(12, Math.max(0, Math.floor(shown.countTotal) || 0)) : 0
  const cols = total > DOTS_PER_ROW ? Math.ceil(total / 2) : total
  const warning = !hidden && (gridWarning === 'sem-click-lido' || gridWarning === 'compasso-assumido') ? GRID_WARNING_TEXT[gridWarning] : null

  const paint = () => {
    const pill = pillRef.current
    const dots = dotsRef.current
    const wait = waitRef.current
    if (!pill || !dots || !wait) return
    const now = shown ? clock.heardNow() : 0
    const text = shown ? transitionWaitText(shown, now) : null
    const lit = shown && text === null ? countState(shown, now).lit : null
    // Sem a conta do motor ainda (ou escondido), o lugar das bolinhas fica vazio.
    setFlag(pill, 'waiting', !shown || text !== null)
    if (wait.textContent !== (text ?? '')) wait.textContent = text ?? ''
    setFlag(wait, 'alert', text === CLICK_OFF)
    for (let i = 0; i < dots.children.length; i++) setFlag(dots.children[i] as HTMLElement, 'on', lit?.[i] === true)
  }
  // Pinta logo depois de cada renderização (sem esperar o quadro) e depois a cada quadro enquanto aparece.
  useLayoutEffect(paint)
  useFrame(paint, shown !== null)

  return (
    <div
      ref={pillRef}
      role="status"
      aria-hidden={hidden || undefined}
      inert={hidden}
      className={cx(PILL, hidden ? HIDDEN : SHOWN)}
    >
      <div className="flex flex-col">
        <span className="text-ps-micro leading-none font-extrabold tracking-[0.1em] whitespace-nowrap text-ps-arm">
          {intent && !hidden ? pillLabel(intent, currentSection) : ''}
        </span>
        <strong
          className="mt-1 text-ps-lg leading-[1.15] font-extrabold tracking-[0.02em] whitespace-nowrap"
          style={section && !hidden ? { color: section.color } : undefined}
        >
          {section && !hidden ? section.label : ''}
        </strong>
        {warning && (
          <span title={warning.title} className="mt-0.5 text-ps-micro leading-none font-extrabold tracking-[0.1em] whitespace-nowrap text-ps-alert">
            {warning.label}
          </span>
        )}
      </div>
      <div ref={dotsRef} aria-hidden="true" className={cx('grid shrink-0 gap-1 group-data-[waiting=true]:hidden', DOT_COLS[cols])}>
        {Array.from({ length: total }, (_, i) => <span key={i} data-dot="" className={DOT}>{i + 1}</span>)}
      </div>
      <span ref={waitRef} data-wait="" className={WAIT} />
      <Button aria-label="Cancelar pulo" title="Cancelar pulo (Esc)" onClick={onCancel} icon={<Icon name="x" />} />
    </div>
  )
}

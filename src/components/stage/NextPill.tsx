import { useEffect, useId, useLayoutEffect, useRef } from 'react'
import { armLabel, isSelfLoop } from '../../lib/sectionArm'
import { GRID_WARNING_TEXT } from '../../lib/stageContracts'
import type { ArmIntent, GridWarning, StageClock, StageSection, TransitionView } from '../../lib/stageContracts'
import { countState, transitionWaitText } from '../../lib/transitionView'
import { Button, Led, cx } from '../ui'
import { Icon } from './icons'
import { setFlag, setText } from './stageDom'
import { useFrame } from './useFrame'

export interface NextPillProps {
  transition: TransitionView | null; intent: ArmIntent | null; sections: StageSection[]; currentSection: number
  gridWarning: GridWarning | null; clock: Pick<StageClock, 'heardNow'>; onCancel(): void
}

/** Texto de espera de transitionWaitText que é alerta (âmbar): o operador não vai ouvir a contagem. */
const CLICK_OFF = 'CLICK DESLIGADO'
/** Um compasso tem no máximo 7 tempos (7/8). */
const MAX_DOTS = 7
/** Até 4 bolinhas numa linha (cabem nos 76 px reservados); 5 a 7 em duas linhas. */
const DOTS_PER_ROW = 4
const DOT_COLS = ['', 'grid-cols-1', 'grid-cols-2', 'grid-cols-3', 'grid-cols-4']
/** Nome a 16 px em até 2 linhas (altura de linha 1,1); passou disso, desce pra 14 px. Nunca corta. */
const NAME_PX = 16
const NAME_LEADING = 1.1
const NAME_MAX_LINES = 2

/**
 * Pulsos do click por bolinha. A contagem chega em pulsos (`countTotal`) e a bolinha é um
 * TEMPO do compasso: o composto contado pulso a pulso (6/8 com 6 bipes, 12/8 com 12) junta
 * 3 pulsos por tempo, então 6/8 mostra 2 bolinhas e 12/8 mostra 4. Os outros já dão um bipe por tempo.
 */
function pulsesPerDot(total: number): number {
  return total === 6 || total === 12 ? 3 : 1
}

/** "PRÓXIMA" pra outra seção; "REPETE" ou "REPETE 3x" quando o alvo é a seção que está tocando (regra da T4). */
function labelText(intent: ArmIntent, current: number): string {
  const l = armLabel(intent, current)
  if (!l || l.kind === 'proxima') return 'PRÓXIMA'
  return typeof l.plays === 'number' && l.plays > 1 ? `REPETE ${l.plays}x` : 'REPETE'
}

/** Nome em 16 px; se passar de 2 linhas na largura que a coluna dá, 14 px. Mede só ao renderizar e ao redimensionar. */
function fitName(name: HTMLElement): void {
  delete name.dataset.fit
  if (name.offsetHeight > NAME_PX * NAME_LEADING * (NAME_MAX_LINES + 0.5)) name.dataset.fit = 'small'
}

// v5 .nextpill: fundo raised, borda branca de armado pulsando (borda fixa com movimento reduzido).
// Encolhe dentro da coluna (o texto quebra, nunca vaza nem corta). 60 px no mínimo e, no pior caso
// (rótulo + 2 linhas do nome), 63 px: cabe no transporte de 72 px com 4 px de folga em cima e embaixo.
// Aparece com fade; some na hora (a transição só vale no estado visível).
const PILL = 'group relative flex min-w-0 max-w-full items-center gap-2 min-h-[60px] py-2 pl-3 pr-1.5 rounded-ps-xl bg-ps-raised font-ps-sans'
const SHOWN = 'opacity-100 inset-ring-2 inset-ring-ps-arm animate-ps-armglow transition-[opacity,translate] duration-200'
const HIDDEN = 'opacity-0 translate-x-2.5 pointer-events-none'
const TAG = 'text-ps-micro leading-none font-extrabold tracking-[0.1em]'
const DOT =
  'ps-num grid size-4 place-items-center rounded-full inset-ring-[1.5px] inset-ring-ps-line-3 text-ps-micro leading-none font-extrabold text-transparent data-[on=true]:bg-ps-arm data-[on=true]:text-ps-ink data-[on=true]:shadow-[0_0_10px_color-mix(in_srgb,var(--color-ps-arm)_55%,transparent)]'
// v6 .np-wait: na mesma célula das bolinhas (largura e altura reservadas, nada pula no primeiro bipe).
const WAIT =
  'ps-num invisible w-full text-center text-ps-sm leading-tight font-bold text-ps-arm [grid-area:1/1] group-data-[waiting=true]:visible data-[alert=true]:font-ps-sans data-[alert=true]:text-ps-micro data-[alert=true]:font-extrabold data-[alert=true]:tracking-[0.1em] data-[alert=true]:text-ps-alert'

/**
 * Aviso PRÓXIMA do transporte: alvo armado na cor da seção, contagem do último compasso
 * (uma bolinha por tempo, acesa pelo tempo OUVIDO) ou texto de espera, e o aviso âmbar da
 * grade ao lado do rótulo. Escondido sem pulo armado e no loop infinito da própria seção.
 * Bolinhas e texto de espera saem de transitionView.ts a cada quadro, escritos direto no DOM.
 * O leitor de tela ouve só a região viva ao lado (armou, trocou, desarmou), nunca a contagem.
 */
export function NextPill({ transition, intent, sections, currentSection, gridWarning, clock, onCancel }: NextPillProps) {
  const pillRef = useRef<HTMLDivElement>(null)
  const nameRef = useRef<HTMLElement>(null)
  const dotsRef = useRef<HTMLDivElement>(null)
  const waitRef = useRef<HTMLSpanElement>(null)
  const descId = useId()

  const section = intent ? sections.find((s) => s.index === intent.target) : undefined
  const selfLoop = isSelfLoop(intent, currentSection)
  const visible = intent !== null && section !== undefined && !selfLoop
  const shown = visible ? transition : null // a conta do pulo, só com o aviso na tela
  const total = shown ? Math.max(0, Math.floor(shown.countTotal) || 0) : 0
  const perDot = pulsesPerDot(total)
  const dotCount = Math.min(MAX_DOTS, Math.ceil(total / perDot))
  const cols = dotCount > DOTS_PER_ROW ? Math.ceil(dotCount / 2) : dotCount
  const warning = visible && (gridWarning === 'sem-click-lido' || gridWarning === 'compasso-assumido') ? GRID_WARNING_TEXT[gridWarning] : null
  const label = intent && visible ? labelText(intent, currentSection) : ''

  let announce = 'Nenhum pulo armado'
  if (intent && section && selfLoop) announce = `LOOP ${section.label}`
  else if (visible && section) announce = `${label} ${section.label}${warning ? `. ${warning.label}: ${warning.title}` : ''}`

  const paint = () => {
    const pill = pillRef.current
    const dots = dotsRef.current
    const wait = waitRef.current
    if (!pill || !dots || !wait) return
    const now = shown ? clock.heardNow() : 0
    const text = shown ? transitionWaitText(shown, now) : null
    const lit = shown && text === null ? countState(shown, now).lit : null
    // Sem a conta do motor ainda (ou escondido), o lugar reservado fica vazio.
    setFlag(pill, 'waiting', !shown || text !== null)
    setText(wait, text ?? '')
    setFlag(wait, 'alert', text === CLICK_OFF)
    for (let i = 0; i < dots.children.length; i++) {
      let on = false
      for (let k = i * perDot; lit && k < (i + 1) * perDot; k++) if (lit[k]) on = true
      setFlag(dots.children[i] as HTMLElement, 'on', on)
    }
  }
  // Depois de cada renderização: acerta o tamanho do nome e pinta (sem esperar o quadro).
  useLayoutEffect(() => {
    if (nameRef.current) fitName(nameRef.current)
    paint()
  })
  useFrame(paint, shown !== null)
  // A largura da coluna muda com a janela: mede o nome de novo.
  useEffect(() => {
    const column = pillRef.current?.parentElement
    if (!column || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => { if (nameRef.current) fitName(nameRef.current) })
    ro.observe(column)
    return () => ro.disconnect()
  }, [])

  return (
    <>
      <div role="status" className="sr-only">{announce}</div>
      <div
        ref={pillRef}
        data-next-pill=""
        aria-hidden={visible ? undefined : true}
        inert={!visible}
        className={cx(PILL, visible ? SHOWN : HIDDEN)}
      >
        <div className="flex min-w-0 flex-col">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <span className={cx(TAG, 'whitespace-nowrap text-ps-arm')}>{label}</span>
            {/* Abaixo de 1280 o aviso da grade vira uma luz âmbar (o texto inteiro fica no title, na região
                viva e na descrição do X): rótulo e aviso numa linha só, e o aviso nunca passa da altura do transporte. */}
            {warning && <span title={warning.title} className={cx(TAG, 'text-ps-alert max-xl:hidden')}>{warning.label}</span>}
            {warning && (
              <span data-grid-warning-led="" title={warning.title} className="inline-flex self-center xl:hidden">
                <Led state="alert" size="sm" />
              </span>
            )}
          </div>
          <strong
            ref={nameRef}
            data-pill-name=""
            className="mt-0.5 text-ps-md leading-[1.1] font-extrabold tracking-[0.02em] break-words data-[fit=small]:text-[14px]"
            style={visible && section ? { color: section.color } : undefined}
          >
            {visible && section ? section.label : ''}
          </strong>
          {warning && <span id={descId} className="sr-only">{warning.title}</span>}
        </div>
        <div data-count-slot="" className="grid w-[76px] shrink-0 place-items-center">
          <div ref={dotsRef} data-dots="" aria-hidden="true" className={cx('grid gap-1 [grid-area:1/1] group-data-[waiting=true]:invisible', DOT_COLS[cols])}>
            {Array.from({ length: dotCount }, (_, i) => <span key={i} data-dot="" className={DOT}>{i + 1}</span>)}
          </div>
          <span ref={waitRef} data-wait="" className={WAIT} />
        </div>
        <Button
          aria-label="Cancelar pulo" aria-describedby={warning ? descId : undefined} title="Cancelar pulo (Esc)"
          onClick={onCancel} icon={<Icon name="x" />}
        />
      </div>
    </>
  )
}

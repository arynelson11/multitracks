import { useId, useLayoutEffect, useRef } from 'react'
import type React from 'react'
import { useTwoTapConfirm } from '../../hooks/useTwoTapConfirm'
import { isSelfLoop, startAction } from '../../lib/sectionArm'
import type { StageActions, StageClock, StageView } from '../../lib/stageContracts'
import { Led, Segmented, cx } from '../ui'
import type { SegmentedOption } from '../ui'
import { Icon } from './icons'
import type { IconName } from './iconNames'
import { NextPill } from './NextPill'
import { useExclusiveArm } from './panelDismiss'
import { PlayButton } from './PlayButton'
import type { StagePulse } from './PlayButton'

export type { StagePulse } from './PlayButton'

export interface TransportBarProps {
  view: Pick<StageView, 'isPlaying' | 'isCountingIn' | 'precount' | 'endMode' | 'click' | 'intent' | 'transition' | 'sections' | 'currentSection' | 'gates' | 'gridWarning'>
  actions: Pick<StageActions, 'togglePlay' | 'goToStart' | 'setEndMode' | 'togglePrecount' | 'cyclePrecountBeats' | 'toggleClick' | 'openMetronome' | 'stepSection' | 'cancelArm' | 'toggleLoop'>
  clock: Pick<StageClock, 'heardNow' | 'position'>; pulse: StagePulse | null
}

const END_MODES: SegmentedOption<StageView['endMode']>[] = [
  { value: 'continue', label: 'AUTO' },
  { value: 'stop', label: 'PARAR' },
  { value: 'fade-out', label: 'FADE' },
]
// No Livre o AUTO entre músicas é do pago (Ruling AUTO-livre): aparece desligado, com o selo do
// Livre, e o toque vai pro App, que pede a tela do repertório (com a música parada).
const END_MODES_LIVRE: SegmentedOption<StageView['endMode']>[] = [
  { value: 'continue', label: 'AUTO', badge: 'LIVRE', title: 'No Livre, passar sozinho pra próxima música é do Pro' },
  { value: 'stop', label: 'PARAR' },
  { value: 'fade-out', label: 'FADE' },
]
const NO_CLICK = 'Esta música não tem canal de click'
const START_SEEK = 'Volta a VS pro 0:00'
const START_ARM = 'Arma a volta pro começo: a seção termina, conta e entra no 1 da primeira seção. Toque de novo, no X do aviso ou Esc cancela.'
const START_CONFIRM = 'Tocando: toque duas vezes pra voltar a VS pro 0:00'
const START_ARMED = 'Toque de novo pra voltar a VS pro 0:00'
const NO_SECTIONS = 'Esta música ainda não tem seções. Marque no EDITAR.'

// v5 .tb: ícone em cima e rótulo embaixo, 56px de altura, largura pelo texto (no mínimo 72px).
// O Button da Parte 1 é em linha (ícone ao lado do texto, 44 ou 56px, padding de 12px), por isso a classe própria.
const TB =
  'relative inline-flex shrink-0 flex-col items-center justify-center gap-1.5 min-w-[72px] h-14 px-4 max-xl:min-w-[56px] max-xl:px-2 whitespace-nowrap select-none transition-[background-color,box-shadow,color,transform] duration-150 active:scale-[0.96] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ps-or disabled:opacity-35 disabled:pointer-events-none'
const TB_OFF = 'bg-ps-s1 text-ps-bone inset-ring inset-ring-ps-line hover:inset-ring-ps-line-2'
const TB_ON = 'bg-ps-or-soft text-ps-or inset-ring inset-ring-ps-or-line'
const TB_LABEL = 'text-ps-micro leading-none font-bold tracking-[0.1em]'
// COMEÇO armado pro segundo toque: o âmbar das ações de dois toques do palco.
const TB_ARMED = 'bg-ps-alert text-ps-ink'
// Sozinho, ou a metade esquerda de um par colado (v5 .combo).
const ROUND_SOLO = 'rounded-ps-lg'
const ROUND_LEFT = 'rounded-l-ps-lg rounded-r-[4px]'
// v5 .sub: a metade direita do par colado (metrônomo, número da pré-contagem), com alvo de 44px.
const SUB =
  'inline-flex shrink-0 items-center justify-center min-w-ps-touch h-14 px-2.5 rounded-l-[4px] rounded-r-ps-lg bg-ps-s1 inset-ring inset-ring-ps-line hover:inset-ring-ps-line-2 select-none transition-[box-shadow,color,transform] duration-150 active:scale-[0.96] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ps-or'
// v5 .secnav: dois botões de 62px com o rótulo SEÇÃO embaixo; foco por dentro (a caixa corta o lado de fora).
const SECNAV_BTN =
  'flex min-w-[62px] max-xl:min-w-[48px] h-14 items-start justify-center pt-[9px] text-ps-bone transition-colors duration-150 hover:bg-ps-s2 active:scale-[0.96] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ps-or disabled:opacity-35 disabled:pointer-events-none'

interface TransportButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  icon: IconName
  label: string
  /** Botão de liga e desliga: LED no canto e aria-pressed. */
  toggle?: boolean
  on?: boolean
  joined?: boolean
}

function TransportButton({ icon, label, toggle = false, on = false, joined = false, ...rest }: TransportButtonProps) {
  return (
    <button
      {...rest}
      type="button"
      aria-pressed={toggle ? on : undefined}
      className={cx(TB, on ? TB_ON : TB_OFF, joined ? ROUND_LEFT : ROUND_SOLO)}
    >
      {toggle && <Led state={on ? 'on' : 'off'} size="sm" className="absolute top-[7px] right-2" />}
      <Icon name={icon} />
      <span className={cx(TB_LABEL, on ? 'text-ps-or' : 'text-ps-mut')}>{label}</span>
    </button>
  )
}

/**
 * COMEÇO (Ruling I3-comeco): parado, um toque volta pro 0:00; tocando com seções, um toque arma a
 * primeira seção como um pulo (o App arma; cancela como qualquer armada); tocando sem nada pra armar,
 * o primeiro toque arma o "VOLTAR?" (3 s, desarma com Esc, quando a música para ou quando outra ação
 * de dois toques do palco arma) e o segundo volta. Os dois rótulos ocupam a mesma célula, então o
 * botão nunca muda de largura e o Play ao lado não anda.
 */
function StartButton({ isPlaying, sectionCount, gates, onStart }: { isPlaying: boolean; sectionCount: number; gates: StageView['gates']; onStart(): void }) {
  const id = useId()
  const action = startAction(isPlaying, sectionCount, gates)
  const { armedId, press, disarm } = useTwoTapConfirm(() => onStart(), { resetKey: action })
  const armed = action === 'confirm' && armedId === id
  useExclusiveArm(armed, id, disarm)
  const title = armed ? START_ARMED : action === 'arm' ? START_ARM : action === 'confirm' ? START_CONFIRM : START_SEEK
  return (
    <button
      type="button" aria-label={armed ? START_ARMED : undefined} title={title} data-armed={armed ? 'true' : 'false'}
      onClick={() => { if (action === 'confirm') press(id); else onStart() }}
      // Tecla segurada repete o clique: só o primeiro vale (o segundo toque é uma decisão nova).
      onKeyDown={(e) => { if (e.repeat && (e.key === 'Enter' || e.key === ' ')) e.preventDefault() }}
      className={cx(TB, armed ? TB_ARMED : TB_OFF, ROUND_SOLO)}
    >
      <Icon name="start" />
      <span className={cx('grid', TB_LABEL, armed ? 'text-ps-ink' : 'text-ps-mut')}>
        <span data-start-label="" aria-hidden={armed ? 'true' : undefined} className={cx('[grid-area:1/1] text-center', armed && 'invisible')}>COMEÇO</span>
        <span data-start-label="" aria-hidden={armed ? undefined : 'true'} className={cx('[grid-area:1/1] text-center', !armed && 'invisible')}>VOLTAR?</span>
      </span>
    </button>
  )
}

/**
 * Transporte do palco novo (mockup v5): fim da música à esquerda; no centro COMEÇO, Play,
 * LOOP, CLICK com o metrônomo colado, PRÉ-CONT. com o número colado e SEÇÃO ◂ ▸; o aviso
 * PRÓXIMA à direita. Só repassa toques pras ações; o que muda a cada quadro fica no Play e no aviso.
 */
export function TransportBar({ view, actions, clock, pulse }: TransportBarProps) {
  const { intent, currentSection, click, precount } = view
  const barRef = useRef<HTMLElement>(null)
  const pillColumnRef = useRef<HTMLDivElement>(null)
  const loopOn = isSelfLoop(intent, currentSection)
  const hasClick = click.channelId !== null
  // Plano pago sem seções marcadas: nada pra armar. No Livre os toques seguem pro convite dos planos.
  const noSections = view.gates.sections && view.sections.length === 0

  // O aviso sumiu (cancelou ou pousou) com o foco no X: o foco vai pro Play, nunca pro body.
  useLayoutEffect(() => {
    const column = pillColumnRef.current
    const focused = document.activeElement
    if (!column || !focused || !column.contains(focused) || !column.querySelector('[inert]')) return
    barRef.current?.querySelector<HTMLElement>('[data-tour="play"]')?.focus()
  })

  // Três colunas do v5. A partir de 1280 a do aviso tem no mínimo 328 px (rótulo + aviso da grade
  // numa linha e o nome em 2 linhas, ao lado do X e do lugar reservado): de ~1360 px pra cima tudo
  // fica centralizado; em 1280 o centro fica fixo um pouco à esquerda do meio. O mínimo não depende
  // do conteúdo, então o centro nunca anda durante o uso. A linha tem a altura do transporte: nada
  // mais alto empurra o centro pra baixo. Abaixo de 1280 (Ruling T18-1024): o fim da música e o
  // centro ficam com a largura do conteúdo (nada se cobre), o centro fica mais justo (botões com
  // 8 px de folga, vãos menores) e o aviso fica com o resto (241 px em 1024: o nome cabe em 2 linhas
  // e a linha do transporte nunca passa da altura dela). As larguras não dependem do aviso, então
  // armar não mexe no centro.
  return (
    <section
      ref={barRef}
      aria-label="Transporte"
      className="grid h-[clamp(72px,9vh,88px)] shrink-0 grid-rows-[minmax(0,1fr)] items-center max-xl:grid-cols-[auto_auto_minmax(0,1fr)] xl:grid-cols-[minmax(0,1fr)_auto_minmax(328px,1fr)] gap-x-3.5 max-xl:gap-x-2.5 border-b border-ps-line px-ps-gutter font-ps-sans"
    >
      <div className="flex min-w-0 items-center">
        <div data-tour="modos" className="flex flex-col gap-[5px]">
          <span className="ps-label leading-none">Fim da música</span>
          <Segmented
            aria-label="Fim da música" options={view.gates.autoNext === false ? END_MODES_LIVRE : END_MODES} value={view.endMode} onChange={actions.setEndMode}
            className="max-xl:[&>button]:min-w-ps-touch max-xl:[&>button]:px-2"
          />
        </div>
      </div>

      <div className="flex items-center gap-2 max-xl:gap-1.5">
        <StartButton isPlaying={view.isPlaying} sectionCount={view.sections.length} gates={view.gates} onStart={actions.goToStart} />
        <PlayButton
          isPlaying={view.isPlaying} isCountingIn={view.isCountingIn} precountTimes={precount.times}
          pulse={pulse} clock={clock} onToggle={actions.togglePlay}
        />
        <span className="inline-flex shrink-0" title={noSections ? NO_SECTIONS : undefined}>
          <TransportButton
            icon="loop" label="LOOP" toggle on={loopOn} disabled={noSections}
            title={noSections ? NO_SECTIONS : 'Repete a seção atual sem parar, o mesmo que o ∞ (tecla L)'}
            onClick={actions.toggleLoop}
          />
        </span>
        <div className="flex shrink-0 gap-0.5" title={hasClick ? undefined : NO_CLICK}>
          <TransportButton
            icon="metro" label="CLICK" toggle joined on={hasClick && click.on} disabled={!hasClick}
            title={hasClick ? 'Liga e desliga o canal de click (o mesmo que o M do canal Click)' : NO_CLICK}
            onClick={actions.toggleClick}
          />
          <button
            type="button" data-tour="metronomo" aria-label="Metrônomo" title="Metrônomo (abre o modal do click)"
            onClick={actions.openMetronome} className={cx(SUB, 'text-ps-mut hover:text-ps-bone')}
          >
            <Icon name="sliders" className="size-[17px]" />
          </button>
        </div>
        <div data-tour="precontagem" className="flex shrink-0 gap-0.5">
          <TransportButton
            icon="count" label="PRÉ-CONT." aria-label="Pré-contagem" toggle joined on={precount.enabled}
            title="Pré-contagem antes de começar a tocar" onClick={actions.togglePrecount}
          />
          <button
            type="button" aria-label={`Tempos da pré-contagem: ${precount.beats}`} title="Tempos da pré-contagem (toque pra trocar)"
            onClick={actions.cyclePrecountBeats}
            className={cx(SUB, 'ps-num text-ps-md leading-none font-extrabold', precount.enabled ? 'text-ps-bone' : 'text-ps-dim')}
          >
            {precount.beats}
          </button>
        </div>
        <span aria-hidden="true" className="mx-1 max-xl:mx-0 h-9 w-px shrink-0 bg-ps-line" />
        <div
          role="group" aria-label="Seção" title={noSections ? NO_SECTIONS : undefined}
          className="relative grid shrink-0 grid-cols-2 overflow-hidden rounded-ps-lg bg-ps-s1 inset-ring inset-ring-ps-line"
        >
          <button
            type="button" aria-label="Armar seção anterior" title={noSections ? NO_SECTIONS : 'Arma a seção anterior (seta esquerda)'}
            disabled={noSections} onClick={() => actions.stepSection(-1)} className={SECNAV_BTN}
          >
            <Icon name="chl" />
          </button>
          <button
            type="button" aria-label="Armar seção seguinte" title={noSections ? NO_SECTIONS : 'Arma a seção seguinte (seta direita)'}
            disabled={noSections} onClick={() => actions.stepSection(1)}
            className={cx(SECNAV_BTN, 'shadow-[inset_1px_0_0_var(--color-ps-line)]')}
          >
            <Icon name="chr" />
          </button>
          <span aria-hidden="true" className="pointer-events-none absolute inset-x-0 bottom-[9px] text-center text-ps-micro leading-none font-bold tracking-[0.11em] text-ps-mut">
            SEÇÃO
          </span>
        </div>
      </div>

      <div ref={pillColumnRef} className="flex min-w-0 justify-end">
        <NextPill
          transition={view.transition} intent={intent} sections={view.sections} currentSection={currentSection}
          gridWarning={view.gridWarning} clock={clock} onCancel={actions.cancelArm}
        />
      </div>
    </section>
  )
}

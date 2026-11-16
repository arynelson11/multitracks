import { useLayoutEffect, useRef, useState } from 'react'
import { isSelfLoop } from '../../lib/sectionArm'
import type { ArmIntent, Plays, StageClock, StageGates, StageSection } from '../../lib/stageContracts'
import { Chip, cx } from '../ui'
import { Icon } from './icons'
import { padProgress } from './sectionPadMeta'
import { setText } from './stageDom'
import { useFrame } from './useFrame'

export interface CurrentSectionCellProps {
  sections: StageSection[]; currentSection: number; intent: ArmIntent | null; gates: StageGates; clock: Pick<StageClock, 'position'>
  onArmRepeat(plays: Plays): void; onToggleLoop(): void; onUpgrade(): void
}

const NO_SECTIONS = 'Esta música ainda não tem seções. Marque no EDITAR.'
const NO_SECTIONS_FREE = 'Seções e repetição são dos planos pagos.'
const BEFORE_FIRST = 'A VS ainda não chegou na primeira seção.'
/** Teto do seletor quando o plano não tem teto (maxRepeats infinito): cabe na largura reservada. */
const MAX_SHOWN = 99

/** "m:ss" sem arredondar pra cima; negativo ou inválido é "0:00". */
function clockMSS(t: number): string {
  const s = Number.isFinite(t) && t > 0 ? Math.floor(t) : 0
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

/** "comp. N de M" quando a seção sabe quantos compassos tem, senão "m:ss de m:ss" (dentro dela / duração). */
function barText(s: StageSection, position: number): string {
  if (s.bars !== null && s.bars >= 1) {
    const bars = Math.floor(s.bars)
    return `comp. ${Math.min(bars, Math.floor(padProgress(s, position) * bars) + 1)} de ${bars}`
  }
  return `${clockMSS(padProgress(s, position) * (s.end - s.start))} de ${clockMSS(s.end - s.start)}`
}

function setScale(el: HTMLElement, p: number): void {
  const v = `scaleX(${Math.round(p * 1000) / 1000})`
  if (el.style.transform !== v) el.style.transform = v
}

/** Passagens que o plano deixa escolher (regra do clampPlays da T4): no mínimo 1. */
function repeatCap(maxRepeats: number): number {
  if (!(maxRepeats >= 1)) return 1
  return Math.min(MAX_SHOWN, Math.floor(maxRepeats))
}

// v5 .cell. A célula é medida pela faixa (data-fit-height): se o nome quebrar a ponto de não caber na
// altura, ele desce pra 16 px (nome de seção nunca é cortado, Ruling T8-4). @container: o ícone do
// REPETIR só aparece quando a célula tem largura pra ele (a fileira de 44 px não cabe com ele em 1280).
const CELL = 'group/fit @container relative flex min-w-0 flex-col justify-center gap-2 px-4 py-3'
const NAME =
  'text-[clamp(22px,3vh,30px)] leading-[1.05] font-extrabold tracking-[0.02em] break-words group-data-[fit=small]/fit:text-ps-md'
// v5 .chip.sm.rep: branco de armado (cheio) quando o REPETIR está armado na atual.
const REPEAT =
  'inline-flex shrink-0 items-center justify-center gap-1.5 min-w-ps-touch min-h-ps-touch px-2.5 rounded-ps-md text-ps-sm font-extrabold tracking-[0.08em] whitespace-nowrap select-none transition-[background-color,box-shadow,color,transform] duration-150 active:scale-[0.96] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ps-or disabled:opacity-35 disabled:pointer-events-none'
const REPEAT_OFF = 'bg-ps-s2 text-ps-bone inset-ring inset-ring-ps-line hover:inset-ring-ps-line-2'
const REPEAT_ARMED = 'bg-ps-arm text-ps-ink'
// v5 .stepper: − Nx + num grupo; os dois botões com 44 px (o v5 tem 32 de largura).
const STEP =
  'inline-flex min-h-ps-touch min-w-ps-touch shrink-0 items-center justify-center rounded-ps-md text-ps-bone transition-colors duration-150 hover:bg-ps-s3 active:scale-[0.96] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ps-or disabled:opacity-35 disabled:pointer-events-none'
const CHIP_EXTRA = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ps-or disabled:opacity-35 disabled:pointer-events-none'

/**
 * Seção atual da faixa do meio (mockup v5): "comp. N de M" (ou "m:ss de m:ss"), nome na cor da
 * seção, progresso, REPETIR com o seletor − Nx + e o ∞. Linha de cima e progresso saem do relógio
 * a cada quadro, direto no DOM. REPETIR arma N passagens da atual (`onArmRepeat`; a regra da T4
 * decide, inclusive o pedido de plano); mudar N com o REPETIR armado arma de novo com o N novo.
 * ∞ liga e desliga o loop da atual; sem o portão do infinito pede os planos. Sem seções, tudo
 * desabilitado; antes da primeira seção, diz qual vem.
 */
export function CurrentSectionCell({ sections, currentSection, intent, gates, clock, onArmRepeat, onToggleLoop, onUpgrade }: CurrentSectionCellProps) {
  const barRef = useRef<HTMLSpanElement>(null)
  const progressRef = useRef<HTMLElement>(null)
  const [chosen, setChosen] = useState(1)
  const section = sections.find((s) => s.index === currentSection) ?? null
  const cap = repeatCap(gates.maxRepeats)
  const n = Math.min(Math.max(1, chosen), cap)
  const repeatArmed = section !== null && intent !== null && intent.target === section.index && intent.plays !== 'infinite'
  const loopOn = section !== null && isSelfLoop(intent, section.index)
  const disabled = section === null
  const disabledHint = sections.length === 0 ? (gates.sections ? NO_SECTIONS : NO_SECTIONS_FREE) : BEFORE_FIRST

  const paint = () => {
    const bar = barRef.current
    const progress = progressRef.current
    if (!bar || !progress) return
    const position = clock.position()
    setText(bar, section ? barText(section, position) : '')
    setScale(progress, section ? padProgress(section, position) : 0)
  }
  // Pinta logo depois de cada renderização e a cada quadro (parado também: uma busca muda a posição).
  useLayoutEffect(paint)
  useFrame(paint)

  const changeN = (dir: -1 | 1) => {
    const next = Math.min(cap, Math.max(1, n + dir))
    setChosen(next)
    if (repeatArmed && next !== n) onArmRepeat(next)
  }

  let nameText = section ? section.label : 'Sem seções'
  if (!section && sections.length > 0) nameText = `Antes de ${sections[0].label}`

  return (
    <div data-cell="secao" data-fit-height="" className={CELL}>
      <div className="flex min-h-4 items-center justify-between gap-2">
        <span className="ps-label leading-none">Seção atual</span>
        <span ref={barRef} data-section-bar="" className="ps-num text-ps-sm leading-none whitespace-nowrap text-ps-mut" />
      </div>
      <strong data-section-name="" className={cx(NAME, !section && 'text-ps-dim')} style={section ? { color: section.color } : undefined}>
        {nameText}
      </strong>
      <div className="h-1 overflow-hidden rounded-[2px] bg-ps-s3">
        <i ref={progressRef} data-section-progress="" className="block h-full origin-left rounded-[2px]" style={section ? { backgroundColor: section.color } : undefined} />
      </div>
      <div className="flex items-center gap-1.5" title={disabled ? disabledHint : undefined}>
        <button
          type="button" data-armed={repeatArmed ? 'true' : 'false'} disabled={disabled} onClick={() => onArmRepeat(n)}
          title={repeatArmed ? 'Repetição armada: ao fim da seção conta no click e volta pro começo dela' : 'Repete a seção atual: termina, conta no click e volta pro começo dela'}
          className={cx(REPEAT, repeatArmed ? REPEAT_ARMED : REPEAT_OFF)}
        >
          <Icon name="loop" className="hidden size-4 @min-[272px]:block" />
          REPETIR
        </button>
        <div role="group" aria-label="Quantas vezes repetir" title="Quantas vezes repetir" className="flex shrink-0 items-center rounded-ps-md bg-ps-s2 inset-ring inset-ring-ps-line">
          <button type="button" aria-label="Menos vezes" disabled={disabled || n <= 1} onClick={() => changeN(-1)} className={STEP}>
            <Icon name="minus" className="size-4" />
          </button>
          <span data-repeat-count="" className="ps-num min-w-[30px] text-center text-ps-base font-bold">{n}x</span>
          <button type="button" aria-label="Mais vezes" disabled={disabled || n >= cap} onClick={() => changeN(1)} className={STEP}>
            <Icon name="plus" className="size-4" />
          </button>
        </div>
        <Chip
          on={loopOn} aria-label="Repetir sem parar" aria-pressed={loopOn} disabled={disabled}
          title={gates.infinite ? 'Repetir sem parar (o mesmo que LOOP)' : 'Repetir sem parar é dos planos pagos'}
          onClick={() => (gates.infinite ? onToggleLoop() : onUpgrade())} className={CHIP_EXTRA}
        >
          <Icon name="inf" className="size-4" />
        </Chip>
      </div>
    </div>
  )
}

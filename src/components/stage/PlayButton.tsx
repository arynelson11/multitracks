import { useLayoutEffect, useRef } from 'react'
import type { StageClock } from '../../lib/stageContracts'
import { cx } from '../ui'
import { Icon } from './icons'
import { useFrame } from './useFrame'

/** Pulso do click: duração de um pulso em segundos e o primeiro "1" em segundos da música (só com grade com fase). */
export interface StagePulse { seconds: number; firstDownbeat: number }

export interface PlayButtonProps {
  isPlaying: boolean; isCountingIn: boolean; precountTimes: number[]; pulse: StagePulse | null
  clock: Pick<StageClock, 'heardNow' | 'position'>; onToggle(): void
}

/** Parte do pulso em que o anel acende, como no mockup v6. */
const PULSE_WINDOW = 0.14

/** Quantos bipes da pré-contagem já foram ouvidos (tempos do contexto); 0 antes do primeiro. */
function heardPrecount(times: number[], heardNow: number): number {
  let n = 0
  for (const t of times) if (t <= heardNow) n++
  return n
}

/** Fase do pulso (0 a 1) na posição ouvida da música; nula com pulso ou posição inválidos. */
function pulsePhase(p: StagePulse, position: number): number | null {
  if (!(p.seconds > 0) || !Number.isFinite(p.firstDownbeat) || !Number.isFinite(position)) return null
  const x = (position - p.firstDownbeat) / p.seconds
  return x - Math.floor(x)
}

/** Marca de estado escrita direto no DOM (só quando muda), pra tela andar sem renderizar o React. */
function setFlag(el: HTMLElement, name: string, on: boolean) {
  const v = on ? 'true' : 'false'
  if (el.dataset[name] !== v) el.dataset[name] = v
}

// v5 .play: círculo de 68px, laranja vazado parado e cheio tocando; o anel do pulso troca a sombra.
const BASE =
  'group relative grid size-[68px] shrink-0 place-items-center rounded-full select-none transition-[background-color,box-shadow,color,transform] duration-100 active:scale-[0.96] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ps-or'
const IDLE = 'bg-ps-or/8 text-ps-or inset-ring-2 inset-ring-ps-or'
const ON =
  'bg-ps-or text-ps-on-or shadow-[0_0_0_4px_color-mix(in_srgb,var(--color-ps-or)_14%,transparent),0_0_24px_color-mix(in_srgb,var(--color-ps-or)_30%,transparent)] data-[pulse=true]:shadow-[0_0_0_7px_color-mix(in_srgb,var(--color-ps-or)_22%,transparent),0_0_34px_color-mix(in_srgb,var(--color-ps-or)_50%,transparent)]'

/**
 * Play do palco novo. Na pré-contagem mostra o número do bipe ouvido; tocando, o anel pulsa
 * no começo de cada pulso ouvido. Os dois saem do relógio a cada quadro (useFrame), direto no DOM.
 */
export function PlayButton({ isPlaying, isCountingIn, precountTimes, pulse, clock, onToggle }: PlayButtonProps) {
  const buttonRef = useRef<HTMLButtonElement>(null)
  const numberRef = useRef<HTMLSpanElement>(null)
  const on = isPlaying || isCountingIn

  const paint = () => {
    const button = buttonRef.current
    const number = numberRef.current
    if (!button || !number) return
    const beep = isCountingIn ? heardPrecount(precountTimes, clock.heardNow()) : 0
    const phase = isPlaying && beep === 0 && pulse ? pulsePhase(pulse, clock.position()) : null
    setFlag(button, 'precount', beep > 0)
    setFlag(button, 'pulse', phase !== null && phase < PULSE_WINDOW)
    const text = beep > 0 ? String(beep) : ''
    if (number.textContent !== text) number.textContent = text
  }
  // Pinta logo depois de cada renderização (sem esperar o quadro) e depois a cada quadro enquanto há o que mexer.
  useLayoutEffect(paint)
  useFrame(paint, isCountingIn || (isPlaying && pulse !== null))

  return (
    <button
      ref={buttonRef}
      type="button"
      data-tour="play"
      aria-label={on ? 'Pausar' : 'Tocar'}
      title="Tocar ou pausar (Espaço)"
      onClick={onToggle}
      className={cx(BASE, on ? ON : IDLE)}
    >
      <Icon name={on ? 'pause' : 'mark'} className="size-[30px] [grid-area:1/1] group-data-[precount=true]:hidden" />
      <span ref={numberRef} className="ps-num hidden text-[30px] leading-none font-extrabold [grid-area:1/1] group-data-[precount=true]:block" />
    </button>
  )
}

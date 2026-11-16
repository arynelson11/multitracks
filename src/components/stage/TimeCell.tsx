import { useId, useLayoutEffect, useRef } from 'react'
import { GRID_WARNING_TEXT } from '../../lib/stageContracts'
import type { GridWarning, StageClock, TimeSignature } from '../../lib/stageContracts'
import { Button, Led } from '../ui'
import { Icon } from './icons'
import { setText } from './stageDom'
import { useFrame } from './useFrame'

export interface TimeCellProps {
  duration: number; bpm: number | null; signature: TimeSignature | null; gridWarning: GridWarning | null; editMode: boolean
  clock: Pick<StageClock, 'position'>; onOpenMeter(): void
}

/** Segundos inteiros, sem arredondar pra cima (40,9 s ainda é 0:40); negativo ou inválido é 0. */
const wholeSeconds = (t: number): number => (Number.isFinite(t) && t > 0 ? Math.floor(t) : 0)
const pad2 = (n: number): string => String(n).padStart(2, '0')
/** "mm:ss" do tempo ouvido. */
const clockMMSS = (t: number): string => { const s = wholeSeconds(t); return `${pad2(Math.floor(s / 60))}:${pad2(s % 60)}` }
/** "m:ss" da duração. */
const clockMSS = (t: number): string => { const s = wholeSeconds(t); return `${Math.floor(s / 60)}:${pad2(s % 60)}` }

// v5 .cell (12 px de lado abaixo de 1280). A faixa mede a célula (data-fit-height) e, se não couber na
// altura útil, o tempo desce aos poucos até 24 px (--ps-fit).
// O tamanho cheio (--ps-time) acompanha a altura da tela (5vh, como no v5) e a largura da célula (20cqw,
// 18cqw abaixo de 1280, no lugar do 3,4vw do v5), pra "00:00 / 12:34" caber sem encostar.
const CELL =
  '@container relative flex min-w-0 flex-col justify-center gap-2 px-4 py-3 max-xl:px-3 [--ps-time:clamp(26px,min(5vh,20cqw),54px)] max-xl:[--ps-time:clamp(24px,min(5vh,18cqw),54px)]'
// v5 .time: grande em mono.
const TIME =
  'ps-num flex flex-wrap items-baseline gap-x-2 text-[length:calc(24px_+_(var(--ps-time)_-_24px)_*_var(--ps-fit,1))] leading-none font-bold tracking-[-0.03em]'
// Aviso da grade (âmbar): rótulo curto com o LED piscando; a explicação vai no title e pro leitor de tela.
const WARNING =
  'inline-flex max-w-full items-center gap-[5px] self-start rounded-ps-sm bg-ps-alert-soft px-2 py-1 text-ps-micro leading-[1.2] font-extrabold tracking-[0.1em] text-ps-alert inset-ring inset-ring-ps-alert-line'

/**
 * Tempo da faixa do meio (mockup v5): tempo OUVIDO em "mm:ss" (escrito a cada quadro, direto no
 * DOM) e a duração; "72.0 BPM · 4/4" ou "BPM não informado". O BPM é o da semínima (Ruling
 * T3-BPM: o "Fé" em 6/8 é 78); o compasso composto só muda a contagem. Sem os botões de andamento
 * (Projeto 4). Com aviso da grade, o chip âmbar com o texto de GRID_WARNING_TEXT. No modo
 * EDITAR a linha do BPM vira o botão "Compasso".
 */
export function TimeCell({ duration, bpm, signature, gridWarning, editMode, clock, onOpenMeter }: TimeCellProps) {
  const nowRef = useRef<HTMLSpanElement>(null)
  const descId = useId()
  const warning = gridWarning ? GRID_WARNING_TEXT[gridWarning] : null
  const hasBpm = bpm !== null && Number.isFinite(bpm) && bpm > 0

  const paint = () => { if (nowRef.current) setText(nowRef.current, clockMMSS(clock.position())) }
  // Pinta logo depois de cada renderização e a cada quadro (parado também: uma busca muda o tempo).
  useLayoutEffect(paint)
  useFrame(paint)

  return (
    <div data-cell="tempo" data-fit-height="" className={CELL}>
      <span className="ps-label leading-none">Tempo</span>
      <div data-time-row="" className={TIME}>
        <span ref={nowRef} data-time-now="" />
        <small className="text-[14px] font-semibold tracking-normal text-ps-mut">/ {clockMSS(duration)}</small>
      </div>
      {editMode ? (
        <Button
          icon={<Icon name="metro" className="size-4 max-xl:hidden" />} title="Escolher o compasso da música" onClick={onOpenMeter}
          aria-describedby={warning ? descId : undefined} className="self-start"
        >
          Compasso {signature && <span className="ps-num">{signature}</span>}
        </Button>
      ) : (
        <span data-bpm="" className="ps-num text-ps-base leading-tight font-semibold text-ps-mut">
          {hasBpm ? <><b className="text-[17px] font-extrabold text-ps-bone">{bpm.toFixed(1)}</b> BPM{signature && <span> · {signature}</span>}</> : 'BPM não informado'}
        </span>
      )}
      {warning && (
        <span data-grid-warning="" title={warning.title} className={WARNING}>
          <Led state="alert" size="sm" />
          {warning.label}
        </span>
      )}
      {warning && <span id={descId} className="sr-only">{warning.title}</span>}
    </div>
  )
}

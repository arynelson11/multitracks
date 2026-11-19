import { useLayoutEffect, useRef } from 'react'
import { TIME_SIGNATURES, countPulses, displayBpmFromPulseBpm, isCompound } from '../../lib/stageContracts'
import type { MeterSource, SongGrid, TimeSignature } from '../../lib/stageContracts'
import { Button, Segmented } from '../ui'
import type { SegmentedOption } from '../ui'
import { Icon } from './icons'
import { usePanelDismiss } from './panelDismiss'
import { shownBpm } from './shownBpm'

export interface MeterEditorProps {
  grid: SongGrid | null; songBpm: number | null; busy: boolean
  /** A música tem canal de Click? Sem ele "Ler o click de novo" não tem o que ler (Ruling T27-reler). */
  hasClickChannel: boolean
  onChange(sig: TimeSignature, countEvery: 1 | 3): void; onRedetect(): void; onClose(): void
}

type CountValue = '1' | '3'

const SIGNATURE_OPTIONS: SegmentedOption<TimeSignature>[] = TIME_SIGNATURES.map((s) => ({ value: s, label: s }))
// Sem grade o compasso não tem onde valer (o App não grava): desligado, com o motivo.
const NO_GRID_OPTIONS: SegmentedOption<TimeSignature>[] = SIGNATURE_OPTIONS.map((o) => ({ ...o, disabled: true }))
const NO_GRID = 'Sem click lido e sem BPM salvo não há compasso pra escolher. Salve o BPM da música ou importe o canal de Click.'
const METER_ORIGIN: Record<Exclude<MeterSource, 'padrao'>, string> = {
  acento: 'Lido no acento do click', salvo: 'Salvo na biblioteca', manual: 'Escolhido por você',
}
const BPM_FROM_CLICK = 'Lido no click'
const BPM_SAVED = 'BPM salvo da música, sem o 1 do compasso'
const NO_CLICK_TO_READ = 'Esta música não tem canal de Click: não há click pra ler de novo.'

/** De onde veio o compasso. O assumido diz qual (4/4, ou 6/8 quando a leitura do click é composta). */
function meterOrigin(g: SongGrid | null): string {
  if (!g) return 'Sem compasso lido'
  return g.meterSource === 'padrao' ? `Assumido ${g.signature}` : METER_ORIGIN[g.meterSource]
}

/**
 * BPM que a pessoa vê (a regra da faixa do meio, `shownBpm`: sempre a semínima, e trocar simples
 * por composto não muda o número) e de onde ele veio.
 */
function bpmWithOrigin(g: SongGrid | null, songBpm: number | null): { value: number; origin: string } | null {
  const value = shownBpm(g, songBpm)
  if (value === null) return null
  const fromGrid = g !== null && Number.isFinite(displayBpmFromPulseBpm(g.bpm, g.signature))
  return { value, origin: fromGrid && g.source === 'click' ? BPM_FROM_CLICK : BPM_SAVED }
}

/**
 * Compasso da música no modo EDITAR (diálogo que abre pela célula de tempo). Seletor com os
 * compassos do contrato; no 6/8 e no 12/8, se a contagem conta todos os pulsos ou de 3 em 3; de
 * onde vieram o compasso e o BPM; e "Ler o click de novo" (relê BPM e fase e mantém o compasso
 * escolhido: `keepManualMeter`, no App). O que sai em `onChange` passa pelo `withMeter` e o
 * `sanitizeGrid` devolve igual: compasso simples sempre conta 1. Fecha no X e no Esc, que vem da
 * pilha comum dos painéis do palco (`usePanelDismiss`): aberto por cima de outro painel, o Esc
 * fecha o compasso primeiro.
 */
export function MeterEditor({ grid, songBpm, busy, hasClickChannel, onChange, onRedetect, onClose }: MeterEditorProps) {
  const panelRef = useRef<HTMLDivElement>(null)

  // Fechar aqui é desmontar, e o React limpa os efeitos antes de tirar o diálogo da página: o foco
  // ainda estaria nele e a pilha comum acharia que não se perdeu. Solta o foco antes (este efeito
  // vem antes do usePanelDismiss, e a limpeza segue a mesma ordem) pra ela devolver a quem abriu.
  useLayoutEffect(() => {
    const panel = panelRef.current
    return () => {
      const active = document.activeElement
      if (active instanceof HTMLElement && panel?.contains(active)) active.blur()
    }
  }, [])
  // Esc e foco pela pilha comum dos painéis do palco (Rulings T15-esc e T15-dup): o Esc fecha o
  // aberto por último, e fechar devolve o foco pra quem abriu. Aberto enquanto montado.
  usePanelDismiss(true, onClose, panelRef)

  // Entrar no composto mantém a contagem de quem já era composto; senão conta de 3 em 3, como a leitura do click.
  const pickSignature = (sig: TimeSignature) => {
    const keep: 1 | 3 = grid !== null && isCompound(grid.signature) ? grid.countEvery : 3
    onChange(sig, isCompound(sig) ? keep : 1)
  }
  const compound = grid !== null && isCompound(grid.signature) ? grid : null
  const countOptions: SegmentedOption<CountValue>[] = compound
    ? [
        { value: '1', label: `Contar ${countPulses(compound.signature, 1)}` },
        { value: '3', label: `Contar ${countPulses(compound.signature, 3)}` },
      ]
    : []
  const bpm = bpmWithOrigin(grid, songBpm)

  return (
    <div
      ref={panelRef}
      role="dialog"
      aria-label="Compasso da música"
      tabIndex={-1}
      className="flex w-max max-w-full flex-col gap-3 rounded-ps-xl bg-ps-pop p-3 font-ps-sans text-ps-bone shadow-ps-pop inset-ring inset-ring-ps-line-2 outline-none"
    >
      <div className="flex items-center justify-between gap-3">
        <span className="ps-label pl-1">Compasso</span>
        <button
          type="button" aria-label="Fechar compasso" title="Fechar (Esc)" onClick={onClose}
          className="inline-flex min-h-ps-touch min-w-ps-touch shrink-0 items-center justify-center rounded-ps-md bg-ps-s2 text-ps-mut transition-colors hover:text-ps-bone focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ps-or"
        >
          <Icon name="x" />
        </button>
      </div>

      {/* O botão desligado não recebe o ponteiro: a dica fica no invólucro, e o motivo também se lê embaixo. */}
      <span className="inline-flex self-start" title={grid ? undefined : NO_GRID}>
        <Segmented
          aria-label="Compasso" options={grid ? SIGNATURE_OPTIONS : NO_GRID_OPTIONS} value={grid?.signature ?? null} onChange={pickSignature}
          className="flex-wrap self-start"
        />
      </span>
      {!grid && <p data-meter-note="" className="max-w-[360px] px-1 text-ps-sm text-ps-mut">{NO_GRID}</p>}
      {compound && (
        <Segmented
          aria-label="Contagem" options={countOptions} value={compound.countEvery === 3 ? '3' : '1'}
          onChange={(v) => onChange(compound.signature, v === '3' ? 3 : 1)}
          className="flex-wrap self-start"
        />
      )}

      <dl className="grid grid-cols-[auto_1fr] items-baseline gap-x-3 gap-y-1.5 px-1 text-ps-sm">
        <dt className="ps-label">Compasso</dt>
        <dd data-meter-origin="" className="text-ps-bone">{meterOrigin(grid)}</dd>
        <dt className="ps-label">BPM</dt>
        <dd className="text-ps-mut">
          <b data-bpm-value="" className="ps-num text-ps-base font-extrabold text-ps-bone">{bpm ? bpm.value.toFixed(2) : 'BPM não informado'}</b>
          {bpm && <><span aria-hidden="true"> · </span><span data-bpm-origin="">{bpm.origin}</span></>}
        </dd>
      </dl>

      {/* Sem canal de Click a releitura não faz nada no motor: desligado, com o motivo no invólucro
          (o botão desligado não recebe o ponteiro, então a dica fica em quem está por fora). */}
      <span className="inline-flex self-start" title={hasClickChannel ? undefined : NO_CLICK_TO_READ}>
        <Button onClick={onRedetect} disabled={busy || !hasClickChannel} icon={<Icon name="rev" className="size-4" />}>
          {busy ? 'Lendo o click...' : 'Ler o click de novo'}
        </Button>
      </span>
    </div>
  )
}

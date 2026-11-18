import type { OutputPlan, StageClock, StageView } from '../../lib/stageContracts'
import { cx } from '../ui'
import { FaderVU } from './FaderVU'
import { Icon } from './icons'

export interface MasterStripProps {
  master: StageView['master']; channelEditMode: boolean; clock: Pick<StageClock, 'masterLevels'>; onVolume(gain: number): void; onToggleMute(): void; onToggleChannelEdit(): void
  /** Plano de saídas de agora: o medidor diz o que as duas barras mostram. */
  outputs: OutputPlan
}

/**
 * O que o medidor do PRINCIPAL mostra (Aviso T18/T29 :155): as saídas 1 e 2 da placa, que nem
 * sempre são a VS. Em "Click e Guia separados" um lado é o ouvido da banda; em "4 ou mais" a VS
 * pode estar noutro par.
 */
function masterMeterTitle(plan: OutputPlan): string {
  if (plan.channels <= 1) return 'Medidor: a saída única da placa (tudo junto, em mono)'
  if (plan.mode === 'split2') {
    return plan.vs[0] === 1
      ? 'Medidor: saídas 1 e 2 da placa. A saída 1 é o Click e a Guia (o ouvido da banda), a 2 é a VS'
      : 'Medidor: saídas 1 e 2 da placa. A saída 1 é a VS, a 2 é o Click e a Guia (o ouvido da banda)'
  }
  if (plan.mode === 'multi') {
    const [a, b] = plan.vs
    return a === 0 && b === 1 ? 'Medidor: saídas 1 e 2 da placa (a VS)' : `Medidor: saídas 1 e 2 da placa. A VS está nas saídas ${a + 1} e ${b + 1}, fora deste medidor`
  }
  return 'Medidor: saídas 1 e 2 da placa (a VS com tudo junto)'
}

// v5 .editch, com alvo de 44 px: o texto quebra em 2 linhas dentro da coluna em vez de vazar.
// Ligado (no EDITAR CANAIS) diz PRONTO em laranja, como na Parte 1 (Ruling T14-pronto). O texto
// muda com o estado, então o botão não leva aria-pressed (o leitor de tela ouve PRONTO).
const EDIT =
  'inline-flex min-h-ps-touch w-full shrink-0 items-center justify-center gap-1.5 rounded-ps-sm px-2.5 py-1.5 text-center text-ps-micro leading-[1.2] font-extrabold tracking-[0.07em] select-none transition-[background-color,color,box-shadow] duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ps-or'
const EDIT_OFF = 'bg-ps-s2 text-ps-mut inset-ring inset-ring-ps-line hover:text-ps-bone'
const EDIT_ON = 'bg-ps-or-soft text-ps-or inset-ring inset-ring-ps-or-line'
// Mudo geral com a largura da coluna e 44 px de altura (não é a exceção do M/S dos canais).
const MUTE =
  'min-h-ps-touch w-full shrink-0 rounded-ps-sm text-ps-sm font-extrabold select-none transition-[background-color,color,box-shadow] duration-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ps-or'
const MUTE_OFF = 'bg-ps-s2 text-ps-mut inset-ring inset-ring-ps-line hover:text-ps-bone'
const MUTE_ON = 'bg-ps-mute text-ps-ink shadow-[0_0_12px_color-mix(in_srgb,var(--color-ps-mute)_45%,transparent)]'

/**
 * PRINCIPAL do mixer novo (v5 .master, 116 px): EDITAR CANAIS (PRONTO quando ligado), fader com medidor L/R e a
 * escala +6 / 0 / −12 / −24 / −∞, M (mudo geral) e o nome. A tampa leva o laranja do PRINCIPAL.
 * As alturas batem com as do canal (44 + fader + 44 + 16 = 44 + fader + 32 + 28), então o
 * fader do PRINCIPAL fica na mesma linha dos faders dos canais.
 */
export function MasterStrip({ master, channelEditMode, clock, onVolume, onToggleMute, onToggleChannelEdit, outputs }: MasterStripProps) {
  const meterTitle = masterMeterTitle(outputs)
  return (
    <div
      role="group"
      aria-label="PRINCIPAL"
      aria-description={meterTitle}
      data-master-strip=""
      className="flex h-full w-[116px] shrink-0 flex-col items-center gap-1.5 rounded-ps-2xl bg-ps-well px-2 pt-2.5 pb-2 font-ps-sans inset-ring inset-ring-ps-or/20 [--c:var(--color-ps-or)]"
    >
      <button type="button" data-on={channelEditMode} onClick={onToggleChannelEdit} className={cx(EDIT, channelEditMode ? EDIT_ON : EDIT_OFF)}>
        <Icon name={channelEditMode ? 'check' : 'edit'} className="size-3" />
        <span>{channelEditMode ? 'PRONTO' : 'EDITAR CANAIS'}</span>
      </button>
      <FaderVU
        variant="principal" gain={master.volume} quiet={master.muted} readLevel={() => clock.masterLevels()}
        label="Volume principal" onChange={onVolume} meterTitle={meterTitle}
      />
      <button type="button" aria-label="Mudo geral" title="Mudo geral" aria-pressed={master.muted} onClick={onToggleMute} className={cx(MUTE, master.muted ? MUTE_ON : MUTE_OFF)}>
        M
      </button>
      <span className="min-h-4 shrink-0 text-ps-micro leading-4 font-extrabold tracking-[0.12em] text-ps-or">PRINCIPAL</span>
    </div>
  )
}

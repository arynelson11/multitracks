import type { StageClock, StageView } from '../../lib/stageContracts'
import { cx } from '../ui'
import { FaderVU } from './FaderVU'
import { Icon } from './icons'

export interface MasterStripProps { master: StageView['master']; channelEditMode: boolean; clock: Pick<StageClock, 'masterLevels'>; onVolume(gain: number): void; onToggleMute(): void; onToggleChannelEdit(): void }

// v5 .editch, com alvo de 44 px: o texto quebra em 2 linhas dentro da coluna em vez de vazar.
// Ligado (no EDITAR CANAIS) fica laranja, como os outros botões de liga e desliga do palco.
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
 * PRINCIPAL do mixer novo (v5 .master, 116 px): EDITAR CANAIS, fader com medidor L/R e a
 * escala +6 / 0 / −12 / −24 / −∞, M (mudo geral) e o nome. A tampa leva o laranja do PRINCIPAL.
 * As alturas batem com as do canal (44 + fader + 44 + 16 = 44 + fader + 32 + 28), então o
 * fader do PRINCIPAL fica na mesma linha dos faders dos canais.
 */
export function MasterStrip({ master, channelEditMode, clock, onVolume, onToggleMute, onToggleChannelEdit }: MasterStripProps) {
  return (
    <div
      role="group"
      aria-label="PRINCIPAL"
      data-master-strip=""
      className="flex h-full w-[116px] shrink-0 flex-col items-center gap-1.5 rounded-ps-2xl bg-ps-well px-2 pt-2.5 pb-2 font-ps-sans inset-ring inset-ring-ps-or/20 [--c:var(--color-ps-or)]"
    >
      <button type="button" aria-pressed={channelEditMode} onClick={onToggleChannelEdit} className={cx(EDIT, channelEditMode ? EDIT_ON : EDIT_OFF)}>
        <Icon name="edit" className="size-3" />
        <span>EDITAR CANAIS</span>
      </button>
      <FaderVU
        variant="principal" gain={master.volume} quiet={master.muted} readLevel={() => clock.masterLevels()}
        label="Volume principal" onChange={onVolume}
      />
      <button type="button" aria-label="Mudo geral" title="Mudo geral" aria-pressed={master.muted} onClick={onToggleMute} className={cx(MUTE, master.muted ? MUTE_ON : MUTE_OFF)}>
        M
      </button>
      <span className="min-h-4 shrink-0 text-ps-micro leading-4 font-extrabold tracking-[0.12em] text-ps-or">PRINCIPAL</span>
    </div>
  )
}

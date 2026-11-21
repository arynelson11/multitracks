import { Download, Loader2, Lock } from 'lucide-react'
import { IconButton, Slider, cx } from '../ui'
import { PLAYER_COPY, panFromWheel, panText, volumeDb } from './separatorCopy'

export interface SeparatorTrackStripProps {
  index: number
  name: string
  /** A cor da faixa (dado). */
  color: string
  state: { muted: boolean; soloed: boolean; volume: number; pan: number }
  /** Calada pelo mudo dela ou pelo solo de outra (o nome apaga, como hoje). */
  silenced?: boolean
  height: number
  /** Tela baixa: o pan sai pra linha caber na faixa. */
  compact: boolean
  downloading: boolean
  downloadTitle: string
  downloadLocked: boolean
  onMute(): void
  onSolo(): void
  onDownload(): void
  onPan(pan: number): void
  onPanCenter(): void
  onVolume(v: number): void
}

// M e S do mixer: a exceção de 32 px do mixer vale aqui também (data-touch-exception="ms").
const MS = 'h-8 w-9 shrink-0 rounded-ps-sm text-ps-sm font-extrabold select-none transition-[background-color,color,box-shadow] duration-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ps-or'
const MS_OFF = 'bg-ps-s2 text-ps-mut inset-ring inset-ring-ps-line hover:text-ps-bone'
const M_ON = 'bg-ps-mute text-ps-ink shadow-[0_0_12px_color-mix(in_srgb,var(--color-ps-mute)_45%,transparent)]'
const S_ON = 'bg-ps-solo text-ps-ink shadow-[0_0_12px_color-mix(in_srgb,var(--color-ps-solo)_40%,transparent)]'

/** Coluna de controle de uma faixa do player de reserva. Só mostra. */
export function SeparatorTrackStrip(p: SeparatorTrackStripProps) {
  return (
    <div data-track-strip style={{ height: p.height }} className="relative flex shrink-0 flex-col border-b border-ps-line font-ps-sans">
      <div aria-hidden="true" className="absolute inset-x-0 top-0 h-[3px]" style={{ backgroundColor: p.color }} />
      {/* Normal: nome e M/S na primeira linha, controles embaixo. Celular em pé (compact): o M/S
          desce pra uma linha própria e o pan e o VOL saem; tela baixa (short): o pan e o VOL saem. */}
      <div className="grid h-full min-h-0 grid-cols-[minmax(0,1fr)_auto] content-start gap-x-1.5 gap-y-1.5 overflow-hidden px-2.5 pb-1.5 pt-2.5 compact:grid-cols-1">
        <div className="flex min-w-0 items-baseline gap-1.5">
          <span className="ps-num shrink-0 text-ps-micro text-ps-dim">{String(p.index + 1).padStart(2, '0')}</span>
          <span className={cx('min-w-0 break-words text-ps-sm font-bold leading-tight', p.silenced ? 'text-ps-dim' : 'text-ps-bone')}>{p.name}</span>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button type="button" data-touch-exception="ms" aria-pressed={p.state.muted} title={PLAYER_COPY.mute} onClick={p.onMute} className={cx(MS, p.state.muted ? M_ON : MS_OFF)}>M</button>
          <button type="button" data-touch-exception="ms" aria-pressed={p.state.soloed} title={PLAYER_COPY.solo} onClick={p.onSolo} className={cx(MS, p.state.soloed ? S_ON : MS_OFF)}>S</button>
        </div>
        <div className="col-span-2 flex min-w-0 items-center gap-2 compact:col-span-1">
          <IconButton
            tone="ghost" aria-label={p.downloadTitle} title={p.downloadTitle} disabled={p.downloading} aria-busy={p.downloading || undefined}
            icon={p.downloading ? <Loader2 size={15} className="animate-spin motion-reduce:animate-none" /> : p.downloadLocked ? <Lock size={15} /> : <Download size={15} />}
            onClick={p.onDownload}
          />
          {!p.compact && (
            <button
              type="button"
              aria-label={`${PLAYER_COPY.pan(p.name)}: ${panText(p.state.pan)}`}
              title={PLAYER_COPY.panTitle}
              onWheel={(e) => { e.preventDefault(); p.onPan(panFromWheel(p.state.pan, e.deltaY)) }}
              onClick={p.onPanCenter}
              className="flex size-ps-touch shrink-0 cursor-ew-resize flex-col items-center justify-center gap-0.5 rounded-full bg-ps-s2 inset-ring inset-ring-ps-line-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ps-or compact:hidden short:hidden"
            >
              <span aria-hidden="true" className="block h-3.5 w-0.5 rounded-full bg-ps-bone" style={{ transform: `rotate(${p.state.pan * 135}deg)` }} />
              <span className="ps-num text-ps-micro text-ps-mut">{panText(p.state.pan)}</span>
            </button>
          )}
          <Slider label={PLAYER_COPY.volume(p.name)} hideLabel value={p.state.volume} min={0} max={1} step={0.01} valueText={volumeDb(p.state.volume)} onChange={p.onVolume} className="min-w-16 flex-1" />
        </div>
        {!p.compact && (
          <div className="col-span-2 flex items-center justify-between compact:hidden short:hidden">
            <span className="ps-label">{PLAYER_COPY.vol}</span>
            <span className="ps-num text-ps-micro text-ps-mut">{volumeDb(p.state.volume)}</span>
          </div>
        )}
      </div>
    </div>
  )
}

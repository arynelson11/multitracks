import { Loader2, Lock, Mic, Save, UploadCloud } from 'lucide-react'
import type { DownloadFormat } from '../../lib/separation/stemFiles'
import { KEYS } from '../separation/toolsCopy'
import { Icon } from '../stage/icons'
import { Button, Chip, IconButton, Panel, Segmented, Slider, cx } from '../ui'
import { PLAYER_COPY, volumeDb } from './separatorCopy'

export interface SeparatorPlayerBarProps {
  songName: string
  channels: number
  format: DownloadFormat
  canSave: boolean
  saving: boolean
  bpm: string
  songKey: string
  keyPickerOpen: boolean
  isPlaying: boolean
  isLooping: boolean
  time: string
  total: string
  /** Nulo sem faixas. */
  voice: { count: number; locked: boolean } | null
  sync: { offsetMs: number; enabled: boolean; busy: boolean }
  masterVolume: number
  onBack(): void
  onFormat(f: DownloadFormat): void
  onSave(): void
  onExport(): void
  onOpenBpm(): void
  onKeyPicker(open: boolean): void
  onKey(k: string): void
  onStart(): void
  onTogglePlay(): void
  onEnd(): void
  onToggleLoop(): void
  onVoice(): void
  onNudge(deltaMs: 10 | -10): void
  onMaster(v: number): void
}

const PLAY_BASE =
  'grid size-12 shrink-0 place-items-center rounded-full select-none transition-[background-color,box-shadow,color,transform] duration-100 active:scale-[0.96] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ps-or'
const PLAY_IDLE = 'bg-ps-or/8 text-ps-or inset-ring-2 inset-ring-ps-or'
const PLAY_ON = 'bg-ps-or text-ps-on-or shadow-[0_0_0_4px_color-mix(in_srgb,var(--color-ps-or)_14%,transparent)]'

/** Barra do player de reserva do Separador, como a barra do palco. Só mostra. */
export function SeparatorPlayerBar(p: SeparatorPlayerBarProps) {
  const signed = `${p.sync.offsetMs > 0 ? '+' : ''}${p.sync.offsetMs}`
  return (
    <header data-separator-bar className="z-50 flex shrink-0 flex-col border-b border-ps-line bg-ps-ink-0 font-ps-sans text-ps-bone">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-ps-line px-ps-gutter py-1">
        <Button tone="ghost" icon={<Icon name="chl" />} onClick={p.onBack}>{PLAYER_COPY.back}</Button>
        <div className="flex min-w-0 flex-1 basis-40 flex-col items-center gap-0.5 text-center">
          <span className="break-words text-ps-md font-extrabold leading-tight">{p.songName || 'Sem título'}</span>
          <span className="ps-label">{PLAYER_COPY.subtitle(p.channels)}</span>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Segmented
            aria-label={PLAYER_COPY.format}
            options={[{ value: 'wav', label: 'WAV' }, { value: 'mp3', label: 'MP3' }]}
            value={p.format} onChange={(f) => { if (f !== p.format) p.onFormat(f) }}
          />
          {p.canSave && (
            <Button onClick={p.onSave} disabled={p.saving} title={PLAYER_COPY.saveTitle}
              icon={p.saving ? <Loader2 size={14} className="animate-spin motion-reduce:animate-none" /> : <Save size={14} />}>
              {p.saving ? PLAYER_COPY.saving : PLAYER_COPY.save}
            </Button>
          )}
          <Button onClick={p.onExport} icon={<UploadCloud size={15} />}>{PLAYER_COPY.export}</Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2 px-ps-gutter py-2">
        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={p.onOpenBpm} aria-label={`${PLAYER_COPY.bpm} ${p.bpm}`}>
            <span className="ps-label">{PLAYER_COPY.bpm}</span>
            <span className="ps-num text-ps-base text-ps-bone">{p.bpm}</span>
          </Button>
          <div className="relative">
            <Button onClick={() => p.onKeyPicker(!p.keyPickerOpen)} aria-expanded={p.keyPickerOpen} aria-haspopup="dialog" aria-label={`${PLAYER_COPY.key} ${p.songKey}`}>
              <span className="ps-label">{PLAYER_COPY.key}</span>
              <span className="ps-num text-ps-base text-ps-bone">{p.songKey}</span>
            </Button>
            {p.keyPickerOpen && (
              <>
                <button type="button" tabIndex={-1} aria-label={PLAYER_COPY.keyPickerClose} data-key-backdrop className="fixed inset-0 z-40 cursor-default" onClick={() => p.onKeyPicker(false)} />
                <Panel variant="pop" role="dialog" aria-label={PLAYER_COPY.keyPicker} className="absolute left-0 top-full z-[60] mt-2 w-[13.5rem] p-2">
                  <p className="ps-label mb-2 px-1">{PLAYER_COPY.keyPicker}</p>
                  <div className="grid grid-cols-4 gap-1">
                    {KEYS.map((k) => (
                      <Button key={k} tone={p.songKey === k ? 'on' : 'default'} pressed={p.songKey === k} className="ps-num px-0" onClick={() => { p.onKey(k); p.onKeyPicker(false) }}>
                        {k}
                      </Button>
                    ))}
                  </div>
                </Panel>
              </>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <IconButton icon={<Icon name="start" />} aria-label={PLAYER_COPY.start} onClick={p.onStart} />
          <button type="button" aria-label={p.isPlaying ? PLAYER_COPY.pause : PLAYER_COPY.play} aria-pressed={p.isPlaying} onClick={p.onTogglePlay} className={cx(PLAY_BASE, p.isPlaying ? PLAY_ON : PLAY_IDLE)}>
            <Icon name={p.isPlaying ? 'pause' : 'mark'} className="size-6" />
          </button>
          <IconButton icon={<Icon name="next" />} aria-label={PLAYER_COPY.end} onClick={p.onEnd} />
          <Chip on={p.isLooping} aria-pressed={p.isLooping} title={p.isLooping ? PLAYER_COPY.loopOn : PLAYER_COPY.loopOff} onClick={p.onToggleLoop} className="min-h-ps-touch">
            <Icon name="loop" className="size-4" /> {PLAYER_COPY.loop}
          </Chip>
          <span className="ps-num whitespace-nowrap rounded-ps-md bg-ps-well px-3 py-2 text-ps-base inset-ring inset-ring-ps-line">
            {p.time} <span className="text-ps-dim">/</span> <span className="text-ps-mut">{p.total}</span>
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {p.voice && (
            <Button onClick={p.onVoice} title={p.voice.locked ? PLAYER_COPY.voiceLocked : PLAYER_COPY.voiceTitle}
              icon={p.voice.locked ? <Lock size={14} /> : <Mic size={14} />}>
              {PLAYER_COPY.voice}{p.voice.count > 0 ? ` (${p.voice.count})` : ''}
            </Button>
          )}
          <div className={cx('flex items-center gap-1 rounded-ps-lg bg-ps-s1 px-1 inset-ring inset-ring-ps-line', !p.sync.enabled && 'opacity-60')}
            title={p.sync.enabled ? PLAYER_COPY.syncTitle : PLAYER_COPY.syncOff}>
            <span className="ps-label px-1">{PLAYER_COPY.sync}</span>
            <IconButton tone="ghost" icon={<Icon name="chl" />} aria-label={PLAYER_COPY.syncEarlier} disabled={!p.sync.enabled} onClick={() => p.onNudge(-10)} />
            <span className="ps-num w-12 text-center text-ps-base" aria-live="polite">
              {p.sync.busy ? <Loader2 size={12} className="inline animate-spin motion-reduce:animate-none" aria-label="Gerando" /> : signed}
            </span>
            <IconButton tone="ghost" icon={<Icon name="chr" />} aria-label={PLAYER_COPY.syncLater} disabled={!p.sync.enabled} onClick={() => p.onNudge(10)} />
            <span className="ps-num pr-1 text-ps-sm text-ps-dim">ms</span>
          </div>
          <div className="flex items-center gap-2">
            <Slider label={PLAYER_COPY.master} hideLabel value={p.masterVolume} min={0} max={1} step={0.01} valueText={volumeDb(p.masterVolume)} onChange={p.onMaster} className="w-28" />
            <span className="ps-num w-10 text-right text-ps-sm text-ps-mut">{volumeDb(p.masterVolume)}</span>
          </div>
        </div>
      </div>
    </header>
  )
}

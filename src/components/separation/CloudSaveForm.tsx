import { Button, FilePicker, Notice, ProgressBar, Select, Switch, TextField } from '../ui'
import { CLOUD_COPY, KEYS } from './toolsCopy'

export interface CloudSaveFormValues { name: string; artist: string; bpm: string; songKey: string; cover: File | null; publishGlobal: boolean }

export interface CloudSaveFormProps {
  channels: number
  name: string
  artist: string
  bpm: string
  songKey: string
  cover: File | null
  showBpm: boolean
  isAdmin: boolean
  publishGlobal: boolean
  saving: boolean
  progress: number
  status: string
  message?: string | null
  /** Palco: "Pare a música pra usar" (P3); nulo no Separador. */
  disabledReason?: string | null
  onChange(patch: Partial<CloudSaveFormValues>): void
  onSubmit(): void
}

/** Publicar a separação na biblioteca da nuvem: o formulário e o andamento. Só mostra. */
export function CloudSaveForm(p: CloudSaveFormProps) {
  return (
    <div data-cloud-form className="flex flex-col gap-4 font-ps-sans text-ps-bone">
      <p className="text-ps-base leading-snug text-ps-mut">{CLOUD_COPY.intro(p.channels)}</p>
      {p.message && <Notice tone="alert" role="alert">{p.message}</Notice>}
      {!p.saving ? (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <TextField label={CLOUD_COPY.name} placeholder={CLOUD_COPY.namePlaceholder} value={p.name} onChange={(e) => p.onChange({ name: e.target.value })} />
            <TextField label={CLOUD_COPY.artist} placeholder={CLOUD_COPY.artistPlaceholder} value={p.artist} onChange={(e) => p.onChange({ artist: e.target.value })} />
            {p.showBpm && (
              <TextField label={CLOUD_COPY.bpm} type="number" inputMode="decimal" value={p.bpm} onChange={(e) => p.onChange({ bpm: e.target.value })} inputClassName="ps-num" />
            )}
            <Select label={CLOUD_COPY.key} value={p.songKey} onChange={(e) => p.onChange({ songKey: e.target.value })}>
              {KEYS.map((k) => <option key={k} value={k}>{k}</option>)}
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <span className="text-ps-sm font-bold text-ps-mut">{CLOUD_COPY.cover}</span>
            <FilePicker
              label={CLOUD_COPY.coverPick} accept="image/*" fileName={p.cover?.name ?? null}
              onFiles={([f]) => p.onChange({ cover: f ?? null })} onClear={() => p.onChange({ cover: null })}
            />
          </div>
          {p.isAdmin && (
            <Switch label={CLOUD_COPY.global} description={CLOUD_COPY.globalHelp} checked={p.publishGlobal} onChange={(on) => p.onChange({ publishGlobal: on })} />
          )}
          <Button tone="primary" size="lg" className="w-full" onClick={p.onSubmit} disabled={!!p.disabledReason} title={p.disabledReason ?? undefined}>
            {CLOUD_COPY.submit}
          </Button>
        </>
      ) : (
        <div className="flex flex-col items-center gap-2 py-4 text-center">
          <p className="text-ps-md font-bold">{p.progress >= 100 ? CLOUD_COPY.done : CLOUD_COPY.saving}</p>
          <p role="status" className="min-h-5 text-ps-base text-ps-mut">{p.status}</p>
          <ProgressBar label={CLOUD_COPY.progress} hideLabel value={p.progress} valueText={`${p.progress}%`} className="w-full" />
        </div>
      )}
    </div>
  )
}

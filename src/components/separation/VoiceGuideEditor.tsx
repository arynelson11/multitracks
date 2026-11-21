import { useId } from 'react'
import { FAMILY_COLOR } from '../../lib/channelNames'
import { GUIDE_DYNAMICS, GUIDE_SECTIONS, formatCueTime, type GuideCueOption, type VoiceCue } from '../../lib/separation/voiceGuide'
import { Icon } from '../stage/icons'
import { Button, Chip, IconButton, Notice, TabPanel, Tabs, TextField } from '../ui'
import { VOICE_COPY } from './toolsCopy'

export type GuideTab = 'sections' | 'dynamic'

export interface VoiceGuideEditorProps {
  cues: readonly VoiceCue[]
  tab: GuideTab
  playing: boolean
  detecting: boolean
  rendering: boolean
  /** A voz guia já é um canal (o botão diz Atualizar). */
  hasChannel: boolean
  /** Há marcações que ainda não estão no canal: o Gerar canal fica laranja. */
  pending: boolean
  message?: string | null
  /** Palco: "Pare a música pra usar" (P3). Desliga Auto-detectar e Gerar canal; a grade nunca. */
  disabledReason?: string | null
  onTab(t: GuideTab): void
  onAdd(o: GuideCueOption): void
  onRemove(id: string): void
  onTime(id: string, raw: string): void
  onClear(): void
  onDetect(): void
  onCommit(): void
}

// Cor das marcações: a da família Guia (P14), nunca o âmbar (âmbar é alerta).
const GUIDE_COLOR = FAMILY_COLOR.guia

/** Voz guia da separação: marcações, lista com o tempo editável e o canal. Só mostra. */
export function VoiceGuideEditor(p: VoiceGuideEditorProps) {
  const tabsId = useId()
  const options = p.tab === 'sections' ? GUIDE_SECTIONS : GUIDE_DYNAMICS
  return (
    <div data-voice-editor className="flex flex-col gap-4 font-ps-sans text-ps-bone">
      {p.message && <Notice tone="alert" role="alert">{p.message}</Notice>}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button
          onClick={p.onDetect}
          disabled={p.detecting || !!p.disabledReason}
          title={p.disabledReason ?? VOICE_COPY.detectTitle}
          icon={<Icon name="mark" className="size-4" />}
        >
          {p.detecting ? VOICE_COPY.detecting : VOICE_COPY.detect}
        </Button>
      </div>

      {p.detecting ? (
        <Notice role="status">
          <span className="block font-bold">{VOICE_COPY.analyzing}</span>
          <span className="block text-ps-mut">{VOICE_COPY.analyzingDetail}</span>
        </Notice>
      ) : (
        <>
          <p className="text-ps-base leading-snug text-ps-mut">{p.playing ? VOICE_COPY.playingHint : VOICE_COPY.stoppedHint}</p>
          <Tabs
            id={tabsId} aria-label={VOICE_COPY.tabs} value={p.tab} onChange={p.onTab}
            tabs={[{ value: 'sections', label: VOICE_COPY.sections }, { value: 'dynamic', label: VOICE_COPY.dynamics }]}
          />
          <TabPanel tabsId={tabsId} value={p.tab}>
            <div className="grid grid-cols-[repeat(auto-fill,minmax(7.5rem,1fr))] gap-1.5">
              {options.map((o) => (
                <Chip key={o.file} onClick={() => p.onAdd(o)} className="min-h-ps-touch whitespace-normal break-words leading-tight">
                  {o.label}
                </Chip>
              ))}
            </div>
          </TabPanel>
        </>
      )}

      {p.cues.length > 0 && (
        <section className="flex flex-col gap-2 border-t border-ps-line pt-3" aria-label={VOICE_COPY.list(p.cues.length)}>
          <span className="ps-label">{VOICE_COPY.list(p.cues.length)}</span>
          <ul className="flex max-h-48 flex-col gap-1 overflow-y-auto">
            {p.cues.map((cue) => (
              <li key={cue.id} data-cue-row={cue.id} className="flex items-center gap-2 rounded-ps-md bg-ps-s1 px-2 py-1 inset-ring inset-ring-ps-line">
                <span aria-hidden="true" className="h-6 w-1 shrink-0 rounded-full" style={{ backgroundColor: GUIDE_COLOR }} />
                <TextField
                  key={`${cue.id}-${Math.floor(cue.time)}`}
                  label={VOICE_COPY.cueTime(cue.label)} hideLabel
                  defaultValue={formatCueTime(cue.time)}
                  onBlur={(e) => p.onTime(cue.id, e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur() }}
                  className="w-20 shrink-0" inputClassName="ps-num text-center"
                />
                <span className="min-w-0 flex-1 break-words text-ps-base font-bold">{cue.label}</span>
                <IconButton tone="ghost" icon={<Icon name="x" />} aria-label={VOICE_COPY.remove(cue.label)} onClick={() => p.onRemove(cue.id)} />
              </li>
            ))}
          </ul>
          <Button tone="ghost" onClick={p.onClear} className="self-start">{VOICE_COPY.clear}</Button>
        </section>
      )}

      {p.cues.length > 0 && (
        <div className="flex flex-col gap-2 border-t border-ps-line pt-3">
          {p.pending && <p role="status" className="text-ps-base text-ps-mut">{VOICE_COPY.pending}</p>}
          <Button
            tone={p.pending ? 'primary' : 'default'} size="lg" className="w-full"
            onClick={p.onCommit} disabled={p.rendering || !!p.disabledReason} title={p.disabledReason ?? undefined}
          >
            {p.rendering ? VOICE_COPY.rendering : p.hasChannel ? VOICE_COPY.update : VOICE_COPY.generate}
          </Button>
          <p className="text-center text-ps-base leading-snug text-ps-dim">{VOICE_COPY.note}</p>
        </div>
      )}
    </div>
  )
}

import { CLICK_SUBDIVISIONS, CLICK_TYPES, type ClickLibrarySelection } from '../../lib/clickLibrary'
import { SEPARATOR_METERS, tempoName, type SeparatorMeter } from '../../lib/separation/separatorClick'
import { Icon } from '../stage/icons'
import { Button, Chip, IconButton, Notice, Segmented, Switch, TextField } from '../ui'
import { BPM_COPY } from './toolsCopy'

export interface BpmClickEditorProps {
  bpm: string
  meter: SeparatorMeter
  accentBeat1: boolean
  downbeatShift: number
  clickSel: ClickLibrarySelection
  /** A frase do resultado da detecção. */
  info: string
  busy: 'click' | 'bpm' | null
  hasTracks: boolean
  message?: string | null
  /** Palco: "Pare a música pra usar" (P3); nulo no Separador. */
  disabledReason?: string | null
  /** Sem a detecção no plano: o Detectar mostra o cadeado e o motivo (o toque abre os Planos). */
  detectLocked?: boolean
  onBpm(text: string): void
  onBpmBlur(): void
  onStep(delta: 1 | -1): void
  onTap(): void
  onScale(f: 2 | 0.5): void
  onDetect(): void
  onMeter(m: SeparatorMeter): void
  onAccent(on: boolean): void
  onShiftDownbeat(delta: 1 | -1): void
  onClickSel(patch: Partial<ClickLibrarySelection>): void
  onGenerate(): void
  /** O SYNC dentro da peça (o painel do palco usa; o Separador deixa na barra). */
  sync?: { offsetMs: number; enabled: boolean; busy: boolean; onNudge(deltaMs: 10 | -10): void }
}

const signed = (n: number) => `${n > 0 ? '+' : ''}${n}`

/** BPM e click da separação: só mostra; o estado fica com quem monta. */
export function BpmClickEditor(p: BpmClickEditorProps) {
  const generating = p.busy === 'click'
  const blocked = p.busy !== null || !p.hasTracks || !!p.disabledReason
  // A subdivisão aparece pelo nome dela (1/4, 1/8...), não pelo id em inglês.
  const subLabel = CLICK_SUBDIVISIONS.find((s) => s.id === p.clickSel.subdivision)?.label ?? p.clickSel.subdivision
  return (
    <div data-bpm-editor className="flex flex-col gap-4 font-ps-sans text-ps-bone">
      {p.message && <Notice tone="alert" role="alert">{p.message}</Notice>}
      <p className="text-ps-base text-ps-mut">{tempoName(parseInt(p.bpm) || 120)}</p>

      <div className="flex items-center justify-between gap-2 rounded-ps-xl bg-ps-well p-2 inset-ring inset-ring-ps-line">
        <IconButton icon={<Icon name="minus" />} aria-label={BPM_COPY.minus} disabled={generating} onClick={() => p.onStep(-1)} />
        <TextField
          label={BPM_COPY.field} hideLabel type="number" inputMode="decimal" value={p.bpm} disabled={generating}
          onChange={(e) => p.onBpm(e.target.value)} onBlur={p.onBpmBlur}
          className="min-w-0 flex-1" inputClassName="ps-num text-center text-ps-lg font-extrabold"
        />
        <IconButton icon={<Icon name="plus" />} aria-label={BPM_COPY.plus} disabled={generating} onClick={() => p.onStep(1)} />
      </div>

      <div className="flex flex-wrap gap-2">
        <Chip disabled={generating} onClick={p.onTap} className="min-h-ps-touch flex-1">{BPM_COPY.tap}</Chip>
        <Chip disabled={generating} onClick={() => p.onScale(2)} aria-label={BPM_COPY.doubleLabel} className="min-h-ps-touch">{BPM_COPY.double}</Chip>
        <Chip disabled={generating} onClick={() => p.onScale(0.5)} aria-label={BPM_COPY.halfLabel} className="min-h-ps-touch">{BPM_COPY.half}</Chip>
      </div>

      <div className="flex flex-col gap-2">
        <Button
          onClick={p.onDetect}
          disabled={blocked}
          title={p.disabledReason ?? (p.detectLocked ? BPM_COPY.detectLocked : BPM_COPY.detectTitle)}
          className="w-full"
        >
          {p.busy === 'bpm' ? BPM_COPY.detecting : BPM_COPY.detect}
        </Button>
        {p.info && <p className="text-center text-ps-base leading-snug text-ps-mut">{p.info}</p>}
      </div>

      <div className="flex flex-col gap-2">
        <span className="ps-label">{BPM_COPY.meter}</span>
        <Segmented
          aria-label={BPM_COPY.meter} className="flex-wrap"
          options={SEPARATOR_METERS.map((m) => ({ value: m, label: m, disabled: generating }))}
          value={p.meter} onChange={(m) => { if (m !== p.meter) p.onMeter(m) }}
        />
      </div>

      <Switch label={BPM_COPY.accent} checked={p.accentBeat1} disabled={generating} onChange={p.onAccent} />

      {p.accentBeat1 && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-ps-base font-bold text-ps-bone" title={BPM_COPY.moveOneTitle}>{BPM_COPY.moveOne}</span>
          <div className="flex items-center gap-1">
            <IconButton icon={<Icon name="chl" />} aria-label={BPM_COPY.moveOneBack} disabled={generating} onClick={() => p.onShiftDownbeat(-1)} />
            <span className="ps-num w-10 text-center text-ps-base font-bold">{signed(p.downbeatShift)}</span>
            <IconButton icon={<Icon name="chr" />} aria-label={BPM_COPY.moveOneForward} disabled={generating} onClick={() => p.onShiftDownbeat(1)} />
          </div>
        </div>
      )}

      {!generating && (
        <div className="flex flex-col gap-2">
          <span className="ps-label">{BPM_COPY.sound}</span>
          <Segmented
            aria-label={BPM_COPY.sound} className="flex-wrap"
            options={CLICK_TYPES.map((t) => ({ value: t.id, label: t.label }))}
            value={p.clickSel.type} onChange={(type) => p.onClickSel({ type })}
          />
          <Segmented
            aria-label={BPM_COPY.subdivision} className="flex-wrap"
            options={CLICK_SUBDIVISIONS.map((s) => ({ value: s.id, label: s.label }))}
            value={p.clickSel.subdivision} onChange={(subdivision) => p.onClickSel({ subdivision })}
          />
        </div>
      )}

      {generating && <p role="status" className="text-center text-ps-base font-bold text-ps-bone">{BPM_COPY.generating(p.clickSel.type)}</p>}

      <Button tone="primary" size="lg" onClick={p.onGenerate} disabled={blocked} title={p.disabledReason ?? undefined} className="w-full whitespace-normal">
        {BPM_COPY.generate(p.clickSel.type, p.meter, subLabel)}
      </Button>

      {p.sync && (
        <div className="flex flex-wrap items-center justify-between gap-2" title={p.disabledReason ?? (p.sync.enabled ? BPM_COPY.syncTitle : BPM_COPY.syncOff)}>
          <span className="ps-label">{BPM_COPY.sync}</span>
          <div className="flex items-center gap-1">
            <IconButton
              icon={<Icon name="chl" />} aria-label={BPM_COPY.syncEarlier}
              disabled={!p.sync.enabled || p.sync.busy || !!p.disabledReason}
              title={p.disabledReason ?? BPM_COPY.syncEarlier}
              onClick={() => p.sync?.onNudge(-10)}
            />
            <span className="ps-num w-16 text-center text-ps-base font-bold">{signed(p.sync.offsetMs)} ms</span>
            <IconButton
              icon={<Icon name="chr" />} aria-label={BPM_COPY.syncLater}
              disabled={!p.sync.enabled || p.sync.busy || !!p.disabledReason}
              title={p.disabledReason ?? BPM_COPY.syncLater}
              onClick={() => p.sync?.onNudge(10)}
            />
          </div>
        </div>
      )}

      <p className="text-center text-ps-base leading-snug text-ps-dim">{p.sync ? BPM_COPY.noteWithSync : BPM_COPY.note}</p>
    </div>
  )
}

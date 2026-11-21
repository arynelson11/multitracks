import { useId, useRef } from 'react'
import type React from 'react'
import { Loader2 } from 'lucide-react'
import type { StageSeparation } from '../../hooks/useStageSeparation'
import { Icon } from '../stage/icons'
import { usePanelDismiss } from '../stage/panelDismiss'
import { Button, IconButton, Notice, Segmented, TabPanel, Tabs } from '../ui'
import { stemColor } from '../../lib/separation/voiceGuide'
import { BpmClickEditor } from './BpmClickEditor'
import { VoiceGuideEditor } from './VoiceGuideEditor'
import { PANEL_COPY, PAUSE_TO_USE, type SeparationTab } from './toolsCopy'

export interface SeparationPanelProps {
  open: boolean
  songName: string
  tab: SeparationTab
  onTab(t: SeparationTab): void
  s: StageSeparation
  /** Tocando ou na pré-contagem: as ferramentas que geram, analisam ou baixam ficam desligadas (P3). */
  playing: boolean
  canDownload: boolean
  canCloudSave: boolean
  /** Livre: BAIXAR e SALVAR NA NUVEM abrem a tela de limite (P9). */
  onLimit(): void
  /** Abre a janela do palco com o publicar na nuvem (App). */
  onOpenCloudSave(): void
  onMySeparations(): void
  /** O anúncio do fim da separação (App, só no Livre logo depois de separar). */
  ad?: React.ReactNode
  onClose(): void
}

/**
 * Gaveta SEPARAÇÃO do palco, à direita (espelho da REPERTÓRIOS): as faixas da separação com
 * baixar, salvar na nuvem e "Minhas separações", a voz guia e o BPM e click com o SYNC. Não bloqueia
 * o palco (sem aria-modal); X e Esc fecham pela pilha dos painéis.
 */
export function SeparationPanel(p: SeparationPanelProps) {
  const panelRef = useRef<HTMLDivElement>(null)
  const tabsId = useId()
  usePanelDismiss(p.open, p.onClose, panelRef)
  if (!p.open) return null

  const s = p.s
  const reason = p.playing ? PAUSE_TO_USE : null
  const stems = s.sep?.stems ?? []
  return (
    <div
      ref={panelRef}
      role="dialog"
      aria-label={PANEL_COPY.title}
      tabIndex={-1}
      data-separation-panel=""
      className="flex h-full w-[420px] max-w-full flex-col gap-3 rounded-l-ps-2xl bg-ps-raised p-3 font-ps-sans text-ps-bone shadow-ps-pop inset-ring inset-ring-ps-line-2 outline-none transition-[opacity,translate] duration-200 starting:translate-x-4 starting:opacity-0 motion-reduce:transition-none"
    >
      <div className="flex shrink-0 items-start gap-2">
        <div className="flex min-w-0 flex-1 flex-col gap-0.5 pl-1 pt-1">
          <span className="ps-label text-ps-bone">{PANEL_COPY.title}</span>
          <span className="break-words text-ps-base font-bold leading-snug">{p.songName}</span>
        </div>
        <IconButton tone="ghost" icon={<Icon name="x" />} aria-label={PANEL_COPY.close} title={PANEL_COPY.closeTitle} onClick={p.onClose} />
      </div>

      <Tabs
        id={tabsId} aria-label={PANEL_COPY.tabs} value={p.tab} onChange={p.onTab} className="shrink-0"
        tabs={[{ value: 'faixas', label: PANEL_COPY.tracks }, { value: 'voz', label: PANEL_COPY.voice }, { value: 'bpm', label: PANEL_COPY.bpm }]}
      />

      <TabPanel tabsId={tabsId} value={p.tab} className="-mx-1 min-h-0 flex-1 overflow-y-auto px-1 pb-1">
        {s.loading ? (
          <p role="status" className="py-6 text-center text-ps-base text-ps-mut">{PANEL_COPY.loading}</p>
        ) : !s.sep ? (
          <Notice tone="alert" role="alert">{PANEL_COPY.missing}</Notice>
        ) : p.tab === 'faixas' ? (
          <div className="flex flex-col gap-3">
            {p.ad}
            {s.messages.faixas && <Notice tone="alert" role="alert">{s.messages.faixas}</Notice>}
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="ps-label">{PANEL_COPY.format}</span>
              <Segmented
                aria-label={PANEL_COPY.formatLabel}
                options={[{ value: 'wav', label: 'WAV' }, { value: 'mp3', label: 'MP3' }]}
                value={s.format} onChange={(f) => { if (f !== s.format) s.setFormat(f) }}
              />
            </div>
            <ul className="flex flex-col gap-1.5">
              {stems.map((stem) => {
                const downloading = s.downloadingId === stem.id
                return (
                  <li key={stem.id} data-separation-stem={stem.id} className="flex items-center gap-2 rounded-ps-md bg-ps-s1 py-1.5 pl-2 pr-1.5 inset-ring inset-ring-ps-line">
                    <span aria-hidden="true" className="h-8 w-1 shrink-0 rounded-full" style={{ backgroundColor: stemColor(stem) }} />
                    <span className="min-w-0 flex-1 break-words text-ps-base font-bold leading-snug">{stem.name}</span>
                    <Button
                      onClick={() => (p.canDownload ? void s.download(stem.id) : p.onLimit())}
                      disabled={!!reason || downloading}
                      title={reason ?? PANEL_COPY.downloadTitle(stem.name, s.format)}
                      aria-label={PANEL_COPY.downloadTitle(stem.name, s.format)}
                      icon={downloading ? <Loader2 size={14} className="animate-spin motion-reduce:animate-none" /> : undefined}
                    >
                      {PANEL_COPY.download}
                    </Button>
                  </li>
                )
              })}
            </ul>
            <div className="flex flex-wrap gap-2">
              <Button
                tone="primary" icon={<Icon name="cloud" className="size-4" />} disabled={!!reason} title={reason ?? undefined}
                onClick={() => (p.canCloudSave ? p.onOpenCloudSave() : p.onLimit())}
              >
                {PANEL_COPY.cloud}
              </Button>
              <Button onClick={p.onMySeparations}>{PANEL_COPY.mine}</Button>
            </div>
          </div>
        ) : p.tab === 'voz' ? (
          <VoiceGuideEditor
            cues={s.cues} tab={s.guideTab} playing={p.playing} detecting={s.busy === 'cues'} rendering={s.busy === 'guide'}
            hasChannel={s.hasGuide} pending={s.cuesPending} message={s.messages.voz} disabledReason={reason}
            onTab={s.setGuideTab} onAdd={s.addCue} onRemove={s.removeCue} onTime={s.setCueTime}
            onClear={s.clearCues} onDetect={() => { void s.detectCues() }} onCommit={() => { void s.commitVoiceGuide() }}
          />
        ) : (
          <BpmClickEditor
            bpm={s.bpm} meter={s.meter} accentBeat1={s.accentBeat1} downbeatShift={s.downbeatShift} clickSel={s.clickSel}
            info={s.gridInfo} busy={s.busy === 'click' ? 'click' : s.busy === 'bpm' ? 'bpm' : null} hasTracks={stems.length > 0}
            message={s.messages.bpm} disabledReason={reason}
            onBpm={s.setBpm} onBpmBlur={s.blurBpm} onStep={s.stepBpm} onTap={s.tap} onScale={s.scaleBpm} onDetect={() => { void s.detectBpm() }}
            onMeter={s.setMeter} onAccent={s.setAccent} onShiftDownbeat={s.shiftDownbeat} onClickSel={s.setClickSel}
            onGenerate={() => { void s.generateClick() }}
            sync={{ offsetMs: s.offsetMs, enabled: s.hasClick, busy: s.busy === 'click', onNudge: s.nudge }}
          />
        )}
      </TabPanel>
    </div>
  )
}

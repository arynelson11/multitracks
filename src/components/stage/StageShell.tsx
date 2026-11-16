import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import type React from 'react'
import { OUTPUT_WARNING_TEXT, outputSummary } from '../../lib/outputPlan'
import { isSelfLoop } from '../../lib/sectionArm'
import { barSeconds, nearestBarLine, pulseSeconds } from '../../lib/songGrid'
import { gridHasPhase } from '../../lib/stageContracts'
import type { OutputPlan, SongGrid, StageActions, StageClock, StageView } from '../../lib/stageContracts'
import { MeterEditor } from './MeterEditor'
import { MidStrip } from './MidStrip'
import { PadPanel } from './PadPanel'
import type { PadPanelProps } from './PadPanel'
import { usePanelDismiss } from './panelDismiss'
import { SectionEditBar } from './SectionEditBar'
import { SectionPads } from './SectionPads'
import { StageAppBar } from './StageAppBar'
import { StageMixer } from './StageMixer'
import { TransportBar } from './TransportBar'
import type { StagePulse } from './TransportBar'
import { useStageShortcuts } from './useStageShortcuts'
import { WaveformSections } from './WaveformSections'

export interface StageShellProps {
  view: StageView; actions: StageActions; clock: StageClock; peaks: Float32Array | null
  pads: Omit<PadPanelProps, 'open' | 'onClose'>
  slots: { repertoire: React.ReactNode; tracksMenu?: React.ReactNode; adminTools?: React.ReactNode; channelEditPanel?: React.ReactNode }
  keyboardEnabled: boolean
}

/** O painel de pads abre por cima do mixer e para antes do PRINCIPAL: a largura dele (MasterStrip, w-[116px]) mais o vão do mixer (gap-2.5). */
const MASTER_WIDTH = 116
const MIXER_GAP = 10
const PADS_RIGHT = MASTER_WIDTH + MIXER_GAP
/** Mais linhas de compasso que isso é grade quebrada: a onda fica sem as linhas. */
const MAX_BAR_LINES = 20000

/**
 * Linhas de compasso da música inteira, de 0:00 até o fim, pela grade com fase (as do primeiro "1"
 * pra trás também: a grade continua antes dele). Sem fase (só o BPM salvo) não se sabe onde cai o
 * "1": sem linhas.
 */
function barLinesOf(grid: SongGrid | null, duration: number): number[] | null {
  if (!grid || !gridHasPhase(grid) || !(duration > 0) || !Number.isFinite(grid.firstDownbeat)) return null
  const bar = barSeconds(grid)
  if (!Number.isFinite(bar) || bar <= 0 || duration / bar > MAX_BAR_LINES) return null
  const near = nearestBarLine(0, grid)
  const first = near < 0 ? near + bar : near
  const lines: number[] = []
  for (let k = 0; first + k * bar <= duration; k++) lines.push(first + k * bar)
  return lines
}

/** Pulso do anel do Play: só com a grade com fase (é ela que sabe onde cai cada pulso). */
function pulseOf(grid: SongGrid | null): StagePulse | null {
  if (!grid || !gridHasPhase(grid)) return null
  const seconds = pulseSeconds(grid)
  return Number.isFinite(seconds) && seconds > 0 && Number.isFinite(grid.firstDownbeat) ? { seconds, firstDownbeat: grid.firstDownbeat } : null
}

const channelsText = (n: number) => (n === 1 ? '1 canal' : `${n} canais`)

/**
 * Aviso de saída no palco (Ruling T6-2): a placa de agora não dá o que foi escolhido. Click e Guia
 * sem saída no "4 ou mais"; placa de 1 canal (tudo junto); ou a placa tem menos canais e as saídas
 * caíram pra outra divisão (diz como ficou). "Tudo junto" escolhido de propósito não é aviso.
 */
function outputAlertText(plan: OutputPlan): string | null {
  if (plan.mode === 'multi' && (plan.click.length === 0 || plan.guide.length === 0)) return OUTPUT_WARNING_TEXT['sem-saida-ouvido']
  if (plan.fellBackFrom === null) return null
  if (plan.channels <= 1) return OUTPUT_WARNING_TEXT.mono
  return `Esta placa tem só ${channelsText(plan.channels)}: ${outputSummary(plan)}.`
}

// Âmbar = alerta. Dentro da área da onda: aparecer (a placa mudou tocando) só encolhe a onda, nada mais anda.
function OutputAlert({ text }: { text: string }) {
  return (
    <div
      role="status" data-output-alert=""
      className="flex shrink-0 items-baseline gap-2.5 rounded-ps-lg bg-ps-alert-soft px-3 py-2 text-ps-sm leading-snug text-ps-alert inset-ring inset-ring-ps-alert-line"
    >
      <span className="shrink-0 text-ps-label font-bold tracking-[0.14em] whitespace-nowrap">SAÍDAS</span>
      <span className="min-w-0 text-ps-bone">{text}</span>
    </div>
  )
}

interface EditAreaProps { view: StageView; actions: StageActions; adminTools: React.ReactNode }

/**
 * Modo EDITAR no lugar da botoeira: a barra de edição das seções e, embaixo, as ferramentas do
 * admin. Monta só no EDITAR e com a chave da música, então a seleção começa vazia a cada entrada
 * e a cada música. `hasPhase` é a grade COM FASE (o ajuste anda compasso); só com o BPM salvo, 1 s.
 */
function EditArea({ view, actions, adminTools }: EditAreaProps) {
  const [selected, setSelected] = useState<number | null>(null)
  const hasPhase = view.grid !== null && gridHasPhase(view.grid)
  return (
    <div data-stage-sections="" className="shrink-0 px-ps-gutter pt-2.5">
      <SectionEditBar
        sections={view.sections} selected={selected} hasPhase={hasPhase}
        onSelect={(i) => setSelected(i)} onMark={(label) => actions.markSection(label)}
        onNudge={(i, dir) => actions.nudgeSection(i, dir)}
        onRemove={(i) => { setSelected(null); actions.removeSection(i) }}
      />
      {adminTools && <div data-stage-admin="" className="pt-2">{adminTools}</div>}
    </div>
  )
}

/**
 * Casca do palco novo (mockup v5): barra do app; transporte; onda com as seções; botoeira (no
 * EDITAR, a barra de edição e as ferramentas do admin); faixa do meio; mixer com o PRINCIPAL. O
 * painel de pads abre por cima do mixer sem cobrir o PRINCIPAL; REPERTÓRIOS é a gaveta da
 * esquerda; o menu FAIXAS abre embaixo do botão. A casca só monta as peças, guarda o que é dela
 * (grade de tons aberta, compasso aberto, seção selecionada no EDITAR) e liga o teclado.
 *
 * Alturas: barra 44 px, transporte clamp(72px,9vh,88px), faixa do meio clamp(168px,20vh,208px);
 * a onda (1,15) e o mixer (1, no mínimo 220 px) dividem o resto. A botoeira e a barra de edição
 * têm a altura do que mostram (a botoeira guarda a dela com a música tocando); a diferença sai da
 * onda e do mixer. Se a tela não tiver altura pra tudo, o palco rola na vertical em vez de cortar.
 */
export function StageShell({ view, actions, clock, peaks, pads, slots, keyboardEnabled }: StageShellProps) {
  const headerRef = useRef<HTMLDivElement>(null)
  const tracksRef = useRef<HTMLDivElement>(null)
  // A grade de tons entra na pilha do Esc dos painéis: o último aberto fecha primeiro e o Esc que
  // fecha a grade não chega ao atalho global (não cancela o pulo). O KeyCell cuida do foco dela.
  const keyGridRef = useRef<HTMLElement | null>(null)

  const songKey = view.song?.id ?? null
  const [keyGridOpen, setKeyGridOpen] = useState(false)
  const [meterOpen, setMeterOpen] = useState(false)
  // Trocar de música fecha a grade de tons e o compasso; sair do EDITAR fecha o compasso.
  const [seen, setSeen] = useState({ song: songKey, edit: view.editMode })
  if (seen.song !== songKey || seen.edit !== view.editMode) {
    if (seen.song !== songKey) setKeyGridOpen(false)
    setMeterOpen(false)
    setSeen({ song: songKey, edit: view.editMode })
  }
  usePanelDismiss(keyGridOpen, () => setKeyGridOpen(false), keyGridRef)

  useStageShortcuts(view, actions, { enabled: keyboardEnabled })

  const grid = view.grid
  const duration = view.song?.duration ?? 0
  const barLines = useMemo(() => barLinesOf(grid, duration), [grid, duration])
  const pulse = useMemo(() => pulseOf(grid), [grid])
  const alert = outputAlertText(view.outputs)
  const hasTracksMenu = slots.tracksMenu !== undefined && slots.tracksMenu !== null && slots.tracksMenu !== false
  const showAdmin = view.app.isAdmin ? slots.adminTools : null

  // O menu FAIXAS abre embaixo do botão FAIXAS da barra (a posição dele depende da largura da tela).
  useLayoutEffect(() => {
    if (!hasTracksMenu) return
    const place = () => {
      const header = headerRef.current
      const layer = tracksRef.current
      const button = header?.querySelector<HTMLElement>('[data-tour="faixas"]')
      if (!header || !layer || !button) return
      const left = button.getBoundingClientRect().left - header.getBoundingClientRect().left
      layer.style.left = `${Number.isFinite(left) ? Math.max(0, Math.round(left)) : 0}px`
    }
    place()
    window.addEventListener('resize', place)
    return () => window.removeEventListener('resize', place)
  }, [hasTracksMenu])

  const closePads = () => { if (view.padPanelOpen) actions.togglePadPanel() }

  return (
    <div data-stage-shell="" className="relative flex h-dvh w-full min-w-0 flex-col overflow-hidden bg-ps-ink font-ps-sans text-ps-bone">
      <div ref={headerRef} className="relative z-30 shrink-0">
        <StageAppBar app={view.app} editMode={view.editMode} actions={actions} />
        {hasTracksMenu && <div ref={tracksRef} data-stage-tracks-menu="" className="absolute top-full left-0 z-50">{slots.tracksMenu}</div>}
      </div>

      <div data-stage-scroll="" className="flex min-h-0 flex-1 flex-col overflow-x-hidden overflow-y-auto">
        <main aria-label="Palco" className="flex flex-[1_0_auto] flex-col">
          <TransportBar view={view} actions={actions} clock={clock} pulse={pulse} />

          <div data-stage-wave="" className="flex min-h-[112px] flex-[1.15_1_0px] flex-col gap-2 px-ps-gutter pt-3">
            {alert && <OutputAlert text={alert} />}
            <div className="min-h-0 flex-1">
              <WaveformSections
                peaks={peaks} duration={duration} sections={view.sections} currentSection={view.currentSection} isPlaying={view.isPlaying}
                intent={view.intent} loopOn={isSelfLoop(view.intent, view.currentSection)} barLines={barLines} sectionsAllowed={view.gates.sections}
                clock={clock} onTapSection={(i) => actions.tapSection(i)} onSeek={(t) => actions.seek(t)}
              />
            </div>
          </div>

          {view.editMode ? (
            <EditArea key={songKey ?? ''} view={view} actions={actions} adminTools={showAdmin} />
          ) : (
            <div data-stage-sections="" className="shrink-0">
              <SectionPads
                sections={view.sections} currentSection={view.currentSection} intent={view.intent} transition={view.transition}
                isPlaying={view.isPlaying} landed={view.landed} gates={view.gates} clock={clock}
                onTap={(i) => actions.tapSection(i)} onUpgrade={() => actions.openUpgrade()}
                songId={songKey} hasGrid={view.grid !== null}
              />
            </div>
          )}

          <div data-stage-mid="" className="relative z-20 shrink-0">
            {meterOpen && view.editMode && (
              <div data-stage-meter="" className="absolute bottom-full left-ps-gutter z-40 max-w-[calc(100%-32px)]">
                <MeterEditor
                  grid={view.grid} songBpm={view.song?.bpm ?? null} busy={view.isReadingGrid}
                  onChange={(sig, countEvery) => actions.setMeter(sig, countEvery)} onRedetect={() => actions.redetectMeter()}
                  onClose={() => setMeterOpen(false)}
                />
              </div>
            )}
            <MidStrip
              view={view} actions={actions} clock={clock} keyGridOpen={keyGridOpen}
              onKeyGridOpenChange={(open) => setKeyGridOpen(open)} onOpenMeter={() => setMeterOpen(true)}
            />
          </div>

          <div data-stage-mixer="" className="relative z-10 mx-ps-gutter mt-3 mb-3.5 flex min-h-[220px] flex-[1_1_0px]">
            <StageMixer view={view} actions={actions} clock={clock} />
            <div data-stage-pads-layer="" className="absolute inset-y-0 z-20 flex" style={{ right: PADS_RIGHT }}>
              <PadPanel {...pads} open={view.padPanelOpen} onClose={closePads} />
            </div>
          </div>
        </main>
      </div>

      <div data-stage-drawer="" className="absolute top-11 bottom-0 left-0 z-40 flex">{slots.repertoire}</div>
      {slots.channelEditPanel}
    </div>
  )
}

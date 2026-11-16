import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type React from 'react'
import { OUTPUT_WARNING_TEXT, outputSummary } from '../../lib/outputPlan'
import { isSelfLoop } from '../../lib/sectionArm'
import { barSeconds, nearestBarLine, pulseSeconds } from '../../lib/songGrid'
import { gridHasPhase } from '../../lib/stageContracts'
import type { OutputPlan, SongGrid, StageActions, StageClock, StageView } from '../../lib/stageContracts'
import { Led, cx } from '../ui'
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

/** Vão entre o selo ONLINE e o aviso de saídas, e do aviso até o menu (o gap-3 da barra). */
const ALERT_GAP = 12
/** Folga do conteúdo da barra de edição até a botoeira acima (o pt-2.5 da SectionPads). */
const EDIT_TOP = 10

interface EditAreaProps { view: StageView; actions: StageActions; adminTools: React.ReactNode }

/**
 * Modo EDITAR no lugar da botoeira: a barra de edição das seções e, embaixo, as ferramentas do
 * admin. Monta só no EDITAR e com a chave da música, então a seleção começa vazia a cada entrada
 * e a cada música. `hasPhase` é a grade COM FASE (o ajuste anda compasso); só com o BPM salvo, 1 s.
 *
 * A altura fica reservada pela maior que a barra já teve nesta entrada (112 a 216 px, quebrando
 * linha): apagar uma seção não puxa a faixa do meio e o mixer pra cima; uma linha a mais só
 * cresce pra baixo (a onda em cima fica parada, ver `StageShell`). Janela redimensionada mede de novo.
 */
function EditArea({ view, actions, adminTools }: EditAreaProps) {
  const [selected, setSelected] = useState<number | null>(null)
  const boxRef = useRef<HTMLDivElement>(null)
  const [reserve, setReserve] = useState(0)
  useEffect(() => {
    const box = boxRef.current
    if (!box || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => {
      const h = box.getBoundingClientRect().height
      setReserve((r) => (h > r ? h : r))
    })
    ro.observe(box)
    const onResize = () => setReserve(box.getBoundingClientRect().height)
    window.addEventListener('resize', onResize)
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', onResize)
    }
  }, [])
  const hasPhase = view.grid !== null && gridHasPhase(view.grid)
  return (
    <div data-stage-sections="" className="shrink-0 px-ps-gutter pt-2.5" style={reserve > 0 ? { minHeight: reserve + EDIT_TOP } : undefined}>
      <div ref={boxRef}>
        <SectionEditBar
          sections={view.sections} selected={selected} hasPhase={hasPhase}
          onSelect={(i) => setSelected(i)} onMark={(label) => actions.markSection(label)}
          onNudge={(i, dir) => actions.nudgeSection(i, dir)}
          onRemove={(i) => { setSelected(null); actions.removeSection(i) }}
        />
        {adminTools && <div data-stage-admin="" className="pt-2">{adminTools}</div>}
      </div>
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
 * Alturas (v5): barra 44 px, transporte clamp(72px,9vh,88px), faixa do meio clamp(168px,20vh,208px);
 * a onda (1,15) e o mixer (1, no mínimo 220 px) dividem o resto. A botoeira tem a altura dos nomes
 * da música (64 a 81 px) e guarda a dela com a música tocando.
 *
 * EDITAR: ao entrar, a onda fica no máximo com a altura que tinha fora dele e encolhe só o que
 * precisar pra barra de edição caber (até 88 px de onda, blocos com 44 px de toque); depois fica
 * parada. Marcar uma seção que abre uma linha nova na barra empurra só o que está embaixo dela
 * (tira do mixer acima de 220 px): MARCAR e o que está acima nunca andam enquanto se marca. Janela
 * redimensionada ou outra música encaixam de novo. Se não couber, o palco rola na vertical em vez
 * de cortar (EDITAR com duas linhas de seções em 1024x768, telas abaixo de 760 px de altura).
 *
 * O aviso de saídas (Ruling T6-2) fica na barra do app, ao lado do ONLINE, e abre as Configurações:
 * aparecer com a música tocando não muda a altura de nada.
 */
export function StageShell({ view, actions, clock, peaks, pads, slots, keyboardEnabled }: StageShellProps) {
  const headerRef = useRef<HTMLDivElement>(null)
  const tracksRef = useRef<HTMLDivElement>(null)
  const alertRef = useRef<HTMLButtonElement>(null)
  const waveRef = useRef<HTMLDivElement>(null)
  // A grade de tons entra na pilha do Esc dos painéis: o último aberto fecha primeiro e o Esc que
  // fecha a grade não chega ao atalho global (não cancela o pulo). O KeyCell cuida do foco dela.
  const keyGridRef = useRef<HTMLElement | null>(null)

  const songKey = view.song?.id ?? null
  const [keyGridOpen, setKeyGridOpen] = useState(false)
  const [meterOpen, setMeterOpen] = useState(false)
  // Altura da onda fora do EDITAR e a que ela ficou no EDITAR depois de encaixar (medidas).
  const [normalWave, setNormalWave] = useState<number | null>(null)
  const [editWave, setEditWave] = useState<number | null>(null)
  // Trocar de música fecha a grade de tons e o compasso e encaixa a onda do EDITAR de novo; sair do
  // EDITAR fecha o compasso.
  const [seen, setSeen] = useState({ song: songKey, edit: view.editMode })
  if (seen.song !== songKey || seen.edit !== view.editMode) {
    if (seen.song !== songKey) setKeyGridOpen(false)
    setMeterOpen(false)
    setEditWave(null)
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

  // Mede a onda fora do EDITAR (sempre) e no EDITAR até ela encaixar; redimensionar no EDITAR encaixa de novo.
  const measureWave = !view.editMode || editWave === null
  useEffect(() => {
    const wave = waveRef.current
    if (!wave || !measureWave || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => {
      const h = wave.getBoundingClientRect().height
      if (!(h > 0)) return
      if (view.editMode) setEditWave(h)
      else setNormalWave(h)
    })
    ro.observe(wave)
    return () => ro.disconnect()
  }, [measureWave, view.editMode])
  useEffect(() => {
    if (!view.editMode) return
    const onResize = () => setEditWave(null)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [view.editMode])
  let waveStyle: React.CSSProperties | undefined
  if (view.editMode && editWave !== null) waveStyle = { flex: 'none', height: editWave }
  else if (view.editMode && normalWave !== null) waveStyle = { flex: '0 1 auto', height: normalWave }

  // O menu FAIXAS abre embaixo do botão FAIXAS; o aviso de saídas fica depois do selo ONLINE e, se
  // não couber até o menu, mostra só a luz (o texto continua no nome e na dica). As posições
  // dependem da largura da tela e das fontes.
  useLayoutEffect(() => {
    if (!hasTracksMenu && !alert) return
    const place = () => {
      const header = headerRef.current
      if (!header) return
      const box = header.getBoundingClientRect()
      const tracks = tracksRef.current
      const faixas = header.querySelector<HTMLElement>('[data-tour="faixas"]')
      if (tracks && faixas) tracks.style.left = `${Math.max(0, Math.round(faixas.getBoundingClientRect().left - box.left))}px`
      const chip = alertRef.current
      const badge = header.querySelector<HTMLElement>('[data-online]')
      if (chip && badge) {
        const left = Math.round(badge.getBoundingClientRect().right - box.left + ALERT_GAP)
        chip.style.left = `${left}px`
        delete chip.dataset.fit
        const nav = header.querySelector<HTMLElement>('nav')
        const room = nav ? nav.getBoundingClientRect().left - box.left - ALERT_GAP - left : Infinity
        if (chip.getBoundingClientRect().width > room) chip.dataset.fit = 'luz'
      }
    }
    place()
    let alive = true
    document.fonts?.ready.then(() => { if (alive) place() }, () => {})
    window.addEventListener('resize', place)
    return () => {
      alive = false
      window.removeEventListener('resize', place)
    }
  }, [hasTracksMenu, alert])

  const closePads = () => { if (view.padPanelOpen) actions.togglePadPanel() }

  return (
    <div data-stage-shell="" className="relative flex h-dvh w-full min-w-0 flex-col overflow-hidden bg-ps-ink font-ps-sans text-ps-bone">
      <div ref={headerRef} className="relative z-30 shrink-0">
        <StageAppBar app={view.app} editMode={view.editMode} actions={actions} />
        {alert && (
          <button
            ref={alertRef} type="button" data-output-alert="" title={alert} aria-label={`Saídas: ${alert} Abre as Configurações.`}
            onClick={() => actions.openSettings()}
            className="group absolute top-0 left-0 inline-flex h-11 min-w-ps-touch items-center justify-center rounded-ps-sm select-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ps-or"
          >
            <span className="inline-flex h-[22px] items-center gap-1.5 rounded-ps-pill bg-ps-alert-soft px-[9px] text-ps-micro leading-none font-extrabold tracking-[0.14em] whitespace-nowrap text-ps-alert inset-ring inset-ring-ps-alert-line">
              <Led state="alert" size="sm" />
              <span className="group-data-[fit=luz]:hidden">SAÍDAS</span>
            </span>
          </button>
        )}
        {hasTracksMenu && <div ref={tracksRef} data-stage-tracks-menu="" className="absolute top-full left-0 z-50">{slots.tracksMenu}</div>}
      </div>

      <div data-stage-scroll="" className="flex min-h-0 flex-1 flex-col overflow-x-hidden overflow-y-auto">
        <main aria-label="Palco" className="flex min-h-0 flex-1 flex-col">
          <TransportBar view={view} actions={actions} clock={clock} pulse={pulse} />

          <div
            ref={waveRef} data-stage-wave="" style={waveStyle}
            className={cx('flex flex-[1.15_1_0px] flex-col px-ps-gutter', view.editMode ? 'min-h-[96px] pt-2' : 'min-h-[112px] pt-3')}
          >
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

          <div
            data-stage-mixer=""
            className={cx('relative z-10 mx-ps-gutter mt-3 flex min-h-[220px] flex-[1_1_0px]', view.editMode ? 'mb-2.5' : 'mb-3.5')}
          >
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

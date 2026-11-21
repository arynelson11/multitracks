import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type React from 'react'
import { OUTPUT_WARNING_TEXT, outputSummary } from '../../lib/outputPlan'
import type { OutputWarning } from '../../lib/outputPlan'
import { isSelfLoop } from '../../lib/sectionArm'
import { barSeconds, nearestBarLine, pulseSeconds } from '../../lib/songGrid'
import { gridHasPhase } from '../../lib/stageContracts'
import type { OutputPlan, SongGrid, StageActions, StageClock, StageSection, StageView } from '../../lib/stageContracts'
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

/**
 * Ações do palco mais a da casca: o aviso âmbar de saídas abre as Configurações direto na seção
 * de saídas (Ruling T18-saidas), não na aba Perfil como o CONFIG. Quem implementa é o App (T29).
 */
export interface StageShellActions extends StageActions { openOutputSettings(): void }

export interface StageShellProps {
  view: StageView; actions: StageShellActions; clock: StageClock; peaks: Float32Array | null
  pads: Omit<PadPanelProps, 'open' | 'onClose'>
  // `separation` (Parte 3): a gaveta SEPARAÇÃO, à direita, espelho da REPERTÓRIOS. Só com a música
  // atual vinda de uma separação (o App decide).
  slots: { repertoire: React.ReactNode; tracksMenu?: React.ReactNode; adminTools?: React.ReactNode; channelEditPanel?: React.ReactNode; separation?: React.ReactNode }
  keyboardEnabled: boolean
  /**
   * Aviso do plano de saídas de agora (`PlannedOutputs.warning` do motor, o mesmo que as
   * Configurações mostram), inclusive o `sink-timeout` da troca de aparelho. Com aviso, o selo
   * âmbar SAÍDAS aparece na barra; sem aviso, não. A T29 passa `outputPlan.warning`.
   */
  outputWarning: OutputWarning | null
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

/**
 * Texto do aviso de saída no palco (Ruling T6-2): o do plano, o mesmo das Configurações
 * (`OUTPUT_WARNING_TEXT`), sem conta própria pelos campos. Na placa com menos de 4 canais o texto
 * ganha o resumo de como as saídas ficaram (onde o Click está saindo agora).
 */
function outputAlertText(warning: OutputWarning | null, plan: OutputPlan): string | null {
  if (warning === null) return null
  const text = OUTPUT_WARNING_TEXT[warning]
  return warning === 'poucos-canais' ? `${text} Agora: ${outputSummary(plan)}.` : text
}

/**
 * Controles do palco que não pegam foco com toque ou clique (Ruling T18-foco): o foco só chega
 * pelo Tab. Campo de texto continua pegando (é onde se digita).
 */
const POINTER_NO_FOCUS =
  'button, summary, [role="button"], [role="tab"], [role="radio"], [role="slider"], [role="switch"], [role="checkbox"], [role="option"], [role="menuitem"], [role="menuitemradio"], [role="menuitemcheckbox"]'
const TEXT_FIELD = 'input, textarea, select, [contenteditable]:not([contenteditable="false"])'

/**
 * Toque ou clique num botão ou controle do palco: segura o mousedown (o navegador não põe o foco
 * nele) e tira o foco de quem estava com ele. Assim o Espaço seguinte sempre toca ou pausa e nunca
 * reaperta o botão tocado (reapertar a seção armada cancelaria o pulo), e a seta do pedal troca de
 * seção em vez de mexer no fader que acabou de ser arrastado. O click, o arrasto (eventos de
 * ponteiro) e o duplo clique seguem normais; pelo Tab, Espaço e Enter continuam no botão.
 */
function keepPointerFocusOff(e: React.MouseEvent): void {
  const el = e.target instanceof Element ? e.target : null
  if (!el || el.closest(TEXT_FIELD)) return
  const control = el.closest(POINTER_NO_FOCUS)
  if (!control) return
  e.preventDefault()
  const active = document.activeElement
  if (active instanceof HTMLElement && active !== document.body && !control.contains(active)) active.blur()
}

/** Vão entre o selo ONLINE e o aviso de saídas, e do aviso até o menu (o gap-3 da barra). */
const ALERT_GAP = 12
/** Folga do conteúdo da barra de edição até a botoeira acima (o pt-2.5 da SectionPads). */
const EDIT_TOP = 10

interface EditAreaProps { view: StageView; actions: StageActions; adminTools: React.ReactNode }

/** Mesmas seções, com o mesmo índice, nome e início (a lista pode chegar num objeto novo a cada renderização). */
function sameSections(a: readonly StageSection[], b: readonly StageSection[]): boolean {
  return a.length === b.length && a.every((s, i) => s.index === b[i].index && s.label === b[i].label && s.start === b[i].start)
}

/**
 * Seleção do EDITAR quando a lista de seções muda: ela segue a SEÇÃO, nunca a posição. Com a mesma
 * quantidade (o ajuste mexe no início da selecionada, nunca na ordem), fica no mesmo índice se ali
 * continua a mesma seção. Com outra quantidade (MARCAR antes dela empurra os índices), acha de novo
 * pelo início e pelo nome. Se não achar uma só, a seleção sai: ajustar a seção errada sem perceber
 * é pior do que tocar nela de novo.
 */
function followSelection(prev: readonly StageSection[], next: readonly StageSection[], selected: number): number | null {
  const was = prev.find((s) => s.index === selected)
  if (!was) return null
  if (prev.length === next.length) {
    const now = next.find((s) => s.index === selected)
    if (now && now.label === was.label) return selected
  }
  const same = next.filter((s) => s.start === was.start && s.label === was.label)
  return same.length === 1 ? same[0].index : null
}

/**
 * Modo EDITAR no lugar da botoeira: a barra de edição das seções e, embaixo, as ferramentas do
 * admin. Monta só no EDITAR e com a chave da música, então a seleção começa vazia a cada entrada
 * e a cada música; quando as seções mudam, ela segue a seção (`followSelection`). `hasPhase` é a
 * grade COM FASE (o ajuste anda compasso); só com o BPM salvo, 1 s.
 *
 * A altura fica reservada pela maior que a barra já teve nesta entrada (112 a 216 px, quebrando
 * linha): apagar uma seção não puxa a faixa do meio e o mixer pra cima; uma linha a mais só
 * cresce pra baixo (a onda em cima fica parada, ver `StageShell`). Janela redimensionada mede de novo.
 */
function EditArea({ view, actions, adminTools }: EditAreaProps) {
  const [selected, setSelected] = useState<number | null>(null)
  // Seções da última renderização (padrão "valor anterior"): mudou a lista, a seleção segue a seção.
  const [shown, setShown] = useState(view.sections)
  if (!sameSections(shown, view.sections)) {
    if (selected !== null) setSelected(followSelection(shown, view.sections, selected))
    setShown(view.sections)
  }
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
 * a onda (1,15) e o mixer (1, no mínimo 220 px; 200 no EDITAR) dividem o resto. A botoeira tem a altura dos nomes
 * da música (64 a 81 px) e guarda a dela com a música tocando.
 *
 * EDITAR: ao entrar, a onda fica no máximo com a altura que tinha fora dele e encolhe só o que
 * precisar pra barra de edição caber (até 88 px de onda, blocos com 44 px de toque); depois fica
 * parada. Marcar uma seção que abre uma linha nova na barra empurra só o que está embaixo dela
 * (tira do mixer acima de 200 px, o que o PRINCIPAL precisa com o fader no mínimo de 60): MARCAR e
 * o que está acima nunca andam enquanto se marca. Janela redimensionada ou outra música encaixam de
 * novo. Se não couber, o palco rola na vertical em vez de cortar (EDITAR com duas linhas de seções
 * em 1024x740 rola 38 px, a folga aceita).
 *
 * Ao vivo, a onda tem piso de 104 px (blocos com 48 px de toque) pra tudo caber a partir de 740 px de
 * altura, o mínimo do palco novo (Ruling T18-altura).
 *
 * O aviso de saídas (Ruling T6-2) é o do plano (`outputWarning`), fica na barra do app, ao lado do
 * ONLINE, e abre as Configurações na seção de saídas (Ruling T18-saidas): aparecer com a música
 * tocando não muda a altura de nada.
 *
 * Foco (Ruling T18-foco): botões e controles do palco não pegam foco no toque ou clique, só pelo Tab
 * (`keepPointerFocusOff`, na captura do mousedown de toda a casca, slots incluídos).
 *
 * Tela estreita (Ruling I2-estreito): o App só troca de palco com a música parada, então o palco novo
 * pode ficar na tela abaixo dos 1024 px tocando (iPad girado, janela estreitada, Split View). A barra
 * do app e a área do palco têm no mínimo 1024 px e a casca rola de lado (`data-stage-hscroll`): nada
 * fica cortado nem fora de alcance (PAD, LETRA, SAIR, o aviso PRÓXIMA com o X) até a música parar e o
 * app trocar pro palco de sempre. A gaveta REPERTÓRIOS e o painel do canal ficam fora da rolagem.
 */
export function StageShell({ view, actions, clock, peaks, pads, slots, keyboardEnabled, outputWarning }: StageShellProps) {
  const headerRef = useRef<HTMLDivElement>(null)
  const tracksRef = useRef<HTMLDivElement>(null)
  const alertRef = useRef<HTMLButtonElement>(null)
  const waveRef = useRef<HTMLDivElement>(null)
  // A grade de tons entra na pilha do Esc dos painéis: o último aberto fecha primeiro e o Esc que
  // fecha a grade não chega ao atalho global (não cancela o pulo). O ref fica NULO de propósito (M5):
  // ligado no diálogo, o usePanelDismiss poria o foco nele ao abrir (pelo toque, contra a Ruling
  // T18-foco; pelo teclado, tirando o foco do tom atual). Nulo é seguro porque o foco da grade é
  // todo do KeyCell: ao abrir, o efeito dele roda antes do da casca (foca o tom atual só pelo
  // teclado); ao fechar com o foco dentro, roda depois da limpeza da casca e põe o foco no botão do
  // tom. E a grade não tem ação de dois toques pro Esc procurar dentro. Testado em "grade de tons:
  // pelo toque..." (com o diálogo ligado, ele e o teste do TOM falham).
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
  const alert = outputAlertText(outputWarning, view.outputs)
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

  // O menu FAIXAS abre embaixo do botão FAIXAS; o aviso de saídas fica depois do selo ONLINE (ou
  // do selo do Livre, quando ele está na barra) e, se não couber até o menu, mostra só a luz (o
  // texto continua no nome e na dica). As posições dependem da largura da tela, das fontes e da
  // barra: OFFLINE é mais largo que ONLINE (o selo anda junto, e o wifi pode cair no meio do
  // culto), o HOST do computador alarga o menu e o selo do Livre aparece e some com o Play.
  const online = view.app.online
  const desktop = view.app.isDesktop
  const livreBadge = view.app.livre !== null
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
      const badge = header.querySelector<HTMLElement>('[data-livre-badge]') ?? header.querySelector<HTMLElement>('[data-online]')
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
  }, [hasTracksMenu, alert, online, desktop, livreBadge])

  const closePads = () => { if (view.padPanelOpen) actions.togglePadPanel() }

  return (
    <div
      data-stage-shell="" onMouseDownCapture={keepPointerFocusOff}
      className="relative flex h-dvh w-full min-w-0 flex-col overflow-hidden bg-ps-ink font-ps-sans text-ps-bone"
    >
      <div data-stage-hscroll="" data-scroll-reach="" className="flex min-h-0 flex-1 overflow-x-auto overflow-y-hidden">
        <div className="flex min-h-0 min-w-[1024px] flex-1 flex-col">
          <div ref={headerRef} className="relative z-30 shrink-0">
            <StageAppBar app={view.app} editMode={view.editMode} actions={actions} />
            {alert && (
              <button
                ref={alertRef} type="button" data-output-alert="" title={alert} aria-label={`Saídas: ${alert} Abre as saídas nas Configurações.`}
                onClick={() => actions.openOutputSettings()}
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
                className={cx('flex flex-[1.15_1_0px] flex-col px-ps-gutter', view.editMode ? 'min-h-[96px] pt-2' : 'min-h-[104px] pt-3')}
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
                      grid={view.grid} songBpm={view.song?.bpm ?? null} busy={view.isReadingGrid} hasClickChannel={view.click.channelId !== null}
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
                className={cx('relative z-10 mx-ps-gutter mt-3 flex flex-[1_1_0px]', view.editMode ? 'min-h-[200px] mb-2.5' : 'min-h-[220px] mb-3.5')}
              >
                <StageMixer view={view} actions={actions} clock={clock} />
                <div data-stage-pads-layer="" className="absolute inset-y-0 z-20 flex" style={{ right: PADS_RIGHT }}>
                  <PadPanel {...pads} open={view.padPanelOpen} onClose={closePads} />
                </div>
              </div>
            </main>
          </div>
        </div>
      </div>

      <div data-stage-drawer="" className="absolute top-11 bottom-0 left-0 z-40 flex">{slots.repertoire}</div>
      {slots.separation != null && slots.separation !== false && (
        <div data-stage-drawer-right="" className="absolute top-11 bottom-0 right-0 z-40 flex">{slots.separation}</div>
      )}
      {slots.channelEditPanel}
    </div>
  )
}

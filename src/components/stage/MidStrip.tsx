import { useEffect, useLayoutEffect, useRef } from 'react'
import type { StageActions, StageClock, StageView } from '../../lib/stageContracts'
import { BigButton } from './BigButton'
import { CurrentSectionCell } from './CurrentSectionCell'
import { KeyCell } from './KeyCell'
import { SongCell } from './SongCell'
import { TimeCell } from './TimeCell'

export interface MidStripProps {
  view: StageView; actions: StageActions; clock: StageClock; keyGridOpen: boolean; onKeyGridOpenChange(open: boolean): void; onOpenMeter(): void
}

/**
 * Nada corta (regra do dono): o que pode não caber desce um tamanho. `data-fit-height` (célula):
 * o conteúdo passou da altura da faixa. `data-fit-width` (botão do tom): passou da largura. Marca
 * `data-fit="small"`, que as células leem nas classes. Primeiro apaga tudo, depois mede.
 */
function fitStrip(root: HTMLElement): void {
  const height = [...root.querySelectorAll<HTMLElement>('[data-fit-height]')]
  const width = [...root.querySelectorAll<HTMLElement>('[data-fit-width]')]
  for (const el of [...height, ...width]) delete el.dataset.fit
  const tooTall = height.filter((el) => el.scrollHeight > el.clientHeight + 1)
  const tooWide = width.filter((el) => el.scrollWidth > el.clientWidth + 1)
  for (const el of [...tooTall, ...tooWide]) el.dataset.fit = 'small'
}

// v5 .mid: 12 px abaixo da botoeira, 16 px dos lados, altura clamp(168px,20vh,208px) (a capa lê
// --ps-mid-h), as seis colunas do v5 e um fio entre as células. A linha tem a altura da faixa: o que
// passar dela é medido (fitStrip), não empurra o mixer.
const STRIP =
  'relative z-10 mx-ps-gutter mt-3 grid h-(--ps-mid-h) shrink-0 grid-cols-[minmax(214px,1.1fr)_minmax(176px,.9fr)_minmax(280px,1.3fr)_minmax(316px,2fr)_minmax(120px,.75fr)_minmax(96px,.6fr)] grid-rows-[minmax(0,1fr)] rounded-ps-2xl bg-ps-s1 font-ps-sans text-ps-bone inset-ring inset-ring-ps-line [--ps-mid-h:clamp(168px,20vh,208px)] [&>*+*]:before:absolute [&>*+*]:before:inset-y-3.5 [&>*+*]:before:left-0 [&>*+*]:before:w-px [&>*+*]:before:bg-ps-line'

/**
 * Faixa do meio do palco novo (mockup v5): tempo, TOM, seção atual, música, PAD e LETRA. Só monta
 * as células com o que vem da vista e liga cada toque na ação do palco. A grade de tons é aberta e
 * fechada pela casca (`keyGridOpen`), que também trata o Esc; o "Compasso" do modo EDITAR abre o
 * editor da casca (`onOpenMeter`). O BPM é o da música (semínima, Ruling T3-BPM); o compasso é o
 * da grade em uso (o salvo quando ainda não há grade).
 */
export function MidStrip({ view, actions, clock, keyGridOpen, onKeyGridOpenChange, onOpenMeter }: MidStripProps) {
  const rootRef = useRef<HTMLElement>(null)
  const song = view.song
  const signature = view.grid?.signature ?? song?.signature ?? null

  // Mede de novo só quando muda algum texto que mexe no tamanho (a casca renderiza a cada quadro).
  const fitKey = [
    song?.name, song?.artist, song?.nextName, song?.repertoireName, song?.position, song?.total, song?.originalKey, song?.pitch, song?.bpm,
    signature, view.gridWarning, view.editMode, view.activePad, view.currentSection, view.sections.map((s) => s.label).join('\n'),
  ].join('\t')
  useLayoutEffect(() => {
    if (rootRef.current) fitStrip(rootRef.current)
  }, [fitKey])
  // A largura muda com a janela e as fontes chegam depois da primeira pintura: mede de novo.
  useEffect(() => {
    const root = rootRef.current
    if (!root) return
    let alive = true
    const refit = () => { if (alive) fitStrip(root) }
    document.fonts?.ready.then(refit, () => {})
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(refit)
    ro?.observe(root)
    return () => {
      alive = false
      ro?.disconnect()
    }
  }, [])

  return (
    <section ref={rootRef} aria-label="Música atual" className={STRIP}>
      <TimeCell
        duration={song?.duration ?? 0} bpm={song?.bpm ?? null} signature={signature} gridWarning={view.gridWarning}
        editMode={view.editMode} clock={clock} onOpenMeter={() => onOpenMeter()}
      />
      <KeyCell
        originalKey={song?.originalKey ?? null} pitch={song?.pitch ?? 0} gridOpen={keyGridOpen}
        onGridOpenChange={(open) => onKeyGridOpenChange(open)} onChangePitch={(s) => actions.changePitch(s)}
      />
      <CurrentSectionCell
        sections={view.sections} currentSection={view.currentSection} intent={view.intent} gates={view.gates} clock={clock}
        onArmRepeat={(plays) => actions.armRepeat(plays)} onToggleLoop={() => actions.toggleLoop()} onUpgrade={() => actions.openUpgrade()}
      />
      <SongCell song={song} onPrev={() => actions.prevSong()} onNext={() => actions.nextSong()} />
      <BigButton
        kind="pad" on={view.padPanelOpen} live={view.activePad !== null} sub={view.activePad ? `tocando ${view.activePad}` : 'parado'}
        onPress={() => actions.togglePadPanel()}
      />
      <BigButton kind="letra" on={false} live={false} sub="teleprompter" onPress={() => actions.openLyrics()} />
    </section>
  )
}

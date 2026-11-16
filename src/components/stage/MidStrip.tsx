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

/** Altura de uma linha do texto em px (a do CSS; sem ela, 1,2 da fonte). */
function lineHeightPx(el: HTMLElement): number {
  const cs = getComputedStyle(el)
  const lh = parseFloat(cs.lineHeight)
  return Number.isFinite(lh) ? lh : parseFloat(cs.fontSize) * 1.2
}

/**
 * Algum filho (fora os absolutos, como o texto só pro leitor de tela) sai da caixa de conteúdo da
 * célula na vertical? Conteúdo centralizado transborda pros dois lados, então compara as caixas.
 */
function overflowsY(cell: HTMLElement): boolean {
  const cs = getComputedStyle(cell)
  const box = cell.getBoundingClientRect()
  const top = box.top + (parseFloat(cs.paddingTop) || 0) - 0.5
  const bottom = box.bottom - (parseFloat(cs.paddingBottom) || 0) + 0.5
  for (const child of cell.children) {
    if (getComputedStyle(child).position === 'absolute') continue
    const r = child.getBoundingClientRect()
    if (r.height > 0 && (r.top < top || r.bottom > bottom)) return true
  }
  return false
}

/**
 * Nada corta (regra do dono): o que pode não caber desce de tamanho, marcado em `data-fit`, que
 * as células leem nas classes (`small` e, se ainda não coube, `smaller`). Primeiro apaga tudo.
 * `data-fit-lines="N"` (nome da seção, título): passou de N linhas no tamanho grande (Ruling
 * T8-4: até 2). Depois, com esses textos no tamanho final, `data-fit-height` (célula): o conteúdo
 * saiu da altura útil da faixa; `data-fit-width` (botão do tom): passou da largura. Por fim,
 * `data-fit-cover` (capa sem imagem): o título de enfeite que não cabe no quadrado some (`hide`).
 */
function fitStrip(root: HTMLElement): void {
  const lines = [...root.querySelectorAll<HTMLElement>('[data-fit-lines]')]
  const height = [...root.querySelectorAll<HTMLElement>('[data-fit-height]')]
  const width = [...root.querySelectorAll<HTMLElement>('[data-fit-width]')]
  const cover = [...root.querySelectorAll<HTMLElement>('[data-fit-cover]')]
  for (const el of [...lines, ...height, ...width, ...cover]) delete el.dataset.fit
  const tooManyLines = lines.filter((el) => el.offsetHeight > lineHeightPx(el) * (Number(el.dataset.fitLines) + 0.5))
  for (const el of tooManyLines) el.dataset.fit = 'small'
  const tooWide = width.filter((el) => el.scrollWidth > el.clientWidth + 1)
  for (const el of tooWide) el.dataset.fit = 'small'
  for (const el of height) {
    if (!overflowsY(el)) continue
    el.dataset.fit = 'small'
    if (overflowsY(el)) el.dataset.fit = 'smaller'
  }
  // Por último, com a capa no tamanho final: o título de enfeite que não cabe nela some.
  for (const el of cover) if (overflowsY(el)) el.dataset.fit = 'hide'
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

import { useEffect, useLayoutEffect, useRef } from 'react'
import type { StageActions, StageClock, StageView } from '../../lib/stageContracts'
import { BigButton } from './BigButton'
import { CurrentSectionCell } from './CurrentSectionCell'
import { KeyCell } from './KeyCell'
import { shownBpm } from './shownBpm'
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

/** Folga mínima do conteúdo até a borda de cima e de baixo da célula (Ruling T13-texto). */
const FIT_MARGIN = 4

/**
 * Algum filho (fora os absolutos, como o texto só pro leitor de tela) sai da caixa na vertical?
 * Com `margin`, a caixa é a borda menos essa folga (célula: o conteúdo pode usar o padding até 4 px
 * da borda); sem, é a caixa de conteúdo (capa: dentro do padding dela). Conteúdo centralizado
 * transborda pros dois lados, então compara as caixas.
 */
function overflowsY(el: HTMLElement, margin?: number): boolean {
  const cs = getComputedStyle(el)
  const box = el.getBoundingClientRect()
  // A folga mínima não tem tolerância (3,7 px não é 4); a caixa de conteúdo aceita meio px de arredondamento.
  const slack = margin === undefined ? 0.5 : 0
  const top = box.top + (margin ?? (parseFloat(cs.paddingTop) || 0)) - slack
  const bottom = box.bottom - (margin ?? (parseFloat(cs.paddingBottom) || 0)) + slack
  for (const child of el.children) {
    if (getComputedStyle(child).position === 'absolute') continue
    const r = child.getBoundingClientRect()
    if (r.height > 0 && (r.top < top || r.bottom > bottom)) return true
  }
  return false
}

/** Algum filho sai da caixa de conteúdo (dentro do padding) na largura? Palavra longa num quadrado pequeno. */
function overflowsX(el: HTMLElement): boolean {
  const cs = getComputedStyle(el)
  const box = el.getBoundingClientRect()
  const left = box.left + (parseFloat(cs.paddingLeft) || 0) - 0.5
  const right = box.right - (parseFloat(cs.paddingRight) || 0) + 0.5
  for (const child of el.children) {
    if (getComputedStyle(child).position === 'absolute') continue
    const r = child.getBoundingClientRect()
    if (r.width > 0 && (r.left < left || r.right > right)) return true
  }
  return false
}

/** Degraus do encaixe: --ps-fit vai de 1 (tamanho cheio) a 0 (texto em 12 px, capa em 48 px) em 8 passos. */
const FIT_STEPS = 8

/** Cabe: nada chega a menos de 4 px da borda de cima ou de baixo e nenhum `data-fit-lines="N"` passa de N linhas (Ruling T8-4: até 2). */
function cellFits(cell: HTMLElement): boolean {
  if (overflowsY(cell, FIT_MARGIN)) return false
  for (const el of cell.querySelectorAll<HTMLElement>('[data-fit-lines]')) {
    if (el.offsetHeight > lineHeightPx(el) * (Number(el.dataset.fitLines) + 0.5)) return false
  }
  return true
}

/** Desce o --ps-fit da célula do tamanho cheio até o mínimo e para no primeiro degrau em que cabe. */
function shrinkToFit(cell: HTMLElement): boolean {
  for (let i = 0; i <= FIT_STEPS; i++) {
    cell.style.setProperty('--ps-fit', String(1 - i / FIT_STEPS))
    if (cellFits(cell)) return true
  }
  return false
}

/**
 * Nada corta (regra do dono; Ruling T13-texto): o que não cabe desce de tamanho aos poucos.
 * - Botão do tom (`data-fit-width`) que passa da largura: perde a seta e o tom desce pra 30 px.
 * - Célula com `data-fit-height` (tempo, seção, música): ganha `--ps-fit`, que as classes leem, no
 *   maior degrau em que nada chega a menos de 4 px da borda de cima ou de baixo (o conteúdo
 *   centralizado pode usar o padding até aí) e o nome da seção e o título ficam em até 2 linhas.
 *   Se nem no mínimo (12 px de texto) couber e houver o que pode sair (`data-fit-drop`, a capa), a
 *   célula ganha `data-fit="drop"` e mede de novo, do tamanho cheio; senão fica no mínimo, sem cortar.
 * - Capa sem imagem (`data-fit-cover`): o título de enfeite que não cabe no quadrado, na altura ou na
 *   largura (palavra longa numa capa pequena), some.
 */
function fitStrip(root: HTMLElement): void {
  const width = [...root.querySelectorAll<HTMLElement>('[data-fit-width]')]
  const cells = [...root.querySelectorAll<HTMLElement>('[data-fit-height]')]
  const cover = [...root.querySelectorAll<HTMLElement>('[data-fit-cover]')]
  for (const el of [...width, ...cover]) delete el.dataset.fit
  for (const el of cells) {
    el.style.removeProperty('--ps-fit')
    delete el.dataset.fit
  }
  const tooWide = width.filter((el) => el.scrollWidth > el.clientWidth + 1)
  for (const el of tooWide) el.dataset.fit = 'small'
  for (const cell of cells) {
    if (shrinkToFit(cell) || !cell.querySelector('[data-fit-drop]')) continue
    cell.dataset.fit = 'drop'
    shrinkToFit(cell)
  }
  for (const el of cover) if (overflowsY(el) || overflowsX(el)) el.dataset.fit = 'hide'
}

// v5 .mid: 12 px abaixo da botoeira, 16 px dos lados, altura clamp(168px,20vh,208px) (a capa lê
// --ps-mid-h) e um fio entre as células. De 1280 pra cima, as seis colunas do v5 numa linha. Abaixo
// (Ruling T13-1024): cinco colunas que somam 988 px (cabem nos 992 de 1024), as quatro primeiras
// células nas duas linhas e PAD em cima de LETRA na última. As linhas têm a altura da faixa: o que
// passar dela é medido (fitStrip), não empurra o mixer.
const STRIP =
  'relative z-10 mx-ps-gutter mt-3 grid h-(--ps-mid-h) shrink-0 grid-cols-[minmax(172px,1.1fr)_minmax(176px,.9fr)_minmax(268px,1.3fr)_minmax(268px,2fr)_minmax(104px,.6fr)] grid-rows-[minmax(0,1fr)] max-xl:grid-rows-[minmax(0,1fr)_minmax(0,1fr)] max-xl:[&>:nth-child(-n+4)]:row-span-2 xl:grid-cols-[minmax(214px,1.1fr)_minmax(176px,.9fr)_minmax(280px,1.3fr)_minmax(316px,2fr)_minmax(120px,.75fr)_minmax(96px,.6fr)] rounded-ps-2xl bg-ps-s1 font-ps-sans text-ps-bone inset-ring inset-ring-ps-line [--ps-mid-h:clamp(168px,20vh,208px)] [&>*+*]:before:absolute [&>*+*]:before:inset-y-3.5 [&>*+*]:before:left-0 [&>*+*]:before:w-px [&>*+*]:before:bg-ps-line'

/**
 * Faixa do meio do palco novo (mockup v5): tempo, TOM, seção atual, música, PAD e LETRA. Só monta
 * as células com o que vem da vista e liga cada toque na ação do palco. A grade de tons é aberta e
 * fechada pela casca (`keyGridOpen`), que também trata o Esc; o "Compasso" do modo EDITAR abre o
 * editor da casca (`onOpenMeter`). BPM e compasso são os da grade em uso; sem grade, os salvos da
 * música (ver `shownBpm`).
 */
export function MidStrip({ view, actions, clock, keyGridOpen, onKeyGridOpenChange, onOpenMeter }: MidStripProps) {
  const rootRef = useRef<HTMLElement>(null)
  const song = view.song
  const signature = view.grid?.signature ?? song?.signature ?? null
  const bpm = shownBpm(view.grid, song?.bpm ?? null)

  // Mede de novo só quando muda algum texto que mexe no tamanho (a casca renderiza a cada quadro).
  // A seção atual entra pelo NOME que a célula mostra, não pelo índice: trocar de seção com o mesmo
  // nome (Refrão, Refrão) não refaz as medidas no instante do pouso.
  const currentName = view.sections.find((s) => s.index === view.currentSection)?.label ?? (view.sections.length > 0 ? '\u0000antes' : '\u0000sem')
  const fitKey = [
    song?.name, song?.artist, song?.nextName, song?.repertoireName, song?.position, song?.total, song?.originalKey, song?.pitch, bpm,
    signature, view.gridWarning, view.editMode, view.activePad, currentName, view.sections.map((s) => s.label).join('\n'),
  ].join('\t')
  useLayoutEffect(() => {
    if (rootRef.current) fitStrip(rootRef.current)
  }, [fitKey])
  // Mede de novo quando a faixa muda de tamanho, quando a JANELA muda (Ruling T13-resize: abaixo de
  // 840 px de altura a faixa fica em 168 px, mas as fontes seguem a altura da tela e crescem sem a
  // faixa mudar) e quando as fontes chegam depois da primeira pintura. Uma medida por quadro, no máximo.
  useEffect(() => {
    const root = rootRef.current
    if (!root) return
    let frame = 0
    const refit = () => {
      if (frame) return
      frame = requestAnimationFrame(() => {
        frame = 0
        fitStrip(root)
      })
    }
    document.fonts?.ready.then(refit, () => {})
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(refit)
    ro?.observe(root)
    window.addEventListener('resize', refit)
    return () => {
      window.removeEventListener('resize', refit)
      ro?.disconnect()
      if (frame) cancelAnimationFrame(frame)
      frame = -1 // desmontou: a promessa das fontes que chegar depois não agenda mais nada
    }
  }, [])

  return (
    <section ref={rootRef} aria-label="Música atual" className={STRIP}>
      <TimeCell
        duration={song?.duration ?? 0} bpm={bpm} signature={signature} gridWarning={view.gridWarning}
        editMode={view.editMode} clock={clock} onOpenMeter={() => onOpenMeter()}
      />
      <KeyCell
        originalKey={song?.originalKey ?? null} pitch={song?.pitch ?? 0} gridOpen={keyGridOpen}
        onGridOpenChange={(open) => onKeyGridOpenChange(open)} onChangePitch={(s) => actions.changePitch(s)}
        onSetOriginalKey={(key) => actions.setOriginalKey(key)}
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

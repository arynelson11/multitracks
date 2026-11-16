import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import type React from 'react'
import { useTwoTapConfirm } from '../../hooks/useTwoTapConfirm'
import { formatBpm } from '../../lib/beatGrid'
import { cx } from '../ui'
import { Icon } from './icons'
import { useExclusiveArm, usePanelDismiss } from './panelDismiss'
import { TwoTapTrashButton } from './TwoTapTrashButton'

export interface RepertoireSongItem { id: string; name: string; artist?: string; coverImage?: string; originalKey?: string | null; bpm?: number | null }
export interface RepertoirePanelProps {
  open: boolean; songs: RepertoireSongItem[]; activeIndex: number; isPlaying: boolean; notes: string
  onNotesChange(v: string): void; onSelect(i: number): void; onReorder(from: number, to: number): void; onRemove(id: string): void
  onNew(): void; onExport(): void; onImport(file: File): void; onClose(): void
}

/** Arrastando perto da borda da lista (px), ela rola pra levar a música até o lugar. */
const EDGE = 40
const EDGE_STEP = 12

const ACTION =
  'inline-flex shrink-0 items-center justify-center gap-1.5 min-h-ps-touch min-w-ps-touch px-ps-pad-x rounded-ps-lg font-ps-sans text-ps-sm font-bold tracking-[0.1em] whitespace-nowrap select-none transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ps-or disabled:opacity-35 disabled:pointer-events-none'
const ACTION_IDLE = 'bg-ps-s2 text-ps-bone inset-ring inset-ring-ps-line hover:inset-ring-ps-line-2'
const ACTION_ARMED = 'bg-ps-alert text-ps-ink tracking-normal'
const ICON_BTN =
  'inline-flex shrink-0 items-center justify-center min-h-ps-touch min-w-ps-touch rounded-ps-md select-none transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ps-or'

/** Tom e BPM da linha ("Tom G", "78 BPM"); o que não se sabe fica de fora. */
function songMeta(s: RepertoireSongItem): string[] {
  const parts: string[] = []
  if (s.originalKey) parts.push(`Tom ${s.originalKey}`)
  if (typeof s.bpm === 'number' && s.bpm > 0) parts.push(`${formatBpm(s.bpm)} BPM`)
  return parts
}

/** Elemento da lista com `data-<attr>` igual ao valor (sem CSS.escape: o id pode ter qualquer caractere). */
function findByData(root: HTMLElement | null, attr: string, value: string): HTMLElement | undefined {
  if (!root) return undefined
  return [...root.querySelectorAll<HTMLElement>(`[data-${attr}]`)].find((el) => el.getAttribute(`data-${attr}`) === value)
}

/**
 * Painel REPERTÓRIOS do palco novo: gaveta da esquerda com Novo (dois toques), Salvar e Carregar
 * .zip, a lista (capa, nome, artista, tom e BPM; toque escolhe; alça de reordenar que funciona no
 * toque e nas setas; lixeira de dois toques) e as Anotações. Diálogo sem bloqueio: o palco continua
 * respondendo com ele aberto. Fecha no X e no Esc (o aberto por último fecha primeiro; com algo
 * armado, o Esc só desarma). A casca posiciona (à esquerda, altura toda); a largura é a do painel,
 * então fechado ele não ocupa nada.
 */
export function RepertoirePanel(props: RepertoirePanelProps) {
  const panelRef = useRef<HTMLDivElement>(null)
  usePanelDismiss(props.open, props.onClose, panelRef)
  if (!props.open) return null
  return <RepertoireDrawer {...props} panelRef={panelRef} />
}

function RepertoireDrawer({
  songs, activeIndex, isPlaying, notes, onNotesChange, onSelect, onReorder, onRemove, onNew, onExport, onImport, onClose, panelRef,
}: RepertoirePanelProps & { panelRef: React.RefObject<HTMLDivElement | null> }) {
  const notesId = useId()
  const novoId = useId()
  const listRef = useRef<HTMLOListElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const [drag, setDrag] = useState<{ from: number; over: number } | null>(null)
  const focusGripRef = useRef<string | null>(null)

  // Novo: dois toques, e uma ação de dois toques armada por vez no palco.
  const novo = useTwoTapConfirm(() => onNew())
  const novoArmed = novo.armedId === novoId
  useExclusiveArm(novoArmed, novoId, novo.disarm)

  // Abrir mostra a música ativa. Só ao abrir: trocar de música com o painel aberto não rola a
  // lista na mão de quem está mexendo (o jsdom não tem scrollIntoView).
  const [activeAtOpen] = useState(() => songs[activeIndex]?.id ?? null)
  useEffect(() => {
    if (activeAtOpen) findByData(listRef.current, 'row-id', activeAtOpen)?.scrollIntoView?.({ block: 'nearest' })
  }, [activeAtOpen])

  // Reordenar pelas setas: o React move a linha no DOM e o foco cai no body; volta pra alça dela.
  useLayoutEffect(() => {
    const id = focusGripRef.current
    if (!id) return
    focusGripRef.current = null
    const lost = !document.activeElement || document.activeElement === document.body
    if (lost) findByData(listRef.current, 'grip', id)?.focus({ preventScroll: true })
  }, [songs])

  /** Linha embaixo do dedo; acima da primeira = 0, abaixo da última = a última. */
  const rowAt = (clientY: number): number => {
    const items = listRef.current ? [...listRef.current.querySelectorAll<HTMLElement>('[data-row]')] : []
    for (let i = 0; i < items.length; i++) if (clientY < items[i].getBoundingClientRect().bottom) return i
    return Math.max(0, items.length - 1)
  }
  const autoScroll = (clientY: number) => {
    const box = scrollRef.current
    if (!box) return
    const r = box.getBoundingClientRect()
    if (!(r.height > 0)) return
    if (clientY < r.top + EDGE) box.scrollTop -= EDGE_STEP
    else if (clientY > r.bottom - EDGE) box.scrollTop += EDGE_STEP
  }
  const onGripDown = (e: React.PointerEvent<HTMLButtonElement>, i: number) => {
    if (e.button > 0) return
    try {
      e.currentTarget.setPointerCapture?.(e.pointerId)
    } catch {
      // Sem captura o arrasto vale enquanto o dedo estiver em cima da alça.
    }
    setDrag({ from: i, over: i })
  }
  const onGripMove = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (!drag) return
    autoScroll(e.clientY)
    const over = rowAt(e.clientY)
    if (over !== drag.over) setDrag({ ...drag, over })
  }
  const onGripUp = () => {
    if (drag && drag.over !== drag.from) onReorder(drag.from, drag.over)
    setDrag(null)
  }
  const onGripKey = (e: React.KeyboardEvent<HTMLButtonElement>, i: number, id: string) => {
    const to = e.key === 'ArrowUp' ? i - 1 : e.key === 'ArrowDown' ? i + 1 : null
    if (to === null) return
    e.preventDefault()
    if (to < 0 || to >= songs.length) return
    focusGripRef.current = id
    onReorder(i, to)
  }

  const count = songs.length === 1 ? '1 música' : `${songs.length} músicas`
  return (
    <div
      ref={panelRef}
      role="dialog"
      aria-label="Repertório"
      tabIndex={-1}
      className="flex h-full w-[420px] max-w-full flex-col gap-3 rounded-r-ps-2xl bg-ps-raised p-3 font-ps-sans text-ps-bone shadow-ps-pop inset-ring inset-ring-ps-line-2 outline-none transition-[opacity,translate] duration-200 starting:-translate-x-4 starting:opacity-0 motion-reduce:transition-none"
    >
      <div className="flex shrink-0 items-center gap-2">
        <div className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2 pl-1">
          <span className="ps-label text-ps-bone">Repertório</span>
          <span className="ps-num text-ps-sm text-ps-mut">{count}</span>
        </div>
        <button type="button" aria-label="Fechar repertório" title="Fechar (Esc)" onClick={onClose} className={cx(ICON_BTN, 'bg-ps-s2 text-ps-mut hover:text-ps-bone')}>
          <Icon name="x" />
        </button>
      </div>

      <div className="flex shrink-0 flex-wrap gap-2">
        <button
          type="button"
          aria-label={novoArmed ? 'Toque de novo para limpar o repertório' : 'Novo repertório'}
          title={novoArmed ? 'Toque de novo para limpar o repertório' : 'Começa um repertório vazio (pede um segundo toque)'}
          data-armed={novoArmed ? 'true' : 'false'}
          onClick={() => novo.press(novoId)}
          onKeyDown={(e) => { if (e.repeat && (e.key === 'Enter' || e.key === ' ')) e.preventDefault() }}
          className={cx(ACTION, novoArmed ? ACTION_ARMED : ACTION_IDLE)}
        >
          {novoArmed ? 'Limpar o repertório?' : <><Icon name="plus" className="size-[15px]" />NOVO</>}
        </button>
        <button
          type="button" aria-label="Salvar .zip" disabled={songs.length === 0}
          title={songs.length === 0 ? 'O repertório está vazio' : 'Salva o repertório inteiro num arquivo .zip'}
          onClick={onExport} className={cx(ACTION, ACTION_IDLE)}
        >
          SALVAR .ZIP
        </button>
        <button
          type="button" aria-label="Carregar .zip" title="Abre um repertório salvo em .zip"
          onClick={() => fileRef.current?.click()} className={cx(ACTION, ACTION_IDLE)}
        >
          CARREGAR .ZIP
        </button>
        <input
          ref={fileRef} type="file" accept=".zip" hidden tabIndex={-1} aria-hidden="true"
          onChange={(e) => {
            const file = e.target.files?.[0]
            // Limpa pra poder carregar o mesmo arquivo de novo.
            e.target.value = ''
            if (file) onImport(file)
          }}
        />
      </div>

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto overscroll-contain rounded-ps-xl bg-ps-well inset-ring inset-ring-ps-line">
        {songs.length === 0 ? (
          <p className="px-4 py-6 text-center text-ps-base text-ps-mut">
            Nenhuma música no repertório. Adicione pela BIBLIOTECA ou pelo menu FAIXAS.
          </p>
        ) : (
          <ol ref={listRef} data-tour="setlist-area" aria-label="Músicas do repertório" className="flex flex-col gap-1 p-1.5">
            {songs.map((s, i) => {
              const active = i === activeIndex
              const meta = songMeta(s)
              const status = active ? (isPlaying ? 'tocando' : 'atual') : null
              const name = [s.name, s.artist, ...meta.map((m) => m.charAt(0).toLowerCase() + m.slice(1)), status].filter(Boolean).join(', ')
              const dragging = drag?.from === i
              const dropTarget = drag !== null && drag.over === i && drag.over !== drag.from
              const dropLine = dropTarget && drag
                ? (drag.over > drag.from ? 'shadow-[inset_0_-2px_0_var(--color-ps-bone)]' : 'shadow-[inset_0_2px_0_var(--color-ps-bone)]')
                : ''
              return (
                <li
                  key={s.id}
                  data-row={i}
                  data-row-id={s.id}
                  data-dragging={dragging ? 'true' : 'false'}
                  data-drop-target={dropTarget ? 'true' : 'false'}
                  className={cx(
                    'relative flex items-center gap-1 rounded-ps-lg pr-1 transition-opacity',
                    // Laranja só tocando (laranja = ligado); parada, a atual fica com o anel neutro.
                    active ? cx('bg-ps-s2 inset-ring', isPlaying ? 'inset-ring-ps-or-line' : 'inset-ring-ps-line-3') : 'bg-ps-s1',
                    dragging && 'opacity-50',
                    dropLine,
                  )}
                >
                  <button
                    type="button"
                    data-grip={s.id}
                    aria-label={`Mover ${s.name}`}
                    title="Arraste pra mudar a ordem (ou use as setas)"
                    onPointerDown={(e) => onGripDown(e, i)}
                    onPointerMove={onGripMove}
                    onPointerUp={onGripUp}
                    onPointerCancel={() => setDrag(null)}
                    onKeyDown={(e) => onGripKey(e, i, s.id)}
                    className={cx(ICON_BTN, 'cursor-grab touch-none text-ps-dim hover:text-ps-bone active:cursor-grabbing')}
                  >
                    <Icon name="grip" />
                  </button>
                  <button
                    type="button"
                    aria-current={active ? 'true' : undefined}
                    aria-label={name}
                    onClick={() => onSelect(i)}
                    className="flex min-h-ps-touch min-w-0 flex-1 items-center gap-2.5 rounded-ps-md py-1.5 pr-2 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ps-or"
                  >
                    <span className="grid size-11 shrink-0 place-items-center overflow-hidden rounded-ps-sm bg-ps-ink-0 inset-ring inset-ring-ps-line">
                      {s.coverImage
                        ? <img src={s.coverImage} alt="" className="size-full object-cover" />
                        : <Icon name="mark" className="size-5 text-ps-dim" />}
                    </span>
                    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className={cx('text-ps-base leading-tight font-bold break-words', active ? 'text-ps-bone' : 'text-ps-bone/85')}>{s.name}</span>
                      {s.artist && <span className="text-ps-sm leading-tight break-words text-ps-mut">{s.artist}</span>}
                      {meta.length > 0 && <span className="ps-num text-ps-sm leading-tight text-ps-mut">{meta.join(' · ')}</span>}
                    </span>
                    {active && (
                      <span
                        className={cx(
                          'inline-flex shrink-0 items-center gap-1.5 text-ps-micro leading-none font-extrabold tracking-[0.12em]',
                          isPlaying ? 'text-ps-or' : 'text-ps-mut',
                        )}
                      >
                        {isPlaying && <span aria-hidden="true" className="size-1.5 rounded-full bg-ps-or shadow-[0_0_6px_var(--color-ps-or)]" />}
                        {isPlaying ? 'TOCANDO' : 'ATUAL'}
                      </span>
                    )}
                  </button>
                  <TwoTapTrashButton
                    label={`Tirar ${s.name} do repertório`}
                    confirmLabel={`Toque de novo para tirar ${s.name} do repertório`}
                    armedText="Tirar?"
                    onConfirm={() => onRemove(s.id)}
                  />
                </li>
              )
            })}
          </ol>
        )}
      </div>

      <div data-tour="anotacoes" className="flex shrink-0 flex-col gap-1.5">
        <label htmlFor={notesId} className="ps-label pl-1">Anotações</label>
        <textarea
          id={notesId}
          value={notes}
          onChange={(e) => onNotesChange(e.target.value)}
          placeholder={'Ex.: 1. Abertura (Tom: C)\n2. Medley rápido (Tom: G)'}
          rows={4}
          className="w-full resize-none rounded-ps-lg bg-ps-well p-2.5 font-ps-mono text-ps-md leading-snug text-ps-bone inset-ring inset-ring-ps-line placeholder:text-ps-dim focus:outline-none focus:inset-ring-ps-or-line"
        />
      </div>
    </div>
  )
}

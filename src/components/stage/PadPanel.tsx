import { useEffect, useId, useLayoutEffect, useRef } from 'react'
import type React from 'react'
import { cx } from '../ui'
import { Icon } from './icons'

export interface PadPanelProps {
  open: boolean; onClose(): void; view: 'pads' | 'samples' | 'loops'; onViewChange(v: PadPanelProps['view']): void
  notes: readonly string[]; activeNote: string | null; songKeyIndex: number | null; volume: number; setName: string | null
  onPlayNote(note: string): void; onVolume(v: number): void; onOpenSets(): void; onEditPads(): void
  samples?: React.ReactNode; loops?: React.ReactNode
}

const TABS: ReadonlyArray<{ value: PadPanelProps['view']; label: string }> = [
  { value: 'pads', label: 'PADS' },
  { value: 'samples', label: 'SAMPLES' },
  { value: 'loops', label: 'LOOPS' },
]
/** Passo das setas no volume (5%); Page Up e Page Down andam o dobro. */
const VOLUME_STEP = 0.05

const clamp01 = (v: number) => Math.min(1, Math.max(0, v))
/** Volume em centésimos, sem o resto do ponto flutuante (0,55 + 0,05 = 0,6). */
const round2 = (v: number) => Math.round(v * 100) / 100

// v5 .tabs: aba escolhida acesa (laranja). 44 px de alvo; o grupo não tem padding pra não somar altura.
const TAB =
  'flex min-h-ps-touch min-w-ps-touch flex-1 items-center justify-center px-2 rounded-ps-md text-ps-label font-extrabold tracking-[0.12em] whitespace-nowrap select-none transition-colors duration-150 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ps-or'
const TAB_IDLE = 'text-ps-mut hover:text-ps-bone'
const TAB_ON = 'bg-ps-or-soft text-ps-or inset-ring inset-ring-ps-or-line'
// v5 .pkey: 17 px; tocando = laranja cheio com brilho. Alvo de 44 px (o v5 tinha 40).
const KEY =
  'relative flex min-h-ps-touch min-w-ps-touch items-center justify-center rounded-ps-md text-[17px] leading-none font-extrabold select-none transition-colors duration-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ps-or'
const KEY_IDLE = 'bg-ps-s2 text-ps-bone inset-ring inset-ring-ps-line hover:inset-ring-ps-line-3'
const KEY_ON = 'bg-ps-or text-ps-on-or shadow-[0_0_18px_color-mix(in_srgb,var(--color-ps-or)_35%,transparent)]'
const SIDE_BTN =
  'flex min-h-ps-touch min-w-ps-touch shrink-0 items-center gap-2 rounded-ps-md bg-ps-s2 px-2.5 py-1 select-none inset-ring inset-ring-ps-line transition-colors duration-150 hover:inset-ring-ps-line-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ps-or'

/**
 * Painel de pads do palco novo (mockup v5): abas PADS, SAMPLES e LOOPS, grade 4x3 de C a B com
 * "TOM" no tom da música e equalizador no pad tocando, CONJUNTO (nuvem), Volume (arrastar ou tocar
 * no trilho) e EDITAR. SAMPLES e LOOPS mostram o que o app mandar. Fecha no X e no Esc.
 * A casca posiciona por cima do mixer (altura toda, `right` = largura do PRINCIPAL + gap); a
 * largura é a do painel, então fechado ele não ocupa nada.
 */
export function PadPanel(props: PadPanelProps) {
  const { open, onClose } = props
  const panelRef = useRef<HTMLDivElement>(null)

  // Esc na CAPTURA, só enquanto aberto: fecha e marca o evento como tratado (o atalho global ignora).
  useEffect(() => {
    if (!open) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return
      e.preventDefault()
      onClose()
    }
    document.addEventListener('keydown', onKeyDown, true)
    return () => document.removeEventListener('keydown', onKeyDown, true)
  }, [open, onClose])

  // Abrir leva o foco pro painel (não pra um pad: o Espaço tocaria o pad); fechar com o foco nele
  // (ou perdido) devolve pra quem abriu.
  useLayoutEffect(() => {
    if (!open) return
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
    panelRef.current?.focus({ preventScroll: true })
    return () => {
      const active = document.activeElement
      const lost = !active || active === document.body || !active.isConnected
      if (opener?.isConnected && lost) opener.focus({ preventScroll: true })
    }
  }, [open])

  if (!open) return null
  return <PadDrawer {...props} panelRef={panelRef} />
}

function PadDrawer({
  onClose, view, onViewChange, notes, activeNote, songKeyIndex, volume, setName, onPlayNote, onVolume, onOpenSets, onEditPads,
  samples, loops, panelRef,
}: PadPanelProps & { panelRef: React.RefObject<HTMLDivElement | null> }) {
  const baseId = useId()
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([])
  const selected = Math.max(0, TABS.findIndex((t) => t.value === view))
  const tabId = (i: number) => `${baseId}-aba-${i}`
  const panelId = `${baseId}-conteudo`

  const onTabKey = (e: React.KeyboardEvent<HTMLButtonElement>, i: number) => {
    const n = TABS.length
    const to = e.key === 'ArrowRight' ? (i + 1) % n : e.key === 'ArrowLeft' ? (i - 1 + n) % n
      : e.key === 'Home' ? 0 : e.key === 'End' ? n - 1 : null
    if (to === null) return
    e.preventDefault()
    onViewChange(TABS[to].value)
    tabRefs.current[to]?.focus()
  }

  return (
    <div
      ref={panelRef}
      role="dialog"
      aria-label="Pads"
      tabIndex={-1}
      className="flex h-full w-[520px] max-w-full flex-col gap-2 overflow-y-auto rounded-ps-2xl bg-ps-raised p-2.5 font-ps-sans text-ps-bone shadow-ps-pop inset-ring inset-ring-ps-or-line outline-none transition-[opacity,translate] duration-200 starting:translate-y-3 starting:opacity-0 motion-reduce:transition-none"
    >
      <div className="flex shrink-0 items-center gap-2">
        <div role="tablist" aria-label="Tipo de som" className="flex flex-1 gap-[3px] rounded-ps-lg bg-ps-s1 inset-ring inset-ring-ps-line">
          {TABS.map((t, i) => (
            <button
              key={t.value}
              ref={(el) => { tabRefs.current[i] = el }}
              id={tabId(i)}
              type="button"
              role="tab"
              aria-selected={i === selected}
              aria-controls={panelId}
              tabIndex={i === selected ? 0 : -1}
              onClick={() => onViewChange(t.value)}
              onKeyDown={(e) => onTabKey(e, i)}
              className={cx(TAB, i === selected ? TAB_ON : TAB_IDLE)}
            >
              {t.label}
            </button>
          ))}
        </div>
        <button
          type="button" aria-label="Fechar pads" title="Fechar (Esc)" onClick={onClose}
          className="inline-flex min-h-ps-touch min-w-ps-touch shrink-0 items-center justify-center rounded-ps-md bg-ps-s2 text-ps-mut transition-colors hover:text-ps-bone focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ps-or"
        >
          <Icon name="x" />
        </button>
      </div>

      <div id={panelId} role="tabpanel" aria-labelledby={tabId(selected)} className="flex min-h-0 flex-1 gap-3">
        {view === 'pads' ? (
          <>
            <div className="grid min-w-0 flex-1 grid-cols-4 grid-rows-3 gap-1.5">
              {notes.map((note, i) => {
                const on = note === activeNote
                const tom = i === songKeyIndex
                return (
                  <button
                    key={note}
                    type="button"
                    data-note={note}
                    aria-pressed={on}
                    aria-label={tom ? `Pad ${note}, tom da música` : `Pad ${note}`}
                    title={on ? `Para o pad ${note}` : `Toca o pad ${note}`}
                    onClick={() => onPlayNote(note)}
                    className={cx(KEY, on ? KEY_ON : KEY_IDLE)}
                  >
                    {note}
                    {tom && (
                      <small aria-hidden="true" className={cx('absolute top-1.5 right-1.5 text-[8.5px] leading-none font-extrabold tracking-[0.08em]', on ? 'text-ps-on-or' : 'text-ps-or')}>
                        TOM
                      </small>
                    )}
                    {on && <Equalizer />}
                  </button>
                )
              })}
            </div>
            {/* 200 px (o v5 tinha 178): com a seta do v5 ao lado do rótulo, e não do nome, um nome de
                conjunto de ~30 caracteres cabe em 2 linhas e a coluna cabe no mixer de 220 px. */}
            <div className="flex w-[200px] shrink-0 flex-col justify-between gap-0.5">
              <button
                type="button" aria-label={`Conjunto de pads: ${setName ?? 'Padrão'}`} title="Conjunto de pads na nuvem (toque pra trocar)"
                onClick={onOpenSets} className={cx(SIDE_BTN, 'text-left')}
              >
                <Icon name="cloud" className="size-[17px] text-ps-mut" />
                <span className="flex min-w-0 flex-1 flex-col">
                  <small className="flex items-center gap-0.5 text-[8.5px] leading-tight font-extrabold tracking-[0.14em] text-ps-mut">
                    CONJUNTO
                    <Icon name="chd" className="size-[11px]" />
                  </small>
                  <b className="text-[14px] leading-tight font-bold break-words">{setName ?? 'Padrão'}</b>
                </span>
              </button>
              <VolumeSlider volume={volume} onVolume={onVolume} />
              <button
                type="button" aria-label="Editar pads" title="Carregar ou tirar sons dos pads" onClick={onEditPads}
                className={cx(SIDE_BTN, 'justify-center text-ps-label font-extrabold tracking-[0.12em] whitespace-nowrap text-ps-mut hover:text-ps-bone')}
              >
                <Icon name="edit" className="size-[14px]" />
                EDITAR
              </button>
            </div>
          </>
        ) : (
          // A lista de samples e loops rola aqui dentro; as abas e o X ficam sempre à vista.
          <div className="min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-contain">{view === 'samples' ? samples : loops}</div>
        )}
      </div>
    </div>
  )
}

/** v5 .eq: três barrinhas no pé do pad tocando. Pulsam com o piscar suave dos tokens (param com movimento reduzido). */
function Equalizer() {
  return (
    <span data-eq="" aria-hidden="true" className="absolute bottom-[5px] left-1/2 flex h-[9px] -translate-x-1/2 items-end gap-0.5">
      <i className="h-full w-[3px] rounded-[1px] bg-current animate-ps-blink motion-reduce:animate-none" />
      <i className="h-[60%] w-[3px] rounded-[1px] bg-current animate-ps-blink [animation-delay:-0.45s] motion-reduce:animate-none" />
      <i className="h-[80%] w-[3px] rounded-[1px] bg-current animate-ps-blink [animation-delay:-0.9s] motion-reduce:animate-none" />
    </span>
  )
}

/**
 * Volume dos pads: tocar no trilho pula pro ponto, arrastar ajusta (o dedo não rola a tela), setas
 * andam 5%. Próprio (não o input range) porque no iPad o range nativo não pula com o toque no trilho.
 * O alvo tem 44 px de altura, com o rótulo e o número em cima e o trilho de 6 px embaixo.
 */
function VolumeSlider({ volume, onVolume }: { volume: number; onVolume(v: number): void }) {
  const dragRef = useRef(false)
  const v = clamp01(volume)
  const pct = Math.round(v * 100)

  const setFrom = (el: HTMLElement, clientX: number) => {
    const r = el.getBoundingClientRect()
    if (!(r.width > 0)) return
    onVolume(round2(clamp01((clientX - r.left) / r.width)))
  }
  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button > 0) return
    dragRef.current = true
    try {
      e.currentTarget.setPointerCapture?.(e.pointerId)
    } catch {
      // Sem captura o arrasto vale enquanto o dedo estiver em cima do trilho.
    }
    setFrom(e.currentTarget, e.clientX)
  }
  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const next = e.key === 'ArrowRight' || e.key === 'ArrowUp' ? v + VOLUME_STEP
      : e.key === 'ArrowLeft' || e.key === 'ArrowDown' ? v - VOLUME_STEP
        : e.key === 'PageUp' ? v + 2 * VOLUME_STEP
          : e.key === 'PageDown' ? v - 2 * VOLUME_STEP
            : e.key === 'Home' ? 0 : e.key === 'End' ? 1 : null
    if (next === null) return
    e.preventDefault()
    onVolume(round2(clamp01(next)))
  }

  // O rótulo e o número moram dentro do alvo de 44 px (em cima), o trilho embaixo: a coluna
  // CONJUNTO, Volume e EDITAR cabe no mixer mais baixo (220 px).
  return (
    <div
      role="slider"
      tabIndex={0}
      aria-label="Volume dos pads"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={pct}
      aria-valuetext={`${pct}%`}
      title="Arraste ou toque no trilho"
      onPointerDown={onPointerDown}
      onPointerMove={(e) => { if (dragRef.current) setFrom(e.currentTarget, e.clientX) }}
      onPointerUp={() => { dragRef.current = false }}
      onPointerCancel={() => { dragRef.current = false }}
      onKeyDown={onKeyDown}
      style={{ '--pv': v } as React.CSSProperties}
      className="relative min-h-ps-touch shrink-0 cursor-pointer touch-none rounded-ps-sm select-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ps-or"
    >
      <span aria-hidden="true" className="absolute inset-x-1 top-1.5 flex items-center justify-between leading-none">
        <span className="ps-label leading-none">Volume</span>
        <span className="ps-num text-ps-sm leading-none font-bold">{pct}%</span>
      </span>
      <span aria-hidden="true" className="absolute inset-x-0 top-[32px] h-1.5 -translate-y-1/2 rounded-[3px] bg-ps-s3" />
      <span aria-hidden="true" className="absolute top-[32px] left-0 h-1.5 w-[calc(var(--pv)*100%)] -translate-y-1/2 rounded-[3px] bg-ps-or" />
      <span aria-hidden="true" className="absolute top-[32px] left-[calc(var(--pv)*100%)] size-5 -translate-1/2 rounded-full bg-ps-bone shadow-[0_2px_6px_var(--color-ps-ink-0)]" />
    </div>
  )
}

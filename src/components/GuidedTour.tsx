import { useState, useEffect, useLayoutEffect, useCallback, useId } from 'react'
import { X, ArrowRight, ArrowLeft } from 'lucide-react'
import { Button, IconButton, Panel, cx } from './ui'

export interface TourStep {
  target?: string // data-tour do elemento alvo; ausente = passo centralizado
  title: string
  body: string
}

interface GuidedTourProps {
  steps: TourStep[]
  onClose: () => void
}

interface Rect { top: number; left: number; width: number; height: number }

const PAD = 8 // respiro do spotlight ao redor do alvo

export function GuidedTour({ steps, onClose }: GuidedTourProps) {
  const [index, setIndex] = useState(0)
  const [rect, setRect] = useState<Rect | null>(null)
  const titleId = useId()

  // Resolve o elemento alvo do passo atual (ou null se for passo centralizado / alvo ausente).
  const findTarget = useCallback((i: number): HTMLElement | null => {
    const sel = steps[i]?.target
    if (!sel) return null
    return document.querySelector<HTMLElement>(`[data-tour="${sel}"]`)
  }, [steps])

  // Avança pulando passos cujo alvo não existe no DOM (ex: HOST fora do desktop).
  const resolveFrom = useCallback((start: number, dir: 1 | -1): number => {
    let i = start
    while (i >= 0 && i < steps.length) {
      const s = steps[i]
      if (!s.target || findTarget(i)) return i
      i += dir
    }
    return -1
  }, [steps, findTarget])

  useLayoutEffect(() => {
    const el = findTarget(index)
    if (!el) { setRect(null); return }
    el.scrollIntoView({ behavior: 'auto', block: 'nearest', inline: 'nearest' })
    const measure = () => {
      const r = el.getBoundingClientRect()
      setRect({ top: r.top, left: r.left, width: r.width, height: r.height })
    }
    measure()
    const t = setTimeout(measure, 80) // re-mede após assentar o scroll
    window.addEventListener('resize', measure)
    window.addEventListener('scroll', measure, true)
    return () => {
      clearTimeout(t)
      window.removeEventListener('resize', measure)
      window.removeEventListener('scroll', measure, true)
    }
  }, [index, findTarget])

  const go = (dir: 1 | -1) => {
    const next = resolveFrom(index + dir, dir)
    if (next === -1) { onClose(); return }
    setIndex(next)
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      if (e.key === 'ArrowRight') go(1)
      if (e.key === 'ArrowLeft') go(-1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const step = steps[index]
  const isLast = resolveFrom(index + 1, 1) === -1
  const isFirst = resolveFrom(index - 1, -1) === -1

  // Posição do balão: abaixo do alvo se couber, senão acima. Centralizado se sem alvo.
  const bubble = (() => {
    if (!rect) {
      return { centered: true, style: {} as React.CSSProperties }
    }
    const vw = window.innerWidth
    const below = rect.top + rect.height + 12
    const spaceBelow = window.innerHeight - (rect.top + rect.height)
    const placeBelow = spaceBelow > 220
    const top = placeBelow ? below : Math.max(12, rect.top - 12)
    const left = Math.min(Math.max(16, rect.left + rect.width / 2 - 150), vw - 316)
    return {
      centered: false,
      style: {
        top: placeBelow ? top : undefined,
        bottom: placeBelow ? undefined : window.innerHeight - rect.top + 12,
        left,
      } as React.CSSProperties,
    }
  })()

  return (
    <div className="fixed inset-0 z-[200] font-ps-sans">
      {/* Spotlight com contorno laranja (buraco no alvo) ou escurecimento total, que fecha ao tocar */}
      {rect ? (
        <div
          data-tour-spotlight=""
          className="pointer-events-none absolute rounded-ps-lg transition-all duration-150 motion-reduce:transition-none"
          style={{
            top: rect.top - PAD,
            left: rect.left - PAD,
            width: rect.width + PAD * 2,
            height: rect.height + PAD * 2,
            boxShadow: '0 0 0 9999px rgba(0,0,0,0.72)',
            border: '2px solid var(--color-ps-or)',
          }}
        />
      ) : (
        <div data-tour-backdrop="" className="absolute inset-0 bg-black/70" onClick={onClose} />
      )}

      {/* Balão */}
      <Panel
        variant="pop"
        role="dialog"
        aria-labelledby={titleId}
        className={cx('absolute w-[300px] max-w-[calc(100vw-32px)] p-5 text-ps-bone', bubble.centered && 'left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2')}
        style={bubble.style}
      >
        <IconButton tone="ghost" aria-label="Fechar o tutorial" icon={<X size={18} />} onClick={onClose} className="absolute right-2 top-2" />

        <p className="ps-label mb-1.5">Tutorial</p>
        <h2 id={titleId} className="mb-2 pr-10 text-ps-md font-bold break-words">{step.title}</h2>
        <p className="mb-4 leading-relaxed text-ps-mut break-words">{step.body}</p>

        <div className="flex flex-wrap items-center justify-between gap-2">
          <Button tone="ghost" onClick={onClose}>Pular</Button>
          <div className="flex items-center gap-2">
            {!isFirst && <IconButton aria-label="Passo anterior" icon={<ArrowLeft size={16} />} onClick={() => go(-1)} />}
            <Button tone="primary" onClick={() => go(1)}>
              {isLast ? 'Concluir' : 'Próximo'}
              {!isLast && <ArrowRight size={16} aria-hidden="true" />}
            </Button>
          </div>
        </div>
      </Panel>
    </div>
  )
}

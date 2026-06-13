import { useState, useEffect, useLayoutEffect, useCallback } from 'react'
import { X, ArrowRight, ArrowLeft } from 'lucide-react'

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
    <div className="fixed inset-0 z-[200]">
      {/* Overlay com spotlight (buraco no alvo) ou escurecimento total */}
      {rect ? (
        <div
          className="absolute rounded-xl transition-all duration-150 pointer-events-none"
          style={{
            top: rect.top - PAD,
            left: rect.left - PAD,
            width: rect.width + PAD * 2,
            height: rect.height + PAD * 2,
            boxShadow: '0 0 0 9999px rgba(0,0,0,0.72)',
            border: '2px solid rgba(249,115,22,0.9)',
          }}
        />
      ) : (
        <div className="absolute inset-0 bg-black/72" onClick={onClose} />
      )}

      {/* Balão */}
      <div
        className={`absolute w-[300px] max-w-[90vw] bg-zinc-900 border border-orange-500/30 rounded-2xl shadow-2xl p-5 ${bubble.centered ? 'left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2' : ''}`}
        style={bubble.style}
      >
        <button onClick={onClose} className="absolute top-3 right-3 text-zinc-500 hover:text-white cursor-pointer">
          <X className="w-4 h-4" />
        </button>

        <p className="text-orange-400 text-[11px] font-bold uppercase tracking-widest mb-1.5">Tutorial</p>
        <h3 className="text-white font-bold text-lg mb-2 pr-5">{step.title}</h3>
        <p className="text-zinc-300 text-sm leading-relaxed mb-4">{step.body}</p>

        <div className="flex items-center justify-between gap-2">
          <button onClick={onClose} className="text-zinc-500 hover:text-zinc-300 text-xs cursor-pointer">
            Pular
          </button>
          <div className="flex items-center gap-2">
            {!isFirst && (
              <button onClick={() => go(-1)} className="p-2 rounded-lg bg-white/5 border border-white/10 text-zinc-300 hover:bg-white/10 cursor-pointer">
                <ArrowLeft className="w-4 h-4" />
              </button>
            )}
            <button onClick={() => go(1)} className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-orange-500 text-black font-bold text-sm hover:bg-orange-400 active:scale-95 transition-all cursor-pointer">
              {isLast ? 'Concluir' : 'Próximo'} {!isLast && <ArrowRight className="w-4 h-4" />}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

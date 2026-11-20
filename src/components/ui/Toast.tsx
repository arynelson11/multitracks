import { useEffect, useLayoutEffect, useRef } from 'react'
import type React from 'react'
import { Notice } from './Notice'
import type { NoticeTone } from './Notice'
import { cx } from './cx'

export interface ToastProps {
  open: boolean
  /** Chamado quando o tempo acaba (ou quando a música começa com o aviso aberto). */
  onClose(): void
  children: React.ReactNode
  /** Milissegundos na tela. Padrão: 2,5 s. */
  duration?: number
  /** Música tocando ou na pré-contagem: o aviso não aparece por cima e é descartado (onClose na hora). */
  playing?: boolean
  tone?: NoticeTone
  className?: string
}

/**
 * Aviso curto que some sozinho, no topo da tela, sem puxar o foco e sem bloquear o toque no que
 * está embaixo. A região `role="status"` fica sempre na página (vazia quando fechado), pra o leitor
 * de tela anunciar quando o texto entra.
 */
export function Toast({ open, onClose, children, duration = 2500, playing = false, tone = 'info', className }: ToastProps) {
  const closeRef = useRef(onClose)
  useLayoutEffect(() => { closeRef.current = onClose })

  useEffect(() => {
    if (!open) return
    if (playing) {
      closeRef.current()
      return
    }
    const timer = setTimeout(() => closeRef.current(), duration)
    return () => clearTimeout(timer)
  }, [open, playing, duration])

  return (
    <div role="status" aria-live="polite" className={cx('pointer-events-none fixed inset-x-0 top-ps-gutter z-[130] flex justify-center px-ps-gutter', className)}>
      {open && !playing && (
        <Notice tone={tone} className="max-w-md shadow-ps-pop transition-[opacity,translate] duration-200 starting:-translate-y-2 starting:opacity-0 motion-reduce:transition-none">
          {children}
        </Notice>
      )}
    </div>
  )
}

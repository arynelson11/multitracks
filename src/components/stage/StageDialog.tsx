// Janela por cima no estilo do palco (tela de limite do Livre e as próximas): título, conteúdo
// que rola dentro e rodapé com as ações. Modal de verdade: o foco fica preso nela e nenhuma tecla
// chega aos atalhos do palco por baixo. É o lugar das telas novas que antes seriam window.alert ou
// window.confirm (o app de computador roda de file:// no Electron).
import { useId, useLayoutEffect, useRef } from 'react'
import type React from 'react'
import { Panel, cx } from '../ui'
import { Icon } from './icons'

export interface StageDialogProps {
  open: boolean
  title: string
  onClose(): void
  children: React.ReactNode
  /** Ações no pé da janela, fora da rolagem (Button de `src/components/ui`). */
  footer?: React.ReactNode
  /** `md` (padrão, até 512 px) ou `sm` (até 384 px). */
  size?: 'sm' | 'md'
}

const SIZES: Record<NonNullable<StageDialogProps['size']>, string> = { sm: 'max-w-sm', md: 'max-w-lg' }

// O que pode receber foco dentro da janela, inclusive o que quem chama põe no conteúdo.
const FOCUSABLE = 'a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])'

const CLOSE_BTN =
  'inline-flex shrink-0 items-center justify-center min-h-ps-touch min-w-ps-touch rounded-ps-md bg-ps-s2 text-ps-mut hover:text-ps-bone select-none transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ps-or'

function focusables(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.tabIndex >= 0 && !el.hasAttribute('disabled'))
}

/**
 * Janela do palco. Abre com o foco no primeiro elemento focável (o Fechar, no canto); Tab e
 * Shift+Tab giram dentro; ao fechar (ou sair do ar aberta), o foco volta pra quem abriu.
 * Esc fecha e é tratado na captura da `window`, antes da pilha dos painéis do palco (um
 * REPERTÓRIOS aberto por baixo continua aberto) e dos atalhos. Toque fora fecha; toque dentro,
 * ou apertar dentro e soltar fora, não. Fechada não renderiza nada.
 */
export function StageDialog({ open, title, onClose, children, footer, size = 'md' }: StageDialogProps) {
  const titleId = useId()
  const overlayRef = useRef<HTMLDivElement>(null)
  const closeRef = useRef(onClose)
  // Apertou dentro da caixa: o clique que cai na camada de fora (ancestral comum) não fecha.
  const pressedInside = useRef(false)
  useLayoutEffect(() => { closeRef.current = onClose })

  useLayoutEffect(() => {
    if (!open) return
    const overlay = overlayRef.current
    if (!overlay) return
    const active = document.activeElement
    // Foco que já está dentro da janela não é de quem abriu.
    const opener = active instanceof HTMLElement && !overlay.contains(active) ? active : null
    focusables(overlay)[0]?.focus({ preventScroll: true })

    const onEscape = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.isComposing) return
      e.preventDefault()
      e.stopPropagation()
      closeRef.current()
    }
    window.addEventListener('keydown', onEscape, true)
    return () => {
      window.removeEventListener('keydown', onEscape, true)
      // Fechada pelo `open`, a caixa já saiu da página (foco perdido); desmontada aberta, o foco
      // ainda está nela. Nos dois casos volta pra quem abriu; foco que já foi pra outro lugar fica.
      const now = document.activeElement
      const lost = !now || now === document.body || !now.isConnected || overlay.contains(now)
      if (lost && opener?.isConnected) opener.focus({ preventScroll: true })
    }
  }, [open])

  if (!open) return null

  // Modal: o Tab não sai da janela e nenhuma tecla chega aos atalhos do palco (Espaço toca, setas pulam).
  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    e.stopPropagation()
    if (e.key !== 'Tab') return
    const items = focusables(e.currentTarget)
    if (items.length === 0) return
    const first = items[0]
    const last = items[items.length - 1]
    const now = document.activeElement
    const outside = !(now instanceof HTMLElement) || !items.includes(now)
    if (e.shiftKey ? now === first || outside : now === last || outside) {
      e.preventDefault()
      ;(e.shiftKey ? last : first).focus()
    }
  }

  return (
    <div
      ref={overlayRef}
      onKeyDown={onKeyDown}
      onPointerDown={(e) => { pressedInside.current = e.target !== e.currentTarget }}
      onClick={(e) => {
        const inside = pressedInside.current
        pressedInside.current = false
        if (e.target === e.currentTarget && !inside) onClose()
      }}
      className="fixed inset-0 z-[120] flex items-center justify-center bg-black/60 p-ps-gutter"
    >
      {/* tabIndex -1: um clique no texto deixa o foco na caixa, dentro da janela. */}
      <Panel
        variant="pop"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={cx('flex max-h-full w-full flex-col gap-4 p-5 font-ps-sans text-ps-bone outline-none', SIZES[size])}
      >
        <div className="flex shrink-0 items-center gap-3">
          <h2 id={titleId} className="min-w-0 flex-1 break-words text-ps-md font-bold">{title}</h2>
          <button type="button" aria-label="Fechar" title="Fechar (Esc)" onClick={onClose} className={CLOSE_BTN}>
            <Icon name="x" />
          </button>
        </div>
        {/* -m-1 p-1: a rolagem não corta o anel de foco de quem encosta na borda. */}
        <div className="-m-1 min-h-0 overflow-y-auto p-1 text-ps-base break-words">{children}</div>
        {footer ? <div className="flex shrink-0 flex-wrap justify-end gap-2">{footer}</div> : null}
      </Panel>
    </div>
  )
}

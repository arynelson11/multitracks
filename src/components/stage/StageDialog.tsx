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
  /** `md` (padrão, até 512 px), `sm` (até 384 px) ou `lg` (até 672 px, letra e cifra). */
  size?: 'sm' | 'md' | 'lg'
}

const SIZES: Record<NonNullable<StageDialogProps['size']>, string> = { sm: 'max-w-sm', md: 'max-w-lg', lg: 'max-w-2xl' }

/**
 * Pilha das janelas abertas: só a de cima reage ao Esc e ao toque fora. A de cima é a aberta por
 * último; uma janela aberta dentro de outra fica por cima dela (mesmo abrindo juntas). Cada janela
 * que abre com outra já aberta sobe um degrau acima da mais alta (a primeira fica no z-[120] da
 * classe), então a de cima é também a que aparece por cima, venha antes ou depois no código.
 */
const BASE_Z = 120

interface OpenDialog {
  el: HTMLElement
  z: number
  /** Quem tinha o foco quando a janela abriu (fora dela). */
  opener: HTMLElement | null
  /** O Esc e o toque fora fecham agora? (lido na hora, da prop mais nova) */
  dismissible(): boolean
  close(): void
}

const openDialogs: OpenDialog[] = []

function topDialog(): OpenDialog | undefined {
  let top: OpenDialog | undefined
  for (const d of openDialogs) {
    if (openDialogs.some((o) => o !== d && d.el.contains(o.el))) continue
    if (!top || d.z > top.z) top = d
  }
  return top
}

function isTopDialog(el: HTMLElement): boolean {
  return topDialog()?.el === el
}

/**
 * Um ouvinte só pra pilha inteira, na captura da `window`. Com um ouvinte por janela, um Esc de
 * verdade fechava duas: o navegador roda as microtarefas entre um ouvinte e outro, o React aplica o
 * fechar da de cima nesse meio e a de baixo, já sozinha na pilha, recebia o mesmo Esc.
 */
function onStackEscape(e: KeyboardEvent): void {
  if (e.key !== 'Escape' || e.isComposing) return
  const top = topDialog()
  if (!top) return
  // Tratado aqui: os painéis do palco e o atalho da casca ignoram evento com defaultPrevented.
  e.preventDefault()
  // Janela que não fecha no Esc (texto digitado, gerando): o Esc segue pra dentro dela (cancelar
  // uma edição na linha, por exemplo) e para na caixa, sem chegar ao palco.
  if (!top.dismissible()) return
  e.stopPropagation()
  top.close()
}

function pushDialog(d: OpenDialog): void {
  if (openDialogs.length === 0) window.addEventListener('keydown', onStackEscape, true)
  openDialogs.push(d)
}

function removeDialog(d: OpenDialog): void {
  const i = openDialogs.indexOf(d)
  if (i >= 0) openDialogs.splice(i, 1)
  if (openDialogs.length === 0) window.removeEventListener('keydown', onStackEscape, true)
}

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
 * ou apertar dentro e soltar fora, não. Com duas janelas abertas, Esc e toque fora valem só pra
 * de cima (Parte 3). Fechada não renderiza nada.
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
    // Quem abriu: o foco de agora, se está fora. Foco já dentro é de uma janela de dentro que abriu
    // junto (o efeito dela roda antes): quem abriu as duas é quem abriu aquela.
    let opener: HTMLElement | null = null
    if (active instanceof HTMLElement) {
      opener = overlay.contains(active)
        ? (openDialogs.find((d) => overlay.contains(d.el) && d.el.contains(active))?.opener ?? null)
        : active
    }

    // Empilha antes de focar: só a de cima pega o foco (abrindo junto com uma de dentro, ele fica na de dentro).
    const entry: OpenDialog = {
      el: overlay,
      z: openDialogs.reduce((m, d) => Math.max(m, d.z + 1), BASE_Z),
      opener,
      dismissible: () => true,
      close: () => closeRef.current(),
    }
    if (entry.z !== BASE_Z) overlay.style.zIndex = String(entry.z)
    pushDialog(entry)
    if (topDialog() === entry) focusables(overlay)[0]?.focus({ preventScroll: true })

    return () => {
      removeDialog(entry)
      // Fechada pelo `open`, a caixa já saiu da página (foco perdido); desmontada aberta, o foco
      // ainda está nela. Foco que já foi pra outro lugar fica.
      const now = document.activeElement
      const lost = !now || now === document.body || !now.isConnected || overlay.contains(now)
      if (!lost) return
      // Outra janela continua aberta (a de fora, ou a de baixo): o foco vai pra ela, em quem abriu
      // esta se estiver nela, senão no primeiro focável dela. Senão, volta pra quem abriu.
      const top = topDialog()
      if (top && !(opener?.isConnected && top.el.contains(opener))) {
        const target = focusables(top.el)[0] ?? top.el.querySelector<HTMLElement>('[role="dialog"]')
        target?.focus({ preventScroll: true })
        return
      }
      if (opener?.isConnected) opener.focus({ preventScroll: true })
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
        if (e.target === e.currentTarget && !inside && isTopDialog(e.currentTarget)) onClose()
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

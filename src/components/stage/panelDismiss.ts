// O que os painéis do palco (REPERTÓRIOS, pads) e as ações de dois toques dividem: a pilha do Esc,
// o foco de abrir e fechar e o aviso "uma ação de dois toques armada por vez".
import { useEffect, useLayoutEffect, useRef } from 'react'
import type { RefObject } from 'react'

/** Evento no `document` de quem acabou de armar uma ação de dois toques (detail = id de quem armou). */
export const TWO_TAP_ARM_EVENT = 'ps-two-tap-arm'

/** Marca de quem está armado (lixeira, Novo): `data-armed="true"`. O Esc do painel só desarma. */
export const ARMED_SELECTOR = '[data-armed="true"]'

interface OpenPanel { close(): void; element(): HTMLElement | null }

// Painéis abertos, na ordem em que abriram. Só o de cima trata o Esc.
const stack: OpenPanel[] = []

function onEscape(e: KeyboardEvent): void {
  if (e.key !== 'Escape' || e.defaultPrevented) return
  const top = stack[stack.length - 1]
  if (!top) return
  // Tratado aqui: o atalho global da casca (cancelar o pulo) ignora evento com defaultPrevented.
  e.preventDefault()
  // Algo armado dentro do painel: esse Esc só desarma (o useTwoTapConfirm escuta a window).
  if (top.element()?.querySelector(ARMED_SELECTOR)) return
  top.close()
}

function push(p: OpenPanel): void {
  // Na CAPTURA: o Esc chega aqui antes de qualquer peça de dentro parar a propagação.
  if (stack.length === 0) document.addEventListener('keydown', onEscape, true)
  stack.push(p)
}

function remove(p: OpenPanel): void {
  const i = stack.indexOf(p)
  if (i >= 0) stack.splice(i, 1)
  if (stack.length === 0) document.removeEventListener('keydown', onEscape, true)
}

/**
 * Esc e foco de um painel do palco. Ao abrir, o painel entra no topo da pilha e recebe o foco;
 * o Esc fecha sempre o aberto por último (com algo armado dentro, só desarma). Ao fechar, sai da
 * pilha e, se o foco estava nele ou se perdeu, volta pra quem tinha o foco quando ele abriu.
 * A ordem vem da abertura: renderizar de novo, com `onClose` estável ou em arrow, não mexe nela.
 */
export function usePanelDismiss(open: boolean, onClose: () => void, panelRef: RefObject<HTMLElement | null>): void {
  const closeRef = useRef(onClose)
  const openerRef = useRef<HTMLElement | null>(null)
  useLayoutEffect(() => { closeRef.current = onClose })

  useLayoutEffect(() => {
    if (!open) return
    const panel = panelRef.current
    const active = document.activeElement
    // No StrictMode o efeito roda duas vezes e, na segunda, o foco já está no painel: fica quem abriu de verdade.
    if (active instanceof HTMLElement && !panel?.contains(active)) openerRef.current = active
    const entry: OpenPanel = { close: () => closeRef.current(), element: () => panelRef.current }
    push(entry)
    panel?.focus({ preventScroll: true })
    return () => {
      remove(entry)
      const now = document.activeElement
      const lost = !now || now === document.body || !now.isConnected
      const opener = openerRef.current
      if (lost && opener?.isConnected) opener.focus({ preventScroll: true })
    }
  }, [open, panelRef])
}

/**
 * Uma ação de dois toques armada por vez: quem arma avisa pelo TWO_TAP_ARM_EVENT e as outras
 * desarmam. `id` é único por ação (useId).
 */
export function useExclusiveArm(armed: boolean, id: string, disarm: () => void): void {
  useEffect(() => {
    if (!armed) return
    document.dispatchEvent(new CustomEvent(TWO_TAP_ARM_EVENT, { detail: id }))
    const onOtherArmed = (e: Event) => { if ((e as CustomEvent<string>).detail !== id) disarm() }
    document.addEventListener(TWO_TAP_ARM_EVENT, onOtherArmed)
    return () => document.removeEventListener(TWO_TAP_ARM_EVENT, onOtherArmed)
  }, [armed, id, disarm])
}

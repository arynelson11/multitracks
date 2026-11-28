// O foco de um botão que desliga dentro de uma janela do palco (manutenção 2026-11-27: revisão das
// telas, I1, e re-revisão, N1). No Chromium o botão focado que fica desligado perde o foco pro body:
// o Tab sai pra trás da janela e as teclas chegam ao palco antigo. Usado pelos pads da nuvem e pela
// letra e cifra.
import { useEffect, useRef, type RefObject } from 'react'

/** A janela do palco (`[role="dialog"]`) em volta de um elemento do conteúdo dela. */
export function dialogOf(el: HTMLElement | null): HTMLElement | null {
  return el?.closest<HTMLElement>('[role="dialog"]') ?? null
}

/**
 * `contentRef`: um elemento do conteúdo da janela. `busy`: o botão está desligado (enviando, salvando,
 * buscando). `hold()`, no começo, leva pra janela o foco que está num botão dela (o campo de texto
 * fica com o dele). `release(alvo)`, antes de `busy` voltar a falso, pede o foco de volta pro botão
 * `[data-send="alvo"]` (ou pra janela, se ele estiver desligado ou o alvo for 'dialog'). O pedido vale
 * depois da renderização em que o botão religa, e só se o foco estiver perdido (body, nenhum) ou na
 * própria janela: quem foi pro campo de texto ou pra outra janela por cima fica onde está. Janela
 * fechada no meio: nada a focar.
 */
export function useBusyFocus(contentRef: RefObject<HTMLElement | null>, busy: boolean) {
  const pending = useRef<string | null>(null)
  useEffect(() => {
    const target = pending.current
    if (busy || !target) return
    pending.current = null
    const dialog = dialogOf(contentRef.current)
    if (!dialog) return
    const active = document.activeElement
    if (active && active !== document.body && active !== dialog) return
    const button = target === 'dialog' ? null : dialog.querySelector<HTMLButtonElement>(`[data-send="${target}"]`)
    if (button && !button.disabled) button.focus({ preventScroll: true })
    else dialog.focus({ preventScroll: true })
  }, [busy, contentRef])
  return {
    hold(): void {
      const dialog = dialogOf(contentRef.current)
      const active = document.activeElement
      if (dialog && active instanceof HTMLButtonElement && dialog.contains(active)) dialog.focus({ preventScroll: true })
    },
    release(target: string): void {
      pending.current = target
    },
  }
}

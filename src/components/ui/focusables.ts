// O que pode receber foco pelo Tab dentro de uma janela (a do palco e as Configurações), inclusive o
// que quem chama põe no conteúdo. Desligado e tabindex -1 ficam de fora.
const FOCUSABLE = 'a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])'

export function focusables(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.tabIndex >= 0 && !el.hasAttribute('disabled'))
}

/**
 * Tab e Shift+Tab girando dentro de `root` (no keydown dela): do último volta pro primeiro, do
 * primeiro vai pro último, e foco fora da lista (na própria caixa) entra pela ponta certa.
 */
export function trapTab(e: { key: string; shiftKey: boolean; preventDefault(): void }, root: HTMLElement): void {
  if (e.key !== 'Tab') return
  const items = focusables(root)
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

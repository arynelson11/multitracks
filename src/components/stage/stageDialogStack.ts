// Pilha das janelas do palco (StageDialog) abertas, fora do componente pra quem tem Esc próprio
// (as Configurações) perguntar se há uma aberta por cima (`hasOpenStageDialog`).

/**
 * Pilha das janelas abertas: só a de cima reage ao Esc e ao toque fora. A de cima é a aberta por
 * último; uma janela aberta dentro de outra fica por cima dela (mesmo abrindo juntas). Cada janela
 * que abre com outra já aberta sobe um degrau acima da mais alta (a primeira fica no z-[120] da
 * classe), então a de cima é também a que aparece por cima, venha antes ou depois no código.
 */
export const BASE_Z = 120

export interface OpenDialog {
  el: HTMLElement
  z: number
  /** Quem tinha o foco quando a janela abriu (fora dela). */
  opener: HTMLElement | null
  /** O Esc e o toque fora fecham agora? (lido na hora, da prop mais nova) */
  dismissible(): boolean
  close(): void
}

export const openDialogs: OpenDialog[] = []

/** Há janela do palco aberta? Quem trata o Esc por conta própria deixa ele pra pilha. */
export function hasOpenStageDialog(): boolean {
  return openDialogs.length > 0
}

export function topDialog(): OpenDialog | undefined {
  let top: OpenDialog | undefined
  for (const d of openDialogs) {
    if (openDialogs.some((o) => o !== d && d.el.contains(o.el))) continue
    if (!top || d.z > top.z) top = d
  }
  return top
}

export function isTopDialog(el: HTMLElement): boolean {
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

export function pushDialog(d: OpenDialog): void {
  if (openDialogs.length === 0) window.addEventListener('keydown', onStackEscape, true)
  openDialogs.push(d)
}

export function removeDialog(d: OpenDialog): void {
  const i = openDialogs.indexOf(d)
  if (i >= 0) openDialogs.splice(i, 1)
  if (openDialogs.length === 0) window.removeEventListener('keydown', onStackEscape, true)
}

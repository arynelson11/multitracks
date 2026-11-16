// Atalhos de teclado do palco novo e a regra de tamanho de tela. Puro: sem React e sem DOM (quem
// lê o evento, o foco e chama as ações é o useStageShortcuts).
import { SECTION_SHORTCUTS } from '../../lib/sectionTypes'

/** O que uma tecla faz no palco. `tapSection.index` é a posição na lista de seções (tecla 1 = primeira). */
export type StageKeyAction =
  | { kind: 'togglePlay' } | { kind: 'tapSection'; index: number } | { kind: 'stepSection'; dir: -1 | 1 } | { kind: 'seekBy'; dt: number }
  | { kind: 'escape' } | { kind: 'toggleLoop' } | { kind: 'mark'; label: string }

/** O que interessa do evento de teclado: a tecla, os modificadores e quem estava com o foco. */
export interface StageKeyEvent {
  code: string; key: string; shiftKey: boolean; metaKey: boolean; ctrlKey: boolean; altKey: boolean; repeat: boolean; defaultPrevented: boolean
  /** Tag de quem recebeu a tecla, em maiúsculas ('INPUT', 'BUTTON', 'BODY'...). */
  targetTag?: string
  /** Quem recebeu a tecla é editável (contentEditable). */
  targetEditable?: boolean
  /** `role` de quem recebeu a tecla ('slider', 'tab', 'button'...), quando tem. */
  targetRole?: string
}

/** Largura e altura mínimas do palco novo; abaixo disso vale o palco antigo inteiro (R-25). */
export const STAGE_MIN_WIDTH = 1024
export const STAGE_MIN_HEIGHT = 600

/** Cabe o palco novo: pelo menos 1024 x 600. */
export function isWideStage(width: number, height: number): boolean {
  return width >= STAGE_MIN_WIDTH && height >= STAGE_MIN_HEIGHT
}

/** Passo do Shift + seta, em segundos da música. */
const SEEK_STEP = 5

/** Campos de texto: ficam com todas as teclas. */
const TEXT_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT'])
const TEXT_ROLES = new Set(['textbox', 'searchbox', 'combobox', 'spinbutton'])
/** Quem aperta no Espaço (o navegador clica no botão com o foco). */
const SPACE_TAGS = new Set(['BUTTON', 'SUMMARY'])
const SPACE_ROLES = new Set(['button', 'tab', 'radio', 'checkbox', 'switch', 'menuitem', 'menuitemradio', 'menuitemcheckbox', 'option'])
/** Quem anda com as setas (volume, abas, opções do seletor, listas). */
const ARROW_ROLES = new Set([
  'slider', 'scrollbar', 'tab', 'tablist', 'radio', 'radiogroup', 'menuitem', 'menuitemradio', 'menuitemcheckbox', 'menu', 'menubar',
  'option', 'listbox', 'treeitem', 'tree', 'gridcell', 'grid', 'separator',
])

/** Ação da tecla, sem olhar quem tem o foco. */
function keyAction(e: StageKeyEvent, ctx: { editMode: boolean; sectionCount: number }): StageKeyAction | null {
  if (e.code === 'Space') return { kind: 'togglePlay' }
  const digit = /^(?:Digit|Numpad)([1-9])$/.exec(e.code)
  if (digit) {
    const index = Number(digit[1]) - 1
    return index < ctx.sectionCount ? { kind: 'tapSection', index } : null
  }
  if (e.code === 'ArrowLeft' || e.code === 'ArrowRight') {
    const dir = e.code === 'ArrowLeft' ? -1 : 1
    return e.shiftKey ? { kind: 'seekBy', dt: dir * SEEK_STEP } : { kind: 'stepSection', dir }
  }
  if (e.code === 'Escape' || e.key === 'Escape') return { kind: 'escape' }
  if (e.code === 'KeyL') return { kind: 'toggleLoop' }
  if (ctx.editMode) {
    const mark = SECTION_SHORTCUTS.find((s) => s.code === e.code)
    if (mark) return { kind: 'mark', label: mark.name }
  }
  return null
}

/** O controle com o foco usa essa tecla ele mesmo (Ruling T18-atalho)? */
function ownedByTarget(action: StageKeyAction, e: StageKeyEvent): boolean {
  const tag = e.targetTag?.toUpperCase() ?? ''
  const role = e.targetRole?.trim().toLowerCase() ?? ''
  if (action.kind === 'togglePlay') return SPACE_TAGS.has(tag) || SPACE_ROLES.has(role)
  if (action.kind === 'stepSection' || action.kind === 'seekBy') return ARROW_ROLES.has(role)
  return false
}

/**
 * Atalhos do palco: Espaço toca ou pausa; 1 a 9 armam a seção daquela posição (se existe); ← e →
 * armam a seção anterior e a seguinte; Shift + ← e → andam 5 s; Esc (quem decide o que fecha ou
 * cancela é a casca); L liga o loop; I V P R B F marcam a seção, só no modo EDITAR.
 *
 * Ignora: evento já tratado (`defaultPrevented`: painéis e diálogos tratam o próprio Esc na
 * captura, e os controles do palco marcam as teclas que usam), Meta, Ctrl e Alt (atalhos do
 * sistema), campo de texto (INPUT, TEXTAREA, SELECT, contentEditable e os papéis de texto) e
 * tecla segurada no Espaço, nos números, no L e nas letras de marcar.
 *
 * Ruling T18-atalho: o controle com o foco fica com as teclas que ele usa, mesmo sem marcar o
 * evento. Controle deslizante, aba, opção do seletor e lista ficam com as setas; botão, aba,
 * opção e caixa de marcar ficam com o Espaço (o navegador aperta o botão). As outras teclas
 * continuam valendo: no Chrome e no app do computador o botão tocado fica com o foco, e sem isso
 * nenhum atalho funcionaria depois de um toque na tela.
 */
export function stageKeyAction(e: StageKeyEvent, ctx: { editMode: boolean; sectionCount: number }): StageKeyAction | null {
  if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return null
  const tag = e.targetTag?.toUpperCase() ?? ''
  const role = e.targetRole?.trim().toLowerCase() ?? ''
  if (TEXT_TAGS.has(tag) || e.targetEditable === true || TEXT_ROLES.has(role)) return null
  const action = keyAction(e, ctx)
  if (!action || ownedByTarget(action, e)) return null
  const once = action.kind === 'togglePlay' || action.kind === 'tapSection' || action.kind === 'toggleLoop' || action.kind === 'mark'
  return once && e.repeat ? null : action
}

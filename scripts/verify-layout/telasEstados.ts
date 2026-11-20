// Estados das demais telas da Parte 3 (faixa C) no verificador: uma janela ou página por estado,
// montada em telas.tsx, com o que conferir e o que abrir antes de medir. O run.mjs tem a mesma lista.
export const TELA_ESTADOS = ['metronomo'] as const
export type TelaEstado = (typeof TELA_ESTADOS)[number]

export function isTela(value: string): value is TelaEstado {
  return (TELA_ESTADOS as readonly string[]).includes(value)
}

/** O que tem de estar na tela em cada estado: sem isso a medida passaria sem medir a tela. */
export const TELA_EXPECT: Record<TelaEstado, { sel: string; text?: string }> = {
  metronomo: { sel: '[role="dialog"] [role="switch"]' },
}

/** Toque de ponteiro (click com detail 1), como o dedo. */
export function tapTela(selector: string): void {
  const el = document.querySelector<HTMLElement>(selector)
  if (!el) throw new Error(`não achei ${selector} pra abrir`)
  el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 1 }))
}

/** O que abrir depois de montar (abas, edição, ajuda). */
export const TELA_PREPARE: Partial<Record<TelaEstado, () => void>> = {}

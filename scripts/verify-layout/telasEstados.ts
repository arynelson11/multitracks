// Estados das demais telas da Parte 3 (faixa C) no verificador: uma janela ou página por estado,
// montada em telas.tsx, com o que conferir e o que abrir antes de medir. O run.mjs tem a mesma lista.
export const TELA_ESTADOS = ['metronomo', 'padsnuvem', 'padsnuvem-editar', 'letra', 'cifra', 'teleprompter', 'teleprompter-vazio'] as const
export type TelaEstado = (typeof TELA_ESTADOS)[number]

export function isTela(value: string): value is TelaEstado {
  return (TELA_ESTADOS as readonly string[]).includes(value)
}

/** O que tem de estar na tela em cada estado: sem isso a medida passaria sem medir a tela. */
export const TELA_EXPECT: Record<TelaEstado, { sel: string; text?: string }> = {
  metronomo: { sel: '[role="dialog"] [role="switch"]' },
  padsnuvem: { sel: '[role="dialog"] [aria-current="true"]' },
  'padsnuvem-editar': { sel: '[role="dialog"] input[placeholder="Nome do conjunto"]' },
  letra: { sel: '[role="dialog"] [role="tab"][aria-selected="true"]', text: 'Letra' },
  cifra: { sel: '[role="dialog"] [role="tab"][aria-selected="true"]', text: 'Cifra' },
  teleprompter: { sel: 'h1' },
  'teleprompter-vazio': { sel: '[role="progressbar"]' },
}

/** Toque de ponteiro (click com detail 1), como o dedo. */
export function tapTela(selector: string): void {
  const el = document.querySelector<HTMLElement>(selector)
  if (!el) throw new Error(`não achei ${selector} pra abrir`)
  el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 1 }))
}

/** O que abrir depois de montar (abas, edição, ajuda). */
export const TELA_PREPARE: Partial<Record<TelaEstado, () => void | Promise<void>>> = {
  // A lista vem do fetch: espera o primeiro Renomear aparecer e toca nele.
  'padsnuvem-editar': async () => {
    for (let i = 0; i < 50 && !document.querySelector('button[aria-label^="Renomear"]'); i++) await new Promise((r) => setTimeout(r, 50))
    tapTela('button[aria-label^="Renomear"]')
  },
  cifra: () => tapTela('[role="dialog"] [role="tab"]:nth-child(2)'),
}

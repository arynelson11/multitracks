// Estados das demais telas da Parte 3 (faixa C) no verificador: uma janela ou página por estado,
// montada em telas.tsx, com o que conferir e o que abrir antes de medir. O run.mjs tem a mesma lista.
export const TELA_ESTADOS = ['metronomo', 'padsnuvem', 'padsnuvem-editar', 'letra', 'cifra', 'teleprompter', 'teleprompter-vazio', 'novidades', 'atualizacao', 'atualizacao-web', 'tour', 'tour-centro', 'download', 'download-ajuda', 'download-celular', 'aovivo', 'aovivo-cheio', 'aovivo-erro', 'adminlogin',
  // Separador (Parte 3, faixa D): vistas soltas, em pages.tsx.
  'separador-inicio', 'separador-opcoes', 'separador-player',
  // As janelas do Separador de reserva, uma por vez por cima do player (revisão sep-2 I5).
  'separador-bpm', 'separador-voz', 'separador-publicar',
  // Biblioteca na Nuvem (Parte 3, partes 3 a 5): a vista solta, em pages.tsx.
  'biblioteca', 'biblioteca-editar'] as const
export type TelaEstado = (typeof TELA_ESTADOS)[number]

export function isTela(value: string): value is TelaEstado {
  return (TELA_ESTADOS as readonly string[]).includes(value)
}

/** O que tem de estar na tela em cada estado: sem isso a medida passaria sem medir a tela. */
export const TELA_EXPECT: Record<TelaEstado, { sel: string; text?: string; count?: number }> = {
  metronomo: { sel: '[role="dialog"] [role="switch"]' },
  padsnuvem: { sel: '[role="dialog"] [aria-current="true"]' },
  'padsnuvem-editar': { sel: '[role="dialog"] input[placeholder="Nome do conjunto"]' },
  letra: { sel: '[role="dialog"] [role="tab"][aria-selected="true"]', text: 'Letra' },
  cifra: { sel: '[role="dialog"] [role="tab"][aria-selected="true"]', text: 'Cifra' },
  teleprompter: { sel: 'h1' },
  'teleprompter-vazio': { sel: '[role="progressbar"]' },
  novidades: { sel: '[role="dialog"] li' },
  atualizacao: { sel: '[role="status"] button' },
  'atualizacao-web': { sel: '[role="status"] button', text: 'Atualizar' },
  tour: { sel: '[data-tour-spotlight]' },
  'tour-centro': { sel: '[data-tour-backdrop]' },
  download: { sel: 'main#conteudo [data-feature]' },
  'download-ajuda': { sel: 'main#conteudo code' },
  // O ramo do celular: o guia de instalar do iPhone (o primeiro passo é o Compartilhar; no
  // computador o primeiro passo é o da câmera, sem negrito).
  'download-celular': { sel: 'main#conteudo ol li:first-child strong', text: 'Compartilhar' },
  aovivo: { sel: '[role="dialog"] li [aria-pressed="true"]' },
  'aovivo-cheio': { sel: '[role="dialog"] li:nth-child(6) [aria-pressed]' },
  'aovivo-erro': { sel: '[role="dialog"] [role="alert"]' },
  adminlogin: { sel: 'form input[type="password"]' },
  'separador-inicio': { sel: '[data-separator-home] [data-separation-id="v6"]' },
  'separador-opcoes': { sel: '[data-separator-options] section button', text: 'Vocais, Instrumental2 faixas' },
  'separador-player': { sel: '[data-separator-player] [data-track-strip]:nth-of-type(8) button[data-touch-exception="ms"]', text: 'M' },
  'separador-bpm': { sel: '[role="dialog"] button[aria-label="Mover o 1 um tempo pra frente"]' },
  'separador-voz': { sel: '[role="dialog"] [data-cue-row]' },
  'separador-publicar': { sel: '[role="dialog"] [data-cloud-form] [role="switch"]' },
  biblioteca: { sel: '[role="dialog"] [data-library] [data-library-row]', count: 8 },
  'biblioteca-editar': { sel: '[role="dialog"] [data-library-edit="b1"] input[inputmode="decimal"]' },
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
  'download-ajuda': () => tapTela('button[aria-label="Como instalar no Mac"]'),
}

// Estados das telas da faixa B da Parte 3 no verificador de layout (login, Criar nova senha e as
// Configurações em cada aba): a lista, o que abrir depois de montar e o que conferir. A página
// em si fica em TelasBPage.tsx. Nada daqui entra no app.

export const ESTADOS_B = [
  'login', 'criarconta', 'recuperar', 'novasenha',
  'config-perfil', 'config-geral', 'config-buses', 'config-novidades', 'config-assinatura', 'config-sobre',
] as const
export type EstadoB = (typeof ESTADOS_B)[number]

export function parseEstadoB(value: string | null): EstadoB | null {
  return (ESTADOS_B as readonly string[]).includes(value ?? '') ? (value as EstadoB) : null
}


const TAB: Partial<Record<EstadoB, string>> = {
  'config-geral': 'Geral', 'config-buses': 'Buses', 'config-novidades': 'Novidades', 'config-assinatura': 'Assinatura', 'config-sobre': 'Sobre',
}

/** Clique de ponteiro no botão que tem este texto (a troca de modo do login, a aba das Configurações). */
function tapByText(selector: string, text: string): void {
  const el = Array.from(document.querySelectorAll<HTMLElement>(selector)).find((b) => b.textContent?.trim() === text)
  if (!el) throw new Error(`não achei ${selector} "${text}" pra abrir`)
  el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 1 }))
}

export function prepareB(estado: EstadoB): (() => void) | undefined {
  if (estado === 'criarconta') return () => tapByText('button', 'Criar conta')
  if (estado === 'recuperar') return () => tapByText('button', 'Esqueceu sua senha?')
  const tab = TAB[estado]
  return tab ? () => tapByText('[role="tab"]', tab) : undefined
}

/** O estado montou? Senão a combinação sai como erro, nunca como aprovada. */
export function expectB(estado: EstadoB): void {
  const want: Record<EstadoB, [string, string]> = {
    login: ['h2', 'Entrar'],
    criarconta: ['h2', 'Criar conta'],
    recuperar: ['h2', 'Recuperar senha'],
    novasenha: ['h1', 'Criar nova senha'],
    'config-perfil': ['[role="tab"][aria-selected="true"]', 'Perfil'],
    'config-geral': ['[role="tab"][aria-selected="true"]', 'Geral'],
    'config-buses': ['[role="tab"][aria-selected="true"]', 'Buses'],
    'config-novidades': ['[role="tab"][aria-selected="true"]', 'Novidades'],
    'config-assinatura': ['[role="tab"][aria-selected="true"]', 'Assinatura'],
    'config-sobre': ['[role="tab"][aria-selected="true"]', 'Sobre'],
  }
  const [sel, text] = want[estado]
  const el = document.querySelector(sel)
  if (!el) throw new Error(`estado ${estado} não montou: falta ${sel}`)
  if (el.textContent?.trim() !== text) throw new Error(`estado ${estado}: ${sel} mostra "${el.textContent ?? ''}", esperado "${text}"`)
  if (estado.startsWith('config-') && !document.querySelector('[role="tabpanel"]')?.textContent?.trim()) throw new Error(`estado ${estado}: aba vazia`)
}

// Escritas diretas no DOM das peças do palco, feitas a cada quadro (useFrame) sem renderizar o
// React. Só escrevem quando o valor muda: nada de mutação à toa, nem anúncio repetido.

/** Marca `data-<name>` com "true" ou "false". */
export function setFlag(el: HTMLElement, name: string, on: boolean): void {
  const v = on ? 'true' : 'false'
  if (el.dataset[name] !== v) el.dataset[name] = v
}

/** Troca o texto do elemento. */
export function setText(el: HTMLElement, text: string): void {
  if (el.textContent !== text) el.textContent = text
}

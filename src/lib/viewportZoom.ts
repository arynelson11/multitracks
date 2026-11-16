// Zoom da página no celular.
// O index.html sai sem maximum-scale (o zoom com dois dedos fica livre, como pede a
// acessibilidade). O app trava logo na partida (main.tsx), como sempre foi: com
// maximum-scale=1 o iPhone não dá zoom sozinho ao tocar num campo. Só a landing e o
// /download, que não têm campo de texto, liberam o zoom enquanto estão na tela.

export const VIEWPORT_FREE = 'width=device-width, initial-scale=1'
export const VIEWPORT_LOCKED = 'width=device-width, initial-scale=1.0, maximum-scale=1'

export function setZoomLocked(locked: boolean, doc: Document = document): void {
  const meta = doc.querySelector('meta[name="viewport"]')
  if (meta) meta.setAttribute('content', locked ? VIEWPORT_LOCKED : VIEWPORT_FREE)
}

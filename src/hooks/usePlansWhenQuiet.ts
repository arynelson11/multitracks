import { useState } from 'react'

// Planos pedidos por um recurso pago (Ruling pads-tocando, revisão macro da 1b): no Livre, com a
// música tocando ou na pré-contagem, os Planos não abrem por cima do palco; o pedido espera a
// música parar, como a tela de limite (useLivre). Fora do Livre (quem paga e o admin), abre na
// hora, como antes. O pedido que esperava some se a conta deixa de ser Livre antes de parar.
//
// O pedido assenta na renderização, sem setState em efeito (Ruling R8): `open` é chamado ali,
// então tem de ser um setState do mesmo componente (o `setIsPricingOpen(true)` do App).
export function usePlansWhenQuiet(isLivre: boolean, quiet: boolean, open: () => void): () => void {
  const [waiting, setWaiting] = useState(false)
  if (waiting && (quiet || !isLivre)) {
    setWaiting(false)
    if (isLivre) open()
  }
  return () => {
    if (isLivre && !quiet) setWaiting(true)
    else open()
  }
}

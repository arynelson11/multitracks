import { useCallback, useEffect, useState } from 'react'

export const TWO_TAP_WINDOW_MS = 3000

// Ação sem volta com dois toques: o primeiro arma, o segundo (dentro da janela) confirma.
// Um item armado por vez: armar outro desarma o anterior. Desarma sozinho no fim da
// janela e com Esc. O timer fica aqui (e não no botão) pra sobreviver ao botão sumir.
export function useTwoTapConfirm(onConfirm: (id: string) => void, windowMs = TWO_TAP_WINDOW_MS) {
  const [armedId, setArmedId] = useState<string | null>(null)

  useEffect(() => {
    if (armedId === null) return
    const timer = window.setTimeout(() => setArmedId(null), windowMs)
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setArmedId(null)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.clearTimeout(timer)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [armedId, windowMs])

  const press = useCallback((id: string) => {
    if (armedId === id) {
      setArmedId(null)
      onConfirm(id)
    } else {
      setArmedId(id)
    }
  }, [armedId, onConfirm])

  const disarm = useCallback(() => setArmedId(null), [])

  return { armedId, press, disarm }
}

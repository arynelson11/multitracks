import { useCallback, useEffect, useRef, useState } from 'react'

export const TWO_TAP_WINDOW_MS = 3000
// Segundo toque antes disso não confirma (duplo clique, toque que quica): não é uma
// decisão nova de apagar. A lixeira continua armada e o toque seguinte vale.
export const TWO_TAP_MIN_GAP_MS = 350

// Ação sem volta com dois toques: o primeiro arma, o segundo (dentro da janela e
// depois de TWO_TAP_MIN_GAP_MS) confirma. Um item armado por vez: armar outro desarma
// o anterior. Desarma sozinho no fim da janela, com Esc e quando `resetKey` muda (no
// mixer, a música ativa: trocar de música desarma). O timer fica aqui (e não no botão)
// pra sobreviver ao botão sumir.
export function useTwoTapConfirm(
  onConfirm: (id: string) => void,
  { windowMs = TWO_TAP_WINDOW_MS, resetKey }: { windowMs?: number; resetKey?: unknown } = {},
) {
  const [armedId, setArmedId] = useState<string | null>(null)
  const armedAtRef = useRef(0)
  // Ajuste no render (sem efeito): a chave mudou, nada fica armado.
  const [armedKey, setArmedKey] = useState(resetKey)
  if (!Object.is(armedKey, resetKey)) {
    setArmedKey(resetKey)
    setArmedId(null)
  }

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
      if (Date.now() - armedAtRef.current < TWO_TAP_MIN_GAP_MS) return
      setArmedId(null)
      onConfirm(id)
    } else {
      armedAtRef.current = Date.now()
      setArmedId(id)
    }
  }, [armedId, onConfirm])

  const disarm = useCallback(() => setArmedId(null), [])

  return { armedId, press, disarm }
}

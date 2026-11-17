import { useEffect } from 'react'
import { setZoomLocked } from '../lib/viewportZoom'

// Libera o zoom enquanto a página pública está na tela e trava de novo ao sair dela.
export function useFreeZoom(): void {
  useEffect(() => {
    setZoomLocked(false)
    return () => setZoomLocked(true)
  }, [])
}

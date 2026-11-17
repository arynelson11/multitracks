import { useSyncExternalStore } from 'react'
import { isWideStage } from './stageKeys'

function subscribe(onChange: () => void): () => void {
  window.addEventListener('resize', onChange)
  return () => window.removeEventListener('resize', onChange)
}

const wideNow = () => isWideStage(window.innerWidth, window.innerHeight)

/**
 * A janela cabe o palco novo (1024 x 740 ou mais, Ruling T18-altura) agora, e muda quando ela é redimensionada.
 * É só a regra de tela: a trava "só troca com a música parada" (R-25) e a chave do palco ficam
 * no App (T29), que junta as duas no `useNewStage`.
 */
export function useStageViewport(): { wide: boolean } {
  return { wide: useSyncExternalStore(subscribe, wideNow, () => false) }
}

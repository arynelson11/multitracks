import { useEffect, useLayoutEffect, useRef } from 'react'

/**
 * Laço de quadro do palco: chama `cb` a cada requestAnimationFrame (com o tempo do quadro)
 * enquanto `active` for verdadeiro, e para no unmount. As peças leem aqui o que muda a cada
 * quadro (playhead, tempo, bolinhas, VU) e escrevem direto no DOM, sem estado do React.
 * O callback mais novo fica num ref atualizado no layout effect (nunca na renderização);
 * trocar o callback não reinicia o laço. O próximo quadro é pedido antes de chamar `cb`,
 * então um quadro que lança não congela o palco.
 */
export function useFrame(cb: (t: number) => void, active = true): void {
  const cbRef = useRef(cb)
  useLayoutEffect(() => { cbRef.current = cb })

  useEffect(() => {
    if (!active) return
    let id = 0
    const tick = (t: number) => {
      id = requestAnimationFrame(tick)
      cbRef.current(t)
    }
    id = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(id)
  }, [active])
}

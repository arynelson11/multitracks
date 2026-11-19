import { useEffect, useState } from 'react'
import { computeMixPeaks } from './wavePeaks'

type Sources = readonly AudioBuffer[] | null
interface Done { sources: readonly AudioBuffer[]; buckets: number; peaks: Float32Array }

/** Mesmos canais, na mesma ordem (o App monta uma lista nova a cada fader mexido). */
const sameBuffers = (a: Sources, b: Sources) => a === b || (!!a && !!b && a.length === b.length && a.every((x, i) => x === b[i]))

/**
 * Picos da onda grande com a música inteira (Ruling ONDA-MIX): os dois lados de cada canal de
 * `buffers` (o App passa os canais Normal, waveformMixChannels), aos pedaços que cedem a vez à
 * tela (computeMixPeaks). Até ficar pronta a onda fica vazia (nulo); com outra música (ou sem
 * música) o cálculo velho é cancelado e o resultado dele nunca aparece. Uma lista nova com os
 * mesmos canais não recomeça a conta. `compute` só muda nos testes.
 */
export function useMixPeaks(buffers: Sources, buckets: number, compute: typeof computeMixPeaks = computeMixPeaks): Float32Array | null {
  const [sources, setSources] = useState<Sources>(buffers)
  if (!sameBuffers(sources, buffers)) setSources(buffers)
  const [done, setDone] = useState<Done | null>(null)
  useEffect(() => {
    if (!sources || sources.length === 0) return
    const ctrl = new AbortController()
    const data = sources.flatMap((b) => Array.from({ length: b.numberOfChannels }, (_, c) => b.getChannelData(c)))
    compute(data, buckets, { signal: ctrl.signal }).then(
      (peaks) => { if (peaks && !ctrl.signal.aborted) setDone({ sources, buckets, peaks }) },
      (err: unknown) => { if (!ctrl.signal.aborted) console.warn('[onda] picos da música não calculados:', err) },
    )
    return () => ctrl.abort()
  }, [sources, buckets, compute])
  return done && done.sources === sources && done.buckets === buckets ? done.peaks : null
}

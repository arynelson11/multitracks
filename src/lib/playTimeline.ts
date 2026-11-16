// Linha do tempo da música no relógio do áudio (Parte 2, Arquitetura A).
// A posição sai de segmentos `{ ctxStart, songStart }`: a partir de `ctxStart` (tempo do
// AudioContext) a música anda de `songStart`. O play cria o primeiro segmento e cada pulo
// agendado acrescenta um em `T`. Os segmentos ficam em ordem de `ctxStart` (withSegment
// mantém). Funções puras: nunca mexem na lista recebida, sempre devolvem uma nova.
import type { TimelineSegment } from './stageContracts'

// Índice do segmento vigente em `ctxTime` (ver segmentAt); -1 sem segmento.
function indexAt(segs: readonly TimelineSegment[], ctxTime: number): number {
  for (let i = segs.length - 1; i >= 0; i--) if (segs[i].ctxStart <= ctxTime) return i
  return segs.length > 0 ? 0 : -1
}

/** Segmento vigente em `ctxTime`: o último com `ctxStart <= ctxTime`; antes do primeiro, o primeiro; sem segmento, nulo. */
export function segmentAt(segs: readonly TimelineSegment[], ctxTime: number): TimelineSegment | null {
  const i = indexAt(segs, ctxTime)
  return i < 0 ? null : segs[i]
}

/**
 * Posição da música (segundos) no instante `ctxTime` do contexto, andando a `rate` (velocidade
 * da música, 1 = normal). Antes do primeiro segmento é o `songStart` dele: a posição nunca volta
 * pra trás de onde o play mandou começar. Sem segmento, 0:00.
 */
export function positionAt(segs: readonly TimelineSegment[], ctxTime: number, rate = 1): number {
  const seg = segmentAt(segs, ctxTime)
  if (!seg) return 0
  return seg.songStart + Math.max(0, ctxTime - seg.ctxStart) * rate
}

/**
 * Instante do contexto em que o ponto `songTime` da música toca, pelo segmento vigente em
 * `atCtx` (o "agora" de quem agenda). Nunca usa um segmento que começa depois de `atCtx`: com o
 * pulo já agendado, o fim da volta atual continua sendo convertido pela volta atual. Sem
 * segmento não há conversão e devolve NaN (o Web Audio recusa o número em vez de agendar
 * num lugar errado).
 */
export function ctxTimeOf(segs: readonly TimelineSegment[], songTime: number, atCtx: number, rate = 1): number {
  const seg = segmentAt(segs, atCtx)
  if (!seg) return NaN
  return seg.ctxStart + (songTime - seg.songStart) / rate
}

/** Acrescenta `seg` no fim, tirando antes os que começam em `seg.ctxStart` ou depois (trocar o pulo agendado). */
export function withSegment(segs: readonly TimelineSegment[], seg: TimelineSegment): TimelineSegment[] {
  return [...dropFrom(segs, seg.ctxStart), seg]
}

/** Tira os segmentos que começam em `ctxTime` ou depois (cancelar o pulo agendado). */
export function dropFrom(segs: readonly TimelineSegment[], ctxTime: number): TimelineSegment[] {
  return segs.filter((s) => s.ctxStart < ctxTime)
}

/** Tira os segmentos que já acabaram em `ctxTime`; guarda o vigente e os seguintes (a posição dali pra frente não muda). */
export function pruneBefore(segs: readonly TimelineSegment[], ctxTime: number): TimelineSegment[] {
  const i = indexAt(segs, ctxTime)
  return i < 0 ? [] : segs.slice(i)
}

/**
 * Tempo do contexto que está saindo no alto-falante agora: `ctxTime - outputLatency - entryLatency`
 * (`entryLatency` = atraso da entrada do canal, o `L` da compensação do tom). Latência não finita
 * (navegador que não informa) conta 0.
 */
export function heardTime(ctxTime: number, outputLatency: number, entryLatency: number): number {
  const finiteOrZero = (v: number) => (Number.isFinite(v) ? v : 0)
  return ctxTime - finiteOrZero(outputLatency) - finiteOrZero(entryLatency)
}

// Plano da troca de seção do palco novo (Parte 2, Arquitetura A): em que instante o pulo armado
// acontece (o "1" do compasso seguinte), pra onde vai, os bipes da contagem no último compasso
// e de quando a guia cala. Puro: sem React e sem Web Audio. Tempos em segundos da MÚSICA; o
// agendador (T17) converte pro relógio do áudio pela linha do tempo (T5).
import { isSelfLoop } from './sectionArm'
import { barSeconds, nearestBarLine, pulseSeconds, sanitizeGrid, sectionIndexAt } from './songGrid'
import { countPulses, gridHasPhase, type ArmIntent, type SectionSpan, type SongGrid } from './stageContracts'

/** Folga mínima (s): o plano é feito em `posição + MIN_LEAD`. Armar a menos disso do fim da seção mira o fim da seção seguinte. */
export const MIN_LEAD = 0.05
/**
 * Guia calada no último compasso quando há pulo armado. O `planTransition` lê esta constante
 * dentro do próprio módulo: um `vi.mock` que troca só a exportação não muda o `guideMuteFrom`,
 * então quem agenda (T17) também confere a constante antes de mexer na guia.
 */
export const GUIDE_MUTE_ON_JUMP = true // spec 9b, R-31: decisão pro dono; false desliga o calar a guia sem mexer em mais nada

/** Folga de arredondamento nas comparações de tempo (1 microssegundo), a mesma do songGrid. */
const EPS = 1e-6

/**
 * Plano de um pulo, em segundos da música. `from`: seção de onde sai (-1 antes da primeira
 * marca); `to`: seção alvo; `switchAt`: instante do pulo (o "1" do destino); `targetOffset`:
 * início do alvo; `countTimes`/`countLabels`: bipes que ainda vão soar, com o número real do
 * tempo (armou tarde sai só o fim: [3, 4]); `countTotal`: bipes de um compasso inteiro (0 sem
 * contagem); `guideMuteFrom`: de quando a guia cala até `switchAt` (nulo sem bipe ou com a
 * constante desligada); `barsLeft`: compassos até o pulo contando o que toca (nulo sem grade).
 */
export interface TransitionPlan { from: number; to: number; switchAt: number; targetOffset: number; countTimes: number[]; countLabels: number[]; countTotal: number; guideMuteFrom: number | null; barsLeft: number | null }

/** Última linha `phase + j * step` dentro de `(lo, hi]`, pela conta direta (nunca somando intervalos); nula se não há. */
function lastLineIn(lo: number, hi: number, step: number, phase: number): number | null {
  const line = phase + Math.floor((hi - phase) / step + 1e-9) * step
  return line > lo + EPS && line <= hi + EPS ? line : null
}

/**
 * Instante do pulo saindo da seção `from` (-1: antes da primeira marca, pula no início dela).
 * É o fim da seção, que o `sectionSpans` já encaixou no pulso do click (é o início da seguinte).
 * A exceção é a última: ela termina no fim do áudio quando a barra encaixada do fim passaria
 * dele, e esse fim cru pode cair fora do pulso (Ruling T2-contrato). Com a grade sabendo onde
 * cai o 1, o pulo da última vai pra última barra dentro dela; sem barra dentro, pro último pulso;
 * sem nenhum dos dois, fica no fim cru (o pulo nunca deixa de acontecer). Sem fase (só o BPM
 * salvo) o fim cru vale e a contagem fica ancorada no 1 de destino, como nas outras seções.
 */
function switchPoint(spans: readonly SectionSpan[], from: number, g: SongGrid | null): number {
  if (from < 0) return spans[0].start
  const { start, end } = spans[from]
  if (from < spans.length - 1 || !g || !gridHasPhase(g)) return end
  if (Math.abs(nearestBarLine(end, g) - end) <= EPS) return end
  return lastLineIn(start, end, barSeconds(g), g.firstDownbeat) ?? lastLineIn(start, end, pulseSeconds(g), g.firstDownbeat) ?? end
}

/**
 * Plano da troca pra intenção armada, visto de `position` (posição da música agora; o plano é
 * feito em `p = position + minLead`). `from` é a seção que toca em `p` e o pulo cai no fim dela;
 * antes da primeira marca, no início da primeira. Grade que o `sanitizeGrid` recusa conta como
 * sem grade: pulo na marca, sem contagem e `barsLeft` nulo. Com grade (inclusive só o BPM salvo,
 * sem fase): bipes em `switchAt - k * passo` (passo = pulso vezes `countEvery`, um por tempo),
 * só os que ainda não passaram de `p`. O loop infinito da própria seção não conta nem cala a guia;
 * REPETIR N conta a cada volta (regras da T4). Nulo quando não há plano: alvo fora da lista,
 * lista vazia, posição que não é número, ou depois do último ponto de pulo da última seção (o
 * `sectionIndexAt` continua nela depois do fim, e não há mais barra pra pular). Nunca NaN.
 */
export function planTransition(a: { spans: readonly SectionSpan[]; grid: SongGrid | null; position: number; intent: ArmIntent; minLead?: number }): TransitionPlan | null {
  const { spans, intent } = a
  const to = intent.target
  if (!Number.isInteger(to) || to < 0 || to >= spans.length) return null
  const p = a.position + (a.minLead ?? MIN_LEAD)
  if (!Number.isFinite(p)) return null

  const g = a.grid ? sanitizeGrid(a.grid) : null
  const from = sectionIndexAt(spans, p)
  const switchAt = switchPoint(spans, from, g)
  const targetOffset = spans[to].start
  if (!Number.isFinite(switchAt) || !Number.isFinite(targetOffset) || switchAt < p) return null

  const jump = { from, to, switchAt, targetOffset }
  if (!g) return { ...jump, countTimes: [], countLabels: [], countTotal: 0, guideMuteFrom: null, barsLeft: null }
  // Pelo menos 1: o pulo está à frente, então o compasso que toca é o último.
  const barsLeft = Math.max(1, Math.ceil((switchAt - a.position) / barSeconds(g) - 1e-6))
  if (isSelfLoop(intent, from)) return { ...jump, countTimes: [], countLabels: [], countTotal: 0, guideMuteFrom: null, barsLeft }

  const step = pulseSeconds(g) * g.countEvery
  const countTotal = countPulses(g.signature, g.countEvery)
  const countTimes: number[] = []
  const countLabels: number[] = []
  for (let k = countTotal; k >= 1; k--) {
    const t = switchAt - k * step
    if (t < p) continue
    countTimes.push(t)
    countLabels.push(countTotal - k + 1)
  }
  const guideMuteFrom = GUIDE_MUTE_ON_JUMP && countTimes.length > 0 ? countTimes[0] : null
  return { ...jump, countTimes, countLabels, countTotal, guideMuteFrom, barsLeft }
}

// Conta única da contagem e do texto de espera do pulo armado. O aviso PRÓXIMA (T8), a
// botoeira de seções (T10) e o balão do Click (T14) usam estas duas funções, sempre com o
// tempo OUVIDO (ctx.currentTime - outputLatency - L): a tela acende o bipe quando ele soa.
import type { TransitionView } from './stageContracts'

export interface CountState { lit: boolean[]; currentLabel: number | null; inLastBar: boolean; counting: boolean }

/**
 * Início do último compasso pelo primeiro tempo possível da contagem. Os bipes caem em
 * `switchAt - k * passo` (k = countTotal - label + 1), então um bipe qualquer dá o passo, e
 * a contagem curta (armou tarde) acha o mesmo início da inteira. Nulo sem bipe nenhum.
 */
function lastBarStart(t: TransitionView, total: number): number | null {
  const first = t.countTimes[0]
  if (first === undefined || !Number.isFinite(first)) return null
  const k = total - t.countLabels[0] + 1
  if (t.switchAt === null || !Number.isFinite(t.switchAt) || !(k >= 1)) return first
  const step = (t.switchAt - first) / k
  return step > 0 ? t.switchAt - total * step : first
}

/**
 * Estado da contagem no instante ouvido `heardNow`. `lit[label - 1]` diz se aquele bipe já
 * soou (contagem curta deixa os primeiros apagados, com o número real nos que soam);
 * `currentLabel` é o último bipe ouvido; `inLastBar` liga no início do último compasso.
 * Na troca (`heardNow >= switchAt`) a contagem acabou: nada aceso. Sem bipes agendados
 * (loop da própria seção, ou armou depois do último tempo) o último compasso vem de `barsLeft`.
 */
export function countState(t: TransitionView, heardNow: number): CountState {
  const total = Number.isFinite(t.countTotal) ? Math.max(0, Math.floor(t.countTotal)) : 0
  const lit: boolean[] = Array.from({ length: total }, () => false)
  const ended = t.switchAt !== null && heardNow >= t.switchAt
  if (ended) return { lit, currentLabel: null, inLastBar: false, counting: false }

  let currentLabel: number | null = null
  for (let i = 0; i < t.countTimes.length; i++) {
    const label = t.countLabels[i]
    if (!(t.countTimes[i] <= heardNow) || !Number.isInteger(label) || label < 1 || label > total) continue
    lit[label - 1] = true
    currentLabel = label
  }

  const start = total > 0 ? lastBarStart(t, total) : null
  const inLastBar = start !== null
    ? heardNow >= start
    : t.barsLeft !== null && t.barsLeft <= 1
  return { lit, currentLabel, inLastBar, counting: currentLabel !== null }
}

/**
 * Texto de espera do pulo armado, nesta prioridade: sem grade "no fim da seção"; click sem
 * som "CLICK DESLIGADO"; contando, nada (os números falam); dois compassos ou mais,
 * "em N comp."; senão "último comp.". Do "1" ouvido em diante (`heardNow >= switchAt`) o
 * pulo já aconteceu: nada, enquanto o pouso não chega na tela (alguns quadros).
 */
export function transitionWaitText(t: TransitionView, heardNow: number): string | null {
  if (t.switchAt !== null && heardNow >= t.switchAt) return null
  if (!t.hasGrid) return 'no fim da seção'
  if (!t.clickAudible) return 'CLICK DESLIGADO'
  if (countState(t, heardNow).counting) return null
  if (t.barsLeft !== null && t.barsLeft > 1) return `em ${t.barsLeft} comp.`
  return 'último comp.'
}

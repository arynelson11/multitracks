// BPM, fase e compasso lidos na faixa de click (Arquitetura B do plano da Parte 2).
// A grade do palco vem só daqui: o click é um sinal limpo e é o que a banda ouve.
// Puro: recebe as amostras de um canal (o canal 0 do buffer do click) e não usa Web Audio.
//
// Etapas:
// 1. Ataques: envelope do valor absoluto; ataque é a subida do envelope acima de 30% do pico
//    global, com no mínimo 60 ms entre ataques. O tempo é a primeira amostra acima do limiar.
// 2. Período: mediana dos intervalos vizinhos. Cada ataque ganha o índice
//    round((t - t0) / mediana) e sai da conta se cai a mais de 15% da grade. BPM e fase
//    saem de mínimos quadrados (índice x tempo). Isso vale nos primeiros 16 períodos; dali
//    em diante a reta ajustada refaz os índices em trechos que dobram até o fim do arquivo
//    (ver fitGrid).
// 3. Traços de cada ataque nos primeiros 15 ms: pico (acento mais forte, `loud`) e
//    cruzamentos por zero (acento mais agudo, `bright`). Cada traço é dividido em 2 grupos
//    (2-médias) com o limiar no meio das médias. Médias a menos de 10% uma da outra quer
//    dizer ataques iguais: o traço não marca acento.
// 4. Compasso: pra m em 3, 4, 5, 6, 7 e 12, nessa ordem, e pra cada traço que marca acento,
//    vale o primeiro m com exatamente uma fase com pelo menos 80% de acentuados, todas as
//    outras com no máximo 20%, e pelo menos 4 ataques (4 compassos) nessa fase.

export interface ClickAnalysis {
  /** Pulsos do click por minuto, com decimais. */
  bpm: number
  /** Primeiro pulso da grade, em segundos do arquivo (na reta ajustada). */
  firstPulse: number
  /** Pulsos por compasso lidos no acento: 3, 4, 5, 6, 7 ou 12. Nulo sem acento que feche um compasso. */
  pulsesPerBar: number | null
  /** Primeiro "1" em segundos do arquivo (na reta ajustada). Nulo junto com `pulsesPerBar`. */
  firstDownbeat: number | null
  /** Ataques que caíram na grade e entraram na conta. */
  onsets: number
  /** Traço que marcou o acento: mais forte (`loud`) ou mais agudo (`bright`). Nulo junto com `pulsesPerBar`. */
  accent: 'loud' | 'bright' | null
}

/** Abaixo disso não há click pra ler. */
const MIN_SECONDS = 4
/** Ataques mínimos na grade. */
const MIN_ONSETS = 8
/** Limiar do ataque, em fração do pico global. */
const ONSET_THRESHOLD = 0.3
/** Distância mínima entre dois ataques, em segundos. */
const MIN_ONSET_GAP_S = 0.06
/**
 * Queda do envelope (constante de tempo, em segundos). O envelope segue o valor absoluto na
 * subida e cai devagar entre os semiciclos, pra o mesmo bipe não cruzar o limiar várias vezes.
 */
const ENVELOPE_RELEASE_S = 0.01
/** Ataque fora da grade por mais que esta fração do período sai da conta. */
const GRID_TOLERANCE = 0.15
/**
 * Sem pulso regular: menos da metade dos ataques cai na grade. O plano não fixa o número;
 * metade é o mínimo pra dizer que a grade explica o arquivo.
 */
const MIN_ON_GRID_SHARE = 0.5
/** Janela dos traços do acento, a partir do ataque, em segundos. */
const TRAIT_WINDOW_S = 0.015
/** Médias do 2-médias mais perto que isto (fração da maior) = ataques iguais. */
const MIN_CLUSTER_SPREAD = 0.1
/** A fase do "1" tem pelo menos isto de acentuados. */
const DOWNBEAT_MIN_SHARE = 0.8
/** As outras fases têm no máximo isto de acentuados. */
const OTHER_MAX_SHARE = 0.2
/** Ataques mínimos na fase do "1" (compassos inteiros vistos). */
const MIN_BARS = 4
/** Pulsos por compasso tentados, nessa ordem (3 antes de 6 e 12; 4 antes de 12). */
const BAR_CANDIDATES = [3, 4, 5, 6, 7, 12] as const

type AccentTrait = 'loud' | 'bright'

/** Ataque que caiu na grade: amostra onde começa e índice do pulso. */
interface GridOnset {
  sample: number
  index: number
}

/** Amostras dos ataques (subida do envelope acima de 30% do pico global, 60 ms de folga). */
function detectOnsets(x: Float32Array, sampleRate: number): number[] {
  let peak = 0
  for (let i = 0; i < x.length; i++) {
    const v = Math.abs(x[i])
    if (v > peak) peak = v
  }
  if (!(peak > 0) || !Number.isFinite(peak)) return []
  const threshold = ONSET_THRESHOLD * peak
  const release = Math.exp(-1 / (ENVELOPE_RELEASE_S * sampleRate))
  const minGap = Math.round(MIN_ONSET_GAP_S * sampleRate)
  const onsets: number[] = []
  let env = 0
  let last = -Infinity
  for (let i = 0; i < x.length; i++) {
    const v = Math.abs(x[i])
    const before = env
    const decayed = env * release
    env = v > decayed ? v : decayed
    if (env >= threshold && before < threshold && i - last >= minGap) {
      onsets.push(i)
      last = i
    }
  }
  return onsets
}

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b)
  const mid = s.length >> 1
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}

/**
 * Ataques até `until` (amostra) que caem a no máximo 15% do período da grade
 * `phase + period * índice`. Dois ataques no mesmo índice: fica o mais perto da grade.
 */
function snapToGrid(onsets: number[], phase: number, period: number, until: number): GridOnset[] {
  const byIndex = new Map<number, { sample: number; dev: number }>()
  for (const sample of onsets) {
    if (sample > until) break
    const index = Math.round((sample - phase) / period)
    const dev = Math.abs(sample - (phase + index * period))
    if (dev > GRID_TOLERANCE * period) continue
    const prev = byIndex.get(index)
    if (!prev || dev < prev.dev) byIndex.set(index, { sample, dev })
  }
  return [...byIndex.entries()].map(([index, o]) => ({ sample: o.sample, index })).sort((a, b) => a.index - b.index)
}

/**
 * Trecho inicial, em períodos, em que o índice sai só da mediana. A mediana dos intervalos
 * vizinhos sai torta por frações de ms quando os sons do click têm ataques diferentes (visto
 * nos clicks reais): em 16 períodos o erro acumulado fica bem abaixo dos 15%.
 */
const FIRST_SPAN_PERIODS = 16

/**
 * Grade dos ataques (etapa 2). O índice começa como round((t - t0) / mediana) nos primeiros
 * 16 períodos; a reta ajustada ali refaz os índices num trecho com o dobro do tamanho, e assim
 * por diante até o fim do arquivo. Sem isso, num click de 5 min o índice escorrega da grade
 * no meio do arquivo e os ataques do fim saem da conta.
 */
function fitGrid(onsets: number[]): { grid: GridOnset[]; period: number; phase: number } | null {
  const intervals: number[] = []
  for (let i = 1; i < onsets.length; i++) intervals.push(onsets[i] - onsets[i - 1])
  let period = median(intervals)
  let phase = onsets[0]
  const last = onsets[onsets.length - 1]
  let span = FIRST_SPAN_PERIODS * period
  let grid: GridOnset[] = []
  for (;;) {
    const until = onsets[0] + span
    grid = snapToGrid(onsets, phase, period, until)
    if (grid.length >= 2) ({ period, phase } = fitLine(grid))
    if (!(period > 0)) return null
    if (until >= last) break
    span *= 2
  }
  // Índices a partir de 0 no primeiro ataque da grade.
  const first = grid[0]?.index ?? 0
  return { grid: grid.map((o) => ({ sample: o.sample, index: o.index - first })), period, phase: phase + first * period }
}

/** Reta de mínimos quadrados tempo = fase + período * índice, em amostras. */
function fitLine(onsets: GridOnset[]): { period: number; phase: number } {
  const n = onsets.length
  let mi = 0
  let mt = 0
  for (const o of onsets) { mi += o.index; mt += o.sample }
  mi /= n; mt /= n
  let sit = 0
  let sii = 0
  for (const o of onsets) {
    const di = o.index - mi
    sit += di * (o.sample - mt)
    sii += di * di
  }
  const period = sit / sii
  return { period, phase: mt - period * mi }
}

/** Pico e cruzamentos por zero nos primeiros 15 ms de cada ataque. */
function onsetTraits(x: Float32Array, onsets: GridOnset[], sampleRate: number): Record<AccentTrait, number[]> {
  const len = Math.round(TRAIT_WINDOW_S * sampleRate)
  const loud: number[] = []
  const bright: number[] = []
  for (const { sample } of onsets) {
    const end = Math.min(x.length, sample + len)
    let peak = 0
    let crossings = 0
    let wasNegative = x[sample] < 0
    for (let i = sample; i < end; i++) {
      const v = x[i]
      const a = Math.abs(v)
      if (a > peak) peak = a
      const negative = v < 0
      if (negative !== wasNegative) crossings++
      wasNegative = negative
    }
    loud.push(peak)
    bright.push(crossings)
  }
  return { loud, bright }
}

/**
 * Acentuados por 2-médias (limiar no meio das duas médias). Nulo quando as médias ficam a
 * menos de 10% uma da outra: todos os ataques são iguais e o traço não marca acento.
 */
function accentMarks(values: number[]): boolean[] | null {
  let lo = Infinity
  let hi = -Infinity
  for (const v of values) {
    if (v < lo) lo = v
    if (v > hi) hi = v
  }
  if (!(hi > lo)) return null
  // Começando no mínimo e no máximo, nenhum grupo fica vazio: cada média fica entre o
  // extremo do seu lado e o limiar seguinte.
  for (let iter = 0; iter < 100; iter++) {
    const mid = (lo + hi) / 2
    let sumLo = 0
    let nLo = 0
    let sumHi = 0
    let nHi = 0
    for (const v of values) {
      if (v > mid) { sumHi += v; nHi++ } else { sumLo += v; nLo++ }
    }
    const nextLo = sumLo / nLo
    const nextHi = sumHi / nHi
    if (nextLo === lo && nextHi === hi) break
    lo = nextLo
    hi = nextHi
  }
  if (hi - lo < MIN_CLUSTER_SPREAD * Math.abs(hi)) return null
  const mid = (lo + hi) / 2
  return values.map((v) => v > mid)
}

/** Fase do "1" pra `m` pulsos por compasso, ou nulo se a regra 80%/20% em 4 compassos não fecha. */
function downbeatPhase(onsets: GridOnset[], marks: boolean[], m: number): number | null {
  const total = new Array<number>(m).fill(0)
  const accented = new Array<number>(m).fill(0)
  onsets.forEach((o, i) => {
    const p = o.index % m
    total[p]++
    if (marks[i]) accented[p]++
  })
  let phase: number | null = null
  for (let p = 0; p < m; p++) {
    if (total[p] === 0) continue
    const share = accented[p] / total[p]
    if (share >= DOWNBEAT_MIN_SHARE) {
      if (phase !== null) return null
      phase = p
    } else if (share > OTHER_MAX_SHARE) {
      return null
    }
  }
  if (phase === null || total[phase] < MIN_BARS) return null
  return phase
}

/**
 * Lê BPM (com decimais), primeiro pulso e compasso na faixa de click.
 * Nulo com menos de 4 s, menos de 8 ataques ou sem pulso regular.
 */
export function analyzeClickTrack(samples: Float32Array, sampleRate: number): ClickAnalysis | null {
  if (!(sampleRate > 0) || samples.length < MIN_SECONDS * sampleRate) return null
  const detected = detectOnsets(samples, sampleRate)
  if (detected.length < MIN_ONSETS) return null
  const fit = fitGrid(detected)
  if (!fit) return null
  const { grid, period, phase } = fit
  if (grid.length < MIN_ONSETS || grid.length < MIN_ON_GRID_SHARE * detected.length) return null
  const timeOf = (index: number) => (phase + period * index) / sampleRate
  const result: ClickAnalysis = {
    bpm: (60 * sampleRate) / period,
    firstPulse: timeOf(grid[0].index),
    pulsesPerBar: null,
    firstDownbeat: null,
    onsets: grid.length,
    accent: null,
  }
  const traits = onsetTraits(samples, grid, sampleRate)
  const marks: [AccentTrait, boolean[] | null][] = [['loud', accentMarks(traits.loud)], ['bright', accentMarks(traits.bright)]]
  for (const m of BAR_CANDIDATES) {
    for (const [trait, traitMarks] of marks) {
      if (!traitMarks) continue
      const p = downbeatPhase(grid, traitMarks, m)
      if (p === null) continue
      const first = grid.find((o) => o.index % m === p)!
      return { ...result, pulsesPerBar: m, firstDownbeat: timeOf(first.index), accent: trait }
    }
  }
  return result
}

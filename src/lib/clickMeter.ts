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
//
// Compasso composto (6/8 e 12/8): a grade sai sempre em colcheias, que é o pulso do 6/8 no
// palco (6 pulsos por compasso, contagem de 3 em 3). Ver compoundReading.
import { isCompound, pulsesPerBar as signaturePulses, type TimeSignature } from './stageContracts'

export interface ClickAnalysis {
  /** Pulsos do click por minuto, com decimais. */
  bpm: number
  /** Primeiro pulso da grade, em segundos do arquivo (na reta ajustada). */
  firstPulse: number
  /**
   * Pulsos por compasso lidos no acento: 3, 4, 5, 6, 7 ou 12. Nulo sem acento que feche um
   * compasso. Com compasso composto conhecido, conta em colcheias (6 ou 12).
   */
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
/**
 * Com 6/8 ou 12/8 conhecido e nenhum acento que diga a unidade do click: pulso mais lento
 * que isto é semínima pontuada (como colcheia daria uma pontuada abaixo de 33 por minuto);
 * a partir disto é colcheia (como pontuada daria colcheias acima de 300 por minuto).
 */
const DOTTED_PULSE_MAX_BPM = 100

type AccentTrait = 'loud' | 'bright'
type TraitMarks = [AccentTrait, boolean[] | null][]

/** Compasso lido no acento: `m` pulsos, o "1" nos índices ≡ `phase` (mod m), e o traço que marcou. */
interface MeterReading {
  m: number
  phase: number
  trait: AccentTrait
}

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
 * Metade do 6/8 no acento: com o acento a cada 3 pulsos na fase `p`, os acentuados alternam
 * forte e médio (o 1 e o 4 do 6/8)? Aplica a mesma regra 80%/20% em 4 compassos sobre os
 * ataques da fase `p`, de 2 em 2. Devolve qual metade (0 ou 1) é a forte, ou nulo.
 */
function compoundHalf(grid: GridOnset[], values: number[], p: number): number | null {
  const sub: GridOnset[] = []
  const subValues: number[] = []
  grid.forEach((o, i) => {
    if (o.index % 3 !== p) return
    sub.push({ sample: o.sample, index: (o.index - p) / 3 })
    subValues.push(values[i])
  })
  const marks = accentMarks(subValues)
  return marks ? downbeatPhase(sub, marks, 2) : null
}

/**
 * Etapa 4: o primeiro `m` de BAR_CANDIDATES que fecha a regra 80%/20%, traço a traço.
 * Acento a cada 3 com o 1 mais forte que o 4 é 6/8 em colcheias (6 pulsos).
 */
function readMeter(grid: GridOnset[], traits: Record<AccentTrait, number[]>, marks: TraitMarks): MeterReading | null {
  for (const m of BAR_CANDIDATES) {
    for (const [trait, traitMarks] of marks) {
      if (!traitMarks) continue
      const phase = downbeatPhase(grid, traitMarks, m)
      if (phase === null) continue
      if (m === 3) {
        const half = compoundHalf(grid, traits[trait], phase)
        if (half !== null) return { m: 6, phase: phase + 3 * half, trait }
      }
      return { m, phase, trait }
    }
  }
  return null
}

/** Acento a cada 2 pulsos (o compasso de 2 semínimas pontuadas do 6/8). */
function readTwoPulseBar(grid: GridOnset[], marks: TraitMarks): MeterReading | null {
  for (const [trait, traitMarks] of marks) {
    if (!traitMarks) continue
    const phase = downbeatPhase(grid, traitMarks, 2)
    if (phase !== null) return { m: 2, phase, trait }
  }
  return null
}

/**
 * Com 6/8 ou 12/8 conhecido (salvo ou escolhido no EDITAR), a leitura sai em colcheias:
 * - click em colcheias: o acento fecha o compasso, a metade ou um quarto dele (de 3 em 3
 *   colcheias); o compasso é o conhecido (6 ou 12 pulsos) e o "1" é o primeiro acentuado
 *   (com o 1 e o 4 iguais, ele pode cair no 4);
 * - click em semínima pontuada (pulso abaixo de DOTTED_PULSE_MAX_BPM): o acento fecha 2
 *   pulsos (6/8) ou 4 (12/8); o BPM vira colcheia (x3) e o "1" é o pulso acentuado; sem
 *   acento que feche o compasso, o BPM vira colcheia e o "1" fica nulo;
 * - pulso a partir de DOTTED_PULSE_MAX_BPM sem acento de colcheia: fica como está, sem "1".
 */
function compoundReading(
  base: ClickAnalysis, grid: GridOnset[], marks: TraitMarks, meter: MeterReading | null,
  signature: TimeSignature, downbeatTime: (r: MeterReading) => number,
): ClickAnalysis {
  const eighths = signaturePulses(signature)
  const dotted = eighths / 3
  const asDotted = { ...base, bpm: base.bpm * 3 }
  if (meter && meter.m % 3 === 0 && eighths % meter.m === 0) {
    return { ...base, pulsesPerBar: eighths, firstDownbeat: downbeatTime(meter), accent: meter.trait }
  }
  // Pontuada a 100 por minuto ou mais daria colcheias acima de 300: aí é colcheia, com o
  // acento marcando outra coisa (um 4/4 em colcheias com o compasso salvo errado, por exemplo).
  if (base.bpm >= DOTTED_PULSE_MAX_BPM) return base
  const dottedMeter = meter?.m === dotted ? meter : dotted === 2 ? readTwoPulseBar(grid, marks) : null
  if (dottedMeter) return { ...asDotted, pulsesPerBar: eighths, firstDownbeat: downbeatTime(dottedMeter), accent: dottedMeter.trait }
  return asDotted
}

/**
 * Lê BPM (com decimais), primeiro pulso e compasso na faixa de click.
 * `knownSignature` é o compasso que a música já tem (salvo ou escolhido no EDITAR): só o
 * composto (6/8, 12/8) muda a leitura, pra grade sair em colcheias mesmo com o click em
 * semínima pontuada. Nulo com menos de 4 s, menos de 8 ataques ou sem pulso regular.
 */
export function analyzeClickTrack(samples: Float32Array, sampleRate: number, knownSignature?: TimeSignature | null): ClickAnalysis | null {
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
  const marks: TraitMarks = [['loud', accentMarks(traits.loud)], ['bright', accentMarks(traits.bright)]]
  const meter = readMeter(grid, traits, marks)
  // "1" = tempo (na reta) do primeiro ataque com índice ≡ fase (mod m).
  const downbeatTime = (r: MeterReading) => timeOf(grid.find((o) => o.index % r.m === r.phase)!.index)
  if (knownSignature && isCompound(knownSignature)) {
    return compoundReading(result, grid, marks, meter, knownSignature, downbeatTime)
  }
  if (!meter) return result
  return { ...result, pulsesPerBar: meter.m, firstDownbeat: downbeatTime(meter), accent: meter.trait }
}

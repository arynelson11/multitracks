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
// 4. Compasso: pra m em 3, 4, 5, 6, 7, 8 e 12, nessa ordem, e pra cada traço que marca acento,
//    vale o primeiro m com exatamente uma fase com pelo menos 80% de acentuados, todas as
//    outras com no máximo 20%, e pelo menos 4 ataques (4 compassos) nessa fase. A mesma regra
//    com m = 2 mostra o acento em cada tempo de um click em colcheias.
// 5. Tempo e subdivisão (ver interpret): o BPM sai em TEMPOS (semínima no simples, semínima
//    pontuada no 6/8 e no 12/8) e `subdivision` diz quantos pulsos do click cabem num tempo.
//    O compasso e o BPM salvos da música desempatam quando o acento deixa duas leituras.
import { isCompound, pulsesPerBar as signaturePulses, type TimeSignature } from './stageContracts'

export interface ClickAnalysis {
  /** Tempos por minuto, com decimais: semínima no compasso simples, semínima pontuada no composto. */
  bpm: number
  /** Pulsos do click por tempo: 1 (o click toca o tempo), 2 (colcheias no simples) ou 3 (colcheias no composto). */
  subdivision: 1 | 2 | 3
  /** O tempo é a semínima pontuada (leitura em 6/8 ou 12/8). */
  compound: boolean
  /** Primeiro tempo da grade, em segundos do arquivo (na reta ajustada): o pulso do click que cai num tempo. */
  firstPulse: number
  /**
   * Compasso lido no acento, no número de pulsos do `TimeSignature` (3, 4, 5, 6, 7 ou 12, que
   * são 3/4, 4/4, 5/4, 6/8, 7/8 e 12/8). Nulo sem acento que feche um compasso.
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
/** Pulsos por compasso tentados, nessa ordem (3 antes de 6 e 12; 4 antes de 8 e 12). */
const BAR_CANDIDATES = [3, 4, 5, 6, 7, 8, 12] as const
/**
 * Acento a cada 2 ou a cada 8 pulsos só vira colcheia (subdivisão 2) com o pulso a partir
 * disto: colcheia mais lenta daria semínima abaixo de 50 por minuto.
 */
const MIN_SUBDIVIDED_PULSE_BPM = 100
/** O BPM salvo da música desempata quando bate com pulsos / 1, 2 ou 3 até esta fração. */
const KNOWN_BPM_TOLERANCE = 0.03
/**
 * Com 6/8 ou 12/8 conhecido: pulso mais lento que isto é semínima pontuada (como colcheia
 * daria uma pontuada abaixo de 33 por minuto); a partir disto é colcheia (como pontuada daria
 * colcheias acima de 300 por minuto).
 */
const DOTTED_PULSE_MAX_BPM = 100

type AccentTrait = 'loud' | 'bright'
type TraitMarks = [AccentTrait, boolean[] | null][]

/** Compasso lido no acento: `m` pulsos, o "1" nos índices ≡ `phase` (mod m), e o traço que marcou. */
interface MeterReading {
  m: number
  phase: number
  trait: AccentTrait
  /** O 6 saiu do acento a cada 3 com o 1 mais forte que o 4 (prova de 6/8 em colcheias). */
  compoundEvidence: boolean
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
        if (half !== null) return { m: 6, phase: phase + 3 * half, trait, compoundEvidence: true }
      }
      return { m, phase, trait, compoundEvidence: false }
    }
  }
  return null
}

/** Acento a cada 2 pulsos: os tempos de um click em colcheias (ou o compasso de 2 pontuadas do 6/8). */
function readTwoPulseBar(grid: GridOnset[], marks: TraitMarks): MeterReading | null {
  for (const [trait, traitMarks] of marks) {
    if (!traitMarks) continue
    const phase = downbeatPhase(grid, traitMarks, 2)
    if (phase !== null) return { m: 2, phase, trait, compoundEvidence: false }
  }
  return null
}

/** Leitura final: subdivisão, tempo simples ou composto, compasso e de onde vem o "1". */
interface Interpretation {
  subdivision: 1 | 2 | 3
  compound: boolean
  /** Compasso no número de pulsos do `TimeSignature`, ou nulo. */
  meter: number | null
  /** Acento que dá o "1" (fase nos pulsos do click), ou nulo. */
  downbeat: MeterReading | null
  /** Pulso do click (índice mod subdivisão) que cai no tempo. */
  beatPhase: number
}

/** 1, 2 ou 3 quando o BPM salvo bate com pulsos / esse número; nulo sem BPM salvo ou sem bater. */
function knownRatio(pulseBpm: number, knownBpm: number | null | undefined): 1 | 2 | 3 | null {
  if (typeof knownBpm !== 'number' || !Number.isFinite(knownBpm) || knownBpm <= 0) return null
  for (const k of [1, 2, 3] as const) {
    if (Math.abs(pulseBpm / k - knownBpm) <= KNOWN_BPM_TOLERANCE * knownBpm) return k
  }
  return null
}

function interpretation(subdivision: 1 | 2 | 3, compound: boolean, meter: number | null, downbeat: MeterReading | null, beat: MeterReading | null = downbeat): Interpretation {
  return { subdivision, compound, meter, downbeat, beatPhase: beat ? beat.phase % subdivision : 0 }
}

/**
 * Com 6/8 ou 12/8 conhecido (salvo ou escolhido no EDITAR), o andamento diz a unidade do click:
 * - pulso a partir de DOTTED_PULSE_MAX_BPM: colcheias (subdivisão 3); o acento de 3 em 3, de
 *   6 em 6 ou de 12 em 12 colcheias dá o compasso e o "1" (com o 1 e o 4 iguais, o "1" pode
 *   cair no 4);
 * - pulso mais lento: semínima pontuada (subdivisão 1); o acento fechando 2 pulsos (6/8) ou 4
 *   (12/8) dá o compasso e o "1".
 * Sem acento que feche o compasso, o compasso fica nulo (o salvo vale na grade).
 */
function compoundFrame(pulseBpm: number, bar: MeterReading | null, two: MeterReading | null, eighths: number): Interpretation {
  if (pulseBpm >= DOTTED_PULSE_MAX_BPM) {
    const fits = bar !== null && bar.m % 3 === 0 && eighths % bar.m === 0
    return interpretation(3, true, fits ? eighths : null, fits ? bar : null)
  }
  const dotted = eighths / 3
  const dottedBar = bar?.m === dotted ? bar : dotted === 2 ? two : null
  return interpretation(1, true, dottedBar ? eighths : null, dottedBar)
}

/** Acento que fecha um compasso de `bar.m` pulsos, sem compasso conhecido que decida. */
function fromBar(pulseBpm: number, bar: MeterReading, two: MeterReading | null, k: 1 | 2 | 3 | null): Interpretation {
  switch (bar.m) {
    case 6:
      // 6/8 em colcheias, 3/4 em colcheias ou 3/4 com acento de 2 em 2 compassos.
      if (bar.compoundEvidence || k === 3) return interpretation(3, true, 6, bar)
      if (k === 2 || two) return interpretation(2, false, 3, bar)
      if (k === 1) return interpretation(1, false, 3, bar)
      return interpretation(3, true, 6, bar)
    case 8: {
      // 4/4 em colcheias, ou 4/4 com acento de 2 em 2 compassos (BPM salvo igual aos pulsos).
      const s = k === 1 || k === 2 ? k : two || pulseBpm >= MIN_SUBDIVIDED_PULSE_BPM ? 2 : 1
      return interpretation(s, false, 4, bar)
    }
    case 12:
      return interpretation(3, true, 12, bar)
    default:
      return interpretation(1, false, bar.m, bar)
  }
}

/**
 * Etapa 5. Ordem: compasso composto conhecido (compoundFrame); compasso simples conhecido com
 * o acento fechando 1, 2 ou 3 pulsos por tempo; o acento sozinho (fromBar), com o BPM salvo
 * desempatando; sem acento de compasso, o acento a cada 2 pulsos (colcheias com cada tempo
 * acentuado) e o BPM salvo dizem a subdivisão.
 */
function interpret(
  pulseBpm: number, bar: MeterReading | null, two: MeterReading | null,
  knownSignature: TimeSignature | null | undefined, knownBpm: number | null | undefined,
): Interpretation {
  if (knownSignature && isCompound(knownSignature)) return compoundFrame(pulseBpm, bar, two, signaturePulses(knownSignature))
  const k = knownRatio(pulseBpm, knownBpm)
  if (bar) {
    const beats = knownSignature ? signaturePulses(knownSignature) : null
    if (beats !== null && bar.m % beats === 0 && bar.m / beats <= 3) {
      const ratio = bar.m / beats
      const s = k !== null && bar.m % (k * beats) === 0 ? k : ratio
      return interpretation(s as 1 | 2 | 3, false, beats, bar)
    }
    return fromBar(pulseBpm, bar, two, k)
  }
  if (two) {
    const s = k === 1 || k === 2 ? k : pulseBpm >= MIN_SUBDIVIDED_PULSE_BPM ? 2 : 1
    return interpretation(s, false, null, null, two)
  }
  const s = k ?? 1
  return interpretation(s, s === 3, null, null)
}

/**
 * Lê BPM (em tempos, com decimais), subdivisão, primeiro tempo e compasso na faixa de click.
 * `knownSignature` e `knownBpm` são o compasso e o BPM que a música já tem (salvos ou
 * escolhidos no EDITAR); só desempatam leituras que o acento sozinho não decide. Nulo com
 * menos de 4 s, menos de 8 ataques ou sem pulso regular.
 */
export function analyzeClickTrack(
  samples: Float32Array, sampleRate: number, knownSignature?: TimeSignature | null, knownBpm?: number | null,
): ClickAnalysis | null {
  if (!(sampleRate > 0) || samples.length < MIN_SECONDS * sampleRate) return null
  const detected = detectOnsets(samples, sampleRate)
  if (detected.length < MIN_ONSETS) return null
  const fit = fitGrid(detected)
  if (!fit) return null
  const { grid, period, phase } = fit
  if (grid.length < MIN_ONSETS || grid.length < MIN_ON_GRID_SHARE * detected.length) return null
  const timeOf = (index: number) => (phase + period * index) / sampleRate
  const traits = onsetTraits(samples, grid, sampleRate)
  const marks: TraitMarks = [['loud', accentMarks(traits.loud)], ['bright', accentMarks(traits.bright)]]
  const pulseBpm = (60 * sampleRate) / period
  const it = interpret(pulseBpm, readMeter(grid, traits, marks), readTwoPulseBar(grid, marks), knownSignature, knownBpm)
  // "1" = tempo (na reta) do primeiro ataque com índice ≡ fase (mod m).
  const downbeat = it.downbeat
  const firstDownbeat = downbeat ? timeOf(grid.find((o) => o.index % downbeat.m === downbeat.phase)!.index) : null
  return {
    bpm: pulseBpm / it.subdivision,
    subdivision: it.subdivision,
    compound: it.compound,
    firstPulse: timeOf(it.beatPhase),
    pulsesPerBar: it.meter,
    firstDownbeat,
    onsets: grid.length,
    accent: downbeat?.trait ?? null,
  }
}

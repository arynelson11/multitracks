import { describe, expect, it } from 'vitest'
import { analyzeClickTrack, type ClickAnalysis } from './clickMeter'
import { barSeconds, gridFromClick, type ClickAnalysisLike } from './songGrid'
import { countPulses } from './stageContracts'

// Gerador de click sintético a 48 kHz: bipe senoidal de 25 ms com queda exponencial.
// `loud` = acento com 1,8x a amplitude; `bright` = acento com a mesma amplitude em 2400 Hz
// (o normal é 1200 Hz); `every2` = acento forte a cada 2 pulsos; `none` = todos iguais;
// `compound` = 1 com 2x e o meio do compasso (o 4 do 6/8) com 1,6x; `beatsAndOne` = pulsos
// pares com 1,8x (as semínimas de um click em colcheias) e o 1 em 2400 Hz.
// `bpm` aqui é a taxa de pulsos do click (colcheias, num click em colcheias).
// `pickupPulses` = pulsos de anacruse antes do primeiro "1"; `jitterMs` = desvio sorteado
// (uniforme, semente fixa) de cada pulso; `gap` = trecho [início, fim) em segundos sem click.
const SR = 48000
const BEEP_S = 0.025
const BASE_AMP = 0.4

interface SynthClickOptions {
  bpm: number
  seconds: number
  pulsesPerBar: number
  accent: 'loud' | 'bright' | 'none' | 'every2' | 'compound' | 'beatsAndOne'
  firstPulse: number
  pickupPulses?: number
  jitterMs?: number
  gap?: [number, number]
  /** Atraso fixo do ataque por tempo do compasso, em ms (sons diferentes no mesmo click). */
  beatOffsetsMs?: number[]
}

function seeded(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function synthClick(o: SynthClickOptions): Float32Array {
  return synthClickWithTimes(o).samples
}

/** O click e o tempo real (em segundos) de cada pulso que tocou. */
function synthClickWithTimes(o: SynthClickOptions): { samples: Float32Array; times: number[] } {
  const out = new Float32Array(Math.round(o.seconds * SR))
  const times: number[] = []
  const period = 60 / o.bpm
  const pickup = o.pickupPulses ?? 0
  const rand = seeded(7)
  const beepLen = Math.round(BEEP_S * SR)
  for (let k = 0; ; k++) {
    const nominal = o.firstPulse + k * period
    if (nominal >= o.seconds) break
    const jitter = o.jitterMs ? (rand() * 2 - 1) * o.jitterMs / 1000 : 0
    const beat = (((k - pickup) % o.pulsesPerBar) + o.pulsesPerBar) % o.pulsesPerBar
    const t = nominal + jitter + (o.beatOffsetsMs?.[beat] ?? 0) / 1000
    if (t < 0 || (o.gap && t >= o.gap[0] && t < o.gap[1])) continue
    times.push(t)
    const isOne = beat === 0
    const isEven = (((k - pickup) % 2) + 2) % 2 === 0
    let amp = BASE_AMP
    let freq = 1200
    if (o.accent === 'loud' && isOne) amp *= 1.8
    if ((o.accent === 'every2' || o.accent === 'beatsAndOne') && isEven) amp *= 1.8
    if (o.accent === 'beatsAndOne' && isOne) freq = 2400
    if (o.accent === 'bright' && isOne) freq = 2400
    if (o.accent === 'compound') amp *= isOne ? 2 : beat === o.pulsesPerBar / 2 ? 1.6 : 1
    const start = Math.round(t * SR)
    for (let i = 0; i < beepLen && start + i < out.length; i++) {
      const s = i / SR
      out[start + i] += amp * Math.exp(-s / 0.008) * Math.sin(2 * Math.PI * freq * s)
    }
  }
  return { samples: out, times }
}

describe('analyzeClickTrack: casos do plano', () => {
  it('4/4 com acento mais forte, BPM com decimais', () => {
    const a = analyzeClickTrack(synthClick({ bpm: 72.5, seconds: 40, pulsesPerBar: 4, accent: 'loud', firstPulse: 0.31 }), 48000)!
    expect(Math.abs(a.bpm - 72.5)).toBeLessThan(0.02); expect(a.pulsesPerBar).toBe(4); expect(a.accent).toBe('loud'); expect(Math.abs(a.firstDownbeat! - 0.31)).toBeLessThan(0.002)
  })
  it('3/4 com acento só mais agudo', () => expect(analyzeClickTrack(synthClick({ bpm: 90, seconds: 30, pulsesPerBar: 3, accent: 'bright', firstPulse: 0.1 }), 48000)!.pulsesPerBar).toBe(3))
  it('6/8 com acento só no 1', () => expect(analyzeClickTrack(synthClick({ bpm: 180, seconds: 30, pulsesPerBar: 6, accent: 'loud', firstPulse: 0.05 }), 48000)!.pulsesPerBar).toBe(6))
  it('anacruse: o 1 é o terceiro ataque', () => expect(Math.abs(analyzeClickTrack(synthClick({ bpm: 120, seconds: 30, pulsesPerBar: 4, accent: 'loud', firstPulse: 0.2, pickupPulses: 2 }), 48000)!.firstDownbeat! - 1.2)).toBeLessThan(0.002))
  it('sem acento ou acento a cada 2 tempos: compasso desconhecido, BPM ainda medido', () => {
    const sem = analyzeClickTrack(synthClick({ bpm: 100, seconds: 30, pulsesPerBar: 4, accent: 'none', firstPulse: 0 }), 48000)!
    expect(sem.pulsesPerBar).toBeNull(); expect(Math.abs(sem.bpm - 100)).toBeLessThan(0.02)
    expect(analyzeClickTrack(synthClick({ bpm: 100, seconds: 30, pulsesPerBar: 4, accent: 'every2', firstPulse: 0 }), 48000)!.pulsesPerBar).toBeNull()
  })
  it('tolera variação de 1 ms e um trecho sem click', () => { const a = analyzeClickTrack(synthClick({ bpm: 76, seconds: 60, pulsesPerBar: 4, accent: 'loud', firstPulse: 0.4, jitterMs: 1, gap: [20, 26] }), 48000)!; expect(Math.abs(a.bpm - 76)).toBeLessThan(0.05); expect(a.pulsesPerBar).toBe(4) })
  it('silêncio e áudio curto', () => { expect(analyzeClickTrack(new Float32Array(48000 * 10), 48000)).toBeNull(); expect(analyzeClickTrack(synthClick({ bpm: 120, seconds: 3, pulsesPerBar: 4, accent: 'loud', firstPulse: 0 }), 48000)).toBeNull() })
  it('5 minutos analisados em menos de 2 s', () => { const x = synthClick({ bpm: 120, seconds: 300, pulsesPerBar: 4, accent: 'loud', firstPulse: 0 }); const t0 = performance.now(); analyzeClickTrack(x, 48000); expect(performance.now() - t0).toBeLessThan(2000) })
})

describe('analyzeClickTrack: compasso composto', () => {
  // No 6/8 e no 12/8 o tempo é a semínima pontuada: o BPM sai nela, e o click toca colcheias
  // (subdivisão 3, 6 ou 12 por compasso) ou o próprio tempo (subdivisão 1, 2 ou 4 por compasso).
  it('6/8 em colcheias com o 1 mais forte que o 4: 6/8 sem compasso salvo, BPM da pontuada, o 1 no mais forte', () => {
    const a = analyzeClickTrack(synthClick({ bpm: 180, seconds: 30, pulsesPerBar: 6, accent: 'compound', firstPulse: 0.1, pickupPulses: 3 }), 48000)!
    expect(a.pulsesPerBar).toBe(6); expect(a.subdivision).toBe(3); expect(a.compound).toBe(true)
    expect(Math.abs(a.bpm - 60)).toBeLessThan(0.01)
    expect(Math.abs(a.firstDownbeat! - 1.1)).toBeLessThan(0.002)
  })
  it('6/8 em colcheias com 1 e 4 iguais e o 6/8 salvo: 6/8 com subdivisão 3', () => {
    const a = analyzeClickTrack(synthClick({ bpm: 180, seconds: 30, pulsesPerBar: 3, accent: 'loud', firstPulse: 0.1 }), 48000, '6/8')!
    expect(a.pulsesPerBar).toBe(6); expect(a.subdivision).toBe(3); expect(Math.abs(a.bpm - 60)).toBeLessThan(0.01)
    expect(Math.abs(a.firstDownbeat! - 0.1)).toBeLessThan(0.002)
  })
  it('6/8 em semínima pontuada (2 pulsos por compasso): com o 6/8 salvo, subdivisão 1 e 6/8', () => {
    const x = synthClick({ bpm: 60, seconds: 30, pulsesPerBar: 2, accent: 'loud', firstPulse: 0.2, pickupPulses: 1 })
    const sem = analyzeClickTrack(x, 48000)!
    expect(sem.pulsesPerBar).toBeNull(); expect(Math.abs(sem.bpm - 60)).toBeLessThan(0.02); expect(sem.subdivision).toBe(1)
    const a = analyzeClickTrack(x, 48000, '6/8')!
    expect(Math.abs(a.bpm - 60)).toBeLessThan(0.02); expect(a.subdivision).toBe(1); expect(a.compound).toBe(true)
    expect(a.pulsesPerBar).toBe(6); expect(a.accent).toBe('loud')
    expect(Math.abs(a.firstDownbeat! - 1.2)).toBeLessThan(0.002); expect(Math.abs(a.firstPulse - 0.2)).toBeLessThan(0.002)
  })
  it('12/8 em semínima pontuada (4 pulsos por compasso): com o 12/8 salvo, subdivisão 1 e 12/8', () => {
    const x = synthClick({ bpm: 50, seconds: 40, pulsesPerBar: 4, accent: 'bright', firstPulse: 0.3 })
    expect(analyzeClickTrack(x, 48000)!.pulsesPerBar).toBe(4)
    const a = analyzeClickTrack(x, 48000, '12/8')!
    expect(Math.abs(a.bpm - 50)).toBeLessThan(0.02); expect(a.subdivision).toBe(1); expect(a.pulsesPerBar).toBe(12)
    expect(Math.abs(a.firstDownbeat! - 0.3)).toBeLessThan(0.002)
  })
  it('12/8 em colcheias com acento só no 1: 12/8 com subdivisão 3, com ou sem o 12/8 salvo', () => {
    const x = synthClick({ bpm: 150, seconds: 40, pulsesPerBar: 12, accent: 'loud', firstPulse: 0 })
    for (const sig of [undefined, '12/8' as const]) {
      const a = analyzeClickTrack(x, 48000, sig)!
      expect(a.pulsesPerBar).toBe(12); expect(a.subdivision).toBe(3); expect(Math.abs(a.bpm - 50)).toBeLessThan(0.01)
    }
  })
  it('composto salvo e click sem acento: o andamento decide entre pontuada e colcheia', () => {
    const pontuada = analyzeClickTrack(synthClick({ bpm: 66, seconds: 30, pulsesPerBar: 2, accent: 'none', firstPulse: 0 }), 48000, '6/8')!
    expect(Math.abs(pontuada.bpm - 66)).toBeLessThan(0.02); expect(pontuada.subdivision).toBe(1); expect(pontuada.pulsesPerBar).toBeNull()
    const colcheia = analyzeClickTrack(synthClick({ bpm: 198, seconds: 30, pulsesPerBar: 6, accent: 'none', firstPulse: 0 }), 48000, '6/8')!
    expect(Math.abs(colcheia.bpm - 66)).toBeLessThan(0.01); expect(colcheia.subdivision).toBe(3); expect(colcheia.pulsesPerBar).toBeNull()
  })
  it('6/8 salvo por engano num 4/4 em colcheias (acento em cada semínima): as colcheias ficam colcheias', () => {
    // Visto nos clicks reais da MultiTracks: colcheias a 132 com acento a cada 2.
    const a = analyzeClickTrack(synthClick({ bpm: 132, seconds: 30, pulsesPerBar: 4, accent: 'every2', firstPulse: 0 }), 48000, '6/8')!
    expect(a.subdivision).toBe(3); expect(Math.abs(a.bpm - 44)).toBeLessThan(0.01); expect(a.pulsesPerBar).toBeNull()
  })
  it('compasso simples salvo não muda a leitura', () => {
    const x = synthClick({ bpm: 72.5, seconds: 40, pulsesPerBar: 4, accent: 'loud', firstPulse: 0.31 })
    expect(analyzeClickTrack(x, 48000, '4/4')).toEqual(analyzeClickTrack(x, 48000))
    expect(analyzeClickTrack(x, 48000, '3/4')).toEqual(analyzeClickTrack(x, 48000, null))
  })
})

describe('analyzeClickTrack: subdivisão e BPM em tempos', () => {
  it('click em semínima: subdivisão 1 e BPM igual aos pulsos', () => {
    const a = analyzeClickTrack(synthClick({ bpm: 120, seconds: 30, pulsesPerBar: 4, accent: 'loud', firstPulse: 0 }), 48000)!
    expect(a.subdivision).toBe(1); expect(a.compound).toBe(false); expect(Math.abs(a.bpm - 120)).toBeLessThan(0.02)
  })
  it('colcheias com acento em cada semínima: subdivisão 2, BPM da semínima, primeiro tempo no acentuado', () => {
    const a = analyzeClickTrack(synthClick({ bpm: 132, seconds: 30, pulsesPerBar: 4, accent: 'every2', firstPulse: 0.1, pickupPulses: 1 }), 48000)!
    expect(a.subdivision).toBe(2); expect(Math.abs(a.bpm - 66)).toBeLessThan(0.01); expect(a.pulsesPerBar).toBeNull()
    expect(Math.abs(a.firstPulse - (0.1 + 60 / 132))).toBeLessThan(0.002)
  })
  it('o BPM salvo desempata o acento a cada 2: igual aos pulsos é semínima com acento de 2 em 2', () => {
    const x = synthClick({ bpm: 132, seconds: 30, pulsesPerBar: 4, accent: 'every2', firstPulse: 0 })
    const semi = analyzeClickTrack(x, 48000, null, 132)!
    expect(semi.subdivision).toBe(1); expect(Math.abs(semi.bpm - 132)).toBeLessThan(0.02)
    expect(analyzeClickTrack(x, 48000, null, 66)!.subdivision).toBe(2)
    expect(analyzeClickTrack(x, 48000, null, 100)!.subdivision).toBe(2) // BPM salvo que não bate com nada: vale o padrão
  })
  it('acento a cada 8 colcheias: 4/4 com o 1 no acento; com o BPM salvo igual aos pulsos, acento de 2 em 2 compassos', () => {
    const x = synthClick({ bpm: 128, seconds: 40, pulsesPerBar: 8, accent: 'loud', firstPulse: 0.2 })
    const a = analyzeClickTrack(x, 48000)!
    expect(a.subdivision).toBe(2); expect(Math.abs(a.bpm - 64)).toBeLessThan(0.01); expect(a.pulsesPerBar).toBe(4); expect(a.accent).toBe('loud')
    expect(Math.abs(a.firstDownbeat! - 0.2)).toBeLessThan(0.002)
    const b = analyzeClickTrack(x, 48000, null, 128)!
    expect(b.subdivision).toBe(1); expect(Math.abs(b.bpm - 128)).toBeLessThan(0.02); expect(b.pulsesPerBar).toBe(4)
    expect(analyzeClickTrack(x, 48000, '4/4', 128)!.subdivision).toBe(1)
  })
  it('semínimas acentuadas e o 1 mais agudo a cada 8 colcheias: 4/4 em colcheias', () => {
    const a = analyzeClickTrack(synthClick({ bpm: 210, seconds: 30, pulsesPerBar: 8, accent: 'beatsAndOne', firstPulse: 0, pickupPulses: 2 }), 48000)!
    expect(a.subdivision).toBe(2); expect(Math.abs(a.bpm - 105)).toBeLessThan(0.01); expect(a.pulsesPerBar).toBe(4); expect(a.accent).toBe('bright')
    expect(Math.abs(a.firstDownbeat! - 2 * 60 / 210)).toBeLessThan(0.002)
  })
  it('acento a cada 6 colcheias: o BPM salvo separa 3/4 em colcheias de 6/8', () => {
    const x = synthClick({ bpm: 140, seconds: 40, pulsesPerBar: 6, accent: 'loud', firstPulse: 0 })
    const sem = analyzeClickTrack(x, 48000)!
    expect(sem.pulsesPerBar).toBe(6); expect(sem.subdivision).toBe(3); expect(Math.abs(sem.bpm - 140 / 3)).toBeLessThan(0.01)
    const tres = analyzeClickTrack(x, 48000, null, 70)!
    expect(tres.pulsesPerBar).toBe(3); expect(tres.subdivision).toBe(2); expect(Math.abs(tres.bpm - 70)).toBeLessThan(0.01)
    expect(analyzeClickTrack(x, 48000, '3/4')!).toMatchObject({ pulsesPerBar: 3, subdivision: 2 })
  })
  it('colcheias sem acento: o BPM salvo diz a subdivisão', () => {
    const x = synthClick({ bpm: 138, seconds: 30, pulsesPerBar: 4, accent: 'none', firstPulse: 0 })
    expect(analyzeClickTrack(x, 48000)!.subdivision).toBe(1)
    const a = analyzeClickTrack(x, 48000, null, 69)!
    expect(a.subdivision).toBe(2); expect(Math.abs(a.bpm - 69)).toBeLessThan(0.01)
  })
  it('acento a cada 2 abaixo de 100 pulsos por minuto não é subdivisão', () => {
    const a = analyzeClickTrack(synthClick({ bpm: 80, seconds: 30, pulsesPerBar: 4, accent: 'every2', firstPulse: 0 }), 48000)!
    expect(a.subdivision).toBe(1); expect(Math.abs(a.bpm - 80)).toBeLessThan(0.02)
  })
})

describe('analyzeClickTrack: de onde vem o "1"', () => {
  // Sem acento que feche o compasso, o "1" é assumido no primeiro tempo (`firstPulse`): a T27
  // usa o 1 das seções marcadas quando houver e mostra o compasso assumido em âmbar.
  it('acento no 1: "accent" e o 1 no acento', () => {
    const a = analyzeClickTrack(synthClick({ bpm: 120, seconds: 30, pulsesPerBar: 4, accent: 'loud', firstPulse: 0.2, pickupPulses: 1 }), 48000)!
    expect(a.downbeatSource).toBe('accent'); expect(Math.abs(a.firstDownbeat! - 0.7)).toBeLessThan(0.002)
  })
  it('sem acento, acento só nos tempos ou composto salvo sem acento: "assumed", compasso e 1 nulos', () => {
    const casos = [
      analyzeClickTrack(synthClick({ bpm: 100, seconds: 30, pulsesPerBar: 4, accent: 'none', firstPulse: 0.3 }), 48000)!,
      analyzeClickTrack(synthClick({ bpm: 132, seconds: 30, pulsesPerBar: 4, accent: 'every2', firstPulse: 0.3 }), 48000)!,
      analyzeClickTrack(synthClick({ bpm: 198, seconds: 30, pulsesPerBar: 6, accent: 'none', firstPulse: 0.3 }), 48000, '6/8')!,
    ]
    for (const a of casos) {
      expect(a.downbeatSource).toBe('assumed'); expect(a.pulsesPerBar).toBeNull(); expect(a.firstDownbeat).toBeNull()
      expect(Math.abs(a.firstPulse - 0.3)).toBeLessThan(0.002)
    }
  })
})

describe('da faixa de click à grade do palco', () => {
  const gridOf = (a: ClickAnalysis) => { const like: ClickAnalysisLike = a; return gridFromClick(like) }
  it('4/4 em colcheias com cada tempo acentuado: grade e contagem em semínimas', () => {
    const grid = gridOf(analyzeClickTrack(synthClick({ bpm: 132, seconds: 30, pulsesPerBar: 4, accent: 'every2', firstPulse: 0 }), 48000)!)
    expect(Math.abs(grid.bpm - 66)).toBeLessThan(0.01); expect(countPulses(grid.signature, grid.countEvery)).toBe(4)
    expect(Math.abs(barSeconds(grid) - 4 * 60 / 66)).toBeLessThan(0.001)
  })
  it('6/8 em colcheias: grade em colcheias, contagem de 2 tempos, compasso de 6 colcheias', () => {
    const grid = gridOf(analyzeClickTrack(synthClick({ bpm: 180, seconds: 30, pulsesPerBar: 6, accent: 'loud', firstPulse: 0 }), 48000)!)
    expect(grid.signature).toBe('6/8'); expect(Math.abs(grid.bpm - 180)).toBeLessThan(0.02)
    expect(countPulses(grid.signature, grid.countEvery)).toBe(2); expect(Math.abs(barSeconds(grid) - 2)).toBeLessThan(0.001)
  })
  it('6/8 em pontuada lido com o 6/8 salvo: a mesma grade do 6/8 em colcheias', () => {
    const a = analyzeClickTrack(synthClick({ bpm: 60, seconds: 30, pulsesPerBar: 2, accent: 'loud', firstPulse: 0 }), 48000, '6/8')!
    const grid = gridFromClick(a, '6/8')
    expect(Math.abs(grid.bpm - 180)).toBeLessThan(0.05); expect(countPulses(grid.signature, grid.countEvery)).toBe(2)
    expect(Math.abs(barSeconds(grid) - 2)).toBeLessThan(0.001)
  })
})

describe('analyzeClickTrack: o resto do contrato', () => {
  it('devolve o primeiro pulso, os ataques usados e o traço do acento', () => {
    const a = analyzeClickTrack(synthClick({ bpm: 120, seconds: 30, pulsesPerBar: 4, accent: 'loud', firstPulse: 0.2, pickupPulses: 2 }), 48000)!
    expect(Math.abs(a.firstPulse - 0.2)).toBeLessThan(0.002)
    expect(a.onsets).toBe(60)
    expect(a.accent).toBe('loud')
    const b = analyzeClickTrack(synthClick({ bpm: 90, seconds: 30, pulsesPerBar: 3, accent: 'bright', firstPulse: 0.1 }), 48000)!
    expect(b.accent).toBe('bright')
    expect(Math.abs(b.firstDownbeat! - 0.1)).toBeLessThan(0.002)
  })
  it('sem acento o "1" e o traço ficam nulos', () => {
    const a = analyzeClickTrack(synthClick({ bpm: 100, seconds: 30, pulsesPerBar: 4, accent: 'none', firstPulse: 0.5 }), 48000)!
    expect(a.firstDownbeat).toBeNull(); expect(a.accent).toBeNull()
    expect(Math.abs(a.firstPulse - 0.5)).toBeLessThan(0.002)
  })
  it('5/4, 7/8 e 12/8 com acento só no 1', () => {
    expect(analyzeClickTrack(synthClick({ bpm: 110, seconds: 40, pulsesPerBar: 5, accent: 'loud', firstPulse: 0 }), 48000)!.pulsesPerBar).toBe(5)
    expect(analyzeClickTrack(synthClick({ bpm: 150, seconds: 40, pulsesPerBar: 7, accent: 'bright', firstPulse: 0 }), 48000)!.pulsesPerBar).toBe(7)
    expect(analyzeClickTrack(synthClick({ bpm: 180, seconds: 40, pulsesPerBar: 12, accent: 'loud', firstPulse: 0 }), 48000)!.pulsesPerBar).toBe(12)
  })
  it('menos de 4 compassos na fase do 1 não marca compasso', () => {
    // 4,5 s a 120 BPM em 4/4: 9 ataques, só 3 deles no "1".
    const a = analyzeClickTrack(synthClick({ bpm: 120, seconds: 4.5, pulsesPerBar: 4, accent: 'loud', firstPulse: 0 }), 48000)!
    expect(a.pulsesPerBar).toBeNull(); expect(Math.abs(a.bpm - 120)).toBeLessThan(0.05)
  })
  it('menos de 8 ataques e ataques sem pulso regular dão nulo', () => {
    expect(analyzeClickTrack(synthClick({ bpm: 60, seconds: 6, pulsesPerBar: 4, accent: 'loud', firstPulse: 0.5 }), 48000)).toBeNull()
    // Ataques espalhados ao acaso: a maioria não cai em grade nenhuma.
    const x = new Float32Array(SR * 20)
    const rand = seeded(3)
    for (let t = 0.1; t < 19.5; t += 0.15 + rand() * 0.9) {
      const start = Math.round(t * SR)
      for (let i = 0; i < 600; i++) x[start + i] += BASE_AMP * Math.exp(-i / SR / 0.008) * Math.sin(2 * Math.PI * 1200 * i / SR)
    }
    expect(analyzeClickTrack(x, SR)).toBeNull()
  })
  it('click longo com ataques de sons diferentes não escorrega da grade', () => {
    // Visto nos clicks reais: cada tempo do compasso tem um som e o ataque de cada um é
    // detectado com um atraso um pouco diferente. A mediana dos intervalos sai torta por
    // frações de ms e, num arquivo de 6 min, o índice calculado só com ela escorrega da grade.
    const x = synthClick({ bpm: 140, seconds: 360, pulsesPerBar: 4, accent: 'loud', firstPulse: 0, beatOffsetsMs: [0, 0.5, 1, 1.5] })
    const a = analyzeClickTrack(x, 48000)!
    expect(a).not.toBeNull()
    expect(Math.abs(a.bpm - 140)).toBeLessThan(0.02); expect(a.pulsesPerBar).toBe(4); expect(a.onsets).toBe(840)
    expect(Math.abs(a.firstDownbeat! - 0.00075)).toBeLessThan(0.002)
  })
  it('10 min a 72,5 BPM: a grade cai a menos de 5 ms do último pulso real', () => {
    // 0,02 BPM de erro dariam ~166 ms aos 10 min: o BPM tem de sair da reta sobre todos os
    // pulsos. A grade é a que o palco monta: primeiro pulso + k * 60 / bpm.
    for (const extra of [{}, { jitterMs: 1, beatOffsetsMs: [0, 0.5, 1, 1.5] }]) {
      const { samples, times } = synthClickWithTimes({ bpm: 72.5, seconds: 600, pulsesPerBar: 4, accent: 'loud', firstPulse: 0.31, ...extra })
      const a = analyzeClickTrack(samples, 48000)!
      const k = times.length - 1
      const errLast = Math.abs(a.firstPulse + k * 60 / a.bpm - times[k])
      const errDownbeat = Math.abs(a.firstDownbeat! + Math.floor(k / 4) * 4 * 60 / a.bpm - times[Math.floor(k / 4) * 4])
      expect(times[k]).toBeGreaterThan(599)
      expect(errLast).toBeLessThan(0.005); expect(errDownbeat).toBeLessThan(0.005)
    }
  })
  it('outra taxa de amostragem dá o mesmo tempo', () => {
    // O mesmo click reamostrado por vizinho mais perto pra 44,1 kHz.
    const x48 = synthClick({ bpm: 128, seconds: 30, pulsesPerBar: 4, accent: 'loud', firstPulse: 0.25 })
    const x44 = new Float32Array(Math.floor(x48.length * 44100 / SR))
    for (let i = 0; i < x44.length; i++) x44[i] = x48[Math.round(i * SR / 44100)] ?? 0
    const a = analyzeClickTrack(x44, 44100)!
    expect(Math.abs(a.bpm - 128)).toBeLessThan(0.02); expect(a.pulsesPerBar).toBe(4); expect(Math.abs(a.firstDownbeat! - 0.25)).toBeLessThan(0.002)
  })
})

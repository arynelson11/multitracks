import { describe, expect, it } from 'vitest'
import { analyzeClickTrack } from './clickMeter'

// Gerador de click sintético a 48 kHz: bipe senoidal de 25 ms com queda exponencial.
// `loud` = acento com 1,8x a amplitude; `bright` = acento com a mesma amplitude em 2400 Hz
// (o normal é 1200 Hz); `every2` = acento forte a cada 2 pulsos; `none` = todos iguais.
// `pickupPulses` = pulsos de anacruse antes do primeiro "1"; `jitterMs` = desvio sorteado
// (uniforme, semente fixa) de cada pulso; `gap` = trecho [início, fim) em segundos sem click.
const SR = 48000
const BEEP_S = 0.025
const BASE_AMP = 0.4

interface SynthClickOptions {
  bpm: number
  seconds: number
  pulsesPerBar: number
  accent: 'loud' | 'bright' | 'none' | 'every2'
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
  const out = new Float32Array(Math.round(o.seconds * SR))
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
    const isOne = beat === 0
    const isEven = (((k - pickup) % 2) + 2) % 2 === 0
    let amp = BASE_AMP
    let freq = 1200
    if (o.accent === 'loud' && isOne) amp *= 1.8
    if (o.accent === 'every2' && isEven) amp *= 1.8
    if (o.accent === 'bright' && isOne) freq = 2400
    const start = Math.round(t * SR)
    for (let i = 0; i < beepLen && start + i < out.length; i++) {
      const s = i / SR
      out[start + i] += amp * Math.exp(-s / 0.008) * Math.sin(2 * Math.PI * freq * s)
    }
  }
  return out
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
  it('outra taxa de amostragem dá o mesmo tempo', () => {
    // O mesmo click reamostrado por vizinho mais perto pra 44,1 kHz.
    const x48 = synthClick({ bpm: 128, seconds: 30, pulsesPerBar: 4, accent: 'loud', firstPulse: 0.25 })
    const x44 = new Float32Array(Math.floor(x48.length * 44100 / SR))
    for (let i = 0; i < x44.length; i++) x44[i] = x48[Math.round(i * SR / 44100)] ?? 0
    const a = analyzeClickTrack(x44, 44100)!
    expect(Math.abs(a.bpm - 128)).toBeLessThan(0.02); expect(a.pulsesPerBar).toBe(4); expect(Math.abs(a.firstDownbeat! - 0.25)).toBeLessThan(0.002)
  })
})

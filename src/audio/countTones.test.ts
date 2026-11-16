import { describe, expect, it } from 'vitest'
import { asAudioContext, createFakeAudioContext, nodesOf, reaches, valueAt, type FakeGraphItem } from '../test/fakeAudio'
import { COUNT_TONE, scheduleCount } from './countTones'

describe('COUNT_TONE', () => {
  it('é a receita vCount do protótipo v6', () => {
    expect(COUNT_TONE).toEqual({ accentHz: 1319, beatHz: 988, accentPeak: 0.85, beatPeak: 0.68, attack: 0.004, hold: 0.075, release: 0.19, lowpassHz: 5200, squareMix: 0.1 })
  })
})

describe('scheduleCount', () => {
  it('bipes nos tempos, acento no 1, só no destino', () => {
    const ctx = createFakeAudioContext(); const dest = ctx.createGain()
    scheduleCount(asAudioContext(ctx), dest, [{ at: 6, label: 1 }, { at: 6.5, label: 2 }])
    const oscs = nodesOf(ctx, 'OscillatorNode')
    expect(oscs.map((o) => o.frequency.value)).toEqual([1319, 2638, 988, 1976]); expect(oscs.map((o) => o.starts[0].when)).toEqual([6, 6, 6.5, 6.5])
    expect(oscs.every((o) => reaches(o, dest))).toBe(true); expect(oscs.some((o) => reaches(o, ctx.destination))).toBe(false)
  })
  it('triângulo na frequência e quadrada no dobro a 0,1, as duas param juntas depois da queda', () => {
    const ctx = createFakeAudioContext(); const dest = ctx.createGain()
    scheduleCount(asAudioContext(ctx), dest, [{ at: 6, label: 3 }])
    const [tri, sq] = nodesOf(ctx, 'OscillatorNode')
    expect(tri.type).toBe('triangle'); expect(sq.type).toBe('square')
    // A quadrada passa por um ganho fixo de squareMix antes do envelope; o triângulo vai direto.
    const mix = nodesOf(ctx, 'GainNode').find((g) => sq.connections.some((c) => c.to === g))!
    expect(valueAt(mix.gain, 6)).toBe(COUNT_TONE.squareMix)
    expect(tri.connections.some((c) => c.to === mix)).toBe(false)
    expect(tri.stops).toEqual(sq.stops); expect(tri.stops).toHaveLength(1)
    expect(tri.stops[0]).toBeGreaterThan(6 + COUNT_TONE.release)
  })
  it('envelope: sobe em 4 ms até o pico, segura até 75 ms e cai exponencial até 190 ms', () => {
    const ctx = createFakeAudioContext(); const dest = ctx.createGain()
    scheduleCount(asAudioContext(ctx), dest, [{ at: 6, label: 1 }, { at: 6.5, label: 2 }])
    const [tri1, , tri2] = nodesOf(ctx, 'OscillatorNode')
    const envOf = (osc: typeof tri1) => nodesOf(ctx, 'GainNode').find((g) => osc.connections.some((c) => c.to === g))!
    const e1 = envOf(tri1); const e2 = envOf(tri2)
    expect(e1.gain.events).toEqual([
      { kind: 'set', value: 0, time: 6 },
      { kind: 'linear', value: 0.85, time: 6 + 0.004 },
      { kind: 'set', value: 0.85, time: 6 + 0.075 },
      { kind: 'exp', value: expect.any(Number), time: 6 + 0.19 },
    ])
    expect(valueAt(e1.gain, 6)).toBe(0); expect(valueAt(e1.gain, 6.004)).toBe(0.85); expect(valueAt(e1.gain, 6.05)).toBe(0.85)
    expect(valueAt(e1.gain, 6.19)).toBeLessThan(0.001)
    expect(valueAt(e2.gain, 6.504)).toBe(0.68)
  })
  it('passa-baixa em 5200 Hz é o último nó antes do destino', () => {
    const ctx = createFakeAudioContext(); const dest = ctx.createGain()
    scheduleCount(asAudioContext(ctx), dest, [{ at: 6, label: 1 }])
    const filters = nodesOf(ctx, 'BiquadFilterNode')
    expect(filters).toHaveLength(1)
    const [lp] = filters
    expect(lp.type).toBe('lowpass'); expect(valueAt(lp.frequency, 6)).toBe(5200)
    expect(lp.connections).toEqual([{ to: dest, output: 0, input: 0 }])
    // Nada além do filtro liga fora do bipe: o único caminho até o destino passa por ele.
    const outside = ctx.created.filter((c) => c.node !== lp).flatMap((c) => (c.node as typeof lp).connections)
    expect(outside.some((c) => c.to === dest)).toBe(false)
  })
  it('bipe no passado é pulado e os que restam mantêm o número real do tempo', () => {
    const ctx = createFakeAudioContext(); const dest = ctx.createGain()
    ctx.currentTime = 6.2
    const count = scheduleCount(asAudioContext(ctx), dest, [{ at: 6, label: 1 }, { at: 6.5, label: 2 }, { at: 7, label: 3 }])
    expect(count.beats).toEqual([{ at: 6.5, label: 2 }, { at: 7, label: 3 }])
    const oscs = nodesOf(ctx, 'OscillatorNode')
    expect(oscs.map((o) => o.starts[0].when)).toEqual([6.5, 6.5, 7, 7])
    expect(oscs.map((o) => o.frequency.value)).toEqual([988, 1976, 988, 1976])
  })
  it('bipe exatamente no instante atual toca', () => {
    const ctx = createFakeAudioContext(); const dest = ctx.createGain()
    ctx.currentTime = 6
    expect(scheduleCount(asAudioContext(ctx), dest, [{ at: 6, label: 1 }]).beats).toHaveLength(1)
  })
  it('cancel duas vezes não lança', () => {
    const ctx = createFakeAudioContext(); const dest = ctx.createGain()
    const count = scheduleCount(asAudioContext(ctx), dest, [{ at: 6, label: 1 }])
    expect(() => { count.cancel(5); count.cancel(5.5) }).not.toThrow()
  })
  it('lista vazia, ou só com bipes passados, não cria nó', () => {
    const ctx = createFakeAudioContext(); const dest = ctx.createGain()
    ctx.currentTime = 9
    const before = ctx.created.length
    expect(scheduleCount(asAudioContext(ctx), dest, []).beats).toEqual([])
    expect(scheduleCount(asAudioContext(ctx), dest, [{ at: 8, label: 1 }]).beats).toEqual([])
    expect(ctx.created.length).toBe(before)
  })
  it('ao terminar, cada bipe desliga os próprios nós', () => {
    const ctx = createFakeAudioContext(); const dest = ctx.createGain()
    scheduleCount(asAudioContext(ctx), dest, [{ at: 6, label: 1 }, { at: 6.5, label: 2 }])
    const [tri1, , tri2] = nodesOf(ctx, 'OscillatorNode')
    tri1.dispatchEvent(new Event('ended'))
    expect(reaches(tri1, dest)).toBe(false)
    expect(reaches(tri2, dest)).toBe(true)
    expect(nodesOf(ctx, 'BiquadFilterNode').map((f) => f.connections.length)).toEqual([0, 1])
  })
})

describe('scheduleCount: cancel sem estalo', () => {
  // Contagem de 4 em 6, 6,5, 7 e 7,5; cancelada em 6,55, com o bipe de 6,5 segurando o pico 0,68.
  const NOW = 6.55
  const setup = (opts: { withoutHold?: boolean } = {}) => {
    const ctx = createFakeAudioContext(); const dest = ctx.createGain()
    ctx.currentTime = 5.8
    const count = scheduleCount(asAudioContext(ctx), dest, [{ at: 6, label: 1 }, { at: 6.5, label: 2 }, { at: 7, label: 3 }, { at: 7.5, label: 4 }])
    const oscs = nodesOf(ctx, 'OscillatorNode')
    const beep = (i: number) => {
      const tri = oscs[2 * i]; const sq = oscs[2 * i + 1]
      const env = nodesOf(ctx, 'GainNode').find((g) => tri.connections.some((c) => c.to === g))!
      return { tri, sq, env, lp: nodesOf(ctx, 'BiquadFilterNode')[i] }
    }
    // Firefox não tem cancelAndHoldAtTime: o cancel cai em cancelScheduledValues + setValueAtTime.
    if (opts.withoutHold) for (const i of [0, 1, 2, 3]) Object.defineProperty(beep(i).env.gain, 'cancelAndHoldAtTime', { value: undefined })
    ctx.currentTime = NOW
    return { ctx, dest, count, beep }
  }
  type Beep = ReturnType<ReturnType<typeof setup>['beep']>
  // O que chega no destino no instante t: o envelope, mas zero depois que os osciladores param ou
  // que o bipe é desligado (desligar vale na hora da chamada, ou seja, em NOW).
  const heard = (b: Beep, dest: FakeGraphItem) => {
    const cutAt = reaches(b.tri, dest) ? Number.POSITIVE_INFINITY : NOW
    const stopAt = Math.min(b.tri.stops.at(-1)!, b.sq.stops.at(-1)!)
    return (t: number) => (t < b.tri.starts[0].when || t >= cutAt || t >= stopAt ? 0 : valueAt(b.env.gain, t))
  }
  // Maior queda por amostra que a rampa de 5 ms permite (do pico do acento até 0).
  const worstDrop = (g: (t: number) => number, sr: number) => {
    let worst = 0; let prev = g(NOW - 1 / sr)
    for (let k = 0; k <= 0.03 * sr; k++) { const v = g(NOW + k / sr); worst = Math.max(worst, prev - v); prev = v }
    return worst
  }

  for (const withoutHold of [false, true]) {
    it(`bipe soando desce até 0 em 5 ms, sem degrau, e só depois para${withoutHold ? ' (sem cancelAndHoldAtTime)' : ''}`, () => {
      const { ctx, dest, count, beep } = setup({ withoutHold })
      count.cancel(NOW)
      const b = beep(1)
      expect(reaches(b.tri, dest)).toBe(true) // continua ligado até o ended
      const g = heard(b, dest)
      expect(g(NOW)).toBeCloseTo(0.68, 10)
      expect(valueAt(b.env.gain, NOW + 0.005)).toBe(0)
      expect(worstDrop(g, ctx.sampleRate)).toBeLessThanOrEqual(COUNT_TONE.accentPeak / (0.005 * ctx.sampleRate) + 1e-12)
      expect(b.tri.stops.at(-1)).toBeCloseTo(NOW + 0.01, 12); expect(b.sq.stops.at(-1)).toBeCloseTo(NOW + 0.01, 12)
      expect(g(NOW + 0.01)).toBe(0)
    })
  }
  it('bipe que ainda não começou para em now e desliga na hora; o que já acabou só desliga', () => {
    const { dest, count, beep } = setup()
    count.cancel(NOW)
    for (const i of [2, 3]) {
      const b = beep(i)
      expect(b.tri.stops.at(-1)).toBe(NOW); expect(b.sq.stops.at(-1)).toBe(NOW)
      expect(reaches(b.tri, dest)).toBe(false); expect(b.lp.connections).toHaveLength(0)
    }
    const passado = beep(0)
    expect(passado.tri.stops).toHaveLength(1); expect(reaches(passado.tri, dest)).toBe(false)
  })
  it('depois do ended do bipe que descia nada fica ligado', () => {
    const { ctx, count, beep } = setup()
    count.cancel(NOW)
    beep(1).tri.dispatchEvent(new Event('ended'))
    expect(ctx.created.every((c) => (c.node as { connections: unknown[] }).connections.length === 0)).toBe(true)
  })
  it('o corte antigo (parar e desligar em now) seria um degrau: o teste de queda pega', () => {
    const { ctx, dest, count, beep } = setup()
    const b = beep(1)
    const g = heard(b, dest) // antes do cancel: o bipe inteiro
    expect(worstDrop((t) => (t >= NOW ? 0 : g(t)), ctx.sampleRate)).toBeGreaterThan(0.5)
    count.cancel(NOW)
  })
})

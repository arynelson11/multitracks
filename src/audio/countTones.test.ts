import { describe, expect, it } from 'vitest'
import { asAudioContext, createFakeAudioContext, nodesOf, reaches, valueAt } from '../test/fakeAudio'
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
  it('cancel para tudo em now e desliga os nós', () => {
    const ctx = createFakeAudioContext(); const dest = ctx.createGain()
    ctx.currentTime = 5.8
    const count = scheduleCount(asAudioContext(ctx), dest, [{ at: 6, label: 1 }, { at: 6.5, label: 2 }, { at: 7, label: 3 }, { at: 7.5, label: 4 }])
    ctx.currentTime = 6.6
    count.cancel(6.6)
    const oscs = nodesOf(ctx, 'OscillatorNode')
    expect(oscs).toHaveLength(8)
    expect(oscs.every((o) => o.stops.at(-1) === 6.6)).toBe(true)
    expect(ctx.created.every((c) => (c.node as { connections: unknown[] }).connections.length === 0)).toBe(true)
    expect(oscs.some((o) => reaches(o, dest))).toBe(false)
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

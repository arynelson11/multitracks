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
    expect(tri.stops[0]).toBeCloseTo(6.22, 12) // v6: param em t + 0,22, 30 ms depois do fim da queda
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
      { kind: 'exp', value: 0.0005, time: 6 + 0.19 },
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
    expect(lp.type).toBe('lowpass'); expect(valueAt(lp.frequency, 6)).toBe(5200); expect(valueAt(lp.Q, 6)).toBe(0.7)
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
  // Mesmo cenário do scripts/verify-audio/count-cancel.mjs (Chrome real): um bipe em 0,5 s a
  // 48 kHz, cancelado em cada quantum de 128 amostras ao longo dele (82 instantes, do ataque
  // até a parada).
  const SR = 48000
  const AT = 0.5
  const MAX_STEP = 0.01
  const instants: number[] = []
  for (let k = Math.ceil((AT * SR) / 128); (k * 128) / SR < AT + 0.22; k++) instants.push((k * 128) / SR)

  // 'nativo': o cancelAndHoldAtTime do fake, que segue o algoritmo da especificação (como o
  // Chrome e o Safari): só insere evento em tc quando uma rampa cruza tc. 'sem': o Firefox.
  type Hold = 'nativo' | 'sem cancelAndHoldAtTime'
  const setup = (label: number, now: number, hold: Hold) => {
    const ctx = createFakeAudioContext({ sampleRate: SR }); const dest = ctx.createGain()
    ctx.currentTime = 0.3
    const count = scheduleCount(asAudioContext(ctx), dest, [{ at: AT, label }])
    const [tri, sq] = nodesOf(ctx, 'OscillatorNode')
    const env = nodesOf(ctx, 'GainNode').find((g) => tri.connections.some((c) => c.to === g))!
    if (hold !== 'nativo') Object.defineProperty(env.gain, 'cancelAndHoldAtTime', { value: undefined })
    const played = valueAt(env.gain, now - 1 / SR) // a amostra de antes do cancel já saiu
    ctx.currentTime = now
    return { ctx, dest, count, tri, sq, env, played }
  }
  type Setup = ReturnType<typeof setup>
  // O que chega no destino em t: o envelope; zero antes do início, depois da parada dos
  // osciladores ou depois de desligado (desligar vale na hora da chamada, em now).
  const heard = (s: Setup, now: number) => {
    const cutAt = reaches(s.tri, s.dest) ? Number.POSITIVE_INFINITY : now
    const stopAt = Math.min(s.tri.stops.at(-1)!, s.sq.stops.at(-1)!)
    return (t: number) => (t < s.tri.starts[0].when || t >= cutAt || t >= stopAt ? 0 : valueAt(s.env.gain, t))
  }
  // Maior mudança de uma amostra pra outra, da última que saiu antes do cancel até 21 ms depois.
  const worstStep = (s: Setup, now: number, g = heard(s, now)) => {
    let worst = 0; let prev = s.played
    for (let k = 0; k <= 0.021 * SR; k++) { const v = g(now + k / SR); worst = Math.max(worst, Math.abs(v - prev)); prev = v }
    return worst
  }

  for (const hold of ['nativo', 'sem cancelAndHoldAtTime'] as const) {
    for (const label of [1, 2]) {
      it(`${label === 1 ? 'acento' : 'tempo 2'}, cancelAndHoldAtTime ${hold === 'nativo' ? 'pela especificação' : 'ausente'}: em nenhum dos 82 instantes o envelope muda mais que 0,01 por amostra, e os osciladores param depois da descida`, () => {
        expect(instants).toHaveLength(82)
        const bad: string[] = []; const wrongStop: string[] = []
        for (const now of instants) {
          const s = setup(label, now, hold)
          s.count.cancel(now)
          const step = worstStep(s, now)
          if (step > MAX_STEP) bad.push(`${now.toFixed(4)}: ${step.toFixed(4)}`)
          const stops = [s.tri.stops.at(-1)!, s.sq.stops.at(-1)!]
          if (stops.some((t) => Math.abs(t - (now + 0.02)) > 1e-12)) wrongStop.push(`${now.toFixed(4)}: ${stops.join('/')}`)
          expect(valueAt(s.env.gain, now + 0.02)).toBeLessThan(1e-3) // a parada cai em silêncio
          expect(reaches(s.tri, s.dest)).toBe(true) // quem desliga é o ended
        }
        expect(bad).toEqual([])
        expect(wrongStop).toEqual([])
      })
    }
  }
  it('controle: a rampa linear depois do cancelAndHoldAtTime (rodada 1) dá degrau pela especificação, como no Chrome', () => {
    const now = (210 * 128) / SR // sustentação do bipe
    const s = setup(2, now, 'nativo')
    s.env.gain.cancelAndHoldAtTime(now); s.env.gain.linearRampToValueAtTime(0, now + 0.005)
    expect(worstStep(s, now, (t) => valueAt(s.env.gain, t))).toBeGreaterThan(0.5)
  })
  it('sem cancelAndHoldAtTime: rampa em curso volta a terminar em now com o valor da receita (não o do getter), fora de rampa um set', () => {
    const cases = [[188, 'linear'], [210, 'set'], [230, 'exp'], [262, 'set']] as const // ataque, sustentação, queda e piso
    for (const [k, kind] of cases) {
      const now = (k * 128) / SR
      const s = setup(1, now, 'sem cancelAndHoldAtTime')
      const expected = valueAt(s.env.gain, now)
      Object.defineProperty(s.env.gain, 'value', { get: () => 1 })
      s.count.cancel(now)
      const held = s.env.gain.events.filter((e) => e.time === now && e.kind !== 'cancel' && e.kind !== 'target')
      expect(held).toHaveLength(1)
      expect(held[0].kind).toBe(kind)
      expect(held[0].value).toBeCloseTo(expected, 9)
      expect(s.env.gain.events.at(-1)).toEqual(expect.objectContaining({ kind: 'target', value: 0, time: now }))
    }
  })

  // Contagem de 4 em 6, 6,5, 7 e 7,5, cancelada em 6,55 (o bipe de 6,5 soando).
  const NOW = 6.55
  const setup4 = () => {
    const ctx = createFakeAudioContext(); const dest = ctx.createGain()
    ctx.currentTime = 5.8
    const count = scheduleCount(asAudioContext(ctx), dest, [{ at: 6, label: 1 }, { at: 6.5, label: 2 }, { at: 7, label: 3 }, { at: 7.5, label: 4 }])
    const oscs = nodesOf(ctx, 'OscillatorNode')
    const beep = (i: number) => ({ tri: oscs[2 * i], sq: oscs[2 * i + 1], lp: nodesOf(ctx, 'BiquadFilterNode')[i] })
    ctx.currentTime = NOW
    return { ctx, dest, count, beep }
  }
  it('bipe que ainda não começou para em now e desliga na hora; o que já acabou só desliga', () => {
    const { dest, count, beep } = setup4()
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
    const { ctx, count, beep } = setup4()
    count.cancel(NOW)
    beep(1).tri.dispatchEvent(new Event('ended'))
    expect(ctx.created.every((c) => (c.node as { connections: unknown[] }).connections.length === 0)).toBe(true)
  })
})

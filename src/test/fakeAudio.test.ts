import { describe, expect, it, vi } from 'vitest'
import { FakeAudioBuffer, FakeWorkletNode, connectedTo, createFakeAudioContext, nodesOf, reaches, valueAt } from './fakeAudio'

const domError = (name: string) => expect.objectContaining({ name })

describe('AudioParam falso', () => {
  it('grava start, stop e rampas e calcula valueAt', () => {
    const ctx = createFakeAudioContext(); const g = ctx.createGain()
    g.gain.setValueAtTime(1, 2); g.gain.linearRampToValueAtTime(0, 2.01)
    expect(valueAt(g.gain, 2.005)).toBeCloseTo(0.5, 5)
    const s = ctx.createBufferSource(); s.start(3, 1.5); s.stop(4)
    expect(s.starts).toEqual([{ when: 3, offset: 1.5 }]); expect(s.stops).toEqual([4])
  })
  it('grava os eventos na ordem, com o tipo de cada um', () => {
    const ctx = createFakeAudioContext(); const p = ctx.createGain().gain
    p.setValueAtTime(0, 1).linearRampToValueAtTime(1, 2).exponentialRampToValueAtTime(0.5, 3)
    p.setTargetAtTime(0, 4, 0.1); p.cancelScheduledValues(5)
    expect(p.events).toEqual([
      { kind: 'set', value: 0, time: 1 }, { kind: 'linear', value: 1, time: 2 }, { kind: 'exp', value: 0.5, time: 3 },
      { kind: 'target', value: 0, time: 4, timeConstant: 0.1 }, { kind: 'cancel', time: 5 },
    ])
  })
  it('valueAt: antes de tudo vale o padrão; set, linear e exp pelo tempo', () => {
    const ctx = createFakeAudioContext(); const p = ctx.createGain().gain
    p.setValueAtTime(0.2, 1); p.linearRampToValueAtTime(1, 2); p.exponentialRampToValueAtTime(0.25, 4)
    expect(valueAt(p, 0.5)).toBe(1)
    expect(valueAt(p, 1)).toBe(0.2)
    expect(valueAt(p, 1.5)).toBeCloseTo(0.6, 10)
    expect(valueAt(p, 2)).toBe(1)
    expect(valueAt(p, 3)).toBeCloseTo(0.5, 10)
    expect(valueAt(p, 4)).toBe(0.25)
    expect(valueAt(p, 99)).toBe(0.25)
  })
  it('valueAt: alvo exponencial e constante de tempo zero', () => {
    const ctx = createFakeAudioContext(); const p = ctx.createGain().gain
    p.setValueAtTime(1, 0); p.setTargetAtTime(0, 1, 0.5)
    expect(valueAt(p, 1)).toBe(1)
    expect(valueAt(p, 1.5)).toBeCloseTo(Math.exp(-1), 10)
    p.setValueAtTime(0.7, 3)
    expect(valueAt(p, 3)).toBe(0.7)
    const q = ctx.createGain().gain
    q.setTargetAtTime(0.3, 2, 0)
    expect(valueAt(q, 1.9)).toBe(1); expect(valueAt(q, 2)).toBe(0.3)
  })
  it('valueAt: exp com sinais trocados segura o valor até o fim', () => {
    const ctx = createFakeAudioContext(); const p = ctx.createStereoPanner().pan
    p.setValueAtTime(-1, 0); p.exponentialRampToValueAtTime(1, 2)
    expect(valueAt(p, 1)).toBe(-1); expect(valueAt(p, 2)).toBe(1)
  })
  it('valueAt: cancel tira os eventos dali pra frente, inclusive a rampa que cruza o instante', () => {
    const ctx = createFakeAudioContext(); const p = ctx.createGain().gain
    p.setValueAtTime(1, 2); p.linearRampToValueAtTime(0, 4)
    p.cancelScheduledValues(3)
    expect(valueAt(p, 3.5)).toBe(1)
    p.linearRampToValueAtTime(0.5, 5)
    expect(valueAt(p, 3.5)).toBeCloseTo(0.75, 10)
  })
  it('valueAt: cancelAndHold segura o valor do meio da rampa', () => {
    const ctx = createFakeAudioContext(); const p = ctx.createGain().gain
    p.setValueAtTime(1, 2); p.linearRampToValueAtTime(0, 4)
    p.cancelAndHoldAtTime(3)
    expect(valueAt(p, 2.5)).toBeCloseTo(0.75, 10)
    expect(valueAt(p, 3)).toBeCloseTo(0.5, 10)
    expect(valueAt(p, 10)).toBeCloseTo(0.5, 10)
    expect(p.events.slice(-2)).toEqual([{ kind: 'cancel', time: 3 }, { kind: 'linear', value: 0.5, time: 3 }])
  })
  // cancelAndHoldAtTime pelo algoritmo da especificação, com os valores medidos no Chrome 157
  // (OfflineAudioContext a 48 kHz, ConstantSource no ganho; o mesmo com o cancel no currentTime).
  describe('cancelAndHoldAtTime pela especificação, conferido no Chrome 157', () => {
    const at = 0.1
    const gain = () => createFakeAudioContext().createGain().gain
    const CHROME = 4 // casas: o Chrome calcula em float32
    it('rampa exponencial em curso (bipe): termina no instante com o valor do meio e a rampa nova parte dele', () => {
      const p = gain(); const tc = at + 0.1
      p.setValueAtTime(0, at); p.linearRampToValueAtTime(0.9, at + 0.004); p.setValueAtTime(0.9, at + 0.004); p.exponentialRampToValueAtTime(0.0005, at + 0.22)
      p.cancelAndHoldAtTime(tc)
      expect(p.events.slice(-2)).toEqual([{ kind: 'cancel', time: tc }, { kind: 'exp', value: expect.closeTo(0.03217, CHROME), time: tc }])
      expect(valueAt(p, at + 0.15)).toBeCloseTo(0.03217, CHROME) // sem rampa depois, segura
      p.linearRampToValueAtTime(0, tc + 0.005)
      const chrome: [number, number][] = [[at + 0.03, 0.36509], [at + 0.099, 0.03331], [tc, 0.03217], [tc + 0.0005, 0.02895], [tc + 0.0025, 0.01609], [tc + 0.005, 0]]
      for (const [t, v] of chrome) expect(valueAt(p, t)).toBeCloseTo(v, CHROME)
    })
    it('próximo evento é um set (sustentação do bipe): não entra ponto no instante e a rampa nova parte do evento anterior, com degrau', () => {
      const p = gain(); const tc = at + 0.03
      p.setValueAtTime(0, at); p.linearRampToValueAtTime(0.9, at + 0.004); p.setValueAtTime(0.9, at + 0.075); p.exponentialRampToValueAtTime(0.0005, at + 0.19)
      expect(valueAt(p, tc)).toBe(0.9)
      p.cancelAndHoldAtTime(tc)
      expect(p.events.at(-1)).toEqual({ kind: 'cancel', time: tc })
      expect(valueAt(p, at + 0.08)).toBe(0.9) // sem rampa depois, segura o último evento
      p.linearRampToValueAtTime(0, tc + 0.005)
      // Do 0,9 que tocava em tc pra 0,145: é o degrau que o Chrome faz.
      const chrome: [number, number][] = [[at + 0.004, 0.9], [at + 0.01, 0.72581], [at + 0.02, 0.43548], [tc, 0.14516], [tc + 0.0025, 0.07258], [tc + 0.005, 0]]
      for (const [t, v] of chrome) expect(valueAt(p, t)).toBeCloseTo(v, CHROME)
    })
    it('nada em curso nem depois (só um set antes): a rampa nova parte do set', () => {
      const p = gain(); const tc = at + 0.05
      p.setValueAtTime(0.5, at); p.cancelAndHoldAtTime(tc); p.linearRampToValueAtTime(0, at + 0.06)
      expect(p.events.at(-2)).toEqual({ kind: 'cancel', time: tc })
      for (const [t, v] of [[at, 0.5], [at + 0.03, 0.25], [tc, 0.08333], [at + 0.055, 0.04167]] as [number, number][]) expect(valueAt(p, t)).toBeCloseTo(v, CHROME)
    })
    it('rampa linear em curso: termina no instante e a rampa nova parte dele', () => {
      const p = gain(); const tc = at + 0.05
      p.setValueAtTime(1, at); p.linearRampToValueAtTime(0, at + 0.1); p.cancelAndHoldAtTime(tc); p.linearRampToValueAtTime(1, at + 0.06)
      for (const [t, v] of [[at + 0.025, 0.75], [tc, 0.5], [at + 0.055, 0.75], [at + 0.06, 1], [at + 0.2, 1]] as [number, number][]) expect(valueAt(p, t)).toBeCloseTo(v, CHROME)
    })
    it('setTarget em curso: entra um set no instante com o valor do alvo e segura', () => {
      const p = gain(); const tc = at + 0.05
      p.setValueAtTime(1, 0); p.setTargetAtTime(0, at, 0.05); p.cancelAndHoldAtTime(tc)
      expect(p.events.slice(-2)).toEqual([{ kind: 'cancel', time: tc }, { kind: 'set', value: expect.closeTo(Math.exp(-1), 10), time: tc }])
      expect(valueAt(p, at + 0.025)).toBeCloseTo(0.60653, CHROME)
      expect(valueAt(p, tc)).toBeCloseTo(0.36788, CHROME)
      expect(valueAt(p, at + 0.3)).toBeCloseTo(0.36773, 3) // o Chrome segura o valor do quantum (0,36773)
      // Especificação: a rampa nova parte do set em tc. O Chrome 157 diverge aqui (mediu 0,5 em
      // tc + 5 ms: a rampa parte de 0 em tc, um degrau); o fake segue a especificação.
      p.linearRampToValueAtTime(1, at + 0.06)
      expect(valueAt(p, at + 0.055)).toBeCloseTo((Math.exp(-1) + 1) / 2, 10)
    })
    it('evento exatamente no instante fica; só o que vem depois sai', () => {
      const p = gain(); const tc = at + 0.05
      p.setValueAtTime(0, at); p.setValueAtTime(0.7, tc); p.linearRampToValueAtTime(0.1, at + 0.1)
      p.cancelAndHoldAtTime(tc); p.linearRampToValueAtTime(0, at + 0.06)
      for (const [t, v] of [[at + 0.04, 0], [at + 0.055, 0.35], [at + 0.06, 0], [at + 0.2, 0]] as [number, number][]) expect(valueAt(p, t)).toBeCloseTo(v, CHROME)
    })
    it('rampa exponencial em curso e um set agendado depois do cancel', () => {
      const p = gain(); const tc = at + 0.05
      p.setValueAtTime(1, at); p.exponentialRampToValueAtTime(0.01, at + 0.1); p.cancelAndHoldAtTime(tc); p.setValueAtTime(0.2, at + 0.07)
      for (const [t, v] of [[tc, 0.1], [at + 0.06, 0.1], [at + 0.2, 0.2]] as [number, number][]) expect(valueAt(p, t)).toBeCloseTo(v, CHROME)
    })
    it('rampa que era o primeiro evento continua partindo do instante em que foi pedida', () => {
      const ctx = createFakeAudioContext(); const p = ctx.createGain().gain
      ctx.currentTime = 1; p.linearRampToValueAtTime(0, 3)
      ctx.currentTime = 2; p.cancelAndHoldAtTime(2)
      expect(valueAt(p, 1.5)).toBeCloseTo(0.75, 10); expect(valueAt(p, 2)).toBeCloseTo(0.5, 10); expect(valueAt(p, 5)).toBeCloseTo(0.5, 10)
    })
  })
  it('rampa sem evento antes começa no instante em que foi pedida', () => {
    const ctx = createFakeAudioContext(); const p = ctx.createGain().gain
    ctx.currentTime = 10
    p.linearRampToValueAtTime(0, 12)
    expect(valueAt(p, 9)).toBe(1); expect(valueAt(p, 11)).toBeCloseTo(0.5, 10)
  })
  it('value lê a automação no currentTime e escrever vale como set no currentTime', () => {
    const ctx = createFakeAudioContext(); const g = ctx.createGain()
    g.gain.setValueAtTime(1, 2); g.gain.linearRampToValueAtTime(0, 3)
    ctx.currentTime = 2.5
    expect(g.gain.value).toBeCloseTo(0.5, 10)
    const osc = ctx.createOscillator()
    expect(osc.frequency.value).toBe(440)
    osc.frequency.value = 1319
    expect(osc.frequency.value).toBe(1319)
    expect(osc.frequency.events).toEqual([{ kind: 'set', value: 1319, time: 2.5 }])
  })
  it('valores inválidos lançam como no navegador', () => {
    const ctx = createFakeAudioContext(); const p = ctx.createGain().gain
    expect(() => p.setValueAtTime(Number.NaN, 1)).toThrow(TypeError)
    expect(() => p.setValueAtTime(1, Number.POSITIVE_INFINITY)).toThrow(TypeError)
    expect(() => p.linearRampToValueAtTime(1, -1)).toThrow(RangeError)
    expect(() => p.exponentialRampToValueAtTime(0, 1)).toThrow(RangeError)
    expect(() => p.setTargetAtTime(0, 1, -0.1)).toThrow(RangeError)
    expect(() => { p.value = Number.NaN }).toThrow(TypeError)
    expect(p.events).toEqual([])
  })
  it('valueAt prende o valor no intervalo do parâmetro, como o navegador', () => {
    const ctx = createFakeAudioContext(); const pan = ctx.createStereoPanner().pan
    pan.setValueAtTime(1.5, 0); pan.linearRampToValueAtTime(-3, 2)
    expect(valueAt(pan, 0)).toBe(1); expect(pan.value).toBe(1)
    expect(valueAt(pan, 1)).toBeCloseTo(-0.75, 10)
    expect(valueAt(pan, 2)).toBe(-1)
    const delay = ctx.createDelay(0.5).delayTime
    delay.value = 2
    expect(delay.value).toBe(0.5)
    expect(delay.events).toEqual([{ kind: 'set', value: 2, time: 0 }])
  })
  it('valueAt recusa parâmetro que não é do contexto falso', () => {
    expect(() => valueAt({ value: 1 } as unknown as AudioParam, 0)).toThrow(TypeError)
  })
})

describe('fontes', () => {
  it('buffer source grava início, offset, duração e paradas; dois starts lançam', () => {
    const ctx = createFakeAudioContext(); const s = ctx.createBufferSource()
    expect(() => s.stop(1)).toThrow(domError('InvalidStateError'))
    s.start(2, 0.5, 3); s.stop(9); s.stop(8)
    expect(s.starts).toEqual([{ when: 2, offset: 0.5, duration: 3 }]); expect(s.stops).toEqual([9, 8])
    expect(() => s.start(4)).toThrow(domError('InvalidStateError'))
    expect(() => ctx.createBufferSource().start(-1)).toThrow(RangeError)
  })
  it('oscilador grava início sem offset e o fim avisa quem ouve', () => {
    const ctx = createFakeAudioContext(); const o = ctx.createOscillator()
    const onended = vi.fn(); const listener = vi.fn()
    o.onended = onended; o.addEventListener('ended', listener)
    o.start(); o.stop(0.2)
    expect(o.starts).toEqual([{ when: 0 }]); expect(o.stops).toEqual([0.2])
    o.dispatchEvent(new Event('ended'))
    expect(onended).toHaveBeenCalledTimes(1); expect(listener).toHaveBeenCalledTimes(1)
  })
})

describe('ligações', () => {
  it('created guarda todo nó na ordem e nodesOf filtra pelo tipo', () => {
    const ctx = createFakeAudioContext()
    ctx.createGain(); ctx.createBufferSource(); ctx.createOscillator(); ctx.createBiquadFilter(); ctx.createDelay(2)
    ctx.createStereoPanner(); ctx.createChannelMerger(4); ctx.createChannelSplitter(2); ctx.createAnalyser()
    ctx.createBuffer(1, 10, 48000)
    expect(ctx.created.map((c) => c.kind)).toEqual([
      'GainNode', 'AudioBufferSourceNode', 'OscillatorNode', 'BiquadFilterNode', 'DelayNode',
      'StereoPannerNode', 'ChannelMergerNode', 'ChannelSplitterNode', 'AnalyserNode',
    ])
    const [osc] = nodesOf(ctx, 'OscillatorNode')
    expect(osc.frequency.value).toBe(440)
    expect(nodesOf(ctx, 'AudioWorkletNode')).toEqual([])
    expect(nodesOf(ctx, 'ChannelMergerNode')[0].numberOfInputs).toBe(4)
    expect(nodesOf(ctx, 'ChannelSplitterNode')[0].numberOfOutputs).toBe(2)
    expect(nodesOf(ctx, 'DelayNode')[0].maxDelayTime).toBe(2)
  })
  it('connect grava saída e entrada, ignora repetida e valida os índices', () => {
    const ctx = createFakeAudioContext(); const a = ctx.createGain(); const m = ctx.createChannelMerger(2)
    expect(a.connect(m, 0, 1)).toBe(m)
    a.connect(m, 0, 1)
    expect(a.connections).toEqual([{ to: m, output: 0, input: 1 }])
    expect(() => a.connect(m, 0, 2)).toThrow(domError('IndexSizeError'))
    expect(() => a.connect(m, 1, 0)).toThrow(domError('IndexSizeError'))
    expect(() => ctx.createGain().connect(ctx.createBufferSource())).toThrow(domError('IndexSizeError'))
    expect(() => ctx.destination.connect(a)).toThrow(domError('IndexSizeError'))
    expect(() => a.connect(createFakeAudioContext().createGain())).toThrow(domError('InvalidAccessError'))
  })
  it('disconnect: tudo, por saída, por alvo e alvo que não estava ligado lança', () => {
    const ctx = createFakeAudioContext(); const sp = ctx.createChannelSplitter(2)
    const x = ctx.createGain(); const y = ctx.createGain()
    sp.connect(x, 0); sp.connect(x, 1); sp.connect(y, 1)
    sp.disconnect(x, 1)
    expect(sp.connections).toEqual([{ to: x, output: 0, input: 0 }, { to: y, output: 1, input: 0 }])
    sp.disconnect(1)
    expect(sp.connections).toEqual([{ to: x, output: 0, input: 0 }])
    expect(() => sp.disconnect(y)).toThrow(domError('InvalidAccessError'))
    sp.disconnect()
    expect(sp.connections).toEqual([])
  })
  it('disconnect com saída ou entrada fora do intervalo lança IndexSizeError', () => {
    const ctx = createFakeAudioContext(); const sp = ctx.createChannelSplitter(2); const m = ctx.createChannelMerger(2)
    sp.connect(m, 1, 1)
    expect(() => sp.disconnect(m, 2)).toThrow(domError('IndexSizeError'))
    expect(() => sp.disconnect(m, 1, 2)).toThrow(domError('IndexSizeError'))
    expect(() => sp.disconnect(m, 0)).toThrow(domError('InvalidAccessError'))
    const g = ctx.createGain(); const lfo = ctx.createOscillator(); lfo.connect(g.gain)
    expect(() => lfo.disconnect(g.gain, 1)).toThrow(domError('IndexSizeError'))
    sp.disconnect(m, 1, 1); lfo.disconnect(g.gain, 0)
    expect([sp.connections, lfo.connections]).toEqual([[], []])
  })
  it('merger, splitter e panner recusam mudar canais como o navegador; os outros mudam', () => {
    const ctx = createFakeAudioContext()
    const m = ctx.createChannelMerger(4)
    expect(() => { m.channelCount = 2 }).toThrow(domError('InvalidStateError'))
    expect(() => { m.channelCountMode = 'max' }).toThrow(domError('InvalidStateError'))
    m.channelCount = 1; m.channelCountMode = 'explicit'
    const sp = ctx.createChannelSplitter(2)
    expect(() => { sp.channelCount = 4 }).toThrow(domError('InvalidStateError'))
    expect(() => { sp.channelCountMode = 'max' }).toThrow(domError('InvalidStateError'))
    expect(() => { sp.channelInterpretation = 'speakers' }).toThrow(domError('InvalidStateError'))
    const pan = ctx.createStereoPanner()
    expect(() => { pan.channelCount = 3 }).toThrow(domError('NotSupportedError'))
    expect(() => { pan.channelCountMode = 'max' }).toThrow(domError('NotSupportedError'))
    pan.channelCount = 1; pan.channelCountMode = 'explicit'
    const g = ctx.createGain(); g.channelCount = 6; g.channelCountMode = 'explicit'; g.channelInterpretation = 'discrete'
    expect([m.channelCount, sp.channelInterpretation, pan.channelCount, pan.channelCountMode, g.channelCount, g.channelCountMode, g.channelInterpretation])
      .toEqual([1, 'discrete', 1, 'explicit', 6, 'explicit', 'discrete'])
  })
  it('connectedTo olha só a ligação direta, com a entrada se pedida', () => {
    const ctx = createFakeAudioContext(); const a = ctx.createGain(); const m = ctx.createChannelMerger(2)
    a.connect(m, 0, 1)
    expect(connectedTo(a, m)).toBe(true); expect(connectedTo(a, m, 1)).toBe(true); expect(connectedTo(a, m, 0)).toBe(false)
    const lfo = ctx.createOscillator(); lfo.connect(a.gain)
    expect(connectedTo(lfo, a.gain)).toBe(true)
  })
  it('reaches acha caminho com nó no meio e respeita a entrada do merger', () => {
    const ctx = createFakeAudioContext(); const a = ctx.createGain(), mid = ctx.createGain(), m = ctx.createChannelMerger(2)
    a.connect(mid); mid.connect(m, 0, 1)
    expect(connectedTo(a, m)).toBe(false); expect(reaches(a, m, 1)).toBe(true); expect(reaches(a, m, 0)).toBe(false)
  })
  it('reaches respeita a saída do splitter: só o lado esquerdo vai pra saída própria', () => {
    const ctx = createFakeAudioContext({ maxChannelCount: 8 })
    const vs = ctx.createGain(); const click = ctx.createGain(); const m = ctx.createChannelMerger(4)
    const vsSplit = ctx.createChannelSplitter(2); const clickSplit = ctx.createChannelSplitter(2)
    vs.connect(vsSplit); vsSplit.connect(m, 0, 0); vsSplit.connect(m, 1, 1)
    click.connect(clickSplit); clickSplit.connect(m, 0, 2)
    m.connect(ctx.destination)
    expect(reaches(click, m, 0)).toBe(false); expect(reaches(click, m, 1)).toBe(false); expect(reaches(click, m, 2)).toBe(true)
    expect(reaches(vs, m, 2)).toBe(false); expect(reaches(vs, m, 1)).toBe(true)
    expect(reaches(click, ctx.destination)).toBe(true)
  })
  it('reaches segue o canal do merger até o splitter seguinte', () => {
    const ctx = createFakeAudioContext(); const a = ctx.createGain(); const m = ctx.createChannelMerger(4); const sp = ctx.createChannelSplitter(4)
    const left = ctx.createGain(); const third = ctx.createGain()
    a.connect(m, 0, 2); m.connect(sp); sp.connect(left, 0); sp.connect(third, 2)
    expect(reaches(a, third)).toBe(true); expect(reaches(a, left)).toBe(false)
    // Um nó comum no meio pode misturar os canais: daí pra frente vale qualquer saída.
    const sp2 = ctx.createChannelSplitter(4); const mix = ctx.createGain(); const left2 = ctx.createGain()
    m.connect(mix); mix.connect(sp2); sp2.connect(left2, 0)
    expect(reaches(a, left2)).toBe(true)
  })
  it('reaches entra por AudioParam, segue objeto com connections e não trava em ciclo', () => {
    const ctx = createFakeAudioContext(); const bus = ctx.createGain(); const vca = ctx.createGain(); const out = ctx.createGain()
    vca.connect(out); bus.connect(vca.gain)
    expect(reaches(bus, out)).toBe(true)
    const worklet = { connections: [] as { to: unknown; output: number; input: number }[] }
    const src = ctx.createBufferSource(); src.connect(worklet as unknown as AudioNode)
    worklet.connections.push({ to: out, output: 0, input: 0 })
    expect(reaches(src, out)).toBe(true)
    const d = ctx.createDelay(); const fb = ctx.createGain(); d.connect(fb); fb.connect(d)
    expect(reaches(d, out)).toBe(false); expect(reaches(d, d)).toBe(true)
  })
  it('modular um AudioParam do nó conta como chegar no nó (mas não numa entrada dele)', () => {
    const ctx = createFakeAudioContext(); const lfo = ctx.createOscillator(); const vca = ctx.createGain(); const bus = ctx.createGain()
    bus.connect(lfo.frequency); lfo.connect(vca.gain)
    expect(reaches(lfo, vca)).toBe(true)
    expect(reaches(bus, vca)).toBe(true)
    expect(reaches(lfo, vca, 0)).toBe(false)
    expect(reaches(lfo, vca.gain)).toBe(true)
  })
  it('nó opaco (sem connections, como o mock antigo do worklet) lança em vez de dizer "não" sem provar', () => {
    const ctx = createFakeAudioContext(); const beeps = ctx.createOscillator(); const vs = ctx.createChannelMerger(4)
    const opaque = { connectedTo: null as unknown, connect(dest: unknown) { opaque.connectedTo = dest } }
    beeps.connect(opaque as unknown as AudioNode)
    opaque.connect(vs)
    expect(() => reaches(beeps, vs, 0)).toThrow(/nó opaco no grafo: use FakeWorkletNode/)
    expect(() => connectedTo(opaque as unknown as AudioNode, vs)).toThrow(/nó opaco no grafo: use FakeWorkletNode/)
  })
  it('FakeWorkletNode no lugar do worklet de tom: ligações rastreadas e o caminho aparece', async () => {
    const ctx = createFakeAudioContext(); const src = ctx.createBufferSource(); const panner = ctx.createStereoPanner()
    // Como o vi.mock('signalsmith-stretch') do motor passa a devolver o nó.
    const createPitchNode = async (c: BaseAudioContext) => Object.assign(new FakeWorkletNode(c, 'signalsmith-stretch'), {
      start: async () => {}, stop: async () => {}, schedule: async () => {}, latency: async () => 0.12,
    })
    const w = await createPitchNode(ctx as unknown as BaseAudioContext)
    src.connect(w); w.connect(panner); panner.connect(ctx.destination)
    expect(w.kind).toBe('AudioWorkletNode'); expect([w.name, w.numberOfInputs, w.numberOfOutputs]).toEqual(['signalsmith-stretch', 1, 1])
    expect(nodesOf(ctx, 'AudioWorkletNode')).toEqual([w])
    expect(connectedTo(src, w)).toBe(true); expect(reaches(src, ctx.destination)).toBe(true)
    w.disconnect(panner)
    expect(reaches(src, ctx.destination)).toBe(false)
    expect(() => new FakeWorkletNode({} as BaseAudioContext, 'x')).toThrow(TypeError)
  })
})

describe('contexto', () => {
  it('relógio gravável, latência e estado com aviso de mudança', async () => {
    const ctx = createFakeAudioContext({ sampleRate: 44100, outputLatency: 0.02 })
    expect([ctx.currentTime, ctx.sampleRate, ctx.outputLatency, ctx.state]).toEqual([0, 44100, 0.02, 'running'])
    ctx.currentTime = 12.5
    expect(ctx.currentTime).toBe(12.5)
    const changes: string[] = []
    ctx.addEventListener('statechange', () => changes.push(ctx.state))
    await ctx.suspend(); await ctx.resume(); await ctx.close()
    expect(changes).toEqual(['suspended', 'running', 'closed'])
    await expect(ctx.resume()).rejects.toMatchObject({ name: 'InvalidStateError' })
  })
  it('setSinkId troca os canais do destino e avisa', async () => {
    const ctx = createFakeAudioContext({ maxChannelCount: 2, sinks: { placa: 8 } })
    const listener = vi.fn(); ctx.addEventListener('sinkchange', listener)
    expect(ctx.destination.maxChannelCount).toBe(2)
    await ctx.setSinkId('placa')
    expect(ctx.sinkId).toBe('placa'); expect(ctx.destination.maxChannelCount).toBe(8); expect(listener).toHaveBeenCalledTimes(1)
    ctx.destination.channelCount = 8
    await ctx.setSinkId('placa')
    expect(listener).toHaveBeenCalledTimes(1)
    await ctx.setSinkId('')
    expect(ctx.destination.maxChannelCount).toBe(2); expect(ctx.destination.channelCount).toBe(2); expect(listener).toHaveBeenCalledTimes(2)
    ctx.removeEventListener('sinkchange', listener)
    await ctx.setSinkId('placa')
    expect(listener).toHaveBeenCalledTimes(2)
  })
  it('setSinkId com aparelho que não existe rejeita com NotFoundError e não muda nada', async () => {
    const ctx = createFakeAudioContext({ maxChannelCount: 2, sinks: { placa: 8 } })
    const listener = vi.fn(); ctx.addEventListener('sinkchange', listener)
    await expect(ctx.setSinkId('sumiu')).rejects.toMatchObject({ name: 'NotFoundError' })
    expect([ctx.sinkId, ctx.destination.maxChannelCount, listener.mock.calls.length]).toEqual(['', 2, 0])
    await ctx.setSinkId('placa'); await ctx.setSinkId('default')
    expect([ctx.sinkId, ctx.destination.maxChannelCount]).toEqual(['default', 2])
    await expect(createFakeAudioContext().setSinkId('placa')).rejects.toMatchObject({ name: 'NotFoundError' })
    await expect(createFakeAudioContext().setSinkId('')).resolves.toBeUndefined()
  })
  it('destino com os campos de canal e limite do aparelho', () => {
    const ctx = createFakeAudioContext({ maxChannelCount: 4 })
    const d = ctx.destination
    expect([d.kind, d.channelCount, d.channelCountMode, d.channelInterpretation, d.maxChannelCount]).toEqual(['AudioDestinationNode', 2, 'explicit', 'speakers', 4])
    d.channelCount = 4; d.channelInterpretation = 'discrete'
    expect([d.channelCount, d.channelInterpretation]).toEqual([4, 'discrete'])
    expect(() => { d.channelCount = 5 }).toThrow(domError('IndexSizeError'))
    expect(() => { d.channelCount = 0 }).toThrow(domError('NotSupportedError'))
  })
  it('decodeAudioData devolve buffer falso; o teste pode decidir o conteúdo', async () => {
    const ctx = createFakeAudioContext()
    const buf = await ctx.decodeAudioData(new ArrayBuffer(8))
    expect([buf.duration, buf.numberOfChannels, buf.sampleRate, buf.length]).toEqual([300, 2, 48000, 300 * 48000])
    expect(() => buf.getChannelData(2)).toThrow(domError('IndexSizeError'))
    const custom = createFakeAudioContext({ decode: (data) => new FakeAudioBuffer(1, data.byteLength, 1000) })
    const short = await custom.decodeAudioData(new ArrayBuffer(500))
    expect([short.duration, short.numberOfChannels]).toEqual([0.5, 1])
    expect(short.getChannelData(0)).toHaveLength(500)
    expect(short.getChannelData(0)).toBe(short.getChannelData(0))
    const ok = vi.fn()
    await custom.decodeAudioData(new ArrayBuffer(10), ok)
    expect(ok).toHaveBeenCalledWith(expect.objectContaining({ length: 10 }))
  })
  it('createBuffer com dados graváveis e audioWorklet que guarda os módulos', async () => {
    const ctx = createFakeAudioContext()
    const b = ctx.createBuffer(2, 4, 8000)
    b.getChannelData(0).set([1, 2, 3, 4])
    expect([...b.getChannelData(0)]).toEqual([1, 2, 3, 4]); expect(b.duration).toBe(0.0005)
    expect(() => ctx.createBuffer(0, 4, 8000)).toThrow(domError('NotSupportedError'))
    await ctx.audioWorklet.addModule('blob:tom')
    expect(ctx.audioWorklet.modules).toEqual(['blob:tom'])
  })
  it('cada nó conhece o contexto e os padrões do navegador', () => {
    const ctx = createFakeAudioContext()
    const an = ctx.createAnalyser(); an.fftSize = 256
    expect(an.context).toBe(ctx); expect(an.frequencyBinCount).toBe(128)
    const data = new Uint8Array(4); an.getByteFrequencyData(data); expect([...data]).toEqual([0, 0, 0, 0])
    const f = ctx.createBiquadFilter()
    expect([f.type, f.frequency.value, f.Q.value]).toEqual(['lowpass', 350, 1])
    const pan = ctx.createStereoPanner()
    expect([pan.pan.value, pan.channelCount, pan.channelCountMode]).toEqual([0, 2, 'clamped-max'])
    const src = ctx.createBufferSource()
    expect([src.buffer, src.loop, src.playbackRate.value]).toEqual([null, false, 1])
  })
})

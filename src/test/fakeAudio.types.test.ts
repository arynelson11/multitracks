import { describe, expect, expectTypeOf, it } from 'vitest'
import {
  FakeAudioBuffer, FakeAudioContext, FakeWorkletNode, asAudioContext, asFake, connectedTo, createFakeAudioContext, nodesOf, reaches, valueAt,
  type FakeAudioBufferSourceNode, type FakeAudioParam, type FakeGainNode, type FakeOscillatorNode,
} from './fakeAudio'

// Este arquivo vale pelo `npm run typecheck` (tsconfig.test.json) tanto quanto pelo Vitest:
// usa o fake do jeito que os testes de T7 (voz e bipes), T12 (grafo de saídas) e T17
// (agendador) vão usar, contra funções com os tipos reais do Web Audio.

interface VoiceSpec { channelId: string; buffer: AudioBuffer; entry: AudioNode }
interface Voice { channelId: string; source: AudioBufferSourceNode; env: GainNode }
function startVoicesForSwitch(ctx: BaseAudioContext, specs: readonly VoiceSpec[], at: number, target: number, fade: number): Voice[] {
  return specs.map(({ channelId, buffer, entry }) => {
    const source = ctx.createBufferSource(); const env = ctx.createGain()
    source.buffer = buffer; source.connect(env); env.connect(entry)
    env.gain.setValueAtTime(0, at - fade); env.gain.linearRampToValueAtTime(1, at)
    source.start(at - fade, target - fade)
    return { channelId, source, env }
  })
}
function scheduleBeep(ctx: BaseAudioContext, dest: AudioNode, at: number): OscillatorNode {
  const osc = ctx.createOscillator(); const env = ctx.createGain(); const lp = ctx.createBiquadFilter()
  osc.type = 'triangle'; osc.frequency.value = 1319; lp.frequency.value = 5200
  osc.connect(env); env.connect(lp); lp.connect(dest)
  env.gain.setValueAtTime(0, at); env.gain.linearRampToValueAtTime(0.85, at + 0.004); env.gain.exponentialRampToValueAtTime(0.001, at + 0.19)
  osc.start(at); osc.stop(at + 0.2)
  return osc
}
interface OutputGraph { input(role: 'click' | 'normal'): GainNode; readonly countDelay: DelayNode; readonly master: GainNode }
function createOutputGraph(ctx: AudioContext, channels: number): OutputGraph {
  ctx.destination.channelCount = channels; ctx.destination.channelCountMode = 'explicit'; ctx.destination.channelInterpretation = 'discrete'
  const vs = ctx.createGain(); const click = ctx.createGain(); const master = ctx.createGain()
  const merger = ctx.createChannelMerger(channels); const vsSplit = ctx.createChannelSplitter(2); const clickSplit = ctx.createChannelSplitter(2)
  vs.connect(vsSplit); vsSplit.connect(merger, 0, 0); vsSplit.connect(merger, 1, 1)
  click.connect(clickSplit); clickSplit.connect(merger, 0, 2)
  const countDelay = ctx.createDelay(1); countDelay.connect(click)
  merger.connect(master); master.connect(ctx.destination)
  return { input: (role) => (role === 'click' ? click : vs), countDelay, master }
}
interface SchedulerDeps { ctx: BaseAudioContext; now(): number }

describe('o fake no lugar dos tipos do Web Audio', () => {
  it('T7: entra como BaseAudioContext, AudioBuffer e AudioNode, e volta pelo asFake', () => {
    const ctx = createFakeAudioContext()
    const entry = ctx.createDelay(1) // nó do fake direto onde a função pede AudioNode
    const buffer = ctx.createBuffer(2, 48000, 48000) // idem pra AudioBuffer
    const before = ctx.created.length
    const [v] = startVoicesForSwitch(asAudioContext(ctx), [{ channelId: 'a', buffer, entry }], 10, 8, 0.005)
    expect(connectedTo(v.env, entry)).toBe(true)
    expect(asFake(v.source).starts).toEqual([{ when: 9.995, offset: 7.995 }])
    expect(valueAt(v.env.gain, 9.995)).toBe(0); expect(valueAt(v.env.gain, 10)).toBe(1)
    expect(ctx.created.slice(before).map((n) => n.kind).sort()).toEqual(['AudioBufferSourceNode', 'GainNode'])
    expectTypeOf(asFake(v.source)).toEqualTypeOf<FakeAudioBufferSourceNode>()
    expectTypeOf(asFake(v.env)).toEqualTypeOf<FakeGainNode>()
    expectTypeOf(asFake(v.env.gain)).toEqualTypeOf<FakeAudioParam>()

    const osc = scheduleBeep(asAudioContext(ctx), ctx.createGain(), 6)
    expectTypeOf(asFake(osc)).toEqualTypeOf<FakeOscillatorNode>()
    expect(asFake(osc).starts[0].when).toBe(6)
    const oscs = nodesOf(ctx, 'OscillatorNode')
    expect(oscs.map((o) => o.frequency.value)).toEqual([1319])
    expect(oscs.some((o) => reaches(o, ctx.destination))).toBe(false)
  })
  it('T12: o grafo de saídas recebe o fake como AudioContext', () => {
    const ctx = createFakeAudioContext({ maxChannelCount: 8 })
    const g = createOutputGraph(asAudioContext(ctx), 8)
    const merger = nodesOf(ctx, 'ChannelMergerNode')[0]
    for (const vsIn of [0, 1]) {
      expect(reaches(g.input('click'), merger, vsIn)).toBe(false)
      expect(reaches(g.countDelay, merger, vsIn)).toBe(false)
    }
    expect(reaches(g.input('click'), merger, 2)).toBe(true)
    expect([ctx.destination.channelCount, ctx.destination.channelInterpretation]).toEqual([8, 'discrete'])
    expect(connectedTo(g.master, ctx.destination)).toBe(true)
  })
  it('T17: mora no SchedulerDeps como BaseAudioContext e o teste ainda mexe no relógio', () => {
    const ctx = createFakeAudioContext()
    const deps: SchedulerDeps = { ctx: asAudioContext(ctx), now: () => deps.ctx.currentTime }
    ctx.currentTime = 1.25
    expect(deps.now()).toBe(1.25)
    expect(asFake(deps.ctx)).toBe(ctx)
    expectTypeOf(asFake(deps.ctx)).toEqualTypeOf<FakeAudioContext>()
  })
  it('nós, parâmetro e buffer do fake encaixam nos tipos reais sem cast', () => {
    const ctx = createFakeAudioContext()
    const nodes: [AudioNode, GainNode, AudioBufferSourceNode, OscillatorNode, BiquadFilterNode, DelayNode, StereoPannerNode, AnalyserNode, ChannelMergerNode, ChannelSplitterNode, AudioDestinationNode] = [
      ctx.createGain(), ctx.createGain(), ctx.createBufferSource(), ctx.createOscillator(), ctx.createBiquadFilter(), ctx.createDelay(),
      ctx.createStereoPanner(), ctx.createAnalyser(), ctx.createChannelMerger(2), ctx.createChannelSplitter(2), ctx.destination,
    ]
    const param: AudioParam = ctx.createGain().gain
    const buffer: AudioBuffer = new FakeAudioBuffer(1, 4, 8000)
    const data: Float32Array<ArrayBuffer> = buffer.getChannelData(0)
    expect(nodes.every((n) => n.context === asAudioContext(ctx))).toBe(true)
    expect(param.defaultValue).toBe(1); expect(data).toHaveLength(4)
    expectTypeOf(asFake(nodes[10])).not.toBeAny()
  })
  it('asFake devolve o tipo do fake pra cada tipo real e o worklet de tom', () => {
    const ctx = createFakeAudioContext()
    expectTypeOf(asFake(ctx.createBufferSource() as AudioBufferSourceNode)).toEqualTypeOf<FakeAudioBufferSourceNode>()
    // O mock do signalsmith devolve o FakeWorkletNode com o tipo do pacote (um AudioWorkletNode).
    const pitch = new FakeWorkletNode(ctx, 'signalsmith-stretch') as unknown as AudioWorkletNode
    expectTypeOf(asFake(pitch)).toEqualTypeOf<FakeWorkletNode>()
    expect(asFake(pitch).name).toBe('signalsmith-stretch')
    expectTypeOf(asFake(ctx.createBuffer(1, 4, 8000) as AudioBuffer)).toEqualTypeOf<FakeAudioBuffer>()
    const g = ctx.createGain()
    expect(asFake(g)).toBe(g)
  })
  it('asFake e asAudioContext recusam o que não é do fake', () => {
    expect(() => asFake({} as GainNode)).toThrow(TypeError)
    expect(() => asFake({} as BaseAudioContext)).toThrow(TypeError)
    expect(() => asAudioContext({} as FakeAudioContext)).toThrow(TypeError)
  })
  it('setValueCurveAtTime existe pro tipo e avisa que o fake não simula', () => {
    const p = createFakeAudioContext().createGain().gain
    expect(() => p.setValueCurveAtTime([0, 1], 0, 1)).toThrow(expect.objectContaining({ name: 'NotSupportedError' }))
    expect(p.events).toEqual([])
  })
})

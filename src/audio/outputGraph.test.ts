import { describe, expect, it } from 'vitest'
import {
  FakeAnalyserNode, FakeAudioDestinationNode, FakeAudioNode, FakeAudioParam, FakeChannelMergerNode, FakeChannelSplitterNode,
  FakeDelayNode, FakeGainNode, FakeStereoPannerNode, asAudioContext, asFake, connectedTo, createFakeAudioContext, nodesOf, reaches, valueAt,
  type FakeAudioContext,
} from '../test/fakeAudio'
import type { ChannelRole } from '../types'
import { DEFAULT_OUTPUTS, effectivePan, planOutputs } from '../lib/outputPlan'
import type { OutputPlan } from '../lib/stageContracts'
import { createOutputGraph, type OutputGraph } from './outputGraph'

const ROLES: ChannelRole[] = ['click', 'guide', 'normal']
const LEAK = 10 ** (-90 / 20) // -90 dBFS: teto do que pode sobrar de Click, Guia ou contagem na saída da VS
const MAX_LEVEL_ERROR_DB = 0.1

const split2 = (earOnSecond = false) => planOutputs({ ...DEFAULT_OUTPUTS, mode: 'split2', earOnSecond }, 2)
const stereo = () => planOutputs({ ...DEFAULT_OUTPUTS, mode: 'stereo' }, 2)
const multi = (max = 8, map = DEFAULT_OUTPUTS.multi) => planOutputs({ ...DEFAULT_OUTPUTS, mode: 'multi', multi: { ...map } }, max)

function setup(plan: OutputPlan, maxChannelCount = 2): { ctx: FakeAudioContext; g: OutputGraph } {
  const ctx = createFakeAudioContext({ maxChannelCount })
  return { ctx, g: createOutputGraph(asAudioContext(ctx), plan) }
}
/** O panner que recebe direto de `node` (o do barramento ou o da contagem). */
const pannerAfter = (ctx: FakeAudioContext, node: AudioNode) => {
  const p = nodesOf(ctx, 'StereoPannerNode').find((n) => connectedTo(node, n))
  if (!p) throw new Error('sem panner depois do nó')
  return p
}
const panOf = (ctx: FakeAudioContext, node: AudioNode) => valueAt(pannerAfter(ctx, node).pan, ctx.currentTime)
/** Quem liga em `target` (pra provar que o merger antigo ficou sem entrada). */
const feeders = (ctx: FakeAudioContext, target: unknown) => ctx.created.filter(({ node }) => (node as FakeAudioNode).connections.some((c) => c.to === target))

// ---------- Medida do sinal no grafo do fake ----------
// O fake não processa som; esta medida segue as regras da especificação do Web Audio pra um
// sinal linear: cada canal é uma lista de coeficientes sobre os canais da fonte (mono: 1; estéreo:
// L e R). Ganho multiplica, atraso não muda o nível, o StereoPanner segue a fórmula da
// especificação (a mesma que o Chrome mostrou, ver scripts/verify-audio/output-graph.mjs),
// splitter e merger separam e juntam canais, e a mistura de canais segue channelCountMode e
// channelInterpretation (em 'speakers' só 1 <-> 2, os únicos casos deste grafo; outro lança).
type Sig = number[][]

const zeros = (width: number) => new Array<number>(width).fill(0)
function mixTo(sig: Sig, n: number, interpretation: ChannelInterpretation, width: number): Sig {
  if (sig.length === n) return sig
  if (interpretation === 'discrete') return Array.from({ length: n }, (_, c) => sig[c] ?? zeros(width))
  if (sig.length === 1 && n === 2) return [sig[0], sig[0]]
  if (sig.length === 2 && n === 1) return [sig[0].map((v, k) => 0.5 * (v + sig[1][k]))]
  throw new Error(`mistura speakers de ${sig.length} pra ${n} canais não simulada`)
}
function panned(sig: Sig, pan: number): Sig {
  const p = Math.min(1, Math.max(-1, pan))
  if (sig.length === 1) {
    const x = ((p + 1) / 2) * (Math.PI / 2)
    return [sig[0].map((v) => v * Math.cos(x)), sig[0].map((v) => v * Math.sin(x))]
  }
  const [l, r] = sig
  if (p <= 0) {
    const x = (p + 1) * (Math.PI / 2)
    return [l.map((v, k) => v + r[k] * Math.cos(x)), r.map((v) => v * Math.sin(x))]
  }
  const x = p * (Math.PI / 2)
  return [l.map((v) => v * Math.cos(x)), r.map((v, k) => v + l[k] * Math.sin(x))]
}

/** O que chega em cada canal do destino vindo das fontes (`sources`: nó sem entrada -> sinal dele). */
function measure(ctx: FakeAudioContext, sources: Map<unknown, Sig>, width: number): Sig {
  const incoming = new Map<unknown, { from: FakeAudioNode; output: number; input: number }[]>()
  for (const { node } of ctx.created) {
    const from = node as FakeAudioNode
    for (const c of from.connections) {
      if (c.to instanceof FakeAudioParam) continue
      incoming.set(c.to, [...(incoming.get(c.to) ?? []), { from, output: c.output, input: c.input }])
    }
  }
  const memo = new Map<unknown, Sig>()
  const outputOf = (node: FakeAudioNode, output: number): Sig => {
    const sig = processed(node)
    return node instanceof FakeChannelSplitterNode ? [sig[output] ?? zeros(width)] : sig
  }
  const inputOf = (node: FakeAudioNode, input: number): Sig => {
    const parts = (incoming.get(node) ?? []).filter((c) => c.input === input).map((c) => outputOf(c.from, c.output))
    const widest = Math.max(1, ...parts.map((s) => s.length))
    const n = node.channelCountMode === 'explicit' ? node.channelCount : node.channelCountMode === 'clamped-max' ? Math.min(widest, node.channelCount) : widest
    const sum: Sig = Array.from({ length: n }, () => zeros(width))
    for (const part of parts) mixTo(part, n, node.channelInterpretation, width).forEach((ch, c) => ch.forEach((v, k) => { sum[c][k] += v }))
    return sum
  }
  const processed = (node: FakeAudioNode): Sig => {
    const known = sources.get(node) ?? memo.get(node)
    if (known) return known
    let out: Sig
    if (node instanceof FakeChannelMergerNode) out = Array.from({ length: node.numberOfInputs }, (_, i) => inputOf(node, i)[0])
    else {
      const sig = inputOf(node, 0)
      if (node instanceof FakeGainNode) { const k = valueAt(node.gain, ctx.currentTime); out = sig.map((ch) => ch.map((v) => v * k)) }
      else if (node instanceof FakeStereoPannerNode) out = panned(sig, valueAt(node.pan, ctx.currentTime))
      else if (node instanceof FakeDelayNode || node instanceof FakeChannelSplitterNode || node instanceof FakeAnalyserNode || node instanceof FakeAudioDestinationNode) out = sig
      else throw new Error(`${node.kind} não simulado`)
    }
    memo.set(node, out)
    return out
  }
  return processed(ctx.destination)
}

interface FakeChannel { src: FakeGainNode; sig: Sig }
/** Canal como o motor monta: fonte -> panner (mono com 1 canal, como o setupPannerForBuffer) -> fader -> `into`. */
function channel(ctx: FakeAudioContext, into: AudioNode, { mono, pan, gain = 0.8 }: { mono: boolean; pan: number; gain?: number }): FakeChannel {
  const src = ctx.createGain()
  const panner = ctx.createStereoPanner()
  if (mono) { panner.channelCountMode = 'explicit'; panner.channelCount = 1 }
  panner.pan.value = pan
  const fader = ctx.createGain()
  fader.gain.value = gain
  src.connect(panner); panner.connect(fader); fader.connect(into)
  return { src, sig: mono ? [[1]] : [[1, 0], [0, 1]] }
}
/** A v1.4.15: fonte -> panner -> fader -> principal -> destino, com o pan que ela usava. */
function legacy(opts: { mono: boolean; pan: number; gain?: number; master?: number }): Sig {
  const ctx = createFakeAudioContext()
  const master = ctx.createGain()
  master.gain.value = opts.master ?? 1
  master.connect(ctx.destination)
  const ch = channel(ctx, master, opts)
  return measure(ctx, new Map([[ch.src, ch.sig]]), ch.sig.length)
}
function measureChannel(ctx: FakeAudioContext, ch: FakeChannel): Sig { return measure(ctx, new Map([[ch.src, ch.sig]]), ch.sig.length) }
/** Pico possível no canal (soma dos módulos dos coeficientes, fonte de pico 1). */
const peak = (coefs: number[] | undefined) => (coefs ?? []).reduce((a, v) => a + Math.abs(v), 0)
const norm = (coefs: number[]) => Math.hypot(...coefs)
/** Mesmo nível (erro <= 0,1 dB) e mesmos coeficientes; lado em silêncio (abaixo de -120 dB) só confere o silêncio. */
function expectSameLevel(got: number[], ref: number[]) {
  got.forEach((v, k) => expect(Math.abs(v - ref[k])).toBeLessThan(1e-9))
  if (norm(ref) < 1e-6) { expect(norm(got)).toBeLessThan(1e-6); return }
  expect(Math.abs(20 * Math.log10(norm(got) / norm(ref)))).toBeLessThanOrEqual(MAX_LEVEL_ERROR_DB)
}
/** Uma ligação só, e pra este alvo (por identidade: toEqual compara nós por estrutura). */
function expectOnlyTo(node: AudioNode, target: AudioNode) {
  const list = asFake(node).connections
  expect(list).toHaveLength(1)
  expect(list[0].to).toBe(target)
  expect([list[0].output, list[0].input]).toEqual([0, 0])
}

describe('createOutputGraph: rota por modo', () => {
  it('nenhum caminho dos barramentos click e guia chega a uma saída da VS', () => {
    const ctx = createFakeAudioContext({ maxChannelCount: 8 }); const plan = planOutputs({ ...DEFAULT_OUTPUTS, mode: 'multi' }, 8); const g = createOutputGraph(asAudioContext(ctx), plan)
    const merger = nodesOf(ctx, 'ChannelMergerNode')[0]
    for (const vsIn of plan.vs) { expect(reaches(g.input('click'), merger, vsIn)).toBe(false); expect(reaches(g.input('guide'), merger, vsIn)).toBe(false); expect(reaches(g.countDelay, merger, vsIn)).toBe(false) }
    expect(reaches(g.input('click'), merger, plan.click[0])).toBe(true)
    expect(reaches(g.countDelay, merger, plan.click[0])).toBe(true)
    expect(reaches(g.input('guide'), merger, plan.guide[0])).toBe(true)
    expect(reaches(g.input('guide'), merger, plan.click[0])).toBe(false)
    expect(reaches(g.input('click'), merger, plan.guide[0])).toBe(false)
    for (const vsIn of plan.vs) expect(reaches(g.input('normal'), merger, vsIn)).toBe(true)
    expect(reaches(g.input('normal'), merger, plan.click[0])).toBe(false)
  })

  it('mapa em outro par e queda com 3 canais (merger de 3): Click e Guia nunca na VS', () => {
    for (const [max, map] of [[8, { vsPair: 2, click: 0, guide: 5 }], [3, DEFAULT_OUTPUTS.multi], [18, { vsPair: 16, click: 1, guide: 0 }]] as const) {
      const plan = multi(max, map)
      const { ctx, g } = setup(plan, max)
      const merger = nodesOf(ctx, 'ChannelMergerNode')[0]
      expect(merger.numberOfInputs).toBe(plan.channels)
      for (let i = 0; i < plan.channels; i++) {
        expect(reaches(g.input('click'), merger, i)).toBe(plan.click.includes(i))
        expect(reaches(g.input('guide'), merger, i)).toBe(plan.guide.includes(i))
        expect(reaches(g.countDelay, merger, i)).toBe(plan.click.includes(i))
        expect(reaches(g.input('normal'), merger, i)).toBe(plan.vs.includes(i))
      }
    }
    expect(multi(3)).toMatchObject({ mode: 'multi', channels: 3, vs: [0, 1], click: [2], guide: [2] })
  })

  it('stereo e separados ligam os barramentos direto no principal, sem merger', () => {
    for (const plan of [stereo(), split2(), split2(true)]) {
      const { ctx, g } = setup(plan)
      expect(nodesOf(ctx, 'ChannelMergerNode')).toHaveLength(0)
      expect(nodesOf(ctx, 'ChannelSplitterNode')).toHaveLength(1) // só o do medidor
      expect(connectedTo(g.input('normal'), g.master)).toBe(true)
      expect(asFake(g.input('normal')).connections).toHaveLength(1)
      for (const role of ['click', 'guide'] as const) {
        const panner = pannerAfter(ctx, g.input(role))
        expectOnlyTo(g.input(role), panner)
        expectOnlyTo(panner, g.master)
      }
      for (const role of ROLES) expect(reaches(g.input(role), ctx.destination)).toBe(true)
    }
  })

  it('pan dos barramentos de Click e Guia e da contagem vem do effectivePan do papel click/guia', () => {
    for (const [plan, max] of [[stereo(), 2], [split2(), 2], [split2(true), 2], [multi(), 8]] as const) {
      const { ctx, g } = setup(plan, max)
      expect(panOf(ctx, g.input('click'))).toBe(effectivePan(0, 'click', plan))
      expect(panOf(ctx, g.input('guide'))).toBe(effectivePan(0, 'guide', plan))
      expect(panOf(ctx, g.countDelay)).toBe(effectivePan(0, 'click', plan))
    }
    const { ctx, g } = setup(split2(true))
    expect([panOf(ctx, g.input('click')), panOf(ctx, g.input('guide')), panOf(ctx, g.countDelay)]).toEqual([1, 1, 1])
    // A VS não ganha panner de barramento: o nível dela fica exatamente o da v1.4.15.
    expect(nodesOf(ctx, 'StereoPannerNode').some((p) => connectedTo(g.input('normal'), p))).toBe(false)
  })

  it('multi configura o destino em discreto com os canais do plano', () => {
    for (const max of [8, 3, 18]) {
      const plan = multi(max)
      const { ctx, g } = setup(plan, max)
      expect(ctx.destination.channelCount).toBe(plan.channels)
      expect(ctx.destination.channelCountMode).toBe('explicit')
      expect(ctx.destination.channelInterpretation).toBe('discrete')
      const merger = nodesOf(ctx, 'ChannelMergerNode')[0]
      expect(merger.numberOfInputs).toBe(plan.channels)
      expectOnlyTo(merger, g.master)
    }
    const { ctx } = setup(split2())
    expect([ctx.destination.channelCount, ctx.destination.channelCountMode, ctx.destination.channelInterpretation]).toEqual([2, 'explicit', 'speakers'])
  })

  it('caminho final principal -> mudo -> destino, com o medidor fora do caminho do som', () => {
    for (const [plan, max] of [[stereo(), 2], [split2(), 2], [multi(), 8]] as const) {
      const { ctx, g } = setup(plan, max)
      const master = asFake(g.master); const mute = asFake(g.masterMute)
      expectOnlyTo(master, g.masterMute)
      expect(connectedTo(mute, ctx.destination)).toBe(true)
      expect(connectedTo(master, ctx.destination)).toBe(false)
      const [meter] = nodesOf(ctx, 'ChannelSplitterNode').filter((s) => connectedTo(mute, s))
      expect(meter.numberOfOutputs).toBe(2)
      const analysers = nodesOf(ctx, 'AnalyserNode')
      expect(analysers).toHaveLength(2)
      expect(meter.connections).toHaveLength(2)
      meter.connections.forEach((c, i) => { expect(c.to).toBe(analysers[i]); expect(c.output).toBe(i) })
      for (const a of analysers) { expect(a.connections).toHaveLength(0); expect(reaches(a, ctx.destination)).toBe(false) }
      expect(mute.connections).toHaveLength(2)
      // Tudo que sai dos barramentos passa pelo principal e pelo mudo.
      mute.disconnect(ctx.destination)
      for (const role of ROLES) expect(reaches(g.input(role), ctx.destination)).toBe(false)
      expect(reaches(g.countDelay, ctx.destination)).toBe(false)
    }
  })

  it('contagem sem canal de click: o atraso entra no barramento do click e sai onde o click sai', () => {
    for (const [plan, max] of [[split2(), 2], [stereo(), 2], [multi(), 8]] as const) {
      const { ctx, g } = setup(plan, max)
      const delay = asFake(g.countDelay)
      expect(delay.maxDelayTime).toBe(1)
      expect(valueAt(delay.delayTime, 0)).toBe(0)
      expect(reaches(g.countDelay, g.input('click'))).toBe(true)
      expect(reaches(g.countDelay, g.input('guide'))).toBe(false)
      expect(reaches(g.countDelay, g.input('normal'))).toBe(false)
      // Passa pelo panner próprio antes do barramento (sinal mono vira estéreo no lado do papel).
      const countPanner = pannerAfter(ctx, g.countDelay)
      expectOnlyTo(countPanner, g.input('click'))
    }
    const { g } = setup(split2())
    expect(g.guideGain).toBe(g.input('guide').gain)
    expect(valueAt(g.guideGain, 0)).toBe(1)
  })

  it('em 4 ou mais, Click ou Guia sem saída não ligam o barramento', () => {
    const semClick: OutputPlan = { mode: 'multi', channels: 4, vs: [0, 1], click: [], guide: [3], panByRole: true, fellBackFrom: null }
    const { ctx, g } = setup(semClick, 4)
    const merger = nodesOf(ctx, 'ChannelMergerNode')[0]
    expect(reaches(g.input('click'), ctx.destination)).toBe(false)
    expect(reaches(g.countDelay, ctx.destination)).toBe(false)
    expect(reaches(g.input('guide'), merger, 3)).toBe(true)
    expect(reaches(g.input('normal'), merger, 0)).toBe(true)
  })

  it('plano malformado com Click ou Guia no lugar da VS não liga esse barramento', () => {
    const noPar: OutputPlan = { mode: 'multi', channels: 4, vs: [0, 1], click: [1], guide: [7], panByRole: true, fellBackFrom: null }
    const a = setup(noPar, 4)
    expect(reaches(a.g.input('click'), a.ctx.destination)).toBe(false)
    expect(reaches(a.g.input('guide'), a.ctx.destination)).toBe(false) // saída 8 não existe nesta placa
    expect(reaches(a.g.input('normal'), a.ctx.destination)).toBe(true)
    const doisCanais: OutputPlan = { mode: 'multi', channels: 2, vs: [0, 1], click: [0], guide: [1], panByRole: true, fellBackFrom: null }
    const b = setup(doisCanais, 2)
    expect(reaches(b.g.input('click'), b.ctx.destination)).toBe(false)
    expect(reaches(b.g.input('guide'), b.ctx.destination)).toBe(false)
    const ladoDaVs: OutputPlan = { mode: 'split2', channels: 2, vs: [1], click: [1], guide: [0], panByRole: true, fellBackFrom: null }
    const c = setup(ladoDaVs, 2)
    expect(reaches(c.g.input('click'), c.ctx.destination)).toBe(false)
    expect(reaches(c.g.countDelay, c.ctx.destination)).toBe(false)
    expect(reaches(c.g.input('guide'), c.ctx.destination)).toBe(true)
  })
})

describe('createOutputGraph: sinal medido (R-24 e nada na PA)', () => {
  it('separados: na saída da VS nada do Click, da Guia ou da contagem passa de -90 dBFS, nem com o pan do canal errado', () => {
    for (const earOnSecond of [false, true]) {
      const plan = split2(earOnSecond); const vsOut = plan.vs[0]; const earOut = plan.click[0]
      for (const role of ['click', 'guide'] as const) for (const mono of [true, false]) {
        // O pan certo (o que o motor aplica) e pans errados: o barramento segura sozinho.
        for (const pan of [effectivePan(0, role, plan), 0, 0.37, -1, 1]) {
          const { ctx, g } = setup(plan)
          const out = measureChannel(ctx, channel(ctx, g.input(role), { mono, pan, gain: 1 }))
          expect(peak(out[vsOut])).toBeLessThan(LEAK)
          expect(norm(out[earOut])).toBeGreaterThan(0.5)
        }
      }
      const { ctx, g } = setup(plan)
      const beep = ctx.createGain(); beep.connect(g.countDelay)
      const out = measure(ctx, new Map([[beep, [[1]]]]), 1)
      expect(peak(out[vsOut])).toBeLessThan(LEAK)
      expect(out[earOut][0]).toBeCloseTo(1, 12) // contagem mono inteira no ouvido
    }
  })

  it('contagem sem canal de click sai no mesmo nível com ou sem outro canal tocando no barramento do Click', () => {
    for (const [plan, max] of [[split2(), 2], [split2(true), 2], [multi(), 8]] as const) {
      const ear = plan.click[0]
      const alone = setup(plan, max)
      const beep = alone.ctx.createGain(); beep.connect(alone.g.countDelay)
      const sozinha = measure(alone.ctx, new Map([[beep, [[1]]]]), 1)[ear][0]
      // Junto de um canal estéreo no mesmo barramento: base de 3 sinais (contagem, L e R do canal).
      const both = setup(plan, max)
      const beep2 = both.ctx.createGain(); beep2.connect(both.g.countDelay)
      const ch = channel(both.ctx, both.g.input('click'), { mono: false, pan: effectivePan(0, 'click', plan), gain: 1 })
      const out = measure(both.ctx, new Map([[beep2, [[1, 0, 0]]], [ch.src, [[0, 1, 0], [0, 0, 1]]]]), 3)
      expect(sozinha).toBeCloseTo(1, 12)
      expect(out[ear][0]).toBeCloseTo(1, 12)
      plan.vs.forEach((o) => expect(peak(out[o])).toBeLessThan(LEAK))
    }
  })

  it('separados: nível de cada saída igual ao da v1.4.15 com o pan automático (mono igual; estéreo = L+R)', () => {
    for (const earOnSecond of [false, true]) {
      const plan = split2(earOnSecond)
      for (const role of ROLES) for (const mono of [true, false]) {
        const { ctx, g } = setup(plan)
        g.master.gain.value = 0.7
        const out = measureChannel(ctx, channel(ctx, g.input(role), { mono, pan: effectivePan(0.42, role, plan), gain: 0.8 }))
        // v1.4.15: Click e Guia no L (-1), o resto no R (+1). Com o lado trocado o nível de cada lado é o mesmo, espelhado.
        const ref = legacy({ mono, pan: role === 'normal' ? 1 : -1, gain: 0.8, master: 0.7 })
        const [refEar, refVs] = [ref[0], ref[1]]
        const own = role === 'normal' ? plan.vs[0] : plan.click[0]
        expectSameLevel(out[own], role === 'normal' ? refVs : refEar)
        expect(norm(out[own])).toBeCloseTo(0.56 * (mono ? 1 : Math.SQRT2), 12) // mono inteiro; estéreo como L+R
        expect(peak(out[1 - own])).toBeLessThan(LEAK)
      }
    }
  })

  it('"Tudo junto" sai igual à v1.4.15 sem pan automático, com o pan do knob', () => {
    for (const role of ROLES) for (const mono of [true, false]) for (const knob of [-0.5, 0, 0.3, 1]) {
      const { ctx, g } = setup(stereo())
      const out = measureChannel(ctx, channel(ctx, g.input(role), { mono, pan: effectivePan(knob, role, stereo()), gain: 0.9 }))
      const ref = legacy({ mono, pan: knob, gain: 0.9 })
      expectSameLevel(out[0], ref[0]); expectSameLevel(out[1], ref[1])
    }
  })

  it('4 ou mais: Click e Guia na saída própria com o nível do ouvido da v1.4.15; a VS no par com o knob', () => {
    for (const map of [DEFAULT_OUTPUTS.multi, { vsPair: 2, click: 0, guide: 5 }]) {
      const plan = multi(8, map)
      for (const mono of [true, false]) {
        for (const role of ['click', 'guide'] as const) {
          const { ctx, g } = setup(plan, 8)
          const out = measureChannel(ctx, channel(ctx, g.input(role), { mono, pan: effectivePan(0.3, role, plan) }))
          const own = role === 'click' ? plan.click[0] : plan.guide[0]
          expectSameLevel(out[own], legacy({ mono, pan: -1 })[0])
          out.forEach((coefs, i) => { if (i !== own) expect(peak(coefs)).toBeLessThan(LEAK) })
        }
        for (const knob of [-0.6, 0, 0.3]) {
          const { ctx, g } = setup(plan, 8)
          const out = measureChannel(ctx, channel(ctx, g.input('normal'), { mono, pan: effectivePan(knob, 'normal', plan) }))
          const ref = legacy({ mono, pan: knob })
          expectSameLevel(out[plan.vs[0]], ref[0]); expectSameLevel(out[plan.vs[1]], ref[1])
          out.forEach((coefs, i) => { if (!plan.vs.includes(i)) expect(peak(coefs)).toBe(0) })
        }
      }
      const { ctx, g } = setup(plan, 8)
      const beep = ctx.createGain(); beep.connect(g.countDelay)
      const out = measure(ctx, new Map([[beep, [[1]]]]), 1)
      out.forEach((coefs, i) => expect(peak(coefs)).toBeCloseTo(i === plan.click[0] ? 1 : 0, 12))
    }
  })
})

describe('createOutputGraph: apply, levels e dispose', () => {
  it('apply troca o roteador sem recriar os barramentos', () => {
    const { ctx, g } = setup(multi(), 8)
    const fixos = [...ROLES.map((r) => g.input(r)), g.countDelay, g.master, g.masterMute, pannerAfter(ctx, g.input('click')), pannerAfter(ctx, g.input('guide')), pannerAfter(ctx, g.countDelay)]
    const oldMerger = nodesOf(ctx, 'ChannelMergerNode')[0]
    const oldRouterSplitters = nodesOf(ctx, 'ChannelSplitterNode').filter((s) => s.connections.some((c) => c.to === oldMerger))
    expect(oldRouterSplitters).toHaveLength(3) // VS, Click e Guia
    const gains = nodesOf(ctx, 'GainNode').length; const panners = nodesOf(ctx, 'StereoPannerNode').length

    const next = split2(true)
    g.apply(next)
    const depois = [...ROLES.map((r) => g.input(r)), g.countDelay, g.master, g.masterMute, pannerAfter(ctx, g.input('click')), pannerAfter(ctx, g.input('guide')), pannerAfter(ctx, g.countDelay)]
    depois.forEach((n, i) => expect(n).toBe(fixos[i]))
    expect(nodesOf(ctx, 'GainNode')).toHaveLength(gains); expect(nodesOf(ctx, 'StereoPannerNode')).toHaveLength(panners)
    expect(oldMerger.connections).toHaveLength(0); expect(feeders(ctx, oldMerger)).toHaveLength(0)
    for (const s of oldRouterSplitters) { expect(s.connections).toHaveLength(0); expect(feeders(ctx, s)).toHaveLength(0) }
    expect([ctx.destination.channelCount, ctx.destination.channelInterpretation]).toEqual([2, 'speakers'])
    expect(g.plan).toEqual(next)
    expect([panOf(ctx, g.input('click')), panOf(ctx, g.input('guide')), panOf(ctx, g.countDelay)]).toEqual([1, 1, 1])
    for (const role of ROLES) expect(connectedTo(role === 'normal' ? g.input(role) : pannerAfter(ctx, g.input(role)), g.master)).toBe(true)

    // De volta pra 4 ou mais: merger novo, sem ligação antiga sobrando no principal.
    ctx.currentTime = 12
    g.apply(multi(8, { vsPair: 2, click: 0, guide: 5 }))
    const mergers = nodesOf(ctx, 'ChannelMergerNode')
    expect(mergers).toHaveLength(2)
    const intoMaster = feeders(ctx, g.master)
    expect(intoMaster).toHaveLength(1)
    expect(intoMaster[0].node).toBe(mergers[1])
    expect([ctx.destination.channelCount, ctx.destination.channelInterpretation]).toEqual([8, 'discrete'])
    expect([panOf(ctx, g.input('click')), panOf(ctx, g.input('guide')), panOf(ctx, g.countDelay)]).toEqual([-1, -1, -1])
    for (const vsIn of [2, 3]) { expect(reaches(g.input('click'), mergers[1], vsIn)).toBe(false); expect(reaches(g.input('guide'), mergers[1], vsIn)).toBe(false) }
    expect(reaches(g.input('click'), mergers[1], 0)).toBe(true)

    // Tudo junto -> separados: pans de 0 pra -1 e a mesma rota no principal.
    g.apply(stereo())
    expect(panOf(ctx, g.input('click'))).toBe(0)
    g.apply(split2())
    expect(panOf(ctx, g.input('click'))).toBe(-1)
    expect(feeders(ctx, g.master)).toHaveLength(3)
  })

  it('o plano guardado é uma cópia de quem chamou', () => {
    const plan = split2()
    const { g } = setup(plan)
    plan.vs.push(0); plan.click[0] = 1
    expect(g.plan).toMatchObject({ vs: [1], click: [0] })
  })

  it('apply com plano maior que o aparelho lança antes de mexer na rota', () => {
    const { ctx, g } = setup(split2(), 2)
    const created = ctx.created.length
    expect(() => g.apply(multi(8))).toThrow(RangeError)
    expect(ctx.created).toHaveLength(created)
    expect(g.plan).toEqual(split2())
    expect(ctx.destination.channelCount).toBe(2)
    for (const role of ROLES) expect(reaches(g.input(role), ctx.destination)).toBe(true)
    expect(panOf(ctx, g.input('click'))).toBe(-1)
  })

  it('levels lê o pico das saídas 1 e 2, de 0 a 1, sem criar nada', () => {
    const { ctx, g } = setup(split2())
    const [left, right] = nodesOf(ctx, 'AnalyserNode')
    left.getFloatTimeDomainData = (a) => { a.fill(0.1); a[3] = -0.6; a[7] = Number.NaN }
    right.getFloatTimeDomainData = (a) => { a.fill(0); a[a.length - 1] = 1.7 }
    const created = ctx.created.length
    const l = g.levels()
    expect(l.l).toBeCloseTo(0.6, 6); expect(l.r).toBe(1)
    expect(ctx.created).toHaveLength(created)
    expect(setup(split2()).g.levels()).toEqual({ l: 0, r: 0 })
  })

  it('dispose desliga tudo e apply depois não religa', () => {
    const { ctx, g } = setup(multi(), 8)
    g.dispose()
    for (const role of ROLES) expect(reaches(g.input(role), ctx.destination)).toBe(false)
    expect(reaches(g.countDelay, ctx.destination)).toBe(false)
    expect(asFake(g.masterMute).connections).toHaveLength(0)
    for (const { node } of ctx.created) expect((node as FakeAudioNode).connections).toHaveLength(0)
    const created = ctx.created.length
    g.apply(split2())
    expect(ctx.created).toHaveLength(created)
    for (const { node } of ctx.created) expect((node as FakeAudioNode).connections).toHaveLength(0)
    expect(g.levels()).toEqual({ l: 0, r: 0 })
    expect(() => g.dispose()).not.toThrow()
  })
})

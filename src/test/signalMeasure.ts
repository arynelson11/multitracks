// Medida linear do sinal no grafo do AudioContext falso (T12; serve à T25 e à T30). O fake não
// processa som; esta medida segue as regras da especificação do Web Audio pra um sinal linear:
// cada canal é uma lista de coeficientes sobre os sinais das fontes (uma fonte mono: [[1]]; uma
// estéreo: [[1, 0], [0, 1]], L e R; várias fontes: uma base maior, ex. [[1, 0, 0]] pra contagem e
// [[0, 1, 0], [0, 0, 1]] pro canal estéreo). Ganho multiplica pelo valor em `ctx.currentTime`,
// atraso não muda o nível, o StereoPanner segue a fórmula da especificação (a mesma que o
// Chrome 157 mostrou, ver scripts/verify-audio/output-graph.mjs), splitter e merger separam e
// juntam canais, e a mistura de canais segue channelCountMode e channelInterpretation (em
// 'speakers' só 1 <-> 2, os únicos casos do grafo das saídas; outro caso lança, pra ninguém
// medir errado sem saber). Nó de outro tipo no caminho (worklet, filtro, fonte que não está em
// `sources`) também lança: quem precisar estende aqui. Sem API do Node (o tsconfig.app.json
// checa src/test).
import {
  FakeAnalyserNode, FakeAudioDestinationNode, FakeAudioNode, FakeAudioParam, FakeChannelMergerNode, FakeChannelSplitterNode,
  FakeDelayNode, FakeGainNode, FakeStereoPannerNode, valueAt, type FakeAudioContext,
} from './fakeAudio'

/** Sinal medido: `sig[canal][k]` é o coeficiente do sinal-base `k` naquele canal. */
export type Sig = number[][]

const zeros = (width: number) => new Array<number>(width).fill(0)

function mixTo(sig: Sig, n: number, interpretation: ChannelInterpretation, width: number): Sig {
  if (sig.length === n) return sig
  if (interpretation === 'discrete') return Array.from({ length: n }, (_, c) => sig[c] ?? zeros(width))
  if (sig.length === 1 && n === 2) return [sig[0], sig[0]]
  if (sig.length === 2 && n === 1) return [sig[0].map((v, k) => 0.5 * (v + sig[1][k]))]
  throw new Error(`mistura speakers de ${sig.length} pra ${n} canais não simulada`)
}

/** StereoPanner pela fórmula da especificação (entrada mono ou estéreo; pan limitado a ±1). */
export function panSignal(sig: Sig, pan: number): Sig {
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

/**
 * O que chega em cada canal do destino vindo das fontes. `sources`: nó sem entrada (no teste,
 * um GainNode do fake fazendo papel de fonte) -> sinal dele; `width`: tamanho da base.
 */
export function measure(ctx: FakeAudioContext, sources: ReadonlyMap<unknown, Sig>, width: number): Sig {
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
      else if (node instanceof FakeStereoPannerNode) out = panSignal(sig, valueAt(node.pan, ctx.currentTime))
      else if (node instanceof FakeDelayNode || node instanceof FakeChannelSplitterNode || node instanceof FakeAnalyserNode || node instanceof FakeAudioDestinationNode) out = sig
      else throw new Error(`${node.kind} não simulado`)
    }
    memo.set(node, out)
    return out
  }
  return processed(ctx.destination)
}

/** Pico possível num canal medido (soma dos módulos dos coeficientes, fontes de pico 1). */
export const signalPeak = (coefs: readonly number[] | undefined): number => (coefs ?? []).reduce((a, v) => a + Math.abs(v), 0)
/** Nível de um canal medido (fontes independentes de mesmo nível). */
export const signalNorm = (coefs: readonly number[]): number => Math.hypot(...coefs)

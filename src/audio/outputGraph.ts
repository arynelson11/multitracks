// Barramentos por papel e roteador das saídas de áudio (Parte 2, Arquitetura C; spec 5e, R-23,
// R-24). Cada canal liga o fader no barramento do papel dele (Click, Guia ou o resto, que é a
// VS); os barramentos vão pro roteador do modo de saída, o roteador pro principal (`master`:
// volume, FADE e AUTO), o principal pro mudo geral e o mudo pro destino. O medidor do PRINCIPAL
// fica num ramo à parte, fora do caminho do som.
//
// Click, Guia e contagem NUNCA na PA:
// - Click e Guia passam cada um por um StereoPanner do barramento, e a contagem sem canal de
//   click (R-35) por um StereoPanner próprio antes do barramento do Click, todos com o pan de
//   `effectivePan(0, papel, plano)` (Ruling T12/T25 a). Em "Click e Guia separados" esse pan
//   ±1 põe todo o sinal do barramento no lado do ouvido mesmo que o pan de um canal esteja
//   errado; a contagem é mono e precisa do panner próprio pra entrar no barramento como
//   estéreo, no mesmo nível com ou sem outro canal tocando. Em "4 ou mais" o pan é -1 e só o
//   lado esquerdo do barramento vai pra saída própria.
// - O barramento da VS não ganha panner: o som dela fica exatamente o da v1.4.15.
// - Saída de Click ou Guia que cairia na VS (plano malformado) não é ligada: fica mudo, nunca na PA.
//
// Nível igual ao da v1.4.15 (R-24): StereoPanner em ±1 deixa a faixa mono inteira, e a estéreo
// como L+R, no lado escolhido; um segundo panner no mesmo lado não muda esse nível. Em pan 0
// uma entrada estéreo passa igual (o outro lado recebe o resto de cos(π/2), abaixo de -300 dB).
// Medido no Chrome real por scripts/verify-audio/output-graph.mjs.
import type { ChannelRole } from '../types'
import { effectivePan } from '../lib/outputPlan'
import type { OutputPlan } from '../lib/stageContracts'

export interface OutputGraph {
  input(role: ChannelRole): GainNode // barramento do papel
  readonly guideGain: AudioParam     // calar a guia no último compasso
  readonly countDelay: DelayNode     // contagem sem canal de click (R-35): liga no barramento do click; o motor ajusta delayTime = L
  readonly master: GainNode          // volume principal: FADE e AUTO continuam aqui
  readonly masterMute: GainNode      // mudo geral
  readonly plan: OutputPlan
  apply(plan: OutputPlan): void      // religa barramentos -> roteador -> principal; barramentos e canais ficam
  levels(): { l: number; r: number } // pico das saídas 1 e 2 (0..1) pro medidor do PRINCIPAL
  dispose(): void
}

/** Teto do atraso da contagem: o mesmo do atraso de compensação do tom no motor (createDelay(1)). */
const COUNT_MAX_DELAY = 1
/** Janela do medidor: 1024 amostras (21 ms a 48 kHz) cobrem um quadro de tela. */
const METER_FFT = 1024

/** Uma ligação do roteador (saída e entrada só no splitter e no merger). */
interface Wire { from: AudioNode; to: AudioNode; output?: number; input?: number }
/** Roteador de um plano: nós dele (somem no próximo `apply`), ligações internas e as que saem dos barramentos. */
interface Route { nodes: AudioNode[]; inner: Wire[]; fromBuses: Wire[] }

const copyPlan = (p: OutputPlan): OutputPlan => ({ ...p, vs: [...p.vs], click: [...p.click], guide: [...p.guide] })
const wire = (w: Wire): void => { w.from.connect(w.to, w.output ?? 0, w.input ?? 0) }
/** Ligação que já tinha sumido (o navegador lança) já está como a gente quer: desligada. */
function unwire(w: Wire): void {
  try { w.from.disconnect(w.to) } catch { /* já desligado */ }
}

/**
 * Monta os barramentos, o principal, o mudo e o medidor uma vez, e o roteador de `initial`.
 * Os barramentos nascem com ganho 1 e o atraso da contagem com 0.
 */
export function createOutputGraph(ctx: AudioContext, initial: OutputPlan): OutputGraph {
  const buses: Record<ChannelRole, GainNode> = { click: ctx.createGain(), guide: ctx.createGain(), normal: ctx.createGain() }
  const clickPan = ctx.createStereoPanner()
  const guidePan = ctx.createStereoPanner()
  const countPan = ctx.createStereoPanner()
  const countDelay = ctx.createDelay(COUNT_MAX_DELAY)
  const master = ctx.createGain()
  const masterMute = ctx.createGain()
  const meterSplit = ctx.createChannelSplitter(2)
  const meters = [ctx.createAnalyser(), ctx.createAnalyser()]
  const meterData = new Float32Array(METER_FFT)

  buses.click.connect(clickPan)
  buses.guide.connect(guidePan)
  countDelay.connect(countPan)
  countPan.connect(buses.click)
  master.connect(masterMute)
  masterMute.connect(ctx.destination)
  masterMute.connect(meterSplit)
  meters.forEach((m, side) => {
    m.fftSize = METER_FFT
    m.smoothingTimeConstant = 0
    meterSplit.connect(m, side)
  })

  const owned: AudioNode[] = [...Object.values(buses), clickPan, guidePan, countPan, countDelay, master, masterMute, meterSplit, ...meters]
  let plan = copyPlan(initial)
  let route: Route = { nodes: [], inner: [], fromBuses: [] }
  let disposed = false

  /** Saídas de um papel de ouvido que dá pra ligar: existem na placa e não são da VS. */
  const earOutputs = (p: OutputPlan, outputs: readonly number[]) =>
    outputs.filter((o) => Number.isInteger(o) && o >= 0 && o < p.channels && !p.vs.includes(o))

  function buildRoute(p: OutputPlan): Route {
    if (p.mode !== 'multi') {
      const fromBuses: Wire[] = [{ from: buses.normal, to: master }]
      // Em separados o lado sai do pan; papel de ouvido com o mesmo lado da VS (plano malformado) não liga.
      const vsSide = effectivePan(0, 'normal', p)
      if (p.mode === 'stereo' || effectivePan(0, 'click', p) !== vsSide) fromBuses.push({ from: clickPan, to: master })
      if (p.mode === 'stereo' || effectivePan(0, 'guide', p) !== vsSide) fromBuses.push({ from: guidePan, to: master })
      return { nodes: [], inner: [], fromBuses }
    }
    const merger = ctx.createChannelMerger(p.channels)
    const vsSplit = ctx.createChannelSplitter(2)
    const nodes: AudioNode[] = [merger, vsSplit]
    const inner: Wire[] = [{ from: merger, to: master }]
    p.vs.slice(0, 2).forEach((o, side) => {
      if (Number.isInteger(o) && o >= 0 && o < p.channels) inner.push({ from: vsSplit, to: merger, output: side, input: o })
    })
    const fromBuses: Wire[] = [{ from: buses.normal, to: vsSplit }]
    for (const [pan, outputs] of [[clickPan, p.click], [guidePan, p.guide]] as const) {
      const ear = earOutputs(p, outputs)
      if (ear.length === 0) continue // sem saída (aviso sem-saida-ouvido): o barramento não liga
      const split = ctx.createChannelSplitter(2)
      nodes.push(split)
      // Pan -1: o barramento inteiro está no lado esquerdo; só ele vai pra saída própria.
      for (const o of ear) inner.push({ from: split, to: merger, output: 0, input: o })
      fromBuses.push({ from: pan, to: split })
    }
    return { nodes, inner, fromBuses }
  }

  function configureDestination(p: OutputPlan): void {
    const dest = ctx.destination
    const channels = p.mode === 'multi' ? p.channels : 2
    if (dest.channelCount !== channels) dest.channelCount = channels
    dest.channelCountMode = 'explicit'
    dest.channelInterpretation = p.mode === 'multi' ? 'discrete' : 'speakers'
  }

  /**
   * Ordem pensada pro ao vivo: tudo que pode lançar (plano maior que o aparelho, merger
   * inválido) acontece antes de mexer na rota de agora. Depois desliga a rota velha (um
   * instante de silêncio, nunca Click na PA), acerta os pans e o destino e só então liga a nova.
   */
  function reroute(p: OutputPlan): void {
    const channels = p.mode === 'multi' ? p.channels : 2
    if (channels !== ctx.destination.channelCount && channels > ctx.destination.maxChannelCount) {
      throw new RangeError(`plano de ${channels} saídas num aparelho de ${ctx.destination.maxChannelCount}: refaça o plano com os canais do aparelho`)
    }
    const next = buildRoute(p)
    next.inner.forEach(wire)
    route.fromBuses.forEach(unwire)
    for (const n of route.nodes) n.disconnect()
    const now = ctx.currentTime
    clickPan.pan.setValueAtTime(effectivePan(0, 'click', p), now)
    guidePan.pan.setValueAtTime(effectivePan(0, 'guide', p), now)
    countPan.pan.setValueAtTime(effectivePan(0, 'click', p), now)
    configureDestination(p)
    next.fromBuses.forEach(wire)
    route = next
    plan = copyPlan(p)
  }

  function peakOf(meter: AnalyserNode): number {
    meter.getFloatTimeDomainData(meterData)
    let peak = 0
    for (let i = 0; i < meterData.length; i++) {
      const v = Math.abs(meterData[i])
      if (v > peak) peak = v
    }
    return Math.min(1, peak)
  }

  reroute(initial)

  return {
    input: (role) => buses[role],
    guideGain: buses.guide.gain,
    countDelay,
    master,
    masterMute,
    get plan() { return plan },
    apply(p) {
      if (!disposed) reroute(p)
    },
    levels() {
      if (disposed) return { l: 0, r: 0 }
      return { l: peakOf(meters[0]), r: peakOf(meters[1]) }
    },
    dispose() {
      if (disposed) return
      disposed = true
      for (const n of [...route.nodes, ...owned]) n.disconnect()
      route = { nodes: [], inner: [], fromBuses: [] }
    },
  }
}

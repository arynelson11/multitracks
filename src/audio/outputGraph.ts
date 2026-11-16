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
// - Saída de Click ou Guia que cairia na VS (plano malformado) não é ligada: fica mudo, nunca na PA,
//   e um console.warn por `apply` diz o motivo.
//
// Nível igual ao da v1.4.15 (R-24): StereoPanner em ±1 deixa a faixa mono inteira, e a estéreo
// como L+R, no lado escolhido; um segundo panner no mesmo lado não muda esse nível. Em pan 0
// uma entrada estéreo passa igual (o outro lado recebe o resto de cos(π/2), abaixo de -300 dB).
// Medido no Chrome real por scripts/verify-audio/output-graph.mjs.
import type { ChannelRole } from '../types'
import { effectivePan } from '../lib/outputPlan'
import type { OutputPlan } from '../lib/stageContracts'

export interface OutputGraph {
  /**
   * Barramento do papel. Espera sinal ESTÉREO: o fader do canal, que vem depois do StereoPanner
   * dele. Fonte mono ligada direto aqui muda de nível: no barramento do Click sai +6 dB (o
   * panner da contagem deixa o barramento sempre em 2 canais, a mono é copiada nos dois lados e
   * o pan ±1 soma os dois); na Guia o nível depende do que mais estiver ligado; em "4 ou mais",
   * mono direto no barramento da VS sai só na saída esquerda do par. Som mono (bipe, oscilador)
   * entra pelo `countDelay` ou por um StereoPanner próprio antes do barramento.
   */
  input(role: ChannelRole): GainNode
  readonly guideGain: AudioParam     // calar a guia no último compasso
  readonly countDelay: DelayNode     // contagem sem canal de click (R-35): liga no barramento do click; o motor ajusta delayTime = L
  readonly master: GainNode          // volume principal: FADE e AUTO continuam aqui
  readonly masterMute: GainNode      // mudo geral
  readonly plan: OutputPlan
  /**
   * Religa barramentos -> roteador -> principal com o plano novo; barramentos, panners, atraso,
   * principal, mudo e canais ficam. Lança RangeError, SEM mexer na rota de agora, se o plano tem
   * mais canais que o aparelho (`destination.maxChannelCount`) ou um "4 ou mais" fora de 1 a 32
   * saídas: refaça o plano com `planOutputs(config, destination.maxChannelCount)` e chame de
   * novo. Depois de `dispose` não faz nada.
   */
  apply(plan: OutputPlan): void
  levels(): { l: number; r: number } // pico das saídas 1 e 2 (0..1) pro medidor do PRINCIPAL
  dispose(): void
}

/** Teto do atraso da contagem: o mesmo do atraso de compensação do tom no motor (createDelay(1)). */
const COUNT_MAX_DELAY = 1
/** Janela do medidor: 1024 amostras (21 ms a 48 kHz) cobrem um quadro de tela. */
const METER_FFT = 1024
/** Entradas que um ChannelMerger aceita (e o teto de saídas do plano, MAX_OUTPUTS da T6). */
const MAX_ROUTER_OUTPUTS = 32

/** Uma ligação do roteador (saída e entrada só no splitter e no merger). */
interface Wire { from: AudioNode; to: AudioNode; output?: number; input?: number }
/**
 * Roteador de um plano: nós dele (somem no próximo `apply`), ligações internas, as que saem dos
 * barramentos e o que a guarda deixou de fora num plano malformado (motivos pro aviso).
 */
interface Route { nodes: AudioNode[]; inner: Wire[]; fromBuses: Wire[]; refused: string[] }

const copyPlan = (p: OutputPlan): OutputPlan => ({ ...p, vs: [...p.vs], click: [...p.click], guide: [...p.guide] })
const wire = (w: Wire): void => { w.from.connect(w.to, w.output ?? 0, w.input ?? 0) }
/** Ligação que já tinha sumido (o navegador lança) já está como a gente quer: desligada. */
function unwire(w: Wire): void {
  try { w.from.disconnect(w.to) } catch { /* já desligado */ }
}

/** Lança RangeError se o plano não cabe no aparelho (ou no roteador). Não mexe em nada. */
function checkChannels(ctx: AudioContext, p: OutputPlan): void {
  const channels = p.mode === 'multi' ? p.channels : 2
  if (p.mode === 'multi' && !(Number.isInteger(channels) && channels >= 1 && channels <= MAX_ROUTER_OUTPUTS)) {
    throw new RangeError(`plano de "4 ou mais" com ${channels} saídas: o roteador aceita de 1 a ${MAX_ROUTER_OUTPUTS}`)
  }
  const dest = ctx.destination
  if (channels !== dest.channelCount && channels > dest.maxChannelCount) {
    throw new RangeError(`plano de ${channels} saídas num aparelho de ${dest.maxChannelCount}: refaça o plano com os canais do aparelho`)
  }
}

/** Saída contada a partir de 1 pro texto do aviso (valor estranho aparece como veio). */
const outputName = (o: number) => (Number.isInteger(o) ? String(o + 1) : String(o))

/**
 * Monta os barramentos, o principal, o mudo e o medidor uma vez, e o roteador de `initial`.
 * Os barramentos nascem com ganho 1 e o atraso da contagem com 0. Lança RangeError ANTES de
 * criar qualquer nó, nas mesmas condições do `apply` (plano com mais canais que o aparelho):
 * nada fica meio montado nem ligado no destino.
 */
export function createOutputGraph(ctx: AudioContext, initial: OutputPlan): OutputGraph {
  checkChannels(ctx, initial)
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
  masterMute.connect(meterSplit)
  meters.forEach((m, side) => {
    m.fftSize = METER_FFT
    m.smoothingTimeConstant = 0
    meterSplit.connect(m, side)
  })

  const owned: AudioNode[] = [...Object.values(buses), clickPan, guidePan, countPan, countDelay, master, masterMute, meterSplit, ...meters]
  let plan = copyPlan(initial)
  let route: Route = { nodes: [], inner: [], fromBuses: [], refused: [] }
  let disposed = false

  const onBoard = (p: OutputPlan, o: number) => Number.isInteger(o) && o >= 0 && o < p.channels

  /** Só cria os nós do roteador novo e diz o que ligar; nada é ligado aqui. */
  function buildRoute(p: OutputPlan): Route {
    const refused: string[] = []
    if (p.mode !== 'multi') {
      const fromBuses: Wire[] = [{ from: buses.normal, to: master }]
      // Em separados o lado sai do pan; papel de ouvido com o mesmo lado da VS (plano malformado) não liga.
      const vsSide = effectivePan(0, 'normal', p)
      for (const [role, pan, label] of [['click', clickPan, 'Click'], ['guide', guidePan, 'Guia']] as const) {
        if (p.mode === 'stereo' || effectivePan(0, role, p) !== vsSide) fromBuses.push({ from: pan, to: master })
        else refused.push(`${label} no mesmo lado da VS (saída ${outputName(p.vs[0])})`)
      }
      return { nodes: [], inner: [], fromBuses, refused }
    }
    const merger = ctx.createChannelMerger(p.channels)
    const vsSplit = ctx.createChannelSplitter(2)
    const nodes: AudioNode[] = [merger, vsSplit]
    const inner: Wire[] = [{ from: merger, to: master }]
    p.vs.slice(0, 2).forEach((o, side) => {
      if (onBoard(p, o)) inner.push({ from: vsSplit, to: merger, output: side, input: o })
      else refused.push(`VS na saída ${outputName(o)}, que não existe nesta placa (${p.channels} canais)`)
    })
    const fromBuses: Wire[] = [{ from: buses.normal, to: vsSplit }]
    for (const [pan, outputs, label] of [[clickPan, p.click, 'Click'], [guidePan, p.guide, 'Guia']] as const) {
      // Saída de ouvido que dá pra ligar: existe na placa e não é da VS.
      const ear = outputs.filter((o) => onBoard(p, o) && !p.vs.includes(o))
      for (const o of outputs) {
        if (!onBoard(p, o)) refused.push(`${label} na saída ${outputName(o)}, que não existe nesta placa (${p.channels} canais)`)
        else if (p.vs.includes(o)) refused.push(`${label} na saída ${outputName(o)}, que é da VS`)
      }
      if (ear.length === 0) continue // sem saída (aviso sem-saida-ouvido do plano, ou tudo recusado): o barramento não liga
      const split = ctx.createChannelSplitter(2)
      nodes.push(split)
      // Pan -1: o barramento inteiro está no lado esquerdo; só ele vai pra saída própria.
      for (const o of ear) inner.push({ from: split, to: merger, output: 0, input: o })
      fromBuses.push({ from: pan, to: split })
    }
    return { nodes, inner, fromBuses, refused }
  }

  function configureDestination(p: OutputPlan): void {
    const dest = ctx.destination
    const channels = p.mode === 'multi' ? p.channels : 2
    if (dest.channelCount !== channels) dest.channelCount = channels
    dest.channelCountMode = 'explicit'
    dest.channelInterpretation = p.mode === 'multi' ? 'discrete' : 'speakers'
  }

  /**
   * Ordem pensada pro ao vivo: tudo que pode lançar (plano maior que o aparelho, roteador
   * inválido) acontece antes de mexer na rota de agora, e os nós novos só nascem, sem ligação.
   * Depois desliga a rota velha inteira (um instante de silêncio, nunca Click na PA), acerta os
   * pans e o destino e só então liga o roteador novo e os barramentos nele. Nenhum quantum
   * renderizado no meio mistura a rota velha com a nova.
   */
  function reroute(p: OutputPlan): void {
    checkChannels(ctx, p)
    const next = buildRoute(p)
    route.fromBuses.forEach(unwire)
    for (const n of route.nodes) n.disconnect()
    const now = ctx.currentTime
    clickPan.pan.setValueAtTime(effectivePan(0, 'click', p), now)
    guidePan.pan.setValueAtTime(effectivePan(0, 'guide', p), now)
    countPan.pan.setValueAtTime(effectivePan(0, 'click', p), now)
    configureDestination(p)
    next.inner.forEach(wire)
    next.fromBuses.forEach(wire)
    route = next
    plan = copyPlan(p)
    if (next.refused.length > 0) {
      console.warn(`[saídas] plano de saídas com erro (${p.mode}): ${next.refused.join('; ')}. Isso fica de fora, mudo, nunca na PA: refaça o plano com planOutputs.`)
    }
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
  // O som só chega no destino com o roteador pronto.
  masterMute.connect(ctx.destination)

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
      route = { nodes: [], inner: [], fromBuses: [], refused: [] }
    },
  }
}

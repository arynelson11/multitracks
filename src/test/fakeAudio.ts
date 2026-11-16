// AudioContext falso dos testes do palco novo e do motor (Parte 2). Grava tudo o que o
// código pede ao Web Audio (nós criados, ligações, automações, início e fim de fontes) pra
// o teste conferir o grafo e o relógio sem tocar som. Lança nos mesmos casos em que o
// navegador lança (número inválido, índice de entrada ou saída que não existe, start duas
// vezes), pra um erro do motor não passar escondido no teste.
// Sem API do Node: o tsconfig.app.json checa src/test. O worklet de tom continua pelo
// vi.mock('signalsmith-stretch'), como no useAudioEngine.persistence.test.ts.

export type FakeParamEventKind = 'set' | 'linear' | 'exp' | 'target' | 'cancel'
/** Evento gravado num AudioParam, na ordem em que foi pedido (`timeConstant` só no 'target'). */
export interface FakeParamEvent { kind: FakeParamEventKind; value?: number; time: number; timeConstant?: number }
/** Ligação de um nó: pra quem, por qual saída dele e em qual entrada do alvo. */
export interface FakeConnection { to: unknown; output: number; input: number }
export interface FakeStart { when: number; offset?: number; duration?: number }

/** Qualquer coisa que entra nos ajudantes de grafo: nó ou parâmetro do falso, tipo real do Web Audio, ou um objeto com `connections`. */
export type FakeGraphItem = FakeAudioNode | FakeAudioParam | AudioNode | AudioParam | { readonly connections: readonly FakeConnection[] }

/** Duração do áudio decodificado quando o teste não passa `decode` (a mesma do fake do persistence.test). */
const DEFAULT_DECODED_SECONDS = 300

const domError = (message: string, name: string) => new DOMException(message, name)
function checkFinite(v: number, what: string): void {
  if (!Number.isFinite(v)) throw new TypeError(`${what} precisa ser um número finito (veio ${v})`)
}
function checkTime(t: number, what: string): void {
  checkFinite(t, what)
  if (t < 0) throw new RangeError(`${what} não pode ser negativo (veio ${t})`)
}

/** EventTarget de verdade mais o handler on<tipo> (onended, onsinkchange, onstatechange). */
class FakeEventTarget extends EventTarget {
  dispatchEvent(event: Event): boolean {
    const ok = super.dispatchEvent(event)
    const handler = (this as unknown as Record<string, unknown>)[`on${event.type}`]
    if (typeof handler === 'function') handler.call(this, event)
    return ok
  }
}

// ---------- AudioParam ----------

// Instante em que cada evento foi pedido: a rampa sem evento antes começa nele.
const calledAt = new WeakMap<FakeParamEvent, number>()

export class FakeAudioParam {
  readonly events: FakeParamEvent[] = []
  readonly owner: FakeAudioNode
  readonly defaultValue: number
  readonly minValue: number
  readonly maxValue: number
  automationRate: AutomationRate = 'a-rate'

  constructor(owner: FakeAudioNode, defaultValue: number, minValue = -3.4028234663852886e38, maxValue = 3.4028234663852886e38) {
    this.owner = owner
    this.defaultValue = defaultValue
    this.minValue = minValue
    this.maxValue = maxValue
  }

  /** Lê a automação no currentTime do contexto. */
  get value(): number { return valueAt(this, this.owner.context.currentTime) }
  /** Como no navegador: escrever vale um setValueAtTime no currentTime. */
  set value(v: number) {
    checkFinite(v, 'value')
    this.#push({ kind: 'set', value: v, time: this.owner.context.currentTime })
  }

  setValueAtTime(value: number, startTime: number): this {
    checkFinite(value, 'value'); checkTime(startTime, 'startTime')
    return this.#push({ kind: 'set', value, time: startTime })
  }
  linearRampToValueAtTime(value: number, endTime: number): this {
    checkFinite(value, 'value'); checkTime(endTime, 'endTime')
    return this.#push({ kind: 'linear', value, time: endTime })
  }
  exponentialRampToValueAtTime(value: number, endTime: number): this {
    checkFinite(value, 'value'); checkTime(endTime, 'endTime')
    if (value === 0) throw new RangeError('exponentialRampToValueAtTime não aceita 0')
    return this.#push({ kind: 'exp', value, time: endTime })
  }
  setTargetAtTime(target: number, startTime: number, timeConstant: number): this {
    checkFinite(target, 'target'); checkTime(startTime, 'startTime'); checkFinite(timeConstant, 'timeConstant')
    if (timeConstant < 0) throw new RangeError('timeConstant não pode ser negativo')
    return this.#push({ kind: 'target', value: target, time: startTime, timeConstant })
  }
  cancelScheduledValues(cancelTime: number): this {
    checkTime(cancelTime, 'cancelTime')
    return this.#push({ kind: 'cancel', time: cancelTime })
  }
  /**
   * Corta o que vem depois de `cancelTime` e segura o valor desse instante. Gravado como
   * 'cancel' + o que mantém o valor: a rampa que cruzava o instante termina nele com o valor
   * do meio; sem rampa, um 'set'. Eventos exatamente no instante ficam (gravados de novo).
   */
  cancelAndHoldAtTime(cancelTime: number): this {
    checkTime(cancelTime, 'cancelTime')
    const line = timeline(this)
    const held = valueAt(this, cancelTime)
    const at = line.filter((e) => e.time === cancelTime)
    const next = line.find((e) => e.time > cancelTime)
    this.#push({ kind: 'cancel', time: cancelTime })
    for (const e of at) this.#push({ ...e })
    const kind = next && (next.kind === 'linear' || next.kind === 'exp') ? next.kind : 'set'
    return this.#push({ kind, value: held, time: cancelTime })
  }
  /** Existe pro tipo do AudioParam; o fake não simula curva e avisa em vez de gravar algo que o valueAt não sabe ler. */
  setValueCurveAtTime(values: number[] | Float32Array, startTime: number, duration: number): this {
    throw domError(`setValueCurveAtTime(${values.length} valores, ${startTime}, ${duration}) não é simulado pelo AudioContext falso`, 'NotSupportedError')
  }

  #push(e: FakeParamEvent): this {
    this.events.push(e)
    calledAt.set(e, this.owner.context.currentTime)
    return this
  }
}

/** Eventos em vigor, em ordem de tempo: cada 'cancel' tira os de tempo maior ou igual gravados antes dele. */
function timeline(p: FakeAudioParam): FakeParamEvent[] {
  let line: FakeParamEvent[] = []
  for (const e of p.events) {
    if (e.kind === 'cancel') { line = line.filter((x) => x.time < e.time); continue }
    let i = line.length
    while (i > 0 && line[i - 1].time > e.time) i--
    line.splice(i, 0, e)
  }
  return line
}

function rampAt(kind: 'linear' | 'exp', t0: number, v0: number, t1: number, v1: number, t: number): number {
  if (t1 <= t0) return v1
  const f = (t - t0) / (t1 - t0)
  if (kind === 'linear') return v0 + (v1 - v0) * f
  // Como na especificação: com sinais trocados ou partindo de 0 o valor fica parado até o fim.
  if (v0 === 0 || v0 * v1 < 0) return v0
  return v0 * Math.pow(v1 / v0, f)
}

type Curve = { kind: 'const'; value: number } | { kind: 'target'; start: number; from: number; to: number; tc: number }
const curveAt = (c: Curve, t: number) =>
  c.kind === 'const' ? c.value : c.tc === 0 ? c.to : c.to + (c.from - c.to) * Math.exp(-(t - c.start) / c.tc)

/**
 * Valor do parâmetro no instante `t` (tempo do contexto), pelas regras do Web Audio: 'set'
 * salta, 'linear' e 'exp' andam do evento anterior até o tempo delas, 'target' se aproxima
 * do alvo com a constante de tempo, 'cancel' apaga o que vinha depois. Rampa depois de um
 * 'target' parte do início dele (simplificação: substitui o alvo).
 */
export function valueAt(param: FakeAudioParam | AudioParam, t: number): number {
  if (!(param instanceof FakeAudioParam)) throw new TypeError('valueAt: o parâmetro não é do AudioContext falso')
  let curve: Curve = { kind: 'const', value: param.defaultValue }
  let prevTime: number | null = null
  for (const e of timeline(param)) {
    const v = e.value ?? 0
    if (e.kind === 'linear' || e.kind === 'exp') {
      const t0 = prevTime ?? calledAt.get(e) ?? 0
      if (t < e.time) return t < t0 ? curveAt(curve, t) : rampAt(e.kind, t0, curveAt(curve, t0), e.time, v, t)
      curve = { kind: 'const', value: v }
    } else if (e.kind === 'set') {
      if (t < e.time) return curveAt(curve, t)
      curve = { kind: 'const', value: v }
    } else if (e.kind === 'target') {
      if (t < e.time) return curveAt(curve, t)
      curve = { kind: 'target', start: e.time, from: curveAt(curve, e.time), to: v, tc: e.timeConstant ?? 0 }
    }
    prevTime = e.time
  }
  return curveAt(curve, t)
}

// ---------- Nós ----------

interface NodeShape { inputs: number; outputs: number; channelCount?: number; mode?: ChannelCountMode; interpretation?: ChannelInterpretation }

export class FakeAudioNode extends FakeEventTarget {
  readonly kind: string
  readonly numberOfInputs: number
  readonly numberOfOutputs: number
  channelCountMode: ChannelCountMode
  channelInterpretation: ChannelInterpretation
  readonly connections: FakeConnection[] = []
  readonly #context: FakeAudioContext
  #channelCount: number

  constructor(context: FakeAudioContext, kind: string, shape: NodeShape) {
    super()
    this.#context = context
    this.kind = kind
    this.numberOfInputs = shape.inputs
    this.numberOfOutputs = shape.outputs
    this.#channelCount = shape.channelCount ?? 2
    this.channelCountMode = shape.mode ?? 'max'
    this.channelInterpretation = shape.interpretation ?? 'speakers'
  }

  /** O contexto falso, com o tipo do Web Audio: assim o nó do fake entra onde o código pede AudioNode. */
  get context(): BaseAudioContext { return asAudioContext(this.#context) }

  get channelCount(): number { return this.#channelCount }
  set channelCount(n: number) {
    if (!Number.isInteger(n) || n < 1 || n > 32) throw domError(`channelCount ${n} fora de 1 a 32`, 'NotSupportedError')
    this.checkChannelCount(n)
    this.#channelCount = n
  }
  protected checkChannelCount(n: number): void { void n }

  connect<T extends FakeAudioNode | AudioNode>(destination: T, output?: number, input?: number): T
  connect(destination: FakeAudioParam | AudioParam, output?: number): void
  connect(destination: FakeGraphItem, output = 0, input = 0): FakeGraphItem | void {
    if (!Number.isInteger(output) || output < 0 || output >= this.numberOfOutputs) {
      throw domError(`${this.kind} não tem a saída ${output}`, 'IndexSizeError')
    }
    const isParam = destination instanceof FakeAudioParam
    if (isParam) {
      if (destination.owner.context !== this.context) throw domError('parâmetro de outro contexto', 'InvalidAccessError')
      input = 0
    } else if (destination instanceof FakeAudioNode) {
      if (destination.context !== this.context) throw domError('nó de outro contexto', 'InvalidAccessError')
      if (!Number.isInteger(input) || input < 0 || input >= destination.numberOfInputs) {
        throw domError(`${destination.kind} não tem a entrada ${input}`, 'IndexSizeError')
      }
    }
    // Ligação repetida (mesmo alvo, saída e entrada) é ignorada, como no navegador.
    if (!this.connections.some((c) => c.to === destination && c.output === output && c.input === input)) {
      this.connections.push({ to: destination, output, input })
    }
    return isParam ? undefined : destination
  }

  /** Sem argumento: tudo. Com número: tudo daquela saída. Com alvo (e saída/entrada): só essas; alvo não ligado lança. */
  disconnect(): void
  disconnect(output: number): void
  disconnect(destination: FakeGraphItem, output?: number, input?: number): void
  disconnect(target?: number | FakeGraphItem, output?: number, input?: number): void {
    if (target === undefined) { this.connections.length = 0; return }
    if (typeof target === 'number') {
      if (!Number.isInteger(target) || target < 0 || target >= this.numberOfOutputs) {
        throw domError(`${this.kind} não tem a saída ${target}`, 'IndexSizeError')
      }
      this.#keep((c) => c.output !== target)
      return
    }
    const removed = this.#keep((c) => !(c.to === target && (output === undefined || c.output === output) && (input === undefined || c.input === input)))
    if (removed === 0) throw domError(`${this.kind} não estava ligado nesse alvo`, 'InvalidAccessError')
  }

  #keep(keep: (c: FakeConnection) => boolean): number {
    const kept = this.connections.filter(keep)
    const removed = this.connections.length - kept.length
    this.connections.splice(0, this.connections.length, ...kept)
    return removed
  }
}

export class FakeGainNode extends FakeAudioNode {
  readonly gain: FakeAudioParam
  constructor(ctx: FakeAudioContext) {
    super(ctx, 'GainNode', { inputs: 1, outputs: 1 })
    this.gain = new FakeAudioParam(this, 1)
  }
}

export class FakeDelayNode extends FakeAudioNode {
  readonly delayTime: FakeAudioParam
  readonly maxDelayTime: number
  constructor(ctx: FakeAudioContext, maxDelayTime: number) {
    if (!(maxDelayTime > 0 && maxDelayTime < 180)) throw domError(`maxDelayTime ${maxDelayTime} fora de (0, 180)`, 'NotSupportedError')
    super(ctx, 'DelayNode', { inputs: 1, outputs: 1 })
    this.maxDelayTime = maxDelayTime
    this.delayTime = new FakeAudioParam(this, 0, 0, maxDelayTime)
  }
}

export class FakeStereoPannerNode extends FakeAudioNode {
  readonly pan: FakeAudioParam
  constructor(ctx: FakeAudioContext) {
    super(ctx, 'StereoPannerNode', { inputs: 1, outputs: 1, mode: 'clamped-max' })
    this.pan = new FakeAudioParam(this, 0, -1, 1)
  }
}

export class FakeBiquadFilterNode extends FakeAudioNode {
  type: BiquadFilterType = 'lowpass'
  readonly frequency: FakeAudioParam
  readonly Q: FakeAudioParam
  readonly gain: FakeAudioParam
  readonly detune: FakeAudioParam
  constructor(ctx: FakeAudioContext) {
    super(ctx, 'BiquadFilterNode', { inputs: 1, outputs: 1 })
    this.frequency = new FakeAudioParam(this, 350, 0, ctx.sampleRate / 2)
    this.Q = new FakeAudioParam(this, 1)
    this.gain = new FakeAudioParam(this, 0)
    this.detune = new FakeAudioParam(this, 0)
  }
  /** Existe pro tipo do BiquadFilterNode; o fake não calcula resposta de filtro. */
  getFrequencyResponse(frequencyHz: Float32Array, magResponse: Float32Array, phaseResponse: Float32Array): void {
    throw domError(`getFrequencyResponse (${frequencyHz.length}/${magResponse.length}/${phaseResponse.length}) não é simulado pelo AudioContext falso`, 'NotSupportedError')
  }
}

export class FakeAnalyserNode extends FakeAudioNode {
  fftSize = 2048
  minDecibels = -100
  maxDecibels = -30
  smoothingTimeConstant = 0.8
  constructor(ctx: FakeAudioContext) { super(ctx, 'AnalyserNode', { inputs: 1, outputs: 1 }) }
  get frequencyBinCount(): number { return this.fftSize / 2 }
  // Silêncio: o falso não processa som. O teste que quiser nível troca o método no nó.
  getFloatTimeDomainData(array: Float32Array): void { array.fill(0) }
  getByteTimeDomainData(array: Uint8Array): void { array.fill(128) }
  getFloatFrequencyData(array: Float32Array): void { array.fill(Number.NEGATIVE_INFINITY) }
  getByteFrequencyData(array: Uint8Array): void { array.fill(0) }
}

export class FakeChannelMergerNode extends FakeAudioNode {
  constructor(ctx: FakeAudioContext, inputs: number) {
    if (!Number.isInteger(inputs) || inputs < 1 || inputs > 32) throw domError(`merger com ${inputs} entradas`, 'IndexSizeError')
    super(ctx, 'ChannelMergerNode', { inputs, outputs: 1, channelCount: 1, mode: 'explicit' })
  }
}

export class FakeChannelSplitterNode extends FakeAudioNode {
  constructor(ctx: FakeAudioContext, outputs: number) {
    if (!Number.isInteger(outputs) || outputs < 1 || outputs > 32) throw domError(`splitter com ${outputs} saídas`, 'IndexSizeError')
    super(ctx, 'ChannelSplitterNode', { inputs: 1, outputs, channelCount: outputs, mode: 'explicit', interpretation: 'discrete' })
  }
}

export class FakeAudioDestinationNode extends FakeAudioNode {
  /** Canais do aparelho de saída (muda com setSinkId pelo mapa `sinks`). */
  maxChannelCount: number
  constructor(ctx: FakeAudioContext, maxChannelCount: number) {
    super(ctx, 'AudioDestinationNode', { inputs: 1, outputs: 0, mode: 'explicit' })
    this.maxChannelCount = maxChannelCount
  }
  protected checkChannelCount(n: number): void {
    if (n > this.maxChannelCount) throw domError(`o aparelho tem ${this.maxChannelCount} canais (pedido ${n})`, 'IndexSizeError')
  }
}

/** Fonte agendada: grava cada start (no máximo um) e cada stop, na ordem. */
class FakeScheduledSourceNode extends FakeAudioNode {
  readonly starts: FakeStart[] = []
  readonly stops: number[] = []
  onended: ((ev: Event) => unknown) | null = null
  protected begin(start: FakeStart): void {
    if (this.starts.length > 0) throw domError(`start() já foi chamado neste ${this.kind}`, 'InvalidStateError')
    this.starts.push(start)
  }
  stop(when = 0): void {
    if (this.starts.length === 0) throw domError(`stop() antes de start() no ${this.kind}`, 'InvalidStateError')
    checkTime(when, 'when')
    this.stops.push(when)
  }
}

export class FakeAudioBufferSourceNode extends FakeScheduledSourceNode {
  buffer: AudioBuffer | null = null
  loop = false
  loopStart = 0
  loopEnd = 0
  readonly playbackRate: FakeAudioParam
  readonly detune: FakeAudioParam
  constructor(ctx: FakeAudioContext) {
    super(ctx, 'AudioBufferSourceNode', { inputs: 0, outputs: 1 })
    this.playbackRate = new FakeAudioParam(this, 1)
    this.detune = new FakeAudioParam(this, 0)
  }
  start(when = 0, offset = 0, duration?: number): void {
    checkTime(when, 'when'); checkTime(offset, 'offset')
    if (duration !== undefined) checkTime(duration, 'duration')
    this.begin(duration === undefined ? { when, offset } : { when, offset, duration })
  }
}

export class FakeOscillatorNode extends FakeScheduledSourceNode {
  type: OscillatorType = 'sine'
  periodicWave: PeriodicWave | null = null
  readonly frequency: FakeAudioParam
  readonly detune: FakeAudioParam
  constructor(ctx: FakeAudioContext) {
    super(ctx, 'OscillatorNode', { inputs: 0, outputs: 1 })
    this.frequency = new FakeAudioParam(this, 440, -ctx.sampleRate / 2, ctx.sampleRate / 2)
    this.detune = new FakeAudioParam(this, 0)
  }
  start(when = 0): void {
    checkTime(when, 'when')
    this.begin({ when })
  }
  /** Como no navegador, a onda própria troca o tipo pra 'custom'. */
  setPeriodicWave(wave: PeriodicWave): void {
    this.periodicWave = wave
    this.type = 'custom'
  }
}

/**
 * Nó de worklet falso (o AudioWorkletNode), pra o vi.mock('signalsmith-stretch') dos testes
 * do motor devolver no lugar de um objeto solto: as ligações ficam rastreadas como nos
 * outros nós e o `reaches` segue por ele. Entra no `created` do contexto. O mock acrescenta
 * os métodos do pacote (`Object.assign(new FakeWorkletNode(ctx, 'signalsmith-stretch'), { start, stop, schedule, latency })`).
 */
export class FakeWorkletNode extends FakeAudioNode {
  readonly name: string
  constructor(context: FakeAudioContext | BaseAudioContext, name: string, options: { numberOfInputs?: number; numberOfOutputs?: number } = {}) {
    if (!(context instanceof FakeAudioContext)) throw new TypeError('FakeWorkletNode: o contexto não é o AudioContext falso')
    super(context, 'AudioWorkletNode', { inputs: options.numberOfInputs ?? 1, outputs: options.numberOfOutputs ?? 1 })
    this.name = name
    context.created.push({ kind: this.kind, node: this })
  }
}

// ---------- AudioBuffer ----------

/** AudioBuffer falso. Os dados de cada canal nascem zerados no primeiro getChannelData (300 s não ocupam memória à toa). */
export class FakeAudioBuffer {
  readonly numberOfChannels: number
  readonly length: number
  readonly sampleRate: number
  readonly #data: (Float32Array<ArrayBuffer> | undefined)[]

  constructor(numberOfChannels: number, length: number, sampleRate: number) {
    if (!Number.isInteger(numberOfChannels) || numberOfChannels < 1 || numberOfChannels > 32) throw domError(`buffer com ${numberOfChannels} canais`, 'NotSupportedError')
    if (!Number.isInteger(length) || length < 1) throw domError(`buffer com ${length} amostras`, 'NotSupportedError')
    if (!(Number.isFinite(sampleRate) && sampleRate > 0)) throw domError(`buffer a ${sampleRate} Hz`, 'NotSupportedError')
    this.numberOfChannels = numberOfChannels
    this.length = length
    this.sampleRate = sampleRate
    this.#data = new Array<Float32Array<ArrayBuffer> | undefined>(numberOfChannels)
  }

  get duration(): number { return this.length / this.sampleRate }

  getChannelData(channel: number): Float32Array<ArrayBuffer> {
    if (!Number.isInteger(channel) || channel < 0 || channel >= this.numberOfChannels) throw domError(`canal ${channel} não existe`, 'IndexSizeError')
    return (this.#data[channel] ??= new Float32Array(this.length))
  }
  copyFromChannel(destination: Float32Array, channel: number, startInChannel = 0): void {
    destination.set(this.getChannelData(channel).subarray(startInChannel, startInChannel + destination.length))
  }
  copyToChannel(source: Float32Array, channel: number, startInChannel = 0): void {
    this.getChannelData(channel).set(source.subarray(0, Math.max(0, this.length - startInChannel)), startInChannel)
  }
}

// ---------- Contexto ----------

export interface FakeAudioContextOptions {
  sampleRate?: number
  /** Canais do aparelho padrão (o `destination.maxChannelCount` antes de qualquer setSinkId). */
  maxChannelCount?: number
  outputLatency?: number
  /** Canais de cada aparelho por id, pro setSinkId; id fora do mapa volta aos canais do padrão. */
  sinks?: Readonly<Record<string, number>>
  /** Decodificação do teste; sem ela, decodeAudioData devolve 300 s de silêncio em 2 canais. */
  decode?: (data: ArrayBuffer) => FakeAudioBuffer | Promise<FakeAudioBuffer>
}

export interface FakeNodeKinds {
  GainNode: FakeGainNode
  AudioBufferSourceNode: FakeAudioBufferSourceNode
  OscillatorNode: FakeOscillatorNode
  BiquadFilterNode: FakeBiquadFilterNode
  DelayNode: FakeDelayNode
  StereoPannerNode: FakeStereoPannerNode
  ChannelMergerNode: FakeChannelMergerNode
  ChannelSplitterNode: FakeChannelSplitterNode
  AnalyserNode: FakeAnalyserNode
  AudioWorkletNode: FakeWorkletNode
}

export class FakeAudioContext extends FakeEventTarget {
  /** Relógio do áudio: o teste escreve direto. */
  currentTime = 0
  readonly sampleRate: number
  outputLatency: number
  baseLatency = 0
  state: AudioContextState = 'running'
  sinkId = ''
  readonly destination: FakeAudioDestinationNode
  readonly audioWorklet: { readonly modules: string[]; addModule(url: string): Promise<void> }
  /** Todo nó criado pelas fábricas, na ordem (o destination não entra; AudioBuffer não é nó). */
  readonly created: { kind: string; node: unknown }[] = []
  onstatechange: ((ev: Event) => unknown) | null = null
  onsinkchange: ((ev: Event) => unknown) | null = null
  readonly #opts: FakeAudioContextOptions

  constructor(opts: FakeAudioContextOptions = {}) {
    super()
    this.#opts = opts
    this.sampleRate = opts.sampleRate ?? 48000
    this.outputLatency = opts.outputLatency ?? 0
    this.destination = new FakeAudioDestinationNode(this, opts.maxChannelCount ?? 2)
    const modules: string[] = []
    this.audioWorklet = { modules, addModule: async (url: string) => { modules.push(url) } }
  }

  async resume(): Promise<void> { this.#setState('running') }
  async suspend(): Promise<void> { this.#setState('suspended') }
  async close(): Promise<void> { this.#setState('closed') }

  /** Troca o aparelho: `destination.maxChannelCount` vem do mapa `sinks` e o evento sinkchange avisa. O channelCount desce se passar do novo limite. */
  async setSinkId(sinkId: string): Promise<void> {
    if (this.state === 'closed') throw domError('contexto fechado', 'InvalidStateError')
    if (sinkId === this.sinkId) return
    this.sinkId = sinkId
    const max = this.#opts.sinks?.[sinkId] ?? this.#opts.maxChannelCount ?? 2
    this.destination.maxChannelCount = max
    this.destination.channelCount = Math.min(this.destination.channelCount, max)
    this.dispatchEvent(new Event('sinkchange'))
  }

  async decodeAudioData(data: ArrayBuffer, onSuccess?: (buffer: FakeAudioBuffer) => void, onError?: (error: unknown) => void): Promise<FakeAudioBuffer> {
    try {
      const buffer = this.#opts.decode
        ? await this.#opts.decode(data)
        : new FakeAudioBuffer(2, Math.round(DEFAULT_DECODED_SECONDS * this.sampleRate), this.sampleRate)
      onSuccess?.(buffer)
      return buffer
    } catch (error) {
      onError?.(error)
      throw error
    }
  }

  createBuffer(numberOfChannels: number, length: number, sampleRate: number): FakeAudioBuffer {
    return new FakeAudioBuffer(numberOfChannels, length, sampleRate)
  }
  createGain(): FakeGainNode { return this.#add(new FakeGainNode(this)) }
  createBufferSource(): FakeAudioBufferSourceNode { return this.#add(new FakeAudioBufferSourceNode(this)) }
  createOscillator(): FakeOscillatorNode { return this.#add(new FakeOscillatorNode(this)) }
  createBiquadFilter(): FakeBiquadFilterNode { return this.#add(new FakeBiquadFilterNode(this)) }
  createDelay(maxDelayTime = 1): FakeDelayNode { return this.#add(new FakeDelayNode(this, maxDelayTime)) }
  createStereoPanner(): FakeStereoPannerNode { return this.#add(new FakeStereoPannerNode(this)) }
  createChannelMerger(numberOfInputs = 6): FakeChannelMergerNode { return this.#add(new FakeChannelMergerNode(this, numberOfInputs)) }
  createChannelSplitter(numberOfOutputs = 6): FakeChannelSplitterNode { return this.#add(new FakeChannelSplitterNode(this, numberOfOutputs)) }
  createAnalyser(): FakeAnalyserNode { return this.#add(new FakeAnalyserNode(this)) }

  #add<T extends FakeAudioNode>(node: T): T {
    this.created.push({ kind: node.kind, node })
    return node
  }
  #setState(next: AudioContextState): void {
    if (this.state === 'closed') throw domError('contexto fechado', 'InvalidStateError')
    if (this.state === next) return
    this.state = next
    this.dispatchEvent(new Event('statechange'))
  }
}

/** AudioContext falso. Pra trocar o global num teste do motor: `vi.stubGlobal('AudioContext', function () { return createFakeAudioContext() })`. */
export function createFakeAudioContext(opts?: FakeAudioContextOptions): FakeAudioContext {
  return new FakeAudioContext(opts)
}

// ---------- Pontes de tipo (as únicas: teste nenhum precisa de `as unknown as`) ----------

/**
 * O contexto falso com o tipo do Web Audio, pra passar a quem pede AudioContext ou
 * BaseAudioContext. Os nós do fake já entram direto onde se pede AudioNode, GainNode,
 * AudioParam ou AudioBuffer; o contexto não (o fake não tem todas as fábricas do navegador).
 */
export function asAudioContext(ctx: FakeAudioContext): AudioContext {
  if (!(ctx instanceof FakeAudioContext)) throw new TypeError('asAudioContext: o objeto não é o AudioContext falso')
  return ctx as unknown as AudioContext
}

type FakeThing = FakeAudioNode | FakeAudioParam | FakeAudioBuffer | FakeAudioContext

/**
 * O caminho de volta: o que o código devolveu com tipo do Web Audio (a fonte da voz, o
 * ganho do envelope, o ctx guardado nas dependências) com o tipo do fake, pra ler `starts`,
 * `events`, `connections` etc. Lança se o objeto não for do fake.
 */
export function asFake<T extends FakeThing>(item: T): T
export function asFake(item: AudioBufferSourceNode): FakeAudioBufferSourceNode
export function asFake(item: OscillatorNode): FakeOscillatorNode
export function asFake(item: BiquadFilterNode): FakeBiquadFilterNode
export function asFake(item: GainNode): FakeGainNode
export function asFake(item: DelayNode): FakeDelayNode
export function asFake(item: StereoPannerNode): FakeStereoPannerNode
export function asFake(item: AnalyserNode): FakeAnalyserNode
export function asFake(item: AudioDestinationNode): FakeAudioDestinationNode
export function asFake(item: AudioWorkletNode): FakeWorkletNode
export function asFake(item: AudioNode): FakeAudioNode
export function asFake(item: AudioParam): FakeAudioParam
export function asFake(item: AudioBuffer): FakeAudioBuffer
export function asFake(item: BaseAudioContext): FakeAudioContext
export function asFake(item: unknown): FakeThing {
  if (item instanceof FakeAudioNode || item instanceof FakeAudioParam || item instanceof FakeAudioBuffer || item instanceof FakeAudioContext) return item
  throw new TypeError('asFake: o objeto não é do AudioContext falso')
}

// ---------- Ajudantes de grafo ----------

/**
 * Saídas de um item do grafo. AudioParam não tem saída. Objeto sem `connections` (ex.: um
 * mock que só guarda `connectedTo`) lança: sem saber pra onde ele manda o som, uma busca
 * negativa ("nunca chega na VS") passaria sem provar nada.
 */
function connectionsOf(item: unknown): readonly FakeConnection[] {
  if (item instanceof FakeAudioParam) return []
  const list = item !== null && typeof item === 'object' ? (item as { connections?: unknown }).connections : undefined
  if (!Array.isArray(list)) throw new TypeError('nó opaco no grafo: use FakeWorkletNode (o item não grava connections, então não dá pra seguir o som por ele)')
  return list as FakeConnection[]
}

/** Todos os nós de um tipo ('GainNode', 'OscillatorNode'...), na ordem em que nasceram. */
export function nodesOf<K extends keyof FakeNodeKinds>(ctx: FakeAudioContext, kind: K): FakeNodeKinds[K][]
export function nodesOf(ctx: FakeAudioContext, kind: string): FakeAudioNode[]
export function nodesOf(ctx: FakeAudioContext, kind: string): FakeAudioNode[] {
  return ctx.created.filter((c) => c.kind === kind).map((c) => c.node as FakeAudioNode)
}

/** Ligação direta de `a` em `b` (na entrada `input`, se pedida). Não olha nó no meio: pra isso, `reaches`. */
export function connectedTo(a: FakeGraphItem, b: FakeGraphItem, input?: number): boolean {
  return connectionsOf(a).some((c) => c.to === b && (input === undefined || c.input === input))
}

type Carried = 'all' | number // canal que leva o sinal de `from` no fluxo daquele nó ('all': qualquer um)

/**
 * Busca no grafo inteiro: algum caminho leva o som de `from` até `to` (chegando na entrada
 * `input`, se pedida)? Segue ligações em nós (inclusive o FakeWorkletNode do worklet de tom),
 * em AudioParam (o sinal que modula um parâmetro sai pelo dono dele) e em objeto que grave
 * `connections` no mesmo formato. Item opaco no caminho (sem `connections`) lança em vez de
 * parar em silêncio. Respeita merger e splitter: entrar no merger pela entrada i põe o sinal
 * só no canal i; o splitter só passa esse canal na saída de mesmo número. Um nó comum no
 * meio pode misturar canais (upmix), então dali pra frente o sinal conta em qualquer canal.
 * Com isso a busca erra pro lado seguro: acha caminho a mais, nunca a menos. Não trava em ciclo.
 */
export function reaches(from: FakeGraphItem, to: FakeGraphItem, input?: number): boolean {
  const seen = new Map<unknown, Set<Carried>>([[from, new Set<Carried>(['all'])]])
  const stack: [unknown, Carried][] = [[from, 'all']]
  const visit = (item: unknown, carried: Carried) => {
    const got = seen.get(item) ?? new Set<Carried>()
    if (got.has('all') || got.has(carried)) return
    got.add(carried)
    seen.set(item, got)
    stack.push([item, carried])
  }
  while (stack.length > 0) {
    const [item, carried] = stack.pop()!
    const splitter = item instanceof FakeChannelSplitterNode
    for (const c of connectionsOf(item)) {
      if (splitter && carried !== 'all' && c.output !== carried) continue
      if (c.to === to && (input === undefined || c.input === input)) return true
      if (c.to instanceof FakeAudioParam) visit(c.to.owner, 'all')
      else if (c.to instanceof FakeChannelMergerNode) visit(c.to, c.input)
      else if (c.to instanceof FakeChannelSplitterNode) visit(c.to, splitter ? 0 : carried)
      else visit(c.to, 'all')
    }
  }
  return false
}

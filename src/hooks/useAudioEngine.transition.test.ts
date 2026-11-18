// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'
import { act, cleanup, renderHook } from '@testing-library/react'
import {
  connectedTo, createFakeAudioContext, FakeAudioBuffer, FakeAudioBufferSourceNode, FakeAudioParam, nodesOf, reaches, valueAt,
  type FakeAudioContext, type FakeAudioNode, type FakeGainNode,
} from '../test/fakeAudio'
import type { SavedSong } from '../lib/repertoireSchema'
import type { OutputSettings, SongGrid, StageGates, StageMode } from '../lib/stageContracts'
import { useAudioEngine } from './useAudioEngine'

// T28: o motor liga o agendador do pulo (T17) no relógio do áudio. Com stageMode 'novo', armar
// uma seção tocando marca a contagem só pela entrada do canal de click e as vozes novas cruzam
// no "1" do compasso seguinte; REPETIR e LOOP passam pelo mesmo caminho; o FADE do fim é uma
// rampa agendada no principal. Com stageMode 'antigo' (ou sem ele) fica o caminho da v1.4.16
// (rAF e seekTo no fim da seção, sem contagem). O hook roda de verdade com o AudioContext falso
// da T1; o relógio do áudio só anda quando o teste escreve no currentTime e o relógio do Worker
// (T5) é um falso que o teste faz tiquetaquear.

const SR = 48000
const QUANTUM = 128 / SR
// Latência do worklet de tom no modo ao vivo, como o mock do pacote informa (o L da compensação).
const PITCH_LATENCY = 0.12
// Instante comum do play: 2 blocos de 128 amostras depois do relógio, na grade de blocos.
const startAt = (now: number) => (Math.floor(now / QUANTUM + 1e-6) + 2) * QUANTUM
// Busca tocando (Ruling I4-busca): a voz velha desce a partir da folga do corte (10 ms) e as novas
// começam no máximo 6,4 ms antes disso, na grade de blocos; nunca antes dos 2 blocos de sempre.
const seekStartAt = (now: number, lead = 0.01) => Math.max(startAt(now), Math.ceil((now + lead - 0.0064) / QUANTUM - 1e-6) * QUANTUM)
// Com pré-contagem o 1º bipe sai com a folga de reserva (15 blocos, 40 ms; Ruling T30-reagenda).
const countStartAt = (now: number) => (Math.floor(now / QUANTUM + 1e-6) + 15) * QUANTUM
// Música de 20 s a 120 BPM em 4/4 (pulso 0,5 s, compasso 2 s) com o 1 em 0:00 lido no click.
const LEN_S = 20
const GRID: SongGrid = { bpm: 120, firstDownbeat: 0, signature: '4/4', countEvery: 1, source: 'click', meterSource: 'acento' }
// Seções de 2 compassos e a final até o fim: [0,4) Intro, [4,8) Verso, [8,12) Refrão, [12,20) Final.
const MARKERS = [
  { id: 'm0', time: 0, label: 'Intro' }, { id: 'm1', time: 4, label: 'Verso' },
  { id: 'm2', time: 8, label: 'Refrão' }, { id: 'm3', time: 12, label: 'Final' },
]
// Relógio do Worker falso: o teste chama o tique (o motor só olha o plano quando ele bate).
interface FakeClock { onTick: () => void; opts: unknown; running: boolean; mode: 'worker' | 'interval'; start(): void; stop(): void; dispose(): void }

const mem = vi.hoisted(() => ({
  db: new Map<string, unknown>(),
  settings: {} as Record<string, unknown>,
  ctx: null as unknown,
  metaGate: null as Promise<void> | null,
  clocks: [] as FakeClock[],
  frames: [] as ((t: number) => void)[],
  // Cada schedule() pedido a um worklet de tom (nó e semitons).
  schedules: [] as { node: unknown; semitones: number }[],
}))

const isMetaKey = (key: string) => key.startsWith('mt_meta_playlist')
vi.mock('idb-keyval', () => ({
  get: async (key: string) => {
    if (isMetaKey(key) && mem.metaGate) await mem.metaGate
    return isMetaKey(key) ? structuredClone(mem.db.get(key)) : mem.db.get(key)
  },
  set: async (key: string, value: unknown) => { mem.db.set(key, isMetaKey(key) ? structuredClone(value) : value) },
  del: async (key: string) => { mem.db.delete(key) },
  keys: async () => [...mem.db.keys()],
}))
vi.mock('tone', () => ({ setContext: () => {} }))
// Worklet de tom pelo nó rastreado do fake (Ruling T1-N3), contado por nodesOf(ctx, 'AudioWorkletNode');
// o schedule() grava o tom pedido a cada nó.
vi.mock('signalsmith-stretch', async () => {
  const { FakeWorkletNode } = await import('../test/fakeAudio')
  return {
    default: async (ctx: BaseAudioContext) => {
      const node = new FakeWorkletNode(ctx, 'signalsmith-stretch')
      return Object.assign(node, {
        start: async () => {}, stop: async () => {}, latency: async () => PITCH_LATENCY,
        schedule: async (p: { semitones: number }) => { mem.schedules.push({ node, semitones: p.semitones }) },
      })
    },
  }
})
vi.mock('../contexts/SettingsContext', () => ({ useSettings: () => ({ settings: mem.settings, updateSetting: () => {} }) }))
vi.mock('../lib/AudioAnalyzer', () => ({ detectKey: () => 'C', generateEndlessClickTrackFromSample: async () => ({ clickBlob: new Blob(['mono']) }) }))
vi.mock('../lib/clickLibrary', () => ({ loadClickSelection: () => ({ type: 'wood', subdivision: 1 }) }))
vi.mock('../lib/offlineCache', () => ({ getCachedStem: async () => undefined, getCachedStemNames: async () => null, isSongCached: async () => false }))
vi.mock('../audio/schedulerClock', async (importOriginal) => {
  const real = await importOriginal<typeof import('../audio/schedulerClock')>()
  return {
    ...real,
    createSchedulerClock: (onTick: () => void, opts?: unknown) => {
      const clock: FakeClock = {
        onTick, opts, running: false, mode: 'worker',
        start() { clock.running = true }, stop() { clock.running = false }, dispose() { clock.running = false },
      }
      mem.clocks.push(clock)
      return clock
    },
  }
})

// jsdom 26 não tem Blob.arrayBuffer(); o motor lê os stems com ele.
beforeAll(() => {
  if (typeof Blob.prototype.arrayBuffer === 'function') return
  Blob.prototype.arrayBuffer = function (this: Blob) {
    return new Promise<ArrayBuffer>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result as ArrayBuffer)
      reader.onerror = () => reject(reader.error)
      reader.readAsArrayBuffer(this)
    })
  }
})

const SPLIT: OutputSettings = { mode: 'split2', earOnSecond: false, multi: { vsPair: 0, click: 2, guide: 3 } }

let error: MockInstance<typeof console.error>
beforeEach(() => {
  localStorage.clear()
  mem.db.clear()
  mem.metaGate = null
  mem.ctx = null
  mem.clocks = []
  mem.frames = []
  mem.schedules = []
  mem.settings = { autoPan: false, audioDeviceId: 'default', outputs: SPLIT, legacyPanReset: false }
  // A conta já passou pelo reset dos pans antigos (T25).
  localStorage.setItem('mt_legacy_pans_reset:u1', '1')
  // 20 s de áudio; o arquivo diz quantos canais ("stereo..." ou "mono...").
  const decode = async (data: ArrayBuffer) => new FakeAudioBuffer(new TextDecoder().decode(data).startsWith('stereo') ? 2 : 1, LEN_S * SR, SR)
  vi.stubGlobal('AudioContext', function () {
    const ctx = createFakeAudioContext({ decode })
    mem.ctx = ctx
    return ctx
  })
  // Quadros de tela na mão (o caminho antigo anda pelo rAF).
  vi.stubGlobal('requestAnimationFrame', (cb: (t: number) => void) => { mem.frames.push(cb); return mem.frames.length })
  vi.stubGlobal('cancelAnimationFrame', () => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  error = vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  expect(error).not.toHaveBeenCalled()
  vi.restoreAllMocks()
})

const ctxOf = () => mem.ctx as FakeAudioContext
const META = 'mt_meta_playlist_u1'
const ch = (id: string, name: string): SavedSong['channels'][number] => ({ id, name, volume: 1, muted: false, soloed: false, pan: 0, bus: '1/2' })
// Click e Guia mono, Baixo e Teclado estéreo. Sem `click: false`, a música tem o canal de click.
function song(opts: { click?: boolean; pitch?: number } = {}): SavedSong {
  const channels = [ch('click', 'CLICK'), ch('guide', 'Voz Guia'), ch('bass', 'BASS_1'), ch('keys', 'KEYS')]
  return {
    id: 's1', name: 'Música', duration: LEN_S, pitch: opts.pitch ?? 0, originalKey: 'C', schemaVersion: 3, channelOrder: 'auto',
    markers: MARKERS, grid: GRID, channels: opts.click === false ? channels.slice(1) : channels,
  }
}
function seed(s: SavedSong) {
  mem.db.set(META, structuredClone([s]))
  for (const c of s.channels) mem.db.set(`mt_files_u1:ch:${c.id}`, new File([/BASS|KEYS/.test(c.name) ? 'stereo' : 'mono'], `${c.name}.wav`, { type: 'audio/wav' }))
}

type EngineOpts = { stageMode?: StageMode; sectionGates?: StageGates } | undefined
async function openApp(opts?: EngineOpts) {
  const hook = renderHook((p: EngineOpts) => useAudioEngine('u1', p), { initialProps: opts })
  let release!: () => void
  mem.metaGate = new Promise<void>((resolve) => { release = resolve })
  let init!: Promise<void>
  await act(async () => { init = hook.result.current.initEngine() })
  await act(async () => { release(); await init })
  mem.metaGate = null
  return hook
}
type Hook = Awaited<ReturnType<typeof openApp>>
const chan = (hook: Hook, id: string) => hook.result.current.channels.find((c) => c.id === id)!
async function play(hook: Hook) {
  await act(async () => { await hook.result.current.play() })
}
const sources = () => nodesOf(ctxOf(), 'AudioBufferSourceNode')
// Fontes que ninguém mandou parar: as vozes que tocam (ou vão tocar).
const live = (list: FakeAudioBufferSourceNode[]) => list.filter((s) => s.stops.length === 0)
// Envelope da voz: o único nó em que a fonte liga.
function envOf(source: FakeAudioBufferSourceNode): FakeGainNode {
  expect(source.connections).toHaveLength(1)
  return source.connections[0].to as FakeGainNode
}
// Bipes da contagem (T7): o triângulo marca o instante; o passa-baixa é o fim da receita.
const triangles = () => nodesOf(ctxOf(), 'OscillatorNode').filter((o) => o.type === 'triangle')
const beepTimes = () => triangles().map((o) => o.starts[0].when)
const accents = () => triangles().map((o) => o.frequency.value === 1319)
const beepFilters = () => nodesOf(ctxOf(), 'BiquadFilterNode')
const near = (xs: readonly number[]) => xs.map((x) => Number(x.toFixed(6)))
// Grafo das saídas (T12) e cortes (T25), achado pelas ligações e não pela ordem de criação: o
// fader de um canal liga só no corte do papel dele, e o corte só no barramento do papel; o mudo
// geral é o que liga no destino e o principal o que liga no mudo.
const gains = () => nodesOf(ctxOf(), 'GainNode')
function only(node: unknown): FakeGainNode {
  const out = (node as FakeAudioNode).connections
  expect(out).toHaveLength(1)
  return out[0].to as FakeGainNode
}
const busOf = (fader: unknown) => only(only(fader))
// Barramentos Click, Guia e VS da música. Sem canal de click, o do Click vem do atraso da contagem
// (o único atraso no tom 0): atraso -> panner da contagem -> corte do Click -> barramento.
function buses(hook: Hook) {
  const click = hook.result.current.channels.find((c) => c.id === 'click')
  const delays = nodesOf(ctxOf(), 'DelayNode')
  if (!click) expect(delays).toHaveLength(1)
  return {
    click: click ? busOf(click.gainNode) : only(only(only(delays[0]))),
    guide: busOf(chan(hook, 'guide').gainNode),
    vs: busOf(chan(hook, 'bass').gainNode),
  }
}
const masterMute = () => gains().find((g) => connectedTo(g, ctxOf().destination))!
const master = () => gains().find((g) => connectedTo(g, masterMute()))!
// Maior salto por amostra do parâmetro entre `from` e `to` (pela automação do fake), e onde.
function maxStep(param: AudioParam, from: number, to: number): { step: number; at: number } {
  let worst = { step: 0, at: from }
  let prev = valueAt(param, from)
  for (let k = 1; from + k / SR <= to; k++) {
    const v = valueAt(param, from + k / SR)
    if (Math.abs(v - prev) > worst.step) worst = { step: Math.abs(v - prev), at: from + k / SR }
    prev = v
  }
  return worst
}
// O relógio do Worker do palco novo (o do corte das trocas de rota tem intervalo próprio).
const sectionClock = () => mem.clocks.find((c) => (c.opts as { intervalMs?: number } | undefined)?.intervalMs === undefined)
function tickAt(t: number) {
  const clock = sectionClock()
  expect(clock?.running).toBe(true)
  ctxOf().currentTime = t
  act(() => { clock!.onTick() })
}
// Tiques de 25 ms de `from` até `to`; devolve os pousos novos (seção e instante do "1").
function run(hook: Hook, from: number, to: number): { index: number; at: number }[] {
  const landings: { index: number; at: number }[] = []
  let last = hook.result.current.landed
  for (let k = 0; ; k++) {
    const t = from + k * 0.025
    if (t > to + 1e-9) break
    tickAt(t)
    const l = hook.result.current.landed
    if (l && l !== last) landings.push(l)
    last = l
  }
  return landings
}
function armAt(t: number, arm: () => unknown) {
  ctxOf().currentTime = t
  let out: unknown
  act(() => { out = arm() })
  return out
}
// Relógio do áudio andando (o fake não anda sozinho) enquanto uma troca de rota espera o fundo do corte.
async function letAudioRun(ms = 60) {
  const ctx = ctxOf()
  const timer = setInterval(() => { ctx.currentTime += 0.001 }, 1)
  try { await act(async () => { await new Promise((resolve) => setTimeout(resolve, ms)) }) } finally { clearInterval(timer) }
}
// O bipe k soa? (o triângulo dele para depois de começar; cada bipe nasce com um triângulo e um passa-baixa)
const sounds = (k: number) => {
  const tri = triangles()[k]
  return Math.min(...tri.stops) > tri.starts[0].when
}
// Roda os quadros de tela pendentes (o caminho antigo).
function frame(t: number) {
  ctxOf().currentTime = t
  const pending = mem.frames.splice(0)
  act(() => { for (const cb of pending) cb(t * 1000) })
}

const LIVRE: StageGates = { sections: false, infinite: false, maxRepeats: 1, bandSections: false }
const STUDIO: StageGates = { sections: true, infinite: true, maxRepeats: 9, bandSections: true }

describe('pulo agendado no palco novo', () => {
  it('tocando, armar a próxima agenda a contagem no canal de click e pousa no 1', async () => {
    seed(song())
    const hook = await openApp({ stageMode: 'novo' })
    const bus = buses(hook)
    await play(hook)
    const t0 = startAt(0)
    expect(hook.result.current.stageMode).toBe('novo')
    expect(sectionClock()?.running).toBe(true)
    const before = live(sources())
    expect(before).toHaveLength(4)

    // Na Intro (1 s), arma o Verso: o pulo cai no fim da Intro (4 s), o 1 do compasso seguinte.
    expect(armAt(t0 + 1, () => hook.result.current.armSection(1))).toEqual({ upgrade: false })
    const T = t0 + 4
    expect(hook.result.current.sectionIntent).toEqual({ target: 1, plays: 1 })
    expect(hook.result.current.transitionView).toMatchObject({ from: 0, to: 1, kind: 'proxima', committed: false, countTotal: 4, hasGrid: true, clickAudible: true })
    expect(hook.result.current.transitionView!.switchAt).toBeCloseTo(T, 9)
    // Fora do horizonte (0,3 s antes do primeiro bipe) nada vai pro áudio.
    run(hook, t0 + 1.025, t0 + 1.675)
    expect(triangles()).toHaveLength(0)
    expect(sources()).toHaveLength(4)

    run(hook, t0 + 1.7, t0 + 1.75)
    expect(hook.result.current.transitionView?.committed).toBe(true)
    // Contagem 1-2-3-4 no último compasso, acento no 1, ancorada no 1 do destino.
    expect(near(beepTimes())).toEqual(near([t0 + 2, t0 + 2.5, t0 + 3, t0 + 3.5]))
    expect(accents()).toEqual([true, false, false, false])
    // Os bipes entram pela entrada do canal de click (tom 0: o panner dele) e nunca chegam na VS.
    const clickPanner = chan(hook, 'click').pannerNode
    for (const f of beepFilters()) {
      expect(connectedTo(f, clickPanner)).toBe(true)
      expect(reaches(f, bus.click)).toBe(true)
      expect(reaches(f, bus.vs)).toBe(false)
    }
    // Guia calada do 1º bipe até o 1 (no barramento dela, não no fader) e de volta depois.
    expect(reaches(chan(hook, 'guide').gainNode, bus.guide)).toBe(true)
    expect(valueAt(bus.guide.gain, t0 + 1.9)).toBe(1)
    expect(valueAt(bus.guide.gain, t0 + 3)).toBe(0)
    expect(valueAt(bus.guide.gain, T + 0.02)).toBe(1)
    // Vozes novas: uma por canal, 5 ms antes do 1, no ponto 4 - 0,005; as de antes descem até o 1.
    const fresh = sources().filter((s) => !before.includes(s))
    expect(fresh).toHaveLength(4)
    for (const s of fresh) {
      expect(s.starts[0].when).toBeCloseTo(T - 0.005, 9)
      expect(s.starts[0].offset).toBeCloseTo(3.995, 9)
      // O envelope já está em 0 antes da fonte começar (não depende de T - 5 ms cair na amostra).
      expect(valueAt(envOf(s).gain, T - 0.006)).toBe(0)
      expect(valueAt(envOf(s).gain, T - 0.005)).toBe(0)
      expect(valueAt(envOf(s).gain, T)).toBe(1)
    }
    for (const s of before) expect(valueAt(envOf(s).gain, T)).toBe(0)

    // Pousa no 1: a passagem conta, desarma, e 100 ms depois só uma voz por canal.
    const landings = run(hook, t0 + 1.775, T + 0.1)
    expect(landings).toHaveLength(1)
    expect(landings[0].index).toBe(1)
    expect(landings[0].at).toBeCloseTo(T, 9)
    expect(hook.result.current.sectionIntent).toBeNull()
    expect(live(sources())).toEqual(fresh)
    expect(hook.result.current.heardPosition()).toBeCloseTo(4.1, 6)
  })

  it('sem canal de click a contagem vai pro barramento do click', async () => {
    seed(song({ click: false }))
    const hook = await openApp({ stageMode: 'novo' })
    const bus = buses(hook)
    await play(hook)
    const t0 = startAt(0)
    armAt(t0 + 1, () => hook.result.current.armSection(1))
    run(hook, t0 + 1.025, t0 + 1.75)
    expect(near(beepTimes())).toEqual(near([t0 + 2, t0 + 2.5, t0 + 3, t0 + 3.5]))
    // Pelo atraso da contagem do grafo (R-35), no barramento do Click; nada na VS.
    const [countDelay] = nodesOf(ctxOf(), 'DelayNode')
    expect(nodesOf(ctxOf(), 'DelayNode')).toHaveLength(1)
    for (const f of beepFilters()) {
      expect(connectedTo(f, countDelay)).toBe(true)
      expect(reaches(f, bus.click)).toBe(true)
      expect(reaches(f, bus.vs)).toBe(false)
      expect(reaches(f, bus.guide)).toBe(false)
    }
    // Sem canal de click a contagem sai: o aviso não diz "CLICK DESLIGADO".
    expect(hook.result.current.transitionView?.clickAudible).toBe(true)
  })

  it('REPETIR 2 conta e volta duas vezes e desarma', async () => {
    seed(song())
    const hook = await openApp({ stageMode: 'novo' })
    const bus = buses(hook)
    await play(hook)
    const t0 = startAt(0)
    tickAt(t0 + 5)
    // No Verso (5 s), REPETIR 2: volta pro início do Verso no fim dele, duas vezes.
    expect(armAt(t0 + 5, () => hook.result.current.armRepeat(2))).toEqual({ upgrade: false })
    expect(hook.result.current.sectionIntent).toEqual({ target: 1, plays: 2 })
    expect(hook.result.current.transitionView).toMatchObject({ from: 1, to: 1, kind: 'repete', plays: 2 })

    const first = run(hook, t0 + 5.025, t0 + 8.1)
    expect(first.map((l) => l.index)).toEqual([1])
    expect(first[0].at).toBeCloseTo(t0 + 8, 9)
    expect(hook.result.current.sectionIntent).toEqual({ target: 1, plays: 1 })
    const second = run(hook, t0 + 8.125, t0 + 12.1)
    expect(second.map((l) => l.index)).toEqual([1])
    expect(second[0].at).toBeCloseTo(t0 + 12, 9)
    expect(hook.result.current.sectionIntent).toBeNull()

    // Contou nas duas voltas, e a guia calou no último compasso de cada uma.
    expect(near(beepTimes())).toEqual(near([t0 + 6, t0 + 6.5, t0 + 7, t0 + 7.5, t0 + 10, t0 + 10.5, t0 + 11, t0 + 11.5]))
    expect(accents()).toEqual([true, false, false, false, true, false, false, false])
    expect(valueAt(bus.guide.gain, t0 + 7)).toBe(0)
    expect(valueAt(bus.guide.gain, t0 + 9)).toBe(1)
    expect(valueAt(bus.guide.gain, t0 + 11)).toBe(0)

    // Desarmado, segue reto pro Refrão: nenhum pouso nem bipe a mais.
    expect(run(hook, t0 + 12.125, t0 + 16.5)).toEqual([])
    expect(triangles()).toHaveLength(8)
    expect(hook.result.current.heardPosition()).toBeCloseTo(8.5, 6)
  })

  it('LOOP repete sem contagem até cancelar', async () => {
    seed(song())
    const hook = await openApp({ stageMode: 'novo' })
    const bus = buses(hook)
    await play(hook)
    const t0 = startAt(0)
    tickAt(t0 + 5)
    armAt(t0 + 5, () => hook.result.current.toggleSectionLoop())
    expect(hook.result.current.sectionIntent).toEqual({ target: 1, plays: 'infinite' })
    expect(hook.result.current.transitionView).toMatchObject({ from: 1, to: 1, kind: 'repete', countTotal: 0 })

    const landings = run(hook, t0 + 5.025, t0 + 16.1)
    expect(landings.map((l) => l.index)).toEqual([1, 1, 1])
    expect(near(landings.map((l) => l.at))).toEqual(near([t0 + 8, t0 + 12, t0 + 16]))
    expect(hook.result.current.sectionIntent).toEqual({ target: 1, plays: 'infinite' })
    // Sem contagem e sem calar a guia.
    expect(triangles()).toHaveLength(0)
    expect(valueAt(bus.guide.gain, t0 + 15)).toBe(1)

    // LOOP de novo cancela: no fim do Verso a música segue pro Refrão.
    armAt(t0 + 17, () => hook.result.current.toggleSectionLoop())
    expect(hook.result.current.sectionIntent).toBeNull()
    expect(run(hook, t0 + 17.025, t0 + 21)).toEqual([])
    expect(hook.result.current.heardPosition()).toBeCloseTo(9, 6)
  })

  it('pausar com pulo agendado não deixa voz nem bipe vivo', async () => {
    seed(song())
    const hook = await openApp({ stageMode: 'novo' })
    const bus = buses(hook)
    await play(hook)
    const t0 = startAt(0)
    armAt(t0 + 1, () => hook.result.current.armSection(1))
    run(hook, t0 + 1.025, t0 + 2.2)
    expect(hook.result.current.transitionView?.committed).toBe(true)
    expect(triangles()).toHaveLength(4)
    expect(sources()).toHaveLength(8)

    // Pausa com o 1º bipe soando e as vozes novas ainda por começar.
    const now = t0 + 2.2
    ctxOf().currentTime = now
    act(() => { hook.result.current.pause() })
    // Toda fonte e todo bipe param logo (a voz que tocava desce em rampa curta antes).
    for (const s of sources()) expect(Math.min(...s.stops)).toBeLessThanOrEqual(now + 0.05)
    for (const o of nodesOf(ctxOf(), 'OscillatorNode')) expect(Math.min(...o.stops)).toBeLessThanOrEqual(now + 0.03)
    // As vozes do pulo nunca chegam a soar (param antes de começar).
    for (const s of sources().filter((x) => x.starts[0].when > now)) expect(Math.min(...s.stops)).toBeLessThanOrEqual(s.starts[0].when)
    // A guia volta, o relógio do Worker desliga, a tela fica sem transição e o pedido continua.
    expect(valueAt(bus.guide.gain, now + 0.02)).toBe(1)
    expect(sectionClock()?.running).toBe(false)
    expect(hook.result.current.transitionView).toBeNull()
    expect(hook.result.current.sectionIntent).toEqual({ target: 1, plays: 1 })
    expect(hook.result.current.heardPosition()).toBeCloseTo(2.2, 6)
  })

  it('busca com pulo armado re-planeja a partir da posição nova', async () => {
    seed(song())
    const hook = await openApp({ stageMode: 'novo' })
    await play(hook)
    const t0 = startAt(0)
    armAt(t0 + 1, () => hook.result.current.armSection(3))
    expect(hook.result.current.transitionView).toMatchObject({ from: 0, to: 3 })
    expect(hook.result.current.transitionView!.switchAt).toBeCloseTo(t0 + 4, 9)

    // Busca pro Refrão (9 s): o pulo pra Final sai do fim do Refrão (12 s), no relógio novo.
    const now = t0 + 1.2
    ctxOf().currentTime = now
    act(() => { hook.result.current.seekTo(9) })
    const t1 = startAt(now)
    expect(hook.result.current.sectionIntent).toEqual({ target: 3, plays: 1 })
    expect(hook.result.current.transitionView).toMatchObject({ from: 2, to: 3, kind: 'proxima', committed: false })
    expect(hook.result.current.transitionView!.switchAt).toBeCloseTo(t1 + 3, 9)
    const landings = run(hook, now + 0.025, t1 + 3.1)
    expect(landings.map((l) => l.index)).toEqual([3])
    expect(landings[0].at).toBeCloseTo(t1 + 3, 9)
    expect(near(beepTimes())).toEqual(near([t1 + 1, t1 + 1.5, t1 + 2, t1 + 2.5]))
  })

  it('FADE é uma rampa agendada; com pulo armado não começa e o principal volta no instante do pulo', async () => {
    seed(song())
    const hook = await openApp({ stageMode: 'novo' })
    act(() => { hook.result.current.setPlaybackMode('fade-out') })
    await play(hook)
    const t0 = startAt(0)
    const gain = master().gain
    // Uma rampa só, do volume em 15 s até 0 no fim (20 s), marcada no play.
    expect(valueAt(gain, t0 + 14.9)).toBe(1)
    expect(valueAt(gain, t0 + 17.5)).toBeCloseTo(0.5, 9)
    expect(valueAt(gain, t0 + 20)).toBe(0)

    // Intenção armada (REPETE a Intro): a rampa não começa; pousado, ela volta da posição nova.
    armAt(t0 + 1, () => hook.result.current.armSection(0))
    expect(hook.result.current.sectionIntent).toEqual({ target: 0, plays: 1 })
    expect(valueAt(gain, t0 + 17.5)).toBe(1)
    expect(run(hook, t0 + 1.025, t0 + 4.1).map((l) => l.index)).toEqual([0])
    expect(valueAt(gain, t0 + 17.5)).toBe(1)
    expect(valueAt(gain, t0 + 21.5)).toBeCloseTo(0.5, 9)

    // No meio da rampa (16 s na Final: 0,8 no play), arma a Intro: o principal fica onde está e
    // volta pro volume no 1 do pulo (fim da Final, 20 s), junto com as vozes.
    const now = t0 + 4.2
    ctxOf().currentTime = now
    act(() => { hook.result.current.seekTo(16) })
    const t1 = seekStartAt(now)
    // A voz velha segue em ganho 1 até a folga do corte: o principal desce pro FADE dali, em 5 ms (Ruling I2-proxima).
    expect(valueAt(gain, t1)).toBe(1)
    expect(valueAt(gain, now + 0.015)).toBeCloseTo((t1 + 4 - (now + 0.015)) / 5, 9)
    expect(maxStep(gain, now, now + 0.03).step).toBeLessThanOrEqual(0.01)
    expect(valueAt(gain, t1 + 0.5)).toBeCloseTo(0.7, 9)
    armAt(t1 + 0.5, () => hook.result.current.armSection(0))
    // Segura no relógio mais a folga do corte (10 ms): a thread do áudio já calculou o de agora.
    const held = (0.8 * (4 - 0.51)) / 4
    expect(maxStep(gain, t1 + 0.49, t1 + 0.6).step).toBeLessThanOrEqual(0.01)
    const T = t1 + 4
    expect(hook.result.current.transitionView!.switchAt).toBeCloseTo(T, 9)
    expect(valueAt(gain, t1 + 3)).toBeCloseTo(held, 9)
    run(hook, t1 + 0.525, t1 + 1.75)
    expect(hook.result.current.transitionView?.committed).toBe(true)
    expect(valueAt(gain, T - 0.005)).toBeCloseTo(held, 9)
    expect(valueAt(gain, T)).toBe(1)
    expect(run(hook, t1 + 1.775, T + 0.1).map((l) => l.index)).toEqual([0])
    expect(valueAt(gain, T + 1)).toBe(1)
    // Do 0:00 da Intro, a rampa volta pro fim da música.
    expect(valueAt(gain, T + 17.5)).toBeCloseTo(0.5, 9)
    // Só set e rampa linear no principal: nenhuma rampa depois de setTarget (Ruling ÁUDIO).
    expect(master().gain.events.filter((e) => e.kind === 'target' || e.kind === 'exp')).toEqual([])
  })

  it('parado, tocar numa seção leva pro início dela e desarma', async () => {
    seed(song())
    const hook = await openApp({ stageMode: 'novo' })
    expect(armAt(0, () => hook.result.current.armSection(2))).toEqual({ upgrade: false })
    expect(hook.result.current.currentTime).toBe(8)
    expect(hook.result.current.heardPosition()).toBe(8)
    expect(hook.result.current.sectionIntent).toBeNull()
    // REPETIR parado arma na seção atual, sem buscar.
    armAt(0, () => hook.result.current.armRepeat(3))
    expect(hook.result.current.sectionIntent).toEqual({ target: 2, plays: 3 })
    expect(hook.result.current.currentTime).toBe(8)
    // Tocar noutra seção leva pra ela e desarma; a seta anda uma e leva pro início.
    armAt(0, () => hook.result.current.armSection(1))
    expect(hook.result.current.currentTime).toBe(4)
    expect(hook.result.current.sectionIntent).toBeNull()
    armAt(0, () => hook.result.current.stepSection(1))
    expect(hook.result.current.currentTime).toBe(8)
    // Nada tocou.
    expect(sources()).toHaveLength(0)
    expect(hook.result.current.isPlaying).toBe(false)
  })

  it('papel trocado pra Click com pulo marcado: a contagem espera a troca de rota no atraso da contagem', async () => {
    seed(song({ click: false }))
    const hook = await openApp({ stageMode: 'novo' })
    const bus = buses(hook)
    await play(hook)
    const t0 = startAt(0)
    armAt(t0 + 1, () => hook.result.current.armSection(1))
    run(hook, t0 + 1.025, t0 + 1.75)
    const [countDelay] = nodesOf(ctxOf(), 'DelayNode')
    expect(beepFilters()).toHaveLength(4)
    // O Baixo vira Click tocando: o fader dele só sai da VS no fundo do corte. O pulo marcado é
    // desfeito (os bipes que faltavam param) e marcado de novo pelo atraso da contagem, nunca pela
    // entrada do Baixo, enquanto a troca de rota não acaba.
    act(() => { hook.result.current.setChannelMeta('bass', { role: 'click' }) })
    tickAt(t0 + 1.775)
    expect(hook.result.current.transitionView?.committed).toBe(true)
    const again = beepFilters().slice(4)
    expect(again).toHaveLength(4)
    for (const f of again) expect(connectedTo(f, countDelay)).toBe(true)
    await letAudioRun()
    expect(reaches(chan(hook, 'bass').gainNode, bus.click)).toBe(true)
    expect(reaches(chan(hook, 'bass').gainNode, bus.vs)).toBe(false)
    // Nenhum bipe que soa chega na VS.
    beepFilters().forEach((f, k) => { if (sounds(k)) expect(reaches(f, bus.vs)).toBe(false) })
    expect([0, 1, 2, 3, 4, 5, 6, 7].map(sounds)).toEqual([false, false, false, false, true, true, true, true])
    // Depois da troca, o pulo seguinte conta pela entrada do Click novo (o panner do Baixo).
    const T = t0 + 4
    expect(run(hook, ctxOf().currentTime + 0.025, T + 0.1).map((l) => l.index)).toEqual([1])
    armAt(T + 0.2, () => hook.result.current.armSection(2))
    run(hook, T + 0.225, T + 1.75)
    const third = beepFilters().slice(8)
    expect(third).toHaveLength(4)
    for (const f of third) {
      expect(connectedTo(f, chan(hook, 'bass').pannerNode)).toBe(true)
      expect(reaches(f, bus.click)).toBe(true)
      expect(reaches(f, bus.vs)).toBe(false)
    }
  })

  it('duas trocas de papel do Click seguidas com pulo armado: a contagem só volta pra entrada do canal depois da segunda', async () => {
    seed(song({ click: false }))
    const hook = await openApp({ stageMode: 'novo' })
    const bus = buses(hook)
    await play(hook)
    const t0 = startAt(0)
    armAt(t0 + 1, () => hook.result.current.armSection(1))
    run(hook, t0 + 1.025, t0 + 1.75)
    expect(hook.result.current.transitionView?.committed).toBe(true)
    const [countDelay] = nodesOf(ctxOf(), 'DelayNode')
    // Corte da VS (o único lugar em que o fader do Baixo liga): a descida de cada troca marca nele.
    const vsCut = only(chan(hook, 'bass').gainNode)
    const cutMarks = () => vsCut.gain.events.filter((e) => e.kind === 'set' || e.kind === 'linear').length
    // O Teclado vira Click e logo depois o Baixo (que vem antes na ordem): duas trocas na fila.
    act(() => { hook.result.current.setChannelMeta('keys', { role: 'click' }) })
    act(() => { hook.result.current.setChannelMeta('bass', { role: 'click' }) })
    const keys = chan(hook, 'keys').gainNode
    const bass = chan(hook, 'bass').gainNode
    // O relógio anda até a 1ª troca acabar inteira (a descida da 2ª já marcada no corte, 4 + 2
    // marcas) com a 2ª ainda esperando o fundo do corte dela (o Baixo ainda na VS).
    const ctx = ctxOf()
    for (let k = 0; k < 400 && !(cutMarks() >= 6 && reaches(bass, bus.vs)); k++) {
      ctx.currentTime += 0.0005
      await act(async () => { await new Promise((resolve) => setTimeout(resolve, 2)) })
    }
    expect(cutMarks()).toBeGreaterThanOrEqual(6)
    expect(reaches(keys, bus.click)).toBe(true)
    expect(reaches(bass, bus.vs)).toBe(true)
    // O pulo é marcado de novo agora: pelo atraso da contagem, nunca pela entrada do Baixo (o 1º
    // Click da lista), cujo fader ainda está no barramento da VS.
    const before = beepFilters().length
    tickAt(ctx.currentTime)
    const again = beepFilters().slice(before)
    expect(again.length).toBeGreaterThan(0)
    for (const f of again) {
      expect(connectedTo(f, countDelay)).toBe(true)
      expect(reaches(f, bus.vs)).toBe(false)
    }
    for (let k = 0; k < 10 && !reaches(bass, bus.click); k++) await letAudioRun()
    expect(reaches(bass, bus.click)).toBe(true)
    act(() => { hook.result.current.pause() })
  }, 20_000)

  it('tom trocado tocando entre dois tons diferentes de 0: as vozes do pulo nascem no tom novo', async () => {
    seed(song({ pitch: 2 }))
    const hook = await openApp({ stageMode: 'novo' })
    const bus = buses(hook)
    await play(hook)
    const t0 = startAt(0)
    const L = PITCH_LATENCY
    // Baixo e Teclado no worklet de tom (Click e Guia nunca transpõem).
    const worklets = nodesOf(ctxOf(), 'AudioWorkletNode')
    expect(worklets).toHaveLength(2)
    const lastTone = (node: unknown) => mem.schedules.filter((x) => x.node === node).at(-1)?.semitones
    // De +2 pra +3 tocando (sem cruzar o 0: só reprograma os worklets).
    ctxOf().currentTime = t0 + 1
    act(() => { hook.result.current.changePitch(3) })
    for (const w of worklets) expect(lastTone(w)).toBe(3)
    const before = sources().length
    armAt(t0 + 1, () => hook.result.current.armSection(1))
    run(hook, t0 + 1.025, t0 + 1.75)
    expect(hook.result.current.transitionView?.committed).toBe(true)
    // O pulo monta as vozes novas na entrada de cada canal e reprograma o worklet: no tom de agora.
    for (const w of worklets) expect(lastTone(w)).toBe(3)
    expect(nodesOf(ctxOf(), 'AudioWorkletNode')).toEqual(worklets)
    const fresh = sources().slice(before)
    expect(fresh).toHaveLength(4)
    const entryOf = (id: string) => only(envOf(fresh.find((s) => s.buffer === chan(hook, id).buffer)!)) as unknown as FakeAudioNode
    expect(worklets).toContain(entryOf('bass'))
    expect(worklets).toContain(entryOf('keys'))
    // Click e Guia pelo atraso de compensação (L), e a contagem pelo atraso do Click.
    const clickDelay = entryOf('click')
    expect(clickDelay.kind).toBe('DelayNode')
    expect(entryOf('guide').kind).toBe('DelayNode')
    expect(valueAt((clickDelay as unknown as { delayTime: AudioParam }).delayTime, t0 + 2)).toBeCloseTo(L, 9)
    for (const f of beepFilters()) {
      expect(connectedTo(f, clickDelay)).toBe(true)
      expect(reaches(f, bus.vs)).toBe(false)
    }
    // A guia cala do 1º bipe ouvido (mais L) até o 1 ouvido (mais L).
    const T = t0 + 4
    expect(valueAt(bus.guide.gain, t0 + 2 + L - 0.01)).toBe(1)
    expect(valueAt(bus.guide.gain, t0 + 3)).toBe(0)
    expect(valueAt(bus.guide.gain, T + L - 0.01)).toBe(0)
    expect(valueAt(bus.guide.gain, T + L + 0.02)).toBe(1)
    expect(run(hook, t0 + 1.775, T + 0.1).map((l) => l.index)).toEqual([1])
    for (const w of worklets) expect(lastTone(w)).toBe(3)
  })

  it('Livre pede upgrade e não arma', async () => {
    seed(song())
    const hook = await openApp({ stageMode: 'novo', sectionGates: LIVRE })
    // Parado: nem leva pra seção.
    expect(armAt(0, () => hook.result.current.armSection(2))).toEqual({ upgrade: true })
    expect(hook.result.current.currentTime).toBe(0)
    await play(hook)
    const t0 = startAt(0)
    tickAt(t0 + 1)
    for (const arm of [
      () => hook.result.current.armSection(1),
      () => hook.result.current.stepSection(1),
      () => hook.result.current.armRepeat(2),
      () => hook.result.current.toggleSectionLoop(),
    ]) expect(armAt(t0 + 1, arm)).toEqual({ upgrade: true })
    expect(hook.result.current.sectionIntent).toBeNull()
    expect(hook.result.current.transitionView).toBeNull()
    expect(run(hook, t0 + 1.025, t0 + 4.5)).toEqual([])
    expect(triangles()).toHaveLength(0)
    expect(sources()).toHaveLength(4)
  })
})

describe('FADE e volume principal', () => {
  // Um evento por quadro de tela (16 ms), como o range do PRINCIPAL arrastado.
  function drag(hook: Hook, from: number, values: number[]) {
    values.forEach((v, k) => {
      ctxOf().currentTime = from + k * 0.016
      act(() => { hook.result.current.updateMasterVolume(v) })
    })
  }

  it.each([
    ['com cancelAndHoldAtTime', true],
    ['sem cancelAndHoldAtTime (Firefox)', false],
  ])('FADE ligado: volume principal arrastado sai liso, %s', async (_name, withHold) => {
    const saved = FakeAudioParam.prototype.cancelAndHoldAtTime
    if (!withHold) delete (FakeAudioParam.prototype as Partial<FakeAudioParam>).cancelAndHoldAtTime
    try {
      seed(song())
      const hook = await openApp({ stageMode: 'novo' })
      act(() => { hook.result.current.setPlaybackMode('fade-out') })
      await play(hook)
      const t0 = startAt(0)
      const gain = master().gain
      // Com a rampa do FADE ainda longe (15 s): 0,08 por quadro, de 1 até 0,6.
      drag(hook, t0 + 1, [0.92, 0.84, 0.76, 0.68, 0.6])
      expect(maxStep(gain, t0 + 1, t0 + 1.2).step).toBeLessThanOrEqual(0.01)
      expect(valueAt(gain, t0 + 1.2)).toBeCloseTo(0.6, 9)
      // A rampa do FADE segue com o volume novo: 0,6 em 15 s, 0,3 em 17,5 s.
      expect(valueAt(gain, t0 + 17.5)).toBeCloseTo(0.3, 9)

      // No meio da rampa (busca pra 16 s: 0,8 x 0,6 na entrada), de 0,6 até 1. O principal desce
      // pro FADE a partir da folga do corte, em 5 ms (a voz velha segue em ganho 1 até ali).
      ctxOf().currentTime = t0 + 1.3
      act(() => { hook.result.current.seekTo(16) })
      const t1 = seekStartAt(t0 + 1.3)
      const settled = t0 + 1.3 + 0.015
      expect(valueAt(gain, t1)).toBeCloseTo(0.6, 9)
      expect(valueAt(gain, settled)).toBeCloseTo((0.6 * (t1 + 4 - settled)) / 5, 9)
      expect(maxStep(gain, t0 + 1.3, settled + 0.01).step).toBeLessThanOrEqual(0.01)
      drag(hook, t1 + 0.5, [0.68, 0.76, 0.84, 0.92, 1])
      expect(maxStep(gain, t1 + 0.5, t1 + 0.7).step).toBeLessThanOrEqual(0.01)
      // Depois, a mesma curva com o volume 1: 0,6 em 17 s, 0 no fim.
      expect(valueAt(gain, t1 + 1)).toBeCloseTo(0.6, 6)
      expect(valueAt(gain, t1 + 4)).toBe(0)
      // Só set e rampa linear no principal (Ruling ÁUDIO).
      expect(gain.events.filter((e) => e.kind === 'target' || e.kind === 'exp')).toEqual([])
    } finally {
      FakeAudioParam.prototype.cancelAndHoldAtTime = saved
    }
  })

  it('saiu do FADE e mexeu no volume em menos de 50 ms: só rampa linear e o volume novo vale', async () => {
    seed(song())
    const hook = await openApp({ stageMode: 'novo' })
    act(() => { hook.result.current.setPlaybackMode('fade-out') })
    act(() => { hook.result.current.seekTo(16) })
    await play(hook)
    const t0 = startAt(0)
    const gain = master().gain
    expect(valueAt(gain, t0 + 0.5)).toBeCloseTo(0.7, 9)
    // Sai do FADE em 16,5 s: o principal volta pro volume em 50 ms (a partir da folga do corte)...
    ctxOf().currentTime = t0 + 0.5
    act(() => { hook.result.current.setPlaybackMode('continue') })
    expect(valueAt(gain, t0 + 0.56)).toBeCloseTo(1, 9)
    // ...e o volume mexido 20 ms depois segue dali, por rampa linear, e fica.
    ctxOf().currentTime = t0 + 0.52
    act(() => { hook.result.current.updateMasterVolume(0.6) })
    expect(maxStep(gain, t0 + 0.49, t0 + 0.65).step).toBeLessThanOrEqual(0.01)
    expect(valueAt(gain, t0 + 0.58)).toBeCloseTo(0.6, 9)
    expect(valueAt(gain, t0 + 3.5)).toBeCloseTo(0.6, 9)
    // Mexido de novo 5 ms antes do fim dessa rampa (ela acaba antes da folga do corte): ainda linear.
    ctxOf().currentTime = t0 + 0.575
    act(() => { hook.result.current.updateMasterVolume(0.5) })
    expect(maxStep(gain, t0 + 0.56, t0 + 0.7).step).toBeLessThanOrEqual(0.01)
    expect(valueAt(gain, t0 + 3.5)).toBeCloseTo(0.5, 9)
    expect(gain.events.filter((e) => e.kind === 'target' || e.kind === 'exp')).toEqual([])
    // Passada a rampa curta e sem FADE marcado, o volume volta pro caminho de sempre.
    ctxOf().currentTime = t0 + 1
    act(() => { hook.result.current.updateMasterVolume(0.4) })
    expect(gain.events.filter((e) => e.kind === 'target').map((e) => e.value)).toEqual([0.4])
  })
})

describe('música velha soltando e o principal (Ruling I2-proxima)', () => {
  // Fontes vivas de agora (as vozes da música que toca).
  const voicesNow = () => live(sources())
  // O maior som que a voz velha faz no principal entre `from` e `to`: principal x envelope dela.
  function loudestOld(old: FakeAudioBufferSourceNode[], from: number, to: number) {
    const gain = master().gain
    let worst = 0
    // De 2 em 2 amostras: o envelope e o principal andam devagar (rampas de 3 ms ou mais).
    for (let k = 0; from + k / SR <= to; k += 2) {
      const t = from + k / SR
      worst = Math.max(worst, valueAt(gain, t) * Math.max(...old.map((s) => valueAt(envOf(s).gain, t))))
    }
    return worst
  }

  it('"próxima" tocando: a música velha nunca sai mais alta que no fim do fade; o principal sobe depois que ela calou', async () => {
    const a = song()
    const b: SavedSong = { ...song(), id: 's2', name: 'Outra', channels: song().channels.map((c) => ({ ...c, id: `b-${c.id}` })) }
    mem.db.set(META, structuredClone([a, b]))
    for (const x of [a, b]) for (const c of x.channels) mem.db.set(`mt_files_u1:ch:${c.id}`, new File([/BASS|KEYS/.test(c.name) ? 'stereo' : 'mono'], `${c.name}.wav`))
    const hook = await openApp()
    await play(hook)
    const gain = master().gain
    const old = voicesNow()
    expect(old).toHaveLength(4)
    // O timer do fade de 1,5 s da "próxima" fica com o teste.
    const timers: (() => void)[] = []
    const realSetTimeout = window.setTimeout.bind(window)
    const spy = vi.spyOn(window, 'setTimeout').mockImplementation(((fn: () => void, ms?: number) => {
      if (ms === 1500) { timers.push(fn); return 0 }
      return realSetTimeout(fn, ms)
    }) as unknown as typeof window.setTimeout)
    ctxOf().currentTime = 2
    try { act(() => { hook.result.current.nextSong() }) } finally { spy.mockRestore() }
    expect(timers).toHaveLength(1)
    const exec = 3.5
    ctxOf().currentTime = exec
    const fadeEnd = valueAt(gain, exec)
    expect(fadeEnd).toBeLessThan(0.02)
    await act(async () => { timers[0]() })
    expect(hook.result.current.activeSongIndex).toBe(1)
    expect(hook.result.current.isPlaying).toBe(true)
    expect(voicesNow()).toHaveLength(4)
    // A voz velha (em ganho 1 até a folga do corte, depois descendo) nunca soa acima do fim do fade.
    expect(loudestOld(old, exec, exec + 0.06)).toBeLessThanOrEqual(fadeEnd + 1e-9)
    // A cauda acaba em 40 ms; o principal chega no volume 5 ms depois, sem degrau.
    expect(valueAt(gain, exec + 0.039)).toBeLessThan(0.02)
    expect(valueAt(gain, exec + 0.046)).toBe(1)
    expect(maxStep(gain, exec, exec + 0.06).step).toBeLessThanOrEqual(0.01)
    // Só set e rampa linear depois do setTarget da descida (Ruling ÁUDIO): nada de rampa exponencial.
    expect(gain.events.filter((e) => e.kind === 'exp')).toEqual([])
  }, 20_000)

  it.each([
    ['com cancelAndHoldAtTime', true],
    ['sem cancelAndHoldAtTime (Firefox)', false],
  ])('busca saindo dos últimos 5 s com FADE: o rabo da posição velha não sobe; o principal vai pro volume depois que ele calou, %s', async (_name, withHold) => {
    const savedHold = FakeAudioParam.prototype.cancelAndHoldAtTime
    if (!withHold) delete (FakeAudioParam.prototype as Partial<FakeAudioParam>).cancelAndHoldAtTime
    try {
    seed(song())
    const hook = await openApp()
    act(() => { hook.result.current.setPlaybackMode('fade-out') })
    act(() => { hook.result.current.seekTo(17) })
    await play(hook)
    const t0 = startAt(0)
    const gain = master().gain
    // Posição 18: o FADE em 0,4.
    const now = t0 + 1
    ctxOf().currentTime = now
    expect(valueAt(gain, now)).toBeCloseTo(0.4, 9)
    const old = voicesNow()
    act(() => { hook.result.current.seekTo(2) })
    // O nível segurado com a folga do corte (o FADE ainda descendo até ali).
    const held = valueAt(gain, now + 0.01)
    expect(held).toBeCloseTo(0.4 - 0.01 / 5, 9)
    expect(loudestOld(old, now, now + 0.06)).toBeLessThanOrEqual(0.4 + 1e-9)
    expect(valueAt(gain, now + 0.039)).toBeCloseTo(held, 9)
    expect(valueAt(gain, now + 0.046)).toBe(1)
    expect(maxStep(gain, now, now + 0.06).step).toBeLessThanOrEqual(0.01)
    // O FADE volta pro fim da música a partir da posição nova (2 s): 15 s depois, no volume ainda.
    const t1 = seekStartAt(now)
    expect(valueAt(gain, t1 + 12.9)).toBe(1)
    expect(valueAt(gain, t1 + 15.5)).toBeCloseTo(0.5, 9)
    } finally {
      FakeAudioParam.prototype.cancelAndHoldAtTime = savedHold
    }
  }, 20_000)

  it('busca sem FADE: o principal fica no volume, sem nenhum evento novo de subida', async () => {
    seed(song())
    const hook = await openApp()
    await play(hook)
    const gain = master().gain
    ctxOf().currentTime = 1
    act(() => { hook.result.current.seekTo(5) })
    for (const t of [1, 1.005, 1.01, 1.02, 1.05]) expect(valueAt(gain, t)).toBe(1)
  })
})

describe('modo antigo e adaptadores', () => {
  it('modo antigo: sem bipe, salto no fim da seção pelo caminho antigo', async () => {
    seed(song())
    // Sem stageMode: o palco antigo (o harness e os testes de antes montam o hook assim).
    const hook = await openApp()
    const bus = buses(hook)
    expect(hook.result.current.stageMode).toBe('antigo')
    await play(hook)
    const t0 = startAt(0)
    // Índice da marca, como na v1.4.16.
    act(() => { hook.result.current.armJump(2) })
    expect(hook.result.current.pendingJump).toBe(2)
    expect(hook.result.current.sectionIntent).toBeNull()
    frame(t0 + 3.9)
    expect(sources()).toHaveLength(4)
    // O quadro que vê a troca de seção busca o Refrão: voz nova no ponto 8, na folga de sempre
    // (2 blocos, ou até 6,4 ms antes de a voz velha descer: Ruling I4-busca).
    const now = t0 + 4.01
    frame(now)
    const jumped = live(sources())
    expect(jumped).toHaveLength(4)
    for (const s of jumped) {
      expect(s.starts[0].offset).toBe(8)
      expect(s.starts[0].when).toBeCloseTo(seekStartAt(now), 9)
    }
    expect(hook.result.current.pendingJump).toBeNull()
    // Nada de contagem, guia calada nem relógio do Worker.
    expect(nodesOf(ctxOf(), 'OscillatorNode')).toHaveLength(0)
    expect(bus.guide.gain.events.filter((e) => e.kind !== 'set')).toEqual([])
    expect(sectionClock()).toBeUndefined()
  })

  it('banda: repetir 2 numa outra seção vira 3 passagens no modo novo', async () => {
    seed(song())
    const hook = await openApp({ stageMode: 'novo', sectionGates: STUDIO })
    await play(hook)
    const t0 = startAt(0)
    tickAt(t0 + 1)
    // "Repetir 2" no Refrão estando na Intro: vai pra lá e repete 2 vezes (3 passagens).
    armAt(t0 + 1, () => hook.result.current.armLoop(2, 2))
    expect(hook.result.current.sectionIntent).toEqual({ target: 2, plays: 3 })
    expect(hook.result.current.pendingJump).toBe(2)
    expect(hook.result.current.activeLoop).toEqual({ index: 2, remaining: 2 })
    expect(hook.result.current.transitionView).toMatchObject({ from: 0, to: 2 })
    // 9 vezes numa outra seção: 10 passagens (o teto sobe uma passagem pra banda).
    armAt(t0 + 1, () => hook.result.current.armLoop(3, 9))
    expect(hook.result.current.sectionIntent).toEqual({ target: 3, plays: 10 })
    // Na seção atual, N passagens.
    armAt(t0 + 1, () => hook.result.current.armLoop(0, 2))
    expect(hook.result.current.sectionIntent).toEqual({ target: 0, plays: 2 })
    expect(hook.result.current.pendingJump).toBeNull()
    expect(hook.result.current.activeLoop).toEqual({ index: 0, remaining: 2 })
    // O -1 da rede (infinito) chegando em texto.
    armAt(t0 + 1, () => hook.result.current.armLoop(1, '-1' as unknown as number))
    expect(hook.result.current.sectionIntent).toEqual({ target: 1, plays: 'infinite' })
    // "No fim da atual": armJump arma 1 passagem, sem cancelar o que estiver igual.
    armAt(t0 + 1, () => hook.result.current.armJump(1))
    expect(hook.result.current.sectionIntent).toEqual({ target: 1, plays: 1 })
    armAt(t0 + 1, () => hook.result.current.armJump(1))
    expect(hook.result.current.sectionIntent).toEqual({ target: 1, plays: 1 })
    armAt(t0 + 1, () => hook.result.current.cancelLoop())
    expect(hook.result.current.sectionIntent).toBeNull()
    expect(hook.result.current.pendingJump).toBeNull()
    expect(hook.result.current.activeLoop).toBeNull()
  })

  it('trocar o modo tocando só vale na próxima parada', async () => {
    seed(song())
    const hook = await openApp({ stageMode: 'novo' })
    await play(hook)
    const t0 = startAt(0)
    tickAt(t0 + 1)
    // Pediu o palco antigo tocando: o mecanismo novo continua até parar.
    hook.rerender({ stageMode: 'antigo' })
    expect(hook.result.current.stageMode).toBe('novo')
    armAt(t0 + 1, () => hook.result.current.armJump(1))
    expect(hook.result.current.sectionIntent).toEqual({ target: 1, plays: 1 })
    expect(hook.result.current.pendingJump).toBe(1)
    run(hook, t0 + 1.025, t0 + 1.75)
    expect(triangles()).toHaveLength(4)

    // Parou: vale o antigo, e o pedido do mecanismo novo sai.
    ctxOf().currentTime = t0 + 1.8
    act(() => { hook.result.current.pause() })
    expect(hook.result.current.stageMode).toBe('antigo')
    expect(hook.result.current.sectionIntent).toBeNull()
    expect(hook.result.current.pendingJump).toBeNull()
    // Tocando de novo: o salto vai pelo caminho antigo (marca), sem relógio do Worker nem bipe.
    await play(hook)
    act(() => { hook.result.current.armJump(2) })
    expect(hook.result.current.pendingJump).toBe(2)
    expect(hook.result.current.sectionIntent).toBeNull()
    expect(sectionClock()?.running).toBe(false)
    expect(triangles()).toHaveLength(4)
  })
})

// Ruling T30-grade (achado do harness da T30 no Chrome): fonte que começa fora da grade de
// amostras (instante ou ponto da faixa) é lida pelo navegador com interpolação linear, que tira
// agudos (-0,11 dB em 4,5 kHz depois do pulo; até uns -2 dB em 10 kHz). As vozes do pulo e a
// música da pré-contagem começam numa amostra exata e num ponto de amostra exata da faixa, a no
// máximo meia amostra (~10 µs) do plano.
// Ruling T30-reagenda: a rede de segurança do play (o relógio passou do instante comum durante o
// laço de start()) não pode cancelar uma contagem que já começou (sobrava um tique de ~8 ms no
// ouvido, medido no Chrome sob carga): com pré-contagem as vozes começam um tempo depois, longe.
describe('grade de amostras e rede de segurança (T30)', () => {
  // O 1 lido num click de verdade cai fora da grade de amostras (0,77 ms no click de teste da T30).
  const OFF_GRID: SongGrid = { ...GRID, firstDownbeat: 0.0007675 }
  // Andamento lido com decimais: 4 pulsos não dão um número inteiro de amostras.
  const ODD_BPM: SongGrid = { ...GRID, bpm: 119.99992 }
  const onGrid = (t: number) => Math.abs(t * SR - Math.round(t * SR)) < 1e-6
  const halfSample = 0.5 / SR + 1e-12

  it('as vozes do pulo começam numa amostra exata, no ponto de amostra exata, e o pulo cai no 1', async () => {
    seed({ ...song(), grid: OFF_GRID })
    const hook = await openApp({ stageMode: 'novo' })
    await play(hook)
    const t0 = startAt(0)
    const before = live(sources())
    armAt(t0 + 1, () => hook.result.current.armSection(1))
    const span = hook.result.current.sectionSpansView[1]
    expect(span.start).toBeCloseTo(4.0007675, 9)
    const T = t0 + span.start
    expect(hook.result.current.transitionView!.switchAt).toBeCloseTo(T, 9)
    expect(onGrid(T - 0.005)).toBe(false)
    run(hook, t0 + 1.025, t0 + 1.75)
    const fresh = sources().filter((s) => !before.includes(s))
    expect(fresh).toHaveLength(4)
    for (const s of fresh) {
      const { when, offset } = s.starts[0]
      expect(onGrid(when)).toBe(true)
      expect(onGrid(offset)).toBe(true)
      expect(Math.abs(when - (T - 0.005))).toBeLessThanOrEqual(halfSample)
      expect(Math.abs(offset - (span.start - 0.005))).toBeLessThanOrEqual(halfSample)
      // A fonte entra com o envelope em 0 e ele chega em 1 no 1 do plano.
      expect(valueAt(envOf(s).gain, when)).toBe(0)
      expect(valueAt(envOf(s).gain, T)).toBeCloseTo(1, 2)
    }
    const landings = run(hook, t0 + 1.775, T + 0.1)
    expect(landings).toHaveLength(1)
    expect(landings[0].at).toBeCloseTo(T, 9)
    // Depois do pouso a posição anda da seção de destino (o último tique não cai em T + 0,1 exato).
    expect(hook.result.current.heardPosition()).toBeCloseTo(span.start + (ctxOf().currentTime - landings[0].at), 9)
  })

  it('pulo pra 0:00 (sem pré-rolagem): a voz começa na amostra mais perto do 1, do começo da faixa', async () => {
    seed({ ...song(), grid: OFF_GRID })
    const hook = await openApp({ stageMode: 'novo' })
    await play(hook)
    const t0 = startAt(0)
    // Tocando a Intro desde 3 s: arma a própria Intro de novo (REPETE), que volta pro 0:00 no fim dela.
    ctxOf().currentTime = t0
    await act(async () => { hook.result.current.seekTo(3) })
    const t1 = startAt(t0)
    const before = sources()
    expect(live(before)).toHaveLength(4)
    armAt(t1 + 0.1, () => hook.result.current.armSection(0))
    const T = t1 + (hook.result.current.sectionSpansView[0].end - 3)
    expect(hook.result.current.transitionView!.switchAt).toBeCloseTo(T, 9)
    run(hook, t1 + 0.125, T - 0.1)
    const fresh = sources().filter((s) => !before.includes(s))
    expect(fresh).toHaveLength(4)
    for (const s of fresh) {
      expect(onGrid(s.starts[0].when)).toBe(true)
      expect(Math.abs(s.starts[0].when - T)).toBeLessThanOrEqual(halfSample)
      expect(s.starts[0].offset).toBe(0)
    }
  })

  it('pré-contagem: a música começa numa amostra exata, do ponto de amostra exata, no 5º tempo', async () => {
    seed({ ...song(), grid: ODD_BPM })
    const hook = await openApp({ stageMode: 'novo' })
    // Parado num ponto fora da grade de amostras (posição lida de um toque na onda).
    act(() => { hook.result.current.seekTo(1.23456789) })
    await act(async () => { await hook.result.current.play({ precount: true }) })
    const t0 = countStartAt(0)
    const pulse = 60 / ODD_BPM.bpm
    expect(near(beepTimes())).toEqual(near([0, 1, 2, 3].map((k) => t0 + k * pulse)))
    const voices = sources()
    expect(voices).toHaveLength(4)
    for (const s of voices) {
      const { when, offset } = s.starts[0]
      expect(onGrid(when)).toBe(true)
      expect(onGrid(offset)).toBe(true)
      expect(Math.abs(when - (t0 + 4 * pulse))).toBeLessThanOrEqual(halfSample)
      expect(Math.abs(offset - 1.23456789)).toBeLessThanOrEqual(halfSample)
    }
    // A linha do tempo é a das vozes: a posição de agora sai do ponto onde elas começaram.
    ctxOf().currentTime = voices[0].starts[0].when + 1
    expect(hook.result.current.heardPosition()).toBeCloseTo(voices[0].starts[0].offset + 1, 9)
  })

  it('rede de segurança com pré-contagem: o relógio passa do 1º bipe no laço e a contagem segue, sem tique falso', async () => {
    seed(song())
    const hook = await openApp({ stageMode: 'novo' })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    // No 1º start() de fonte o relógio pula 50 ms: passou do instante do 1º bipe (40 ms).
    const real = FakeAudioBufferSourceNode.prototype.start
    let jumped = false
    const spy = vi.spyOn(FakeAudioBufferSourceNode.prototype, 'start').mockImplementation(function (this: FakeAudioBufferSourceNode, ...a: Parameters<typeof real>) {
      if (!jumped) { jumped = true; ctxOf().currentTime += 0.05 }
      return real.apply(this, a)
    })
    try {
      await act(async () => { await hook.result.current.play({ precount: true }) })
    } finally {
      spy.mockRestore()
    }
    const t0 = countStartAt(0)
    // Uma contagem só, a primeira, sem nenhum bipe cortado antes do fim da receita.
    expect(near(beepTimes())).toEqual(near([t0, t0 + 0.5, t0 + 1, t0 + 1.5]))
    for (const tri of triangles()) expect(Math.min(...tri.stops)).toBeCloseTo(tri.starts[0].when + 0.22, 9)
    // As vozes da 1ª leva valem (começam um compasso depois, longe do relógio): nada reagendado.
    expect(sources()).toHaveLength(4)
    for (const s of sources()) {
      expect(s.stops).toHaveLength(0)
      expect(s.starts[0].when).toBeCloseTo(t0 + 2, 9)
    }
    expect(warn).not.toHaveBeenCalled()
    warn.mockRestore()
  })

  it('rede de segurança com pré-contagem: travou até depois do instante da música, aí reagenda tudo junto', async () => {
    seed(song())
    const hook = await openApp({ stageMode: 'novo' })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const real = FakeAudioBufferSourceNode.prototype.start
    let jumped = false
    const spy = vi.spyOn(FakeAudioBufferSourceNode.prototype, 'start').mockImplementation(function (this: FakeAudioBufferSourceNode, ...a: Parameters<typeof real>) {
      // Trava de mais de 4 tempos (a contagem inteira já tocou): até a entrada da música passou.
      if (!jumped) { jumped = true; ctxOf().currentTime += 2.1 }
      return real.apply(this, a)
    })
    try {
      await act(async () => { await hook.result.current.play({ precount: true }) })
    } finally {
      spy.mockRestore()
    }
    // A 1ª leva sai e a 2ª entra com a folga de reserva, contagem e música juntas.
    expect(sources()).toHaveLength(8)
    const second = sources().slice(4)
    const t1 = beepTimes()[4]
    expect(beepTimes()).toHaveLength(8)
    for (const s of second) expect(s.starts[0].when).toBeCloseTo(t1 + 2, 9)
    expect(warn).toHaveBeenCalledTimes(1)
    warn.mockRestore()
  })
})

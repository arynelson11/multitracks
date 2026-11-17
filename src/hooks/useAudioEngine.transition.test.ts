// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'
import { act, cleanup, renderHook } from '@testing-library/react'
import {
  connectedTo, createFakeAudioContext, FakeAudioBuffer, nodesOf, reaches, valueAt,
  type FakeAudioBufferSourceNode, type FakeAudioContext, type FakeGainNode,
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
// Instante comum do play: 2 blocos de 128 amostras depois do relógio, na grade de blocos.
const startAt = (now: number) => (Math.floor(now / QUANTUM + 1e-6) + 2) * QUANTUM
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
// Worklet de tom pelo nó rastreado do fake (Ruling T1-N3); estes testes tocam no tom 0.
vi.mock('signalsmith-stretch', async () => {
  const { FakeWorkletNode } = await import('../test/fakeAudio')
  return {
    default: async (ctx: BaseAudioContext) => Object.assign(new FakeWorkletNode(ctx, 'signalsmith-stretch'), {
      start: async () => {}, stop: async () => {}, schedule: async () => {}, latency: async () => 0.12,
    }),
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
function song(opts: { click?: boolean } = {}): SavedSong {
  const channels = [ch('click', 'CLICK'), ch('guide', 'Voz Guia'), ch('bass', 'BASS_1'), ch('keys', 'KEYS')]
  return {
    id: 's1', name: 'Música', duration: LEN_S, pitch: 0, originalKey: 'C', schemaVersion: 3, channelOrder: 'auto',
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
// Grafo das saídas (T12) e cortes (T25): barramentos Click, Guia e VS, principal, mudo, cortes.
const gains = () => nodesOf(ctxOf(), 'GainNode')
const busClick = () => gains()[0]
const busGuide = () => gains()[1]
const busVs = () => gains()[2]
const master = () => gains()[3]
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
      expect(reaches(f, busClick())).toBe(true)
      expect(reaches(f, busVs())).toBe(false)
    }
    // Guia calada do 1º bipe até o 1 (no barramento dela, não no fader) e de volta depois.
    expect(reaches(chan(hook, 'guide').gainNode, busGuide())).toBe(true)
    expect(valueAt(busGuide().gain, t0 + 1.9)).toBe(1)
    expect(valueAt(busGuide().gain, t0 + 3)).toBe(0)
    expect(valueAt(busGuide().gain, T + 0.02)).toBe(1)
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
      expect(reaches(f, busClick())).toBe(true)
      expect(reaches(f, busVs())).toBe(false)
      expect(reaches(f, busGuide())).toBe(false)
    }
    // Sem canal de click a contagem sai: o aviso não diz "CLICK DESLIGADO".
    expect(hook.result.current.transitionView?.clickAudible).toBe(true)
  })

  it('REPETIR 2 conta e volta duas vezes e desarma', async () => {
    seed(song())
    const hook = await openApp({ stageMode: 'novo' })
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
    expect(valueAt(busGuide().gain, t0 + 7)).toBe(0)
    expect(valueAt(busGuide().gain, t0 + 9)).toBe(1)
    expect(valueAt(busGuide().gain, t0 + 11)).toBe(0)

    // Desarmado, segue reto pro Refrão: nenhum pouso nem bipe a mais.
    expect(run(hook, t0 + 12.125, t0 + 16.5)).toEqual([])
    expect(triangles()).toHaveLength(8)
    expect(hook.result.current.heardPosition()).toBeCloseTo(8.5, 6)
  })

  it('LOOP repete sem contagem até cancelar', async () => {
    seed(song())
    const hook = await openApp({ stageMode: 'novo' })
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
    expect(valueAt(busGuide().gain, t0 + 15)).toBe(1)

    // LOOP de novo cancela: no fim do Verso a música segue pro Refrão.
    armAt(t0 + 17, () => hook.result.current.toggleSectionLoop())
    expect(hook.result.current.sectionIntent).toBeNull()
    expect(run(hook, t0 + 17.025, t0 + 21)).toEqual([])
    expect(hook.result.current.heardPosition()).toBeCloseTo(9, 6)
  })

  it('pausar com pulo agendado não deixa voz nem bipe vivo', async () => {
    seed(song())
    const hook = await openApp({ stageMode: 'novo' })
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
    expect(valueAt(busGuide().gain, now + 0.02)).toBe(1)
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
    const t1 = startAt(now)
    expect(valueAt(gain, t1)).toBeCloseTo(0.8, 9)
    expect(valueAt(gain, t1 + 0.5)).toBeCloseTo(0.7, 9)
    armAt(t1 + 0.5, () => hook.result.current.armSection(0))
    const T = t1 + 4
    expect(hook.result.current.transitionView!.switchAt).toBeCloseTo(T, 9)
    expect(valueAt(gain, t1 + 3)).toBeCloseTo(0.7, 9)
    run(hook, t1 + 0.525, t1 + 1.75)
    expect(hook.result.current.transitionView?.committed).toBe(true)
    expect(valueAt(gain, T - 0.005)).toBeCloseTo(0.7, 9)
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
    expect(reaches(chan(hook, 'bass').gainNode, busClick())).toBe(true)
    expect(reaches(chan(hook, 'bass').gainNode, busVs())).toBe(false)
    // Nenhum bipe que soa chega na VS.
    beepFilters().forEach((f, k) => { if (sounds(k)) expect(reaches(f, busVs())).toBe(false) })
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
      expect(reaches(f, busClick())).toBe(true)
      expect(reaches(f, busVs())).toBe(false)
    }
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

describe('modo antigo e adaptadores', () => {
  it('modo antigo: sem bipe, salto no fim da seção pelo caminho antigo', async () => {
    seed(song())
    // Sem stageMode: o palco antigo (o harness e os testes de antes montam o hook assim).
    const hook = await openApp()
    expect(hook.result.current.stageMode).toBe('antigo')
    await play(hook)
    const t0 = startAt(0)
    // Índice da marca, como na v1.4.16.
    act(() => { hook.result.current.armJump(2) })
    expect(hook.result.current.pendingJump).toBe(2)
    expect(hook.result.current.sectionIntent).toBeNull()
    frame(t0 + 3.9)
    expect(sources()).toHaveLength(4)
    // O quadro que vê a troca de seção busca o Refrão: voz nova no ponto 8, na folga de 2 blocos.
    const now = t0 + 4.01
    frame(now)
    const jumped = live(sources())
    expect(jumped).toHaveLength(4)
    for (const s of jumped) {
      expect(s.starts[0].offset).toBe(8)
      expect(s.starts[0].when).toBeCloseTo(startAt(now), 9)
    }
    expect(hook.result.current.pendingJump).toBeNull()
    // Nada de contagem, guia calada nem relógio do Worker.
    expect(nodesOf(ctxOf(), 'OscillatorNode')).toHaveLength(0)
    expect(busGuide().gain.events.filter((e) => e.kind !== 'set')).toEqual([])
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

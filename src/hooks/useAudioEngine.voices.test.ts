// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'
import { act, cleanup, renderHook } from '@testing-library/react'
import {
  asFake, connectedTo, createFakeAudioContext, FakeAudioBuffer, nodesOf, reaches, valueAt,
  type FakeAudioBufferSourceNode, type FakeAudioContext, type FakeAudioNode, type FakeAudioContextOptions, type FakeGainNode,
} from '../test/fakeAudio'
import { measure, type Sig } from '../test/signalMeasure'
import type { SavedSong } from '../lib/repertoireSchema'
import type { OutputSettings } from '../lib/stageContracts'
import { useAudioEngine } from './useAudioEngine'

// T26: o motor toca por vozes (fonte + envelope na entrada do canal, src/audio/voices.ts), a
// posição sai da linha do tempo no relógio do áudio (src/lib/playTimeline.ts) e a pré-contagem
// (bipes da T7) é agendada junto com as vozes, pela entrada do canal de click. O hook roda de
// verdade com o AudioContext falso da T1 e o IndexedDB em memória; o relógio do fake só anda
// quando o teste escreve no currentTime.

const SR = 48000
const QUANTUM = 128 / SR
// Instante comum do play: 2 blocos de 128 amostras depois do relógio, na grade de blocos.
const startAt = (now: number) => (Math.floor(now / QUANTUM + 1e-6) + 2) * QUANTUM
// Latência do worklet de tom no modo ao vivo, como o mock do pacote informa.
const PITCH_LATENCY = 0.12

const mem = vi.hoisted(() => ({
  db: new Map<string, unknown>(),
  settings: {} as Record<string, unknown>,
  ctx: null as unknown,
  ctxOpts: {} as Record<string, unknown>,
  metaGate: null as Promise<void> | null,
  // Segura o nascimento do worklet de tom até o teste liberar.
  pitchGate: null as Promise<void> | null,
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
// Worklet de tom pelo nó rastreado do fake (Ruling T1-N3): conta pelo nodesOf(ctx, 'AudioWorkletNode').
vi.mock('signalsmith-stretch', async () => {
  const { FakeWorkletNode } = await import('../test/fakeAudio')
  return {
    default: async (ctx: BaseAudioContext) => {
      if (mem.pitchGate) await mem.pitchGate
      return Object.assign(new FakeWorkletNode(ctx, 'signalsmith-stretch'), {
        start: async () => {}, stop: async () => {}, schedule: async () => {}, latency: async () => PITCH_LATENCY,
      })
    },
  }
})
vi.mock('../contexts/SettingsContext', () => ({ useSettings: () => ({ settings: mem.settings, updateSetting: () => {} }) }))
vi.mock('../lib/AudioAnalyzer', () => ({ detectKey: () => 'C', generateEndlessClickTrackFromSample: async () => ({ clickBlob: new Blob(['mono']) }) }))
vi.mock('../lib/clickLibrary', () => ({ loadClickSelection: () => ({ type: 'wood', subdivision: 1 }) }))
vi.mock('../lib/offlineCache', () => ({ getCachedStem: async () => undefined, getCachedStemNames: async () => null, isSongCached: async () => false }))

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
const STEREO: OutputSettings = { ...SPLIT, mode: 'stereo' }

let error: MockInstance<typeof console.error>
beforeEach(() => {
  localStorage.clear()
  mem.db.clear()
  mem.metaGate = null
  mem.pitchGate = null
  mem.ctx = null
  mem.ctxOpts = {}
  mem.settings = { autoPan: false, audioDeviceId: 'default', outputs: SPLIT, legacyPanReset: false }
  // A conta já passou pelo reset dos pans antigos (T25).
  localStorage.setItem('mt_legacy_pans_reset:u1', '1')
  // 10 s de áudio; o arquivo diz quantos canais ("stereo..." ou "mono...").
  const decode = async (data: ArrayBuffer) => new FakeAudioBuffer(new TextDecoder().decode(data).startsWith('stereo') ? 2 : 1, 10 * SR, SR)
  vi.stubGlobal('AudioContext', function () {
    const ctx = createFakeAudioContext({ ...(mem.ctxOpts as FakeAudioContextOptions), decode })
    mem.ctx = ctx
    return ctx
  })
  vi.stubGlobal('requestAnimationFrame', () => 0)
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
function song(opts: { pitch?: number; bpm?: number; click?: boolean } = {}): SavedSong {
  const channels = [ch('click', 'CLICK'), ch('guide', 'Voz Guia'), ch('bass', 'BASS_1'), ch('keys', 'KEYS')]
  return {
    id: 's1', name: 'Música', duration: 10, pitch: opts.pitch ?? 0, originalKey: 'C', bpm: opts.bpm, schemaVersion: 3, channelOrder: 'auto',
    channels: opts.click === false ? channels.slice(1) : channels,
  }
}
function seed(s: SavedSong) {
  mem.db.set(META, structuredClone([s]))
  for (const c of s.channels) mem.db.set(`mt_files_u1:ch:${c.id}`, new File([/BASS|KEYS/.test(c.name) ? 'stereo' : 'mono'], `${c.name}.wav`, { type: 'audio/wav' }))
}

async function openApp() {
  const hook = renderHook(() => useAudioEngine('u1'))
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
// Fontes de uma faixa (pelo buffer), na ordem em que nasceram.
const sourcesOf = (hook: Hook, id: string) => nodesOf(ctxOf(), 'AudioBufferSourceNode').filter((s) => s.buffer === chan(hook, id).buffer)
// Fontes que ninguém mandou parar: as vozes que tocam (ou vão tocar).
const live = (sources: FakeAudioBufferSourceNode[]) => sources.filter((s) => s.stops.length === 0)
// Envelope da voz: o único nó em que a fonte liga.
function envOf(source: FakeAudioBufferSourceNode): FakeGainNode {
  expect(source.connections).toHaveLength(1)
  return source.connections[0].to as FakeGainNode
}
// Onde a voz entra no canal: o único nó em que o envelope liga.
const entryOf = (source: FakeAudioBufferSourceNode) => {
  const env = envOf(source)
  expect(env.connections).toHaveLength(1)
  return env.connections[0].to
}
// Um bipe por tempo: o passa-baixa (fim da receita da T7) e o triângulo (o instante do bipe).
const beepFilters = () => nodesOf(ctxOf(), 'BiquadFilterNode')
const beepStarts = () => nodesOf(ctxOf(), 'OscillatorNode').filter((o) => o.type === 'triangle').map((o) => o.starts[0].when)
// Corte do Click (Ruling T25-corte): o sexto GainNode do initEngine (barramentos, principal, mudo e os cortes).
const cutClick = () => nodesOf(ctxOf(), 'GainNode')[5]
const cutVs = () => nodesOf(ctxOf(), 'GainNode')[7]
const busClick = () => nodesOf(ctxOf(), 'GainNode')[0]
// Relógio do áudio andando (o fake não anda sozinho) enquanto uma troca com corte espera o fundo.
async function letAudioRun(ms = 60) {
  const ctx = ctxOf()
  const timer = setInterval(() => { ctx.currentTime += 0.001 }, 1)
  try { await act(async () => { await new Promise((resolve) => setTimeout(resolve, ms)) }) } finally { clearInterval(timer) }
}
// Eventos de rampa de um corte (Ruling T25-corte).
const cutRamps = (g: FakeGainNode) => g.gain.events.filter((e) => e.kind === 'linear').map((e) => e.value)
// Todo caminho de `from` até o destino passa por `through`?
function onlyThrough(from: FakeAudioNode, through: unknown): boolean {
  const ctx = ctxOf()
  const seen = new Set<unknown>([from])
  const stack: unknown[] = [from]
  while (stack.length > 0) {
    const node = stack.pop()
    if (node === through) continue
    if (node === ctx.destination) return false
    for (const c of (node as FakeAudioNode).connections) if (!seen.has(c.to)) { seen.add(c.to); stack.push(c.to) }
  }
  return true
}
// Ganho do caminho de cada bipe até as saídas (o passa-baixa vira sinal 1; o resto conta 0).
function beepLevels(): Sig[] {
  const ctx = ctxOf()
  const beeps = beepFilters()
  const zeros = nodesOf(ctx, 'AudioBufferSourceNode').map((v): [unknown, Sig] => [v, [[0]]])
  return beeps.map((beep) => measure(ctx, new Map<unknown, Sig>([...beeps.map((b): [unknown, Sig] => [b, [[b === beep ? 1 : 0]]]), ...zeros]), 1))
}
function precountOn(beats: number) {
  localStorage.setItem('precount_enabled', 'true')
  localStorage.setItem('precount_beats', String(beats))
}

describe('vozes no play', () => {
  it('uma voz por canal, todas no mesmo instante e no mesmo offset', async () => {
    seed(song())
    const hook = await openApp()
    act(() => { hook.result.current.seekTo(3) })
    ctxOf().currentTime = 0.5
    await act(async () => { await hook.result.current.play() })

    const when = startAt(0.5)
    for (const id of ['click', 'guide', 'bass', 'keys']) {
      const sources = sourcesOf(hook, id)
      expect(sources, id).toHaveLength(1)
      const [s] = sources
      expect(s.starts).toEqual([{ when, offset: 3 }])
      expect(valueAt(s.playbackRate, when)).toBe(1)
      // Envelope próprio em 1, ligado na entrada do canal (tom 0: o panner).
      expect(valueAt(envOf(s).gain, when)).toBe(1)
      expect(entryOf(s)).toBe(chan(hook, id).pannerNode)
      expect(chan(hook, id).sourceNode).toBe(s)
    }
    expect(hook.result.current.isPlaying).toBe(true)
    expect(nodesOf(ctxOf(), 'OscillatorNode')).toHaveLength(0)
  })

  it('busca tocando troca as vozes sem passar de 1 por canal', async () => {
    seed(song())
    const hook = await openApp()
    await act(async () => { await hook.result.current.play() })
    ctxOf().currentTime = 1
    act(() => { hook.result.current.seekTo(5) })

    const now = 1
    for (const id of ['click', 'guide', 'bass', 'keys']) {
      const sources = sourcesOf(hook, id)
      // A antiga solta e a nova: nunca mais que 2 vivas, e só 1 sem parada marcada.
      expect(sources).toHaveLength(2)
      const [old, next] = sources
      expect(live(sources)).toEqual([next])
      expect(next.starts).toEqual([{ when: startAt(now), offset: 5 }])
      // Soltura da antiga: a curva desce a partir da folga do corte (10 ms) e a fonte para 30 ms depois.
      const release = envOf(old).gain.events.filter((e) => e.kind === 'target')
      expect(release).toEqual([{ kind: 'target', value: 0, time: now + 0.01, timeConstant: 0.003 }])
      expect(old.stops).toEqual([now + 0.01 + 0.03])
      // Nenhuma rampa depois do setTarget (Ruling ÁUDIO).
      expect(envOf(old).gain.events.at(-1)?.kind).toBe('target')
      expect(valueAt(envOf(old).gain, now + 0.01)).toBe(1)
      expect(valueAt(envOf(old).gain, now + 0.04)).toBeLessThan(1e-4)
    }
  })

  it('pausar tocando solta as vozes com rampa curta e guarda a posição da linha do tempo', async () => {
    seed(song())
    const hook = await openApp()
    await act(async () => { await hook.result.current.play() })
    const when = startAt(0)
    ctxOf().currentTime = when + 2.5
    act(() => { hook.result.current.pause() })
    const t = ctxOf().currentTime + 0.01
    for (const id of ['click', 'guide', 'bass', 'keys']) {
      const [s] = sourcesOf(hook, id)
      expect(s.stops).toEqual([t + 0.03])
      expect(envOf(s).gain.events.filter((e) => e.kind === 'target').map((e) => e.time)).toEqual([t])
    }
    expect(hook.result.current.isPlaying).toBe(false)
    // O play seguinte retoma de onde a linha do tempo estava.
    await act(async () => { await hook.result.current.play() })
    expect(live(sourcesOf(hook, 'bass'))[0].starts[0].offset).toBeCloseTo(2.5, 9)
  })

  it('tom +2: as vozes entram no worklet do canal e 10 buscas não criam worklet novo', async () => {
    seed(song({ pitch: 2 }))
    const hook = await openApp()
    await act(async () => { await hook.result.current.play() })
    // Baixo e Teclado transpõem; Click e Guia não (regra central).
    const worklets = nodesOf(ctxOf(), 'AudioWorkletNode')
    expect(worklets).toHaveLength(2)
    const workletOf = (id: string) => worklets.find((w) => connectedTo(w, chan(hook, id).pannerNode))
    for (const id of ['bass', 'keys']) {
      expect(workletOf(id), id).toBeDefined()
      expect(entryOf(live(sourcesOf(hook, id))[0])).toBe(workletOf(id))
    }
    // Click e Guia pelo atraso igual à latência do worklet, ligado no panner deles.
    for (const id of ['click', 'guide']) {
      const entry = asFake(entryOf(live(sourcesOf(hook, id))[0]) as AudioNode)
      expect(entry.kind).toBe('DelayNode')
      expect(valueAt((entry as unknown as { delayTime: Parameters<typeof valueAt>[0] }).delayTime, ctxOf().currentTime)).toBe(PITCH_LATENCY)
      expect(connectedTo(entry, chan(hook, id).pannerNode)).toBe(true)
    }

    for (let k = 1; k <= 10; k++) {
      ctxOf().currentTime = k * 0.5
      act(() => { hook.result.current.seekTo(k * 0.3) })
    }
    expect(nodesOf(ctxOf(), 'AudioWorkletNode')).toHaveLength(2)
    for (const id of ['bass', 'keys']) {
      expect(live(sourcesOf(hook, id))).toHaveLength(1)
      expect(entryOf(live(sourcesOf(hook, id))[0])).toBe(workletOf(id))
    }
  })

  it('posição antes do instante agendado é o offset (não volta)', async () => {
    seed(song())
    const hook = await openApp()
    act(() => { hook.result.current.seekTo(4) })
    ctxOf().currentTime = 0.5
    await act(async () => { await hook.result.current.play() })
    // Pausa antes de as vozes começarem: a posição continua 4.
    act(() => { hook.result.current.pause() })
    await act(async () => { await hook.result.current.play() })
    const second = live(sourcesOf(hook, 'bass'))[0]
    expect(second.starts[0].offset).toBe(4)
    // Tocando 1,5 s: a posição anda pelo relógio do áudio a partir do instante agendado.
    ctxOf().currentTime = second.starts[0].when + 1.5
    act(() => { hook.result.current.pause() })
    await act(async () => { await hook.result.current.play() })
    expect(live(sourcesOf(hook, 'bass'))[0].starts[0].offset).toBeCloseTo(5.5, 9)
  })

  it('a velocidade entra nas vozes do play e nas que já tocam', async () => {
    seed(song())
    const hook = await openApp()
    act(() => { hook.result.current.updateTimeStretch(1.1) })
    await act(async () => { await hook.result.current.play() })
    const [s] = sourcesOf(hook, 'bass')
    expect(valueAt(s.playbackRate, ctxOf().currentTime)).toBe(1.1)
    act(() => { hook.result.current.updateTimeStretch(0.9) })
    expect(valueAt(s.playbackRate, ctxOf().currentTime)).toBe(0.9)
  })
})

describe('pré-contagem no relógio do áudio', () => {
  it('pré-contagem a 120 BPM: bipes em t0, +0,5, +1, +1,5 no click e as vozes em t0 + 2', async () => {
    precountOn(4)
    seed(song({ bpm: 120 }))
    const hook = await openApp()
    ctxOf().currentTime = 1
    await act(async () => { await hook.result.current.playWithPrecount() })

    const t0 = startAt(1)
    const times = [t0, t0 + 0.5, t0 + 1, t0 + 1.5]
    beepStarts().forEach((at, k) => expect(at).toBeCloseTo(times[k], 12))
    expect(beepStarts()).toHaveLength(4)
    // Acento no 1 (1319 Hz), os outros a 988 Hz.
    expect(nodesOf(ctxOf(), 'OscillatorNode').filter((o) => o.type === 'triangle').map((o) => o.frequency.value)).toEqual([1319, 988, 988, 988])
    // Pela entrada do canal de click (tom 0: o panner dele).
    for (const f of beepFilters()) expect(connectedTo(f, chan(hook, 'click').pannerNode)).toBe(true)
    // As vozes no fim da contagem, do começo da música.
    for (const id of ['click', 'guide', 'bass', 'keys']) {
      const [s] = sourcesOf(hook, id)
      expect(s.starts[0].when).toBeCloseTo(t0 + 2, 12)
      expect(s.starts[0].offset).toBe(0)
    }
    expect(hook.result.current.isPlaying).toBe(true)
    expect(hook.result.current.isCountingIn).toBe(true)
    hook.result.current.precountTimes.forEach((at, k) => expect(at).toBeCloseTo(times[k], 12))
  })

  it('pausar na pré-contagem para os bipes e nenhuma voz começa', async () => {
    precountOn(4)
    seed(song({ bpm: 120 }))
    const hook = await openApp()
    await act(async () => { await hook.result.current.playWithPrecount() })
    const t0 = startAt(0)
    // Entre o 2º e o 3º bipe, o 2º ainda soando.
    const now = t0 + 0.6
    ctxOf().currentTime = now
    act(() => { hook.result.current.cancelCountIn() })

    const oscs = nodesOf(ctxOf(), 'OscillatorNode')
    // Os que não começaram param já e saem do grafo; o que soa desce e para 20 ms depois.
    for (const o of oscs.slice(4)) expect(o.stops.at(-1)).toBe(now)
    for (const f of beepFilters().slice(2)) expect(f.connections).toEqual([])
    for (const o of oscs.slice(2, 4)) expect(o.stops.at(-1)).toBeCloseTo(now + 0.02, 12)
    // Nenhuma voz começa: cada uma para antes do próprio início.
    for (const s of nodesOf(ctxOf(), 'AudioBufferSourceNode')) expect(s.stops.at(-1)!).toBeLessThan(s.starts[0].when)
    expect(hook.result.current.isPlaying).toBe(false)
    expect(hook.result.current.isCountingIn).toBe(false)
    expect(hook.result.current.precountTimes).toEqual([])
    // A posição não andou.
    await act(async () => { await hook.result.current.play() })
    expect(live(sourcesOf(hook, 'bass'))[0].starts[0].offset).toBe(0)
  })

  it('sem canal de click e com tom +2 a contagem passa pelo atraso L', async () => {
    precountOn(2)
    seed(song({ pitch: 2, click: false }))
    const hook = await openApp()
    await act(async () => { await hook.result.current.playWithPrecount() })
    // O atraso da contagem do grafo (o primeiro DelayNode, da T12) com a latência do worklet.
    const countDelay = nodesOf(ctxOf(), 'DelayNode')[0]
    expect(valueAt(countDelay.delayTime, ctxOf().currentTime)).toBe(PITCH_LATENCY)
    expect(beepFilters()).toHaveLength(2)
    for (const f of beepFilters()) {
      expect(connectedTo(f, countDelay)).toBe(true)
      // Só pelo atraso alcança o barramento do Click (e a saída).
      expect(reaches(f, busClick())).toBe(true)
      expect(onlyThrough(f, countDelay)).toBe(true)
    }
  })

  it('sem canal de click, em Tudo junto com o pan automático, a contagem sai no ouvido e passa pelo corte', async () => {
    precountOn(2)
    mem.settings = { ...mem.settings, outputs: STEREO, autoPan: true }
    seed(song({ click: false }))
    const hook = await openApp()
    await act(async () => { await hook.result.current.playWithPrecount() })
    // Requisitos da T25 pra T26: pelo corte do Click e no lado do ouvido (-1), nunca no centro.
    expect(beepFilters()).toHaveLength(2)
    for (const f of beepFilters()) expect(onlyThrough(f, cutClick())).toBe(true)
    for (const sig of beepLevels()) {
      expect(sig[0][0]).toBeCloseTo(1, 12)
      expect(sig[1][0]).toBe(0)
    }
    // Desligar o pan automático leva a contagem pro centro (o knob do Click).
    mem.settings = { ...mem.settings, autoPan: false }
    await act(async () => { hook.rerender() })
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 150)) })
    for (const sig of beepLevels()) expect(sig[0][0]).toBeCloseTo(Math.SQRT1_2, 12)
    act(() => { hook.result.current.cancelCountIn() })
  })

  it('com o Click no mudo a pré-contagem também fica muda (segue o M, o fader e o pan do click)', async () => {
    precountOn(2)
    mem.settings = { ...mem.settings, outputs: STEREO }
    seed(song())
    const hook = await openApp()
    // Fader do click pela metade e knob todo à direita: a contagem vai junto.
    act(() => { hook.result.current.updateVolume('click', 0.5) })
    act(() => { hook.result.current.updatePan('click', 1) })
    ctxOf().currentTime = 1
    await act(async () => { await hook.result.current.playWithPrecount() })
    expect(beepFilters()).toHaveLength(2)
    for (const f of beepFilters()) expect(reaches(f, chan(hook, 'click').gainNode)).toBe(true)
    // O knob vai em rampa curta (setTarget): no instante do play ele já está no fim dela.
    for (const sig of beepLevels()) {
      expect(sig[0][0]).toBeCloseTo(0, 6)
      expect(sig[1][0]).toBeCloseTo(0.5, 6)
    }
    act(() => { hook.result.current.toggleMute('click') })
    for (const sig of beepLevels()) expect(sig.map((c) => c[0])).toEqual([0, 0])
    act(() => { hook.result.current.cancelCountIn() })
  })

  it('número de tempos estragado no aparelho: toca sem contagem, nunca com o relógio em NaN', async () => {
    localStorage.setItem('precount_enabled', 'true')
    localStorage.setItem('precount_beats', 'x')
    seed(song({ bpm: 120 }))
    const hook = await openApp()
    await act(async () => { await hook.result.current.playWithPrecount() })
    expect(beepFilters()).toHaveLength(0)
    expect(live(sourcesOf(hook, 'bass'))[0].starts[0]).toEqual({ when: startAt(0), offset: 0 })
    expect(hook.result.current.isCountingIn).toBe(false)
  })

  it('busca na pré-contagem recomeça a contagem no ponto novo', async () => {
    precountOn(2)
    seed(song({ bpm: 120 }))
    const hook = await openApp()
    await act(async () => { await hook.result.current.playWithPrecount() })
    ctxOf().currentTime = 0.3
    act(() => { hook.result.current.seekTo(6) })
    const t0 = startAt(0.3)
    expect(beepStarts().slice(2)).toEqual([t0, t0 + 0.5])
    const next = live(sourcesOf(hook, 'bass'))
    expect(next).toHaveLength(1)
    expect(next[0].starts[0]).toEqual({ when: t0 + 1, offset: 6 })
    expect(hook.result.current.isCountingIn).toBe(true)
  })
})

// Rodada 1 (revisão da T26, I1 e Minor c): o fim de um bipe cancelado e a cauda da soltura das
// vozes também contam como "algo soando" pro corte das trocas de rota (Ruling T25-corte).
describe('cauda do bipe e da soltura dentro do corte das trocas', () => {
  it('papel do Click trocado com um bipe soando na pré-contagem: a troca vai no corte e o bipe nunca chega na VS', async () => {
    precountOn(4)
    seed(song({ bpm: 120 })) // "Click e Guia separados": o Click na saída 1, a VS na 2
    const hook = await openApp()
    await act(async () => { await hook.result.current.playWithPrecount() })
    const ctx = ctxOf()
    const t0 = startAt(0)
    // No meio da sustentação do 2º bipe (pico 0,68).
    const now = t0 + 0.5 + 0.03
    ctx.currentTime = now
    const beep = beepFilters()[1]
    const env = nodesOf(ctx, 'GainNode').find((g) => connectedTo(g, beep))!
    const osc = nodesOf(ctx, 'OscillatorNode').filter((o) => o.type === 'triangle')[1]
    // Quanto do bipe sai na VS (saída 2) no instante t: caminho do passa-baixa até lá vezes o envelope.
    const vsAt = (t: number) => {
      const keep = ctx.currentTime
      ctx.currentTime = t
      const zeros = nodesOf(ctx, 'AudioBufferSourceNode').map((v): [unknown, Sig] => [v, [[0]]])
      const others = beepFilters().filter((b) => b !== beep).map((b): [unknown, Sig] => [b, [[0]]])
      const sig = measure(ctx, new Map<unknown, Sig>([[beep, [[1]]], ...others, ...zeros]), 1)
      ctx.currentTime = keep
      return sig[1][0] * valueAt(env.gain, t)
    }
    expect(vsAt(now)).toBe(0)
    expect(valueAt(env.gain, now)).toBeCloseTo(0.68, 9)
    // Instante em que o fader do Click sai do corte do Click.
    const fader = asFake(chan(hook, 'click').gainNode)
    let movedAt = -1
    const connect = fader.connect.bind(fader)
    fader.connect = ((...args: Parameters<typeof connect>) => { movedAt = ctx.currentTime; return connect(...args) }) as typeof fader.connect

    await act(async () => { hook.result.current.setChannelMeta('click', { role: 'normal' }) })
    // O corte desce nos três barramentos (com a folga de 10 ms) e a troca ainda não aconteceu.
    expect(cutRamps(cutVs())).toEqual([0])
    expect(movedAt).toBe(-1)
    await letAudioRun()
    expect(cutRamps(cutVs())).toEqual([0, 1])
    // O fader trocou de barramento no fundo do corte...
    expect(movedAt).toBeGreaterThan(now)
    expect(valueAt(cutVs().gain, movedAt)).toBe(0)
    // ...e daí até os osciladores do bipe pararem, nada dele sai na VS.
    // (o último stop vale: o do cancel, 20 ms depois dele)
    const end = osc.stops.at(-1)!
    expect(end).toBeCloseTo(now + 0.02, 9)
    for (let t = movedAt; t <= end; t += 0.00025) expect(Math.abs(vsAt(t)), `t = ${t}`).toBeLessThan(1e-9)
  })

  it('pausar e trocar a rota logo depois: a cauda da soltura passa pelo corte', async () => {
    seed(song())
    const hook = await openApp()
    await act(async () => { await hook.result.current.play() })
    ctxOf().currentTime = 1
    act(() => { hook.result.current.pause() })
    // Na mesma hora (a cauda ainda em ganho 1 até a folga de 10 ms), "Tudo junto".
    mem.settings = { ...mem.settings, outputs: STEREO }
    await act(async () => { hook.rerender() })
    expect(cutRamps(cutVs())).toEqual([0])
    await letAudioRun()
    expect(cutRamps(cutVs())).toEqual([0, 1])
    expect(hook.result.current.outputPlan.mode).toBe('stereo')
    // Passada a cauda (40 ms), parado troca na hora, sem corte.
    ctxOf().currentTime += 0.05
    mem.settings = { ...mem.settings, outputs: SPLIT }
    await act(async () => { hook.rerender() })
    expect(hook.result.current.outputPlan.mode).toBe('split2')
    expect(cutRamps(cutVs())).toEqual([0, 1])
  })
})

describe('canal entrando e saindo com a música tocando', () => {
  it('click adicionado tocando entra na posição atual', async () => {
    seed(song({ click: false }))
    const hook = await openApp()
    await act(async () => { await hook.result.current.play() })
    const when = startAt(0)
    ctxOf().currentTime = 2
    const others = nodesOf(ctxOf(), 'AudioBufferSourceNode')
    await act(async () => { await hook.result.current.addChannelToActiveSong(new File(['mono'], 'Click.wav', { type: 'audio/wav' })) })

    const click = hook.result.current.channels.find((c) => c.name === 'Click')!
    const sources = nodesOf(ctxOf(), 'AudioBufferSourceNode').filter((s) => s.buffer === click.buffer)
    expect(sources).toHaveLength(1)
    const at = startAt(2)
    expect(sources[0].starts[0].when).toBe(at)
    expect(sources[0].starts[0].offset).toBeCloseTo(at - when, 12)
    expect(entryOf(sources[0])).toBe(click.pannerNode)
    expect(click.sourceNode).toBe(sources[0])
    // Os outros seguem tocando, sem reinício.
    expect(nodesOf(ctxOf(), 'AudioBufferSourceNode').filter((s) => s.buffer !== click.buffer)).toEqual(others)
    for (const s of others) expect(s.stops).toEqual([])
  })

  it('canal novo com tom +2 espera o worklet e entra na posição de quando ele nasceu', async () => {
    seed(song({ pitch: 2 }))
    const hook = await openApp()
    await act(async () => { await hook.result.current.play() })
    const when = startAt(0)
    let releaseWorklet!: () => void
    mem.pitchGate = new Promise<void>((resolve) => { releaseWorklet = resolve })
    let adding!: Promise<void>
    ctxOf().currentTime = 1
    await act(async () => { adding = hook.result.current.addChannelToActiveSong(new File(['stereo'], 'GTR_1.wav', { type: 'audio/wav' })) })
    const gtr = () => hook.result.current.channels.find((c) => c.name === 'GTR_1')!
    // O canal já está na lista (leitura do arquivo pelo FileReader do jsdom), esperando o worklet.
    await act(async () => { for (let i = 0; i < 100 && !gtr(); i++) await new Promise((resolve) => setTimeout(resolve, 5)) })
    expect(nodesOf(ctxOf(), 'AudioBufferSourceNode').filter((s) => s.buffer === gtr().buffer)).toHaveLength(0)
    // O worklet nasce aos 1,5 s: a voz entra ali, no worklet dele.
    ctxOf().currentTime = 1.5
    await act(async () => { releaseWorklet(); await adding })
    const [s] = nodesOf(ctxOf(), 'AudioBufferSourceNode').filter((x) => x.buffer === gtr().buffer)
    expect(s.starts[0].when).toBe(startAt(1.5))
    expect(s.starts[0].offset).toBeCloseTo(startAt(1.5) - when, 12)
    const worklet = asFake(entryOf(s) as AudioNode)
    expect(worklet.kind).toBe('AudioWorkletNode')
    expect(connectedTo(worklet, gtr().pannerNode)).toBe(true)
    expect(nodesOf(ctxOf(), 'AudioWorkletNode')).toHaveLength(3)
  })

  it('remover canal tocando para a voz dele', async () => {
    seed(song())
    const hook = await openApp()
    await act(async () => { await hook.result.current.play() })
    ctxOf().currentTime = 1
    const [bass] = sourcesOf(hook, 'bass')
    const rest = ['click', 'guide', 'keys'].map((id) => sourcesOf(hook, id)[0])
    await act(async () => { await hook.result.current.removeChannel('bass') })
    expect(bass.stops).toEqual([1])
    expect(bass.connections).toEqual([])
    for (const s of rest) expect(s.stops).toEqual([])
    // Pausar depois não mexe mais na voz removida.
    act(() => { hook.result.current.pause() })
    expect(bass.stops).toEqual([1])
  })
})

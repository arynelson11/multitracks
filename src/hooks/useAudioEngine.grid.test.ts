// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { makeClickShims } from '../test/clickShims'
import { mixToMono, parseWav } from '../test/clickProbe'
import { asFake, createFakeAudioContext, FakeAudioBuffer, nodesOf, valueAt, type FakeAudioContext, type FakeAudioContextOptions } from '../test/fakeAudio'
import type { AutoClickOkPlan, AutoClickPlan } from '../lib/autoClick'
import type { ClickLibrarySelection } from '../lib/clickLibrary'
import type { SongGridDetection } from '../lib/beatGrid'
import { resolveChannelRole } from '../lib/channelNames'
import { barSeconds } from '../lib/songGrid'
import type { SavedSong } from '../lib/repertoireSchema'
import type { StageGates, StageMode, TimeSignature } from '../lib/stageContracts'
import type { Marker } from '../types'
import { handleGridRequest, type GridWorkerRequest, type GridWorkerResponse } from '../workers/gridWorker'
import { useAudioEngine } from './useAudioEngine'

// T27: a grade de cada música sai da faixa de click (analyzeClickTrack da T3 + gridFromClick da
// T2), o compasso salvo na nuvem e o escolhido no EDITAR vencem o acento, e a música sem click
// ganha o "Click gerado" (planAutoClick e renderAutoClick da M7, mockados aqui) só ao carregar
// ou ao ficar ativa com a VS parada. O hook roda de verdade com o AudioContext falso da T1, o
// IndexedDB em memória e clicks sintéticos (a mesma receita do gerador dos testes da T3); a
// leitura do click é a de verdade, só espionada.

const SR = 48000

type EngineOpts = { autoClick?: boolean; sectionGates?: StageGates; stageMode?: StageMode }

const mem = vi.hoisted(() => ({
  db: new Map<string, unknown>(),
  settings: {} as Record<string, unknown>,
  metaGate: null as Promise<void> | null,
  // Conteúdo do arquivo -> amostras (mono) que o decode devolve; o resto vira 20 s de silêncio.
  buffers: new Map<string, Float32Array>(),
  // Click Percussive (semínima) gravado pelo gerador de verdade, a 44,1 kHz (beforeAll).
  percussive: null as Float32Array | null,
  opts: undefined as EngineOpts | undefined,
  // O que o planAutoClick mockado devolve, e as chamadas dele e do renderAutoClick.
  plan: null as unknown,
  planCalls: [] as { ids: string[]; opts: unknown; worker: boolean }[],
  renderCalls: [] as unknown[][],
  // Cada leitura do click: compasso e BPM passados e se a VS estava tocando naquele instante.
  analyzeCalls: [] as { known: unknown; bpm: unknown; playing: boolean; worker: boolean }[],
  playing: () => false,
  // Worker da grade falso (Ruling T27-worker): roda o handleGridRequest do arquivo do Worker
  // fora do pedido (num setTimeout), como uma thread à parte. `inWorker` marca o que rodou nele;
  // `workerGate` segura as respostas até o teste liberar; `workerMode` faz ele não nascer ou quebrar.
  inWorker: false,
  workerGate: null as Promise<void> | null,
  workerMode: 'ok' as 'ok' | 'nao-nasce' | 'quebra',
  workers: [] as unknown[],
  requests: [] as { req: GridWorkerRequest; transfer: Transferable[] }[],
  // Montagem de verdade do WAV do click gerado (gerador real com as amostras de public/): o
  // contexto de 44,1 kHz que ele cria e quando a amostra já foi lida e a montagem acabou.
  realRender: false,
  clickCtx: null as (new (opts?: { sampleRate?: number }) => unknown) | null,
  clickBlob: null as (() => Blob | null) | null,
  renderDecoded: false,
  renderFinished: false,
  ctx: null as unknown,
  // Opções do contexto falso do motor (ex.: aparelho de 1 canal).
  ctxOpts: {} as FakeAudioContextOptions,
  // Segura a decodificação do WAV do click gerado (o motor no meio de gravar o "Click gerado").
  genGate: null as Promise<void> | null,
}))

class FakeGridWorker {
  onmessage: ((e: { data: GridWorkerResponse }) => void) | null = null
  onerror: ((e: unknown) => void) | null = null
  onmessageerror: ((e: unknown) => void) | null = null
  terminated = false
  constructor() {
    if (mem.workerMode === 'nao-nasce') throw new Error('Worker bloqueado (teste)')
    mem.workers.push(this)
  }
  postMessage(req: GridWorkerRequest, transfer: Transferable[]) {
    mem.requests.push({ req, transfer })
    const run = () => {
      if (this.terminated) return
      if (mem.workerMode === 'quebra') { this.onerror?.(new Event('error')); return }
      mem.inWorker = true
      let resp: GridWorkerResponse
      try { resp = handleGridRequest(req) } finally { mem.inWorker = false }
      this.onmessage?.({ data: resp })
    }
    void (mem.workerGate ?? Promise.resolve()).then(() => setTimeout(run, 0))
  }
  terminate() { this.terminated = true }
}

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
// A amostra escolhida na biblioteca é a Percussive em semínima (o maior ataque, 4,4 ms).
vi.mock('../lib/clickLibrary', async (importOriginal) => ({
  ...await importOriginal<typeof import('../lib/clickLibrary')>(),
  loadClickSelection: () => ({ type: 'Percussive', subdivision: 'quarter' }),
}))
vi.mock('../lib/offlineCache', () => ({ getCachedStem: async () => undefined, getCachedStemNames: async () => null, isSongCached: async () => false }))
vi.mock('../lib/clickMeter', async (importOriginal) => {
  const real = await importOriginal<typeof import('../lib/clickMeter')>()
  return {
    ...real,
    analyzeClickTrack: (...args: Parameters<typeof real.analyzeClickTrack>) => {
      mem.analyzeCalls.push({ known: args[2], bpm: args[3], playing: mem.playing(), worker: mem.inWorker })
      return real.analyzeClickTrack(...args)
    },
  }
})
vi.mock('../lib/autoClick', async (importOriginal) => {
  const real = await importOriginal<typeof import('../lib/autoClick')>()
  return {
    ...real,
    planAutoClick: (channels: readonly { id: string }[], opts: unknown) => {
      mem.planCalls.push({ ids: channels.map((c) => c.id), opts, worker: mem.inWorker })
      return mem.plan
    },
    renderAutoClick: async (...args: unknown[]) => {
      mem.renderCalls.push(args)
      if (mem.realRender) {
        // Como o renderAutoClick de verdade: o click da biblioteca na grade do plano, do tamanho da música.
        const [plan, duration, sel] = args as [AutoClickOkPlan, number, ClickLibrarySelection]
        const { generateManualClickTrackFromSample } = await vi.importActual<typeof import('../lib/AudioAnalyzer')>('../lib/AudioAnalyzer')
        const d = plan.detection
        await generateManualClickTrackFromSample(sel.type, sel.subdivision, d.pulseBpm, duration, true, plan.signature, { firstBeat: d.firstBeat, downbeat: d.downbeat })
        mem.renderFinished = true
        if (!mem.clickBlob?.()) throw new Error('o gerador não criou o WAV')
      }
      return new Blob(['gerado'])
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

// Click do Metrônomo de verdade (generateManualClickTrackFromSample com a amostra de public/), na
// grade de 120 pulsos com o 1 em 0,37 + 0,5 s: o gerador põe o início audível (-20 dB) de cada
// click na grade, e o leitor do palco lê o 1 desse WAV 5,4 ms depois (Aviso T27/M7).
const PUBLIC_DIR = join(process.cwd(), 'public')
function lerPublic(rel: string): ArrayBuffer | null {
  try {
    const buf = readFileSync(join(PUBLIC_DIR, rel))
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer
  } catch {
    return null
  }
}
beforeAll(async () => {
  const { generateManualClickTrackFromSample } = await vi.importActual<typeof import('../lib/AudioAnalyzer')>('../lib/AudioAnalyzer')
  const shims = makeClickShims(lerPublic)
  vi.stubGlobal('AudioContext', shims.AudioContext)
  vi.stubGlobal('fetch', shims.fetch)
  const create = vi.spyOn(URL, 'createObjectURL').mockImplementation(shims.createObjectURL)
  const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(shims.revokeObjectURL)
  try {
    await generateManualClickTrackFromSample('Percussive', 'quarter', 120, 20, true, '4/4', { firstBeat: 0.37, downbeat: 1 })
    const wav = parseWav(await shims.lastBlob()!.arrayBuffer())
    mem.percussive = mixToMono(wav.channels)
  } finally {
    create.mockRestore()
    revoke.mockRestore()
    vi.unstubAllGlobals()
  }
})

// ---------- Clicks sintéticos (receita do gerador dos testes da T3) ----------

/** Bipe senoidal de 25 ms com queda exponencial a cada pulso; `loud` = o 1 com 1,8x. */
function synthClick(o: { bpm: number; seconds: number; pulsesPerBar: number; accent: 'loud' | 'none'; firstPulse: number }): Float32Array {
  const out = new Float32Array(Math.round(o.seconds * SR))
  const len = Math.round(0.025 * SR)
  for (let k = 0; ; k++) {
    const t = o.firstPulse + (k * 60) / o.bpm
    if (t >= o.seconds) break
    const amp = o.accent === 'loud' && k % o.pulsesPerBar === 0 ? 0.72 : 0.4
    const start = Math.round(t * SR)
    for (let i = 0; i < len && start + i < out.length; i++) {
      const s = i / SR
      out[start + i] += amp * Math.exp(-s / 0.008) * Math.sin(2 * Math.PI * 1200 * s)
    }
  }
  return out
}
/** Tom contínuo: tem som, mas nenhum pulso (a leitura dá nula). */
function tone(seconds: number): Float32Array {
  const out = new Float32Array(Math.round(seconds * SR))
  for (let i = 0; i < out.length; i++) out[i] = 0.3 * Math.sin((2 * Math.PI * 440 * i) / SR)
  return out
}

let error: MockInstance<typeof console.error>
beforeEach(() => {
  localStorage.clear()
  mem.db.clear()
  mem.metaGate = null
  mem.opts = undefined
  mem.plan = null
  mem.planCalls.length = 0
  mem.renderCalls.length = 0
  mem.analyzeCalls.length = 0
  mem.playing = () => false
  mem.inWorker = false
  mem.workerGate = null
  mem.workerMode = 'ok'
  mem.workers.length = 0
  mem.requests.length = 0
  mem.ctx = null
  mem.ctxOpts = {}
  mem.realRender = false
  mem.clickCtx = null
  mem.clickBlob = null
  mem.renderDecoded = false
  mem.renderFinished = false
  mem.genGate = null
  mem.settings = { autoPan: false, audioDeviceId: 'default', outputs: { mode: 'split2', earOnSecond: false, multi: { vsPair: 0, click: 2, guide: 3 } } }
  localStorage.setItem('mt_legacy_pans_reset:u1', '1')
  mem.buffers.clear()
  mem.buffers.set('click34', synthClick({ bpm: 100, seconds: 20, pulsesPerBar: 3, accent: 'loud', firstPulse: 0.5 }))
  mem.buffers.set('click44', synthClick({ bpm: 120, seconds: 20, pulsesPerBar: 4, accent: 'loud', firstPulse: 0.5 }))
  mem.buffers.set('semAcento', synthClick({ bpm: 90, seconds: 20, pulsesPerBar: 4, accent: 'none', firstPulse: 0.5 }))
  mem.buffers.set('tom', tone(20))
  const decode = async (data: ArrayBuffer) => {
    const key = new TextDecoder().decode(data)
    if (key === 'gerado' && mem.genGate) await mem.genGate
    // O WAV do gerador sai a 44,1 kHz.
    // 5 min de bateria muda a 8 kHz (pouca memória): a duração da música do click gerado.
    if (key === 'longo') return new FakeAudioBuffer(1, 300 * 8000, 8000)
    const samples = key === 'percussive' ? mem.percussive : mem.buffers.get(key)
    const buffer = new FakeAudioBuffer(1, samples?.length ?? 20 * SR, key === 'percussive' ? 44100 : SR)
    if (samples) buffer.copyToChannel(samples, 0)
    return buffer
  }
  vi.stubGlobal('AudioContext', function (opts?: { sampleRate?: number }) {
    // O gerador do click cria o contexto dele a 44,1 kHz só pra ler a amostra.
    if (opts?.sampleRate === 44100 && mem.clickCtx) return new mem.clickCtx(opts)
    const ctx = createFakeAudioContext({ ...mem.ctxOpts, decode })
    mem.ctx = ctx
    return ctx
  })
  vi.stubGlobal('Worker', FakeGridWorker)
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

const META = 'mt_meta_playlist_u1'
const saved = () => (mem.db.get(META) as SavedSong[] | undefined) ?? []

async function openApp() {
  const hook = renderHook(() => useAudioEngine('u1', mem.opts))
  let release!: () => void
  mem.metaGate = new Promise<void>((resolve) => { release = resolve })
  let init!: Promise<void>
  await act(async () => { init = hook.result.current.initEngine() })
  await act(async () => { release(); await init })
  mem.metaGate = null
  mem.playing = () => hook.result.current.isPlaying
  return hook
}
type Hook = Awaited<ReturnType<typeof openApp>>

/** Carrega a música: cada arquivo é [nome, conteúdo] e o conteúdo escolhe o áudio do decode. */
async function load(hook: Hook, files: [string, string][], o: { name?: string; bpm?: number; timeSignature?: TimeSignature; markers?: Marker[] } = {}) {
  const list = files.map(([name, content]) => new File([content], name, { type: 'audio/wav' }))
  await act(async () => {
    await hook.result.current.loadFiles(list as unknown as FileList, o.name ?? 'Música', undefined, o.markers, 'C', o.bpm, o.timeSignature ? { timeSignature: o.timeSignature } : undefined)
  })
}
/** Espera a leitura da grade da música ativa terminar. */
async function settled(hook: Hook) {
  await waitFor(() => expect(hook.result.current.isReadingGrid).toBe(false), { timeout: 5000 })
}
const wait = (ms: number) => act(async () => { await new Promise((resolve) => setTimeout(resolve, ms)) })

// Plano da M7 (detecção pronta) com a grade a 120 pulsos por minuto, o 1 no 2º pulso depois de 0,37 s.
function okPlan(d: Partial<SongGridDetection> = {}, signature: TimeSignature = '4/4'): AutoClickPlan {
  return {
    ok: true, signature, label: 'Bateria',
    detection: {
      bpm: 120, pulseBpm: 120, firstBeat: 0.37, downbeat: 1, confidence: 0.9, offbeatRisk: false, preferConflict: false,
      downbeatFrom: 'baixo', downbeatMargin: 2, alternatives: [60, 240], tracksUsed: ['bateria'], ...d,
    },
  }
}
const ch = (id: string, name: string): SavedSong['channels'][number] => ({ id, name, volume: 1, muted: false, soloed: false, pan: 0, bus: '1/2' })
/** Repertório salvo no aparelho; `content` escolhe o áudio de cada canal (padrão: silêncio). */
function seedSongs(songs: SavedSong[], content: (channelId: string) => string = () => 'bateria') {
  mem.db.set(META, structuredClone(songs))
  for (const s of songs) for (const c of s.channels) mem.db.set(`mt_files_u1:ch:${c.id}`, new File([content(c.id)], `${c.name}.wav`, { type: 'audio/wav' }))
}
const savedNoClick = (id: string): SavedSong => ({
  id, name: `Música ${id}`, duration: 20, pitch: 0, originalKey: 'C', bpm: 120, schemaVersion: 3, channelOrder: 'auto',
  channels: [ch(`${id}-d`, 'DRUMS'), ch(`${id}-b`, 'BASS')],
})

describe('grade da música lida na faixa de click', () => {
  it('click 3/4 com acento: grade lida do click, salva no repertório', async () => {
    const hook = await openApp()
    await load(hook, [['CLICK.wav', 'click34'], ['BASS.wav', 'bateria']], { bpm: 100 })
    await settled(hook)

    const grid = hook.result.current.songGrid!
    expect(grid).toMatchObject({ signature: '3/4', countEvery: 1, source: 'click', meterSource: 'acento' })
    expect(grid.bpm).toBeCloseTo(100, 2)
    expect(grid.firstDownbeat).toBeCloseTo(0.5, 3)
    expect(hook.result.current.gridWarning).toBeNull()
    // Lida uma vez, com o BPM salvo da música e sem compasso conhecido, e com a VS parada.
    expect(mem.analyzeCalls).toEqual([{ known: null, bpm: 100, playing: false, worker: true }])
    expect(saved()[0].grid).toEqual(grid)
  })

  it('compasso da nuvem 6/8 vence o acento lido', async () => {
    const hook = await openApp()
    // O 1 do 6/8 (o acento a cada 3 pulsos soa igual no 1 e no 4) sai da seção marcada no 1.
    const markers = [{ id: 'm1', time: 4.1, label: 'Verso' }]
    await load(hook, [['CLICK.wav', 'click34'], ['BASS.wav', 'bateria']], { bpm: 50, timeSignature: '6/8', markers })
    await settled(hook)

    const grid = hook.result.current.songGrid!
    expect(grid).toMatchObject({ signature: '6/8', countEvery: 3, source: 'click', meterSource: 'salvo' })
    expect(grid.firstDownbeat).toBeCloseTo(0.5, 3)
    expect(hook.result.current.gridWarning).toBeNull()
    expect(mem.analyzeCalls.map((c) => c.known)).toEqual(['6/8'])
    expect(saved()[0]).toMatchObject({ timeSignature: '6/8', grid })
  })

  it('compasso escolhido no EDITAR sobrevive a reabrir e a "Ler o click de novo"', async () => {
    const first = await openApp()
    await load(first, [['CLICK.wav', 'click44'], ['BASS.wav', 'bateria']], { bpm: 120 })
    await settled(first)
    expect(first.result.current.songGrid).toMatchObject({ signature: '4/4', meterSource: 'acento' })
    const songId = first.result.current.playlist[0].id

    act(() => { first.result.current.setSongMeter(songId, '3/4', 1) })
    // Grade de click: o click é lido de novo com o compasso escolhido (frente 2 I2).
    await settled(first)
    expect(mem.analyzeCalls.map((c) => c.known)).toEqual([null, '3/4'])
    const manual = first.result.current.songGrid!
    expect(manual).toMatchObject({ signature: '3/4', countEvery: 1, source: 'click', meterSource: 'manual' })
    expect(manual.bpm).toBeCloseTo(120, 2)
    await waitFor(() => expect(saved()[0].grid).toEqual(manual))

    // Reabrir: a grade salva volta como está, sem ler o click de novo.
    cleanup()
    mem.analyzeCalls.length = 0
    const hook = await openApp()
    await wait(80)
    expect(hook.result.current.songGrid).toEqual(manual)
    expect(mem.analyzeCalls).toHaveLength(0)

    // "Ler o click de novo": relê BPM e fase com o compasso escolhido e mantém ele.
    await act(async () => { await hook.result.current.redetectSongGrid(songId) })
    expect(mem.analyzeCalls).toEqual([{ known: '3/4', bpm: 120, playing: false, worker: true }])
    const again = hook.result.current.songGrid!
    expect(again).toMatchObject({ signature: '3/4', meterSource: 'manual', source: 'click' })
    expect(again.bpm).toBeCloseTo(120, 2)
    expect(again.firstDownbeat).toBeCloseTo(0.5, 3)
    expect(hook.result.current.gridWarning).toBeNull()
    expect(saved()[0].grid).toEqual(again)
  })

  it('sem click e sem autoClick: grade do BPM salvo e aviso SEM CLICK LIDO', async () => {
    const hook = await openApp()
    await load(hook, [['DRUMS.wav', 'bateria'], ['BASS.wav', 'bateria']], { bpm: 90 })
    await wait(80)

    expect(hook.result.current.songGrid).toEqual({ bpm: 90, firstDownbeat: 0, signature: '4/4', countEvery: 1, source: 'bpm', meterSource: 'padrao' })
    expect(hook.result.current.gridWarning).toBe('sem-click-lido')
    expect(hook.result.current.isReadingGrid).toBe(false)
    expect(mem.planCalls).toHaveLength(0)
    expect(mem.analyzeCalls).toHaveLength(0)
    // A grade do BPM sai do BPM salvo na hora (troca junto se a biblioteca mudar o BPM): nada a gravar.
    expect(saved()[0].grid).toBeUndefined()
    expect(hook.result.current.playlist[0].channels).toHaveLength(2)

    // Sem BPM salvo: sem grade.
    await load(hook, [['DRUMS.wav', 'bateria']], { name: 'Outra' })
    act(() => { hook.result.current.jumpToSong(1) })
    expect(hook.result.current.songGrid).toBeNull()
    expect(hook.result.current.gridWarning).toBe('sem-grade')
  })

  it('click sem acento: o 1 das seções marcadas quando há, senão COMPASSO ASSUMIDO (também com o compasso escolhido)', async () => {
    const hook = await openApp()
    // 3/4 salvo, click a 90 sem acento: o 1 assumido no primeiro pulso (0,5 s).
    await load(hook, [['CLICK.wav', 'semAcento']], { bpm: 90, timeSignature: '3/4' })
    await settled(hook)
    expect(hook.result.current.songGrid).toMatchObject({ signature: '3/4', source: 'click' })
    expect(hook.result.current.songGrid!.firstDownbeat).toBeCloseTo(0.5, 3)
    expect(hook.result.current.gridWarning).toBe('compasso-assumido')
    // Escolher o compasso no EDITAR não prova onde cai o 1 (Ruling W3).
    act(() => { hook.result.current.setSongMeter(hook.result.current.playlist[0].id, '3/4', 1) })
    expect(hook.result.current.songGrid!.meterSource).toBe('manual')
    expect(hook.result.current.gridWarning).toBe('compasso-assumido')

    // Com seções marcadas no 3º pulso dos compassos (uma um pouco fora), o 1 vem delas.
    const pulse = 60 / 90
    const markers = [{ id: 'a', time: 0.5 + 2 * pulse + 2 * 3 * pulse, label: 'Verso' }, { id: 'b', time: 0.5 + 2 * pulse + 4 * 3 * pulse + 0.05, label: 'Refrão' }]
    await load(hook, [['CLICK.wav', 'semAcento']], { name: 'Com seções', bpm: 90, timeSignature: '3/4', markers })
    act(() => { hook.result.current.jumpToSong(1) })
    await waitFor(() => expect(hook.result.current.playlist[1].grid?.source).toBe('click'), { timeout: 5000 })
    expect(hook.result.current.songGrid).toMatchObject({ signature: '3/4', meterSource: 'salvo' })
    expect(hook.result.current.songGrid!.firstDownbeat).toBeCloseTo(0.5 + 2 * pulse, 3)
    expect(hook.result.current.gridWarning).toBeNull()

    // Acento a cada 3 sem BPM salvo nem compasso: 3/4 ou 6/8, a tela pede conferência.
    await load(hook, [['CLICK.wav', 'click34']], { name: 'Dúvida' })
    act(() => { hook.result.current.jumpToSong(2) })
    await waitFor(() => expect(hook.result.current.playlist[2].grid?.source).toBe('click'), { timeout: 5000 })
    expect(hook.result.current.gridWarning).toBe('compasso-assumido')
  })

  it('1 não provado com o compasso escolhido no EDITAR: o COMPASSO ASSUMIDO continua depois de reabrir', async () => {
    const first = await openApp()
    // 3/4 salvo e click sem acento: o 1 assumido no primeiro pulso.
    await load(first, [['CLICK.wav', 'semAcento']], { bpm: 90, timeSignature: '3/4' })
    // Click com acento: o 1 provado, pra comparar.
    await load(first, [['CLICK.wav', 'click44']], { name: 'Com acento', bpm: 120 })
    await waitFor(() => expect(first.result.current.playlist.map((s) => s.grid?.source)).toEqual(['click', 'click']), { timeout: 5000 })
    const [assumida, provada] = first.result.current.playlist.map((s) => s.id)
    act(() => { first.result.current.setSongMeter(assumida, '3/4', 1) })
    act(() => { first.result.current.setSongMeter(provada, '3/4', 1) })
    expect(first.result.current.gridWarning).toBe('compasso-assumido')
    await waitFor(() => expect(saved().map((s) => s.grid?.meterSource)).toEqual(['manual', 'manual']))
    expect(saved().map((s) => s.downbeatAssumed)).toEqual([true, undefined])
    cleanup()

    const hook = await openApp()
    await wait(80)
    expect(hook.result.current.songGrid).toMatchObject({ source: 'click', meterSource: 'manual', signature: '3/4' })
    expect(hook.result.current.gridWarning).toBe('compasso-assumido')
    act(() => { hook.result.current.jumpToSong(1) })
    expect(hook.result.current.songGrid).toMatchObject({ source: 'click', meterSource: 'manual', signature: '3/4' })
    expect(hook.result.current.gridWarning).toBeNull()
  })

  it('trocar o compasso no EDITAR numa grade lida do click relê o click com o compasso novo; o aviso fica até lá (frente 2 I2)', async () => {
    // Click sem acento em colcheia a 156 (a "Fé", 6/8): a leitura sem compasso assume 4/4 a 156.
    mem.buffers.set('colcheia156', synthClick({ bpm: 156, seconds: 30, pulsesPerBar: 6, accent: 'none', firstPulse: 0.5 }))
    const bar68 = (6 * 60) / 156
    const hook = await openApp()
    await load(hook, [['CLICK.wav', 'colcheia156']])
    await settled(hook)
    expect(hook.result.current.songGrid).toMatchObject({ signature: '4/4', source: 'click', meterSource: 'padrao' })
    const id = hook.result.current.playlist[0].id
    mem.analyzeCalls.length = 0
    let release!: () => void
    mem.workerGate = new Promise<void>((resolve) => { release = resolve })
    act(() => { hook.result.current.setSongMeter(id, '6/8', 3) })
    // Na hora: o compasso do withMeter (os pulsos do click dobrados, 1,154 s: errado neste click),
    // com o COMPASSO ASSUMIDO aceso enquanto o click é lido de novo.
    expect(barSeconds(hook.result.current.songGrid!)).toBeCloseTo(bar68 / 2, 3)
    expect(hook.result.current.songGrid!.meterSource).toBe('manual')
    expect(hook.result.current.gridWarning).toBe('compasso-assumido')
    release()
    mem.workerGate = null
    await settled(hook)
    // Relido no 6/8: o compasso certo (2,308 s), o escolhido fica.
    expect(mem.analyzeCalls.map((c) => c.known)).toEqual(['6/8'])
    const grid = hook.result.current.songGrid!
    expect(grid).toMatchObject({ signature: '6/8', countEvery: 3, meterSource: 'manual', source: 'click' })
    expect(barSeconds(grid)).toBeCloseTo(bar68, 3)
    // Sem acento e sem seção marcada o 1 continua não provado: o aviso não some.
    expect(hook.result.current.gridWarning).toBe('compasso-assumido')
    await waitFor(() => expect(saved()[0].grid).toEqual(grid))
    expect(saved()[0].downbeatAssumed).toBe(true)
  })

  it('com seções marcadas, o 6/8 escolhido num click sem acento fica no compasso certo e sem aviso depois da releitura', async () => {
    mem.buffers.set('colcheia156', synthClick({ bpm: 156, seconds: 30, pulsesPerBar: 6, accent: 'none', firstPulse: 0.5 }))
    const bar68 = (6 * 60) / 156
    // Seções nas barras do 6/8 (o 1 no 1º pulso).
    const markers = [0, 1, 2, 3].map((k) => ({ id: `m${k}`, time: 0.5 + 2 * k * bar68, label: `S${k}` }))
    const hook = await openApp()
    await load(hook, [['CLICK.wav', 'colcheia156']], { markers })
    await settled(hook)
    const id = hook.result.current.playlist[0].id
    act(() => { hook.result.current.setSongMeter(id, '6/8', 3) })
    await settled(hook)
    const grid = hook.result.current.songGrid!
    expect(grid).toMatchObject({ signature: '6/8', meterSource: 'manual', source: 'click' })
    expect(barSeconds(grid)).toBeCloseTo(bar68, 3)
    expect(grid.firstDownbeat).toBeCloseTo(0.5, 3)
    expect(hook.result.current.gridWarning).toBeNull()
  })

  it('ida e volta do compasso numa grade de click sem releitura (click gerado) não tira o 1 do lugar (adiado D4)', async () => {
    // 4/4 a 120 com o 1 em 1,7 s, na grade do click que o motor gerou (não é relido).
    const grid = { bpm: 120, firstDownbeat: 1.7, signature: '4/4' as const, countEvery: 1 as const, source: 'click' as const, meterSource: 'salvo' as const }
    seedSongs([{ ...savedNoClick('s1'), grid, channels: [...savedNoClick('s1').channels, ch('s1-g', 'Click gerado')] }])
    const hook = await openApp()
    await wait(80)
    mem.analyzeCalls.length = 0
    for (const [ida, conta] of [['6/8', 3], ['3/4', 1]] as const) {
      act(() => { hook.result.current.setSongMeter('s1', ida, conta) })
      expect(hook.result.current.songGrid!.firstDownbeat).toBeCloseTo(1.7 - barSeconds(hook.result.current.songGrid!), 9)
      act(() => { hook.result.current.setSongMeter('s1', '4/4', 1) })
      expect(hook.result.current.songGrid!.firstDownbeat).toBe(1.7)
    }
    // Pelo repertório também: a âncora vai salva.
    act(() => { hook.result.current.setSongMeter('s1', '6/8', 3) })
    await waitFor(() => expect(saved()[0].grid?.signature).toBe('6/8'))
    cleanup()
    const again = await openApp()
    await wait(80)
    act(() => { again.result.current.setSongMeter('s1', '4/4', 1) })
    expect(again.result.current.songGrid!.firstDownbeat).toBe(1.7)
    expect(mem.analyzeCalls).toHaveLength(0)
  })

  it('repertório de antes da grade: ao abrir, a grade de cada música com click é lida, sem esperar ela ficar ativa', async () => {
    const v2 = (id: string, bpm: number): SavedSong => ({
      id, name: `Música ${id}`, duration: 20, pitch: 0, originalKey: 'C', bpm, schemaVersion: 2, channelOrder: 'auto',
      channels: [ch(`${id}-c`, 'CLICK'), ch(`${id}-b`, 'BASS')],
    })
    seedSongs([v2('s1', 120), v2('s2', 100)], (id) => (id === 's1-c' ? 'click44' : id === 's2-c' ? 'click34' : 'bateria'))
    const hook = await openApp()
    await waitFor(() => expect(hook.result.current.playlist.map((s) => s.grid?.signature)).toEqual(['4/4', '3/4']), { timeout: 5000 })
    expect(mem.analyzeCalls).toEqual([{ known: null, bpm: 120, playing: false, worker: true }, { known: null, bpm: 100, playing: false, worker: true }])
    await waitFor(() => expect(saved().map((s) => s.grid?.source)).toEqual(['click', 'click']))
    // A segunda, ao ficar ativa, não lê de novo.
    act(() => { hook.result.current.jumpToSong(1) })
    await wait(80)
    expect(mem.analyzeCalls).toHaveLength(2)
  })

  it('click de tom puro é lido: a procura do som olha todas as amostras (pular caía nos zeros da onda)', async () => {
    // 3 kHz a 48 kHz: a onda dá uma volta a cada 16 amostras e cada click começa num múltiplo de 16.
    const x = new Float32Array(20 * SR)
    for (let k = 0; k * 0.5 < 19.5; k++) {
      const s0 = Math.round(k * 0.5 * SR)
      for (let j = 0; j < 0.02 * SR; j++) x[s0 + j] = (k % 4 === 0 ? 0.8 : 0.4) * Math.sin((2 * Math.PI * 3000 * j) / SR)
    }
    mem.buffers.set('tom3k', x)
    const hook = await openApp()
    await load(hook, [['CLICK.wav', 'tom3k']], { bpm: 120 })
    await settled(hook)
    expect(mem.analyzeCalls).toHaveLength(1)
    expect(hook.result.current.songGrid).toMatchObject({ source: 'click', signature: '4/4' })
  })

  it('com dois canais de Click, usa o primeiro que dá grade', async () => {
    const hook = await openApp()
    await load(hook, [['Click - No Drums.wav', 'tom'], ['CLICK.wav', 'click44']], { bpm: 120 })
    await settled(hook)
    expect(hook.result.current.songGrid).toMatchObject({ signature: '4/4', source: 'click', meterSource: 'acento' })
    expect(hook.result.current.songGrid!.bpm).toBeCloseTo(120, 2)
  })

  it('click do Metrônomo inserido depois: a grade é lida dele, voltando o ataque da amostra (Percussive)', async () => {
    const hook = await openApp()
    await load(hook, [['DRUMS.wav', 'bateria']], { bpm: 120 })
    await settled(hook)
    expect(hook.result.current.gridWarning).toBe('sem-click-lido')

    // O "Inserir click" do Metrônomo grava "Click_IA_<bpm>bpm.wav" e entra pelo addChannelToActiveSong.
    await act(async () => { await hook.result.current.addChannelToActiveSong(new File(['percussive'], 'Click_IA_120bpm.wav', { type: 'audio/wav' })) })
    await settled(hook)
    const grid = hook.result.current.songGrid!
    expect(grid).toMatchObject({ signature: '4/4', source: 'click', meterSource: 'acento' })
    // O 1 que a banda ouve é 0,87 s. Sem voltar o ataque (4,4 ms) o leitor dava 5,4 ms depois;
    // com ele, sobra o jeito da amostra soar (medido: +0,98 ms).
    expect(Math.abs(grid.firstDownbeat - 0.87)).toBeLessThan(0.0012)
    expect(saved()[0].grid).toEqual(grid)

    // O mesmo WAV com nome de click comum (sem saber que o app gerou): o 1 fica 5,4 ms depois.
    await load(hook, [['CLICK.wav', 'percussive']], { name: 'Click comum', bpm: 120 })
    act(() => { hook.result.current.jumpToSong(1) })
    await waitFor(() => expect(hook.result.current.playlist[1].grid?.source).toBe('click'), { timeout: 5000 })
    expect(hook.result.current.songGrid!.firstDownbeat - 0.87).toBeGreaterThan(0.004)
  })

  it('música carregada com a VS tocando: a leitura espera a parada', async () => {
    const hook = await openApp()
    await load(hook, [['DRUMS.wav', 'bateria']], { bpm: 120 })
    await act(async () => { await hook.result.current.play() })
    expect(hook.result.current.isPlaying).toBe(true)
    await load(hook, [['CLICK.wav', 'click44']], { name: 'Próxima', bpm: 120 })
    await wait(120)
    expect(mem.analyzeCalls).toHaveLength(0)

    act(() => { hook.result.current.pause() })
    await waitFor(() => expect(hook.result.current.playlist[1].grid?.source).toBe('click'), { timeout: 5000 })
    expect(mem.analyzeCalls).toEqual([{ known: null, bpm: 120, playing: false, worker: true }])
  })
})

describe('click que falta (planos pagos)', () => {
  it('sem click, com autoClick e plano ok: gera "Click gerado" e a grade é a do click gerado', async () => {
    mem.opts = { autoClick: true, stageMode: 'novo' }
    mem.plan = okPlan()
    const hook = await openApp()
    await load(hook, [['DRUMS.wav', 'bateria'], ['BASS.wav', 'bateria']], { bpm: 120, timeSignature: '4/4' })
    await settled(hook)

    const song = hook.result.current.playlist[0]
    expect(mem.planCalls).toEqual([{ ids: expect.any(Array), opts: { songBpm: 120, signature: '4/4' }, worker: true }])
    expect(mem.planCalls[0].ids).toHaveLength(2)
    // O WAV do tamanho da música, no click escolhido na biblioteca.
    expect(mem.renderCalls).toEqual([[mem.plan, 20, { type: 'Percussive', subdivision: 'quarter' }]])
    const gerado = song.channels.find((c) => c.name === 'Click gerado')!
    expect(gerado).toBeDefined()
    expect(resolveChannelRole(gerado)).toBe('click')
    expect(mem.db.get(`mt_files_u1:ch:${gerado.id}`)).toBeInstanceOf(File)
    expect(saved()[0].channels.map((c) => c.name)).toContain('Click gerado')
    // A grade é a do plano em que o click foi gerado (o gerador põe o início audível de cada
    // click nela, já compensando o ataque da amostra): 120 pulsos, o 1 em 0,37 + 0,5 s.
    expect(hook.result.current.songGrid).toMatchObject({ bpm: 120, signature: '4/4', countEvery: 1, source: 'click', meterSource: 'salvo' })
    expect(hook.result.current.songGrid!.firstDownbeat).toBeCloseTo(0.87, 9)
    expect(hook.result.current.gridWarning).toBeNull()
    expect(saved()[0].grid).toEqual(hook.result.current.songGrid)
    // O 1 do plano não pede conferência: nada de 1 assumido.
    expect(saved()[0].downbeatAssumed).toBeUndefined()
    // A grade não é lida de volta no áudio gerado, nem ao reler.
    await act(async () => { await hook.result.current.redetectSongGrid(song.id) })
    expect(mem.analyzeCalls).toHaveLength(0)
    expect(hook.result.current.songGrid).toEqual(saved()[0].grid)
  })

  it('o "Click gerado" que o usuário apagou não volta ao reabrir, nem depois de "Ler o click de novo"', async () => {
    mem.opts = { autoClick: true, stageMode: 'novo' }
    mem.plan = okPlan()
    const first = await openApp()
    await load(first, [['DRUMS.wav', 'bateria'], ['BASS.wav', 'bateria']], { bpm: 120, timeSignature: '4/4' })
    await settled(first)
    const songId = first.result.current.playlist[0].id
    const gerado = first.result.current.playlist[0].channels.find((c) => c.name === 'Click gerado')!
    await act(async () => { await first.result.current.removeChannel(gerado.id) })
    // Sem click pra ler, a grade que o click deixou fica (manual vence automático).
    await act(async () => { await first.result.current.redetectSongGrid(songId) })
    await waitFor(() => expect(saved()[0].channels.map((c) => c.name)).toEqual(['DRUMS', 'BASS']))
    expect(saved()[0].grid).toMatchObject({ source: 'click', bpm: 120 })
    cleanup()

    mem.planCalls.length = 0
    mem.renderCalls.length = 0
    const hook = await openApp()
    await wait(150)
    expect(mem.planCalls).toHaveLength(0)
    expect(mem.renderCalls).toHaveLength(0)
    expect(hook.result.current.playlist[0].channels.map((c) => c.name)).toEqual(['DRUMS', 'BASS'])
    expect(hook.result.current.songGrid).toMatchObject({ source: 'click', bpm: 120 })
  })

  it('click gerado com o 1 incerto grava o 1 assumido junto da grade: o aviso fica com o compasso escolhido e ao reabrir', async () => {
    mem.opts = { autoClick: true, stageMode: 'novo' }
    // Todo bumbo-lidera é dúvida do 1 (Ruling M3-M7): gera e marca o 1 como assumido.
    mem.plan = okPlan({ downbeatFrom: 'bumbo-lidera', downbeatMargin: 5 })
    const first = await openApp()
    await load(first, [['DRUMS.wav', 'bateria'], ['BASS.wav', 'bateria']], { bpm: 120, timeSignature: '4/4' })
    await settled(first)
    expect(first.result.current.playlist[0].channels.map((c) => c.name)).toContain('Click gerado')
    await waitFor(() => expect(saved()[0].downbeatAssumed).toBe(true))
    expect(saved()[0].grid).toMatchObject({ source: 'click', bpm: 120 })

    // Escolher o compasso troca o meterSource pra 'manual', mas não prova o 1: o aviso fica.
    act(() => { first.result.current.setSongMeter(first.result.current.playlist[0].id, '4/4', 1) })
    expect(first.result.current.songGrid?.meterSource).toBe('manual')
    expect(first.result.current.gridWarning).toBe('compasso-assumido')
    await waitFor(() => expect(saved()[0].grid?.meterSource).toBe('manual'))
    expect(saved()[0].downbeatAssumed).toBe(true)
    cleanup()

    const hook = await openApp()
    await wait(80)
    expect(hook.result.current.songGrid).toMatchObject({ source: 'click', meterSource: 'manual' })
    expect(hook.result.current.gridWarning).toBe('compasso-assumido')
  })

  it('sem click, com autoClick e confiança baixa: não gera nada', async () => {
    mem.opts = { autoClick: true, stageMode: 'novo' }
    mem.plan = { ok: false, reason: 'confianca-baixa', label: 'Bateria' }
    const hook = await openApp()
    await load(hook, [['DRUMS.wav', 'bateria'], ['BASS.wav', 'bateria']], { bpm: 120 })
    await settled(hook)

    expect(mem.planCalls).toHaveLength(1)
    expect(mem.renderCalls).toHaveLength(0)
    expect(hook.result.current.playlist[0].channels.map((c) => c.name)).toEqual(['DRUMS', 'BASS'])
    expect(hook.result.current.gridWarning).toBe('sem-click-lido')
  })

  it('pode estar no contratempo: não gera; 1 incerto (bumbo-lidera): gera e avisa COMPASSO ASSUMIDO', async () => {
    mem.opts = { autoClick: true, stageMode: 'novo' }
    mem.plan = okPlan({ offbeatRisk: true })
    const hook = await openApp()
    await load(hook, [['DRUMS.wav', 'bateria']], { bpm: 120, timeSignature: '4/4' })
    await settled(hook)
    expect(mem.planCalls).toHaveLength(1)
    expect(mem.renderCalls).toHaveLength(0)

    // Todo bumbo-lidera conta como dúvida, com qualquer folga (Ruling M3-M7).
    mem.plan = okPlan({ downbeatFrom: 'bumbo-lidera', downbeatMargin: 5 })
    await load(hook, [['DRUMS.wav', 'bateria']], { name: 'Bumbo', bpm: 120, timeSignature: '4/4' })
    act(() => { hook.result.current.jumpToSong(1) })
    await waitFor(() => expect(hook.result.current.playlist[1].grid?.source).toBe('click'), { timeout: 5000 })
    expect(mem.renderCalls).toHaveLength(1)
    expect(hook.result.current.songGrid).toMatchObject({ bpm: 120, signature: '4/4', source: 'click' })
    expect(hook.result.current.gridWarning).toBe('compasso-assumido')
  })

  it('música salva sem click gera só quando fica ativa parada, nunca tocando', async () => {
    mem.opts = { autoClick: true, stageMode: 'novo' }
    mem.plan = okPlan()
    seedSongs([savedNoClick('s1'), savedNoClick('s2')])
    const hook = await openApp()
    // A primeira já abre ativa com a VS parada.
    await waitFor(() => expect(hook.result.current.playlist[0].channels.some((c) => c.name === 'Click gerado')).toBe(true), { timeout: 5000 })
    await settled(hook)
    expect(mem.planCalls.map((c) => c.ids)).toEqual([['s1-d', 's1-b']])

    // Tocando, a outra fica ativa: não gera, nem depois de parar.
    await act(async () => { await hook.result.current.play() })
    act(() => { hook.result.current.jumpToSong(1) })
    await wait(120)
    expect(hook.result.current.isPlaying).toBe(true)
    act(() => { hook.result.current.pause() })
    await wait(120)
    expect(mem.planCalls).toHaveLength(1)
    expect(hook.result.current.playlist[1].channels.map((c) => c.name)).toEqual(['DRUMS', 'BASS'])

    // Parada, ela fica ativa de novo: agora gera.
    act(() => { hook.result.current.jumpToSong(0) })
    act(() => { hook.result.current.jumpToSong(1) })
    await waitFor(() => expect(hook.result.current.playlist[1].channels.some((c) => c.name === 'Click gerado')).toBe(true), { timeout: 5000 })
    await settled(hook)
    expect(mem.planCalls.map((c) => c.ids)).toEqual([['s1-d', 's1-b'], ['s2-d', 's2-b']])
  })
})

describe('click gerado nunca no PA (Ruling X1-critical)', () => {
  const SPLIT = { mode: 'split2', earOnSecond: false, multi: { vsPair: 0, click: 2, guide: 3 } }
  const STEREO = { ...SPLIT, mode: 'stereo' }
  const geradoOf = (hook: Hook, i = 0) => hook.result.current.playlist[i].channels.find((c) => c.name === 'Click gerado')
  const savedGerado = (i = 0) => saved()[i].channels.find((c) => c.name === 'Click gerado')
  // Fader -> corte do papel (o único lugar em que ele liga), pra conferir o fundo do corte.
  const cutOf = (fader: unknown) => {
    const out = asFake(fader as AudioNode).connections
    expect(out).toHaveLength(1)
    return out[0].to as unknown as { gain: AudioParam }
  }

  it('palco antigo: o motor não gera o click sozinho, nem ao carregar nem ao ficar ativa', async () => {
    mem.opts = { autoClick: true, stageMode: 'antigo' }
    mem.plan = okPlan()
    seedSongs([savedNoClick('s1')])
    const hook = await openApp()
    await wait(150)
    await load(hook, [['DRUMS.wav', 'bateria'], ['BASS.wav', 'bateria']], { name: 'Nova', bpm: 120, timeSignature: '4/4' })
    act(() => { hook.result.current.jumpToSong(1) })
    await wait(150)
    expect(mem.planCalls).toHaveLength(0)
    expect(mem.renderCalls).toHaveLength(0)
    expect(hook.result.current.playlist.flatMap((s) => s.channels).map((c) => c.name)).not.toContain('Click gerado')
    // Sem stageMode (o padrão do hook) é o palco antigo também.
    cleanup()
    mem.opts = { autoClick: true }
    const plain = await openApp()
    await load(plain, [['DRUMS.wav', 'bateria']], { name: 'Outra', bpm: 120 })
    await wait(150)
    expect(mem.planCalls).toHaveLength(0)
  })

  it.each([
    ['Tudo junto', STEREO, false, 2],
    ['Tudo junto com o pan automático', STEREO, true, 2],
    ['saída de 1 canal (Click e Guia separados escolhido)', SPLIT, false, 1],
  ] as const)('palco novo em %s: não gera (o click iria pro PA)', async (_name, outputs, autoPan, channels) => {
    mem.opts = { autoClick: true, stageMode: 'novo' }
    mem.plan = okPlan()
    mem.settings = { ...mem.settings, outputs, autoPan }
    mem.ctxOpts = { maxChannelCount: channels }
    const hook = await openApp()
    await load(hook, [['DRUMS.wav', 'bateria'], ['BASS.wav', 'bateria']], { bpm: 120, timeSignature: '4/4' })
    await wait(150)
    expect(mem.planCalls).toHaveLength(0)
    expect(geradoOf(hook)).toBeUndefined()
    expect(hook.result.current.gridWarning).toBe('sem-click-lido')
  })

  it('a saída vira Tudo junto depois: o "Click gerado" fica mudo, gravado; o operador pode ligar de novo', async () => {
    mem.opts = { autoClick: true, stageMode: 'novo' }
    mem.plan = okPlan()
    mem.settings = { ...mem.settings, outputs: SPLIT }
    const hook = await openApp()
    await load(hook, [['DRUMS.wav', 'bateria'], ['BASS.wav', 'bateria']], { bpm: 120, timeSignature: '4/4' })
    await settled(hook)
    expect(geradoOf(hook)!.muted).toBe(false)

    mem.settings = { ...mem.settings, outputs: STEREO }
    await act(async () => { hook.rerender() })
    expect(geradoOf(hook)!.muted).toBe(true)
    const ctx = mem.ctx as FakeAudioContext
    expect(valueAt(asFake(geradoOf(hook)!.gainNode).gain, ctx.currentTime + 1)).toBe(0)
    await waitFor(() => expect(savedGerado()!.muted).toBe(true))
    // O M é do operador: ligado de novo à mão, fica (a saída não mudou).
    act(() => { hook.result.current.toggleMute(geradoOf(hook)!.id) })
    expect(geradoOf(hook)!.muted).toBe(false)
    await act(async () => { hook.rerender() })
    expect(geradoOf(hook)!.muted).toBe(false)
  })

  it('tocando, a troca pra Tudo junto deixa o "Click gerado" mudo no fundo do corte, junto com a rota', async () => {
    mem.opts = { autoClick: true, stageMode: 'novo' }
    mem.plan = okPlan()
    mem.settings = { ...mem.settings, outputs: SPLIT }
    const hook = await openApp()
    await load(hook, [['DRUMS.wav', 'bateria'], ['BASS.wav', 'bateria']], { bpm: 120, timeSignature: '4/4' })
    await settled(hook)
    const ctx = mem.ctx as FakeAudioContext
    await act(async () => { await hook.result.current.play() })
    ctx.currentTime = 1
    mem.settings = { ...mem.settings, outputs: STEREO }
    await act(async () => { hook.rerender() })
    // Ainda no Click até o fundo do corte.
    expect(geradoOf(hook)!.muted).toBe(false)
    const timer = setInterval(() => { ctx.currentTime += 0.001 }, 1)
    try { await wait(80) } finally { clearInterval(timer) }
    const g = geradoOf(hook)!
    expect(g.muted).toBe(true)
    const off = asFake(g.gainNode).gain.events.filter((e) => e.kind === 'set' && e.value === 0)
    expect(off).toHaveLength(1)
    // O ganho do click gerado vai a 0 com os barramentos no fundo do corte (nenhum instante com ele na VS e som).
    const drums = hook.result.current.playlist[0].channels.find((c) => c.name === 'DRUMS')!
    expect(valueAt(cutOf(drums.gainNode).gain, off[0].time)).toBe(0)
    act(() => { hook.result.current.pause() })
  })

  it('abrir com o "Click gerado" de antes e a saída em Tudo junto: abre mudo e fica gravado; em separados fica como está', async () => {
    const grid = { bpm: 120, firstDownbeat: 0.87, signature: '4/4' as const, countEvery: 1 as const, source: 'click' as const, meterSource: 'salvo' as const }
    const withGenerated = (id: string): SavedSong => ({ ...savedNoClick(id), grid, channels: [...savedNoClick(id).channels, ch(`${id}-g`, 'Click gerado')] })
    mem.opts = { autoClick: true, stageMode: 'antigo' }
    mem.settings = { ...mem.settings, outputs: STEREO }
    seedSongs([withGenerated('s1'), withGenerated('s2')])
    const hook = await openApp()
    expect(geradoOf(hook, 0)!.muted).toBe(true)
    expect(geradoOf(hook, 1)!.muted).toBe(true)
    expect(geradoOf(hook, 0)!.gainNode.gain.value).toBe(0)
    expect([savedGerado(0)!.muted, savedGerado(1)!.muted]).toEqual([true, true])
    cleanup()

    mem.settings = { ...mem.settings, outputs: SPLIT }
    seedSongs([withGenerated('s3')])
    const split = await openApp()
    expect(geradoOf(split)!.muted).toBe(false)
    expect(geradoOf(split)!.gainNode.gain.value).toBe(1)
  })

  it('click do usuário que nunca deu grade, apagado: o click gerado não aparece no lugar, nem ao reabrir', async () => {
    mem.opts = { autoClick: true, stageMode: 'novo' }
    mem.plan = okPlan()
    const withClick: SavedSong = { ...savedNoClick('s1'), channels: [...savedNoClick('s1').channels, ch('s1-c', 'CLICK')] }
    seedSongs([withClick], (id) => (id === 's1-c' ? 'tom' : 'bateria'))
    const first = await openApp()
    await settled(first)
    // O tom contínuo não dá grade: sem grade de click salva.
    expect(saved()[0].grid).toBeUndefined()
    await act(async () => { await first.result.current.removeChannel('s1-c') })
    await waitFor(() => expect(saved()[0].channels.map((c) => c.name)).toEqual(['DRUMS', 'BASS']))
    expect(saved()[0].clickRemoved).toBe(true)
    cleanup()

    mem.planCalls.length = 0
    mem.renderCalls.length = 0
    const hook = await openApp()
    await wait(200)
    expect(mem.planCalls).toHaveLength(0)
    expect(mem.renderCalls).toHaveLength(0)
    expect(hook.result.current.playlist[0].channels.map((c) => c.name)).toEqual(['DRUMS', 'BASS'])
    expect(hook.result.current.playlist[0].clickRemoved).toBe(true)
  })
})

describe('Worker da grade (Ruling T27-worker)', () => {
  const ctxOf = () => mem.ctx as FakeAudioContext
  // Instante comum do play: 2 blocos de 128 amostras depois do relógio, na grade de blocos.
  const startAt = (now: number) => (Math.floor(now / (128 / SR) + 1e-6) + 2) * (128 / SR)

  it('a leitura roda no Worker, com uma cópia do canal transferida; nada é lido na thread principal', async () => {
    const hook = await openApp()
    await load(hook, [['CLICK.wav', 'click44'], ['BASS.wav', 'bateria']], { bpm: 120 })
    await settled(hook)
    expect(hook.result.current.songGrid).toMatchObject({ signature: '4/4', source: 'click' })
    expect(mem.analyzeCalls).toEqual([{ known: null, bpm: 120, playing: false, worker: true }])
    expect(mem.workers).toHaveLength(1)
    const [{ req, transfer }] = mem.requests
    if (req.kind !== 'click') throw new Error(`pedido ${req.kind}`)
    // Cópia: o canal que toca continua com as amostras dele (a cópia é que foi transferida).
    const click = hook.result.current.playlist[0].channels.find((c) => c.name === 'CLICK')!
    const original = click.buffer.getChannelData(0)
    // (comparação por identidade sem o not.toBe, que compara os 960 mil números pra montar a mensagem)
    expect(req.samples === original).toBe(false)
    expect(req.samples.buffer === original.buffer).toBe(false)
    expect(req.samples.length).toBe(original.length)
    expect(req.samples.findIndex((v, i) => v !== original[i])).toBe(-1)
    expect(transfer).toHaveLength(1)
    expect(transfer[0]).toBe(req.samples.buffer)
  })

  it('play pedido durante uma leitura começa sem esperar por ela', async () => {
    let release!: () => void
    mem.workerGate = new Promise<void>((resolve) => { release = resolve })
    const hook = await openApp()
    await load(hook, [['CLICK.wav', 'click44'], ['BASS.wav', 'bateria']], { bpm: 120 })
    // A leitura já foi pro Worker e ainda não voltou.
    await waitFor(() => expect(mem.requests).toHaveLength(1), { timeout: 5000 })
    expect(hook.result.current.isReadingGrid).toBe(true)

    // Relógio do áudio parado em 2 s: o play agenda as vozes no instante comum de sempre.
    ctxOf().currentTime = 2
    await act(async () => { await hook.result.current.play() })
    expect(hook.result.current.isPlaying).toBe(true)
    const sources = nodesOf(ctxOf(), 'AudioBufferSourceNode')
    expect(sources).toHaveLength(2)
    for (const s of sources) expect(s.starts[0].when).toBeCloseTo(startAt(2), 9)
    expect(mem.analyzeCalls).toHaveLength(0)

    // A leitura termina no Worker com a VS tocando e a grade entra (aplicar é barato).
    release()
    await waitFor(() => expect(hook.result.current.songGrid?.source).toBe('click'), { timeout: 5000 })
    expect(mem.analyzeCalls).toEqual([{ known: null, bpm: 120, playing: true, worker: true }])
    expect(hook.result.current.isPlaying).toBe(true)
    act(() => { hook.result.current.pause() })
  })

  it('sem Worker no navegador: a grade não é lida sozinha nem a pedido, e nada roda na thread principal', async () => {
    vi.stubGlobal('Worker', undefined)
    const hook = await openApp()
    await load(hook, [['CLICK.wav', 'click44'], ['BASS.wav', 'bateria']], { bpm: 90 })
    await wait(120)
    expect(hook.result.current.isReadingGrid).toBe(false)
    expect(mem.analyzeCalls).toHaveLength(0)
    // Fica a grade do BPM salvo, com o aviso.
    expect(hook.result.current.songGrid).toMatchObject({ bpm: 90, source: 'bpm' })
    expect(hook.result.current.gridWarning).toBe('sem-click-lido')
    await act(async () => { await hook.result.current.redetectSongGrid(hook.result.current.playlist[0].id) })
    expect(mem.analyzeCalls).toHaveLength(0)
  })

  it('Worker que não nasce ou quebra no meio: a leitura para de vez, sem cair na thread principal', async () => {
    mem.workerMode = 'nao-nasce'
    const hook = await openApp()
    await load(hook, [['CLICK.wav', 'click44']], { bpm: 120 })
    await settled(hook)
    expect(error).toHaveBeenCalledTimes(1)
    error.mockClear()
    // Não tenta de novo: a próxima música também fica sem leitura, sem outro erro.
    await load(hook, [['CLICK.wav', 'click34']], { name: 'Outra', bpm: 100 })
    await wait(120)
    expect(mem.analyzeCalls).toHaveLength(0)
    expect(hook.result.current.playlist.map((s) => s.grid)).toEqual([undefined, undefined])
    cleanup()

    // Nasce e quebra na primeira leitura: aquela desiste, a grade não muda e não nasce outro.
    mem.workerMode = 'quebra'
    const again = await openApp()
    await waitFor(() => expect(error).toHaveBeenCalledTimes(1), { timeout: 5000 })
    error.mockClear()
    await settled(again)
    await load(again, [['CLICK.wav', 'click44']], { name: 'Terceira', bpm: 120 })
    await wait(120)
    expect(mem.workers).toHaveLength(1)
    expect(mem.analyzeCalls).toHaveLength(0)
    expect(again.result.current.playlist.every((s) => s.grid === undefined)).toBe(true)
  })

  it('click que falta: só as faixas do tempo vão pro Worker, e o plano que volta com a VS tocando só vira click na parada', async () => {
    mem.opts = { autoClick: true, stageMode: 'novo' }
    mem.plan = okPlan()
    let release!: () => void
    mem.workerGate = new Promise<void>((resolve) => { release = resolve })
    const hook = await openApp()
    await load(hook, [['DRUMS.wav', 'bateria'], ['BASS.wav', 'bateria'], ['VOX.wav', 'bateria']], { bpm: 120, timeSignature: '4/4' })
    await waitFor(() => expect(mem.requests).toHaveLength(1), { timeout: 5000 })
    const { req, transfer } = mem.requests[0]
    if (req.kind !== 'plano') throw new Error(`pedido ${req.kind}`)
    const names = (ids: string[]) => ids.map((id) => hook.result.current.playlist[0].channels.find((c) => c.id === id)!.name)
    expect(names(req.channels.map((c) => c.id))).toEqual(['DRUMS', 'BASS'])
    const sentBuffers = req.channels.flatMap((c) => c.data.map((d) => d.buffer))
    expect(transfer).toHaveLength(sentBuffers.length)
    transfer.forEach((t, i) => expect(t).toBe(sentBuffers[i]))

    // Toca antes de o plano voltar: o click não é feito tocando.
    await act(async () => { await hook.result.current.play() })
    release()
    await waitFor(() => expect(mem.planCalls).toHaveLength(1), { timeout: 5000 })
    expect(mem.planCalls[0].worker).toBe(true)
    await wait(120)
    expect(mem.renderCalls).toHaveLength(0)
    expect(hook.result.current.isReadingGrid).toBe(true)

    // Parou: o click sai do plano guardado, sem pedir outro ao Worker.
    act(() => { hook.result.current.pause() })
    await settled(hook)
    expect(mem.renderCalls).toHaveLength(1)
    expect(mem.planCalls).toHaveLength(1)
    expect(hook.result.current.playlist[0].channels.some((c) => c.name === 'Click gerado')).toBe(true)
    expect(hook.result.current.songGrid).toMatchObject({ bpm: 120, source: 'click', meterSource: 'salvo' })
  })
})

describe('montagem do click gerado (Ruling T27-gerador)', () => {
  const ctxOf = () => mem.ctx as FakeAudioContext
  const startAt = (now: number) => (Math.floor(now / (128 / SR) + 1e-6) + 2) * (128 / SR)

  it('play pedido no meio da montagem do WAV começa na hora, e o click entra depois, tocando', async () => {
    mem.opts = { autoClick: true, stageMode: 'novo' }
    mem.plan = okPlan()
    mem.realRender = true
    // Gerador de verdade, com a amostra Percussive (semínima) de public/ e os calços do teste da M6.
    const shims = makeClickShims(lerPublic)
    class SampleCtx extends shims.AudioContext {
      async decodeAudioData(ab: ArrayBuffer) {
        const decoded = await super.decodeAudioData(ab)
        mem.renderDecoded = true
        return decoded
      }
    }
    mem.clickCtx = SampleCtx
    mem.clickBlob = shims.lastBlob
    vi.stubGlobal('fetch', shims.fetch)
    const urls = { create: URL.createObjectURL, revoke: URL.revokeObjectURL }
    URL.createObjectURL = shims.createObjectURL
    URL.revokeObjectURL = shims.revokeObjectURL
    try {
      const hook = await openApp()
      await load(hook, [['DRUMS.wav', 'longo']], { bpm: 120, timeSignature: '4/4' })
      // A amostra já foi lida e o WAV de 5 min ainda está sendo montado (o gerador cede a vez).
      await waitFor(() => expect(mem.renderDecoded && !mem.renderFinished).toBe(true), { timeout: 10000 })

      // Relógio do áudio em 3 s: o play agenda as vozes no instante comum de sempre, sem esperar.
      ctxOf().currentTime = 3
      await act(async () => { await hook.result.current.play() })
      expect(hook.result.current.isPlaying).toBe(true)
      const sources = nodesOf(ctxOf(), 'AudioBufferSourceNode')
      expect(sources).toHaveLength(1)
      expect(sources[0].starts[0].when).toBeCloseTo(startAt(3), 9)
      expect(mem.renderFinished).toBe(false)

      // A montagem termina e o "Click gerado" entra na música que toca.
      await waitFor(() => expect(hook.result.current.playlist[0].channels.some((c) => c.name === 'Click gerado')).toBe(true), { timeout: 20000 })
      expect(mem.renderFinished).toBe(true)
      expect(hook.result.current.isPlaying).toBe(true)
      act(() => { hook.result.current.pause() })
    } finally {
      URL.createObjectURL = urls.create
      URL.revokeObjectURL = urls.revoke
    }
  }, 40_000)
})

describe('pré-contagem', () => {
  it('pré-contagem usa o pulso da grade', async () => {
    const hook = await openApp()
    // BPM salvo 90, mas o click está a 120: a contagem vai no pulso lido.
    await load(hook, [['CLICK.wav', 'click44'], ['BASS.wav', 'bateria']], { bpm: 90 })
    await settled(hook)
    expect(hook.result.current.songGrid!.bpm).toBeCloseTo(120, 2)
    act(() => { hook.result.current.setPrecountBeats(4) })
    await act(async () => { await hook.result.current.play({ precount: true }) })
    const times = hook.result.current.precountTimes
    expect(times).toHaveLength(4)
    for (let k = 1; k < times.length; k++) expect(times[k] - times[k - 1]).toBeCloseTo(0.5, 2)
    act(() => { hook.result.current.pause() })

    // 6/8 só com o BPM salvo (60 na semínima): conta de 3 em 3 colcheias, a pontuada (1,5 s), como o pulo.
    await load(hook, [['BASS.wav', 'bateria']], { name: '6/8', bpm: 60, timeSignature: '6/8' })
    act(() => { hook.result.current.jumpToSong(1) })
    expect(hook.result.current.songGrid).toMatchObject({ bpm: 120, signature: '6/8', countEvery: 3, source: 'bpm' })
    await act(async () => { await hook.result.current.play({ precount: true }) })
    const compound = hook.result.current.precountTimes
    expect(compound).toHaveLength(4)
    for (let k = 1; k < compound.length; k++) expect(compound[k] - compound[k - 1]).toBeCloseTo(1.5, 2)
    act(() => { hook.result.current.pause() })
  })
})

// Painel SEPARAÇÃO no lugar do click do motor (Parte 3, revisão macro sep-1).
describe('click do painel SEPARAÇÃO', () => {
  const panelClick = (content: string) => new File([content], 'Metrônomo.wav', { type: 'audio/wav' })

  it('sep-1 I2: Gerar click do painel enquanto o motor grava o "Click gerado" deixa um click só', async () => {
    mem.opts = { autoClick: true, stageMode: 'novo' }
    mem.plan = okPlan()
    let releaseGen!: () => void
    mem.genGate = new Promise<void>((r) => { releaseGen = r })
    const hook = await openApp()
    await load(hook, [['DRUMS.wav', 'bateria'], ['BASS.wav', 'bateria']], { bpm: 120, timeSignature: '4/4' })
    await waitFor(() => expect(mem.renderCalls).toHaveLength(1), { timeout: 5000 })
    await wait(50)
    const id = hook.result.current.playlist[0].id
    await act(async () => { await hook.result.current.replaceAppChannel(id, ['Click gerado', 'Metrônomo'], panelClick('click44')) })
    await act(async () => { releaseGen() })
    await settled(hook)
    await wait(200)
    const clicks = (names: string[]) => names.filter((n) => n === 'Click gerado' || n === 'Metrônomo')
    expect(clicks(hook.result.current.playlist[0].channels.map((c) => c.name))).toEqual(['Metrônomo'])
    expect(clicks(saved()[0].channels.map((c) => c.name))).toEqual(['Metrônomo'])
    // O "Click gerado" que não entrou não fica no disco.
    const stems = [...mem.db.keys()].filter((k) => k.startsWith('mt_files_u1:ch:'))
    expect(stems).toHaveLength(saved()[0].channels.length)
  })
})

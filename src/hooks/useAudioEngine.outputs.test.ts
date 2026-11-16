// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'
import { act, cleanup, renderHook } from '@testing-library/react'
import {
  asFake, connectedTo, createFakeAudioContext, FakeAudioBuffer, FakeAudioNode, nodesOf, reaches, valueAt,
  type FakeAudioContext, type FakeAudioContextOptions, type FakeGainNode,
} from '../test/fakeAudio'
import { measure, type Sig } from '../test/signalMeasure'
import type { SavedSong } from '../lib/repertoireSchema'
import type { OutputSettings } from '../lib/stageContracts'
import JSZip from 'jszip'
import { useAudioEngine } from './useAudioEngine'

// T25: o motor liga o fader de cada canal no barramento do papel (grafo da T12), põe o pan
// efetivo no panner, zera uma vez os pans do pan automático antigo, refaz o plano na troca de
// aparelho e manda a pré-contagem pelo barramento do Click. O hook roda de verdade com o
// AudioContext falso da T1 e o IndexedDB em memória; o nível sai do simulador linear da T12
// (src/test/signalMeasure.ts) comparado com o grafo da v1.4.16 montado do mesmo jeito.

const SR = 48000
const mem = vi.hoisted(() => ({
  db: new Map<string, unknown>(),
  settings: {} as Record<string, unknown>,
  updates: [] as [string, unknown][],
  ctx: null as unknown,
  ctxOpts: {} as Record<string, unknown>,
  metaGate: null as Promise<void> | null,
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
// Worklet de tom pelo nó rastreado do fake (Ruling T1-N3); nenhum teste aqui transpõe.
vi.mock('signalsmith-stretch', async () => {
  const { FakeWorkletNode } = await import('../test/fakeAudio')
  return {
    default: async (ctx: BaseAudioContext) => Object.assign(new FakeWorkletNode(ctx, 'signalsmith-stretch'), {
      start: async () => {}, stop: async () => {}, schedule: async () => {}, latency: async () => 0.12,
    }),
  }
})
vi.mock('../contexts/SettingsContext', () => ({
  useSettings: () => ({
    settings: mem.settings,
    updateSetting: (key: string, value: unknown) => {
      mem.updates.push([key, value])
      mem.settings = { ...mem.settings, [key]: value }
    },
  }),
}))
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
const MULTI: OutputSettings = { ...SPLIT, mode: 'multi' }

let warn: MockInstance<typeof console.warn>
let error: MockInstance<typeof console.error>
beforeEach(() => {
  localStorage.clear()
  mem.db.clear()
  mem.updates.length = 0
  mem.metaGate = null
  mem.ctx = null
  mem.ctxOpts = {}
  mem.settings = { autoPan: false, audioDeviceId: 'default', outputs: SPLIT, legacyPanReset: false }
  // O arquivo diz quantos canais o áudio tem ("stereo..." ou "mono...").
  const decode = async (data: ArrayBuffer) => new FakeAudioBuffer(new TextDecoder().decode(data).startsWith('stereo') ? 2 : 1, 4800, SR)
  vi.stubGlobal('AudioContext', function () {
    const ctx = createFakeAudioContext({ ...(mem.ctxOpts as FakeAudioContextOptions), decode })
    mem.ctx = ctx
    return ctx
  })
  vi.stubGlobal('requestAnimationFrame', () => 0)
  vi.stubGlobal('cancelAnimationFrame', () => {})
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  error = vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  // A guarda da T12 só avisa num plano malformado: aqui ela nunca pode aparecer.
  expect(warn.mock.calls.filter((c) => String(c[0]).includes('plano de saídas com erro'))).toEqual([])
  expect(error).not.toHaveBeenCalled()
  vi.restoreAllMocks()
})

const ctxOf = () => mem.ctx as FakeAudioContext
const metaKey = (uid = 'u1') => `mt_meta_playlist_${uid}`
const ch = (id: string, name: string, pan: number, extra: Partial<SavedSong['channels'][number]> = {}): SavedSong['channels'][number] =>
  ({ id, name, volume: 1, muted: false, soloed: false, pan, bus: '1/2', ...extra })
// Click e Guia mono, Baixo e Teclado estéreo (L e R diferentes).
const song = (id: string, pans: { click?: number; guide?: number; bass?: number; keys?: number } = {}): SavedSong => ({
  id, name: `Música ${id}`, duration: 0.1, pitch: 0, originalKey: 'C', schemaVersion: 3, channelOrder: 'auto',
  channels: [
    ch(`${id}-click`, 'CLICK', pans.click ?? 0), ch(`${id}-guide`, 'Voz Guia', pans.guide ?? 0),
    ch(`${id}-bass`, 'BASS_1', pans.bass ?? 0), ch(`${id}-keys`, 'KEYS', pans.keys ?? 0),
  ],
})
function seedFor(uid: string, ...songs: SavedSong[]) {
  mem.db.set(metaKey(uid), structuredClone(songs))
  for (const s of songs) for (const c of s.channels) {
    mem.db.set(`mt_files_${uid}:ch:${c.id}`, new File([/BASS|KEYS/.test(c.name) ? 'stereo' : 'mono'], `${c.name}.wav`, { type: 'audio/wav' }))
  }
}
const seed = (...songs: SavedSong[]) => seedFor('u1', ...songs)

// Abre o app como no aparelho: o render do motor pronto acontece antes de o IndexedDB
// responder (sem isso o efeito do pan automático veria o repertório já restaurado).
async function openApp(uid = 'u1') {
  const hook = renderHook(() => useAudioEngine(uid))
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
const panOf = (hook: Hook, id: string) => valueAt(asFake(chan(hook, id).pannerNode).pan, ctxOf().currentTime + 1)
const savedPans = (id: string, uid = 'u1') => (mem.db.get(metaKey(uid)) as SavedSong[]).find((s) => s.id === id)!.channels.map((c) => [c.pan, c.bus])

// Barramentos e principal da T12: os cinco primeiros GainNode que o initEngine cria (click,
// guia, VS, principal, mudo geral), conferidos pela forma do grafo. Depois deles, os três
// cortes do motor (Ruling T25-corte), um na frente de cada barramento.
function graphOf(ctx: FakeAudioContext) {
  const [click, guide, vs, master, masterMute, cutClick, cutGuide, cutVs] = nodesOf(ctx, 'GainNode')
  expect(connectedTo(masterMute, ctx.destination)).toBe(true)
  expect(connectedTo(master, masterMute)).toBe(true)
  expect(reaches(nodesOf(ctx, 'DelayNode')[0], click)).toBe(true) // a contagem da T12 entra no Click
  expect(connectedTo(guide, master)).toBe(false) // a Guia passa pelo panner do barramento
  const cut = { click: cutClick, guide: cutGuide, vs: cutVs }
  expect([connectedTo(cut.click, click), connectedTo(cut.guide, guide), connectedTo(cut.vs, vs)]).toEqual([true, true, true])
  return { click, guide, vs, master, masterMute, cut }
}
// Relógio do áudio andando (o fake não anda sozinho) enquanto uma troca com corte espera o fundo.
async function letAudioRun(ms = 40) {
  const ctx = ctxOf()
  const timer = setInterval(() => { ctx.currentTime += 0.001 }, 1)
  try { await act(async () => { await new Promise((resolve) => setTimeout(resolve, ms)) }) } finally { clearInterval(timer) }
}

// Sinal de cada canal tocando: base com 2 posições por canal (L e R do arquivo; mono usa só a 1ª).
async function playAndMeasure(hook: Hook, ids: string[]): Promise<Sig> {
  await act(async () => { await hook.result.current.play() })
  const sources = new Map<unknown, Sig>()
  for (const s of nodesOf(ctxOf(), 'AudioBufferSourceNode')) {
    if (s.connections.length === 0) continue
    const k = ids.findIndex((id) => chan(hook, id).buffer === s.buffer)
    const row = (j: number) => Array.from({ length: ids.length * 2 }, (_, x) => (k >= 0 && x === k * 2 + j ? 1 : 0))
    sources.set(s, s.buffer?.numberOfChannels === 2 ? [row(0), row(1)] : [row(0)])
  }
  ctxOf().currentTime += 1 // pans e ganhos já assentados
  return measure(ctxOf(), sources, ids.length * 2)
}

// O grafo da v1.4.16, montado no mesmo fake: fonte -> panner do canal (mono em 1 canal) ->
// fader -> principal -> destino. É a régua do nível (R-24).
function legacyMeasure(tracks: { stereo: boolean; pan: number }[]): Sig {
  const ctx = createFakeAudioContext()
  const master = ctx.createGain()
  master.connect(ctx.destination)
  const sources = new Map<unknown, Sig>()
  tracks.forEach((t, k) => {
    const src = ctx.createGain()
    const panner = ctx.createStereoPanner()
    if (!t.stereo) { panner.channelCountMode = 'explicit'; panner.channelCount = 1 }
    panner.pan.value = t.pan
    const fader = ctx.createGain()
    src.connect(panner); panner.connect(fader); fader.connect(master)
    const row = (j: number) => Array.from({ length: tracks.length * 2 }, (_, x) => (x === k * 2 + j ? 1 : 0))
    sources.set(src, t.stereo ? [row(0), row(1)] : [row(0)])
  })
  return measure(ctx, sources, tracks.length * 2)
}
const close = (got: Sig, want: Sig) => {
  expect(got.length).toBe(want.length)
  got.forEach((c, i) => c.forEach((v, k) => expect(Math.abs(v - want[i][k]), `saída ${i + 1}, base ${k}`).toBeLessThan(1e-12)))
}
// Coeficientes de um canal (base k*2, k*2+1) numa saída.
const part = (sig: Sig, output: number, k: number) => Math.hypot(sig[output][k * 2], sig[output][k * 2 + 1])

const IDS = ['s1-click', 's1-guide', 's1-bass', 's1-keys']

describe('barramento por papel', () => {
  it('canal Click liga no barramento do click e o Baixo no da VS', async () => {
    seed(song('s1'))
    const hook = await openApp()
    const bus = graphOf(ctxOf())
    expect(connectedTo(asFake(chan(hook, 's1-click').gainNode), bus.cut.click)).toBe(true)
    expect(connectedTo(asFake(chan(hook, 's1-guide').gainNode), bus.cut.guide)).toBe(true)
    expect(connectedTo(asFake(chan(hook, 's1-bass').gainNode), bus.cut.vs)).toBe(true)
    // Fader nenhum direto no principal ou no destino.
    for (const c of hook.result.current.channels) {
      expect(connectedTo(asFake(c.gainNode), bus.master)).toBe(false)
      expect(connectedTo(asFake(c.gainNode), ctxOf().destination)).toBe(false)
    }

    // Os outros lugares que criam canal: arquivo novo, canal avulso e metrônomo.
    const files = ['Click.wav', 'BASS_2.wav'].map((n) => new File([n.startsWith('BASS') ? 'stereo' : 'mono'], n, { type: 'audio/wav' }))
    await act(async () => { await hook.result.current.loadFiles(files as unknown as FileList, 'Nova') })
    await act(async () => { hook.result.current.jumpToSong(1) })
    await act(async () => { await hook.result.current.addChannelToActiveSong(new File(['mono'], 'GUIDE VOX.wav', { type: 'audio/wav' })) })
    await act(async () => { await hook.result.current.createEndlessMetronomeSong(120) })
    const byName = (name: string) => hook.result.current.playlist.flatMap((s) => s.channels).find((c) => c.name === name)!
    expect(connectedTo(asFake(byName('Click').gainNode), bus.cut.click)).toBe(true)
    expect(connectedTo(asFake(byName('BASS_2').gainNode), bus.cut.vs)).toBe(true)
    expect(connectedTo(asFake(byName('GUIDE VOX').gainNode), bus.cut.guide)).toBe(true)
    expect(connectedTo(asFake(byName('Metronomo Loop').gainNode), bus.cut.click)).toBe(true)
    expect(valueAt(asFake(byName('Metronomo Loop').pannerNode).pan, 1)).toBe(-1)
  })

  it('papel manual Guia no Baixo religa no barramento da guia sem cortar o medidor', async () => {
    seed(song('s1', { bass: 0.4 }))
    const hook = await openApp()
    const bus = graphOf(ctxOf())
    const bass = asFake(chan(hook, 's1-bass').gainNode)
    // Como o App: um AnalyserNode no gainNode do canal pro VU.
    const meter = ctxOf().createAnalyser()
    bass.connect(meter)

    await act(async () => { hook.result.current.setChannelMeta('s1-bass', { role: 'guide' }) })
    expect(connectedTo(bass, bus.cut.guide)).toBe(true)
    expect(connectedTo(bass, bus.cut.vs)).toBe(false)
    expect(connectedTo(bass, meter)).toBe(true)
    // Em separados o lado sai do papel novo; o pan gravado (0,4) não muda.
    expect(panOf(hook, 's1-bass')).toBe(-1)
    expect(chan(hook, 's1-bass').pan).toBe(0.4)

    // O som dele agora só no ouvido (saída 1).
    const sig = await playAndMeasure(hook, IDS)
    expect(part(sig, 0, 2)).toBeGreaterThan(0.5)
    expect(part(sig, 1, 2)).toBeLessThan(1e-6)

    // Tocando: a troca do papel vai num corte de 3 ms e acontece no fundo dele.
    await act(async () => { hook.result.current.setChannelMeta('s1-bass', { role: null }) })
    await letAudioRun()
    expect(connectedTo(bass, bus.cut.vs)).toBe(true)
    expect(connectedTo(bass, bus.cut.guide)).toBe(false)
    expect(connectedTo(bass, meter)).toBe(true)
    expect(panOf(hook, 's1-bass')).toBe(1)
    act(() => { hook.result.current.pause() })
  })
})

describe('pan efetivo', () => {
  it('em separados o pan efetivo é o do papel, nunca o do knob', async () => {
    seed(song('s1', { click: 0.6, guide: 0.3, bass: -1, keys: 0.2 }))
    const hook = await openApp()
    expect([panOf(hook, 's1-click'), panOf(hook, 's1-guide'), panOf(hook, 's1-bass'), panOf(hook, 's1-keys')]).toEqual([-1, -1, 1, 1])
    // O knob grava, o panner fica no lado do papel.
    await act(async () => { hook.result.current.updatePan('s1-click', 0.3) })
    expect(chan(hook, 's1-click').pan).toBe(0.3)
    expect(panOf(hook, 's1-click')).toBe(-1)

    // Mesmo nível do pan automático da v1.4.16 (Click e Guia em -1, o resto em +1), saída por saída.
    const sig = await playAndMeasure(hook, IDS)
    close(sig, legacyMeasure([{ stereo: false, pan: -1 }, { stereo: false, pan: -1 }, { stereo: true, pan: 1 }, { stereo: true, pan: 1 }]))
    act(() => { hook.result.current.pause() })

    // Lado trocado: Click e Guia na saída 2, a VS na 1.
    mem.settings = { ...mem.settings, outputs: { ...SPLIT, earOnSecond: true } }
    await act(async () => { hook.rerender() })
    expect([panOf(hook, 's1-click'), panOf(hook, 's1-guide'), panOf(hook, 's1-bass'), panOf(hook, 's1-keys')]).toEqual([1, 1, -1, -1])
    const swapped = await playAndMeasure(hook, IDS)
    for (const k of [0, 1]) { expect(part(swapped, 1, k)).toBeCloseTo(1, 12); expect(part(swapped, 0, k)).toBeLessThan(1e-6) }
    for (const k of [2, 3]) { expect(part(swapped, 0, k)).toBeCloseTo(Math.SQRT2, 12); expect(part(swapped, 1, k)).toBeLessThan(1e-6) }
    expect(nodesOf(ctxOf(), 'AudioWorkletNode')).toHaveLength(0)
  })

  it('em tudo junto vale o knob', async () => {
    localStorage.setItem('mt_legacy_pans_reset:u1', '1') // conta já passou pelo reset dos ±1 antigos
    mem.settings = { ...mem.settings, outputs: STEREO }
    seed(song('s1', { click: 0.6, guide: 0, bass: -1, keys: 0.2 }))
    const hook = await openApp()
    expect([panOf(hook, 's1-click'), panOf(hook, 's1-guide'), panOf(hook, 's1-bass'), panOf(hook, 's1-keys')]).toEqual([0.6, 0, -1, 0.2])
    await act(async () => { hook.result.current.updatePan('s1-bass', 0.25) })
    ctxOf().currentTime += 2 // a rampa curta do knob (constante 0,05 s) já chegou
    expect(panOf(hook, 's1-bass')).toBeCloseTo(0.25, 12)
    const sig = await playAndMeasure(hook, IDS)
    close(sig, legacyMeasure([{ stereo: false, pan: 0.6 }, { stereo: false, pan: 0 }, { stereo: true, pan: 0.25 }, { stereo: true, pan: 0.2 }]))
  })

  it('migração: pans ±1 gravados voltam a 0 uma vez por conta', async () => {
    mem.settings = { ...mem.settings, legacyPanReset: true }
    seed(song('s1', { click: -1, guide: -1, bass: 1, keys: 0.3 }), song('s2', { click: -1, bass: 1 }))
    const hook = await openApp()
    expect(hook.result.current.channels.map((c) => c.pan)).toEqual([0, 0, 0, 0.3])
    // Gravado já, nas duas músicas, e a aba Buses volta pro centro junto.
    expect(savedPans('s1')).toEqual([[0, '1/2'], [0, '1/2'], [0, '1/2'], [0.3, '1/2']])
    expect(savedPans('s2')).toEqual([[0, '1/2'], [0, '1/2'], [0, '1/2'], [0, '1/2']])
    // O pedido do aparelho fica (vale pra outras contas); a conta ganha a marca dela.
    expect(mem.updates).toEqual([])
    expect(localStorage.getItem('mt_legacy_pans_reset:u1')).toBe('1')
    // Os nós continuam no lado do papel (separados).
    expect(panOf(hook, 's1-click')).toBe(-1)
    expect(panOf(hook, 's1-bass')).toBe(1)

    // Uma vez só: na mesma conta, um pan ±1 escolhido depois fica.
    cleanup()
    mem.settings = { ...mem.settings, outputs: STEREO }
    seed(song('s3', { click: -1, bass: 1 }))
    const again = await openApp()
    expect(again.result.current.channels.map((c) => c.pan)).toEqual([-1, 0, 1, 0])
    expect(savedPans('s3')[0]).toEqual([-1, '1/2'])
  })

  it('aparelho que já estava sem pan automático: a conta também zera os ±1 antigos uma vez', async () => {
    // Ruling T25-reset-sempre: não depende do legacyPanReset nem do pan automático de agora.
    mem.settings = { ...mem.settings, autoPan: false, legacyPanReset: false, outputs: STEREO }
    seed(song('s1', { click: -1, bass: 1, keys: 0.5 }))
    const hook = await openApp()
    expect(hook.result.current.channels.map((c) => c.pan)).toEqual([0, 0, 0, 0.5])
    expect(savedPans('s1').map(([p]) => p)).toEqual([0, 0, 0, 0.5])
    // Depois do reset, o knob que o operador puser em ±1 fica.
    await act(async () => { hook.result.current.updatePan('s1-bass', 1) })
    cleanup()
    const again = await openApp()
    expect(again.result.current.channels.find((c) => c.id === 's1-bass')!.pan).toBe(1)
  })

  it('ZIP da v1.4.15 com ±1 entra com pan 0; ZIP exportado agora guarda o knob', async () => {
    localStorage.setItem('mt_legacy_pans_reset:u1', '1') // conta já zerada antes
    // O import termina com location.reload(), que o jsdom não implementa e avisa pelo console
    // virtual; o export baixa por um <a download>. Os dois ficam capturados aqui.
    type Listener = (error: Error) => void
    const vc = (globalThis as unknown as { jsdom: { virtualConsole: { listeners(e: 'jsdomError'): Listener[]; removeAllListeners(e: 'jsdomError'): void; on(e: 'jsdomError', l: Listener): void } } }).jsdom.virtualConsole
    const importZip = async (hook: Hook, zip: Blob) => {
      const original = vc.listeners('jsdomError')
      const jsdomErrors: string[] = []
      vc.removeAllListeners('jsdomError')
      vc.on('jsdomError', (e) => { jsdomErrors.push(e.message) })
      try { await act(async () => { await hook.result.current.importPlaylist(zip as File) }) } finally {
        vc.removeAllListeners('jsdomError')
        for (const l of original) vc.on('jsdomError', l)
      }
      expect(jsdomErrors).toEqual(['Not implemented: navigation (except hash changes)'])
    }
    const old = new JSZip()
    const antigo = { id: 'z1', name: 'Antiga', duration: 0.1, pitch: 0, channels: song('z1', { click: -1, bass: 1, keys: 0.3 }).channels }
    old.file('manifest.json', JSON.stringify({ version: 5, songs: [antigo] }))
    for (const c of antigo.channels) old.file(`audio/${c.id}.wav`, /BASS|KEYS/.test(c.name) ? 'stereo' : 'mono')
    const hook = await openApp()
    await importZip(hook, await old.generateAsync({ type: 'blob' }))
    expect(savedPans('z1')).toEqual([[0, '1/2'], [0, '1/2'], [0, '1/2'], [0.3, '1/2']])

    // Exportado por esta versão: o ±1 do knob volta igual.
    cleanup()
    seed(song('s9', { bass: 1 }))
    const next = await openApp()
    const blobs: Blob[] = []
    const realCreate = URL.createObjectURL
    const realRevoke = URL.revokeObjectURL
    URL.createObjectURL = (b: Blob | MediaSource) => { blobs.push(b as Blob); return 'blob:repertorio' }
    URL.revokeObjectURL = () => {}
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    try { await act(async () => { await next.result.current.exportPlaylist() }) } finally {
      URL.createObjectURL = realCreate
      URL.revokeObjectURL = realRevoke
    }
    const manifest = JSON.parse(await (await JSZip.loadAsync(blobs[0])).file('manifest.json')!.async('string'))
    expect(manifest.knobPans).toBe(true)
    cleanup()
    const back = await openApp()
    await importZip(back, blobs[0])
    expect(savedPans('s9')[2]).toEqual([1, '1/2'])
  })

  it('duas contas no mesmo aparelho: cada uma zera os pans antigos dela uma vez', async () => {
    mem.settings = { ...mem.settings, legacyPanReset: true }
    seedFor('u1', song('a1', { click: -1, bass: 1 }))
    seedFor('u2', song('b1', { guide: -1, keys: 1, bass: 0.5 }))
    const first = await openApp('u1')
    expect(first.result.current.channels.map((c) => c.pan)).toEqual([0, 0, 0, 0])
    expect(savedPans('b1', 'u2')).toEqual([[0, '1/2'], [-1, '1/2'], [0.5, '1/2'], [1, '1/2']]) // a outra conta não foi tocada
    cleanup()
    const second = await openApp('u2')
    expect(second.result.current.channels.map((c) => c.pan)).toEqual([0, 0, 0.5, 0])
    expect(savedPans('b1', 'u2')).toEqual([[0, '1/2'], [0, '1/2'], [0.5, '1/2'], [0, '1/2']])
    expect(localStorage.getItem('mt_legacy_pans_reset:u2')).toBe('1')
    cleanup()
    // Sem conta (anônimo) é outra marca.
    seedFor('anon', song('c1', { click: 1 }))
    mem.db.set('mt_meta_playlist', mem.db.get(metaKey('anon')))
    for (const id of ['c1-click', 'c1-guide', 'c1-bass', 'c1-keys']) mem.db.set(`mt_files:ch:${id}`, mem.db.get(`mt_files_anon:ch:${id}`))
    const hook = renderHook(() => useAudioEngine())
    await act(async () => { await hook.result.current.initEngine() })
    expect(localStorage.getItem('mt_legacy_pans_reset:anonimo')).toBe('1')
    expect((mem.db.get('mt_meta_playlist') as SavedSong[])[0].channels[0].pan).toBe(0)
    // A u1 de volta não zera de novo.
    cleanup()
    seedFor('u1', song('a2', { click: -1 }))
    const back = await openApp('u1')
    expect(back.result.current.channels[0].pan).toBe(-1)
  })
})

describe('pan automático (só no pan efetivo, nunca no ch.pan)', () => {
  const AUTO = { autoPan: true }
  it('em Tudo junto o panner vai pro lado do papel e nenhum ch.pan muda', async () => {
    mem.settings = { ...mem.settings, ...AUTO, outputs: STEREO }
    seed(song('s1', { click: 0.6, guide: 0.3, bass: -0.4, keys: 0.2 }))
    const hook = await openApp()
    expect([panOf(hook, 's1-click'), panOf(hook, 's1-guide'), panOf(hook, 's1-bass'), panOf(hook, 's1-keys')]).toEqual([-1, -1, 1, 1])
    expect(hook.result.current.channels.map((c) => c.pan)).toEqual([0.6, 0.3, -0.4, 0.2])
    // Nível igual ao da v1.4.15 com o pan automático.
    const sig = await playAndMeasure(hook, IDS)
    close(sig, legacyMeasure([{ stereo: false, pan: -1 }, { stereo: false, pan: -1 }, { stereo: true, pan: 1 }, { stereo: true, pan: 1 }]))
    act(() => { hook.result.current.pause() })

    // Troca de papel, arquivo novo, canal avulso e metrônomo: o pan gravado é só o knob.
    await act(async () => { hook.result.current.setChannelMeta('s1-bass', { role: 'click' }) })
    expect(chan(hook, 's1-bass').pan).toBe(-0.4)
    expect(panOf(hook, 's1-bass')).toBe(-1)
    // Na hora, sem rampa: numa rampa o Click novo passaria pelo lado da VS.
    expect(asFake(chan(hook, 's1-bass').pannerNode).pan.events.at(-1)?.kind).toBe('set')
    const files = ['Click.wav', 'BASS_2.wav'].map((n) => new File([n.startsWith('BASS') ? 'stereo' : 'mono'], n, { type: 'audio/wav' }))
    await act(async () => { await hook.result.current.loadFiles(files as unknown as FileList, 'Nova') })
    await act(async () => { hook.result.current.jumpToSong(1) })
    await act(async () => { await hook.result.current.addChannelToActiveSong(new File(['mono'], 'GUIDE VOX.wav', { type: 'audio/wav' })) })
    await act(async () => { await hook.result.current.createEndlessMetronomeSong(120) })
    const all = hook.result.current.playlist.flatMap((s) => s.channels)
    for (const name of ['Click', 'BASS_2', 'GUIDE VOX', 'Metronomo Loop']) expect(all.find((c) => c.name === name)).toMatchObject({ pan: 0, bus: '1/2' })
    expect(valueAt(asFake(all.find((c) => c.name === 'BASS_2')!.pannerNode).pan, ctxOf().currentTime + 1)).toBe(1)
    expect(valueAt(asFake(all.find((c) => c.name === 'Metronomo Loop')!.pannerNode).pan, ctxOf().currentTime + 1)).toBe(-1)
    // Nada disso foi gravado com ±1 no repertório.
    const savedById = Object.fromEntries((mem.db.get(metaKey()) as SavedSong[]).flatMap((s) => s.channels).map((c) => [c.name, c.pan]))
    expect(savedById).toEqual({ CLICK: 0.6, 'Voz Guia': 0.3, BASS_1: -0.4, KEYS: 0.2, Click: 0, BASS_2: 0, 'GUIDE VOX': 0, 'Metronomo Loop': 0 })

    // Desligar o pan automático volta o knob, sem regravar nada.
    mem.settings = { ...mem.settings, autoPan: false }
    await act(async () => { hook.rerender() })
    expect(valueAt(asFake(all.find((c) => c.name === 'BASS_2')!.pannerNode).pan, ctxOf().currentTime)).toBe(0)
    expect(valueAt(asFake(all.find((c) => c.id === 's1-click')!.pannerNode).pan, ctxOf().currentTime)).toBe(0.6)
  })

  it('de Tudo junto com pan automático pra 4 ou mais, a VS sai igual nas duas saídas do par', async () => {
    mem.ctxOpts = { maxChannelCount: 8 }
    mem.settings = { ...mem.settings, ...AUTO, outputs: STEREO }
    seed(song('s1'))
    const hook = await openApp()
    expect(panOf(hook, 's1-bass')).toBe(1)
    mem.settings = { ...mem.settings, outputs: MULTI }
    await act(async () => { hook.rerender() })
    expect(hook.result.current.outputPlan).toMatchObject({ mode: 'multi', channels: 8 })
    expect([panOf(hook, 's1-bass'), panOf(hook, 's1-keys')]).toEqual([0, 0])
    const sig = await playAndMeasure(hook, IDS)
    const ref = legacyMeasure([{ stereo: false, pan: 0 }, { stereo: false, pan: 0 }, { stereo: true, pan: 0 }, { stereo: true, pan: 0 }])
    for (const o of [0, 1]) for (const k of [4, 5, 6, 7]) expect(Math.abs(sig[o][k] - ref[o][k])).toBeLessThan(1e-12)
    expect(part(sig, 0, 2)).toBeCloseTo(part(sig, 1, 2), 12)
    expect(part(sig, 2, 0)).toBeCloseTo(1, 12)
    for (const o of [0, 1]) expect(part(sig, o, 0)).toBe(0)
  })

  it('de separados com o lado trocado pra Tudo junto com pan automático: o Click vai pra esquerda na hora', async () => {
    mem.settings = { ...mem.settings, autoPan: true, outputs: { ...SPLIT, earOnSecond: true } }
    seed(song('s1'))
    const hook = await openApp()
    expect(panOf(hook, 's1-click')).toBe(1)
    mem.settings = { ...mem.settings, outputs: STEREO }
    await act(async () => { hook.rerender() })
    // Sem rampa: no mesmo instante o Click já está todo no lado do ouvido, nada no da VS.
    const t = ctxOf().currentTime
    for (const id of ['s1-click', 's1-guide']) expect(valueAt(asFake(chan(hook, id).pannerNode).pan, t)).toBe(-1)
    for (const id of ['s1-bass', 's1-keys']) expect(valueAt(asFake(chan(hook, id).pannerNode).pan, t)).toBe(1)
  })

  it('em Click e Guia separados o pan automático não muda nada', async () => {
    const run = async (autoPan: boolean) => {
      mem.settings = { ...mem.settings, autoPan, outputs: SPLIT }
      seed(song('s1', { click: 0.6, bass: -0.4 }))
      const hook = await openApp()
      const pans = [panOf(hook, 's1-click'), panOf(hook, 's1-guide'), panOf(hook, 's1-bass'), panOf(hook, 's1-keys')]
      const sig = await playAndMeasure(hook, IDS)
      const stored = hook.result.current.channels.map((c) => c.pan)
      cleanup()
      return { pans, sig, stored }
    }
    const on = await run(true)
    const off = await run(false)
    expect(on.pans).toEqual([-1, -1, 1, 1])
    expect(on.pans).toEqual(off.pans)
    close(on.sig, off.sig)
    expect(on.stored).toEqual([0.6, 0, -0.4, 0])
  })
})

describe('plano das saídas', () => {
  it('placa de 2 canais com 4 ou mais escolhido cai em separados', async () => {
    mem.settings = { ...mem.settings, outputs: MULTI }
    seed(song('s1'))
    const hook = await openApp()
    expect(hook.result.current.outputPlan).toMatchObject({ mode: 'split2', fellBackFrom: 'multi', warning: 'poucos-canais', click: [0], vs: [1] })
    expect(hook.result.current.maxOutputChannels).toBe(2)
    expect(ctxOf().destination.channelCount).toBe(2)
    const sig = await playAndMeasure(hook, IDS)
    close(sig, legacyMeasure([{ stereo: false, pan: -1 }, { stereo: false, pan: -1 }, { stereo: true, pan: 1 }, { stereo: true, pan: 1 }]))
  })

  it('placa de 8 canais: VS em 1/2, Click na 3, Guia na 4, nada de Click e Guia na VS', async () => {
    mem.ctxOpts = { maxChannelCount: 8 }
    mem.settings = { ...mem.settings, outputs: MULTI }
    seed(song('s1', { bass: -0.5, keys: 0.5 }))
    const hook = await openApp()
    expect(hook.result.current.outputPlan).toMatchObject({ mode: 'multi', channels: 8, vs: [0, 1], click: [2], guide: [3], warning: null })
    expect(ctxOf().destination).toMatchObject({ channelCount: 8, channelInterpretation: 'discrete' })
    expect([panOf(hook, 's1-click'), panOf(hook, 's1-guide'), panOf(hook, 's1-bass'), panOf(hook, 's1-keys')]).toEqual([-1, -1, -0.5, 0.5])
    const sig = await playAndMeasure(hook, IDS)
    // Click e Guia inteiros na saída própria (o nível do ouvido em separados) e zero no par da VS.
    expect(part(sig, 2, 0)).toBeCloseTo(1, 12)
    expect(part(sig, 3, 1)).toBeCloseTo(1, 12)
    for (const k of [0, 1]) for (const o of [0, 1]) expect(part(sig, o, k)).toBe(0)
    // A VS no par 1/2 com o knob, como em "Tudo junto".
    const ref = legacyMeasure([{ stereo: false, pan: 0 }, { stereo: false, pan: 0 }, { stereo: true, pan: -0.5 }, { stereo: true, pan: 0.5 }])
    for (const o of [0, 1]) for (const k of [4, 5, 6, 7]) expect(Math.abs(sig[o][k] - ref[o][k])).toBeLessThan(1e-12)
    for (const o of [2, 3, 4, 5, 6, 7]) for (const k of [4, 5, 6, 7]) expect(sig[o][k]).toBe(0)
  })

  it('aparelho de 1 canal: tudo junto no canal único, com o aviso mono e sem RangeError', async () => {
    mem.ctxOpts = { maxChannelCount: 1 }
    seed(song('s1', { click: 0.6 }))
    const hook = await openApp()
    expect(hook.result.current.outputPlan).toMatchObject({ mode: 'stereo', channels: 1, fellBackFrom: 'split2', warning: 'mono' })
    expect(hook.result.current.maxOutputChannels).toBe(1)
    expect(ctxOf().destination.channelCount).toBe(1)
    // Nada a separar: o knob vale, como em "Tudo junto".
    expect(panOf(hook, 's1-click')).toBe(0.6)
    expect(warn.mock.calls.filter((c) => String(c[0]).includes('[saídas]'))).toEqual([])
  })

  it('troca de aparelho refaz o plano com os canais do aparelho novo', async () => {
    mem.ctxOpts = { maxChannelCount: 2, sinks: { placa: 8, fone: 2 } }
    mem.settings = { ...mem.settings, outputs: MULTI }
    seed(song('s1'))
    const hook = await openApp()
    expect(hook.result.current.outputPlan.mode).toBe('split2')

    // Placa de 8 canais: o destino estava em 2 (separados) e mesmo assim o "4 ou mais" entra.
    mem.settings = { ...mem.settings, audioDeviceId: 'placa' }
    await act(async () => { hook.rerender() })
    await act(async () => { await Promise.resolve() })
    expect(hook.result.current.maxOutputChannels).toBe(8)
    expect(hook.result.current.outputPlan).toMatchObject({ mode: 'multi', channels: 8 })
    expect(ctxOf().destination.channelCount).toBe(8)
    expect(panOf(hook, 's1-bass')).toBe(0)

    // Fone de 2 canais: volta pra separados.
    mem.settings = { ...mem.settings, audioDeviceId: 'fone' }
    await act(async () => { hook.rerender() })
    await act(async () => { await Promise.resolve() })
    expect(hook.result.current.outputPlan).toMatchObject({ mode: 'split2', fellBackFrom: 'multi' })
    expect(ctxOf().destination.channelCount).toBe(2)
    expect(panOf(hook, 's1-bass')).toBe(1)

    // O sistema troca o aparelho sozinho (evento sinkchange): plano novo também.
    asFake(ctxOf().destination).maxChannelCount = 8
    await act(async () => { ctxOf().dispatchEvent(new Event('sinkchange')) })
    expect(hook.result.current.outputPlan).toMatchObject({ mode: 'multi', channels: 8 })
  })

  it('plano que o aparelho não aceita cai em 2 canais, com som e sem Click na VS', async () => {
    // O aparelho diz 8 canais na leitura e recusa na hora de ligar (o grafo lança RangeError).
    let reads = 0
    mem.ctxOpts = { maxChannelCount: 8 }
    mem.settings = { ...mem.settings, outputs: MULTI }
    vi.stubGlobal('AudioContext', function () {
      const ctx = createFakeAudioContext({ maxChannelCount: 2, decode: async (data: ArrayBuffer) => new FakeAudioBuffer(new TextDecoder().decode(data).startsWith('stereo') ? 2 : 1, 4800, SR) })
      Object.defineProperty(ctx.destination, 'maxChannelCount', { get: () => (reads++ === 0 ? 8 : 2), configurable: true })
      mem.ctx = ctx
      return ctx
    })
    seed(song('s1'))
    const hook = await openApp()
    expect(warn.mock.calls.some((c) => String(c[0]).includes('Usando 2 canais'))).toBe(true)
    expect(hook.result.current.outputPlan).toMatchObject({ mode: 'split2', fellBackFrom: 'multi' })
    const sig = await playAndMeasure(hook, IDS)
    close(sig, legacyMeasure([{ stereo: false, pan: -1 }, { stereo: false, pan: -1 }, { stereo: true, pan: 1 }, { stereo: true, pan: 1 }]))
  })
})

// Todo caminho de `from` até o destino passa por `through`? (busca que para no `through`)
function onlyThrough(ctx: FakeAudioContext, from: FakeAudioNode, through: FakeGainNode): boolean {
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

describe('pré-contagem antiga', () => {
  beforeEach(() => { localStorage.setItem('precount_enabled', 'true'); localStorage.setItem('precount_beats', '4') })
  afterEach(() => { localStorage.removeItem('precount_enabled'); localStorage.removeItem('precount_beats') })

  // Bipe no pico do envelope (0,25 aos 3 ms), um oscilador por vez.
  async function countIn(hook: Hook): Promise<Sig[]> {
    const t0 = ctxOf().currentTime
    await act(async () => { await hook.result.current.playWithPrecount() })
    const oscs = nodesOf(ctxOf(), 'OscillatorNode')
    expect(oscs).toHaveLength(4)
    const ctx = ctxOf()
    const out = oscs.map((osc, i) => {
      ctx.currentTime = t0 + i * 0.6 + 0.003
      return measure(ctx, new Map(oscs.map((o) => [o, [[o === osc ? 1 : 0]]])), 1)
    })
    act(() => { hook.result.current.cancelCountIn() })
    return out
  }
  // A pré-contagem da v1.4.16: oscilador -> envelope -> panner (-1 com o pan automático, 0 sem) -> destino.
  function legacyBeep(pan: number): Sig {
    const ctx = createFakeAudioContext()
    const osc = ctx.createGain()
    const env = ctx.createGain()
    env.gain.value = 0.25
    const panner = ctx.createStereoPanner()
    panner.pan.value = pan
    osc.connect(env); env.connect(panner); panner.connect(ctx.destination)
    return measure(ctx, new Map([[osc, [[1]]]]), 1)
  }

  it('a pré-contagem nunca liga no destino direto', async () => {
    seed(song('s1'))
    const hook = await openApp()
    const bus = graphOf(ctxOf())
    const beeps = await countIn(hook)
    for (const osc of nodesOf(ctxOf(), 'OscillatorNode')) {
      expect(reaches(osc, bus.click)).toBe(true)
      expect(onlyThrough(ctxOf(), osc, bus.click)).toBe(true)
    }
    // Separados: igual à v1.4.16 com o pan automático (pico 0,25 no ouvido) e nada na VS.
    for (const sig of beeps) close(sig, legacyBeep(-1))
    expect(Math.abs(beeps[0][1][0])).toBeLessThan(1e-12)
  })

  it('em tudo junto sai no centro como a v1.4.16 sem pan automático', async () => {
    mem.settings = { ...mem.settings, outputs: STEREO }
    seed(song('s1'))
    const hook = await openApp()
    for (const sig of await countIn(hook)) close(sig, legacyBeep(0))
  })

  it('em tudo junto com o pan automático vai pro ouvido (-1) como na v1.4.16, nada no lado da VS', async () => {
    mem.settings = { ...mem.settings, outputs: STEREO, autoPan: true }
    seed(song('s1'))
    const hook = await openApp()
    const bus = graphOf(ctxOf())
    for (const sig of await countIn(hook)) {
      close(sig, legacyBeep(-1))
      expect(sig[1][0]).toBe(0)
    }
    for (const osc of nodesOf(ctxOf(), 'OscillatorNode')) expect(onlyThrough(ctxOf(), osc, bus.click)).toBe(true)
  })

  it('em 4 ou mais sai só na saída do Click, no nível do ouvido', async () => {
    mem.ctxOpts = { maxChannelCount: 8 }
    mem.settings = { ...mem.settings, outputs: MULTI }
    seed(song('s1'))
    const hook = await openApp()
    const bus = graphOf(ctxOf())
    for (const sig of await countIn(hook)) {
      expect(sig).toHaveLength(8)
      sig.forEach((c, o) => (o === 2 ? expect(c[0]).toBeCloseTo(0.25, 12) : expect(c[0]).toBe(0)))
    }
    for (const osc of nodesOf(ctxOf(), 'OscillatorNode')) expect(onlyThrough(ctxOf(), osc, bus.click)).toBe(true)
  })

  it('depois de um fade-out a contagem sai no volume do principal', async () => {
    seed(song('s1'))
    const hook = await openApp()
    const { master } = graphOf(ctxOf())
    // O FADE do fim da música deixou o principal quase em 0.
    master.gain.setValueAtTime(0.001, ctxOf().currentTime)
    for (const sig of await countIn(hook)) close(sig, legacyBeep(-1))
  })
})

describe('mudo geral', () => {
  it('mudo geral zera só o masterMute', async () => {
    seed(song('s1'))
    const hook = await openApp()
    const bus = graphOf(ctxOf())
    const t = ctxOf().currentTime
    act(() => { hook.result.current.toggleMasterMute() })
    expect(hook.result.current.masterMuted).toBe(true)
    expect(valueAt(bus.masterMute.gain, t + 0.1)).toBeLessThan(1e-6)
    for (const g of [bus.master, bus.click, bus.guide, bus.vs]) expect(valueAt(g.gain, t + 0.1)).toBe(1)
    // Tocar não desfaz o mudo (o play mexe no principal, não no mudo).
    await act(async () => { await hook.result.current.play() })
    expect(valueAt(bus.masterMute.gain, ctxOf().currentTime + 0.1)).toBeLessThan(1e-6)

    ctxOf().currentTime = t + 1
    act(() => { hook.result.current.toggleMasterMute() })
    expect(hook.result.current.masterMuted).toBe(false)
    expect(valueAt(bus.masterMute.gain, t + 1.2)).toBeGreaterThan(1 - 1e-6)
    expect(hook.result.current.getOutputLevels()).toEqual({ l: 0, r: 0 })
  })
})

describe('nunca sem som e nunca Click na VS nas trocas', () => {
  it('troca de aparelho tocando: corte até o plano novo valer, e o mudo do operador fica', async () => {
    mem.ctxOpts = { maxChannelCount: 2, sinks: { placa: 8 } }
    mem.settings = { ...mem.settings, outputs: MULTI }
    seed(song('s1'))
    const hook = await openApp()
    const bus = graphOf(ctxOf())
    const ctx = ctxOf()
    await act(async () => { await hook.result.current.play() })
    const original = ctx.setSinkId.bind(ctx)
    let cutAtSwitch = -1
    ctx.setSinkId = async (id: string) => {
      cutAtSwitch = valueAt(bus.cut.click.gain, ctx.currentTime)
      await original(id)
    }
    mem.settings = { ...mem.settings, audioDeviceId: 'placa' }
    await act(async () => { hook.rerender() })
    await letAudioRun(80)
    expect(cutAtSwitch).toBe(0)
    // Um corte só: o sinkchange no meio do setSinkId não pede outro (a rota já está certa).
    expect(bus.cut.click.gain.events.filter((e) => e.kind === 'linear').map((e) => e.value)).toEqual([0, 1])
    expect(hook.result.current.outputPlan.mode).toBe('multi')
    for (const g of Object.values(bus.cut)) expect(valueAt(g.gain, ctx.currentTime + 0.05)).toBe(1)
    // Mudo geral do operador: a troca não desfaz.
    act(() => { hook.result.current.toggleMasterMute() })
    mem.settings = { ...mem.settings, audioDeviceId: 'default' }
    await act(async () => { hook.rerender() })
    await letAudioRun(80)
    expect(valueAt(bus.masterMute.gain, ctx.currentTime + 1)).toBeLessThan(1e-6)
    act(() => { hook.result.current.pause() })
  })

  it('aparelho que recusa o plano ao ligar: cai em 2 canais com o Click fora da VS', async () => {
    seed(song('s1'))
    const hook = await openApp()
    // O aparelho diz 8 canais nas leituras do motor (a do pedido e a da troca) e 2 na hora de
    // ligar (o grafo lança RangeError).
    const dest = ctxOf().destination
    let reads = 0
    Object.defineProperty(dest, 'maxChannelCount', { configurable: true, get: () => (reads++ < 2 ? 8 : 2) })
    mem.settings = { ...mem.settings, outputs: MULTI }
    await act(async () => { hook.rerender() })
    expect(warn.mock.calls.some((c) => String(c[0]).includes('Usando 2 canais'))).toBe(true)
    expect(hook.result.current.outputPlan).toMatchObject({ mode: 'split2' })
    const sig = await playAndMeasure(hook, IDS)
    close(sig, legacyMeasure([{ stereo: false, pan: -1 }, { stereo: false, pan: -1 }, { stereo: true, pan: 1 }, { stereo: true, pan: 1 }]))
  })

  it('erro do aparelho no meio da troca: a rota anterior volta, com som', async () => {
    mem.ctxOpts = { maxChannelCount: 2, sinks: { placa: 8 } }
    mem.settings = { ...mem.settings, outputs: MULTI }
    seed(song('s1'))
    const hook = await openApp()
    // O destino recusa 8 canais (DOMException) depois de o grafo já ter soltado a rota velha.
    const dest = ctxOf().destination
    const proto = Object.getOwnPropertyDescriptor(FakeAudioNode.prototype, 'channelCount')!
    Object.defineProperty(dest, 'channelCount', {
      configurable: true,
      get() { return proto.get!.call(dest) },
      set(n: number) { if (n === 8) throw new DOMException('o aparelho recusou', 'NotSupportedError'); proto.set!.call(dest, n) },
    })
    mem.settings = { ...mem.settings, audioDeviceId: 'placa' }
    await act(async () => { hook.rerender() })
    await act(async () => { await Promise.resolve() })
    expect(error.mock.calls.some((c) => String(c[0]).includes('a rota anterior volta'))).toBe(true)
    error.mockClear()
    expect(hook.result.current.outputPlan.mode).toBe('split2')
    const sig = await playAndMeasure(hook, IDS)
    close(sig, legacyMeasure([{ stereo: false, pan: -1 }, { stereo: false, pan: -1 }, { stereo: true, pan: 1 }, { stereo: true, pan: 1 }]))
  })

  it('grafo que não monta por erro do navegador: rota de reserva com som e o Click no ouvido', async () => {
    const decode = async (data: ArrayBuffer) => new FakeAudioBuffer(new TextDecoder().decode(data).startsWith('stereo') ? 2 : 1, 4800, SR)
    vi.stubGlobal('AudioContext', function () {
      const ctx = createFakeAudioContext({ decode, maxChannelCount: 8 })
      ctx.createChannelSplitter = () => { throw new TypeError('sem ChannelSplitter neste navegador') }
      mem.ctx = ctx
      return ctx
    })
    seed(song('s1'))
    const hook = await openApp()
    expect(error.mock.calls.some((c) => String(c[0]).includes('rota de reserva'))).toBe(true)
    error.mockClear()
    expect(hook.result.current.isReady).toBe(true)
    expect(hook.result.current.outputPlan.mode).toBe('split2')
    const sig = await playAndMeasure(hook, IDS)
    close(sig, legacyMeasure([{ stereo: false, pan: -1 }, { stereo: false, pan: -1 }, { stereo: true, pan: 1 }, { stereo: true, pan: 1 }]))
    // "4 ou mais" não existe na reserva (placa de 8): cai em separados com aviso (tocando, no corte).
    mem.settings = { ...mem.settings, outputs: MULTI }
    await act(async () => { hook.rerender() })
    await letAudioRun()
    expect(hook.result.current.outputPlan.mode).toBe('split2')
    expect(warn.mock.calls.some((c) => String(c[0]).includes('Usando 2 canais'))).toBe(true)
  })

  it('pausar no fade da próxima música cancela a troca (a contagem seguinte não cai no meio dela)', async () => {
    seed(song('s1'), song('s2'))
    const hook = await openApp()
    await act(async () => { await hook.result.current.play() })
    act(() => { hook.result.current.nextSong() })
    act(() => { hook.result.current.pause() })
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 1700)) })
    expect(hook.result.current.activeSongIndex).toBe(0)
    expect(hook.result.current.isPlaying).toBe(false)
  }, 30000)
})

describe('corte curto nas trocas de rota (Ruling T25-corte e T25-sincrono)', () => {
  // Eventos do corte de um barramento: desce em 3 ms a partir de t0 e sobe em 3 ms a partir do fundo.
  const cutEvents = (g: FakeGainNode) => g.gain.events.filter((e) => e.kind !== 'cancel')

  it('tocando, a troca de modo desce o corte, troca roteador e pans no fundo e sobe', async () => {
    mem.settings = { ...mem.settings, autoPan: true, outputs: { ...SPLIT, earOnSecond: true } }
    seed(song('s1'))
    const hook = await openApp()
    const bus = graphOf(ctxOf())
    const ctx = ctxOf()
    await act(async () => { await hook.result.current.play() })
    const click = asFake(chan(hook, 's1-click').pannerNode)
    const clickPan = asFake(bus.click.connections[0].to as AudioNode) // panner do barramento do Click (T12)
    const t0 = ctx.currentTime
    // Na hora do pedido, nada muda ainda: o corte começa a descer.
    mem.settings = { ...mem.settings, outputs: STEREO }
    await act(async () => { hook.rerender() })
    expect(valueAt(click.pan, t0)).toBe(1)
    // Começa com folga à frente do relógio (a thread do áudio calcula adiantado): 10 ms.
    expect(cutEvents(bus.cut.click).map((e) => [e.kind, e.value, +(e.time - t0).toFixed(6)])).toEqual([['set', 1, 0.01], ['linear', 0, 0.013]])
    // O relógio passa do fundo: roteador e pans do canal trocam juntos, depois o corte sobe.
    await letAudioRun()
    const events = cutEvents(bus.cut.click)
    expect(events.map((e) => [e.kind, e.value])).toEqual([['set', 1], ['linear', 0], ['set', 0], ['linear', 1]])
    const up = events[2].time
    expect(up).toBeGreaterThanOrEqual(t0 + 0.013)
    expect(events[3].time).toBeCloseTo(up + 0.003, 9)
    // Os dois pans do Click (o do canal e o do barramento) foram escritos no fundo, no mesmo instante.
    const chSet = click.pan.events.at(-1)!
    const busSet = (clickPan as unknown as { pan: { events: { time: number; value?: number }[] } }).pan.events.at(-1)!
    expect([chSet.value, busSet.value]).toEqual([-1, 0])
    expect(chSet.time).toBe(busSet.time)
    expect(chSet.time).toBeGreaterThanOrEqual(t0 + 0.013)
    expect(chSet.time).toBeLessThanOrEqual(up)
    // Os três barramentos cortam juntos; a Guia pelo corte próprio, nunca pelo guideGain da T17.
    for (const g of [bus.cut.guide, bus.cut.vs]) expect(cutEvents(g).map((e) => e.kind)).toEqual(['set', 'linear', 'set', 'linear'])
    expect(bus.guide.gain.events).toEqual([])
    act(() => { hook.result.current.pause() })
  })

  it('pan automático e papel tocando também vão no corte; parado, troca na hora sem corte', async () => {
    mem.settings = { ...mem.settings, autoPan: false, outputs: STEREO }
    seed(song('s1'))
    const hook = await openApp()
    const bus = graphOf(ctxOf())
    // Parado: nada soando, a troca é na hora e o corte nem mexe.
    mem.settings = { ...mem.settings, autoPan: true }
    await act(async () => { hook.rerender() })
    expect(panOf(hook, 's1-click')).toBe(-1)
    expect(cutEvents(bus.cut.click)).toEqual([])

    await act(async () => { await hook.result.current.play() })
    mem.settings = { ...mem.settings, autoPan: false }
    await act(async () => { hook.rerender() })
    expect(panOf(hook, 's1-click')).toBe(-1) // ainda descendo o corte
    await letAudioRun()
    expect(panOf(hook, 's1-click')).toBe(0)
    expect(cutEvents(bus.cut.click).map((e) => e.kind)).toEqual(['set', 'linear', 'set', 'linear'])

    await act(async () => { hook.result.current.setChannelMeta('s1-keys', { role: 'guide' }) })
    expect(connectedTo(asFake(chan(hook, 's1-keys').gainNode), bus.cut.vs)).toBe(true) // ainda descendo
    await letAudioRun()
    expect(connectedTo(asFake(chan(hook, 's1-keys').gainNode), bus.cut.guide)).toBe(true)
    expect(cutEvents(bus.cut.click)).toHaveLength(8)
    act(() => { hook.result.current.pause() })
  })

  it('a pré-contagem entra pelo corte do Click (o corte também vale pra ela)', async () => {
    localStorage.setItem('precount_enabled', 'true')
    seed(song('s1'))
    const hook = await openApp()
    const bus = graphOf(ctxOf())
    await act(async () => { await hook.result.current.playWithPrecount() })
    const panners = nodesOf(ctxOf(), 'StereoPannerNode').filter((p) => p.connections.some((c) => c.to === bus.cut.click))
    expect(panners.length).toBeGreaterThanOrEqual(4)
    act(() => { hook.result.current.cancelCountIn() })
  })
})

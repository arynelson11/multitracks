// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, renderHook } from '@testing-library/react'
import JSZip from 'jszip'
import { REPERTOIRE_SCHEMA_VERSION, type SavedSong } from '../lib/repertoireSchema'
import { NO_CURRENT_SONG } from '../lib/songRemoval'
import { useAudioEngine } from './useAudioEngine'
// Código do motor como texto, pra guarda de forma no fim do arquivo. Pelo ?raw do Vite
// porque no ambiente jsdom o import.meta.url deixa de ser file://.
import src from './useAudioEngine.ts?raw'

// O motor guarda nome, papel e ordem do canal no repertório do usuário (IndexedDB)
// e não pode perder nenhuma música, volume, mute, pan, marcador ou letra de quem já
// tem repertório salvo. Aqui o hook roda de verdade, com um AudioContext falso e o
// IndexedDB em memória; a regra em si é testada em src/lib/repertoireSchema.test.ts
// e src/lib/channelRoles.test.ts.

type FakeParam = { value: number; cancelScheduledValues(): void; setValueAtTime(v: number): void; setTargetAtTime(v: number): void; linearRampToValueAtTime(): void; exponentialRampToValueAtTime(): void }
type FakeSource = { offset: number; when: number; dest: unknown; buffer: unknown }
// Envelope da voz (T26) e passa-baixa do bipe da contagem: guardam pra onde ligam.
type FakeLink = { connectedTo: unknown }
// Worklet de tom falso com a API real do pacote: start/stop/schedule/latency, sem
// close() (o pacote não tem). `active` diz se o DSP está rodando (start sem stop).
type FakePitchNode = { active: boolean; starts: number; stops: number; connectedTo: unknown }
type FakeDelay = { delayTime: FakeParam; connectedTo: unknown }
// Latência do worklet no modo ao vivo, como o pacote informa (~0,12 s).
const PITCH_LATENCY = 0.12
// Taxa do AudioContext falso. O motor agenda todas as faixas no mesmo instante, 2
// blocos de áudio (128 amostras cada) à frente do relógio, na grade de blocos
// (START_LEAD_QUANTA); com o relógio parado em 0 no play, isso dá 2 blocos.
const SAMPLE_RATE = 48000
const START_LEAD = (2 * 128) / SAMPLE_RATE
// Com pré-contagem o 1º bipe sai com a folga de reserva (15 blocos, 40 ms; Ruling T30-reagenda).
const COUNT_LEAD = (15 * 128) / SAMPLE_RATE

const mem = vi.hoisted(() => ({
  db: new Map<string, unknown>(),
  // Chaves gravadas e cópias de cada gravação do repertório, na ordem.
  writes: [] as string[],
  metaWrites: [] as unknown[],
  // Sem `outputs` o motor fica em "Click e Guia separados" (T25); o pan automático só existe em "Tudo junto".
  settings: { autoPan: true, audioDeviceId: 'default' } as { autoPan: boolean; audioDeviceId: string; outputs?: unknown },
  ctx: null as { currentTime: number } | null,
  // Segura a leitura do repertório até o teste liberar (ver openApp).
  metaGate: null as Promise<void> | null,
  // Segura o nascimento do worklet de tom (play pendente) até o teste liberar.
  pitchGate: null as Promise<void> | null,
  // Conteúdo de arquivo que não decodifica (arquivo estragado).
  failDecode: null as RegExp | null,
  sources: [] as FakeSource[],
  pitchNodes: [] as FakePitchNode[],
  // Passa-baixa de cada bipe da contagem (um por tempo): a saída dele é a entrada da contagem.
  beeps: [] as FakeLink[],
  // Chamado em cada start() de fonte (simula o relógio andando no meio do laço).
  onStart: null as (() => void) | null,
}))

const isMetaKey = (key: string) => key.startsWith('mt_meta_playlist')

vi.mock('idb-keyval', () => ({
  // O IndexedDB grava cópia (structured clone); o repertório aqui também.
  get: async (key: string) => {
    if (isMetaKey(key) && mem.metaGate) await mem.metaGate
    return isMetaKey(key) ? structuredClone(mem.db.get(key)) : mem.db.get(key)
  },
  set: async (key: string, value: unknown) => {
    mem.writes.push(key)
    if (isMetaKey(key)) mem.metaWrites.push(structuredClone(value))
    mem.db.set(key, isMetaKey(key) ? structuredClone(value) : value)
  },
  del: async (key: string) => { mem.db.delete(key) },
  keys: async () => [...mem.db.keys()],
}))
vi.mock('tone', () => ({ setContext: () => {} }))
vi.mock('signalsmith-stretch', () => ({
  default: async () => {
    if (mem.pitchGate) await mem.pitchGate
    const node = {
      active: false, starts: 0, stops: 0, connectedTo: null as unknown,
      connect(dest: unknown) { node.connectedTo = dest },
      disconnect() { node.connectedTo = null },
      start: async () => { node.active = true; node.starts++ },
      stop: async () => { node.active = false; node.stops++ },
      schedule: async () => {},
      latency: async () => PITCH_LATENCY,
    }
    mem.pitchNodes.push(node)
    return node
  },
}))
vi.mock('../contexts/SettingsContext', () => ({ useSettings: () => ({ settings: mem.settings }) }))
vi.mock('../lib/AudioAnalyzer', () => ({ detectKey: () => 'C', generateEndlessClickTrackFromSample: async () => ({ clickBlob: new Blob(['click']) }) }))
vi.mock('../lib/clickLibrary', () => ({ loadClickSelection: () => ({ type: 'wood', subdivision: 1 }) }))
vi.mock('../lib/offlineCache', () => ({
  getCachedStem: async (songId: string, idx: number) => new File([`${songId}#${idx}`], `${idx}.wav`, { type: 'audio/wav' }),
  getCachedStemNames: async () => null,
  isSongCached: async () => false,
}))

function param(value: number): FakeParam {
  const p: FakeParam = {
    value,
    cancelScheduledValues: () => {},
    setValueAtTime: (v) => { p.value = v },
    setTargetAtTime: (v) => { p.value = v },
    linearRampToValueAtTime: () => {},
    exponentialRampToValueAtTime: () => {},
  }
  return p
}
const audioNode = () => ({ connect() {}, disconnect() {}, addEventListener() {} })
// Nó que guarda a última ligação (a voz liga o envelope na entrada do canal; o bipe, o passa-baixa).
function linkNode<T extends object>(extra: T): T & FakeLink & { connect(dest: unknown): void; disconnect(): void; addEventListener(): void } {
  const node = {
    ...extra, connectedTo: null as unknown,
    connect(dest: unknown) { node.connectedTo = dest },
    disconnect() { node.connectedTo = null },
    addEventListener() {},
  }
  return node
}

class FakeAudioContext {
  currentTime = 0
  sampleRate = SAMPLE_RATE
  state = 'running'
  destination = audioNode()
  constructor() { mem.ctx = this }
  createGain() { return linkNode({ gain: param(1) }) }
  createStereoPanner() { return { ...audioNode(), pan: param(0) } }
  createDelay(): FakeDelay & { connect(dest: unknown): void; disconnect(): void } {
    const delay = {
      delayTime: param(0), connectedTo: null as unknown,
      connect(dest: unknown) { delay.connectedTo = dest },
      disconnect() { delay.connectedTo = null },
    }
    return delay
  }
  createBufferSource() {
    const source = {
      offset: -1, when: -1, dest: null as unknown, buffer: null as unknown, loop: false, playbackRate: param(1),
      connect(dest: unknown) { source.dest = dest },
      disconnect() {}, stop() {}, addEventListener() {},
      start(when: number, offset: number) { source.when = when; source.offset = offset; mem.onStart?.() },
    }
    mem.sources.push(source)
    return source
  }
  // Bipes da pré-contagem (receita da T7: dois osciladores, ganhos e um passa-baixa por tempo).
  createOscillator() { return { ...audioNode(), type: 'sine', frequency: param(0), start() {}, stop() {} } }
  createBiquadFilter() {
    const filter = linkNode({ type: 'lowpass', frequency: param(350), Q: param(1) })
    mem.beeps.push(filter)
    return filter
  }
  // Roteador das saídas e medidor do principal (grafo da T12, montado no initEngine desde a T25).
  createChannelSplitter() { return audioNode() }
  createAnalyser() { return { ...audioNode(), fftSize: 2048, smoothingTimeConstant: 0.8, getFloatTimeDomainData() {} } }
  async decodeAudioData(ab: ArrayBuffer) {
    if (mem.failDecode?.test(new TextDecoder().decode(ab))) throw new Error('arquivo estragado (teste)')
    return { duration: 300 }
  }
  async resume() {}
}

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

beforeEach(() => {
  mem.db.clear()
  mem.writes.length = 0
  mem.metaWrites.length = 0
  mem.sources.length = 0
  mem.pitchNodes.length = 0
  mem.beeps.length = 0
  mem.metaGate = null
  mem.pitchGate = null
  mem.failDecode = null
  mem.onStart = null
  mem.settings.autoPan = true
  mem.settings.outputs = undefined
  // A conta já passou pelo reset dos pans ±1 antigos (T25, testado em useAudioEngine.outputs.test.ts).
  localStorage.setItem('mt_legacy_pans_reset:u1', '1')
  vi.stubGlobal('AudioContext', FakeAudioContext)
  vi.stubGlobal('requestAnimationFrame', () => 0)
  vi.stubGlobal('cancelAnimationFrame', () => {})
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const META = 'mt_meta_playlist_u1'
const stemKey = (channelId: string) => `mt_files_u1:ch:${channelId}`
const saved = () => mem.db.get(META) as SavedSong[]

// Abre o app logado: monta o hook e restaura o repertório salvo. Como no app, o
// render do motor pronto (isReady) acontece antes de o IndexedDB responder; sem
// isso o act juntaria os dois e o efeito do pan automático veria o repertório.
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
type Engine = Awaited<ReturnType<typeof openApp>>['result']
const song = (r: Engine, id: string) => r.current.playlist.find((s) => s.id === id)!
const ids = (r: Engine, songId: string) => song(r, songId).channels.map((c) => c.id)
const channel = (r: Engine, id: string) => r.current.channels.find((c) => c.id === id)!
// Fonte que toca o canal, achada pelo buffer dele (não pela posição: um play pode ter
// agendado a lista numa ordem que já mudou). Desde a T26 a fonte liga no envelope da voz e o
// envelope na entrada do canal: `dest` é essa entrada (worklet, atraso ou panner).
const sourceOf = (r: Engine, id: string) => {
  const s = mem.sources.find((x) => x.buffer === channel(r, id).buffer)!
  return { ...s, dest: (s.dest as FakeLink | null)?.connectedTo ?? null }
}
const savedSong = (id: string) => saved().find((s) => s.id === id)!

// Registro v1 real (o mesmo da T5): gravado pela versão de antes da Parte 1,
// com música baixada da nuvem (srcId/srcIdx), tom, marcadores, letra e cifra.
const v1: SavedSong = {
  id: 's1', name: 'Ministério - Grande és Tu', bpm: 72, coverImage: 'data:image/png;base64,AAA', duration: 312.5,
  pitch: -2, originalKey: 'G', artist: 'Ministério',
  markers: [{ id: 'm1', time: 12.3, label: 'Refrão', color: '#FF6B35', lyrics: 'linha' }],
  lyrics: 'letra', lyricsSynced: '[00:12.30] linha', chords: 'G D Em',
  channels: [
    { id: 'a', name: 'CLICK 13', volume: 0.7, muted: false, soloed: false, pan: -1, bus: '1', srcId: 'cloud-1', srcIdx: 0 },
    { id: 'b', name: 'BASS_1', volume: 1.1, muted: true, soloed: false, pan: 1, bus: '2', srcId: 'cloud-1', srcIdx: 1 },
    { id: 'c', name: 'GTR SOLO_1', volume: 0.5, muted: false, soloed: true, pan: 0.3, bus: '1/2', srcId: 'cloud-1', srcIdx: 2 },
  ],
}
const [chA, chB, chC] = v1.channels
// Mesma música com os canais arrastados (srcIdx fora de ordem prova a ordem manual).
const v1Manual: SavedSong = { ...v1, id: 's2', channels: [chC, chA, chB] }
// Música importada do computador na versão antiga: sem srcIdx, a ordem não dá pra provar.
const v1Local: SavedSong = {
  id: 's3', name: 'Local', duration: 200, pitch: 0, originalKey: 'D', lyrics: null, lyricsSynced: null, chords: null,
  channels: [
    { id: 'g', name: 'GTR_1', volume: 0.9, muted: false, soloed: false, pan: 1, bus: '2' },
    { id: 'k', name: 'CLICK', volume: 0.6, muted: false, soloed: false, pan: -1, bus: '1' },
    { id: 'd', name: 'DRUMS', volume: 1, muted: true, soloed: false, pan: 1, bus: '2' },
  ],
}
const [chG, chK, chD] = v1Local.channels
// Registro v2 com nome e papel do usuário, ordem manual e ligação com a nuvem. Fica
// com schemaVersion 2 de propósito: é o formato que a v1.4.16 deixou gravado no aparelho.
const v2: SavedSong = {
  ...v1, id: 's4', sourceId: 'cloud-1', channelOrder: 'manual', schemaVersion: 2,
  channels: [{ ...chB, id: 'vb', muted: false, customName: 'Baixo do Zé', role: 'guide' }, { ...chA, id: 'va' }, { ...chC, id: 'vc' }],
}

function seed(...songs: SavedSong[]) {
  mem.db.set(META, structuredClone(songs))
  for (const s of songs) {
    for (const ch of s.channels) if (!ch.srcId) mem.db.set(stemKey(ch.id), new File([ch.id], `${ch.name}.wav`, { type: 'audio/wav' }))
  }
}
const resetWrites = () => { mem.writes.length = 0; mem.metaWrites.length = 0 }

describe('repertório salvo sobrevive à Parte 1', () => {
  it('registro v1 real volta inteiro e o primeiro save grava a versão atual sem perder nada', async () => {
    seed(v1, v1Manual, v1Local)
    const { result } = await openApp()

    expect(result.current.playlist.map((s) => s.id)).toEqual(['s1', 's2', 's3'])
    expect(song(result, 's1')).toMatchObject({ channelOrder: 'auto', pitch: -2, originalKey: 'G', markers: v1.markers, lyrics: 'letra' })
    expect(ids(result, 's1')).toEqual(['a', 'b', 'c'])
    // Arrastada na mão: a ordem do usuário fica.
    expect(song(result, 's2').channelOrder).toBe('manual')
    expect(ids(result, 's2')).toEqual(['c', 'a', 'b'])
    // Sem prova de ordem manual: só a ordem muda, pra ordem padrão.
    expect(song(result, 's3').channelOrder).toBe('auto')
    expect(ids(result, 's3')).toEqual(['k', 'd', 'g'])
    // Ganho pela regra central: o Solo de c não cala o Click; o M de b vale.
    expect(song(result, 's1').channels.map((c) => c.gainNode.gain.value)).toEqual([0.7, 0, 0.5])

    await act(async () => { result.current.renameSong('s1', v1.name) })

    expect(saved()).toEqual([
      { ...v1, channelOrder: 'auto', schemaVersion: REPERTOIRE_SCHEMA_VERSION },
      { ...v1Manual, channelOrder: 'manual', schemaVersion: REPERTOIRE_SCHEMA_VERSION },
      { ...v1Local, channels: [chK, chD, chG], channelOrder: 'auto', schemaVersion: REPERTOIRE_SCHEMA_VERSION },
    ])
  })

  it('nome, papel, ordem manual e ligação com a nuvem do registro v2 voltam e continuam salvos', async () => {
    seed(v2)
    const { result } = await openApp()

    expect(song(result, 's4')).toMatchObject({ sourceId: 'cloud-1', channelOrder: 'manual' })
    expect(ids(result, 's4')).toEqual(['vb', 'va', 'vc'])
    expect(channel(result, 'vb')).toMatchObject({ name: 'BASS_1', customName: 'Baixo do Zé', role: 'guide' })
    // Guia pelo papel manual: continua tocando com o Solo de vc.
    expect(channel(result, 'vb').gainNode.gain.value).toBe(1.1)

    await act(async () => { result.current.renameSong('s4', v2.name) })
    // Sobe pra versão atual sem perder nada do v2.
    expect(saved()).toEqual([{ ...v2, schemaVersion: REPERTOIRE_SCHEMA_VERSION }])
  })

  it('ordem arrastada no mixer vira manual e sobrevive a reabrir o app', async () => {
    seed(v1)
    const first = await openApp()
    await act(async () => { first.result.current.reorderChannels([channel(first.result, 'c'), channel(first.result, 'b'), channel(first.result, 'a')]) })

    expect(song(first.result, 's1').channelOrder).toBe('manual')
    expect(savedSong('s1')).toMatchObject({ channelOrder: 'manual' })
    expect(savedSong('s1').channels.map((c) => c.id)).toEqual(['c', 'b', 'a'])

    cleanup()
    const { result } = await openApp()
    expect(ids(result, 's1')).toEqual(['c', 'b', 'a'])
  })
})

describe('setChannelMeta', () => {
  it('renomeia sem mexer no nome original e grava só no repertório do usuário', async () => {
    seed(v1)
    const { result } = await openApp()
    resetWrites()

    await act(async () => { result.current.setChannelMeta('b', { customName: '  Baixo   do Zé ' }) })
    expect(channel(result, 'b')).toMatchObject({ name: 'BASS_1', customName: 'Baixo do Zé' })
    expect(savedSong('s1').channels[1]).toMatchObject({ id: 'b', name: 'BASS_1', customName: 'Baixo do Zé', volume: 1.1, muted: true, pan: 1 })
    expect(mem.writes).toEqual([META])

    await act(async () => { result.current.setChannelMeta('b', { customName: null }) })
    expect(channel(result, 'b').customName).toBeUndefined()
    expect(savedSong('s1').channels[1].customName).toBeUndefined()

    resetWrites()
    await act(async () => { result.current.setChannelMeta('nao-existe', { customName: 'X' }) })
    expect(mem.writes).toEqual([])
  })

  it('papel novo reaplica o pan automático, o ganho do Solo e a ordem padrão', async () => {
    // Pan automático só em "Tudo junto" e só no panner (T25): o pan salvo é o knob e não muda com o papel.
    mem.settings.outputs = { mode: 'stereo', earOnSecond: false, multi: { vsPair: 0, click: 2, guide: 3 } }
    seed(v1)
    const { result } = await openApp()

    // Click vira Normal: vai pro PA, o Solo de c passa a calar e cai pro fim da ordem.
    await act(async () => { result.current.setChannelMeta('a', { role: 'normal' }) })
    const a = channel(result, 'a')
    expect(a).toMatchObject({ role: 'normal', pan: -1, bus: '1' })
    expect(a.pannerNode.pan.value).toBe(1)
    expect(a.gainNode.gain.value).toBe(0)
    expect(ids(result, 's1')).toEqual(['b', 'c', 'a'])
    expect(savedSong('s1')).toMatchObject({ channelOrder: 'auto' })
    expect(savedSong('s1').channels.map((c) => [c.id, c.role, c.pan, c.bus])).toEqual([
      ['b', undefined, 1, '2'], ['c', undefined, 0.3, '1/2'], ['a', 'normal', -1, '1'],
    ])

    // Volta ao automático: Click de novo, no ouvido, tocando com o Solo.
    await act(async () => { result.current.setChannelMeta('a', { role: null }) })
    expect(channel(result, 'a')).toMatchObject({ pan: -1, bus: '1' })
    expect(channel(result, 'a').pannerNode.pan.value).toBe(-1)
    expect(channel(result, 'a').gainNode.gain.value).toBe(0.7)
    expect(ids(result, 's1')).toEqual(['a', 'b', 'c'])
  })

  it('ordem manual não muda com o papel, e sem pan automático o pan fica', async () => {
    mem.settings.autoPan = false
    seed(v1Manual)
    const { result } = await openApp()

    await act(async () => { result.current.setChannelMeta('a', { role: 'normal' }) })
    expect(ids(result, 's2')).toEqual(['c', 'a', 'b'])
    expect(channel(result, 'a')).toMatchObject({ role: 'normal', pan: -1, bus: '1' })
    expect(channel(result, 'a').gainNode.gain.value).toBe(0)
  })

  it('tocando com tom diferente de 0, reinicia na mesma posição e o worklet volta pra reserva', async () => {
    seed(v1)
    const { result } = await openApp()
    await act(async () => { await result.current.play() })
    // Tom -2: só o baixo (b) e a guitarra (c) ganham worklet; o Click não.
    expect(mem.pitchNodes).toHaveLength(2)
    const [nodeB, nodeC] = mem.pitchNodes
    expect(sourceOf(result, 'c').dest).toBe(nodeC)

    mem.ctx!.currentTime = 10
    mem.sources.length = 0
    await act(async () => { result.current.setChannelMeta('c', { role: 'guide' }) })

    expect(result.current.isPlaying).toBe(true)
    // O worklet da guitarra parou (stop(); o pacote não tem close) e saiu do panner.
    expect(nodeC).toMatchObject({ active: false, connectedTo: null })
    expect(nodeB).toMatchObject({ active: true, connectedTo: channel(result, 'b').pannerNode })
    expect(mem.pitchNodes).toHaveLength(2)
    expect(mem.sources).toHaveLength(3)
    // Todas as faixas retomam do ponto da troca (o play anterior começou em START_LEAD).
    for (const s of mem.sources) expect(s.offset).toBeCloseTo(10 - START_LEAD, 6)
    // A Guia toca sem o worklet, pelo atraso igual à latência dele (alinhada com a banda).
    expect(sourceOf(result, 'c').dest).toMatchObject({ delayTime: { value: PITCH_LATENCY }, connectedTo: channel(result, 'c').pannerNode })

    // O Click que vira Normal entra na troca de tom: reaproveita o worklet da reserva
    // em vez de criar outro.
    mem.sources.length = 0
    await act(async () => { result.current.setChannelMeta('a', { role: 'normal' }) })
    expect(mem.pitchNodes).toHaveLength(2)
    expect(sourceOf(result, 'a').dest).toBe(nodeC)
    expect(nodeC).toMatchObject({ active: true, connectedTo: channel(result, 'a').pannerNode })
  })

  it('parado com tom diferente de 0, devolve pra reserva o worklet do canal que virou Click', async () => {
    seed(v1)
    const { result } = await openApp()
    await act(async () => { await result.current.play() })
    act(() => { result.current.pause() })
    const nodeC = mem.pitchNodes[1]
    // A pausa para o DSP de todos e desliga do panner.
    expect(mem.pitchNodes.every((n) => !n.active && n.connectedTo === null)).toBe(true)
    mem.sources.length = 0

    await act(async () => { result.current.setChannelMeta('c', { role: 'click' }) })
    expect(result.current.isPlaying).toBe(false)
    expect(mem.sources).toHaveLength(0)

    // O worklet da guitarra ficou na reserva: o Click que vira Normal reaproveita no
    // próximo play, sem worklet novo.
    await act(async () => { result.current.setChannelMeta('a', { role: 'normal' }) })
    await act(async () => { await result.current.play() })
    expect(mem.pitchNodes).toHaveLength(2)
    expect(sourceOf(result, 'a').dest).toBe(nodeC)
    expect(sourceOf(result, 'c').dest).toMatchObject({ delayTime: { value: PITCH_LATENCY }, connectedTo: channel(result, 'c').pannerNode })
  })

  it('papel trocado com um play pendente retoma do ponto certo e o play antigo não agenda nada', async () => {
    seed({ ...v1, pitch: 0 })
    const { result } = await openApp()
    await act(async () => { await result.current.play() })

    // Tocando no tom 0, aos 10 s o tom vai pra +2: o play() novo fica esperando os
    // worklets nascerem (pendente) e nada está tocando.
    mem.ctx!.currentTime = 10
    let releaseWorklets!: () => void
    mem.pitchGate = new Promise<void>((resolve) => { releaseWorklets = resolve })
    mem.sources.length = 0
    act(() => { result.current.changePitch(2) })
    expect(mem.sources).toHaveLength(0)

    // Nesse meio tempo a guitarra vira Guia: reinicia curto, do mesmo ponto.
    await act(async () => { result.current.setChannelMeta('c', { role: 'guide' }) })
    await act(async () => {
      releaseWorklets()
      for (let i = 0; i < 10; i++) await Promise.resolve()
    })

    expect(result.current.isPlaying).toBe(true)
    // Só uma leva de fontes (o play antigo desistiu), todas do ponto da troca de tom.
    expect(mem.sources).toHaveLength(3)
    for (const s of mem.sources) expect(s.offset).toBeCloseTo(10 - START_LEAD, 6)
    // A Guia nova não passa pelo worklet; o baixo sim.
    expect(mem.pitchNodes.some((n) => sourceOf(result, 'c').dest === n)).toBe(false)
    expect(mem.pitchNodes.some((n) => sourceOf(result, 'b').dest === n)).toBe(true)
  })

  // Revisão da junção, M2: com a música parada e tom diferente de 0, o 1º play espera
  // o worklet nascer sem estar tocando (isPlaying falso). Papel trocado nessa janela
  // também refaz a lista e o ganho do Solo: o play antigo usava a lista da hora do
  // clique e o Click que virou Normal tocava (sem transpor) mesmo com o Solo de outro.
  it('papel trocado enquanto o 1º play transposto espera o worklet refaz a lista e o ganho do Solo', async () => {
    seed({
      ...v1,
      channels: [
        { id: 'a', name: 'CLICK 13', volume: 0.7, muted: false, soloed: false, pan: -1, bus: '1', srcId: 'cloud-1', srcIdx: 0 },
        { id: 'b', name: 'BASS_1', volume: 1.1, muted: false, soloed: false, pan: 1, bus: '2', srcId: 'cloud-1', srcIdx: 1 },
        { id: 'c', name: 'GTR SOLO_1', volume: 0.5, muted: false, soloed: true, pan: 1, bus: '2', srcId: 'cloud-1', srcIdx: 2 },
        { id: 'd', name: 'DRUMS', volume: 0.9, muted: false, soloed: false, pan: 1, bus: '2', srcId: 'cloud-1', srcIdx: 3 },
      ],
    })
    const { result } = await openApp()
    let releaseWorklets!: () => void
    mem.pitchGate = new Promise<void>((resolve) => { releaseWorklets = resolve })
    // Parado, tom -2: o play fica pendente esperando os worklets.
    act(() => { void result.current.play() })
    expect(result.current.isPlaying).toBe(false)
    expect(mem.sources).toHaveLength(0)

    // Nessa janela o Click vira Normal e a bateria vira Click, com o Solo na guitarra.
    await act(async () => { result.current.setChannelMeta('a', { role: 'normal' }) })
    await act(async () => { result.current.setChannelMeta('d', { role: 'click' }) })
    await act(async () => {
      releaseWorklets()
      for (let i = 0; i < 10; i++) await Promise.resolve()
    })

    expect(result.current.isPlaying).toBe(true)
    // Uma leva só de fontes (os plays antigos desistiram), do começo da música.
    expect(mem.sources).toHaveLength(4)
    for (const s of mem.sources) expect(s.offset).toBe(0)
    // O Normal novo transpõe com a banda e cala no Solo da guitarra; o Click novo
    // fica fora do worklet e continua tocando no Solo.
    expect(mem.pitchNodes.some((n) => sourceOf(result, 'a').dest === n)).toBe(true)
    expect(channel(result, 'a').gainNode.gain.value).toBe(0)
    expect(mem.pitchNodes.some((n) => sourceOf(result, 'd').dest === n)).toBe(false)
    expect(sourceOf(result, 'd').dest).toMatchObject({ delayTime: { value: PITCH_LATENCY } })
    expect(channel(result, 'd').gainNode.gain.value).toBe(0.9)
    expect(channel(result, 'c').gainNode.gain.value).toBe(0.5)
    expect(channel(result, 'b').gainNode.gain.value).toBe(0)
  })

  // Pré-contagem da T26: os bipes e as vozes saem juntos do play, e a contagem entra pela
  // entrada do canal de click. Papel que entra ou sai de Click na contagem: ela para, a troca de
  // rota acontece e ela recomeça do 1 com a lista nova, e as vozes saem com a lista nova (o
  // Normal novo transpõe com a banda, o Click novo fica fora do worklet). Tom -2.
  it('papel trocado durante a pré-contagem recomeça a contagem depois da troca, com a lista nova', async () => {
    localStorage.setItem('precount_enabled', 'true')
    localStorage.setItem('precount_beats', '1')
    try {
      seed(v1)
      const { result } = await openApp()
      await act(async () => { await result.current.playWithPrecount() })
      expect(result.current.isCountingIn).toBe(true)
      expect(result.current.isPlaying).toBe(true)
      // 1 tempo a 72 BPM (o BPM da música): o bipe com a folga de reserva, as vozes um pulso depois
      // (na amostra mais perto: Ruling T30-grade).
      const pulse = 60 / 72
      expect(mem.beeps).toHaveLength(1)
      // O bipe entra pelo Click (com o tom -2, pelo atraso igual à latência do worklet).
      expect(mem.beeps[0].connectedTo).toMatchObject({ delayTime: { value: PITCH_LATENCY } })
      expect((mem.beeps[0].connectedTo as FakeLink).connectedTo).toBe(channel(result, 'a').pannerNode)
      expect(mem.sources).toHaveLength(3)
      for (const s of mem.sources) expect(s.when).toBeCloseTo(COUNT_LEAD + pulse, 4)

      // Na contagem o Click vira Normal: a contagem para na hora e recomeça do 1 depois da troca
      // de rota (aqui sem corte: com tudo parado não há o que cortar). Sem canal de click no meio
      // tempo, ela passa pelo atraso da contagem do grafo, com a latência do worklet.
      const firstBeep = mem.beeps[0]
      mem.sources.length = 0
      mem.beeps.length = 0
      await act(async () => { result.current.setChannelMeta('a', { role: 'normal' }) })
      await act(async () => { await new Promise((resolve) => setTimeout(resolve, 150)) })
      expect(firstBeep.connectedTo).toBeNull() // o bipe antigo saiu da entrada do Click que virou Normal
      expect(result.current.isCountingIn).toBe(true)
      expect(mem.beeps).toHaveLength(1)
      expect(mem.beeps[0].connectedTo).toMatchObject({ delayTime: { value: PITCH_LATENCY } })
      expect(channel(result, 'a').pannerNode).not.toBe((mem.beeps[0].connectedTo as FakeLink).connectedTo)
      expect(mem.sources).toHaveLength(3)

      // Ainda na contagem a guitarra vira Click: ela recomeça de novo, agora pela guitarra.
      mem.sources.length = 0
      mem.beeps.length = 0
      await act(async () => { result.current.setChannelMeta('c', { role: 'click' }) })
      await act(async () => { await new Promise((resolve) => setTimeout(resolve, 150)) })

      expect(result.current.isPlaying).toBe(true)
      expect(result.current.isCountingIn).toBe(true)
      // O bipe agora entra pela guitarra, o Click novo (pelo atraso dela).
      expect(mem.beeps).toHaveLength(1)
      expect((mem.beeps[0].connectedTo as FakeLink).connectedTo).toBe(channel(result, 'c').pannerNode)
      expect(mem.beeps[0].connectedTo).toMatchObject({ delayTime: { value: PITCH_LATENCY } })
      // Uma leva só de vozes, do começo da música.
      expect(mem.sources).toHaveLength(3)
      for (const s of mem.sources) expect(s.offset).toBe(0)
      // O Normal novo transpõe junto com a banda (não sai desafinado na PA); o Click novo fica
      // fora do worklet, que voltou parado pra reserva: só o baixo e o Normal novo rodam o DSP.
      expect(mem.pitchNodes.some((n) => sourceOf(result, 'a').dest === n)).toBe(true)
      expect(mem.pitchNodes.some((n) => sourceOf(result, 'c').dest === n)).toBe(false)
      expect(mem.pitchNodes.filter((n) => n.active).map((n) => n.connectedTo)).toEqual([channel(result, 'b').pannerNode, channel(result, 'a').pannerNode])
    } finally {
      localStorage.removeItem('precount_enabled')
      localStorage.removeItem('precount_beats')
    }
  })

  it('no tom 0, trocar o papel tocando não reinicia o áudio', async () => {
    seed({ ...v1, pitch: 0 })
    const { result } = await openApp()
    await act(async () => { await result.current.play() })
    mem.sources.length = 0

    await act(async () => { result.current.setChannelMeta('c', { role: 'guide' }) })
    expect(result.current.isPlaying).toBe(true)
    expect(mem.sources).toHaveLength(0)
    expect(mem.pitchNodes).toHaveLength(0)
  })
})

// Revisão da v1.4.16, Menor 2: remover a música ativa enquanto o 1º play transposto
// dela espera o worklet nascer. Sem cancelar, o play antigo terminava depois e tocava
// a música removida (sem tom, porque os worklets dela já tinham sido soltos).
describe('remover a música ativa', () => {
  it.each([
    ['última música do repertório', [v1]],
    ['com outra música no repertório', [v1, v1Local]],
  ])('%s: cancela o play pendente e nada da música removida toca', async (_label, songs) => {
    seed(...songs)
    const { result } = await openApp()
    let releaseWorklets!: () => void
    mem.pitchGate = new Promise<void>((resolve) => { releaseWorklets = resolve })
    // Parado, tom -2: o play da s1 fica pendente esperando os worklets.
    act(() => { void result.current.play() })
    expect(mem.sources).toHaveLength(0)

    await act(async () => { result.current.removeSongFromPlaylist('s1') })
    await act(async () => {
      releaseWorklets()
      for (let i = 0; i < 10; i++) await Promise.resolve()
    })

    expect(result.current.playlist.some((s) => s.id === 's1')).toBe(false)
    expect(mem.sources).toHaveLength(0)
    expect(result.current.isPlaying).toBe(false)
    // Os worklets que nasceram depois foram pra reserva, parados.
    expect(mem.pitchNodes.every((n) => !n.active && n.connectedTo === null)).toBe(true)
  })

  // Parte 3, T17 (ajuste do coordenador): no Livre com o mês cheio, o App pede pra a seguinte não
  // virar a atual (openNext falso): não sobra música atual e a VS fica parada sem música.
  it('openNext falso: a música ativa sai, a outra fica no repertório e nenhuma vira a atual', async () => {
    seed(v1, v1Local)
    const { result } = await openApp()
    expect(result.current.playlist[result.current.activeSongIndex]?.id).toBe('s1')

    await act(async () => { result.current.removeSongFromPlaylist('s1', { openNext: false }) })

    expect(result.current.playlist.map((s) => s.id)).toEqual(['s3'])
    expect(result.current.activeSongIndex).toBe(NO_CURRENT_SONG)
    expect(result.current.playlist[result.current.activeSongIndex]).toBeUndefined()
    expect(result.current.channels).toEqual([])
    expect(result.current.duration).toBe(0)
    expect(result.current.isPlaying).toBe(false)
    // Sem música atual o play não toca nada.
    mem.sources.length = 0
    await act(async () => { await result.current.play() })
    expect(mem.sources).toHaveLength(0)
    expect(result.current.isPlaying).toBe(false)
    // Abrir a que ficou (pelo repertório, que passa pelo portão no App) volta ao normal.
    await act(async () => { result.current.jumpToSong(0) })
    expect(result.current.playlist[result.current.activeSongIndex]?.id).toBe('s3')
    expect(result.current.duration).toBe(200)
  })

  it('sem a opção (quem paga e o admin), a seguinte vira a atual como sempre', async () => {
    seed(v1, v1Local)
    const { result } = await openApp()
    await act(async () => { result.current.removeSongFromPlaylist('s1') })
    expect(result.current.playlist.map((s) => s.id)).toEqual(['s3'])
    expect(result.current.playlist[result.current.activeSongIndex]?.id).toBe('s3')
    expect(result.current.duration).toBe(200)
  })
})

// Revisão da v1.4.16, Menor 3: a rede de segurança do reinício (relógio passou do
// instante comum antes de o laço de start() terminar) deixa um aviso curto no console,
// pra contar os tropeços no teste em aparelho fraco. O comportamento não muda.
describe('rede de segurança do reinício', () => {
  it('reagenda todas as faixas com a folga de reserva e avisa no console', async () => {
    seed({ ...v1, pitch: 0 })
    const { result } = await openApp()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      // No 1º start() o relógio pula 10 ms, além do instante comum (2 blocos).
      mem.onStart = () => { mem.onStart = null; mem.ctx!.currentTime = 0.01 }
      await act(async () => { await result.current.play() })

      // A 1ª leva (3 fontes) foi descartada e a 2ª saiu inteira, do mesmo ponto.
      expect(mem.sources).toHaveLength(6)
      for (const s of mem.sources) expect(s.offset).toBe(0)
      expect(warn).toHaveBeenCalledTimes(1)
      expect(String(warn.mock.calls[0][0])).toMatch(/^\[tom\] reinício reagendado com a folga de reserva \(1\)$/)

      // Sem trava, nenhum aviso.
      warn.mockClear()
      mem.sources.length = 0
      act(() => { result.current.pause() })
      await act(async () => { await result.current.play() })
      expect(mem.sources).toHaveLength(3)
      expect(warn).not.toHaveBeenCalled()
    } finally {
      warn.mockRestore()
    }
  })
})

describe('música nova', () => {
  it('loadFiles grava o registro provisório na versão atual e monta os canais na ordem padrão', async () => {
    const { result } = await openApp()
    const files = ['GTR_1.wav', 'CLICK.wav', 'BASS.wav'].map((n) => new File([n], n, { type: 'audio/wav' }))
    await act(async () => {
      await result.current.loadFiles(files as unknown as FileList, 'Nova', undefined, undefined, 'E', 90, { sourceId: 'cloud-9' })
    })

    const provisional = (mem.metaWrites[0] as SavedSong[])[0]
    expect(provisional).toMatchObject({ name: 'Nova', duration: 0, sourceId: 'cloud-9', channelOrder: 'auto', schemaVersion: REPERTOIRE_SCHEMA_VERSION })
    const nova = result.current.playlist[0]
    expect(nova).toMatchObject({ sourceId: 'cloud-9', channelOrder: 'auto', duration: 300 })
    expect(nova.channels.map((c) => c.name)).toEqual(['CLICK', 'BASS', 'GTR_1'])
    expect(saved()[0]).toMatchObject({ sourceId: 'cloud-9', channelOrder: 'auto', schemaVersion: REPERTOIRE_SCHEMA_VERSION })
    expect(saved()[0].channels.map((c) => c.name)).toEqual(['CLICK', 'BASS', 'GTR_1'])
  })

  it('canal adicionado entra na ordem padrão na música automática e no fim na manual', async () => {
    seed(v1, v1Manual)
    const { result } = await openApp()
    const drums = () => new File(['d'], 'DRUMS.wav', { type: 'audio/wav' })

    await act(async () => { await result.current.addChannelToActiveSong(drums()) })
    expect(song(result, 's1').channels.map((c) => c.name)).toEqual(['CLICK 13', 'DRUMS', 'BASS_1', 'GTR SOLO_1'])

    act(() => { result.current.jumpToSong(1) })
    await act(async () => { await result.current.addChannelToActiveSong(drums()) })
    expect(song(result, 's2').channels.map((c) => c.name)).toEqual(['GTR SOLO_1', 'CLICK 13', 'BASS_1', 'DRUMS'])
    expect(savedSong('s2').channels.map((c) => c.name)).toEqual(['GTR SOLO_1', 'CLICK 13', 'BASS_1', 'DRUMS'])
  })
})

// Parte 3 (faixa D): a música separada abre no palco. O motor guarda de qual separação ela veio e
// o mixer salvo na separação, e o painel SEPARAÇÃO troca o click e a voz guia gerados numa troca
// só (nem os dois, nem nenhum).
const sepSong: SavedSong = {
  id: 'sp', name: 'Separada', duration: 200, pitch: 0, originalKey: 'D', lyrics: null, lyricsSynced: null, chords: null,
  channelOrder: 'auto', schemaVersion: REPERTOIRE_SCHEMA_VERSION,
  channels: [
    { id: 'gc', name: 'Click gerado', volume: 1, muted: false, soloed: false, pan: 0, bus: '1/2' },
    { id: 'dr', name: 'Bateria', volume: 0.8, muted: false, soloed: false, pan: 0, bus: '1/2' },
  ],
}
const metronome = () => new File(['m'], 'Metrônomo.wav', { type: 'audio/wav' })

describe('separação no palco', () => {
  it('loadFiles com separation grava a ligação e o estado inicial dos canais, e reabrir o app traz de volta', async () => {
    const first = await openApp()
    const files = ['Vocais.wav', 'Bateria.wav', 'CLICK.wav'].map((n) => new File([n], n, { type: 'audio/wav' }))
    const channelStates = [undefined, { volume: 0.5, muted: true, soloed: false, pan: -0.3 }, { volume: 9, muted: false, soloed: false, pan: 4 }]
    await act(async () => {
      await first.result.current.loadFiles(files as unknown as FileList, 'Separada', undefined, undefined, null, undefined, {
        separation: { id: 'sep_1', createdAt: 123 }, channelStates,
      })
    })
    const nova = first.result.current.playlist[0]
    expect(nova.separation).toEqual({ id: 'sep_1', createdAt: 123 })
    const byName = (n: string) => nova.channels.find((c) => c.name === n)!
    expect(byName('Bateria')).toMatchObject({ volume: 0.5, muted: true, soloed: false, pan: -0.3 })
    expect(byName('Vocais')).toMatchObject({ volume: 1, muted: false, soloed: false, pan: 0 })
    // Fora da faixa fica no padrão de hoje.
    expect(byName('CLICK')).toMatchObject({ volume: 1, pan: 0 })
    // O registro provisório (antes do decode) e o final levam os dois.
    expect((mem.metaWrites[0] as SavedSong[])[0].separation).toEqual({ id: 'sep_1', createdAt: 123 })
    expect((mem.metaWrites[0] as SavedSong[])[0].channels.find((c) => c.name === 'Bateria')).toMatchObject({ volume: 0.5, muted: true, pan: -0.3 })
    expect(saved()[0].separation).toEqual({ id: 'sep_1', createdAt: 123 })
    expect(saved()[0].channels.find((c) => c.name === 'Bateria')).toMatchObject({ volume: 0.5, muted: true, pan: -0.3 })
    first.unmount()

    const again = await openApp()
    const reaberta = again.result.current.playlist[0]
    expect(reaberta.separation).toEqual({ id: 'sep_1', createdAt: 123 })
    expect(reaberta.channels.find((c) => c.name === 'Bateria')).toMatchObject({ volume: 0.5, muted: true, pan: -0.3 })
  })

  it('sep-1 M3: loadFiles diz se a música entrou (nada decodificou: não entra, nada fica salvo)', async () => {
    const { result } = await openApp()
    const files = (names: string[]) => names.map((n) => new File([n], n, { type: 'audio/wav' })) as unknown as FileList
    let ok: unknown = null
    await act(async () => { ok = await result.current.loadFiles(files(['Vocais.wav']), 'Boa', undefined, undefined, null, undefined, { separation: { id: 'sep_ok', createdAt: 1 } }) })
    expect(ok).toBe(true)
    mem.failDecode = /^Ruim/
    let bad: unknown = null
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    await act(async () => { bad = await result.current.loadFiles(files(['Ruim1.wav', 'Ruim2.wav']), 'Ruim', undefined, undefined, null, undefined, { separation: { id: 'sep_ruim', createdAt: 1 } }) })
    errors.mockRestore()
    expect(bad).toBe(false)
    expect(result.current.playlist.map((s) => s.name)).toEqual(['Boa'])
    expect(saved().map((s) => s.name)).toEqual(['Boa'])
  })

  it('loadFiles sem separation continua como antes', async () => {
    const { result } = await openApp()
    const files = ['GTR_1.wav', 'CLICK.wav'].map((n) => new File([n], n, { type: 'audio/wav' }))
    await act(async () => { await result.current.loadFiles(files as unknown as FileList, 'Comum') })
    expect(result.current.playlist[0].separation).toBeUndefined()
    expect(saved()[0]).not.toHaveProperty('separation')
  })

  it('replaceAppChannel troca o Click gerado pelo Metrônomo e marca clickRemoved', async () => {
    seed(sepSong)
    const { result } = await openApp()
    let added: { name: string } | null = null
    await act(async () => { added = await result.current.replaceAppChannel('sp', ['Click gerado', 'Metrônomo'], metronome()) })
    expect(added).toMatchObject({ name: 'Metrônomo' })
    expect(song(result, 'sp').channels.map((c) => c.name).sort()).toEqual(['Bateria', 'Metrônomo'])
    expect(song(result, 'sp').clickRemoved).toBe(true)
    expect(mem.db.has(stemKey('gc'))).toBe(false)
    expect(savedSong('sp').channels.map((c) => c.name).sort()).toEqual(['Bateria', 'Metrônomo'])
    expect(savedSong('sp').clickRemoved).toBe(true)
    // O canal de fora fica como estava.
    expect(savedSong('sp').channels.find((c) => c.name === 'Bateria')).toMatchObject({ id: 'dr', volume: 0.8 })
  })

  it('replaceAppChannel duas vezes deixa um Metrônomo só e o arquivo do antigo sai do disco', async () => {
    seed(sepSong)
    const { result } = await openApp()
    let firstId = ''
    await act(async () => { firstId = (await result.current.replaceAppChannel('sp', ['Click gerado', 'Metrônomo'], metronome()))!.id })
    expect(mem.db.has(stemKey(firstId))).toBe(true)
    let secondId = ''
    await act(async () => { secondId = (await result.current.replaceAppChannel('sp', ['Click gerado', 'Metrônomo'], metronome()))!.id })
    const names = song(result, 'sp').channels.map((c) => c.name)
    expect(names.filter((n) => n === 'Metrônomo')).toHaveLength(1)
    expect(names).not.toContain('Click gerado')
    expect(mem.db.has(stemKey(firstId))).toBe(false)
    expect(mem.db.has(stemKey(secondId))).toBe(true)
    // Nunca os dois nem nenhum em nenhuma gravação do repertório.
    for (const w of mem.metaWrites as SavedSong[][]) {
      const sp = w.find((x) => x.id === 'sp')
      if (!sp) continue
      expect(sp.channels.filter((c) => c.name === 'Metrônomo' || c.name === 'Click gerado')).toHaveLength(1)
    }
  })

  it('replaceAppChannel da voz guia não mexe no click', async () => {
    seed(sepSong)
    const { result } = await openApp()
    await act(async () => { await result.current.replaceAppChannel('sp', ['Voz Guia'], new File(['g'], 'Voz Guia.wav', { type: 'audio/wav' })) })
    expect(song(result, 'sp').channels.map((c) => c.name).sort()).toEqual(['Bateria', 'Click gerado', 'Voz Guia'])
    expect(song(result, 'sp').clickRemoved).toBeUndefined()
  })

  it('replaceAppChannel numa música que saiu do repertório devolve null e não grava nada', async () => {
    seed(sepSong)
    const { result } = await openApp()
    const before = [...mem.db.keys()].filter((k) => k.includes(':ch:')).sort()
    resetWrites()
    let out: unknown = 'x'
    await act(async () => { out = await result.current.replaceAppChannel('sumiu', ['Click gerado'], metronome()) })
    expect(out).toBeNull()
    expect(mem.metaWrites).toHaveLength(0)
    expect([...mem.db.keys()].filter((k) => k.includes(':ch:')).sort()).toEqual(before)
  })

  it('addChannelToActiveSong devolve o canal criado', async () => {
    seed(sepSong)
    const { result } = await openApp()
    let added: { name: string; id: string } | null = null
    await act(async () => { added = await result.current.addChannelToActiveSong(new File(['b'], 'Baixo.wav', { type: 'audio/wav' })) })
    expect(added).toMatchObject({ name: 'Baixo' })
    expect(song(result, 'sp').channels.some((c) => c.id === added!.id)).toBe(true)
  })

  it('removeChannel continua tirando o canal da música ativa, com o arquivo e o clickRemoved', async () => {
    seed(sepSong)
    const { result } = await openApp()
    await act(async () => { await result.current.removeChannel('gc') })
    expect(song(result, 'sp').channels.map((c) => c.id)).toEqual(['dr'])
    expect(savedSong('sp').clickRemoved).toBe(true)
    expect(mem.db.has(stemKey('gc'))).toBe(false)
  })
})

// sep-1 C1: a separação que chega com o motor recém-ligado (a partir da tela inicial) só pode
// carregar com o repertório salvo já restaurado. O App espera `isReady && !isRestoring`: o motor
// não pode mostrar essa condição com a leitura do aparelho ainda no meio.
describe('motor recém-ligado: a restauração aparece desde o começo (sep-1 C1)', () => {
  const oldSong: SavedSong = {
    id: 'old', name: 'Antiga', duration: 200, pitch: 0, originalKey: 'D', lyrics: null, lyricsSynced: null, chords: null,
    channelOrder: 'auto', schemaVersion: REPERTOIRE_SCHEMA_VERSION,
    channels: [{ id: 'old-a', name: 'GTR_1', volume: 1, muted: false, soloed: false, pan: 0, bus: '1/2' }],
  }
  // Liga o motor com a leitura do repertório segura; devolve o estado no instante do efeito do App.
  async function startEngine() {
    const hook = renderHook(() => useAudioEngine('u1'))
    let release!: () => void
    mem.metaGate = new Promise<void>((resolve) => { release = resolve })
    let init!: Promise<void>
    await act(async () => { init = hook.result.current.initEngine() })
    const during = { isReady: hook.result.current.isReady, isRestoring: hook.result.current.isRestoring }
    return { hook, during, release: () => release(), init: () => init }
  }

  it('com repertório salvo: isRestoring liga junto com isReady e só desliga com ele na tela', async () => {
    seed(oldSong)
    const { hook, during, release, init } = await startEngine()
    expect(during).toEqual({ isReady: true, isRestoring: true })
    await act(async () => { release(); await init() })
    mem.metaGate = null
    expect(hook.result.current.isRestoring).toBe(false)
    expect(hook.result.current.playlist.map((s) => s.name)).toEqual(['Antiga'])
  })

  it('sem nada salvo: isRestoring também cobre a leitura e desliga no fim', async () => {
    const { hook, during, release, init } = await startEngine()
    expect(during).toEqual({ isReady: true, isRestoring: true })
    await act(async () => { release(); await init() })
    mem.metaGate = null
    expect(hook.result.current.isRestoring).toBe(false)
    expect(hook.result.current.playlist).toEqual([])
  })

  it('leitura do aparelho que falha não deixa isRestoring ligado', async () => {
    const hook = renderHook(() => useAudioEngine('u1'))
    mem.metaGate = Promise.reject(new Error('IndexedDB fora do ar (teste)'))
    mem.metaGate.catch(() => {})
    let failed: unknown = null
    await act(async () => { await hook.result.current.initEngine().catch((e) => { failed = e }) })
    mem.metaGate = null
    expect(failed).toBeInstanceOf(Error)
    expect(hook.result.current.isRestoring).toBe(false)
  })

  it('a separação carregada depois da restauração entra junto da música salva (a lista do aparelho fica com as duas)', async () => {
    seed(oldSong)
    const { hook, release, init } = await startEngine()
    await act(async () => { release(); await init() })
    mem.metaGate = null
    expect(hook.result.current.isRestoring).toBe(false)
    const files = ['Vocais.wav', 'Bateria.wav'].map((n) => new File([n], n, { type: 'audio/wav' }))
    await act(async () => {
      await hook.result.current.loadFiles(files as unknown as FileList, 'Separada', undefined, undefined, null, undefined, { separation: { id: 'sep_x', createdAt: 1 } })
    })
    expect(hook.result.current.playlist.map((s) => s.name)).toEqual(['Antiga', 'Separada'])
    expect(saved().map((s) => s.name)).toEqual(['Antiga', 'Separada'])
  })
})

describe('ZIP de repertório', () => {
  // Exportar baixa o arquivo por um <a download>; aqui o blob é capturado.
  async function exportZip(r: Engine): Promise<Blob> {
    const blobs: Blob[] = []
    const realCreate = URL.createObjectURL
    const realRevoke = URL.revokeObjectURL
    URL.createObjectURL = (b: Blob | MediaSource) => { blobs.push(b as Blob); return 'blob:repertorio' }
    URL.revokeObjectURL = () => {}
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    try {
      await act(async () => { await r.current.exportPlaylist() })
    } finally {
      URL.createObjectURL = realCreate
      URL.revokeObjectURL = realRevoke
    }
    expect(blobs).toHaveLength(1)
    return blobs[0]
  }

  // O import termina com location.reload(), que o jsdom não implementa e avisa pelo
  // console virtual (instância em globalThis.jsdom). Captura só esse aviso; qualquer
  // outro erro do jsdom ou do motor derruba o teste.
  type JsdomErrorListener = (error: Error) => void
  type VirtualConsole = {
    listeners(event: 'jsdomError'): JsdomErrorListener[]
    removeAllListeners(event: 'jsdomError'): void
    on(event: 'jsdomError', listener: JsdomErrorListener): void
  }
  async function importZip(r: Engine, zip: Blob) {
    const virtualConsole = (globalThis as unknown as { jsdom: { virtualConsole: VirtualConsole } }).jsdom.virtualConsole
    const original = virtualConsole.listeners('jsdomError')
    const jsdomErrors: string[] = []
    virtualConsole.removeAllListeners('jsdomError')
    virtualConsole.on('jsdomError', (error) => { jsdomErrors.push(error.message) })
    const engineErrors = vi.spyOn(console, 'error')
    try {
      await act(async () => { await r.current.importPlaylist(zip as File) })
    } finally {
      virtualConsole.removeAllListeners('jsdomError')
      for (const listener of original) virtualConsole.on('jsdomError', listener)
    }
    expect(jsdomErrors).toEqual(['Not implemented: navigation (except hash changes)'])
    expect(engineErrors).not.toHaveBeenCalled()
  }

  it('exportar e importar de novo devolve ordem, nome, papel e mixagem', async () => {
    seed(v2, v1)
    const first = await openApp()
    const zip = await exportZip(first.result)

    const manifest = JSON.parse(await (await JSZip.loadAsync(zip)).file('manifest.json')!.async('string'))
    expect(manifest.songs.map((s: SavedSong) => [s.id, s.channelOrder])).toEqual([['s4', 'manual'], ['s1', 'auto']])
    expect(manifest.songs[0].channels[0]).toMatchObject({ id: 'vb', name: 'BASS_1', customName: 'Baixo do Zé', role: 'guide' })

    await importZip(first.result, zip)
    expect(saved().map((s) => [s.id, s.channelOrder, s.schemaVersion])).toEqual([['s4', 'manual', REPERTOIRE_SCHEMA_VERSION], ['s1', 'auto', REPERTOIRE_SCHEMA_VERSION]])

    cleanup()
    const { result } = await openApp()
    expect(ids(result, 's4')).toEqual(['vb', 'va', 'vc'])
    expect(ids(result, 's1')).toEqual(['a', 'b', 'c'])
    expect(channel(result, 'vb')).toMatchObject({ name: 'BASS_1', customName: 'Baixo do Zé', role: 'guide', volume: 1.1, muted: false, pan: 1, bus: '2' })
    expect(song(result, 's1').channels.map((c) => [c.volume, c.muted, c.soloed, c.pan, c.bus])).toEqual(
      v1.channels.map((c) => [c.volume, c.muted, c.soloed, c.pan, c.bus]),
    )
  })

  it('ZIP exportado pela versão antiga volta com a ordem do arquivo (manual)', async () => {
    const old = new JSZip()
    const antigo = {
      id: 's9', name: 'Antiga', coverImage: '', duration: 120,
      channels: [chC, chA, chB].map(({ id, name, volume, muted, soloed, pan, bus }) => ({ id, name, volume, muted, soloed, pan, bus })),
    }
    old.file('manifest.json', JSON.stringify({ version: 5, songs: [antigo] }))
    for (const ch of antigo.channels) old.file(`audio/${ch.id}.wav`, ch.id)
    const zip = await old.generateAsync({ type: 'blob' })

    const first = await openApp()
    await importZip(first.result, zip)
    expect(savedSong('s9')).toMatchObject({ channelOrder: 'manual', schemaVersion: REPERTOIRE_SCHEMA_VERSION })

    cleanup()
    const { result } = await openApp()
    expect(ids(result, 's9')).toEqual(['c', 'a', 'b'])
    // Pans ±1 de ZIP antigo são do pan automático: entram no centro (T25, Ruling T25-reset-sempre).
    expect(song(result, 's9').channels.map((c) => [c.volume, c.muted, c.soloed, c.pan])).toEqual(
      [chC, chA, chB].map((c) => [c.volume, c.muted, c.soloed, Math.abs(c.pan) === 1 ? 0 : c.pan]),
    )
  })
})

// Guarda de forma do motor (Ruling 5, regex tolerante): o comportamento está nos
// testes acima; aqui só se confere que a persistência passa pela regra central.
// Corpo de `const <nome> = ... => { ... }`, achado por chaves balanceadas (mesmo helper da T6).
function bodyOf(name: string): string {
  const start = src.search(new RegExp(`\\bconst\\s+${name}\\s*=`))
  if (start === -1) return ''
  const open = src.indexOf('{', src.indexOf('=>', start))
  if (open === -1) return ''
  let depth = 0
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') depth++
    else if (src[i] === '}' && --depth === 0) return src.slice(open, i + 1)
  }
  return ''
}

function importedNames(from: string): string[] {
  const escaped = from.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')
  const names: string[] = []
  for (const m of src.matchAll(new RegExp(`import\\s*(?:type\\s*)?\\{([^}]*)\\}\\s*from\\s*['"]${escaped}['"]`, 'g'))) {
    names.push(...m[1].split(',').map((n) => n.trim().replace(/^type\s+/, '')).filter(Boolean))
  }
  return names
}

describe('motor guarda nome, papel e ordem pela regra central (forma)', () => {
  it('usa o formato do repertório de repertoireSchema.ts, sem interfaces locais', () => {
    expect(src).not.toMatch(/\binterface\s+Saved(Channel|Song)\b/)
    expect(importedNames('../lib/repertoireSchema')).toEqual(
      expect.arrayContaining(['toSavedSong', 'migrateSavedSong', 'migrateManifestSong', 'toManifestSong', 'SavedSong']),
    )
    expect(importedNames('../lib/channelNames')).toContain('arrangeChannels')
  })

  it('salva, restaura, exporta e importa pelo formato v2', () => {
    expect(bodyOf('saveStateToDB')).toMatch(/\btoSavedSong\b/)
    expect(bodyOf('initEngine')).toMatch(/\bmigrateSavedSong\b/)
    expect(bodyOf('initEngine')).toMatch(/\barrangeChannels\s*\(/)
    expect(bodyOf('exportPlaylist')).toMatch(/\btoManifestSong\b/)
    expect(bodyOf('importPlaylist')).toMatch(/\bmigrateManifestSong\b/)
  })

  it('arrastar marca a ordem manual', () => {
    expect(bodyOf('reorderChannels')).toMatch(/channelOrder\s*[:=]\s*['"]manual['"]/)
  })

  it('setChannelMeta passa pela regra central e sai no retorno do hook', () => {
    const body = bodyOf('setChannelMeta')
    expect(body, 'corpo de setChannelMeta não encontrado').not.toBe('')
    expect(body).toMatch(/\bapplyChannelMetaToList\s*\(/)
    expect(body).toMatch(/\bpitchChangeAction\s*\(/)
    expect(src.slice(src.lastIndexOf('return {'))).toMatch(/\bsetChannelMeta\b/)
  })
})

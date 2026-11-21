// Ajudante dos testes do Separador montado (Parte 3): fakes do WaveSurfer, do SyncedTrackPlayer e do
// AudioContext, sem áudio de verdade. Usado dentro dos vi.mock dos testes:
//   vi.mock('wavesurfer.js', async () => (await import('./separatorTestKit')).wavesurferModule())
// Não entra no app.
import type { SavedSeparation } from '../../hooks/useSeparationLibrary'

type Handler = (...args: unknown[]) => void

export interface FakeWave {
  url: string
  container: HTMLElement
  time: number
  duration: number
  playing: boolean
  play: () => Promise<void>
  pause: () => void
  setTime: (t: number) => void
  getCurrentTime: () => number
  getDuration: () => number
  setOptions: (o: Record<string, unknown>) => void
  destroy: () => void
  on: (ev: string, cb: Handler) => void
  emit: (ev: string, ...args: unknown[]) => void
}

/** Todas as ondas criadas no teste, na ordem. Zere com `resetWaves()` no beforeEach. */
export const waves: FakeWave[] = []
export function resetWaves(): void { waves.length = 0 }

/** Duração das ondas falsas (segundos). */
export const FAKE_DURATION = 200

function createWave(opts: { container: HTMLElement; url: string }): FakeWave {
  const handlers = new Map<string, Handler[]>()
  const w: FakeWave = {
    url: opts.url, container: opts.container, time: 0, duration: FAKE_DURATION, playing: false,
    play: async () => { w.playing = true },
    pause: () => { w.playing = false },
    setTime: (t) => { w.time = t },
    getCurrentTime: () => w.time,
    getDuration: () => w.duration,
    setOptions: () => {},
    destroy: () => {},
    on: (ev, cb) => { handlers.set(ev, [...(handlers.get(ev) ?? []), cb]) },
    emit: (ev, ...args) => { for (const cb of handlers.get(ev) ?? []) cb(...args) },
  }
  waves.push(w)
  // Fica pronta no próximo ciclo, como a de verdade depois de baixar.
  setTimeout(() => w.emit('ready'), 0)
  return w
}

export function wavesurferModule() {
  return { default: { create: createWave } }
}

class FakeNode {
  connect() { return this }
  disconnect() {}
  gain = { value: 1, cancelScheduledValues() {}, setValueAtTime(v: number) { this.value = v } }
  pan = { value: 0 }
}

export class FakeAudioContext {
  state = 'running'
  currentTime = 0
  destination = new FakeNode()
  resume = async () => {}
  close = async () => {}
  createGain() { return new FakeNode() }
  createStereoPanner() { return new FakeNode() }
  createBufferSource() { return Object.assign(new FakeNode(), { buffer: null, start() {} }) }
  decodeAudioData = async () => ({ numberOfChannels: 1, length: 10, sampleRate: 44100, duration: 1, getChannelData: () => new Float32Array(10) })
}

export class FakeSyncedTrackPlayer {
  output = new FakeNode()
  isLoaded = false
  currentTime = 0
  sampleRate = 44100
  release() {}
  joinPlayback() {}
  getChannelData() { return [new Float32Array(10)] }
}

export function syncedPlayerModule() {
  return { SyncedTrackPlayer: FakeSyncedTrackPlayer }
}

/** Uma separação salva com as faixas pedidas e o mixer padrão. */
export function savedSeparation(over: Partial<SavedSeparation> = {}): SavedSeparation {
  return {
    id: 'sep_1', songName: 'Grande é o Senhor', artist: 'Ministério', bpm: '72', songKey: 'G',
    stems: [
      { id: 'vocals', name: 'Vocais', url: 'https://r2/vocals.wav', color: '#06b6d4' },
      { id: 'drums', name: 'Bateria', url: 'https://r2/drums.wav', color: '#f59e0b' },
      { id: 'bass', name: 'Baixo', url: 'https://r2/bass.wav', color: '#8b5cf6' },
    ],
    voiceCues: [{ id: 'c1', time: 20, label: 'Verso 1', file: 'Song Sections/Portugese - Verse 1.wav' }],
    createdAt: Date.UTC(2026, 10, 18, 15),
    ...over,
  }
}

// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, renderHook } from '@testing-library/react'
import type { Channel, Song } from '../types'
import type { SavedSeparation } from './useSeparationLibrary'

const mocks = vi.hoisted(() => ({
  generateSeparatorClick: vi.fn<(i: unknown) => Promise<string>>(async () => 'blob:click'),
  renderVoiceGuideWav: vi.fn(async () => new Blob(['g'], { type: 'audio/wav' })),
  downloadStem: vi.fn(async () => {}),
  publishToCloud: vi.fn<(i: unknown, onStatus?: unknown) => Promise<void>>(async () => {}),
  measureGrid: vi.fn(() => ({ bpm: 98.4, firstBeat: 0.1, downbeat: 0, confidence: 0.9 })),
}))
vi.mock('../lib/separation/separatorClick', async (orig) => ({ ...(await orig<typeof import('../lib/separation/separatorClick')>()), generateSeparatorClick: mocks.generateSeparatorClick, measureGrid: mocks.measureGrid }))
vi.mock('../lib/separation/voiceGuide', async (orig) => ({ ...(await orig<typeof import('../lib/separation/voiceGuide')>()), renderVoiceGuideWav: mocks.renderVoiceGuideWav }))
vi.mock('../lib/separation/stemFiles', async (orig) => ({ ...(await orig<typeof import('../lib/separation/stemFiles')>()), downloadStem: mocks.downloadStem }))
vi.mock('../lib/separation/cloudPublish', () => ({ publishToCloud: mocks.publishToCloud }))

import { useStageSeparation, type StageSeparationBridge, type StageSeparationStore } from './useStageSeparation'

const SEP: SavedSeparation = {
  id: 'sep_1', songName: 'Águas', artist: 'Hillsong', bpm: '72', songKey: 'D', createdAt: Date.UTC(2026, 9, 5),
  stems: [
    { id: 'vocals', name: 'Vocais', url: 'https://r2/v.wav', color: '#06b6d4' },
    { id: 'drums', name: 'Bateria', url: 'https://r2/d.wav', color: '#f59e0b' },
  ],
  voiceCues: [{ id: 'c1', time: 10, label: 'Verso 1', file: 'Song Sections/Portugese - Verse 1.wav' }],
}

const buffer = { numberOfChannels: 1, length: 4, sampleRate: 44100, duration: 180, getChannelData: () => new Float32Array(4) } as unknown as AudioBuffer
const ch = (id: string, name: string): Channel => ({ id, name, buffer } as unknown as Channel)
const SONG = (over: Partial<Song> = {}): Song => ({
  id: 'song_1', name: 'Hillsong - Águas', duration: 180, channels: [ch('a', 'Vocais'), ch('b', 'Bateria'), ch('c', 'Click gerado')],
  originalKey: 'D', separation: { id: 'sep_1', createdAt: SEP.createdAt }, ...over,
} as Song)

let bridge: StageSeparationBridge & { replaceChannel: ReturnType<typeof vi.fn> }
let store: StageSeparationStore & { saveSeparation: ReturnType<typeof vi.fn>; upload: ReturnType<typeof vi.fn>; getSeparation: ReturnType<typeof vi.fn> }

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: false })
  for (const m of Object.values(mocks)) m.mockClear()
  bridge = { song: SONG(), busy: false, heardPosition: () => 42.5, replaceChannel: vi.fn(async (_n: readonly string[], f: File) => ({ id: 'new', name: f.name.replace(/\.wav$/, '') } as unknown as Channel)) }
  store = {
    userId: 'u1', isAdmin: false,
    getSeparation: vi.fn(async () => structuredClone(SEP)),
    saveSeparation: vi.fn(async () => 'sep_1'),
    upload: vi.fn(async (path: string) => `https://r2/${path}`),
  }
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, blob: async () => new Blob(['x'], { type: 'audio/wav' }) })))
  URL.revokeObjectURL = vi.fn()
})
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals() })

/** Espera a ação andando o relógio falso (a medida da grade cede a vez por 30 ms antes da conta). */
async function run<T>(p: Promise<T>): Promise<T> {
  await vi.advanceTimersByTimeAsync(100)
  return p
}

async function mount(b = bridge) {
  const hook = renderHook(({ br }) => useStageSeparation(br, store), { initialProps: { br: b } })
  await act(async () => { await vi.advanceTimersByTimeAsync(0) })
  return hook
}

describe('useStageSeparation', () => {
  it('lê a separação da música ativa e zera numa música comum', async () => {
    const hook = await mount()
    expect(store.getSeparation).toHaveBeenCalledWith('sep_1')
    expect(hook.result.current.sep?.id).toBe('sep_1')
    expect(hook.result.current.bpm).toBe('72')
    expect(hook.result.current.cues).toHaveLength(1)
    expect(hook.result.current.cloud).toMatchObject({ name: 'Águas', artist: 'Hillsong', bpm: '72', songKey: 'D' })
    expect(hook.result.current.hasClick).toBe(false)
    hook.rerender({ br: { ...bridge, song: SONG({ id: 'other', separation: undefined }) } })
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    expect(hook.result.current.sep).toBeNull()
    expect(hook.result.current.cues).toHaveLength(0)
  })

  it('addCue marca no tempo ouvido, mesmo tocando, e liga cuesPending', async () => {
    const hook = await mount({ ...bridge, busy: true })
    act(() => { hook.result.current.addCue({ label: 'Refrão', file: 'Song Sections/Portugese - Chorus.wav' }) })
    expect(hook.result.current.cues.map((c) => [c.label, c.time])).toEqual([['Verso 1', 10], ['Refrão', 42.5]])
    expect(hook.result.current.cuesPending).toBe(true)
  })

  it('ferramentas não fazem nada com a música tocando', async () => {
    const hook = await mount({ ...bridge, busy: true })
    await act(async () => {
      await hook.result.current.generateClick()
      await hook.result.current.detectBpm()
      await hook.result.current.commitVoiceGuide()
      await hook.result.current.download('vocals')
      await hook.result.current.detectCues()
      expect(await hook.result.current.publish()).toBe(false)
    })
    expect(mocks.generateSeparatorClick).not.toHaveBeenCalled()
    expect(mocks.measureGrid).not.toHaveBeenCalled()
    expect(mocks.renderVoiceGuideWav).not.toHaveBeenCalled()
    expect(mocks.downloadStem).not.toHaveBeenCalled()
    expect(mocks.publishToCloud).not.toHaveBeenCalled()
    expect(bridge.replaceChannel).not.toHaveBeenCalled()
  })

  it('generateClick troca o click gerado pelo app pelo Metrônomo e grava a faixa metronome com a mesma data', async () => {
    const hook = await mount()
    await act(async () => { await run(hook.result.current.generateClick()) })
    expect(bridge.replaceChannel).toHaveBeenCalledWith(['Click gerado', 'Metrônomo'], expect.objectContaining({ name: 'Metrônomo.wav' }))
    expect(store.upload).toHaveBeenCalledWith(expect.stringMatching(/^u1\/sep_1\/click_\d+\.wav$/), expect.any(File))
    expect(store.saveSeparation).toHaveBeenLastCalledWith(expect.objectContaining({
      id: 'sep_1', createdAt: SEP.createdAt,
      stems: expect.arrayContaining([expect.objectContaining({ id: 'metronome', name: 'Metrônomo', url: expect.stringMatching(/^https:\/\/r2\//) })]),
    }))
    expect(hook.result.current.busy).toBeNull()
  })

  it('nudge anda de 10 em 10 e gera de novo 600 ms depois do último toque', async () => {
    const hook = await mount({ ...bridge, song: SONG({ channels: [ch('a', 'Vocais'), ch('b', 'Bateria'), ch('m', 'Metrônomo')] }) })
    expect(hook.result.current.hasClick).toBe(true)
    act(() => { hook.result.current.nudge(10); hook.result.current.nudge(10); hook.result.current.nudge(-10) })
    expect(hook.result.current.offsetMs).toBe(10)
    await act(async () => { await vi.advanceTimersByTimeAsync(500) })
    expect(mocks.generateSeparatorClick).not.toHaveBeenCalled()
    await act(async () => { await vi.advanceTimersByTimeAsync(200) })
    expect(mocks.generateSeparatorClick).toHaveBeenCalledTimes(1)
    expect(mocks.generateSeparatorClick.mock.calls[0][0]).toMatchObject({ plan: expect.objectContaining({ firstBeat: expect.closeTo(0.1 + 0.01, 5) }) })
  })

  it('commitVoiceGuide troca a Voz Guia, grava a faixa voiceguide e desliga cuesPending', async () => {
    const hook = await mount()
    act(() => { hook.result.current.addCue({ label: 'Refrão', file: 'Song Sections/Portugese - Chorus.wav' }) })
    await act(async () => { await hook.result.current.commitVoiceGuide() })
    expect(mocks.renderVoiceGuideWav).toHaveBeenCalledWith(expect.arrayContaining([expect.objectContaining({ label: 'Refrão' })]), 180, expect.any(Function))
    expect(bridge.replaceChannel).toHaveBeenCalledWith(['Voz Guia'], expect.objectContaining({ name: 'Voz Guia.wav' }))
    expect(store.saveSeparation).toHaveBeenLastCalledWith(expect.objectContaining({
      createdAt: SEP.createdAt, stems: expect.arrayContaining([expect.objectContaining({ id: 'voiceguide', name: 'Voz Guia' })]),
    }))
    expect(hook.result.current.cuesPending).toBe(false)
  })

  it('commitVoiceGuide sem marcações diz pra marcar primeiro', async () => {
    store.getSeparation.mockResolvedValueOnce({ ...structuredClone(SEP), voiceCues: [] })
    const hook = await mount()
    await act(async () => { await hook.result.current.commitVoiceGuide() })
    expect(hook.result.current.message).toBe('Adicione marcadores de voz primeiro.')
  })

  it('flushPending parado com marcação nova gera o canal; tocando só grava as marcações', async () => {
    const playing = await mount({ ...bridge, busy: true })
    act(() => { playing.result.current.addCue({ label: 'Ponte', file: 'Song Sections/Portugese - Bridge.wav' }) })
    await act(async () => { await playing.result.current.flushPending() })
    expect(bridge.replaceChannel).not.toHaveBeenCalled()
    expect(store.saveSeparation).toHaveBeenLastCalledWith(expect.objectContaining({ voiceCues: expect.arrayContaining([expect.objectContaining({ label: 'Ponte' })]) }))
    cleanup()
    const stopped = await mount()
    act(() => { stopped.result.current.addCue({ label: 'Ponte', file: 'Song Sections/Portugese - Bridge.wav' }) })
    await act(async () => { await stopped.result.current.flushPending() })
    expect(bridge.replaceChannel).toHaveBeenCalledWith(['Voz Guia'], expect.any(File))
  })

  it('toda gravação do palco leva o createdAt da separação e nunca grava faixas vazias', async () => {
    const hook = await mount({ ...bridge, song: SONG({ originalKey: 'E' }) })
    act(() => { hook.result.current.setBpm('80') })
    act(() => { hook.result.current.addCue({ label: 'Final', file: 'Song Sections/Portugese - Ending.wav' }) })
    await act(async () => { await vi.advanceTimersByTimeAsync(900) })
    expect(store.saveSeparation).toHaveBeenCalled()
    for (const [data] of store.saveSeparation.mock.calls) {
      expect(data.createdAt).toBe(SEP.createdAt)
      expect(data.id).toBe('sep_1')
      expect(data.stems.length).toBeGreaterThan(0)
    }
    expect(store.saveSeparation).toHaveBeenLastCalledWith(expect.objectContaining({ bpm: '80', songKey: 'E' }))
    // Separação sem faixa nenhuma (registro estragado): nada é gravado.
    store.saveSeparation.mockClear()
    store.getSeparation.mockResolvedValueOnce({ ...structuredClone(SEP), stems: [] })
    const empty = await mount({ ...bridge, song: SONG({ id: 'x2' }) })
    act(() => { empty.result.current.setBpm('90') })
    await act(async () => { await vi.advanceTimersByTimeAsync(900); await empty.result.current.flushPending() })
    expect(store.saveSeparation).not.toHaveBeenCalled()
  })

  it('download usa a URL e o nome da faixa da separação no formato escolhido', async () => {
    const hook = await mount()
    act(() => { hook.result.current.setFormat('mp3') })
    await act(async () => { await hook.result.current.download('drums') })
    expect(mocks.downloadStem).toHaveBeenCalledWith({ url: 'https://r2/d.wav', songName: 'Águas', stemName: 'Bateria', format: 'mp3' })
    expect(hook.result.current.downloadingId).toBeNull()
  })

  it('publish manda is_global só pro admin e a voz guia pendente', async () => {
    const hook = await mount()
    act(() => { hook.result.current.setCloud({ publishGlobal: true }) })
    await act(async () => { expect(await hook.result.current.publish()).toBe(true) })
    const input = mocks.publishToCloud.mock.calls[0][0] as { isGlobal: boolean; voiceGuide: unknown; stems: unknown[]; userId: string }
    expect(input.isGlobal).toBe(false)
    expect(typeof input.voiceGuide).toBe('function')
    expect(input.stems).toHaveLength(2)
    expect(input.userId).toBe('u1')
    cleanup()
    store.isAdmin = true
    const admin = await mount()
    act(() => { admin.result.current.setCloud({ publishGlobal: true }) })
    await act(async () => { await admin.result.current.publish() })
    expect((mocks.publishToCloud.mock.calls[1][0] as { isGlobal: boolean }).isGlobal).toBe(true)
  })

  it('erro vira message com a frase de hoje, sem alert', async () => {
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {})
    mocks.generateSeparatorClick.mockRejectedValueOnce(new Error('x'))
    const hook = await mount()
    await act(async () => { await run(hook.result.current.generateClick()) })
    expect(hook.result.current.message).toBe('Não deu pra gerar o click. Tenta de novo.')
    mocks.downloadStem.mockRejectedValueOnce(new Error('rede'))
    await act(async () => { await hook.result.current.download('vocals') })
    expect(hook.result.current.message).toBe('Erro ao baixar a faixa. Tenta de novo.')
    mocks.publishToCloud.mockRejectedValueOnce(new Error('sem permissão'))
    await act(async () => { expect(await hook.result.current.publish()).toBe(false) })
    expect(hook.result.current.message).toBe('Erro ao salvar: sem permissão')
    act(() => { hook.result.current.setCloud({ name: '' }) })
    await act(async () => { await hook.result.current.publish() })
    expect(hook.result.current.message).toBe('Preencha o Nome da Música.')
    expect(alertSpy).not.toHaveBeenCalled()
  })

  it('trocar de música no meio do Gerar click não leva o click nem a gravação pra outra música', async () => {
    let release!: () => void
    mocks.generateSeparatorClick.mockImplementationOnce(() => new Promise((r) => { release = () => r('blob:click') }))
    const first = { ...bridge, replaceChannel: vi.fn(async (_n: readonly string[], f: File) => ({ id: 'n1', name: f.name } as unknown as Channel)) }
    const hook = await mount(first)
    let p!: Promise<void>
    act(() => { p = hook.result.current.generateClick() })
    await act(async () => { await vi.advanceTimersByTimeAsync(100) })
    const other = { ...bridge, song: SONG({ id: 'song_2', separation: { id: 'sep_2', createdAt: 5 } }), replaceChannel: vi.fn() }
    hook.rerender({ br: other })
    await act(async () => { release(); await vi.advanceTimersByTimeAsync(10); await p })
    expect(first.replaceChannel).toHaveBeenCalledTimes(1)
    expect(other.replaceChannel).not.toHaveBeenCalled()
    expect(store.saveSeparation).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'sep_1', createdAt: SEP.createdAt }))
  })

  it('marcação feita durante uma gravação continua pendente e grava depois', async () => {
    const hook = await mount()
    let release!: () => void
    store.saveSeparation.mockImplementationOnce(() => new Promise((r) => { release = () => r('sep_1') }))
    act(() => { hook.result.current.setBpm('81') })
    await act(async () => { await vi.advanceTimersByTimeAsync(850) })
    act(() => { hook.result.current.addCue({ label: 'Tag', file: 'Song Sections/Portugese - Tag.wav' }) })
    await act(async () => { release(); await vi.advanceTimersByTimeAsync(0) })
    await act(async () => { await vi.advanceTimersByTimeAsync(900) })
    expect(store.saveSeparation).toHaveBeenLastCalledWith(expect.objectContaining({ voiceCues: expect.arrayContaining([expect.objectContaining({ label: 'Tag' })]) }))
  })

  it('as ações não mudam entre renders (o palco memorizado não renderiza à toa)', async () => {
    const hook = await mount()
    const first = hook.result.current
    hook.rerender({ br: { ...bridge } })
    expect(hook.result.current.setBpm).toBe(first.setBpm)
    expect(hook.result.current.generateClick).toBe(first.generateClick)
    expect(hook.result.current.addCue).toBe(first.addCue)
    // Sem nada mudar no estado, o objeto inteiro também é o mesmo.
    expect(hook.result.current).toBe(first)
  })

  it('detectBpm mede no canal de bateria do palco e mostra a frase', async () => {
    const hook = await mount()
    await act(async () => { await run(hook.result.current.detectBpm()) })
    expect(mocks.measureGrid).toHaveBeenCalled()
    expect(hook.result.current.bpm).toBe('98.4')
    expect(hook.result.current.gridInfo).toBe('98.40 BPM medido na faixa Bateria.')
  })
})

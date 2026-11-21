import { describe, expect, it, vi } from 'vitest'
import type { SavedSeparation } from '../../hooks/useSeparationLibrary'
import {
  OPEN_ERROR_TEXT, STAGE_LOAD_ERROR_TEXT, fetchSeparationFiles, findSeparationSong, pendingSeparationStep, separationChannelStates, separationStageMeta, stemsToOpen,
} from './stageHandoff'

const TRAVESSAO = String.fromCharCode(0x2014)

const sep = (over: Partial<SavedSeparation> = {}): SavedSeparation => ({
  id: 'sep_1', songName: 'Águas', artist: '', bpm: '120', songKey: 'C', voiceCues: [], createdAt: 1_700_000_000_000,
  stems: [
    { id: 'vocals', name: 'Vocais', url: 'https://r2/v.wav', color: '#06b6d4', state: { muted: false, soloed: true, volume: 0.7, pan: 0.2 } },
    { id: 'metronome', name: 'Metrônomo', url: 'blob:local', color: '#e2e8f0' },
    { id: 'drums', name: 'Bateria', url: 'http://r2/d.wav', color: '#f59e0b' },
  ],
  ...over,
})

const okResponse = (body: string, type = 'audio/wav') => ({ ok: true, status: 200, blob: async () => new Blob([body], { type }) }) as unknown as Response

describe('stageHandoff', () => {
  it('separationStageMeta: 120 e C viram sem valor; 72.5 e G# ficam; artista entra no nome', () => {
    expect(separationStageMeta(sep())).toEqual({ name: 'Águas', artist: undefined, bpm: undefined, originalKey: undefined, separation: { id: 'sep_1', createdAt: 1_700_000_000_000 } })
    expect(separationStageMeta(sep({ bpm: '72.5', songKey: 'G#', artist: 'Hillsong' }))).toEqual({
      name: 'Hillsong - Águas', artist: 'Hillsong', bpm: 72.5, originalKey: 'G#', separation: { id: 'sep_1', createdAt: 1_700_000_000_000 },
    })
    expect(separationStageMeta(sep({ songName: '' })).name).toBe('Sem título')
    // BPM que não é número entre 20 e 300 e tom fora da lista: sem valor.
    expect(separationStageMeta(sep({ bpm: 'abc' })).bpm).toBeUndefined()
    expect(separationStageMeta(sep({ bpm: '10' })).bpm).toBeUndefined()
    expect(separationStageMeta(sep({ bpm: '400' })).bpm).toBeUndefined()
    expect(separationStageMeta(sep({ songKey: 'H' })).originalKey).toBeUndefined()
  })

  it('stemsToOpen pula a faixa local (blob:) e mantém a ordem', () => {
    expect(stemsToOpen(sep()).map((s) => s.id)).toEqual(['vocals', 'drums'])
  })

  it('separationChannelStates leva o mixer salvo e deixa vazio o que não tem', () => {
    expect(separationChannelStates(stemsToOpen(sep()))).toEqual([{ muted: false, soloed: true, volume: 0.7, pan: 0.2 }, undefined])
  })

  it('fetchSeparationFiles baixa uma por vez e conta o progresso', async () => {
    let inFlight = 0
    let maxInFlight = 0
    const fetchImpl = vi.fn(async (url: string) => {
      inFlight++
      maxInFlight = Math.max(maxInFlight, inFlight)
      await new Promise((r) => setTimeout(r, 1))
      inFlight--
      return okResponse(url, url.includes('d.wav') ? '' : 'audio/wav')
    }) as unknown as typeof fetch
    const progress: string[] = []
    const stems = [...stemsToOpen(sep()), { id: 'x', name: '', url: 'https://r2/x.wav', color: '#fff' }]
    const files = await fetchSeparationFiles(stems, { fetchImpl, onProgress: (d, t) => progress.push(`${d}/${t}`) })
    expect(maxInFlight).toBe(1)
    expect(progress).toEqual(['0/3', '1/3', '2/3', '3/3'])
    expect(files.map((f) => f.name)).toEqual(['Vocais.wav', 'Bateria.wav', 'Faixa 3.wav'])
    expect(files.map((f) => f.type)).toEqual(['audio/wav', 'audio/wav', 'audio/wav'])
  })

  it('uma faixa que falha derruba o conjunto e nada é devolvido', async () => {
    let n = 0
    const fetchImpl = vi.fn(async () => (++n === 2 ? ({ ok: false, status: 404, blob: async () => new Blob() } as unknown as Response) : okResponse('a'))) as unknown as typeof fetch
    await expect(fetchSeparationFiles(stemsToOpen(sep()), { fetchImpl })).rejects.toThrow()
    const offline = vi.fn(async () => { throw new TypeError('Failed to fetch') }) as unknown as typeof fetch
    await expect(fetchSeparationFiles(stemsToOpen(sep()), { fetchImpl: offline })).rejects.toThrow()
  })

  it('abort no meio para de baixar', async () => {
    const ctrl = new AbortController()
    const fetchImpl = vi.fn(async () => { ctrl.abort(); return okResponse('a') }) as unknown as typeof fetch
    await expect(fetchSeparationFiles(stemsToOpen(sep()), { fetchImpl, signal: ctrl.signal })).rejects.toThrow()
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('sem nenhuma faixa remota, não há o que abrir', async () => {
    await expect(fetchSeparationFiles([], { fetchImpl: vi.fn() as unknown as typeof fetch })).rejects.toThrow()
  })

  it('findSeparationSong acha a separação no repertório', () => {
    expect(findSeparationSong([{}, { separation: { id: 's1' } }], 's1')).toBe(1)
    expect(findSeparationSong([], 's1')).toBe(-1)
    expect(findSeparationSong([{ separation: { id: 's2' } }], 's1')).toBe(-1)
  })

  // sep-1 C1: a separação que chega com as faixas espera o motor e a restauração do repertório; a
  // que o repertório restaurado já tem só pula (nada de baixar e carregar de novo, P7).
  it('pendingSeparationStep espera o motor e a restauração, pula a que já está no repertório e senão carrega', () => {
    const restored = [{ separation: { id: 'velha' } }, { separation: { id: 'sep_1' } }]
    expect(pendingSeparationStep('sep_1', { isReady: false, isRestoring: false }, [])).toBe('esperar')
    expect(pendingSeparationStep('sep_1', { isReady: true, isRestoring: true }, [])).toBe('esperar')
    expect(pendingSeparationStep('sep_1', { isReady: true, isRestoring: false }, restored)).toBe('pular')
    expect(pendingSeparationStep('nova', { isReady: true, isRestoring: false }, restored)).toBe('carregar')
    expect(pendingSeparationStep('nova', { isReady: true, isRestoring: false }, [])).toBe('carregar')
  })

  it('OPEN_ERROR_TEXT sem travessão', () => {
    expect(STAGE_LOAD_ERROR_TEXT).not.toContain(TRAVESSAO)
    expect(OPEN_ERROR_TEXT).not.toContain(TRAVESSAO)
    expect(OPEN_ERROR_TEXT).toBe('Não deu pra baixar as faixas da separação. Confira a internet e tente de novo.')
  })
})

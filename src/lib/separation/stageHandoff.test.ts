import { describe, expect, it, vi } from 'vitest'
import type { SavedSeparation } from '../../hooks/useSeparationLibrary'
import {
  OPEN_ERROR_TEXT, OPEN_MISSING_TEXT, OPEN_QUOTA_TEXT, STAGE_LOAD_ERROR_TEXT, SeparationFetchError, fetchSeparationStems, openErrorText, type StemStore, findSeparationSong, pendingSeparationStep, separationChannelStates, separationStageMeta, stemsToOpen, storedStemsToDrop,
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

  // Manutenção (2026-11-27, Ruling SEP-memoria): cada faixa é gravada no aparelho enquanto desce
  // e só a id volta; nunca ficam todas as faixas cruas na memória juntas.
  function fakeStore() {
    const disk = new Map<string, File>()
    let n = 0
    const store: StemStore & { disk: Map<string, File> } = {
      disk,
      put: vi.fn(async (file: File) => { const id = `id${++n}`; disk.set(id, file); return id }),
      discard: vi.fn(async (ids: readonly string[]) => { for (const id of ids) disk.delete(id) }),
    }
    return store
  }

  it('fetchSeparationStems baixa uma por vez, grava cada uma antes de baixar a próxima e conta o progresso', async () => {
    const store = fakeStore()
    let inFlight = 0
    let maxInFlight = 0
    const gravadasAoPedir: number[] = []
    const fetchImpl = vi.fn(async (url: string) => {
      gravadasAoPedir.push(store.disk.size)
      inFlight++
      maxInFlight = Math.max(maxInFlight, inFlight)
      await new Promise((r) => setTimeout(r, 1))
      inFlight--
      return okResponse(url, url.includes('d.wav') ? '' : 'audio/wav')
    }) as unknown as typeof fetch
    const progress: string[] = []
    const stems = [...stemsToOpen(sep()), { id: 'x', name: '', url: 'https://r2/x.wav', color: '#fff' }]
    const stored = await fetchSeparationStems(stems, { store, fetchImpl, onProgress: (d, t) => progress.push(`${d}/${t}`) })
    expect(maxInFlight).toBe(1)
    // A faixa n só é pedida depois de as n-1 de antes estarem gravadas no aparelho.
    expect(gravadasAoPedir).toEqual([0, 1, 2])
    expect(progress).toEqual(['0/3', '1/3', '2/3', '3/3'])
    // Volta só a id e o nome: os bytes ficam no aparelho.
    expect(stored).toEqual([{ id: 'id1', name: 'Vocais.wav' }, { id: 'id2', name: 'Bateria.wav' }, { id: 'id3', name: 'Faixa 3.wav' }])
    expect([...store.disk.values()].map((f) => [f.name, f.type])).toEqual([['Vocais.wav', 'audio/wav'], ['Bateria.wav', 'audio/wav'], ['Faixa 3.wav', 'audio/wav']])
    expect(store.discard).not.toHaveBeenCalled()
  })

  it('uma faixa que falha derruba o conjunto: nada é devolvido e o que foi gravado sai do aparelho', async () => {
    const store = fakeStore()
    let n = 0
    const fetchImpl = vi.fn(async () => (++n === 2 ? ({ ok: false, status: 404, blob: async () => new Blob() } as unknown as Response) : okResponse('a'))) as unknown as typeof fetch
    await expect(fetchSeparationStems(stemsToOpen(sep()), { store, fetchImpl })).rejects.toThrow()
    expect(store.discard).toHaveBeenCalledWith(['id1'])
    expect(store.disk.size).toBe(0)
    const offline = vi.fn(async () => { throw new TypeError('Failed to fetch') }) as unknown as typeof fetch
    await expect(fetchSeparationStems(stemsToOpen(sep()), { store, fetchImpl: offline })).rejects.toThrow()
    expect(store.disk.size).toBe(0)
  })

  it('gravar no aparelho falhou (disco cheio): derruba o conjunto e tira o que já tinha entrado', async () => {
    const store = fakeStore()
    const put = store.put as ReturnType<typeof vi.fn>
    put.mockImplementationOnce(async (file: File) => { store.disk.set('id1', file); return 'id1' })
    put.mockImplementationOnce(async () => { throw new DOMException('cheio', 'QuotaExceededError') })
    const fetchImpl = vi.fn(async () => okResponse('a')) as unknown as typeof fetch
    await expect(fetchSeparationStems(stemsToOpen(sep()), { store, fetchImpl })).rejects.toThrow()
    expect(store.discard).toHaveBeenCalledWith(['id1'])
    expect(store.disk.size).toBe(0)
  })

  it('abort no meio para de baixar e tira o que foi gravado; abort depois da última também', async () => {
    const store = fakeStore()
    const ctrl = new AbortController()
    // O Voltar chega enquanto a 2ª faixa desce: a 1ª já estava gravada no aparelho e sai.
    let n = 0
    const fetchImpl = vi.fn(async () => { if (++n === 2) ctrl.abort(); return okResponse('a') }) as unknown as typeof fetch
    await expect(fetchSeparationStems(stemsToOpen(sep()), { store, fetchImpl, signal: ctrl.signal })).rejects.toThrow()
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    expect(store.put).toHaveBeenCalledTimes(1)
    expect(store.discard).toHaveBeenCalledWith(['id1'])
    expect(store.disk.size).toBe(0)
    // O Voltar chegou enquanto a última faixa gravava: nada fica no aparelho.
    const late = new AbortController()
    const lastStore = fakeStore()
    const put = lastStore.put as ReturnType<typeof vi.fn>
    put.mockImplementation(async (file: File) => { const id = `id${lastStore.disk.size + 1}`; lastStore.disk.set(id, file); if (lastStore.disk.size === 2) late.abort(); return id })
    await expect(fetchSeparationStems(stemsToOpen(sep()), { store: lastStore, fetchImpl: vi.fn(async () => okResponse('a')) as unknown as typeof fetch, signal: late.signal })).rejects.toThrow()
    expect(lastStore.disk.size).toBe(0)
  })

  it('sem nenhuma faixa remota, não há o que abrir', async () => {
    const store = fakeStore()
    await expect(fetchSeparationStems([], { store, fetchImpl: vi.fn() as unknown as typeof fetch })).rejects.toThrow()
    expect(store.put).not.toHaveBeenCalled()
  })

  // Revisão do item 4 (M4): quais faixas gravadas saem do aparelho, dado o que aconteceu com a separação.
  it('storedStemsToDrop: só a que entrou (ou ainda espera) fica', () => {
    const stems = [{ id: 'a', name: 'Vocais.wav' }, { id: 'b', name: 'Bateria.wav' }]
    expect(storedStemsToDrop(stems, 'esperando')).toEqual([])
    expect(storedStemsToDrop(stems, 'entrou')).toEqual([])
    expect(storedStemsToDrop(stems, 'ja-no-repertorio')).toEqual(['a', 'b'])
    expect(storedStemsToDrop(stems, 'nao-entrou')).toEqual(['a', 'b'])
    expect(storedStemsToDrop(stems, 'substituida')).toEqual(['a', 'b'])
    expect(storedStemsToDrop([], 'nao-entrou')).toEqual([])
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

  // Revisão do item 4 (M2): disco cheio ao gravar a faixa no aparelho não culpa a internet.
  it('openErrorText: disco cheio (QuotaExceededError) tem a frase do espaço', async () => {
    const store = fakeStore()
    const put = store.put as ReturnType<typeof vi.fn>
    put.mockImplementationOnce(async () => { throw new DOMException('cheio', 'QuotaExceededError') })
    const err = await fetchSeparationStems(stemsToOpen(sep()), { store, fetchImpl: vi.fn(async () => okResponse('a')) as unknown as typeof fetch }).catch((e: unknown) => e)
    expect(openErrorText(err)).toBe(OPEN_QUOTA_TEXT)
    expect(OPEN_QUOTA_TEXT).toBe('Não tem espaço no aparelho pra abrir essa separação no palco. Libere espaço ou abra aqui no Separador.')
    // Erro com o mesmo nome que não é DOMException (o Safari antigo) também.
    expect(openErrorText({ name: 'QuotaExceededError' })).toBe(OPEN_QUOTA_TEXT)
    expect(openErrorText(new DOMException('x', 'AbortError'))).toBe(OPEN_ERROR_TEXT)
  })

  // sep-2 I3: faixa que o servidor diz que não existe (4xx) não culpa a internet.
  it('openErrorText: 4xx é a faixa que sumiu; 5xx, rede e o resto são a internet', async () => {
    const gone = vi.fn(async () => ({ ok: false, status: 404, blob: async () => new Blob() }) as unknown as Response) as unknown as typeof fetch
    const err = await fetchSeparationStems(stemsToOpen(sep()), { store: fakeStore(), fetchImpl: gone }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(SeparationFetchError)
    expect((err as SeparationFetchError).status).toBe(404)
    expect(openErrorText(err)).toBe(OPEN_MISSING_TEXT)
    expect(openErrorText(new SeparationFetchError(403))).toBe(OPEN_MISSING_TEXT)
    expect(openErrorText(new SeparationFetchError(500))).toBe(OPEN_ERROR_TEXT)
    expect(openErrorText(new TypeError('Failed to fetch'))).toBe(OPEN_ERROR_TEXT)
    expect(OPEN_MISSING_TEXT).not.toContain(TRAVESSAO)
  })

  it('OPEN_ERROR_TEXT sem travessão', () => {
    expect(STAGE_LOAD_ERROR_TEXT).not.toContain(TRAVESSAO)
    expect(OPEN_ERROR_TEXT).not.toContain(TRAVESSAO)
    expect(OPEN_ERROR_TEXT).toBe('Não deu pra baixar as faixas da separação. Confira a internet e tente de novo.')
  })
})

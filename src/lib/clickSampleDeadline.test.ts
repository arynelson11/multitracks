// Revisão macro BC (BC2-I3): o pedido da amostra do click tem prazo. Sem ele, um pacote perdido
// na rede (sem queda da conexão) deixava a geração esperando por minutos.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CLICK_SAMPLE_TIMEOUT_MESSAGE, CLICK_SAMPLE_TIMEOUT_MS, generateManualClickTrackFromSample } from './AudioAnalyzer'
import { FakeClickAudioContext } from '../test/clickShims'

let signals: AbortSignal[] = []

beforeEach(() => {
  vi.useFakeTimers()
  signals = []
  vi.stubGlobal('window', { AudioContext: FakeClickAudioContext })
  vi.stubGlobal('fetch', vi.fn((_url: string, init?: RequestInit) => {
    if (init?.signal) signals.push(init.signal)
    return new Promise(() => {})
  }))
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('gerador do click: prazo da amostra', () => {
  it('a amostra que não chega em 15 s faz a geração falhar com a frase em português e cancela o pedido', async () => {
    expect(CLICK_SAMPLE_TIMEOUT_MS).toBe(15_000)
    const gerando = generateManualClickTrackFromSample('Classic', 'quarter', 120, 60, true, '4/4')
    const falha = expect(gerando).rejects.toThrow(CLICK_SAMPLE_TIMEOUT_MESSAGE)
    await vi.advanceTimersByTimeAsync(CLICK_SAMPLE_TIMEOUT_MS - 1)
    expect(signals[0]?.aborted).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    await falha
    expect(signals[0]?.aborted).toBe(true)
    expect(CLICK_SAMPLE_TIMEOUT_MESSAGE).toBe('A amostra do click não chegou em 15 segundos. Confira a conexão e tente de novo.')
  })

  it('o corpo da resposta que engasga também cai no prazo', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, arrayBuffer: () => new Promise<ArrayBuffer>(() => {}) })))
    const gerando = generateManualClickTrackFromSample('Classic', 'quarter', 120, 60, true, '4/4')
    const falha = expect(gerando).rejects.toThrow(CLICK_SAMPLE_TIMEOUT_MESSAGE)
    await vi.advanceTimersByTimeAsync(CLICK_SAMPLE_TIMEOUT_MS)
    await falha
  })
})

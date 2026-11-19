// @vitest-environment jsdom
// Onda grande com a música inteira (Ruling ONDA-MIX, dono 2026-11-19: "a música começa onde está a
// agulha, mas nessa parte não tem a onda"): o maior pico, por intervalo, entre todos os canais Normal
// (os dois lados do estéreo), calculado aos pedaços cedendo a vez à tela e cancelado se a música trocar.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { waveformMixChannels } from '../../lib/channelRoles'
import { useMixPeaks } from './useMixPeaks'
import { computeMixPeaks, computePeaks } from './wavePeaks'
import type { MixPeaksOptions } from './wavePeaks'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.useRealTimers()
})

/** AudioBuffer falso: só o que a onda lê (lados e amostras). */
const buffer = (...sides: number[][]): AudioBuffer => {
  const data = sides.map((s) => Float32Array.from(s))
  return { numberOfChannels: data.length, length: data[0]?.length ?? 0, getChannelData: (c: number) => data[c] } as unknown as AudioBuffer
}
/** `n` amostras caladas e depois `m` em `v`. */
const lateEntry = (n: number, m: number, v: number) => [...Array(n).fill(0), ...Array(m).fill(v)]
const nop = () => null

describe('computeMixPeaks', () => {
  it('com um canal só é a mesma conta do computePeaks', async () => {
    const one = Float32Array.from({ length: 1003 }, (_, i) => Math.sin(i / 7) * (i % 13) / 13)
    const mixed = await computeMixPeaks([one], 64, { yieldIfDue: nop })
    expect([...mixed!]).toEqual([...computePeaks(one, 64)])
  })

  it('um canal calado no começo e outro tocando: a onda tem pico no começo (o maior dos dois por intervalo)', async () => {
    const baixo = Float32Array.from(lateEntry(60, 40, 0.8)) // só entra em 60%
    const bateria = Float32Array.from(Array(100).fill(0).map((_, i) => (i % 2 ? -0.4 : 0.2)))
    const mixed = (await computeMixPeaks([baixo, bateria], 10, { yieldIfDue: nop }))!
    expect(computePeaks(baixo, 10)[0]).toBe(0) // a onda antiga (um canal) era vazia no começo
    expect(mixed[0]).toBeCloseTo(0.5) // 0,4 (lado negativo conta) / 0,8
    expect(mixed[9]).toBe(1)
  })

  it('lados e tamanhos diferentes: a amostra que falta conta 0 e o intervalo vem do maior', async () => {
    const curto = Float32Array.from([0.1, 0.1])
    const longo = Float32Array.from([0, 0, 0, -0.9])
    expect([...(await computeMixPeaks([curto, longo], 2, { yieldIfDue: nop }))!].map((v) => +v.toFixed(4))).toEqual([0.1111, 1])
    expect([...(await computeMixPeaks([], 3, { yieldIfDue: nop }))!]).toEqual([0, 0, 0])
  })

  it('cede a vez aos pedaços e para no meio quando cancelado (devolve nulo)', async () => {
    const a = Float32Array.from({ length: 400 }, () => 0.5)
    const ctrl = new AbortController()
    let pauses = 0
    const yieldIfDue = () => {
      pauses++
      if (pauses === 3) ctrl.abort() // a música trocou no meio
      return Promise.resolve()
    }
    const opts: MixPeaksOptions = { signal: ctrl.signal, yieldIfDue }
    expect(await computeMixPeaks([a, a, a], 100, opts)).toBeNull()
    expect(pauses).toBe(3) // nenhum pedaço depois do cancelamento
  })

  it('sem quem ceda a vez, cede sozinho com setTimeout a cada 4 ms de trabalho (como o gerador do click)', async () => {
    let now = 0
    vi.spyOn(performance, 'now').mockImplementation(() => ++now) // cada leitura do relógio: +1 ms
    const timeout = vi.spyOn(globalThis, 'setTimeout')
    const one = Float32Array.from({ length: 800 }, (_, i) => (i % 5) / 5)
    const mixed = await computeMixPeaks([one], 16)
    expect([...mixed!]).toEqual([...computePeaks(one, 16)])
    const yields = timeout.mock.calls.filter(([, ms]) => !ms).length
    expect(yields).toBeGreaterThanOrEqual(3) // 16 intervalos de 1 ms: cede a cada ~4
    expect(yields).toBeLessThanOrEqual(5)
  })
})

describe('canais da onda grande (waveformMixChannels)', () => {
  it('todos os Normal, com bateria e percussão; Click e Guia não entram (pelo nome ou pelo papel manual)', () => {
    const list = [
      { id: 'c', name: 'CLICK' }, { id: 'g', name: 'Voz Guia' }, { id: 'd', name: 'DRUMS' }, { id: 'p', name: 'SHAKER' },
      { id: 'b', name: 'BASS' }, { id: 'x', name: 'Track 9', role: 'guide' as const }, { id: 'm', name: 'Metronome' },
      { id: 'n', name: 'CLICK 2', role: 'normal' as const }, { id: 'v', name: 'Vocal' },
    ]
    expect(waveformMixChannels(list).map((c) => c.id)).toEqual(['d', 'p', 'b', 'n', 'v'])
    expect(waveformMixChannels([{ id: 'c', name: 'CLICK' }, { id: 'g', name: 'GUIA' }])).toEqual([])
  })
})

describe('useMixPeaks', () => {
  it('mostra a onda quando fica pronta: o canal calado no começo não apaga o começo da música', async () => {
    const baixo = buffer(lateEntry(60, 40, 0.8))
    const teclado = buffer(Array(100).fill(0), lateEntry(0, 100, 0.4)) // estéreo: só o lado direito toca
    const { result } = renderHook(() => useMixPeaks([baixo, teclado], 10))
    await waitFor(() => expect(result.current).not.toBeNull())
    expect(result.current![0]).toBeCloseTo(0.5)
    expect(result.current![9]).toBe(1)
  })

  it('lista nova com os mesmos canais (fader mexido) não recalcula; outra música cancela o cálculo velho e nunca mostra a onda dele', async () => {
    const calls: { signal: AbortSignal; resolve: (p: Float32Array) => void }[] = []
    const compute = vi.fn((_s: readonly Float32Array[], _b: number, opts: MixPeaksOptions = {}) => new Promise<Float32Array | null>((resolve) => {
      calls.push({ signal: opts.signal!, resolve })
    }))
    const a = buffer([0.1, 0.2])
    const b = buffer([0.3, 0.4])
    const { result, rerender } = renderHook(({ list }) => useMixPeaks(list, 2, compute), { initialProps: { list: [a] as readonly AudioBuffer[] } })
    expect(compute).toHaveBeenCalledTimes(1)
    rerender({ list: [a] }) // o App monta a lista de novo a cada fader mexido
    expect(compute).toHaveBeenCalledTimes(1)
    expect(result.current).toBeNull() // até ficar pronta: vazia
    rerender({ list: [b] }) // a música trocou (AUTO) antes de terminar
    expect(compute).toHaveBeenCalledTimes(2)
    expect(calls[0].signal.aborted).toBe(true)
    expect(calls[1].signal.aborted).toBe(false)
    await act(async () => { calls[0].resolve(Float32Array.from([1, 1])) }) // o velho termina mesmo assim
    expect(result.current).toBeNull()
    await act(async () => { calls[1].resolve(Float32Array.from([0.5, 1])) })
    expect([...result.current!]).toEqual([0.5, 1])
    // Sem música (ou palco antigo): nada calculado, nada mostrado.
    rerender({ list: null as unknown as readonly AudioBuffer[] })
    expect(calls[1].signal.aborted).toBe(true)
    expect(result.current).toBeNull()
    expect(compute).toHaveBeenCalledTimes(2)
  })
})

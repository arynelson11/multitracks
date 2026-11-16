// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, renderHook } from '@testing-library/react'
import { useFrame } from './useFrame'

// requestAnimationFrame falso: guarda os pedidos e solta um quadro por vez.
let pending = new Map<number, FrameRequestCallback>()
let nextId = 1
let requests = 0
const frame = (t: number) => {
  const due = [...pending.values()]
  pending = new Map()
  for (const cb of due) cb(t)
}

beforeEach(() => {
  pending = new Map()
  nextId = 1
  requests = 0
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    requests++
    const id = nextId++
    pending.set(id, cb)
    return id
  })
  vi.stubGlobal('cancelAnimationFrame', (id: number) => { pending.delete(id) })
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('laço de quadro', () => {
  it('chama a cada quadro e para no unmount', () => {
    const cb = vi.fn()
    const { unmount } = renderHook(() => useFrame(cb))
    frame(16)
    frame(32)
    expect(cb.mock.calls).toEqual([[16], [32]])
    unmount()
    expect(pending.size).toBe(0)
    frame(48)
    expect(cb).toHaveBeenCalledTimes(2)
  })
  it('não chama com active false', () => {
    const cb = vi.fn()
    renderHook(() => useFrame(cb, false))
    frame(16)
    expect(cb).not.toHaveBeenCalled()
    expect(pending.size).toBe(0)
  })
  it('liga e desliga pelo active', () => {
    const cb = vi.fn()
    const { rerender } = renderHook(({ on }) => useFrame(cb, on), { initialProps: { on: false } })
    rerender({ on: true })
    frame(16)
    expect(cb).toHaveBeenCalledTimes(1)
    rerender({ on: false })
    expect(pending.size).toBe(0)
    frame(32)
    expect(cb).toHaveBeenCalledTimes(1)
  })
  it('usa o callback mais novo sem reiniciar o laço', () => {
    const first = vi.fn()
    const second = vi.fn()
    const { rerender } = renderHook(({ cb }) => useFrame(cb), { initialProps: { cb: first } })
    frame(16)
    const before = requests
    rerender({ cb: second })
    expect(requests).toBe(before)
    frame(32)
    expect(first.mock.calls).toEqual([[16]])
    expect(second.mock.calls).toEqual([[32]])
  })
  it('um quadro que lança não congela o palco: o próximo já estava pedido', () => {
    let n = 0
    const cb = vi.fn(() => { n++; if (n === 1) throw new Error('quadro ruim') })
    renderHook(() => useFrame(cb))
    expect(() => frame(16)).toThrow('quadro ruim')
    frame(32)
    expect(cb).toHaveBeenCalledTimes(2)
  })
})

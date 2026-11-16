import { afterEach, describe, expect, it, vi } from 'vitest'
import { CLOCK_INTERVAL_MS, createSchedulerClock, type WorkerLike } from './schedulerClock'

const TRAVESSAO = String.fromCharCode(0x2014)

interface FakeWorker extends WorkerLike { sent: unknown[]; terminated: boolean }
function fakeWorker(): FakeWorker {
  const w: FakeWorker = {
    sent: [], terminated: false, onmessage: null,
    postMessage(m) { w.sent.push(m) },
    terminate() { w.terminated = true },
  }
  return w
}

/** Worker do navegador falso, pro caminho padrão (sem createWorker): só o que o relógio usa. */
class FakeBrowserWorker {
  static made: FakeBrowserWorker[] = []
  readonly url: string
  readonly sent: unknown[] = []
  terminated = false
  onmessage: ((e: MessageEvent) => void) | null = null
  onerror: ((e: Event) => void) | null = null
  constructor(url: string) { this.url = url; FakeBrowserWorker.made.push(this) }
  postMessage(m: unknown) { this.sent.push(m) }
  terminate() { this.terminated = true }
  emit() { this.onmessage?.(new MessageEvent('message', { data: 0 })) }
  fail() { this.onerror?.(new Event('error')) }
}

afterEach(() => { vi.unstubAllGlobals(); FakeBrowserWorker.made = [] })

it('o relógio usa Worker e não setInterval da janela', () => {
  const setIntervalFn = vi.fn(); const w = fakeWorker(); const onTick = vi.fn(); const revokeObjectURL = vi.fn()
  const clock = createSchedulerClock(onTick, { createWorker: () => w, createObjectURL: () => 'blob:x', revokeObjectURL, setIntervalFn })
  clock.start(); expect(w.sent).toEqual(['start']); w.onmessage!({ data: 0 }); expect(onTick).toHaveBeenCalledTimes(1)
  clock.stop(); clock.dispose(); expect(w.terminated).toBe(true); expect(revokeObjectURL).toHaveBeenCalledWith('blob:x'); expect(setIntervalFn).not.toHaveBeenCalled()
})

it('sem Worker cai no setInterval e avisa', () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  const setIntervalFn = vi.fn().mockReturnValue(42); const clearIntervalFn = vi.fn(); const onTick = vi.fn(); const revokeObjectURL = vi.fn()
  const clock = createSchedulerClock(onTick, {
    createWorker: () => { throw new Error('Worker indisponível') }, createObjectURL: () => 'blob:x', revokeObjectURL, setIntervalFn, clearIntervalFn,
  })
  clock.start()
  expect(setIntervalFn).toHaveBeenCalledTimes(1)
  expect(setIntervalFn).toHaveBeenCalledWith(expect.any(Function), CLOCK_INTERVAL_MS)
  expect(revokeObjectURL).toHaveBeenCalledWith('blob:x') // o Blob do Worker que não nasceu não fica preso
  expect(warn).toHaveBeenCalledTimes(1)
  const text = String(warn.mock.calls[0][0])
  expect(text).toContain('Worker'); expect(text).toContain('segundo plano'); expect(text).not.toContain(TRAVESSAO)
  const handler = setIntervalFn.mock.calls[0][0] as () => void
  handler(); expect(onTick).toHaveBeenCalledTimes(1)
  clock.stop(); expect(clearIntervalFn).toHaveBeenCalledWith(42)
  handler(); expect(onTick).toHaveBeenCalledTimes(1) // tique atrasado depois do stop não chega
  clock.start(); expect(setIntervalFn).toHaveBeenCalledTimes(2); expect(warn).toHaveBeenCalledTimes(1) // avisa uma vez só
  clock.dispose(); expect(clearIntervalFn).toHaveBeenCalledTimes(2); expect(clock.running).toBe(false)
})

describe('relógio com Worker', () => {
  it('liga e desliga quantas vezes for preciso com o mesmo Worker, criado só no primeiro start', () => {
    const w = fakeWorker(); const createWorker = vi.fn(() => w); const onTick = vi.fn()
    const clock = createSchedulerClock(onTick, { createWorker, createObjectURL: () => 'blob:x', revokeObjectURL: vi.fn() })
    expect(createWorker).not.toHaveBeenCalled(); expect(clock.running).toBe(false)
    clock.start(); clock.start(); expect(clock.running).toBe(true)
    clock.stop(); clock.stop(); expect(clock.running).toBe(false)
    clock.start()
    expect(w.sent).toEqual(['start', 'stop', 'start'])
    expect(createWorker).toHaveBeenCalledTimes(1); expect(createWorker).toHaveBeenCalledWith('blob:x')
  })
  it('tique que chega com o relógio parado é ignorado', () => {
    const w = fakeWorker(); const onTick = vi.fn()
    const clock = createSchedulerClock(onTick, { createWorker: () => w, createObjectURL: () => 'blob:x', revokeObjectURL: vi.fn() })
    clock.start(); clock.stop(); w.onmessage!({ data: 0 })
    expect(onTick).not.toHaveBeenCalled()
  })
  it('dispose libera uma vez só e o relógio não liga mais', () => {
    const w = fakeWorker(); const terminate = vi.spyOn(w, 'terminate'); const revokeObjectURL = vi.fn(); const setIntervalFn = vi.fn()
    const clock = createSchedulerClock(vi.fn(), { createWorker: () => w, createObjectURL: () => 'blob:x', revokeObjectURL, setIntervalFn })
    clock.start(); clock.dispose(); clock.dispose()
    expect(w.sent).toEqual(['start', 'stop']); expect(w.onmessage).toBeNull()
    expect(terminate).toHaveBeenCalledTimes(1); expect(revokeObjectURL).toHaveBeenCalledTimes(1)
    clock.start()
    expect(clock.running).toBe(false); expect(w.sent).toEqual(['start', 'stop']); expect(setIntervalFn).not.toHaveBeenCalled()
  })
  it('dispose sem nunca ter ligado não cria Worker', () => {
    const createWorker = vi.fn(fakeWorker); const createObjectURL = vi.fn(() => 'blob:x')
    createSchedulerClock(vi.fn(), { createWorker, createObjectURL, revokeObjectURL: vi.fn() }).dispose()
    expect(createWorker).not.toHaveBeenCalled(); expect(createObjectURL).not.toHaveBeenCalled()
  })
  it('o código do Worker vem de um Blob e posta um tique a cada intervalo entre start e stop', async () => {
    const blobs: Blob[] = []
    const createObjectURL = (b: Blob) => { blobs.push(b); return 'blob:x' }
    createSchedulerClock(vi.fn(), { intervalMs: 40, createWorker: fakeWorker, createObjectURL, revokeObjectURL: vi.fn() }).start()
    expect(blobs).toHaveLength(1); expect(blobs[0].type).toBe('text/javascript')
    const source = await blobs[0].text()
    // Roda o código do Worker com o escopo dele falso: self, setInterval e clearInterval.
    const posted: unknown[] = []
    const scope: { onmessage: ((e: { data: unknown }) => void) | null; postMessage(m: unknown): void } = { onmessage: null, postMessage: (m) => posted.push(m) }
    const timers = new Map<number, () => void>(); let nextId = 1
    const setIntervalInWorker = vi.fn((fn: () => void) => { const id = nextId++; timers.set(id, fn); return id })
    const clearIntervalInWorker = vi.fn((id: number) => { timers.delete(id) })
    new Function('self', 'setInterval', 'clearInterval', source)(scope, setIntervalInWorker, clearIntervalInWorker)
    scope.onmessage!({ data: 'start' }); scope.onmessage!({ data: 'start' })
    expect(setIntervalInWorker).toHaveBeenCalledTimes(1); expect(setIntervalInWorker).toHaveBeenCalledWith(expect.any(Function), 40)
    for (const fn of timers.values()) fn()
    expect(posted).toEqual([0])
    scope.onmessage!({ data: 'stop' })
    expect(clearIntervalInWorker).toHaveBeenCalledTimes(1); expect(timers.size).toBe(0)
    scope.onmessage!({ data: 'start' }); expect(setIntervalInWorker).toHaveBeenCalledTimes(2)
  })
  it('intervalo inválido usa o padrão de 25 ms', () => {
    const setIntervalFn = vi.fn()
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    for (const intervalMs of [0, -5, NaN, Infinity]) {
      createSchedulerClock(vi.fn(), { intervalMs, createWorker: () => { throw new Error('x') }, createObjectURL: () => 'blob:x', revokeObjectURL: vi.fn(), setIntervalFn }).start()
    }
    expect(setIntervalFn.mock.calls.map((c) => c[1])).toEqual([25, 25, 25, 25])
    expect(CLOCK_INTERVAL_MS).toBe(25)
  })
})

describe('caminho padrão (Worker do navegador)', () => {
  it('cria o Worker pela Blob URL e repassa o tique', () => {
    vi.stubGlobal('Worker', FakeBrowserWorker)
    const onTick = vi.fn(); const setIntervalFn = vi.fn()
    const clock = createSchedulerClock(onTick, { createObjectURL: () => 'blob:y', revokeObjectURL: vi.fn(), setIntervalFn })
    clock.start()
    const [w] = FakeBrowserWorker.made
    expect(FakeBrowserWorker.made).toHaveLength(1); expect(w.url).toBe('blob:y'); expect(w.sent).toEqual(['start'])
    w.emit(); expect(onTick).toHaveBeenCalledTimes(1)
    clock.dispose(); expect(w.terminated).toBe(true); expect(setIntervalFn).not.toHaveBeenCalled()
  })
  it('Worker ausente cai no setInterval e avisa', () => {
    vi.stubGlobal('Worker', undefined)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const setIntervalFn = vi.fn(); const revokeObjectURL = vi.fn()
    createSchedulerClock(vi.fn(), { createObjectURL: () => 'blob:z', revokeObjectURL, setIntervalFn }).start()
    expect(setIntervalFn).toHaveBeenCalledTimes(1); expect(warn).toHaveBeenCalledTimes(1); expect(revokeObjectURL).toHaveBeenCalledWith('blob:z')
  })
  it('Worker que falha depois de nascer cai no setInterval sem parar o relógio', () => {
    vi.stubGlobal('Worker', FakeBrowserWorker)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const onTick = vi.fn(); const setIntervalFn = vi.fn().mockReturnValue(7); const clearIntervalFn = vi.fn(); const revokeObjectURL = vi.fn()
    const clock = createSchedulerClock(onTick, { createObjectURL: () => 'blob:y', revokeObjectURL, setIntervalFn, clearIntervalFn })
    clock.start()
    const [w] = FakeBrowserWorker.made
    w.fail()
    expect(warn).toHaveBeenCalledTimes(1); expect(w.terminated).toBe(true); expect(revokeObjectURL).toHaveBeenCalledWith('blob:y')
    expect(clock.running).toBe(true); expect(setIntervalFn).toHaveBeenCalledTimes(1)
    ;(setIntervalFn.mock.calls[0][0] as () => void)(); expect(onTick).toHaveBeenCalledTimes(1)
    w.emit(); expect(onTick).toHaveBeenCalledTimes(1) // o Worker largado não manda mais tique
    clock.stop(); expect(clearIntervalFn).toHaveBeenCalledWith(7)
    clock.start(); expect(FakeBrowserWorker.made).toHaveLength(1); expect(setIntervalFn).toHaveBeenCalledTimes(2)
  })
  it('falha do Worker com o relógio parado só troca o caminho; o setInterval liga no próximo start', () => {
    vi.stubGlobal('Worker', FakeBrowserWorker)
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const setIntervalFn = vi.fn()
    const clock = createSchedulerClock(vi.fn(), { createObjectURL: () => 'blob:y', revokeObjectURL: vi.fn(), setIntervalFn, clearIntervalFn: vi.fn() })
    clock.start(); clock.stop()
    FakeBrowserWorker.made[0].fail()
    expect(setIntervalFn).not.toHaveBeenCalled()
    clock.start(); expect(setIntervalFn).toHaveBeenCalledTimes(1)
  })
})

describe('modo do relógio (a T17 aumenta o horizonte ou avisa o operador)', () => {
  it('com Worker fica em worker e não chama o onFallback', () => {
    const onFallback = vi.fn()
    const clock = createSchedulerClock(vi.fn(), { createWorker: fakeWorker, createObjectURL: () => 'blob:x', revokeObjectURL: vi.fn(), onFallback })
    expect(clock.mode).toBe('worker')
    clock.start(); clock.stop(); clock.start()
    expect(clock.mode).toBe('worker'); expect(onFallback).not.toHaveBeenCalled()
  })
  it('Worker que não nasce: modo interval e onFallback uma vez, com o motivo', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const motivo = new Error('Worker indisponível'); const onFallback = vi.fn()
    const clock = createSchedulerClock(vi.fn(), {
      createWorker: () => { throw motivo }, createObjectURL: () => 'blob:x', revokeObjectURL: vi.fn(), setIntervalFn: vi.fn(), clearIntervalFn: vi.fn(), onFallback,
    })
    expect(clock.mode).toBe('worker') // o Worker só é tentado no primeiro start
    clock.start()
    expect(clock.mode).toBe('interval'); expect(onFallback).toHaveBeenCalledTimes(1); expect(onFallback).toHaveBeenCalledWith(motivo)
    clock.stop(); clock.start()
    expect(onFallback).toHaveBeenCalledTimes(1)
  })
  it('Worker que falha depois de nascer: modo interval e onFallback com o evento de erro', () => {
    vi.stubGlobal('Worker', FakeBrowserWorker)
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const onFallback = vi.fn()
    const clock = createSchedulerClock(vi.fn(), { createObjectURL: () => 'blob:y', revokeObjectURL: vi.fn(), setIntervalFn: vi.fn(), clearIntervalFn: vi.fn(), onFallback })
    clock.start(); expect(clock.mode).toBe('worker')
    FakeBrowserWorker.made[0].fail()
    expect(clock.mode).toBe('interval'); expect(onFallback).toHaveBeenCalledTimes(1); expect(onFallback.mock.calls[0][0]).toBeInstanceOf(Event)
  })
  it('onFallback que lança não derruba o relógio', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const onTick = vi.fn(); const setIntervalFn = vi.fn()
    const clock = createSchedulerClock(onTick, {
      createWorker: () => { throw new Error('x') }, createObjectURL: () => 'blob:x', revokeObjectURL: vi.fn(), setIntervalFn, clearIntervalFn: vi.fn(),
      onFallback: () => { throw new Error('ouvinte quebrado') },
    })
    expect(() => clock.start()).not.toThrow()
    expect(clock.running).toBe(true); expect(clock.mode).toBe('interval'); expect(setIntervalFn).toHaveBeenCalledTimes(1); expect(error).toHaveBeenCalledTimes(1)
    ;(setIntervalFn.mock.calls[0][0] as () => void)(); expect(onTick).toHaveBeenCalledTimes(1)
  })
})

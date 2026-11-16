import { describe, expect, it } from 'vitest'
import { asAudioContext, asFake, connectedTo, createFakeAudioContext, nodesOf, reaches, valueAt, type FakeAudioContext } from '../test/fakeAudio'
import { fadeOutVoices, restoreVoices, startVoice, startVoicesForSwitch, stopVoices, type Voice, type VoiceSpec } from './voices'

const buf = (ctx: FakeAudioContext, seconds: number) => ctx.createBuffer(2, Math.round(seconds * 48000), 48000)

describe('startVoice', () => {
  it('fonte, envelope em 1 e a entrada do canal, nessa ordem', () => {
    const ctx = createFakeAudioContext(); const entry = ctx.createStereoPanner(); const buffer = buf(ctx, 30)
    const v = startVoice(asAudioContext(ctx), { channelId: 'baixo', buffer, entry }, 3, 12)
    expect(v.channelId).toBe('baixo')
    expect(asFake(v.source).buffer).toBe(buffer)
    expect(connectedTo(v.source, v.env)).toBe(true); expect(connectedTo(v.env, entry)).toBe(true)
    expect(asFake(v.source).connections).toHaveLength(1); expect(asFake(v.env).connections).toHaveLength(1)
    expect(asFake(v.source).starts).toEqual([{ when: 3, offset: 12 }])
    expect(valueAt(v.env.gain, 3)).toBe(1)
    expect(valueAt(v.source.playbackRate, 3)).toBe(1)
    expect(asFake(v.source).loop).toBe(false)
  })
  it('offset negativo vira 0', () => {
    const ctx = createFakeAudioContext(); const entry = ctx.createGain()
    const v = startVoice(asAudioContext(ctx), { channelId: 'a', buffer: buf(ctx, 5), entry }, 1, -0.2)
    expect(asFake(v.source).starts).toEqual([{ when: 1, offset: 0 }])
  })
  it('velocidade vai no playbackRate e o metrônomo em loop continua em loop', () => {
    const ctx = createFakeAudioContext(); const entry = ctx.createGain()
    const v = startVoice(asAudioContext(ctx), { channelId: 'm', buffer: buf(ctx, 2), entry, loop: true }, 1, 0.5, 0.9)
    expect(valueAt(v.source.playbackRate, 1)).toBe(0.9)
    expect(asFake(v.source).loop).toBe(true)
  })
  it('ao terminar a fonte, fonte e envelope se desligam (mesmo com onended do motor por cima)', () => {
    const ctx = createFakeAudioContext(); const entry = ctx.createGain()
    const v = startVoice(asAudioContext(ctx), { channelId: 'a', buffer: buf(ctx, 5), entry }, 1, 0)
    let motorViu = false
    v.source.onended = () => { motorViu = true }
    v.source.dispatchEvent(new Event('ended'))
    expect(motorViu).toBe(true)
    expect(asFake(v.source).connections).toHaveLength(0); expect(asFake(v.env).connections).toHaveLength(0)
    expect(reaches(v.source, entry)).toBe(false)
  })
})

describe('startVoicesForSwitch', () => {
  it('voz nova entra na mesma entrada do canal e só cria fonte e ganho', () => {
    const ctx = createFakeAudioContext(); const entry = ctx.createDelay(1) // faz o papel do worklet ou do atraso do canal
    const before = ctx.created.length
    const [v] = startVoicesForSwitch(asAudioContext(ctx), [{ channelId: 'a', buffer: buf(ctx, 30), entry }], 10, 8, 0.005)
    expect(connectedTo(v.env, entry)).toBe(true); expect(asFake(v.source).starts).toEqual([{ when: 9.995, offset: 7.995 }])
    expect(valueAt(v.env.gain, 9.995)).toBe(0); expect(valueAt(v.env.gain, 10)).toBe(1)
    expect(valueAt(v.env.gain, 9.9975)).toBeCloseTo(0.5, 10)
    expect(ctx.created.slice(before).map((n) => n.kind).sort()).toEqual(['AudioBufferSourceNode', 'GainNode'])
  })
  it('alvo em 0:00 começa no instante, sem pré-rolagem', () => {
    const ctx = createFakeAudioContext(); const entry = ctx.createGain()
    const specs: VoiceSpec[] = [{ channelId: 'a', buffer: buf(ctx, 30), entry }]
    const [v] = startVoicesForSwitch(asAudioContext(ctx), specs, 10, 0, 0.005)
    expect(asFake(v.source).starts).toEqual([{ when: 10, offset: 0 }])
    expect(asFake(v.env.gain).events).toEqual([])
    expect(valueAt(v.env.gain, 10)).toBe(1)
  })
  it('alvo a menos de um fade do começo também entra no instante, com o offset do alvo', () => {
    const ctx = createFakeAudioContext(); const entry = ctx.createGain()
    const [v] = startVoicesForSwitch(asAudioContext(ctx), [{ channelId: 'a', buffer: buf(ctx, 30), entry }], 10, 0.003, 0.005)
    expect(asFake(v.source).starts).toEqual([{ when: 10, offset: 0.003 }])
    expect(valueAt(v.env.gain, 10)).toBe(1)
  })
  it('uma voz por canal, cada uma na sua entrada, todas no mesmo instante e offset', () => {
    const ctx = createFakeAudioContext()
    const entries = [ctx.createStereoPanner(), ctx.createDelay(1), ctx.createGain()]
    const specs = entries.map((entry, i) => ({ channelId: `c${i}`, buffer: buf(ctx, 30), entry }))
    const before = ctx.created.length
    const voices = startVoicesForSwitch(asAudioContext(ctx), specs, 20, 16, 0.005)
    expect(voices.map((v) => v.channelId)).toEqual(['c0', 'c1', 'c2'])
    voices.forEach((v, i) => {
      expect(connectedTo(v.env, entries[i])).toBe(true)
      entries.forEach((other, j) => { if (j !== i) expect(reaches(v.source, other)).toBe(false) })
      expect(asFake(v.source).starts).toEqual([{ when: 19.995, offset: 15.995 }])
    })
    expect(ctx.created.slice(before)).toHaveLength(6)
    expect(nodesOf(ctx, 'AudioWorkletNode')).toHaveLength(0)
  })
  it('com velocidade diferente de 1 a pré-rolagem anda fade x velocidade na música, pra chegar no alvo em T', () => {
    const ctx = createFakeAudioContext(); const entry = ctx.createGain()
    const [v] = startVoicesForSwitch(asAudioContext(ctx), [{ channelId: 'a', buffer: buf(ctx, 30), entry }], 10, 8, 0.005, 0.8)
    const [s] = asFake(v.source).starts
    expect(s.when).toBe(9.995)
    expect(s.offset).toBeCloseTo(8 - 0.005 * 0.8, 12)
    // No instante T a fonte andou fade x velocidade desde o offset: está no alvo.
    expect((s.offset ?? 0) + (10 - s.when) * 0.8).toBeCloseTo(8, 12)
    expect(valueAt(v.source.playbackRate, 10)).toBe(0.8)
  })
})

describe('fadeOutVoices e restoreVoices', () => {
  const setup = () => {
    const ctx = createFakeAudioContext(); const entry = ctx.createGain()
    const voices = [0, 1].map((i) => startVoice(asAudioContext(ctx), { channelId: `c${i}`, buffer: buf(ctx, 30), entry }, 0, 0))
    return { ctx, voices }
  }
  it('descida de 1 a 0 em [T - fade, T] e muda depois', () => {
    const { voices } = setup()
    fadeOutVoices(voices, 10, 0.005)
    for (const v of voices) {
      expect(valueAt(v.env.gain, 9.9)).toBe(1); expect(valueAt(v.env.gain, 9.995)).toBe(1)
      expect(valueAt(v.env.gain, 9.9975)).toBeCloseTo(0.5, 10)
      expect(valueAt(v.env.gain, 10)).toBe(0); expect(valueAt(v.env.gain, 12)).toBe(0)
    }
    // Só automação: a fonte continua, quem solta é o agendador.
    expect(asFake(voices[0].source).stops).toEqual([])
  })
  it('restaurar antes do pulo apaga a descida e o envelope fica em 1', () => {
    const { ctx, voices } = setup()
    fadeOutVoices(voices, 10, 0.005)
    ctx.currentTime = 9.5
    restoreVoices(voices, 9.5)
    for (const v of voices) {
      expect(asFake(v.env.gain).events.at(-1)).toEqual({ kind: 'linear', value: 1, time: 9.5 + 0.005 })
      for (const t of [9.5, 9.502, 9.995, 9.9975, 10, 15]) expect(valueAt(v.env.gain, t)).toBe(1)
    }
  })
  for (const withoutHold of [false, true]) {
    it(`restaurar no meio da descida volta a 1 em 5 ms, sem salto${withoutHold ? ' (sem cancelAndHoldAtTime)' : ''}`, () => {
      const { ctx, voices } = setup()
      fadeOutVoices(voices, 10, 0.005)
      const now = 9.9975 // envelope em 0,5
      const sr = ctx.sampleRate
      const tocado = voices.map((v) => valueAt(v.env.gain, now - 1 / sr)) // a amostra antes de now já saiu
      ctx.currentTime = now
      // Firefox não tem cancelAndHoldAtTime: cai em cancelScheduledValues + setValueAtTime(valor atual).
      if (withoutHold) for (const v of voices) Object.defineProperty(v.env.gain, 'cancelAndHoldAtTime', { value: undefined })
      restoreVoices(voices, now)
      voices.forEach((v, i) => {
        expect(valueAt(v.env.gain, now)).toBeCloseTo(0.5, 10)
        expect(valueAt(v.env.gain, now + 0.005)).toBe(1); expect(valueAt(v.env.gain, 10.01)).toBe(1); expect(valueAt(v.env.gain, 12)).toBe(1)
        let worst = 0; let prev = tocado[i]
        for (let k = 0; k <= 0.02 * sr; k++) { const g = valueAt(v.env.gain, now + k / sr); worst = Math.max(worst, Math.abs(g - prev)); prev = g }
        expect(worst).toBeLessThanOrEqual(1 / (0.005 * sr) + 1e-12) // nenhuma amostra muda mais que a rampa de 5 ms
      })
    })
  }
  it('lista vazia não faz nada', () => {
    expect(() => { fadeOutVoices([], 10, 0.005); restoreVoices([], 9); stopVoices([], 9) }).not.toThrow()
  })
})

describe('stopVoices', () => {
  it('para cada fonte no instante pedido', () => {
    const ctx = createFakeAudioContext(); const entry = ctx.createGain()
    const voices = [0, 1].map((i) => startVoice(asAudioContext(ctx), { channelId: `c${i}`, buffer: buf(ctx, 30), entry }, 1, 0))
    stopVoices(voices, 10.035)
    expect(voices.map((v) => asFake(v.source).stops)).toEqual([[10.035], [10.035]])
  })
  it('para fonte que nunca começou sem lançar, e as outras param mesmo assim', () => {
    const ctx = createFakeAudioContext(); const entry = ctx.createGain()
    const nunca: Voice = { channelId: 'x', source: ctx.createBufferSource(), env: ctx.createGain() }
    const tocando = startVoice(asAudioContext(ctx), { channelId: 'a', buffer: buf(ctx, 30), entry }, 1, 0)
    expect(() => stopVoices([nunca, tocando], 5)).not.toThrow()
    expect(asFake(nunca.source).stops).toEqual([])
    expect(asFake(tocando.source).stops).toEqual([5])
  })
})

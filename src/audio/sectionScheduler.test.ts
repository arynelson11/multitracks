import { describe, expect, it, vi } from 'vitest'
import { asAudioContext, asFake, createFakeAudioContext, nodesOf, valueAt, type FakeAudioContext, type FakeOscillatorNode } from '../test/fakeAudio'
import type { ArmIntent, SectionSpan, SongGrid, TimelineSegment, TransitionView } from '../lib/stageContracts'
import { startVoice, startVoicesForSwitch, type Voice } from './voices'
import { CANCEL_GUARD, FADE, HORIZON, HORIZON_INTERVAL, RELEASE_AFTER, SectionScheduler, type SchedulerDeps } from './sectionScheduler'

// A constante da guia passa por um getter: o planTransition real continua lendo a dele (true)
// e devolve guideMuteFrom, então só o próprio agendador conferindo a constante cala a guia.
const flags = vi.hoisted(() => ({ guideMute: true }))
vi.mock('../lib/sectionTransition', async (importOriginal) => {
  const real = await importOriginal<typeof import('../lib/sectionTransition')>()
  return { ...real, get GUIDE_MUTE_ON_JUMP() { return flags.guideMute } }
})

// Grade 120 em 4/4 com o 1 em 0:00 (pulso 0,5 s, compasso 2 s); seções [0,8] e [8,16];
// tocando desde 0:00 no instante 0 do contexto.
const grid: SongGrid = { bpm: 120, firstDownbeat: 0, signature: '4/4', countEvery: 1, source: 'click', meterSource: 'acento' }
const twoSections: SectionSpan[] = [{ index: 0, start: 0, end: 8 }, { index: 1, start: 8, end: 16 }]
const threeSections: SectionSpan[] = [...twoSections, { index: 2, start: 16, end: 30 }]

interface Options {
  spans?: SectionSpan[]
  grid?: SongGrid | null
  timeline?: TimelineSegment[]
  rate?: number
  latency?: number
  outputLatency?: number
  countDestination?: 'click' | null
  guide?: boolean
  clockMode?: 'worker' | 'interval'
}

function setup(o: Options = {}) {
  const ctx = createFakeAudioContext({ outputLatency: o.outputLatency ?? 0 })
  const clickEntry = ctx.createGain()
  const guideBus = ctx.createGain()
  const channelEntry = ctx.createGain()
  const spec = { channelId: 'baixo', buffer: ctx.createBuffer(2, 48000 * 40, 48000), entry: channelEntry }
  const state = {
    timeline: o.timeline ?? [{ ctxStart: 0, songStart: 0 }],
    current: [startVoice(asAudioContext(ctx), spec, 0, 0)] as Voice[],
    spans: o.spans ?? twoSections,
    grid: o.grid === undefined ? grid : o.grid,
  }
  const started: Voice[][] = []
  const deps = {
    ctx: asAudioContext(ctx),
    rate: () => o.rate ?? 1,
    timeline: () => state.timeline,
    setTimeline: vi.fn((next: TimelineSegment[]) => { state.timeline = next }),
    spans: () => state.spans,
    grid: () => state.grid,
    currentVoices: () => state.current,
    setCurrentVoices: vi.fn((v: Voice[]) => { state.current = v }),
    startSwitchVoices: vi.fn((T: number, offset: number, fade: number) => {
      const v = startVoicesForSwitch(asAudioContext(ctx), [spec], T, offset, fade, o.rate ?? 1)
      started.push(v)
      return v
    }),
    countDestination: () => (o.countDestination === null ? null : clickEntry),
    guideGain: () => (o.guide === false ? null : guideBus.gain),
    entryLatency: () => o.latency ?? 0,
    clickAudible: () => true,
    onView: vi.fn<(view: TransitionView | null, intent: ArmIntent | null) => void>(),
    onLanded: vi.fn<(to: number, at: number) => void>(),
    ...(o.clockMode ? { clockMode: () => o.clockMode! } : {}),
  } satisfies SchedulerDeps
  const s = new SectionScheduler(deps)
  const at = (t: number) => { ctx.currentTime = t; s.tick() }
  const arm = (t: number, intent: ArmIntent | null) => { ctx.currentTime = t; s.setIntent(intent) }
  const original = state.current[0]
  return { ctx, s, deps, state, started, at, arm, original, guide: guideBus.gain, clickEntry }
}

const triangles = (ctx: FakeAudioContext): FakeOscillatorNode[] => nodesOf(ctx, 'OscillatorNode').filter((n) => n.type === 'triangle')
const beepTimes = (ctx: FakeAudioContext) => triangles(ctx).map((n) => n.starts[0].when)
const near = (xs: readonly number[]) => xs.map((x) => Number(x.toFixed(6)))
const guideEvents = (g: AudioParam) => asFake(g).events.map((e) => [e.kind, e.value, Number(e.time.toFixed(6))])

describe('constantes', () => {
  it('horizonte 0,3 s, fade 5 ms, guarda 30 ms, soltura 30 ms; no setInterval o horizonte passa de 1 s', () => {
    expect([HORIZON, FADE, CANCEL_GUARD, RELEASE_AFTER]).toEqual([0.3, 0.005, 0.03, 0.03])
    expect(HORIZON_INTERVAL).toBeGreaterThan(1)
  })
})

describe('agendar', () => {
  it('nada é agendado antes do horizonte', () => {
    const { ctx, s, deps, arm, at } = setup()
    arm(0.5, { target: 0, plays: 1 })
    at(1)
    expect(nodesOf(ctx, 'OscillatorNode')).toHaveLength(0)
    expect(deps.startSwitchVoices).not.toHaveBeenCalled()
    expect(deps.setTimeline).not.toHaveBeenCalled()
    expect(s.view!.committed).toBe(false)
    expect(s.view).toMatchObject({ from: 0, to: 0, kind: 'repete', plays: 1, switchAt: 8, countTimes: [6, 6.5, 7, 7.5], countLabels: [1, 2, 3, 4], countTotal: 4, barsLeft: 4, hasGrid: true, clickAudible: true })
    at(5.69) // 1º bipe a 0,31 s: ainda fora
    expect(nodesOf(ctx, 'OscillatorNode')).toHaveLength(0)
  })

  it('agenda contagem, guia, vozes e linha do tempo ao entrar no horizonte, uma vez só', () => {
    const { ctx, s, deps, state, arm, at, original, guide, clickEntry } = setup()
    arm(1, { target: 0, plays: 1 })
    at(5.8)
    expect(beepTimes(ctx)).toEqual([6, 6.5, 7, 7.5])
    expect(triangles(ctx).map((n) => n.frequency.value)).toEqual([1319, 988, 988, 988])
    expect(nodesOf(ctx, 'BiquadFilterNode').every((f) => f.connections.some((c) => c.to === clickEntry))).toBe(true)
    expect(guideEvents(guide)).toEqual([['set', 1, 6], ['linear', 0, 6.01], ['set', 0, 8], ['linear', 1, 8.01]])
    expect(deps.startSwitchVoices).toHaveBeenCalledWith(8, 0, FADE)
    expect(state.timeline).toEqual([{ ctxStart: 0, songStart: 0 }, { ctxStart: 8, songStart: 0 }])
    expect(valueAt(original.env.gain, 7.995)).toBe(1)
    expect(valueAt(original.env.gain, 8)).toBe(0)
    expect(s.view).toMatchObject({ committed: true, switchAt: 8, countTimes: [6, 6.5, 7, 7.5], barsLeft: 2 })
    at(5.9)
    at(6.2)
    expect(deps.startSwitchVoices).toHaveBeenCalledTimes(1)
    expect(deps.setTimeline).toHaveBeenCalledTimes(1)
    expect(nodesOf(ctx, 'OscillatorNode')).toHaveLength(8)
    expect(asFake(guide).events).toHaveLength(4)
    expect(s.view!.barsLeft).toBe(1) // o último compasso começou em 6
  })

  it('calar a guia usa o tempo ouvido (soma a latência da entrada)', () => {
    const { ctx, arm, at, guide } = setup({ latency: 0.12 })
    arm(1, { target: 0, plays: 1 })
    at(5.8)
    expect(guideEvents(guide)).toEqual([['set', 1, 6.12], ['linear', 0, 6.13], ['set', 0, 8.12], ['linear', 1, 8.13]])
    expect(beepTimes(ctx)).toEqual([6, 6.5, 7, 7.5]) // a entrada do click já atrasa os bipes
  })

  it('com GUIDE_MUTE_ON_JUMP falso a guia não é tocada', () => {
    flags.guideMute = false
    try {
      const { ctx, s, arm, at, guide } = setup()
      arm(1, { target: 1, plays: 1 })
      at(5.8)
      expect(asFake(guide).events).toEqual([])
      expect(beepTimes(ctx)).toEqual([6, 6.5, 7, 7.5])
      at(6.6)
      s.setIntent(null) // cancelar também não mexe na guia
      expect(asFake(guide).events).toEqual([])
    } finally {
      flags.guideMute = true
    }
  })

  it('loop infinito da própria seção sem bipe e sem mexer na guia', () => {
    const { ctx, s, deps, arm, at, guide } = setup()
    arm(1, { target: 0, plays: 'infinite' })
    at(7.69) // primeiro evento é a voz nova em 7,995: 0,305 s
    expect(deps.startSwitchVoices).not.toHaveBeenCalled()
    at(7.7)
    expect(deps.startSwitchVoices).toHaveBeenCalledWith(8, 0, FADE)
    expect(nodesOf(ctx, 'OscillatorNode')).toHaveLength(0)
    expect(asFake(guide).events).toEqual([])
    expect(s.view).toMatchObject({ committed: true, kind: 'repete', plays: 'infinite', countTimes: [], countTotal: 0, barsLeft: 1 })
    at(8.04)
    expect(deps.onLanded).toHaveBeenCalledWith(0, 8)
    expect(s.intent).toEqual({ target: 0, plays: 'infinite' }) // infinito continua
  })

  it('sem destino da contagem o pulo acontece sem bipes', () => {
    const { ctx, deps, state, arm, at, original } = setup({ countDestination: null })
    arm(1, { target: 1, plays: 1 })
    at(5.8)
    expect(nodesOf(ctx, 'OscillatorNode')).toHaveLength(0)
    expect(deps.startSwitchVoices).toHaveBeenCalledWith(8, 8, FADE)
    at(8.04)
    expect(deps.onLanded).toHaveBeenCalledWith(1, 8)
    expect(asFake(original.source).stops).toEqual([8.04])
    expect(state.current).toBe(deps.startSwitchVoices.mock.results[0].value)
  })

  it('com o relógio no setInterval o horizonte cresce (tique de 1 s com a janela escondida)', () => {
    const worker = setup({ clockMode: 'worker' })
    worker.arm(1, { target: 0, plays: 1 })
    worker.at(4.6)
    expect(worker.deps.startSwitchVoices).not.toHaveBeenCalled()
    const interval = setup({ clockMode: 'interval' })
    interval.arm(1, { target: 0, plays: 1 })
    interval.at(6 - HORIZON_INTERVAL - 0.01)
    expect(interval.deps.startSwitchVoices).not.toHaveBeenCalled()
    interval.at(6 - HORIZON_INTERVAL + 0.01)
    expect(interval.deps.startSwitchVoices).toHaveBeenCalledWith(8, 0, FADE)
    expect(beepTimes(interval.ctx)).toEqual([6, 6.5, 7, 7.5])
  })

  it('velocidade diferente de 1 entra na posição e na conversão pro contexto', () => {
    const { ctx, s, deps, arm, at } = setup({ rate: 2 })
    arm(4.2, { target: 0, plays: 1 }) // posição 8,4: já na segunda seção, que acaba em 16 (contexto 8)
    expect(s.view).toMatchObject({ from: 1, kind: 'proxima', switchAt: 8, countTimes: [7, 7.25, 7.5, 7.75], barsLeft: 4 })
    at(6.8) // posição 13,6: 1º bipe (14) cai em 7, a 0,2 s
    expect(beepTimes(ctx)).toEqual([7, 7.25, 7.5, 7.75])
    expect(deps.startSwitchVoices).toHaveBeenCalledWith(8, 0, FADE)
    expect(s.view!.barsLeft).toBe(2) // 1,2 s do contexto são 2,4 s da música
  })

  it('antes do primeiro segmento (pré-contagem do play) converte por ele', () => {
    const { ctx, s, deps, arm, at } = setup({ timeline: [{ ctxStart: 2, songStart: 4 }] })
    arm(1, { target: 0, plays: 1 }) // a música começa em 4 no instante 2 do contexto
    expect(s.view).toMatchObject({ from: 0, switchAt: 6, countTimes: [4, 4.5, 5, 5.5] })
    at(3.8)
    expect(beepTimes(ctx)).toEqual([4, 4.5, 5, 5.5])
    expect(deps.startSwitchVoices).toHaveBeenCalledWith(6, 0, FADE)
  })
})

describe('cancelar e trocar o alvo', () => {
  it('cancelar depois de agendado para os bipes, devolve a guia e as vozes antigas', () => {
    const { ctx, s, deps, state, started, arm, at, original, guide } = setup()
    arm(1, { target: 1, plays: 1 })
    at(5.8)
    const [fresh] = started[0]
    arm(6.6, null)
    const [b1, b2, b3, b4] = triangles(ctx)
    expect(near(b1.stops)).toEqual([6.22]) // já tinha acabado: nada novo
    expect(near(b2.stops)).toEqual([6.72, 6.62]) // soando: desce e para 20 ms depois
    expect(near(b3.stops)).toEqual([7.22, 6.6]) // ainda não começou: para já
    expect(near(b4.stops)).toEqual([7.72, 6.6])
    expect(valueAt(guide, 6.6)).toBe(0)
    expect(valueAt(guide, 6.61)).toBe(1)
    expect(valueAt(guide, 8.005)).toBe(1) // a volta agendada em 8 saiu
    expect(valueAt(original.env.gain, 8)).toBe(1)
    expect(valueAt(original.env.gain, 9)).toBe(1)
    expect(asFake(fresh.source).stops).toEqual([6.6])
    expect(state.timeline).toEqual([{ ctxStart: 0, songStart: 0 }])
    expect(state.current).toEqual([original])
    expect(s.intent).toBeNull()
    expect(s.view).toBeNull()
    at(8.1)
    expect(deps.onLanded).not.toHaveBeenCalled()
  })

  it('devolver a guia no meio da rampa ou com ela calada sobe em 10 ms sem degrau', () => {
    for (const cancelAt of [5.95, 6.005, 6.5]) {
      const { arm, at, guide } = setup()
      arm(1, { target: 1, plays: 1 })
      at(5.8)
      const before = valueAt(guide, cancelAt)
      arm(cancelAt, null)
      expect(valueAt(guide, cancelAt)).toBeCloseTo(before, 9)
      expect(Math.abs(valueAt(guide, cancelAt + 0.0001) - before)).toBeLessThan(0.011)
      expect(valueAt(guide, cancelAt + 0.01)).toBe(1)
      expect(valueAt(guide, 8.005)).toBe(1)
    }
  })

  it('cancelar a menos de 30 ms do 1 deixa pousar e desarma depois', () => {
    const { ctx, s, deps, state, started, arm, at, original } = setup()
    arm(1, { target: 1, plays: 1 })
    at(5.8)
    arm(7.98, null)
    expect(s.intent).toBeNull()
    expect(s.view!.committed).toBe(true)
    expect(near(triangles(ctx)[3].stops)).toEqual([7.72])
    expect(asFake(started[0][0].source).stops).toEqual([])
    expect(state.timeline).toHaveLength(2)
    at(8.02)
    expect(deps.onLanded).not.toHaveBeenCalled()
    at(8.04)
    expect(deps.onLanded).toHaveBeenCalledWith(1, 8)
    expect(asFake(original.source).stops).toEqual([8.04])
    expect(s.intent).toBeNull()
    expect(s.view).toBeNull()
    expect(deps.onView).toHaveBeenLastCalledWith(null, null)
  })

  it('trocar o alvo durante a contagem troca só as vozes novas', () => {
    const { ctx, s, deps, state, started, arm, at, guide } = setup()
    arm(1, { target: 0, plays: 1 })
    at(5.8)
    const stopsBefore = triangles(ctx).map((n) => [...n.stops])
    arm(6.6, { target: 1, plays: 1 })
    expect(triangles(ctx).map((n) => n.stops)).toEqual(stopsBefore)
    expect(nodesOf(ctx, 'OscillatorNode')).toHaveLength(8)
    expect(asFake(guide).events).toHaveLength(4)
    expect(asFake(started[0][0].source).stops).toEqual([6.6])
    expect(deps.startSwitchVoices).toHaveBeenLastCalledWith(8, 8, FADE)
    expect(state.timeline).toEqual([{ ctxStart: 0, songStart: 0 }, { ctxStart: 8, songStart: 8 }])
    expect(s.view).toMatchObject({ committed: true, to: 1, kind: 'proxima', countTimes: [6, 6.5, 7, 7.5] })
    at(8.04)
    expect(deps.onLanded).toHaveBeenCalledWith(1, 8)
    expect(state.current).toBe(started[1])
  })

  it('trocar pro loop infinito da própria seção cancela os bipes e devolve a guia', () => {
    const { ctx, s, deps, arm, at, guide } = setup()
    arm(1, { target: 1, plays: 1 })
    at(5.8)
    arm(6.6, { target: 0, plays: 'infinite' })
    const [, b2, b3, b4] = triangles(ctx)
    expect(near(b2.stops)).toEqual([6.72, 6.62])
    expect([near(b3.stops), near(b4.stops)]).toEqual([[7.22, 6.6], [7.72, 6.6]])
    expect(valueAt(guide, 6.61)).toBe(1)
    expect(valueAt(guide, 8.005)).toBe(1)
    expect(deps.startSwitchVoices).toHaveBeenLastCalledWith(8, 0, FADE)
    expect(s.view).toMatchObject({ committed: true, to: 0, kind: 'repete', plays: 'infinite', countTimes: [], countLabels: [], countTotal: 0 })
    at(8.04)
    expect(deps.onLanded).toHaveBeenCalledWith(0, 8)
    expect(s.intent).toEqual({ target: 0, plays: 'infinite' })
  })

  it('sair do loop infinito agendado pra outra seção agenda os bipes que ainda dá tempo', () => {
    const { ctx, s, deps, state, arm, at, guide } = setup({ clockMode: 'interval', spans: threeSections })
    arm(1, { target: 0, plays: 'infinite' })
    at(6.5) // a voz nova em 7,995 já está no horizonte de 1,5 s
    expect(deps.startSwitchVoices).toHaveBeenCalledWith(8, 0, FADE)
    expect(nodesOf(ctx, 'OscillatorNode')).toHaveLength(0)
    arm(6.97, { target: 2, plays: 1 }) // o bipe de 7 fica a menos da folga mínima
    // Os bipes são convertidos pelo segmento de agora, não pelo do pulo (que já começa em 8 com 16).
    expect(state.timeline).toEqual([{ ctxStart: 0, songStart: 0 }, { ctxStart: 8, songStart: 16 }])
    expect(beepTimes(ctx)).toEqual([7.5])
    expect(triangles(ctx)[0].frequency.value).toBe(988)
    expect(guideEvents(guide)).toEqual([['set', 1, 7.5], ['linear', 0, 7.51], ['set', 0, 8], ['linear', 1, 8.01]])
    expect(deps.startSwitchVoices).toHaveBeenLastCalledWith(8, 16, FADE)
    expect(s.view).toMatchObject({ to: 2, kind: 'proxima', countTimes: [7.5], countLabels: [4], countTotal: 4 })
  })

  it('mudar só as passagens do mesmo alvo não mexe no agendado', () => {
    const { ctx, s, deps, arm, at, guide } = setup()
    arm(1, { target: 1, plays: 1 })
    at(5.8)
    arm(6.6, { target: 1, plays: 3 })
    expect(deps.startSwitchVoices).toHaveBeenCalledTimes(1)
    expect(triangles(ctx).every((n) => n.stops.length === 1)).toBe(true)
    expect(asFake(guide).events).toHaveLength(4)
    expect(s.view!.plays).toBe(3)
    at(8.04)
    expect(s.intent).toEqual({ target: 1, plays: 2 })
  })

  it('trocar o alvo depois da guarda vale depois do pouso', () => {
    const { s, deps, arm, at } = setup({ spans: threeSections })
    arm(1, { target: 0, plays: 1 })
    at(5.8)
    arm(7.98, { target: 2, plays: 1 })
    expect(deps.startSwitchVoices).toHaveBeenCalledTimes(1)
    at(8.04)
    expect(deps.onLanded).toHaveBeenCalledWith(0, 8)
    expect(s.intent).toEqual({ target: 2, plays: 1 }) // pousou em 0: o pedido novo continua armado
    expect(s.view).toMatchObject({ from: 0, to: 2, switchAt: 16, committed: false })
  })
})

describe('pousar', () => {
  it('pousa, solta as vozes antigas e a segunda volta do REPETIR usa o segmento novo', () => {
    const { ctx, s, deps, state, started, arm, at, original } = setup()
    arm(1, { target: 0, plays: 2 })
    at(5.8)
    at(8.03)
    expect(deps.onLanded).not.toHaveBeenCalled()
    at(8.04)
    expect(asFake(original.source).stops).toEqual([8.04])
    expect(deps.setCurrentVoices).toHaveBeenCalledWith(started[0])
    expect(deps.onLanded).toHaveBeenCalledWith(0, 8)
    expect(s.intent).toEqual({ target: 0, plays: 1 })
    expect(state.timeline).toEqual([{ ctxStart: 8, songStart: 0 }])
    expect(s.view).toMatchObject({ committed: false, from: 0, to: 0, switchAt: 16, countTimes: [14, 14.5, 15, 15.5] })
    at(13.8)
    expect(deps.startSwitchVoices).toHaveBeenLastCalledWith(16, 0, FADE)
    expect(beepTimes(ctx)).toEqual([6, 6.5, 7, 7.5, 14, 14.5, 15, 15.5])
    expect(valueAt(started[0][0].env.gain, 16)).toBe(0)
    at(16.04)
    expect(deps.onLanded).toHaveBeenLastCalledWith(0, 16)
    expect(s.intent).toBeNull()
    expect(s.view).toBeNull()
  })

  it('poda a linha do tempo pelo tempo ouvido, nunca pelo relógio do contexto', () => {
    const early = setup({ outputLatency: 0.02, latency: 0.12 })
    early.arm(1, { target: 0, plays: 1 })
    early.at(5.8)
    early.at(8.04) // ouvido: 7,9, ainda na volta de antes
    expect(early.state.timeline).toEqual([{ ctxStart: 0, songStart: 0 }, { ctxStart: 8, songStart: 0 }])
    const late = setup({ outputLatency: 0.02, latency: 0.12 })
    late.arm(1, { target: 0, plays: 1 })
    late.at(5.8)
    late.at(8.2) // ouvido: 8,06
    expect(late.state.timeline).toEqual([{ ctxStart: 8, songStart: 0 }])
  })

  it('congelado: nos últimos 50 ms o plano recalculado não mexe no agendado', () => {
    const { ctx, s, deps, state, arm, at, guide } = setup()
    arm(1, { target: 0, plays: 1 })
    at(5.8)
    const view = s.view
    at(7.96) // o plano visto daqui já mira o fim da seção seguinte (16)
    expect(deps.startSwitchVoices).toHaveBeenCalledTimes(1)
    expect(deps.setTimeline).toHaveBeenCalledTimes(1)
    expect(state.timeline).toHaveLength(2)
    expect(triangles(ctx).every((n) => n.stops.length === 1)).toBe(true)
    expect(asFake(guide).events).toHaveLength(4)
    expect(s.view).toEqual({ ...view, barsLeft: 1 })
  })
})

describe('reset, linha do tempo vazia e bordas', () => {
  it('reset cancela o agendado e o próximo tick re-planeja na linha do tempo nova', () => {
    const { ctx, s, deps, state, started, arm, at, original, guide } = setup()
    arm(1, { target: 1, plays: 1 })
    at(5.8)
    ctx.currentTime = 6.6
    s.reset()
    expect(near(triangles(ctx)[3].stops)).toEqual([7.72, 6.6])
    expect(valueAt(guide, 6.61)).toBe(1)
    expect(valueAt(original.env.gain, 9)).toBe(1)
    expect(asFake(started[0][0].source).stops).toEqual([6.6])
    expect(state.timeline).toEqual([{ ctxStart: 0, songStart: 0 }])
    expect(s.intent).toEqual({ target: 1, plays: 1 })
    expect(s.view).toBeNull()
    state.timeline = [{ ctxStart: 6.6, songStart: 2 }] // a busca do motor
    at(6.6)
    expect(s.view).toMatchObject({ committed: false, from: 0, to: 1 })
    expect(s.view!.switchAt).toBeCloseTo(12.6, 9)
    expect(deps.startSwitchVoices).toHaveBeenCalledTimes(1)
    at(10.4)
    expect(deps.startSwitchVoices).toHaveBeenCalledTimes(2)
    expect(deps.startSwitchVoices.mock.calls[1][0]).toBeCloseTo(12.6, 9)
    expect(deps.startSwitchVoices.mock.calls[1][1]).toBe(8)
  })

  it('reset depois do 1 fecha o pouso: as vozes novas passam pro motor', () => {
    const { ctx, s, deps, state, started, arm, at, original } = setup()
    arm(1, { target: 1, plays: 1 })
    at(5.8)
    ctx.currentTime = 8.01
    s.reset()
    expect(deps.onLanded).toHaveBeenCalledWith(1, 8)
    expect(state.current).toBe(started[0])
    expect(asFake(original.source).stops).toEqual([8.01])
    expect(state.timeline).toEqual([{ ctxStart: 8, songStart: 8 }]) // podada pelo tempo ouvido (8,01)
    expect(s.intent).toBeNull()
  })

  it('linha do tempo vazia (VS parada): não agenda, não desarma e não cancela o já agendado', () => {
    const stopped = setup({ timeline: [] })
    stopped.arm(5.8, { target: 0, plays: 2 })
    stopped.at(5.9)
    expect(stopped.deps.startSwitchVoices).not.toHaveBeenCalled()
    expect(nodesOf(stopped.ctx, 'OscillatorNode')).toHaveLength(0)
    expect(stopped.s.intent).toEqual({ target: 0, plays: 2 })
    expect(stopped.s.view).toBeNull()
    stopped.arm(6, { target: 5, plays: 1 }) // parado nem o alvo fora da lista desarma: não há posição pra julgar
    expect(stopped.s.intent).toEqual({ target: 5, plays: 1 })

    const playing = setup()
    playing.arm(1, { target: 0, plays: 1 })
    playing.at(5.8)
    playing.state.timeline = []
    playing.at(6.6)
    expect(triangles(playing.ctx).every((n) => n.stops.length === 1)).toBe(true)
    expect(playing.s.view!.committed).toBe(true)
  })

  it('plano nulo com posição válida desarma: cauda da final e alvo fora da lista', () => {
    // A final [8,15] acaba fora da barra: o pulo dela é a última barra (14). Depois dela, não há pulo.
    const tail = setup({ spans: [{ index: 0, start: 0, end: 8 }, { index: 1, start: 8, end: 15 }] })
    tail.arm(14.5, { target: 0, plays: 1 })
    expect(tail.s.intent).toBeNull()
    expect(tail.s.view).toBeNull()
    expect(tail.deps.onView).not.toHaveBeenCalled() // nada visível mudou: continuava sem armado
    const gone = setup()
    gone.arm(1, { target: 0, plays: 1 })
    expect(gone.s.view).not.toBeNull()
    gone.arm(2, { target: 5, plays: 1 })
    expect(gone.s.intent).toBeNull()
    expect(gone.s.view).toBeNull()
    expect(gone.deps.onView).toHaveBeenLastCalledWith(null, null)
  })

  it('onView só quando muda algo visível', () => {
    const { deps, arm, at } = setup()
    arm(1, { target: 0, plays: 1 })
    expect(deps.onView).toHaveBeenCalledTimes(1)
    expect(deps.onView.mock.calls[0][1]).toEqual({ target: 0, plays: 1 })
    at(1.025)
    at(1.05) // mesmo plano, mesmo número de compassos
    expect(deps.onView).toHaveBeenCalledTimes(1)
    at(2.1) // passou um compasso
    expect(deps.onView).toHaveBeenCalledTimes(2)
    expect(deps.onView.mock.calls[1][0]!.barsLeft).toBe(3)
    at(5.8) // agendou
    expect(deps.onView).toHaveBeenCalledTimes(3)
    expect(deps.onView.mock.calls[2][0]!.committed).toBe(true)
  })

  it('sem grade: pulo na marca, sem contagem, e a tela sabe que não há grade', () => {
    const { ctx, s, deps, arm, at } = setup({ grid: null })
    arm(1, { target: 1, plays: 1 })
    expect(s.view).toMatchObject({ hasGrid: false, barsLeft: null, countTimes: [], countTotal: 0, switchAt: 8 })
    at(7.7)
    expect(deps.startSwitchVoices).toHaveBeenCalledWith(8, 8, FADE)
    expect(nodesOf(ctx, 'OscillatorNode')).toHaveLength(0)
    expect(s.view).toMatchObject({ committed: true, barsLeft: null })
  })

  it('dispose desfaz o agendado e ignora o que vier depois', () => {
    const { ctx, s, deps, state, arm, at } = setup()
    arm(1, { target: 1, plays: 1 })
    at(5.8)
    ctx.currentTime = 6.6
    s.dispose()
    expect(near(triangles(ctx)[3].stops)).toEqual([7.72, 6.6])
    expect(state.timeline).toEqual([{ ctxStart: 0, songStart: 0 }])
    arm(6.7, { target: 0, plays: 1 })
    at(7.8)
    at(8.1)
    expect(deps.startSwitchVoices).toHaveBeenCalledTimes(1)
    expect(deps.onLanded).not.toHaveBeenCalled()
  })
})

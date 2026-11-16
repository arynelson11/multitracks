import { describe, expect, it, vi } from 'vitest'
import { asAudioContext, asFake, createFakeAudioContext, nodesOf, valueAt, type FakeAudioContext, type FakeOscillatorNode } from '../test/fakeAudio'
import type { ArmIntent, SectionSpan, SongGrid, TimelineSegment, TransitionView } from '../lib/stageContracts'
import { startVoice, startVoicesForSwitch, type Voice } from './voices'
import { sectionSpans } from '../lib/songGrid'
import { CANCEL_GUARD, FADE, HORIZON, HORIZON_INTERVAL, RELEASE_AFTER, SectionScheduler, sameTransitionView, type SchedulerDeps } from './sectionScheduler'

// A constante da guia passa por um getter: o planTransition real continua lendo a dele (true)
// e devolve guideMuteFrom, então só o próprio agendador conferindo a constante cala a guia.
// A folga mínima também: o agendador passa a dele ao planTransition, então "folga 0" vale nos dois.
const flags = vi.hoisted(() => ({ guideMute: true, minLead: 0.05 }))
vi.mock('../lib/sectionTransition', async (importOriginal) => {
  const real = await importOriginal<typeof import('../lib/sectionTransition')>()
  return { ...real, get GUIDE_MUTE_ON_JUMP() { return flags.guideMute }, get MIN_LEAD() { return flags.minLead } }
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
// Bipes que soam de verdade (parar antes de começar não soa), com o acento marcado: "2(1)".
const sounding = (ctx: FakeAudioContext) => triangles(ctx)
  .filter((n) => Math.min(...n.stops) > n.starts[0].when)
  .map((n) => `${Number(n.starts[0].when.toFixed(3))}${n.frequency.value === 1319 ? '(1)' : ''}`)
// Instantes (de 1 em 1 ms) em que a guia não está calada.
const openAt = (g: AudioParam, from: number, to: number) => {
  const out: number[] = []
  for (let k = Math.round(from * 1000); k <= Math.round(to * 1000); k++) if (valueAt(g, k / 1000) > 0) out.push(k / 1000)
  return out
}

interface PlayOptions extends Options { intent: ArmIntent; armAt: number; until: number; tick?: number; phase?: number }
// Arma em `armAt` e roda o tique de `tick` em `tick` (a partir de `phase`) até `until`.
function play(o: PlayOptions) {
  const h = setup(o)
  h.arm(o.armAt, o.intent)
  const tick = o.tick ?? 0.025
  for (let k = 0; ; k++) {
    const t = (o.phase ?? 0) + k * tick
    if (t > o.until + 1e-9) break
    if (t > o.armAt) h.at(t)
  }
  return h
}

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

// Ruling T17-volta: os bipes da volta seguinte que caem antes do pouso mais um tique saem junto
// com o pulo, e a guia não reabre entre voltas quando a contagem da próxima já começa no pouso.
describe('volta seguinte do REPETIR', () => {
  const oneBar: SectionSpan[] = [{ index: 0, start: 0, end: 2 }, { index: 1, start: 2, end: 4 }, { index: 2, start: 4, end: 20 }]
  const g68: SongGrid = { bpm: 180, firstDownbeat: 0, signature: '6/8', countEvery: 3, source: 'click', meterSource: 'acento' }
  const g34: SongGrid = { bpm: 180, firstDownbeat: 0, signature: '3/4', countEvery: 1, source: 'click', meterSource: 'acento' }

  it('1 compasso em 4/4: o 1 com acento soa em toda volta e a guia fica calada de uma volta pra outra', () => {
    for (const phase of [0, 0.01, 0.02]) {
      const h = play({ spans: oneBar, intent: { target: 0, plays: 3 }, armAt: 0.1, until: 7, phase })
      expect(sounding(h.ctx)).toEqual(['0.5', '1', '1.5', '2(1)', '2.5', '3', '3.5', '4(1)', '4.5', '5', '5.5'])
      expect(h.deps.onLanded.mock.calls).toEqual([[0, 2], [0, 4], [0, 6]])
      expect(openAt(h.guide, 0.51, 6)).toEqual([])
      expect(valueAt(h.guide, 6.01)).toBe(1)
      expect(h.s.intent).toBeNull()
    }
  })

  it('BPMs quebrados com seções encaixadas pelo sectionSpans: o acento soa em toda volta', () => {
    for (const bpm of [78, 87.3, 133, 147.25]) {
      const g: SongGrid = { bpm, firstDownbeat: 0.37, signature: '4/4', countEvery: 1, source: 'click', meterSource: 'acento' }
      const bar = (60 / bpm) * 4
      const marks = [0.37, 0.37 + bar, 0.37 + 2 * bar, 0.37 + 10 * bar].map((time, i) => ({ id: `m${i}`, time: time + 0.004, label: `S${i}` }))
      const spans = sectionSpans(marks, 0.37 + 30 * bar, g)
      const h = play({ spans, grid: g, intent: { target: 0, plays: 3 }, armAt: spans[0].start + 0.01, until: spans[0].start + 3 * bar + 0.5 })
      const accents = sounding(h.ctx).filter((b) => b.endsWith('(1)'))
      expect(accents, `bpm ${bpm}`).toHaveLength(2) // o 1 da 1ª volta passou antes de armar; as duas voltas seguintes têm
      expect(h.deps.onLanded, `bpm ${bpm}`).toHaveBeenCalledTimes(3)
    }
  })

  it('a tela da volta seguinte mostra a contagem inteira, com o 1 que já soou no pouso', () => {
    const h = play({ spans: oneBar, intent: { target: 0, plays: 2 }, armAt: 0.1, until: 2.05 })
    expect(h.deps.onLanded).toHaveBeenCalledWith(0, 2)
    expect(h.s.view).toMatchObject({ committed: false, from: 0, to: 0, kind: 'repete', switchAt: 4, countTimes: [2, 2.5, 3, 3.5], countLabels: [1, 2, 3, 4] })
    h.at(2.2)
    expect(h.s.view).toMatchObject({ committed: true, countTimes: [2, 2.5, 3, 3.5], countLabels: [1, 2, 3, 4] })
    expect(sounding(h.ctx)).toEqual(['0.5', '1', '1.5', '2(1)', '2.5', '3', '3.5']) // nada agendado duas vezes
  })

  it('1 compasso em 6/8 contando 2: o acento soa em toda volta', () => {
    const h = play({ spans: oneBar, grid: g68, intent: { target: 0, plays: 3 }, armAt: 0.1, until: 7 })
    expect(sounding(h.ctx)).toEqual(['1', '2(1)', '3', '4(1)', '5'])
    expect(openAt(h.guide, 1.01, 6)).toEqual([])
  })

  it('folga 0: o acento da volta seguinte também soa (a causa era o pouso tardio, não a folga)', () => {
    flags.minLead = 0
    try {
      const h = play({ spans: oneBar, intent: { target: 0, plays: 3 }, armAt: 0.1, until: 7 })
      expect(sounding(h.ctx)).toEqual(['0.5', '1', '1.5', '2(1)', '2.5', '3', '3.5', '4(1)', '4.5', '5', '5.5'])
      expect(openAt(h.guide, 0.51, 6)).toEqual([])
    } finally {
      flags.minLead = 0.05
    }
  })

  it('folga 0 com seção crua de 1 compasso + 0,1 s: o 1 da volta seguinte não sai adiantado, mas a guia não reabre', () => {
    flags.minLead = 0
    try {
      const spans: SectionSpan[] = [{ index: 0, start: 0, end: 2.1 }, { index: 1, start: 2.1, end: 20 }]
      const h = play({ spans, intent: { target: 0, plays: 2 }, armAt: 0.04, until: 5 })
      expect(sounding(h.ctx)).toEqual(['0.1(1)', '0.6', '1.1', '1.6', '2.2(1)', '2.7', '3.2', '3.7'])
      expect(openAt(h.guide, 0.111, 4.2)).toEqual([])
    } finally {
      flags.minLead = 0.05
    }
  })

  it('seção crua de 1 compasso + 0,1 s: o 1 da volta seguinte (0,1 s depois do pouso) soa e a guia segue calada', () => {
    const spans: SectionSpan[] = [{ index: 0, start: 0, end: 2.1 }, { index: 1, start: 2.1, end: 20 }]
    const h = play({ spans, intent: { target: 0, plays: 2 }, armAt: 0.04, until: 5 })
    expect(sounding(h.ctx)).toEqual(['0.1(1)', '0.6', '1.1', '1.6', '2.2(1)', '2.7', '3.2', '3.7'])
    expect(h.deps.onLanded.mock.calls.map(([to, at]) => [to, Number(at.toFixed(6))])).toEqual([[0, 2.1], [0, 4.2]])
    expect(openAt(h.guide, 0.111, 4.2)).toEqual([])
    expect(valueAt(h.guide, 4.211)).toBe(1)
  })

  it('2 compassos com o relógio no setInterval e compasso abaixo de 1,1 s: o acento soa em toda volta', () => {
    for (const phase of [0.1, 0.5, 0.97]) {
      const h = play({ spans: [{ index: 0, start: 0, end: 2 }, { index: 1, start: 2, end: 20 }], grid: g34, clockMode: 'interval', intent: { target: 0, plays: 3 }, armAt: 0.05, until: 8, tick: 1, phase })
      expect(sounding(h.ctx)).toEqual(['1(1)', '1.333', '1.667', '3(1)', '3.333', '3.667', '5(1)', '5.333', '5.667'])
      // A contagem da volta seguinte começa um compasso depois do pouso: o primeiro compasso da volta tem guia.
      expect([1.5, 2.5, 3.5, 4.5, 5.5, 6.5].map((t) => valueAt(h.guide, t))).toEqual([0, 1, 0, 1, 0, 1])
    }
  })

  it('com 2 compassos e o relógio no Worker nada é adiantado: a volta seguinte agenda a própria contagem', () => {
    const h = play({ spans: [{ index: 0, start: 0, end: 4 }, { index: 1, start: 4, end: 20 }], intent: { target: 0, plays: 2 }, armAt: 0.1, until: 2.1 })
    expect(sounding(h.ctx)).toEqual(['2(1)', '2.5', '3', '3.5'])
  })

  it('cancelar logo depois do pouso, com o 1 da volta seguinte soando: o bipe desce e a guia volta', () => {
    const h = play({ spans: oneBar, intent: { target: 0, plays: 3 }, armAt: 0.1, until: 2.05 })
    h.arm(2.06, null)
    const accent = triangles(h.ctx).find((n) => n.starts[0].when === 2)!
    expect(near(accent.stops)).toEqual([2.22, 2.08])
    expect(valueAt(h.guide, 2.06)).toBe(0)
    expect(valueAt(h.guide, 2.07)).toBe(1)
    for (const t of [2.2, 3, 3.9, 4.1]) h.at(t)
    expect(sounding(h.ctx)).toEqual(['0.5', '1', '1.5', '2(1)'])
    expect(valueAt(h.guide, 4.005)).toBe(1)
  })

  it('mudar o pedido antes da guarda refaz os bipes da volta seguinte', () => {
    const h = play({ spans: oneBar, intent: { target: 0, plays: 3 }, armAt: 0.1, until: 1.2 })
    h.arm(1.2, { target: 0, plays: 1 }) // sem volta seguinte: o 1 dela não sai e a guia volta no 1 deste pulo
    for (let t = 1.225; t <= 4.5; t += 0.025) h.at(t)
    expect(sounding(h.ctx)).toEqual(['0.5', '1', '1.5'])
    expect(valueAt(h.guide, 2.01)).toBe(1)
    expect(h.s.intent).toBeNull()
  })

  it('pausa com a volta seguinte agendada derruba os bipes dela e devolve a guia', () => {
    const h = play({ spans: oneBar, intent: { target: 0, plays: 3 }, armAt: 0.1, until: 2.3 })
    h.ctx.currentTime = 2.3
    h.s.reset()
    h.state.timeline = []
    for (const t of [2.4, 3.9, 4.1, 5]) h.at(t)
    expect(sounding(h.ctx)).toEqual(['0.5', '1', '1.5', '2(1)'])
    expect(valueAt(h.guide, 2.31)).toBe(1)
    expect(valueAt(h.guide, 4.5)).toBe(1)
    expect(h.s.intent).toEqual({ target: 0, plays: 2 })
  })
})

describe('volta seguinte: pausa entre o pouso e o agendamento, e tique atrasado', () => {
  const oneBar: SectionSpan[] = [{ index: 0, start: 0, end: 2 }, { index: 1, start: 2, end: 4 }, { index: 2, start: 4, end: 20 }]
  const g34: SongGrid = { bpm: 180, firstDownbeat: 0, signature: '3/4', countEvery: 1, source: 'click', meterSource: 'acento' }

  it('pausa logo depois do pouso, antes de a volta seguinte agendar o resto: o 1 dela desce e a guia volta', () => {
    for (const when of ['tique pousou', 'reset pousa']) {
      const h = play({ spans: oneBar, intent: { target: 0, plays: 3 }, armAt: 0.1, until: when === 'tique pousou' ? 2.05 : 2.025 })
      h.ctx.currentTime = 2.06
      h.s.reset()
      h.state.timeline = []
      const accent = triangles(h.ctx).find((n) => n.starts[0].when === 2)!
      expect(near(accent.stops), when).toEqual([2.22, 2.08])
      expect(valueAt(h.guide, 2.07), when).toBe(1)
      expect(valueAt(h.guide, 3), when).toBe(1)
      expect(h.deps.onLanded, when).toHaveBeenCalledWith(0, 2)
    }
  })

  it('com o tique do pouso atrasado, a guia calada a partir dele não reabre se o pedido muda na mesma volta', () => {
    const h = play({ spans: [{ index: 0, start: 0, end: 2 }, { index: 1, start: 2, end: 20 }], grid: g34, clockMode: 'interval', intent: { target: 0, plays: 3 }, armAt: 0.05, until: 3.02, tick: 1, phase: 0.02 })
    expect(sounding(h.ctx)).toEqual(['1(1)', '1.333', '1.667', '3(1)', '3.333', '3.667', '5(1)'])
    h.arm(3.5, { target: 0, plays: 1 }) // a volta seguinte sai; esta continua contando
    expect(valueAt(h.guide, 3.6)).toBe(0)
    expect(valueAt(h.guide, 4.01)).toBe(1)
    expect(sounding(h.ctx)).toEqual(['1(1)', '1.333', '1.667', '3(1)', '3.333', '3.667'])
  })
})

describe('tique que perde a janela inteira', () => {
  it('a próxima natural alcançada sozinha conta como passagem, não vira REPETE', () => {
    const { s, deps, arm, at } = setup({ grid: null, spans: threeSections })
    arm(7.5, { target: 1, plays: 1 })
    expect(s.view).toMatchObject({ committed: false, to: 1, switchAt: 8 })
    at(7.96) // o fio principal travou 460 ms: a música entrou na seção 1 sozinha
    expect(s.intent).toBeNull()
    expect(s.view).toBeNull()
    for (const t of [10, 15.8, 16.1]) at(t)
    expect(deps.startSwitchVoices).not.toHaveBeenCalled()
  })

  it('REPETE e LOOP perdidos desarmam em vez de virar um pulo pra trás', () => {
    for (const plays of [1, 'infinite'] as const) {
      const { s, deps, arm, at } = setup({ grid: null, spans: threeSections })
      arm(7.5, { target: 0, plays })
      at(7.96)
      expect(s.intent).toBeNull()
      at(15.8)
      expect(deps.startSwitchVoices).not.toHaveBeenCalled()
    }
  })

  it('pulo pra outra seção perdido continua armado, mais tarde', () => {
    const { s, arm, at } = setup({ grid: null, spans: threeSections })
    arm(7.5, { target: 2, plays: 1 })
    at(7.96)
    expect(s.intent).toEqual({ target: 2, plays: 1 })
    expect(s.view).toMatchObject({ from: 1, to: 2, switchAt: 16 })
  })
})

describe('pré-contagem e reset no cruzamento', () => {
  it('na pré-contagem do play o bipe que cai no ponto de retomada não fica de fora', () => {
    const { ctx, s, arm, at } = setup({ timeline: [{ ctxStart: 3, songStart: 6 }] })
    arm(0.5, { target: 1, plays: 1 }) // retoma no 1 do último compasso, 2,5 s depois
    expect(s.view).toMatchObject({ switchAt: 5, countTimes: [3, 3.5, 4, 4.5], countLabels: [1, 2, 3, 4] })
    at(2.75)
    expect(beepTimes(ctx)).toEqual([3, 3.5, 4, 4.5])
  })

  it('reset entre T - FADE e T: a voz nova que já subia desce em rampa, como a antiga volta', () => {
    const { ctx, s, deps, started, arm, at, original } = setup()
    arm(1, { target: 1, plays: 1 })
    at(5.8)
    const fresh = started[0][0]
    ctx.currentTime = 7.9975
    s.reset()
    expect(valueAt(fresh.env.gain, 7.9975)).toBeCloseTo(0.5, 9)
    expect(valueAt(fresh.env.gain, 8.0025)).toBeCloseTo(0, 9)
    expect(near(asFake(fresh.source).stops)).toEqual([8.0025])
    expect(valueAt(original.env.gain, 7.9975)).toBeCloseTo(0.5, 9)
    expect(valueAt(original.env.gain, 8.0025)).toBe(1)
    for (const t of [7.9985, 8.0005, 8.002]) expect(valueAt(original.env.gain, t) + valueAt(fresh.env.gain, t)).toBeCloseTo(1, 9)
    expect(deps.onLanded).not.toHaveBeenCalled()
  })

  it('reset entre T - FADE e T com o alvo em 0:00: a voz nova ainda não começou e só para', () => {
    const { ctx, s, started, arm, at } = setup()
    arm(1, { target: 0, plays: 1 })
    at(5.8)
    ctx.currentTime = 7.9975
    s.reset()
    expect(near(asFake(started[0][0].source).stops)).toEqual([7.9975])
  })
})

describe('comparação da view', () => {
  it('qualquer campo da TransitionView que muda conta como mudança visível; listas iguais não', () => {
    const sample: TransitionView = {
      from: 0, to: 1, kind: 'proxima', plays: 2, switchAt: 8, countTimes: [6, 6.5], countLabels: [3, 4], countTotal: 4,
      barsLeft: 1, committed: false, clickAudible: true, hasGrid: true,
    }
    const changed = (v: unknown): unknown => {
      if (Array.isArray(v)) return [...v, 99]
      if (typeof v === 'number') return v + 1
      if (typeof v === 'boolean') return !v
      if (typeof v === 'string') return v + 'x'
      return 0
    }
    expect(sameTransitionView(sample, { ...sample, countTimes: [...sample.countTimes], countLabels: [...sample.countLabels] })).toBe(true)
    for (const key of Object.keys(sample) as (keyof TransitionView)[]) {
      expect(sameTransitionView(sample, { ...sample, [key]: changed(sample[key]) } as TransitionView), key).toBe(false)
    }
    expect(sameTransitionView(sample, { ...sample, switchAt: null })).toBe(false)
    expect(sameTransitionView(null, null)).toBe(true)
    expect(sameTransitionView(sample, null)).toBe(false)
  })
})

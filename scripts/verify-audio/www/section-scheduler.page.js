// Página do section-scheduler.mjs: roda o SectionScheduler REAL (src/audio/sectionScheduler.ts,
// com o planTransition, a linha do tempo, as vozes e a contagem reais) num OfflineAudioContext do
// Chrome. O tique e os pedidos do operador rodam dentro de ctx.suspend(t), com now =
// ctx.currentTime, como o relógio da T5 faria. Quatro saídas, uma por coisa medida:
//   0 "pos": voz cuja amostra vale 0,05 + 0,05 x (segundos da música): mostra onde a música está;
//   1 "dc":  voz de amostras 1: com os envelopes certos a soma das vozes é 1 o tempo todo;
//   2 contagem: osciladores viram fonte constante 1 e o passa-baixa vira ganho 1, então a saída
//     é (1 + squareMix) x envelope do bipe (como no count-cancel);
//   3 guia: fonte constante 1 pelo ganho do barramento da guia: a saída é o próprio ganho.
// Cenário padrão: grade 120 em 4/4 com o 1 em 1 s; seções [1,5] [5,9] [9,13]; o pulo armado na
// primeira cai em 5. Os cenários da volta seguinte (Ruling T17-volta) usam seções de 1 compasso.
// Com ?case=folga0 a página roda só a volta seguinte, num pacote com MIN_LEAD = 0.
import { CANCEL_GUARD, FADE, RELEASE_AFTER, SectionScheduler } from '@t17/sectionScheduler'
import { startVoice, startVoicesForSwitch } from '@t17/voices'
import { COUNT_TONE, scheduleCount } from '@t17/countTones'

const QUANTUM = 128
const G44 = { bpm: 120, firstDownbeat: 1, signature: '4/4', countEvery: 1, source: 'click', meterSource: 'acento' }
const SPANS = [{ index: 0, start: 1, end: 5 }, { index: 1, start: 5, end: 9 }, { index: 2, start: 9, end: 13 }]
const T = 5
const BEATS = [3, 3.5, 4, 4.5]
const BASE = { grid: G44, spans: SPANS, end: 5.4 }
const MIX = 1 + COUNT_TONE.squareMix
const GUIDE_RAMP = 0.01
const enc = (x) => 0.05 + 0.05 * x

// Critérios
const STEP_MAX = 0.01 // degrau por amostra na contagem e na guia (o mesmo do count-cancel)
const DC_TOL = 1e-4
const POS_TOL = 1e-4
const TAIL_MAX = 1e-3
const ONSET_TOL = 2.5 // amostras: a fonte imitada sai em 0 na 1ª amostra e o ataque passa do limiar na 2ª (até 2 inteiras, mais o resto do ponto flutuante)
const PEAK_TOL = 0.01
const GUIDE_TOL = 1e-3

function patch(ctx) {
  const realGain = ctx.createGain.bind(ctx)
  ctx.createOscillator = () => {
    const c = ctx.createConstantSource()
    // Como o oscilador de verdade (fase 0 vale 0), a fonte sai em 0 na primeira amostra. Sem isso,
    // num instante que não cai exato numa amostra (1,1 s; 4,333 s) o envelope só vale 0 na amostra
    // seguinte e o ganho padrão 1 dele apareceria como um pico que o bipe real não faz (o controle
    // "bipe de verdade" mede isso com os osciladores reais).
    c.offset.value = 0
    const start = c.start.bind(c)
    c.start = (when = 0) => { c.offset.setValueAtTime(1, when + 1 / ctx.sampleRate); start(when) }
    return Object.assign(c, { type: 'constant', frequency: { value: 0 } })
  }
  ctx.createBiquadFilter = () => Object.assign(realGain(), { type: 'constant', frequency: { value: 0 }, Q: { value: 0 } })
}

function build(sr, L, cfg) {
  const ctx = new OfflineAudioContext({ numberOfChannels: 4, length: Math.round(cfg.end * sr), sampleRate: sr })
  patch(ctx)
  ctx.destination.channelInterpretation = 'discrete'
  const merger = ctx.createChannelMerger(4)
  merger.connect(ctx.destination)
  // Entrada do canal: o atraso L faz o papel do worklet de tom (música) e da compensação (click e guia).
  const entry = (out) => {
    const n = L > 0 ? ctx.createDelay(1) : ctx.createGain()
    if (L > 0) n.delayTime.value = L
    n.connect(merger, 0, out)
    return n
  }
  const posEntry = entry(0)
  const dcEntry = entry(1)
  const clickEntry = entry(2)
  const guideSrc = ctx.createConstantSource()
  const guideDelay = ctx.createDelay(1)
  guideDelay.delayTime.value = L
  const guideBus = ctx.createGain()
  guideSrc.connect(guideDelay)
  guideDelay.connect(guideBus)
  guideBus.connect(merger, 0, 3)
  guideSrc.start(0)

  const len = 16 * sr
  const posBuf = ctx.createBuffer(1, len, sr)
  const dcBuf = ctx.createBuffer(1, len, sr)
  const p = posBuf.getChannelData(0)
  for (let i = 0; i < len; i++) p[i] = enc(i / sr)
  dcBuf.getChannelData(0).fill(1)
  const specs = [{ channelId: 'pos', buffer: posBuf, entry: posEntry }, { channelId: 'dc', buffer: dcBuf, entry: dcEntry }]
  let current = specs.map((s) => startVoice(ctx, s, 0, 0))
  let timeline = [{ ctxStart: 0, songStart: 0 }]
  const log = { landed: [] }
  const scheduler = new SectionScheduler({
    ctx,
    rate: () => 1,
    timeline: () => timeline,
    setTimeline: (next) => { timeline = next },
    spans: () => cfg.spans,
    grid: () => cfg.grid,
    currentVoices: () => current,
    setCurrentVoices: (v) => { current = v },
    startSwitchVoices: (at, offset, fade) => startVoicesForSwitch(ctx, specs, at, offset, fade, 1),
    countDestination: () => clickEntry,
    guideGain: () => guideBus.gain,
    entryLatency: () => L,
    clickAudible: () => true,
    onView: () => {},
    onLanded: (to, at) => log.landed.push({ to, at }),
    ...(cfg.clockMode ? { clockMode: () => cfg.clockMode } : {}),
  })
  // A pausa do motor: reset e linha do tempo vazia (VS parada, T5), com o som seguindo na página.
  const pause = () => { scheduler.reset(); timeline = [] }
  return { ctx, scheduler, log, pause }
}

// Tiques de `step` em `step` em [from, to] (25 ms: o Worker).
const ticksIn = (from, to, step = 0.025) => { const out = []; for (let k = 0; from + k * step <= to + 1e-9; k++) out.push(from + k * step); return out }

async function render(sr, { L = 0, cfg = BASE, actions = [], ticks }) {
  const r = build(sr, L, cfg)
  const byFrame = new Map()
  const add = (t, fn) => {
    const frame = Math.ceil((t * sr) / QUANTUM) * QUANTUM
    if (!byFrame.has(frame)) byFrame.set(frame, [])
    byFrame.get(frame).push(fn)
  }
  for (const a of actions) add(a.at, () => a.run(r))
  for (const t of ticks) add(t, () => r.scheduler.tick())
  let error = null
  for (const [frame, fns] of byFrame) {
    r.ctx.suspend(frame / sr).then(() => {
      try { for (const fn of fns) fn() } catch (e) { error ??= String(e && e.stack ? e.stack : e) }
      return r.ctx.resume()
    })
  }
  const buf = await r.ctx.startRendering()
  return { ...r, error, sr, L, data: [0, 1, 2, 3].map((c) => buf.getChannelData(c)) }
}

// ---------- Medidas ----------
function maxStep(d, i0, i1, scale = 1) {
  let worst = 0, at = 0
  for (let i = Math.max(1, i0); i < Math.min(d.length, i1); i++) {
    const s = Math.abs(d[i] - d[i - 1]) / scale
    if (s > worst) { worst = s; at = i }
  }
  return { worst, at }
}
function maxDev(d, i0, i1, f, sr) {
  let worst = 0, at = 0
  for (let i = Math.max(0, i0); i < Math.min(d.length, i1); i++) {
    const e = Math.abs(d[i] - f(i / sr))
    if (e > worst) { worst = e; at = i }
  }
  return { worst, at: at / sr }
}
function onsets(d, thr = 0.001) {
  const out = []
  for (let i = 1; i < d.length; i++) if (d[i] > thr && d[i - 1] <= thr) out.push(i)
  return out
}
function peakIn(d, sr, t0, t1) {
  let m = 0
  for (let i = Math.round(t0 * sr); i < Math.min(d.length, Math.round(t1 * sr)); i++) m = Math.max(m, d[i])
  return m
}
// Ganho esperado da guia com trechos calados [de, até] (já com L): desce e sobe em 10 ms.
function guideCurve(intervals) {
  return (t) => {
    for (const [a, b] of intervals) {
      if (t <= a) return 1
      if (t < a + GUIDE_RAMP) return 1 - (t - a) / GUIDE_RAMP
      if (t <= b) return 0
      if (t < b + GUIDE_RAMP) return (t - b) / GUIDE_RAMP
    }
    return 1
  }
}

// Música onde deve estar: sem pulo, `t - L`; com pulos `{ T, song }`, `song + (t - L - T)` depois de
// cada 1. Fora das janelas de cruzamento [T - FADE, T] e das janelas `skips` (mais L).
function posCheck(res, jumps, skips = []) {
  const { data, sr, L } = res
  const songAt = (c) => {
    let pos = c
    for (const j of jumps) if (c >= j.T) pos = j.song + (c - j.T)
    return pos
  }
  const windows = [...jumps.map((j) => [j.T - FADE, j.T]), ...skips]
  const skip = (t) => windows.some(([a, b]) => t > a + L - 2 / sr && t < b + L + 2 / sr)
  let worst = 0
  for (let i = Math.ceil(L * sr) + 1; i < data[0].length; i++) {
    const t = i / sr
    if (skip(t)) continue
    worst = Math.max(worst, Math.abs(data[0][i] - enc(songAt(t - L))))
  }
  return { worst, ok: worst <= POS_TOL }
}
function dcCheck(res) {
  const { data, sr, L } = res
  const dev = maxDev(data[1], Math.ceil(L * sr) + 1, data[1].length, () => 1, sr)
  return { worst: dev.worst, at: dev.at, ok: dev.worst <= DC_TOL }
}
// Bipes esperados `{ at, accent }` (sem L): início em até 2 amostras e pico do acento ou do tempo comum.
function countCheck(res, beats) {
  const { data, sr, L } = res
  const got = onsets(data[2]).map((i) => i / sr)
  const onsetErr = beats.map((b, k) => (got[k] === undefined ? Infinity : Math.abs(got[k] - (b.at + L)) * sr))
  const peakErr = beats.map((b) => Math.abs(peakIn(data[2], sr, b.at + L, b.at + L + 0.1) / MIX - (b.accent ? COUNT_TONE.accentPeak : COUNT_TONE.beatPeak)))
  const step = maxStep(data[2], 1, data[2].length, MIX).worst
  const ok = got.length === beats.length && onsetErr.every((e) => e <= ONSET_TOL) && peakErr.every((e) => e <= PEAK_TOL) && step <= STEP_MAX
  return { ok, onsets: got, onsetErr, peakErr, step }
}
function guideCheck(res, intervals) {
  const { data, sr, L } = res
  const dev = maxDev(data[3], Math.ceil(L * sr) + 1, data[3].length, guideCurve(intervals.map(([a, b]) => [a + L, b + L])), sr)
  const step = maxStep(data[3], Math.ceil(L * sr) + 1, data[3].length).worst
  return { ok: dev.worst <= GUIDE_TOL && step <= STEP_MAX, dev: dev.worst, devAt: dev.at, step }
}

// ---------- Casos ----------
const ARM = (intent, at = 1.2) => ({ at, run: (r) => r.scheduler.setIntent(intent) })
const FULL_TICKS = ticksIn(1.2, BASE.end - 0.05)
const beat = (at, accent = false) => ({ at, accent })

// Pulo inteiro: bipes nos tempos e com o acento, guia calada do 1º bipe ao 1 (mais L), música no alvo depois do 1.
async function jumpCase(sr, L) {
  const res = await render(sr, { L, actions: [ARM({ target: 0, plays: 1 })], ticks: FULL_TICKS })
  const count = countCheck(res, BEATS.map((b, k) => beat(b, k === 0)))
  const guide = guideCheck(res, [[BEATS[0], T]])
  const pos = posCheck(res, [{ T, song: SPANS[0].start }])
  const dc = dcCheck(res)
  const landed = res.log.landed
  const ok = !res.error && count.ok && guide.ok && pos.ok && dc.ok && landed.length === 1 && landed[0].to === 0 && landed[0].at === T
  return { name: `pulo ${sr} Hz, L = ${L}`, ok, error: res.error, count, guide, pos, dc, landed }
}

// Volta seguinte do REPETIR (Ruling T17-volta): o 1 com acento soa em toda volta, sem degrau, a guia
// segue a receita (emendada entre voltas quando a contagem começa no pouso) e a música pousa certo.
const ONE_BAR = [{ index: 0, start: 1, end: 3 }, { index: 1, start: 3, end: 5 }, { index: 2, start: 5, end: 13 }]
const VOLTAS = {
  '1 compasso 4/4': {
    cfg: { grid: G44, spans: ONE_BAR, end: 7.6 }, intent: { target: 0, plays: 3 }, armAt: 1.2,
    beats: [beat(1.5), beat(2), beat(2.5), beat(3, true), beat(3.5), beat(4), beat(4.5), beat(5, true), beat(5.5), beat(6), beat(6.5)],
    guide: [[1.5, 7]], jumps: [{ T: 3, song: 1 }, { T: 5, song: 1 }, { T: 7, song: 1 }],
  },
  '1 compasso 6/8 (conta 2)': {
    cfg: { grid: { ...G44, bpm: 180, signature: '6/8', countEvery: 3 }, spans: ONE_BAR, end: 7.6 }, intent: { target: 0, plays: 3 }, armAt: 1.2,
    beats: [beat(2), beat(3, true), beat(4), beat(5, true), beat(6)],
    guide: [[2, 7]], jumps: [{ T: 3, song: 1 }, { T: 5, song: 1 }, { T: 7, song: 1 }],
  },
  'seção crua de 1 compasso + 0,1 s': {
    cfg: { grid: G44, spans: [{ index: 0, start: 1, end: 3.1 }, { index: 1, start: 3.1, end: 13 }], end: 5.6 }, intent: { target: 0, plays: 2 }, armAt: 1.04,
    beats: [beat(1.1, true), beat(1.6), beat(2.1), beat(2.6), beat(3.2, true), beat(3.7), beat(4.2), beat(4.7)],
    guide: [[1.1, 5.2]], jumps: [{ T: 3.1, song: 1 }, { T: 5.2, song: 1 }],
  },
  '2 compassos de 1 s, relógio no setInterval (tique de 1 s)': {
    cfg: { grid: { ...G44, bpm: 180, signature: '3/4' }, spans: [{ index: 0, start: 1, end: 3 }, { index: 1, start: 3, end: 13 }], end: 8.2, clockMode: 'interval' },
    intent: { target: 0, plays: 3 }, armAt: 1.05, ticks: ticksIn(1.97, 8.1, 1),
    beats: [beat(2, true), beat(2 + 1 / 3), beat(2 + 2 / 3), beat(4, true), beat(4 + 1 / 3), beat(4 + 2 / 3), beat(6, true), beat(6 + 1 / 3), beat(6 + 2 / 3)],
    guide: [[2, 3], [4, 5], [6, 7]], jumps: [{ T: 3, song: 1 }, { T: 5, song: 1 }, { T: 7, song: 1 }],
  },
}
async function voltaCase(sr, name, L = 0, tag = '') {
  const v = VOLTAS[name]
  const res = await render(sr, { L, cfg: v.cfg, actions: [ARM(v.intent, v.armAt)], ticks: v.ticks ?? ticksIn(v.armAt, v.cfg.end - 0.05) })
  const count = countCheck(res, v.beats)
  const guide = guideCheck(res, v.guide)
  const pos = posCheck(res, v.jumps)
  const dc = dcCheck(res)
  const landed = res.log.landed
  const ok = !res.error && count.ok && guide.ok && pos.ok && dc.ok && landed.length === v.jumps.length
    && landed.every((l, k) => l.to === 0 && Math.abs(l.at - v.jumps[k].T) < 1e-9)
  return { name: `volta seguinte, ${name}, ${sr} Hz, L = ${L}${tag}`, ok, error: res.error, count, guide, pos, dc, landed }
}

// Cancelar, trocar ou pausar em `cancelAt`. `expect.jump`: o pulo acontece (pra onde a música vai);
// sem ele, a música segue sem pulo. Contagem e guia sem degrau, contagem muda depois da janela.
async function cancelCase(sr, cancelAt, action) {
  const armed = action.armed ?? { target: 1, plays: 1 }
  const res = await render(sr, {
    cfg: action.cfg ?? BASE,
    actions: [ARM(armed), { at: cancelAt, run: (r) => { r.now = r.ctx.currentTime; action(r) } }],
    ticks: action.ticks ?? [...ticksIn(2.6, 2.8), ...ticksIn(T, T + 0.2)],
  })
  const { data } = res
  const now = res.now
  const i = Math.round(now * sr)
  const count = maxStep(data[2], i - 2, i + Math.round(0.03 * sr), MIX)
  let tail = 0
  if (!action.keepsCount) for (let k = i + Math.round(0.03 * sr); k < data[2].length; k++) tail = Math.max(tail, Math.abs(data[2][k]) / MIX)
  const guideStep = maxStep(data[3], 1, data[3].length)
  const guideBack = action.guideAfter ? { worst: 0 } : maxDev(data[3], Math.ceil((now + GUIDE_RAMP) * sr), data[3].length, () => 1, sr)
  const guide = action.guideAfter ? guideCheck(res, action.guideAfter(now)) : null
  const counted = action.beatsAfter ? countCheck(res, action.beatsAfter(now)) : null
  // Desfeito no meio do cruzamento, as duas vozes se misturam por FADE (a soma continua 1, medida no dc).
  const pos = posCheck(res, action.jump === undefined ? [] : [{ T, song: action.jump }], now >= T - FADE ? [[T - FADE, now + FADE]] : [])
  const dc = dcCheck(res)
  const landed = res.log.landed
  const ok = !res.error && count.worst <= STEP_MAX && tail <= TAIL_MAX && guideStep.worst <= STEP_MAX && guideBack.worst <= DC_TOL
    && (!guide || guide.ok) && (!counted || counted.ok)
    && pos.ok && dc.ok && landed.length === (action.jump === undefined ? 0 : 1)
    && (!action.check || action.check(res))
  return { now, ok, error: res.error, countStep: count.worst, countTail: tail, guideStep: guideStep.worst, guideBack: guideBack.worst, guide, counted, pos, dc, landed: landed.length }
}
const cancel = Object.assign((r) => r.scheduler.setIntent(null), {})
const toSelfLoop = Object.assign((r) => r.scheduler.setIntent({ target: 0, plays: 'infinite' }), { jump: SPANS[0].start })
const resetAction = Object.assign((r) => { r.pause(); r.intentAfterReset = r.scheduler.intent }, {
  check: (res) => res.intentAfterReset?.target === 1 && res.intentAfterReset?.plays === 1,
})
// Pausa com o pulo pra seção 2 (alvo em 9, pulo visível na música): antes do 1 desfaz, do 1 em diante pousa.
const pauseBefore = Object.assign((r) => r.pause(), { armed: { target: 2, plays: 1 }, ticks: [...ticksIn(2.6, 2.8)] })
const pauseAfter = Object.assign((r) => r.pause(), { armed: { target: 2, plays: 1 }, ticks: [...ticksIn(2.6, 2.8)], jump: SPANS[2].start, keepsCount: true, guideAfter: () => [[BEATS[0], T]] })
// Sair do LOOP infinito agendado (relógio no setInterval: agendado 1,5 s antes) pra seção 2: os
// bipes que ainda cabem na folga mínima soam com o número real e a guia cala do primeiro deles ao 1.
const remainingAfter = (now) => BEATS.map((b, k) => ({ b, k })).filter(({ b }) => b >= now + 0.05)
const leaveLoop = Object.assign((r) => r.scheduler.setIntent({ target: 2, plays: 1 }), {
  armed: { target: 0, plays: 'infinite' }, cfg: { ...BASE, clockMode: 'interval' }, ticks: ticksIn(1.2, BASE.end - 0.05),
  jump: SPANS[2].start, keepsCount: true,
  beatsAfter: (now) => remainingAfter(now).map(({ b, k }) => beat(b, k === 0)),
  guideAfter: (now) => { const rest = remainingAfter(now); return rest.length ? [[rest[0].b, T]] : [] },
})

async function sweep(sr, action, everyQuanta, from = 2.71, to = T - CANCEL_GUARD) {
  const first = Math.ceil((from * sr) / QUANTUM)
  const last = Math.ceil((to * sr) / QUANTUM) - 1
  const instants = []
  for (let k = first; k <= last; k += everyQuanta) instants.push(await cancelCase(sr, (k * QUANTUM) / sr, action))
  return instants
}

// Cancelar dentro da guarda: o pulo acontece e o pedido vale depois do pouso.
async function lateCancelCase(sr) {
  const res = await render(sr, { actions: [ARM({ target: 2, plays: 1 }), { at: T - 0.02, run: (r) => r.scheduler.setIntent(null) }], ticks: FULL_TICKS })
  const pos = posCheck(res, [{ T, song: SPANS[2].start }])
  const dc = dcCheck(res)
  const ok = !res.error && pos.ok && dc.ok && res.log.landed.length === 1 && res.scheduler.intent === null
  return { name: `cancelar a 20 ms do 1 (${sr} Hz)`, ok, error: res.error, pos, dc, landed: res.log.landed, intent: res.scheduler.intent }
}

// Trocar o alvo no meio da contagem: bipes e guia intocados, música no alvo novo.
async function retargetCase(sr) {
  const res = await render(sr, { actions: [ARM({ target: 0, plays: 1 }), { at: 3.6, run: (r) => r.scheduler.setIntent({ target: 2, plays: 1 }) }], ticks: FULL_TICKS })
  const count = countCheck(res, BEATS.map((b, k) => beat(b, k === 0)))
  const guide = guideCheck(res, [[BEATS[0], T]])
  const pos = posCheck(res, [{ T, song: SPANS[2].start }])
  const dc = dcCheck(res)
  const ok = !res.error && count.ok && guide.ok && pos.ok && dc.ok && res.log.landed.length === 1 && res.log.landed[0].to === 2
  return { name: `trocar o alvo na contagem (${sr} Hz)`, ok, error: res.error, count, guide, pos, dc, landed: res.log.landed }
}

// ---------- Controles negativos: a medida acusa o degrau das receitas erradas ----------
async function guideControl(sr, recipe) {
  const ctx = new OfflineAudioContext({ numberOfChannels: 1, length: Math.round(BASE.end * sr), sampleRate: sr })
  const src = ctx.createConstantSource()
  const g = ctx.createGain()
  src.connect(g); g.connect(ctx.destination); src.start(0)
  const a = 3, b = 5
  g.gain.setValueAtTime(1, a); g.gain.linearRampToValueAtTime(0, a + GUIDE_RAMP)
  g.gain.setValueAtTime(0, b); g.gain.linearRampToValueAtTime(1, b + GUIDE_RAMP)
  ctx.suspend(Math.ceil((4 * sr) / QUANTUM) * QUANTUM / sr).then(() => { recipe(g.gain, ctx.currentTime); return ctx.resume() })
  const d = (await ctx.startRendering()).getChannelData(0)
  return maxStep(d, 1, d.length).worst
}
// Bipe de verdade (osciladores e passa-baixa reais) num instante fora da amostra exata: a primeira
// amostra tem de sair perto de 0, como a fonte imitada acima.
async function realBeepStart(sr, at) {
  const ctx = new OfflineAudioContext({ numberOfChannels: 1, length: Math.round((at + 0.3) * sr), sampleRate: sr })
  scheduleCount(ctx, ctx.destination, [{ at, label: 1 }])
  const d = (await ctx.startRendering()).getChannelData(0)
  const i = Math.floor(at * sr)
  let first = 0
  for (let k = i - 1; k <= i + 1; k++) first = Math.max(first, Math.abs(d[k]))
  let peak = 0
  for (let k = i; k < i + Math.round(0.1 * sr); k++) peak = Math.max(peak, Math.abs(d[k]))
  return { name: `bipe de verdade em ${at} s, ${sr} Hz: primeiras amostras`, ok: first < 0.01 && peak > 0.3, first, peak }
}

const literal = (p, now) => { p.cancelScheduledValues(now); p.setValueAtTime(1, now) } // o texto do brief
const rampOnly = (p, now) => { p.cancelAndHoldAtTime(now); p.linearRampToValueAtTime(1, now + GUIDE_RAMP) } // sem o set fora da rampa

// Sem cancelAndHoldAtTime (Firefox): tira o método do protótipo durante a varredura.
async function withoutCancelAndHold(fn) {
  const desc = Object.getOwnPropertyDescriptor(AudioParam.prototype, 'cancelAndHoldAtTime')
  Object.defineProperty(AudioParam.prototype, 'cancelAndHoldAtTime', { value: undefined, configurable: true, writable: true })
  try { return await fn() } finally { Object.defineProperty(AudioParam.prototype, 'cancelAndHoldAtTime', desc) }
}

function summarize(name, instants) {
  const bad = instants.filter((r) => !r.ok)
  const worst = (k) => instants.reduce((m, r) => Math.max(m, typeof r[k] === 'number' ? r[k] : 0), 0)
  return {
    name, ok: bad.length === 0 && instants.length > 0, count: instants.length, badCount: bad.length, bad: bad.slice(0, 8),
    worst: { countStep: worst('countStep'), countTail: worst('countTail'), guideStep: worst('guideStep'), guideBack: worst('guideBack'),
      pos: instants.reduce((m, r) => Math.max(m, r.pos.worst), 0), dc: instants.reduce((m, r) => Math.max(m, r.dc.worst), 0) },
  }
}

async function voltas(tag) {
  const out = []
  for (const sr of [48000, 44100]) {
    for (const name of Object.keys(VOLTAS)) out.push(await voltaCase(sr, name, 0, tag))
    out.push(await voltaCase(sr, '1 compasso 4/4', 0.12, tag))
  }
  return out
}

async function main() {
  const which = new URLSearchParams(location.search).get('case')
  const criteria = { STEP_MAX, DC_TOL, POS_TOL, TAIL_MAX, ONSET_TOL, PEAK_TOL, GUIDE_TOL }
  if (which === 'folga0') return { userAgent: navigator.userAgent, criteria, cases: await voltas(' (folga mínima 0)'), sweeps: [], controls: [] }
  const cases = []
  for (const sr of [48000, 44100]) {
    cases.push(await jumpCase(sr, 0))
    cases.push(await jumpCase(sr, 0.12))
    cases.push(await lateCancelCase(sr))
    cases.push(await retargetCase(sr))
  }
  cases.push(...(await voltas('')))
  for (const at of [1.1, 4 + 1 / 3]) for (const sr of [48000, 44100]) cases.push(await realBeepStart(sr, at))
  const guardFrom = T - CANCEL_GUARD
  const sweeps = [
    summarize('cancelar, 48 kHz, nativo', await sweep(48000, cancel, 2)),
    summarize('cancelar, 44,1 kHz, nativo', await sweep(44100, cancel, 5)),
    summarize('cancelar, 48 kHz, sem cancelAndHoldAtTime', await withoutCancelAndHold(() => sweep(48000, cancel, 5))),
    summarize('trocar pro loop da própria seção, 48 kHz, nativo', await sweep(48000, toSelfLoop, 3)),
    summarize('trocar pro loop da própria seção, 48 kHz, sem cancelAndHoldAtTime', await withoutCancelAndHold(() => sweep(48000, toSelfLoop, 7))),
    summarize('pausa (reset e linha do tempo vazia) antes do 1, 48 kHz', await sweep(48000, resetAction, 9)),
    summarize('pausa na janela da guarda (T - 30 ms a T), 48 kHz, nativo', await sweep(48000, pauseBefore, 1, guardFrom, T)),
    summarize('pausa na janela da guarda (T - 30 ms a T), 44,1 kHz, nativo', await sweep(44100, pauseBefore, 1, guardFrom, T)),
    summarize('pausa na janela da guarda (T - 30 ms a T), 48 kHz, sem cancelAndHoldAtTime', await withoutCancelAndHold(() => sweep(48000, pauseBefore, 1, guardFrom, T))),
    summarize('pausa entre o 1 e o pouso (T a T + 35 ms), 48 kHz', await sweep(48000, pauseAfter, 1, T, T + FADE + RELEASE_AFTER)),
    summarize('sair do LOOP agendado pra um alvo com contagem, 48 kHz, nativo', await sweep(48000, leaveLoop, 4, 3.51)),
    summarize('sair do LOOP agendado pra um alvo com contagem, 48 kHz, sem cancelAndHoldAtTime', await withoutCancelAndHold(() => sweep(48000, leaveLoop, 9, 3.51))),
  ]
  const controls = [
    { name: 'guia pelo texto do brief (cancelScheduledValues + set 1)', step: await guideControl(48000, literal) },
    { name: 'guia com cancelAndHold + rampa, sem o set fora da rampa', step: await guideControl(48000, rampOnly) },
  ].map((c) => ({ ...c, caught: c.step > STEP_MAX }))
  return { userAgent: navigator.userAgent, criteria, cases, sweeps, controls }
}

const name = new URLSearchParams(location.search).get('name') || 'section-scheduler'
main()
  .catch((e) => ({ fatal: String(e && e.stack ? e.stack : e) }))
  .then(async (result) => {
    await fetch(`/result?name=${encodeURIComponent(name)}`, { method: 'POST', body: JSON.stringify(result) })
    document.getElementById('out').textContent = 'pronto'
  })

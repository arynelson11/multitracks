// Página do section-scheduler.mjs: roda o SectionScheduler REAL (src/audio/sectionScheduler.ts,
// com o planTransition, a linha do tempo, as vozes e a contagem reais) num OfflineAudioContext do
// Chrome. O tique e os pedidos do operador rodam dentro de ctx.suspend(t), com now =
// ctx.currentTime, como o relógio da T5 faria. Quatro saídas, uma por coisa medida:
//   0 "pos": voz cuja amostra vale 0,05 + 0,05 x (segundos da música): mostra onde a música está;
//   1 "dc":  voz de amostras 1: com os envelopes certos a soma das vozes é 1 o tempo todo;
//   2 contagem: osciladores viram fonte constante 1 e o passa-baixa vira ganho 1, então a saída
//     é (1 + squareMix) x envelope do bipe (como no count-cancel);
//   3 guia: fonte constante 1 pelo ganho do barramento da guia: a saída é o próprio ganho.
// Grade 120 em 4/4 com o 1 em 1 s; seções [1,5] [5,9] [9,13]. O pulo armado na primeira cai em 5.
import { CANCEL_GUARD, FADE, SectionScheduler } from '@t17/sectionScheduler'
import { startVoice, startVoicesForSwitch } from '@t17/voices'
import { COUNT_TONE } from '@t17/countTones'

const QUANTUM = 128
const GRID = { bpm: 120, firstDownbeat: 1, signature: '4/4', countEvery: 1, source: 'click', meterSource: 'acento' }
const SPANS = [{ index: 0, start: 1, end: 5 }, { index: 1, start: 5, end: 9 }, { index: 2, start: 9, end: 13 }]
const T = 5
const BEATS = [3, 3.5, 4, 4.5]
const END = 5.4
const MIX = 1 + COUNT_TONE.squareMix
const GUIDE_RAMP = 0.01
const enc = (x) => 0.05 + 0.05 * x

// Critérios
const STEP_MAX = 0.01 // degrau por amostra na contagem e na guia (o mesmo do count-cancel)
const DC_TOL = 1e-4
const POS_TOL = 1e-4
const TAIL_MAX = 1e-3
const ONSET_TOL = 2 // amostras (a rampa do ataque passa do limiar 1 amostra depois do início)

function patch(ctx) {
  const realGain = ctx.createGain.bind(ctx)
  ctx.createOscillator = () => {
    const c = ctx.createConstantSource()
    c.offset.value = 1
    return Object.assign(c, { type: 'constant', frequency: { value: 0 } })
  }
  ctx.createBiquadFilter = () => Object.assign(realGain(), { type: 'constant', frequency: { value: 0 }, Q: { value: 0 } })
}

function build(sr, L) {
  const ctx = new OfflineAudioContext({ numberOfChannels: 4, length: Math.round(END * sr), sampleRate: sr })
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
    spans: () => SPANS,
    grid: () => GRID,
    currentVoices: () => current,
    setCurrentVoices: (v) => { current = v },
    startSwitchVoices: (at, offset, fade) => startVoicesForSwitch(ctx, specs, at, offset, fade, 1),
    countDestination: () => clickEntry,
    guideGain: () => guideBus.gain,
    entryLatency: () => L,
    clickAudible: () => true,
    onView: () => {},
    onLanded: (to, at) => log.landed.push({ to, at }),
  })
  // A pausa do motor: reset e linha do tempo vazia (VS parada, T5), com o som seguindo na página.
  const pause = () => { scheduler.reset(); timeline = [] }
  return { ctx, scheduler, log, pause }
}

// Tiques a cada 25 ms em [from, to].
const ticksIn = (from, to) => { const out = []; for (let t = from; t <= to + 1e-9; t += 0.025) out.push(t); return out }

async function render(sr, { L = 0, actions = [], ticks }) {
  const r = build(sr, L)
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
function onsets(d, sr, thr = 0.001) {
  const out = []
  for (let i = 1; i < d.length; i++) if (d[i] > thr && d[i - 1] <= thr) out.push(i)
  return out
}
function peakIn(d, sr, t0, t1) {
  let m = 0
  for (let i = Math.round(t0 * sr); i < Math.round(t1 * sr); i++) m = Math.max(m, d[i])
  return m
}
function guideCurve(a, b) {
  return (t) => (t <= a ? 1 : t < a + GUIDE_RAMP ? 1 - (t - a) / GUIDE_RAMP : t <= b ? 0 : t < b + GUIDE_RAMP ? (t - b) / GUIDE_RAMP : 1)
}

// Música onde deve estar: sem pulo, `t - L`; com pulo pro alvo, `alvo + (t - L - T)` depois do 1.
function posCheck(res, target) {
  const { data, sr, L } = res
  const before = maxDev(data[0], Math.ceil(L * sr) + 1, Math.floor((T - FADE + L) * sr), (t) => enc(t - L), sr)
  const after = target === null
    ? maxDev(data[0], Math.floor((T - FADE + L) * sr), data[0].length, (t) => enc(t - L), sr)
    : maxDev(data[0], Math.ceil((T + L) * sr) + 1, data[0].length, (t) => enc(target + (t - L - T)), sr)
  return { before: before.worst, after: after.worst, ok: before.worst <= POS_TOL && after.worst <= POS_TOL }
}
function dcCheck(res) {
  const { data, sr, L } = res
  const dev = maxDev(data[1], Math.ceil(L * sr) + 1, data[1].length, () => 1, sr)
  return { worst: dev.worst, at: dev.at, ok: dev.worst <= DC_TOL }
}

// ---------- Casos ----------
const ARM = (intent) => ({ at: 1.2, run: (r) => r.scheduler.setIntent(intent) })
const FULL_TICKS = ticksIn(1.2, END - 0.05)

// Pulo inteiro: bipes nos tempos e com o acento, guia calada do 1º bipe ao 1 (mais L), música no alvo depois do 1.
async function jumpCase(sr, L) {
  const res = await render(sr, { L, actions: [ARM({ target: 0, plays: 1 })], ticks: FULL_TICKS })
  const { data } = res
  const got = onsets(data[2], sr).map((i) => i / sr)
  const want = BEATS.map((b) => b + L)
  const onsetErr = want.map((w, k) => (got[k] === undefined ? Infinity : Math.abs(got[k] - w) * sr))
  const peaks = want.map((w) => peakIn(data[2], sr, w, w + 0.1) / MIX)
  const peakErr = peaks.map((p, k) => Math.abs(p - (k === 0 ? COUNT_TONE.accentPeak : COUNT_TONE.beatPeak)))
  const guide = maxDev(data[3], Math.ceil(L * sr) + 1, data[3].length, guideCurve(BEATS[0] + L, T + L), sr)
  const guideStep = maxStep(data[3], Math.ceil(L * sr) + 1, data[3].length)
  const pos = posCheck(res, SPANS[0].start)
  const dc = dcCheck(res)
  const landed = res.log.landed
  const ok = !res.error && got.length === 4 && onsetErr.every((e) => e <= ONSET_TOL) && peakErr.every((e) => e <= 0.01)
    && guide.worst <= 1e-3 && guideStep.worst <= STEP_MAX && pos.ok && dc.ok
    && landed.length === 1 && landed[0].to === 0 && landed[0].at === T
  return { name: `pulo ${sr} Hz, L = ${L}`, ok, error: res.error, onsets: got, onsetErrSamples: onsetErr, peaks, guideDev: guide.worst, guideStep: guideStep.worst, pos, dc, landed }
}

// Cancelar em `cancelAt` (antes da guarda): sem pulo, música seguindo, soma das vozes 1, contagem
// e guia sem degrau, contagem muda e guia em 1 depois da janela.
async function cancelCase(sr, cancelAt, action) {
  const res = await render(sr, {
    actions: [ARM({ target: 1, plays: 1 }), { at: cancelAt, run: (r) => { r.now = r.ctx.currentTime; action(r) } }],
    ticks: [...ticksIn(2.6, 2.8), ...ticksIn(T, T + 0.2)],
  })
  const { data } = res
  const now = res.now
  const i = Math.round(now * sr)
  const count = maxStep(data[2], i - 2, i + Math.round(0.03 * sr), MIX)
  let tail = 0
  for (let k = i + Math.round(0.03 * sr); k < data[2].length; k++) tail = Math.max(tail, Math.abs(data[2][k]) / MIX)
  const guideStep = maxStep(data[3], 1, data[3].length)
  const guideBack = maxDev(data[3], Math.ceil((now + GUIDE_RAMP) * sr), data[3].length, () => 1, sr)
  const pos = posCheck(res, action.target ?? null)
  const dc = dcCheck(res)
  const landed = res.log.landed
  const wantLanded = action.target === undefined ? 0 : 1
  const ok = !res.error && count.worst <= STEP_MAX && tail <= TAIL_MAX && guideStep.worst <= STEP_MAX && guideBack.worst <= DC_TOL
    && pos.ok && dc.ok && landed.length === wantLanded
    && (action !== resetAction || (res.intentAfterReset?.target === 1 && res.intentAfterReset?.plays === 1))
  return { now, ok, error: res.error, countStep: count.worst, countTail: tail, guideStep: guideStep.worst, guideBack: guideBack.worst, pos, dc, landed: landed.length }
}
const cancel = Object.assign((r) => r.scheduler.setIntent(null), {})
const toSelfLoop = Object.assign((r) => r.scheduler.setIntent({ target: 0, plays: 'infinite' }), { target: SPANS[0].start })
const resetAction = Object.assign((r) => { r.pause(); r.intentAfterReset = r.scheduler.intent }, {})

async function sweep(sr, action, everyQuanta) {
  // Do primeiro quantum depois de agendar (o tique de 2,7 agenda: 1º bipe a 0,3 s) até a guarda.
  const first = Math.ceil((2.71 * sr) / QUANTUM)
  const last = Math.floor(((T - CANCEL_GUARD) * sr) / QUANTUM) - 1
  const instants = []
  for (let k = first; k <= last; k += everyQuanta) instants.push(await cancelCase(sr, (k * QUANTUM) / sr, action))
  return instants
}

// Cancelar dentro da guarda: o pulo acontece e o pedido vale depois do pouso.
async function lateCancelCase(sr) {
  const res = await render(sr, { actions: [ARM({ target: 2, plays: 1 }), { at: T - 0.02, run: (r) => r.scheduler.setIntent(null) }], ticks: FULL_TICKS })
  const pos = posCheck(res, SPANS[2].start)
  const dc = dcCheck(res)
  const ok = !res.error && pos.ok && dc.ok && res.log.landed.length === 1 && res.scheduler.intent === null
  return { name: `cancelar a 20 ms do 1 (${sr} Hz)`, ok, error: res.error, pos, dc, landed: res.log.landed, intent: res.scheduler.intent }
}

// Trocar o alvo no meio da contagem: bipes e guia intocados, música no alvo novo.
async function retargetCase(sr) {
  const res = await render(sr, { actions: [ARM({ target: 0, plays: 1 }), { at: 3.6, run: (r) => r.scheduler.setIntent({ target: 2, plays: 1 }) }], ticks: FULL_TICKS })
  const { data } = res
  const got = onsets(data[2], sr).map((i) => i / sr)
  const onsetOk = got.length === 4 && got.every((g, k) => Math.abs(g - BEATS[k]) * sr <= ONSET_TOL)
  const guide = maxDev(data[3], 1, data[3].length, guideCurve(BEATS[0], T), sr)
  const pos = posCheck(res, SPANS[2].start)
  const dc = dcCheck(res)
  const ok = !res.error && onsetOk && guide.worst <= 1e-3 && pos.ok && dc.ok && res.log.landed.length === 1 && res.log.landed[0].to === 2
  return { name: `trocar o alvo na contagem (${sr} Hz)`, ok, error: res.error, onsets: got, guideDev: guide.worst, pos, dc, landed: res.log.landed }
}

// ---------- Controles negativos: a medida acusa o degrau das receitas erradas ----------
async function guideControl(sr, recipe) {
  const ctx = new OfflineAudioContext({ numberOfChannels: 1, length: Math.round(END * sr), sampleRate: sr })
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
    name, ok: bad.length === 0, count: instants.length, badCount: bad.length, bad: bad.slice(0, 8),
    worst: { countStep: worst('countStep'), countTail: worst('countTail'), guideStep: worst('guideStep'), guideBack: worst('guideBack'),
      pos: instants.reduce((m, r) => Math.max(m, r.pos.before, r.pos.after), 0), dc: instants.reduce((m, r) => Math.max(m, r.dc.worst), 0) },
  }
}

async function main() {
  const cases = []
  for (const sr of [48000, 44100]) {
    cases.push(await jumpCase(sr, 0))
    cases.push(await jumpCase(sr, 0.12))
    cases.push(await lateCancelCase(sr))
    cases.push(await retargetCase(sr))
  }
  const sweeps = [
    summarize('cancelar, 48 kHz, nativo', await sweep(48000, cancel, 2)),
    summarize('cancelar, 44,1 kHz, nativo', await sweep(44100, cancel, 5)),
    summarize('cancelar, 48 kHz, sem cancelAndHoldAtTime', await withoutCancelAndHold(() => sweep(48000, cancel, 5))),
    summarize('trocar pro loop da própria seção, 48 kHz, nativo', await sweep(48000, toSelfLoop, 3)),
    summarize('trocar pro loop da própria seção, 48 kHz, sem cancelAndHoldAtTime', await withoutCancelAndHold(() => sweep(48000, toSelfLoop, 7))),
    summarize('pausa (reset e linha do tempo vazia) antes do 1, 48 kHz', await sweep(48000, resetAction, 9)),
  ]
  const controls = [
    { name: 'guia pelo texto do brief (cancelScheduledValues + set 1)', step: await guideControl(48000, literal) },
    { name: 'guia com cancelAndHold + rampa, sem o set fora da rampa', step: await guideControl(48000, rampOnly) },
  ].map((c) => ({ ...c, caught: c.step > STEP_MAX }))
  return { userAgent: navigator.userAgent, criteria: { STEP_MAX, DC_TOL, POS_TOL, TAIL_MAX, ONSET_TOL }, cases, sweeps, controls }
}

const name = new URLSearchParams(location.search).get('name') || 'section-scheduler'
main()
  .catch((e) => ({ fatal: String(e && e.stack ? e.stack : e) }))
  .then(async (result) => {
    await fetch(`/result?name=${encodeURIComponent(name)}`, { method: 'POST', body: JSON.stringify(result) })
    document.getElementById('out').textContent = 'pronto'
  })

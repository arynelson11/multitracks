// Página do output-graph.mjs: monta o createOutputGraph REAL (src/audio/outputGraph.ts) com o
// planOutputs e o effectivePan reais num OfflineAudioContext do Chrome e mede o som de verdade
// em cada saída. Cada canal é montado como o motor monta (fonte -> panner, mono com 1 canal como
// o setupPannerForBuffer -> fader -> barramento do papel). A linha de base da v1.4.15 é o grafo
// dela: fonte -> panner -> fader -> principal -> destino, com o pan automático (Click e Guia em
// -1, o resto em +1) ou com o knob em "Tudo junto". A contagem é o scheduleCount real
// (src/audio/countTones.ts) no atraso da contagem do grafo.
import { createOutputGraph } from '@t12/outputGraph'
import { DEFAULT_OUTPUTS, effectivePan, planOutputs } from '@t12/outputPlan'
import { scheduleCount } from '@t12/countTones'

const SR = 48000
const LEN_S = 1
const LEN = SR * LEN_S
const QUANTUM = 128
const MASTER = 0.7
const FADER = 0.8
const COUNT_L = 0.05 // atraso L da contagem (latência do tom), como o motor ajusta
const COUNT_BEATS = [0.1, 0.3, 0.5, 0.7].map((at, i) => ({ at, label: i + 1 }))
const SWITCH_AT = 0.5 // troca de rota pedida aqui; o suspend do Chrome arredonda PRA CIMA no quantum (0,50133 s)

const settings = (mode, extra = {}) => ({ ...DEFAULT_OUTPUTS, multi: { ...DEFAULT_OUTPUTS.multi }, mode, ...extra })
const PLANS = {
  stereo: () => planOutputs(settings('stereo'), 2),
  split2L: () => planOutputs(settings('split2'), 2),
  split2R: () => planOutputs(settings('split2', { earOnSecond: true }), 2),
  multi8: () => planOutputs(settings('multi'), 8),
  multi8b: () => planOutputs(settings('multi', { multi: { vsPair: 2, click: 0, guide: 5 } }), 8),
  multi3: () => planOutputs(settings('multi'), 3),
}

// ---------- Sinais ----------
function makeBuffer(ctx, mono) {
  const b = ctx.createBuffer(mono ? 1 : 2, LEN, SR)
  const l = b.getChannelData(0)
  for (let i = 0; i < LEN; i++) {
    const t = i / SR
    l[i] = mono ? 0.5 * Math.sin(2 * Math.PI * 440 * t) + 0.2 * Math.sin(2 * Math.PI * 1250 * t) : 0.4 * Math.sin(2 * Math.PI * 330 * t)
  }
  if (!mono) {
    const r = b.getChannelData(1)
    for (let i = 0; i < LEN; i++) r[i] = 0.3 * Math.sin(2 * Math.PI * 550 * (i / SR) + 0.7)
  }
  return b
}

function channel(ctx, into, { mono, pan, gain = FADER }) {
  const src = ctx.createBufferSource()
  src.buffer = makeBuffer(ctx, mono)
  const panner = ctx.createStereoPanner()
  if (mono) { panner.channelCountMode = 'explicit'; panner.channelCount = 1 }
  panner.pan.value = pan
  const fader = ctx.createGain()
  fader.gain.value = gain
  src.connect(panner); panner.connect(fader); fader.connect(into)
  src.start(0)
  return { src, panner }
}

function legacyContext() {
  const ctx = new OfflineAudioContext(2, LEN, SR)
  const master = ctx.createGain()
  master.gain.value = MASTER
  master.connect(ctx.destination)
  return { ctx, master }
}

/**
 * Contexto offline de `n` canais que se comporta como um aparelho de `n` saídas. No Chrome 157
 * o destino offline passa a dizer maxChannelCount = channelCount depois que o channelCount muda
 * (2 em separados), embora aceite voltar pra `n`; num AudioContext de verdade o
 * maxChannelCount é o do aparelho. Sem isto a troca separados -> 4 ou mais lançaria aqui.
 */
function deviceContext(n) {
  const ctx = new OfflineAudioContext(n, LEN, SR)
  Object.defineProperty(ctx.destination, 'maxChannelCount', { value: n })
  return ctx
}

function graphContext(plan) {
  const ctx = deviceContext(Math.max(2, plan.channels))
  const g = createOutputGraph(ctx, plan)
  g.master.gain.value = MASTER
  return { ctx, g }
}

const channelsOf = (buf) => Array.from({ length: buf.numberOfChannels }, (_, c) => buf.getChannelData(c))

// ---------- Medidas ----------
function stats(d, from = 0, to = d.length) {
  let peak = 0
  let sum = 0
  for (let i = from; i < to; i++) { const v = Math.abs(d[i]); if (v > peak) peak = v; sum += d[i] * d[i] }
  return { peak, rms: Math.sqrt(sum / Math.max(1, to - from)) }
}
const db = (x) => (x > 0 ? 20 * Math.log10(x) : -Infinity)
function compare(got, ref) {
  let maxDiff = 0
  for (let i = 0; i < ref.length; i++) maxDiff = Math.max(maxDiff, Math.abs(got[i] - ref[i]))
  const a = stats(got).rms
  const b = stats(ref).rms
  // Lado em silêncio na v1.4.15 (abaixo de -120 dB): basta continuar em silêncio.
  const silent = b < 1e-6
  return { errorDb: silent ? (a < 1e-6 ? 0 : Infinity) : Math.abs(db(a / b)), maxDiff, refRmsDb: db(b), gotRmsDb: db(a), silent }
}

// ---------- A: vazamento pra VS em separados e em 4 ou mais ----------
async function leakCase(planName, sources) {
  const plan = PLANS[planName]()
  const { ctx, g } = graphContext(plan)
  for (const s of sources) {
    if (s.kind === 'count') { g.countDelay.delayTime.value = COUNT_L; scheduleCount(ctx, g.countDelay, COUNT_BEATS) }
    else channel(ctx, g.input(s.role), { mono: s.mono, pan: s.pan === 'auto' ? effectivePan(0, s.role, plan) : s.pan })
  }
  const out = channelsOf(await ctx.startRendering())
  const vs = plan.vs.map((o) => ({ output: o + 1, ...stats(out[o]) }))
  // Ouvido: só as saídas dos papéis que tocaram (a contagem sai onde o Click sai).
  const earOutputs = [...new Set(sources.flatMap((s) => (s.kind === 'count' || s.role === 'click' ? plan.click : plan.guide)))]
  const ear = earOutputs.map((o) => ({ output: o + 1, ...stats(out[o]) }))
  const worst = vs.reduce((a, v) => Math.max(a, v.peak), 0)
  return { plan: planName, sources, vsPeakDb: db(worst), vs, ear: ear.map((e) => ({ output: e.output, peakDb: db(e.peak) })) }
}

async function leaks() {
  const rows = []
  for (const planName of ['split2L', 'split2R']) {
    const plan = PLANS[planName]()
    for (const role of ['click', 'guide']) for (const mono of [true, false]) {
      for (const pan of ['auto', 0, 0.37, -1, 1]) rows.push(await leakCase(planName, [{ role, mono, pan }]))
    }
    rows.push(await leakCase(planName, [{ kind: 'count' }]))
    // Os três ao mesmo tempo: click estéreo com o pan do lado errado, guia mono no centro e a contagem.
    rows.push(await leakCase(planName, [{ role: 'click', mono: false, pan: -effectivePan(0, 'click', plan) }, { role: 'guide', mono: true, pan: 0 }, { kind: 'count' }]))
  }
  for (const planName of ['multi8', 'multi8b', 'multi3']) {
    for (const role of ['click', 'guide']) for (const mono of [true, false]) for (const pan of ['auto', 0, 1]) rows.push(await leakCase(planName, [{ role, mono, pan }]))
    rows.push(await leakCase(planName, [{ kind: 'count' }]))
  }
  return rows
}

// ---------- B: nível igual à v1.4.15 (R-24) ----------
async function levelCase({ planName, role, mono, knob }) {
  const plan = PLANS[planName]()
  const { ctx, g } = graphContext(plan)
  channel(ctx, g.input(role), { mono, pan: effectivePan(knob, role, plan) })
  const out = channelsOf(await ctx.startRendering())

  // Linha de base: separados e 4 ou mais = pan automático da v1.4.15 (ouvido em -1, VS em +1);
  // Tudo junto e a VS em 4 ou mais = o knob, sem pan automático.
  const auto = plan.mode === 'split2' || (plan.mode === 'multi' && role !== 'normal')
  const legacyPan = auto ? (role === 'normal' ? 1 : -1) : knob
  const ref = legacyContext()
  channel(ref.ctx, ref.master, { mono, pan: legacyPan })
  const [refL, refR] = channelsOf(await ref.ctx.startRendering())

  const pairs = [] // [saída nova, saída da v1.4.15]
  if (plan.mode === 'stereo') pairs.push([0, refL], [1, refR])
  else if (plan.mode === 'split2') pairs.push(role === 'normal' ? [plan.vs[0], refR] : [plan.click[0], refL])
  else if (role === 'normal') pairs.push([plan.vs[0], refL], [plan.vs[1], refR])
  else pairs.push([(role === 'click' ? plan.click : plan.guide)[0], refL])
  return { plan: planName, role, mono, knob, outputs: pairs.map(([o, r]) => ({ output: o + 1, ...compare(out[o], r) })) }
}

async function levels() {
  const rows = []
  for (const planName of ['split2L', 'split2R', 'multi8', 'multi8b']) for (const role of ['click', 'guide', 'normal']) for (const mono of [true, false]) {
    rows.push(await levelCase({ planName, role, mono, knob: 0.42 }))
  }
  for (const role of ['click', 'guide', 'normal']) for (const mono of [true, false]) for (const knob of [-0.5, 0, 0.3, 1]) {
    rows.push(await levelCase({ planName: 'stereo', role, mono, knob }))
  }
  for (const mono of [true, false]) for (const knob of [-0.6, 0]) rows.push(await levelCase({ planName: 'multi8', role: 'normal', mono, knob }))
  return rows
}

// ---------- C: troca de rota com apply() no meio do som ----------
// Os pans dos canais NÃO mudam na troca (o motor pode atrasar): os barramentos seguram sozinhos.
async function switchCase(fromName, toName) {
  const from = PLANS[fromName]()
  const to = PLANS[toName]()
  const n = Math.max(2, from.channels, to.channels)
  const ctx = deviceContext(n)
  const g = createOutputGraph(ctx, from)
  g.master.gain.value = MASTER
  channel(ctx, g.input('click'), { mono: false, pan: effectivePan(0.3, 'click', from) })
  channel(ctx, g.input('guide'), { mono: true, pan: effectivePan(-0.2, 'guide', from) })
  g.countDelay.delayTime.value = COUNT_L
  scheduleCount(ctx, g.countDelay, COUNT_BEATS)
  let applyError = null
  let switchedAt = null
  ctx.suspend(SWITCH_AT).then(() => {
    switchedAt = ctx.currentTime
    try { g.apply(to) } catch (e) { applyError = String(e) }
    return ctx.resume()
  })
  const out = channelsOf(await ctx.startRendering())
  // Mede a partir do instante real da troca (o quantum em que o apply valeu), sem folga.
  const at = Math.round(switchedAt * SR)
  const after = (o) => stats(out[o], at, LEN)
  const vs = to.vs.map((o) => ({ output: o + 1, ...after(o) }))
  const ear = [...new Set([...to.click, ...to.guide])].map((o) => ({ output: o + 1, peakDb: db(after(o).peak) }))
  // Antes da troca, com o plano de origem (em Tudo junto o click está nas duas saídas por definição).
  const vsBefore = from.mode === 'stereo' ? null : db(from.vs.reduce((a, o) => Math.max(a, stats(out[o], 0, at).peak), 0))
  return { from: fromName, to: toName, switchedAt, applyError, vsPeakDbAfter: db(vs.reduce((a, v) => Math.max(a, v.peak), 0)), vsPeakDbBefore: vsBefore, ear }
}

async function switches() {
  const pairs = [
    ['stereo', 'split2L'], ['stereo', 'split2R'], ['split2L', 'split2R'], ['split2R', 'split2L'], ['split2L', 'multi8'], ['multi8', 'split2L'],
    ['multi8', 'split2R'], ['multi8', 'multi8b'], ['multi8b', 'multi8'], ['split2R', 'multi8b'],
    // Tudo junto -> 4 ou mais e a queda de 3 canais (merger de 3) nos dois sentidos.
    ['stereo', 'multi8'], ['stereo', 'multi8b'], ['stereo', 'multi3'], ['split2L', 'multi3'], ['split2R', 'multi3'], ['multi3', 'split2R'],
    ['multi3', 'multi8'], ['multi8', 'multi3'], ['multi8b', 'multi3'],
  ]
  const rows = []
  for (const [a, b] of pairs) rows.push(await switchCase(a, b))
  return rows
}

// ---------- E: contagem no mesmo nível com ou sem canal tocando no barramento do Click ----------
// A contagem é mono; sem o panner próprio ela entraria no barramento junto de um canal estéreo
// e seria copiada nos dois lados antes do pan do barramento (o dobro no ouvido).
async function countLevel() {
  // A contagem real renderizada uma vez num buffer mono e tocada de novo em cada caso: o Chrome
  // 157 não sintetiza os osciladores bit a bit igual entre renderizações (diferença de até 3e-4
  // renderizando a mesma contagem duas vezes), e aqui o que se mede é só a rota.
  const pre = new OfflineAudioContext(1, LEN, SR)
  scheduleCount(pre, pre.destination, COUNT_BEATS)
  const beeps = await pre.startRendering()
  const rows = []
  for (const planName of ['split2L', 'split2R', 'multi8']) {
    const plan = PLANS[planName]()
    const render = async (withCount, withClick) => {
      const { ctx, g } = graphContext(plan)
      if (withClick) channel(ctx, g.input('click'), { mono: false, pan: effectivePan(0, 'click', plan) })
      if (withCount) {
        g.countDelay.delayTime.value = COUNT_L
        const src = ctx.createBufferSource()
        src.buffer = beeps
        src.connect(g.countDelay)
        src.start(0)
      }
      return channelsOf(await ctx.startRendering())[plan.click[0]]
    }
    const alone = await render(true, false)
    const both = await render(true, true)
    const click = await render(false, true)
    let maxDiff = 0
    const inBoth = new Float32Array(LEN)
    for (let i = 0; i < LEN; i++) { inBoth[i] = both[i] - click[i]; maxDiff = Math.max(maxDiff, Math.abs(inBoth[i] - alone[i])) }
    rows.push({ plan: planName, countPeakDb: db(stats(alone).peak), levelErrorDb: Math.abs(db(stats(inBoth).rms / stats(alone).rms)), maxDiff })
  }
  return rows
}

// ---------- D: medidor do PRINCIPAL (saídas 1 e 2) ----------
async function meter() {
  const plan = PLANS.split2L()
  const { ctx, g } = graphContext(plan)
  channel(ctx, g.input('click'), { mono: true, pan: effectivePan(0, 'click', plan) })
  channel(ctx, g.input('normal'), { mono: false, pan: effectivePan(0, 'normal', plan), gain: 0.5 })
  const at = 0.6
  let got = null
  ctx.suspend(at).then(() => { got = g.levels(); return ctx.resume() })
  const out = channelsOf(await ctx.startRendering())
  const end = Math.round(at * SR)
  const want = { l: stats(out[0], end - 1024, end).peak, r: stats(out[1], end - 1024, end).peak }
  return { got, want, error: Math.max(Math.abs(got.l - want.l), Math.abs(got.r - want.r)) }
}

async function main() {
  return { userAgent: navigator.userAgent, sampleRate: SR, quantum: QUANTUM, leaks: await leaks(), levels: await levels(), switches: await switches(), countLevel: await countLevel(), meter: await meter() }
}

const name = new URLSearchParams(location.search).get('name') || 'output-graph'
main()
  .catch((e) => ({ fatal: String(e && e.stack ? e.stack : e) }))
  .then(async (result) => {
    await fetch(`/result?name=${encodeURIComponent(name)}`, { method: 'POST', body: JSON.stringify(result, (_, v) => (v === -Infinity ? '-inf' : v === Infinity ? 'inf' : v)) })
    document.getElementById('out').textContent = 'pronto'
  })

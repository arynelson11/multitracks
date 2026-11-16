// Página do count-cancel.mjs: roda o scheduleCount REAL (src/audio/countTones.ts, ou o de um
// commit com --rev) num OfflineAudioContext do Chrome e cancela a contagem em cada quantum de
// 128 amostras ao longo do bipe. Pra ler o envelope amostra a amostra, os osciladores viram
// fonte constante 1 e o passa-baixa vira ganho 1: a saída é (1 + squareMix) x envelope.
// O cancel roda dentro do suspend(t), com now = ctx.currentTime, como no agendador.
import { COUNT_TONE, scheduleCount } from '@t7/countTones'

const AT = 0.5
const QUANTUM = 128
const BEEP_LEN = 0.22 // o bipe para em at + 0,22 (receita do v6)
const WINDOW = 0.03 // depois do cancel: cobre a descida e a parada dos osciladores
const MIX = 1 + COUNT_TONE.squareMix

function patch(ctx) {
  const realGain = ctx.createGain.bind(ctx)
  ctx.createOscillator = () => {
    const c = ctx.createConstantSource()
    c.offset.value = 1
    return Object.assign(c, { type: 'constant', frequency: { value: 0 } })
  }
  ctx.createBiquadFilter = () => Object.assign(realGain(), { type: 'constant', frequency: { value: 0 }, Q: { value: 0 } })
}

async function render({ sr, label, cancelAt }) {
  const ctx = new OfflineAudioContext(1, Math.round((AT + BEEP_LEN + 0.15) * sr), sr)
  patch(ctx)
  const count = scheduleCount(ctx, ctx.destination, [{ at: AT, label }])
  let now = null
  if (cancelAt !== null) {
    ctx.suspend(cancelAt).then(() => {
      now = ctx.currentTime
      count.cancel(now)
      return ctx.resume()
    })
  }
  const d = (await ctx.startRendering()).getChannelData(0)
  const i0 = now === null ? 1 : Math.max(1, Math.round(now * sr) - 2)
  const i1 = now === null ? d.length : Math.min(d.length, Math.round(now * sr) + Math.round(WINDOW * sr))
  let worst = 0
  let worstAt = 0
  for (let i = i0; i < i1; i++) {
    const step = Math.abs(d[i] - d[i - 1]) / MIX
    if (step > worst) { worst = step; worstAt = i / sr }
  }
  let tail = 0
  for (let i = i1; i < d.length; i++) tail = Math.max(tail, Math.abs(d[i]) / MIX)
  const before = now === null ? null : d[Math.round(now * sr) - 1] / MIX
  return { now, worst, worstAt, before, tail: now === null ? null : tail }
}

// Sem cancelAndHoldAtTime (Firefox): tira o método do protótipo durante a varredura.
async function withoutCancelAndHold(fn) {
  const desc = Object.getOwnPropertyDescriptor(AudioParam.prototype, 'cancelAndHoldAtTime')
  Object.defineProperty(AudioParam.prototype, 'cancelAndHoldAtTime', { value: undefined, configurable: true, writable: true })
  try { return await fn() } finally { Object.defineProperty(AudioParam.prototype, 'cancelAndHoldAtTime', desc) }
}

async function sweep(sr, label) {
  const baseline = await render({ sr, label, cancelAt: null })
  const instants = []
  for (let k = Math.ceil((AT * sr) / QUANTUM) + 1; (k * QUANTUM) / sr < AT + BEEP_LEN; k++) {
    instants.push(await render({ sr, label, cancelAt: (k * QUANTUM) / sr }))
  }
  return { baseline, instants }
}

async function main() {
  const configs = []
  for (const sr of [48000, 44100]) {
    for (const label of [1, 2]) {
      configs.push({ sr, label, variant: 'nativo', ...(await sweep(sr, label)) })
      configs.push({ sr, label, variant: 'sem cancelAndHoldAtTime', ...(await withoutCancelAndHold(() => sweep(sr, label))) })
    }
  }
  return { userAgent: navigator.userAgent, at: AT, configs }
}

const name = new URLSearchParams(location.search).get('name') || 'count-cancel'
main()
  .catch((e) => ({ fatal: String(e && e.stack ? e.stack : e) }))
  .then(async (result) => {
    await fetch(`/result?name=${encodeURIComponent(name)}`, { method: 'POST', body: JSON.stringify(result) })
    document.getElementById('out').textContent = 'pronto'
  })

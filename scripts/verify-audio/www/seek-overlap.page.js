// Página do seek-overlap.mjs: o hook REAL useAudioEngine (palco antigo, o padrão) no Chrome, com o
// AudioContext trocado por um OfflineAudioContext do mesmo Chrome: cada ação (play, busca,
// "próxima") roda dentro de um suspend(t), com o relógio parado em t, e a saída é a renderização
// amostra a amostra (como as medidas da T7, T17, T26 e T28, Ruling ÁUDIO). O relógio de tempo real
// do Chrome headless ficou parado nesta máquina (medido: currentTime em 0,005 s por 60 s), então
// a medida não depende dele. O baseLatency que o motor lê (a folga do corte sai dele) é o do Chrome
// de tempo real desta máquina (0,0053 s) ou o de ?baseLatency=0.012 (aparelho de buffer grande).
// "Tudo junto" sem o pan automático e os knobs separando: a posição VELHA sai só na saída 1 (L) e a
// NOVA só na 2 (R). Música A: "Baixo" (knob -1) com nível constante 0,5 só de 10 a 20 s e
// "Teclado" (knob +1) com 0,5 só de 0 a 10 s; música B: só o "Teclado" (knob +1), 0,5 sempre.
// Mede (1) a busca tocando de 18 s pra 2 s: por quanto tempo a voz velha fica em ganho 1 por cima da
// nova e o degrau da soltura; (2) a mesma busca com o FADE, saindo do trecho em 0,4: se o rabo da
// posição velha sobe; (3) a "próxima" tocando: se a música velha volta a soar mais alta depois do
// fade de 1,5 s.
import { createElement, useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import { SettingsProvider } from '@src/contexts/SettingsContext'
import { useAudioEngine } from '@src/hooks/useAudioEngine'

const params = new URLSearchParams(location.search)
const BASE = params.has('baseLatency') ? Number(params.get('baseLatency')) : 0.0053
// ?semHold: o navegador sem cancelAndHoldAtTime (o caminho do Firefox).
if (params.has('semHold')) delete AudioParam.prototype.cancelAndHoldAtTime
const SR = 48000
const RENDER_S = 10
const DUR = 20
const DC = 0.5

// O motor cria o contexto com `new AudioContext()`: aqui ele nasce offline, com a latência pedida.
// Renderizando, ele se apresenta como 'running' e o resume() do motor (o do iOS) não solta o relógio:
// só a página solta, no fim de cada passo.
class OfflineAsRealtime extends OfflineAudioContext {
  constructor() { super(2, RENDER_S * SR, SR); this.rendering = false }
  get baseLatency() { return BASE }
  get outputLatency() { return 0 }
  get state() { return this.rendering ? 'running' : super.state }
  resume() { return this.rendering ? Promise.resolve() : super.resume() }
  startRendering() { this.rendering = true; return super.startRendering() }
}
const realResume = (ctx) => OfflineAudioContext.prototype.resume.call(ctx)
window.AudioContext = OfflineAsRealtime

// Saídas antes do motor montar: "Tudo junto", sem pan automático, já migrado; a conta já passou pela volta dos pans.
localStorage.setItem('mt_app_settings', JSON.stringify({ outputs: { mode: 'stereo', earOnSecond: false, multi: { vsPair: 0, click: 2, guide: 3 } }, autoPan: false, audioDeviceId: 'default', stageVersion: 'antigo' }))
localStorage.setItem('mt_outputs_migrated', '1')
localStorage.setItem('mt_legacy_pans_reset:verify', '1')

// O timer de 1,5 s da "próxima" fica com a página: ele dispara no relógio do áudio, num suspend.
const realSetTimeout = window.setTimeout.bind(window)
const nextTimers = []
window.setTimeout = (fn, ms, ...rest) => {
  if (ms === 1500) { nextTimers.push(fn); return 0 }
  return realSetTimeout(fn, ms, ...rest)
}

const sleep = (ms) => new Promise((r) => realSetTimeout(r, ms))
const E = () => window.__engine

function Harness() {
  const engine = useAudioEngine('verify')
  window.__engine = engine
  useEffect(() => { window.__engine = engine })
  return null
}

function wav(name, valueAt) {
  const n = SR * DUR
  const buf = new ArrayBuffer(44 + n * 2)
  const v = new DataView(buf)
  const str = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)) }
  str(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); str(8, 'WAVE')
  str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true)
  v.setUint32(24, SR, true); v.setUint32(28, SR * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true)
  str(36, 'data'); v.setUint32(40, n * 2, true)
  for (let i = 0; i < n; i++) v.setInt16(44 + i * 2, Math.round(valueAt(i / SR) * 32767), true)
  return new File([buf], name + '.wav', { type: 'audio/wav' })
}

async function waitFor(fn, ms = 20000, label = '') {
  const t0 = performance.now()
  while (!fn()) {
    if (performance.now() - t0 > ms) throw new Error('timeout esperando ' + label)
    await sleep(20)
  }
}

async function main() {
  createRoot(document.getElementById('root')).render(createElement(SettingsProvider, null, createElement(Harness)))
  await waitFor(() => E(), 10000, 'engine')
  await E().initEngine()
  await waitFor(() => E().isReady, 10000, 'engine pronta')
  const load = async (files, name) => {
    const dt = new DataTransfer()
    files.forEach((f) => dt.items.add(f))
    const before = E().playlist.length
    await E().loadFiles(dt.files, name, undefined, [], 'C', 120)
    await waitFor(() => E().playlist.length === before + 1, 60000, 'carga ' + name)
  }
  await load([wav('Baixo', (t) => (t >= 10 ? DC : 0)), wav('Teclado', (t) => (t < 10 ? DC : 0))], 'A')
  await load([wav('Teclado', () => DC)], 'B')
  // Knobs: na B o Teclado na saída 2; na A o Baixo (posição velha) na 1 e o Teclado (nova) na 2.
  const id = (name) => E().channels.find((c) => c.name === name).id
  E().jumpToSong(1)
  await waitFor(() => E().activeSongIndex === 1 && E().channels.length === 1, 10000, 'música B ativa')
  E().updatePan(id('Teclado'), 1)
  await sleep(50)
  E().jumpToSong(0)
  await waitFor(() => E().activeSongIndex === 0 && E().channels.length === 2, 10000, 'música A ativa')
  // Um knob por renderização (o updatePan parte do repertório da renderização em que foi chamado).
  E().updatePan(id('Baixo'), -1)
  await sleep(50)
  E().updatePan(id('Teclado'), 1)
  await sleep(50)
  const pans = E().channels.map((c) => c.pan)
  if (pans[0] !== -1 || pans[1] !== 1) throw new Error('knobs não ficaram: ' + pans)
  const ctx = E().channels[0].gainNode.context

  // Roteiro no relógio do áudio. Cada passo roda num suspend (relógio parado) e espera o React.
  const settle = async () => { for (let k = 0; k < 5; k++) await sleep(10) }
  const seekAts = [1.0, 2.0, 3.0]
  const steps = [
    [0.5, async () => { E().seekTo(18); await E().play() }],
    [1.0, async () => { E().seekTo(2) }],
    [1.5, async () => { E().seekTo(18) }],
    [2.0, async () => { E().seekTo(2) }],
    [2.5, async () => { E().seekTo(18) }],
    [3.0, async () => { E().seekTo(2) }],
    [3.5, async () => { E().pause() }],
    [4.0, async () => { E().setPlaybackMode('fade-out'); await settle(); E().seekTo(17); await E().play() }],
    [5.0, async () => { E().seekTo(2) }],
    [5.5, async () => { E().pause(); E().setPlaybackMode('continue') }],
    [6.0, async () => { E().seekTo(12); await E().play() }],
    [6.5, async () => { E().nextSong() }],
    [8.0, async () => { const fire = nextTimers.shift(); if (!fire) throw new Error('timer da próxima não marcado'); fire() }],
    [9.0, async () => { E().pause() }],
  ]
  const happened = []
  for (const [t, fn] of steps) {
    ctx.suspend(t).then(async () => {
      try {
        await fn()
        await settle()
        happened.push({ t, ctx: ctx.currentTime, active: E().activeSongIndex, playing: E().isPlaying })
      } catch (e) {
        happened.push({ t, error: String(e) })
      }
      realResume(ctx)
    })
  }
  const rendered = await ctx.startRendering()
  const L = rendered.getChannelData(0)
  const R = rendered.getChannelData(1)

  const idx = (t) => Math.max(0, Math.min(L.length - 1, Math.round(t * SR)))
  const tOf = (i) => i / SR
  const firstAbove = (X, from, lim, to) => { for (let i = idx(from); i <= idx(to); i++) if (Math.abs(X[i]) > lim) return tOf(i); return null }
  const lastAbove = (X, from, lim, to) => { let last = null; for (let i = idx(from); i <= idx(to); i++) if (Math.abs(X[i]) > lim) last = tOf(i); return last }
  const maxAbs = (X, a, b) => { let m = 0; for (let i = idx(a); i <= idx(b); i++) m = Math.max(m, Math.abs(X[i])); return m }
  const maxStep = (X, a, b) => { let m = 0; for (let i = idx(a) + 1; i <= idx(b); i++) m = Math.max(m, Math.abs(X[i] - X[i - 1])); return m }
  const measureSeek = (at) => {
    const before = Math.abs(L[idx(at) - 1])
    const onset = firstAbove(R, at, 0.05 * before, at + 0.1)
    // Voz velha em ganho 1 (L no nível de antes, menos 1%) e acima da metade, depois do começo da nova.
    const full = lastAbove(L, at, 0.99 * before, at + 0.1)
    const half = lastAbove(L, at, 0.5 * before, at + 0.1)
    return {
      at, before, onset, reactionMs: onset !== null ? (onset - at) * 1000 : null,
      overlapFullMs: onset !== null && full !== null ? Math.max(0, full - onset) * 1000 : null,
      overlapHalfMs: onset !== null && half !== null ? Math.max(0, half - onset) * 1000 : null,
      oldMax: maxAbs(L, at, at + 0.1), oldStep: maxStep(L, at, at + 0.1),
      newAfter: Math.abs(R[idx(at + 0.1)]),
      // A posição nova depois do 1º instante dela (o começo sem rampa é de propósito, T26): a volta
      // do principal pro volume não pode ter degrau.
      newStep: onset !== null ? maxStep(R, onset + 2 / SR, at + 0.1) : null,
    }
  }
  // Próxima: o nível da música velha (L) no instante da troca (o fim do fade) e o máximo depois.
  const swap = 8.0
  const out = {
    userAgent: navigator.userAgent, sampleRate: ctx.sampleRate, baseLatency: BASE, offline: true, semHold: typeof AudioParam.prototype.cancelAndHoldAtTime !== 'function',
    outputs: E().outputPlan?.mode, steps: happened,
    seeks: seekAts.map(measureSeek),
    fade: measureSeek(5.0),
    next: {
      at: swap, endOfFade: Math.abs(L[idx(swap) - 1]), beforeNext: Math.abs(L[idx(6.5) - 1]),
      oldMaxAfter: maxAbs(L, swap, swap + 0.1), oldStep: maxStep(L, swap - 0.01, swap + 0.1),
      newOnset: firstAbove(R, swap, 1e-4, swap + 0.2), newSettled: Math.abs(R[idx(swap + 0.3)]),
      newStep: maxStep(R, (firstAbove(R, swap, 1e-4, swap + 0.2) ?? swap) + 2 / SR, swap + 0.3),
    },
  }
  await fetch('/result?name=' + encodeURIComponent(params.get('name') || 'seek-overlap'), { method: 'POST', body: JSON.stringify(out) })
}

main().catch((e) => fetch('/result?name=' + encodeURIComponent(params.get('name') || 'seek-overlap'), { method: 'POST', body: JSON.stringify({ fatal: String((e && e.stack) || e) }) }))

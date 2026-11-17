// Página do section-jump.mjs: o hook REAL useAudioEngine montado com stageMode 'novo' (T28), em
// tempo real num AudioContext do Chrome. "Click e Guia separados", Click mudo e o Baixo em nível
// constante 0,5 na VS (saída R): qualquer degrau na VS é das automações (envelopes das vozes e
// principal). Mede o cruzamento do pulo no 1, a pausa no meio da contagem, o FADE agendado, o
// principal segurado com pulo armado e a volta no 1, o volume mexido e arrastado com o FADE
// marcado, a saída do FADE seguida de volume em menos de 50 ms e a volta pro FADE tocando.
// Com ?semHold o navegador fica sem cancelAndHoldAtTime (o caminho do Firefox).
import { createElement, useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import { SettingsProvider } from '@src/contexts/SettingsContext'
import { useAudioEngine } from '@src/hooks/useAudioEngine'

const SEM_HOLD = new URLSearchParams(location.search).has('semHold')
if (SEM_HOLD) delete AudioParam.prototype.cancelAndHoldAtTime

// Ligações, pra achar o nó que entrega no destino (o mudo geral, depois do principal).
const edges = new Map()
const origConnect = AudioNode.prototype.connect
AudioNode.prototype.connect = function (dest, ...rest) {
  let s = edges.get(this)
  if (!s) edges.set(this, (s = new Set()))
  s.add(dest)
  return origConnect.call(this, dest, ...rest)
}

const SR = 48000
const DUR = 20
const DC = 0.5
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const E = () => window.__engine

function Harness() {
  const engine = useAudioEngine('verify', { stageMode: 'novo' })
  window.__engine = engine
  useEffect(() => { window.__engine = engine })
  return null
}

function dcWav(name, value) {
  const n = SR * DUR
  const buf = new ArrayBuffer(44 + n * 2)
  const v = new DataView(buf)
  const str = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)) }
  str(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); str(8, 'WAVE')
  str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true)
  v.setUint32(24, SR, true); v.setUint32(28, SR * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true)
  str(36, 'data'); v.setUint32(40, n * 2, true)
  const q = Math.round(value * 32767)
  for (let i = 0; i < n; i++) v.setInt16(44 + i * 2, q, true)
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
  const markers = [{ id: 'a', time: 0, label: 'Intro' }, { id: 'b', time: 4, label: 'Verso' }, { id: 'c', time: 8, label: 'Refrão' }, { id: 'd', time: 12, label: 'Final' }]
  const dt = new DataTransfer()
  ;[dcWav('Click', 0), dcWav('Baixo', DC)].forEach((f) => dt.items.add(f))
  await E().loadFiles(dt.files, 'Teste', undefined, markers, 'C', 120)
  await waitFor(() => E().channels.length === 2, 60000, 'carga')
  const ctx = E().channels[0].gainNode.context
  let outNode = null
  for (const [node, set] of edges) if (set.has(ctx.destination)) outNode = node
  if (!outNode) throw new Error('saída do principal não encontrada')
  await ctx.audioWorklet.addModule('/section-jump.rec.js')
  const rec = new AudioWorkletNode(ctx, 'rec', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2], channelCount: 2, channelCountMode: 'explicit' })
  const sink = ctx.createGain(); sink.gain.value = 0
  outNode.connect(rec); rec.connect(sink); sink.connect(ctx.destination)
  const dump = new Promise((resolve) => { rec.port.onmessage = (e) => resolve(e.data) })
  const ev = {}
  const mark = (k) => { ev[k] = ctx.currentTime }
  // Um evento por quadro de tela (16 ms), como o range do PRINCIPAL arrastado.
  const drag = async (key, values) => {
    mark(key + 'From')
    for (const v of values) { E().updateMasterVolume(v); await sleep(16) }
    mark(key + 'To')
  }

  E().setPlaybackMode('fade-out')
  await sleep(300)
  rec.port.postMessage('start')
  await sleep(100)
  const tb = performance.now()
  const at = async (s, fn) => { const wait = s * 1000 - (performance.now() - tb); if (wait > 0) await sleep(wait); await fn() }

  await at(0, async () => { mark('play0'); await E().play() })
  // Na Intro, arma o Verso: pulo no fim da Intro (4 s), sem salto de posição.
  await at(1.0, () => { mark('arm1'); E().armSection(1) })
  await at(3.6, () => { ev.T1 = E().transitionView?.switchAt ?? null; ev.T1committed = !!E().transitionView?.committed })
  // No Verso, arma a Intro e pausa no meio da contagem.
  await at(5.0, () => { mark('arm2'); E().armSection(0) })
  await at(6.3, () => { mark('pause1'); E().pause() })
  // A pausa guarda o pedido armado: desarma antes de tocar do meio do FADE.
  await at(6.8, () => { ev.intentAfterPause = E().sectionIntent; E().cancelArm() })
  await at(7.0, async () => { E().seekTo(16); await sleep(50); mark('play1'); await E().play() })
  // No meio do FADE, arma o Verso: segura e volta no 1 (fim da Final, 20 s).
  await at(7.5, () => { mark('armHold'); E().armSection(1) })
  await at(10.5, () => { ev.T3 = E().transitionView?.switchAt ?? null; ev.T3committed = !!E().transitionView?.committed })
  await at(11.5, () => { ev.landed3 = E().landed; mark('seek2'); E().seekTo(16) })
  // Volume mexido uma vez e depois arrastado, com o FADE no meio.
  await at(12.0, () => { mark('vol'); E().updateMasterVolume(0.5) })
  await at(12.3, () => drag('dragFade', [0.58, 0.66, 0.74, 0.82, 0.9]))
  // Sai do FADE e mexe no volume 20 ms depois (no meio da volta de 50 ms).
  await at(12.8, async () => { mark('drop'); E().setPlaybackMode('continue'); await sleep(20); mark('dropVol'); E().updateMasterVolume(0.6) })
  // Volta pro FADE tocando (já nos últimos 5 s): a rampa parte do nível de agora.
  await at(13.4, () => { mark('refade'); E().setPlaybackMode('fade-out') })
  // Busca pra 2 s (o FADE fica longe) e arrasta o volume.
  await at(13.6, () => { mark('seek3'); E().seekTo(2) })
  await at(14.0, () => drag('dragFar', [0.68, 0.76, 0.84, 0.92, 1]))
  await at(14.6, () => { mark('pause2'); E().pause() })
  await at(15.0, () => rec.port.postMessage('dump'))
  const { t0, R } = await dump

  const idx = (t) => Math.max(0, Math.min(R.length - 1, Math.round((t - t0) * SR)))
  const maxStep = (a, b) => { let m = 0, where = a; for (let i = idx(a) + 1; i <= idx(b); i++) { const d = Math.abs(R[i] - R[i - 1]); if (d > m) { m = d; where = t0 + i / SR } } return { step: m, at: where } }
  const range = (a, b) => { let lo = Infinity, hi = -Infinity; for (let i = idx(a); i <= idx(b); i++) { lo = Math.min(lo, R[i]); hi = Math.max(hi, R[i]) } return { lo, hi } }
  const val = (t) => R[idx(t)]
  // Início do som de um play: a primeira amostra acima de 0,1 depois de `t`.
  const onset = (t) => { for (let i = idx(t); i < R.length; i++) if (R[i] > 0.1) return t0 + i / SR; return null }
  const out = { semHold: typeof AudioParam.prototype.cancelAndHoldAtTime !== 'function', ev, t0, n: R.length, outputs: E().outputPlan?.mode, userAgent: navigator.userAgent, DC }
  out.cross = { ...maxStep(ev.T1 - 0.03, ev.T1 + 0.03), ...range(ev.T1 - 0.03, ev.T1 + 0.03) }
  out.pause1 = { ...maxStep(ev.pause1 - 0.01, ev.pause1 + 0.12), after: Math.abs(val(ev.pause1 + 0.1)) }
  const play1On = onset(ev.play1)
  out.play1 = { onset: play1On, control: play1On ? maxStep(play1On - 0.002, play1On + 0.002).step : null }
  // FADE no meio desde o play em 16 s: DC x 0,8 na entrada da música, até 0 em 4 s.
  const end1 = play1On + 4
  let dev = 0
  for (let t = play1On + 0.005; t < ev.armHold - 0.02; t += 0.01) dev = Math.max(dev, Math.abs(val(t) - DC * 0.8 * (end1 - t) / 4))
  out.fade1 = { dev, ...maxStep(play1On + 0.005, ev.armHold - 0.02) }
  out.hold = { ...maxStep(ev.armHold - 0.02, ev.armHold + 0.2), ...range(ev.armHold + 0.06, ev.T3 - 0.03), expected: DC * 0.8 * (end1 - ev.armHold) / 4 }
  out.restore = { ...maxStep(ev.T3 - 0.03, ev.T3 + 0.03), after: val(ev.T3 + 0.02) }
  const seek2On = onset(ev.seek2)
  const end2 = seek2On + 4
  const curve = (volume, t) => DC * volume * 0.8 * (end2 - t) / 4
  out.vol = { ...maxStep(ev.vol - 0.02, ev.vol + 0.2), before: val(ev.vol - 0.01), wantBefore: curve(1, ev.vol - 0.01), after: val(ev.vol + 0.1), wantAfter: curve(0.5, ev.vol + 0.1) }
  out.dragFade = { ...maxStep(ev.dragFadeFrom - 0.01, ev.dragFadeTo + 0.1), after: val(ev.dragFadeTo + 0.1), want: curve(0.9, ev.dragFadeTo + 0.1) }
  out.drop = { ...maxStep(ev.drop - 0.01, ev.dropVol + 0.15), after: val(ev.dropVol + 0.15), want: DC * 0.6 }
  out.refade = { ...maxStep(ev.refade - 0.01, ev.refade + 0.15), before: val(ev.refade - 0.005), after: val(ev.refade + 0.15) }
  out.dragFar = { ...maxStep(ev.dragFarFrom - 0.01, ev.dragFarTo + 0.1), after: val(ev.dragFarTo + 0.1), want: DC * 1 }
  out.pause2 = { ...maxStep(ev.pause2 - 0.01, ev.pause2 + 0.12), after: Math.abs(val(ev.pause2 + 0.1)) }
  await fetch('/result?name=' + encodeURIComponent(new URLSearchParams(location.search).get('name') || 'section-jump'), { method: 'POST', body: JSON.stringify(out) })
}

main().catch((e) => fetch('/result?name=' + encodeURIComponent(new URLSearchParams(location.search).get('name') || 'section-jump'), { method: 'POST', body: JSON.stringify({ fatal: String((e && e.stack) || e) }) }))

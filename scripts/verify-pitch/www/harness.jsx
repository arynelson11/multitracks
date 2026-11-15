// Roda o hook REAL useAudioEngine numa página, sem a UI do app, e mede o áudio.
// Cenários (query string): seq=S1 | S2 | SPREAD | NAN, n = nº de instrumentos,
// order = A (click/guia primeiro) ou B (por último, como o Separador grava),
// click = nome do canal de click.
import { now, events, ev, edges, inbound, worklets, sources, OrigAWN } from './instrument.js';
import { useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { SettingsProvider } from '../../../src/contexts/SettingsContext';
import { useAudioEngine } from '../../../src/hooks/useAudioEngine';

const q = new URLSearchParams(location.search);
const SEQ = q.get('seq') || 'S1';
const N = +(q.get('n') || 8);
const ORDER = q.get('order') || 'A';
const CLICK = q.get('click') || 'Click';
const OUT = q.get('name') || 'out';
const DUR = +(q.get('dur') || 45);
const SR = 48000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const E = () => window.__engine;

function Harness() {
  const engine = useAudioEngine('verify');
  window.__engine = engine;
  useEffect(() => { window.__engine = engine; });
  return null;
}

// ---- sinais ----
function clickTrain(dur, period, first) {
  const n = Math.round(SR * dur);
  const x = new Float32Array(n);
  for (let t = first; t < dur - 0.6; t += period) {
    const s0 = Math.round(t * SR);
    const len = Math.round(0.025 * SR);
    for (let k = 0; k < len && s0 + k < n; k++) {
      const tt = k / SR;
      x[s0 + k] += 0.6 * Math.exp(-tt / 0.003) * (Math.sin(2 * Math.PI * 2000 * tt) + 0.5 * Math.sin(2 * Math.PI * 4000 * tt));
    }
  }
  return x;
}
function harmonic(dur, f0, nh, amp) {
  const n = Math.round(SR * dur);
  const x = new Float32Array(n);
  for (let h = 1; h <= nh; h++) {
    const a = amp / h;
    const w = 2 * Math.PI * f0 * h / SR;
    for (let i = 0; i < n; i++) x[i] += a * Math.sin(w * i);
  }
  return x;
}
function wavFile(name, x) {
  const buf = new ArrayBuffer(44 + x.length * 2);
  const v = new DataView(buf);
  const str = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); v.setUint32(4, 36 + x.length * 2, true); str(8, 'WAVE');
  str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, SR, true); v.setUint32(28, SR * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  str(36, 'data'); v.setUint32(40, x.length * 2, true);
  for (let i = 0; i < x.length; i++) v.setInt16(44 + i * 2, Math.max(-1, Math.min(1, x[i])) * 32767, true);
  return new File([buf], name + '.wav', { type: 'audio/wav' });
}

const INSTRUMENTS = ['Bateria', 'Baixo', 'Vocal', 'Teclado', 'Guitarra', 'Violao', 'Pad', 'Backing', 'Synth', 'Strings',
  'Perc', 'Loop', 'Sax', 'Trompete', 'Orgao', 'Piano', 'Coro', 'Bells', 'FX', 'Contra', 'Tamborim', 'Shaker'];
const VOICE = new Set(['Vocal', 'Backing', 'Coro']);

async function waitFor(fn, ms = 20000, label = '') {
  const t0 = performance.now();
  while (!fn()) {
    if (performance.now() - t0 > ms) throw new Error('timeout esperando ' + label);
    await sleep(50);
  }
}

async function main() {
  createRoot(document.getElementById('root')).render(<SettingsProvider><Harness /></SettingsProvider>);
  await waitFor(() => E(), 10000, 'engine');
  await E().initEngine();
  await waitFor(() => E().isReady, 10000, 'engine pronta');
  // ---- faixas ----
  const instr = INSTRUMENTS.slice(0, N);
  const measure = (SEQ === 'SPREAD' || SEQ === 'SEEKS') ? 'both' : (ORDER === 'A' ? 'last' : 'first');
  const clk = clickTrain(DUR, 0.5, 0.25);
  const files = [];
  const instrFiles = instr.map((name, i) => {
    const isMeasured = (measure === 'last' && i === N - 1) || (measure === 'first' && i === 0) || (measure === 'both' && (i === 0 || i === N - 1));
    return wavFile(name, isMeasured ? clk : harmonic(DUR, 97 + 11 * i, 4, 0.002));
  });
  const clickFile = wavFile(CLICK, clk);
  const guideFile = wavFile('Voz Guia', new Float32Array(Math.round(SR * DUR)));
  if (ORDER === 'A') files.push(clickFile, guideFile, ...instrFiles); else files.push(...instrFiles, clickFile, guideFile);
  const dt = new DataTransfer();
  files.forEach((f) => dt.items.add(f));
  await E().loadFiles(dt.files, 'Teste', undefined, undefined, 'C', 120);
  await waitFor(() => E().channels.length === files.length, 60000, 'load');
  const chNames = E().channels.map((c) => c.name);
  ev('channels', { names: chNames });

  // Contexto e master do hook, achados pela ligação gain do canal -> master.
  const ctx = E().channels[0].gainNode.context;
  const master = [...(edges.get(E().channels[0].gainNode) || [])].find((x) => x instanceof GainNode);
  if (!master) throw new Error('master do hook não encontrado');
  window.__ctx = ctx;
  ev('ctx', { sampleRate: ctx.sampleRate, state: ctx.state });

  // Medidor na saída do master (L = click, R = instrumento medido).
  await ctx.audioWorklet.addModule('tap-worklet.js');
  const tap = new OrigAWN(ctx, 'tap', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2] });
  const sink = ctx.createGain(); sink.gain.value = 0;
  master.connect(tap); tap.connect(sink); sink.connect(ctx.destination);
  const rms = [], onsets = [];
  tap.port.onmessage = (e) => {
    const d = e.data;
    if (d[0] === 'rms') rms.push([+d[1].toFixed(3), d[2], d[3], d[4]]);
    else if (d[0] === 'on') onsets.push([d[1], d[2]]);
  };

  // Pan na carga (autoPan): o click deve ir pro L como qualquer click.
  const pansAtLoad = Object.fromEntries(E().channels.map((c) => [c.name, c.pannerNode.pan.value]));
  // Lados fixos pra medir, independente da regra de nomes: click/guia no L,
  // instrumentos no R. SPREAD: 1º instrumento no L e click mudo, então
  // R − L = diferença de início entre a 1ª e a última faixa.
  for (const c of E().channels) c.pannerNode.pan.value = (c.name === CLICK || c.name === 'Voz Guia') ? -1 : 1;
  if (SEQ === 'SPREAD' || SEQ === 'SEEKS') {
    const chs = E().channels;
    chs.find((c) => c.name === instr[0]).pannerNode.pan.value = -1;
    E().toggleMute(chs.find((c) => c.name === CLICK).id);
  }
  await sleep(500);

  // Medidor por canal (depois do gain): nível de cada faixa nos snapshots.
  const meters = new Map(E().channels.map((c) => {
    const a = ctx.createAnalyser(); a.fftSize = 4096; c.gainNode.connect(a); return [c.name, a];
  }));
  const meterDb = () => Object.fromEntries([...meters].map(([n, a]) => {
    const d = new Float32Array(a.fftSize); a.getFloatTimeDomainData(d);
    let acc = 0; for (const v of d) acc += v * v;
    return [n, +(10 * Math.log10(acc / d.length + 1e-18)).toFixed(1)];
  }));
  // ---- snapshot ----
  const snaps = [];
  const dbg = (node) => Promise.race([node.debug ? node.debug() : Promise.resolve(null), sleep(1500).then(() => null)]);
  const snapshot = async (label) => {
    const t = now(), c = ctx.currentTime;
    const chs = E().channels;
    const pannerName = new Map(chs.map((ch) => [ch.pannerNode, ch.name]));
    const d1 = await Promise.all(worklets.map((w) => dbg(w.node)));
    await sleep(400);
    const d2 = await Promise.all(worklets.map((w) => dbg(w.node)));
    const wl = worklets.map((w, i) => {
      const a = d1[i], b = d2[i];
      const targets = [...(edges.get(w.node) || [])].map((x) => pannerName.get(x) || x.constructor.name);
      if (!a || !b) return { id: w.id, targets, noDebug: true };
      return {
        id: w.id, targets,
        live: b.liveBlocks - a.liveBlocks, buf: b.bufBlocks - a.bufBlocks, idle: b.idleBlocks - a.idleBlocks,
        nan: b.nanBlocks - a.nanBlocks, active: b.seg.active, semitones: b.seg.semitones,
        formant: b.seg.formantCompensation, bufTotal: b.bufBlocks, liveTotal: b.liveBlocks,
      };
    });
    const referenced = new Set(chs.map((ch) => ch.sourceNode).filter(Boolean));
    const bufName = new Map(chs.map((ch) => [ch.buffer, ch.name]));
    const alive = sources.filter((r) => r.started && !r.stopped && !r.ended);
    const route = (s) => [...(edges.get(s) || [])].map((x) => (x instanceof OrigAWN ? 'worklet' : x instanceof DelayNode ? 'delay' : x instanceof StereoPannerNode ? 'panner' : x.constructor.name));
    const aliveInfo = alive.map((r) => ({ ch: bufName.get(r.s.buffer) || '?', route: route(r.s).join('+'), referenced: referenced.has(r.s) }));
    const snap = {
      label, t, ctxTime: +c.toFixed(3), pitch: E().playlist[E().activeSongIndex]?.pitch ?? null,
      isPlaying: E().isPlaying, position: +E().currentTime.toFixed(3),
      worklets: wl, sourcesAlive: aliveInfo, levels: meterDb(),
      masterInputs: [...(inbound.get(master) || [])].map((n) => pannerName.get(n) || chs.find((c) => c.gainNode === n)?.name || n.constructor.name),
    };
    snaps.push(snap);
    ev('snapshot', { label, worklets: wl.length, alive: aliveInfo.length });
    return snap;
  };

  const tBase = performance.now();
  const at = (s, fn) => new Promise((res) => setTimeout(async () => { try { await fn(); } catch (e) { ev('step_error', { msg: String(e && e.stack || e) }); } res(); }, Math.max(0, s * 1000 - (performance.now() - tBase))));
  const pitch = (v) => () => { ev('changePitch', { to: v }); E().changePitch(v); };
  const play = () => { ev('play'); return E().play(); };
  const pause = () => { ev('pause'); E().pause(); };
  const snap = (l) => () => snapshot(l);
  const seek = (t) => () => { ev('seekTo', { to: t }); E().seekTo(t); };
  const seeks = (t0, n, pos0) => Array.from({ length: n }, (_, k) => [t0 + k * 0.5, seek(pos0 + k * 0.3)]);

  const steps = {
    S1: [[0, play], [3, pitch(2)], [7, snap('apos +2')], [9, pitch(0)], [13, snap('apos volta 0')],
      [15, pitch(3)], [19, snap('apos +3')], [21, pitch(0)], [25, snap('apos volta 0 (2)')],
      [27, pitch(5)], [31, snap('apos +5 (5a troca)')], [33, pause], [34, snap('fim (pausado)')]],
    S2: [[0, play], [3, pitch(2)], [3.08, pitch(0)], [6, snap('apos +2 e 0 rapido')],
      [8, pitch(3)], [8.08, pitch(0)], [8.16, pitch(3)], [12, snap('apos +3/0/+3 rapido')],
      [14, pitch(0)], [17, snap('apos volta 0')], [18, pause], [19, snap('fim (pausado)')]],
    SPREAD: [[0, play], [3, snap('tom 0')], [4, pitch(2)], [9, snap('apos +2')], [10, pause], [11, snap('fim (pausado)')]],
    // Muitos reinícios (seek) no tom 0 e no +2: conta quantos separam as faixas.
    SEEKS: [[0, play], ...seeks(1, 25, 3), [14, pitch(2)], ...seeks(16, 25, 12), [29, snap('apos seeks no +2')], [30, pause], [31, snap('fim (pausado)')]],
    NAN: [[0, play], [3, pitch(NaN)], [7, snap('apos tom NaN')], [8, pitch(2)], [12, snap('apos +2')], [13, pause], [14, snap('fim (pausado)')]],
  }[SEQ];
  for (const [s, fn] of steps) await at(s, fn);

  // ---- saída ----
  const L_on = onsets.filter((o) => o[0] === 0).map((o) => o[1]);
  const R_on = onsets.filter((o) => o[0] === 1).map((o) => o[1]);
  const pairs = R_on.map((r) => {
    let best = null;
    for (const l of L_on) if (best === null || Math.abs(r - l) < Math.abs(r - best)) best = l;
    return best === null ? null : [+r.toFixed(4), +((r - best) * 1000).toFixed(2)];
  }).filter(Boolean);
  const bufName = new Map(E().channels.map((ch) => [ch.buffer, ch.name]));
  const srcRecs = sources.filter((r) => r.started).map((r) => ({
    id: r.id, ch: bufName.get(r.s.buffer) || '?', when: r.when, offset: +r.offset.toFixed(4), ctxAtStart: +r.ctxAtStart.toFixed(5),
    eff: +r.eff.toFixed(5), tStart: r.tStart, ctxAtStop: r.ctxAtStop !== undefined ? +r.ctxAtStop.toFixed(5) : null,
  }));
  const res = {
    cfg: { SEQ, N, ORDER, CLICK, measure, DUR, sampleRate: ctx.sampleRate, pansAtLoad, voice: [...VOICE].filter((v) => instr.includes(v)), instruments: instr, channels: chNames },
    events, snaps, rRelLms: pairs,
    rms: rms.map((r) => [r[0], +(20 * Math.log10(r[1] + 1e-9)).toFixed(1), +(20 * Math.log10(r[2] + 1e-9)).toFixed(1), r[3]]),
    sources: srcRecs, workletsCreated: worklets.map((w) => w.createdAt),
  };
  await fetch('/result?name=' + encodeURIComponent(OUT), { method: 'POST', body: JSON.stringify(res) });
  document.body.dataset.done = '1';
}

main().catch((e) => fetch('/result?name=' + encodeURIComponent(OUT), { method: 'POST', body: JSON.stringify({ fatal: String(e && e.stack || e), events }) }));

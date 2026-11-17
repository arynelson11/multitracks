// Roda o hook REAL useAudioEngine numa página, sem a UI do app, e mede o áudio.
// Cenários (query string): seq=S1 | S2 | SPREAD | NAN | ... (ver run.mjs), n = nº de instrumentos,
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
// WAV 16 bits; com `x2`, estéreo (L = x, R = x2).
function wavFile(name, x, x2) {
  const nch = x2 ? 2 : 1;
  const bytes = x.length * 2 * nch;
  const buf = new ArrayBuffer(44 + bytes);
  const v = new DataView(buf);
  const str = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); v.setUint32(4, 36 + bytes, true); str(8, 'WAVE');
  str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, nch, true);
  v.setUint32(24, SR, true); v.setUint32(28, SR * 2 * nch, true); v.setUint16(32, 2 * nch, true); v.setUint16(34, 16, true);
  str(36, 'data'); v.setUint32(40, bytes, true);
  const q16 = (a) => Math.max(-1, Math.min(1, a)) * 32767;
  for (let i = 0; i < x.length; i++) {
    v.setInt16(44 + i * 2 * nch, q16(x[i]), true);
    if (x2) v.setInt16(44 + i * 4 + 2, q16(x2[i]), true);
  }
  return new File([buf], name + '.wav', { type: 'audio/wav' });
}

const INSTRUMENTS = ['Bateria', 'Baixo', 'Vocal', 'Teclado', 'Guitarra', 'Violao', 'Pad', 'Backing', 'Synth', 'Strings',
  'Perc', 'Loop', 'Sax', 'Trompete', 'Orgao', 'Piano', 'Coro', 'Bells', 'FX', 'Contra', 'Tamborim', 'Shaker',
  'Viola', 'Cello', 'Flauta', 'Clarinete', 'Harpa', 'Marimba'];
// Repertório com várias músicas (instrumentos por música, sem click e guia).
// SONGS: 24, 10 e 30 canais. PENDENTE: 8, 12 e 16 (cada troca precisa de
// worklet novo, que nasce de forma assíncrona).
const SONG_SIZES = { SONGS: [22, 8, 28], PENDENTE: [6, 10, 14] }[SEQ] || [N];
const MULTI = SONG_SIZES.length > 1;
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
  // LEVELS: faixas de tom contínuo, mono e estéreo, em pan total e no centro.
  // 'Controle C': estéreo com L = R = a mesma senoide das faixas mono, no centro.
  // O caminho dele não muda entre tom 0 e transposto, então a diferença dele é
  // só o erro do phase vocoder naquela frequência.
  const LEVEL_TRACKS = { 'Mono R': [1, 1], 'Mono C': [1, 0], 'Estereo R': [2, 1], 'Estereo C': [2, 0], 'Controle C': [2, 0] };
  const instr = SEQ === 'LEVELS' ? Object.keys(LEVEL_TRACKS) : INSTRUMENTS.slice(0, SONG_SIZES[0]);
  const measure = (SEQ === 'SPREAD' || SEQ === 'SEEKS' || SEQ === 'STALL') ? 'both' : (ORDER === 'A' ? 'last' : 'first');
  const clk = clickTrain(DUR, 0.5, 0.25);
  const songFiles = (names) => {
    const n = names.length;
    const instrFiles = names.map((name, i) => {
      if (SEQ === 'LEVELS') {
        // Senoide pura de 440 Hz: o phase vocoder perde 0 a 0,3 dB conforme a
        // frequência e isso mascararia o efeito do panner (o controle mede).
        const sine = harmonic(DUR, 440, 1, 0.1);
        if (name === 'Controle C') return wavFile(name, sine, sine);
        return LEVEL_TRACKS[name][0] === 2 ? wavFile(name, sine, harmonic(DUR, 660, 1, 0.07)) : wavFile(name, sine);
      }
      const isMeasured = (measure === 'last' && i === n - 1) || (measure === 'first' && i === 0) || (measure === 'both' && (i === 0 || i === n - 1));
      return wavFile(name, isMeasured ? clk : harmonic(DUR, 97 + 11 * i, 4, 0.002));
    });
    const clickFile = wavFile(CLICK, clk);
    // Com várias músicas o critério é som em todas as faixas: a guia também toca.
    const guideFile = wavFile('Voz Guia', MULTI ? harmonic(DUR, 150, 3, 0.002) : new Float32Array(Math.round(SR * DUR)));
    return ORDER === 'A' ? [clickFile, guideFile, ...instrFiles] : [...instrFiles, clickFile, guideFile];
  };
  // LOOP: seção B = [2, 3,0137) s, clicks em 2,25 e 2,75; na emenda o intervalo
  // ideal é 0,5137 s. O tamanho não é múltiplo do quadro de tela (16,7 ms), então
  // o atraso do rAF varia de volta em volta em vez de ficar travado num valor.
  const markers = SEQ === 'LOOP' ? [{ id: 'a', time: 0, label: 'A' }, { id: 'b', time: 2, label: 'B' }, { id: 'c', time: 3.0137, label: 'C' }, { id: 'd', time: 30, label: 'D' }] : undefined;
  const songSizes = [];
  for (let k = 0; k < SONG_SIZES.length; k++) {
    const files = songFiles(k === 0 ? instr : INSTRUMENTS.slice(0, SONG_SIZES[k]));
    const dt = new DataTransfer();
    files.forEach((f) => dt.items.add(f));
    await E().loadFiles(dt.files, MULTI ? 'Musica ' + 'ABCDEF'[k] : 'Teste', undefined, markers, 'C', 120);
    await waitFor(() => E().playlist.length === k + 1 && E().playlist[k].channels.length === files.length, 60000, 'load');
    songSizes.push(files.length);
  }
  await waitFor(() => E().channels.length === songSizes[0], 60000, 'load');
  // Buffer -> música (ordem de carga) e nome do canal, pra todas as músicas.
  const bufSong = new Map();
  const songIds = E().playlist.map((sg) => sg.id);
  E().playlist.forEach((sg, k) => sg.channels.forEach((c) => bufSong.set(c.buffer, { song: k, ch: c.name })));
  const chNames = E().channels.map((c) => c.name);
  ev('channels', { names: chNames });

  // Contexto e principal do hook. Desde a T25 o fader liga no barramento do papel (grafo das
  // saídas), não direto no principal: anda pelas ligações a partir do fader até o nó que
  // entrega no destino (o mudo geral, depois do principal), onde sai a mistura inteira.
  const ctx = E().channels[0].gainNode.context;
  const findMaster = (start) => {
    const seen = new Set([start]);
    const queue = [start];
    while (queue.length) {
      const node = queue.shift();
      const next = [...(edges.get(node) || [])];
      if (next.includes(ctx.destination)) return node;
      for (const n of next) if (!seen.has(n)) { seen.add(n); queue.push(n); }
    }
    return null;
  };
  const master = findMaster(E().channels[0].gainNode);
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
  const pannerCfg = Object.fromEntries(E().channels.map((c) => [c.name, { canais: c.buffer.numberOfChannels, count: c.pannerNode.channelCount, mode: c.pannerNode.channelCountMode }]));
  // Lados fixos pra medir, independente da regra de nomes: click/guia no L,
  // instrumentos no R. SPREAD: 1º instrumento no L e click mudo, então
  // R − L = diferença de início entre a 1ª e a última faixa.
  for (const c of E().playlist.flatMap((sg) => sg.channels)) c.pannerNode.pan.value = (c.name === CLICK || c.name === 'Voz Guia') ? -1 : 1;
  if (SEQ === 'LEVELS') for (const c of E().channels) if (LEVEL_TRACKS[c.name]) c.pannerNode.pan.value = LEVEL_TRACKS[c.name][1];
  if (SEQ === 'SPREAD' || SEQ === 'SEEKS' || SEQ === 'STALL') {
    const chs = E().channels;
    chs.find((c) => c.name === instr[0]).pannerNode.pan.value = -1;
    E().toggleMute(chs.find((c) => c.name === CLICK).id);
  }
  await sleep(500);

  // Medidor por canal (depois do gain, L e R separados), criado na 1ª vez que
  // o canal aparece num snapshot. Nível = potência L + R, média de várias leituras.
  const meters = new WeakMap();
  const meterOf = (c) => {
    let m = meters.get(c.gainNode);
    if (!m) {
      const sp = ctx.createChannelSplitter(2);
      const aL = ctx.createAnalyser(), aR = ctx.createAnalyser();
      aL.fftSize = aR.fftSize = 4096;
      c.gainNode.connect(sp); sp.connect(aL, 0); sp.connect(aR, 1);
      m = { aL, aR, acc: [0, 0], n: 0 };
      meters.set(c.gainNode, m);
    }
    return m;
  };
  const power = (a) => { const d = new Float32Array(a.fftSize); a.getFloatTimeDomainData(d); let acc = 0; for (const v of d) acc += v * v; return acc / d.length; };
  const readLevels = async (chs, reads = 8) => {
    const ms = chs.map((c) => meterOf(c));
    ms.forEach((m) => { m.acc = [0, 0]; m.n = 0; });
    for (let k = 0; k < reads; k++) {
      ms.forEach((m) => { m.acc[0] += power(m.aL); m.acc[1] += power(m.aR); m.n++; });
      await sleep(60);
    }
    const db = (x) => +(10 * Math.log10(x + 1e-18)).toFixed(2);
    return Object.fromEntries(chs.map((c, i) => { const m = ms[i]; const L = m.acc[0] / m.n, R = m.acc[1] / m.n; return [c.name, { L: db(L), R: db(R), total: db(L + R) }]; }));
  };
  // ---- snapshot ----
  const snaps = [];
  const dbg = (node) => Promise.race([node.debug ? node.debug() : Promise.resolve(null), sleep(1500).then(() => null)]);
  const snapshot = async (label) => {
    const t = now(), c = ctx.currentTime;
    const chs = E().channels;
    const pannerName = new Map(chs.map((ch) => [ch.pannerNode, ch.name]));
    chs.forEach((ch) => meterOf(ch));
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
    const levels = await readLevels(chs);
    const referenced = new Set(chs.map((ch) => ch.sourceNode).filter(Boolean));
    const bufName = new Map(chs.map((ch) => [ch.buffer, ch.name]));
    const alive = sources.filter((r) => r.started && !r.stopped && !r.ended);
    // Desde a T26 a fonte liga no envelope da voz (um GainNode) e o envelope na entrada do canal
    // (worklet, atraso ou panner): a rota é a entrada, atravessando o envelope.
    const entryOf = (s) => [...(edges.get(s) || [])].flatMap((x) => (x instanceof GainNode ? [...(edges.get(x) || [])] : [x]));
    const route = (s) => entryOf(s).map((x) => (x instanceof OrigAWN ? 'worklet' : x instanceof DelayNode ? 'delay' : x instanceof StereoPannerNode ? 'panner' : x.constructor.name));
    const aliveInfo = alive.map((r) => ({ ch: bufName.get(r.s.buffer) || '?', route: route(r.s).join('+'), referenced: referenced.has(r.s) }));
    const snap = {
      label, t, ctxTime: +c.toFixed(3), pitch: E().playlist[E().activeSongIndex]?.pitch ?? null,
      isPlaying: E().isPlaying, position: +E().currentTime.toFixed(3),
      worklets: wl, sourcesAlive: aliveInfo, levels,
      expect: { channels: chs.length, transposable: chs.filter((ch) => ch.name !== CLICK && ch.name !== 'Voz Guia').length },
      masterInputs: [...(inbound.get(master) || [])].map((n) => pannerName.get(n) || chs.find((c) => c.gainNode === n)?.name || n.constructor.name),
    };
    snaps.push(snap);
    ev('snapshot', { label, worklets: wl.length, alive: aliveInfo.length });
    return snap;
  };

  const tBase = performance.now();
  const at = (s, fn) => new Promise((res) => setTimeout(async () => { try { await fn(); } catch (e) { ev('step_error', { msg: String(e && e.stack || e) }); } res(); }, Math.max(0, s * 1000 - (performance.now() - tBase))));
  // syncStarts: quantas fontes já estavam agendadas quando a chamada voltou
  // (= todas as faixas se o reinício não passou por nenhum await).
  // Fontes descartadas e reagendadas na mesma chamada (STALL) já saem paradas.
  const syncCount = (before) => sources.slice(before).filter((r) => r.started && !r.stopped).length;
  const pitch = (v) => () => { const b = sources.length; const e = ev('changePitch', { to: v }); E().changePitch(v); e.syncStarts = syncCount(b); e.nChannels = E().channels.length; };
  const play = () => { ev('play'); return E().play(); };
  const pause = () => { ev('pause'); E().pause(); };
  const snap = (l) => () => snapshot(l);
  // stall: trava o laço de start() depois da 1ª faixa medida (3ª chamada: click,
  // guia e 1º instrumento passam; os seguintes ficam pra depois da trava).
  const seek = (t, stall) => () => {
    if (stall) window.__stall = { skip: 3, ms: 15 };
    const b = sources.length; const e = ev('seekTo', { to: t, stall: !!stall }); E().seekTo(t); e.syncStarts = syncCount(b); e.nChannels = E().channels.length;
  };
  // Seeks pra 50 ms antes de um click (clicks em 0,25 + 0,5 k): o atraso do 1º
  // click depois da chamada, menos 50 ms, é o buraco do reinício.
  const gapSeeks = (t0, n, pos0) => Array.from({ length: n }, (_, k) => [t0 + k * 0.7, seek(pos0 + k - 0.05)]);
  const loopOn = () => { ev('armLoop'); E().armLoop(1, 'infinite'); };
  // Troca de música pelo repertório (índice atual) e remoção (ordem de carga).
  const jump = (i) => () => { ev('jumpToSong', { to: i }); E().jumpToSong(i); };
  const removeSong = (k) => () => { ev('removeSong', { song: k }); E().removeSongFromPlaylist(songIds[k]); };
  // Parado: põe o tom, aperta play (a 1ª vez transposta espera o worklet nascer)
  // e, na mesma hora, troca de música. A música do play pendente não pode tocar.
  const pendingSwitch = (from, semis, kind) => () => {
    ev('setPitch', { to: semis }); E().changePitch(semis);
    ev('play', { pending: true }); E().play();
    ev('pendingSwitch', { from, kind });
    if (kind === 'jumpToSong') E().jumpToSong(2); else if (kind === 'prevSong') E().prevSong(); else E().nextSong();
  };
  const loopOff = () => { ev('cancelLoop'); E().cancelLoop(); };
  const seeks = (t0, n, pos0) => Array.from({ length: n }, (_, k) => [t0 + k * 0.5, seek(pos0 + k * 0.3)]);
  const stallSeeks = (t0, n, pos0) => Array.from({ length: n }, (_, k) => [t0 + k * 1.0, seek(pos0 + k * 0.3, true)]);

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
    // Buraco no reinício (seek tocando) no tom 0 e no +2.
    RESTART: [[0, play], ...gapSeeks(2, 10, 5.25), [10, pitch(2)], ...gapSeeks(12, 10, 15.25), [19.5, snap('apos seeks no +2')], [20, pause], [21, snap('fim (pausado)')]],
    // Loop de seção tocando: emenda do click no tom 0 e no +2.
    LOOP: [[0, play], [0.6, loopOn], [22, pitch(2)], [44, loopOff], [45, snap('apos loops no +2')], [46, pause], [47, snap('fim (pausado)')]],
    // Laço de start() travado 15 ms no meio (o motor passa do instante comum):
    // o play tem de descartar e reagendar tudo junto, no tom 0 e no +2.
    STALL: [[0, play], ...stallSeeks(1.5, 6, 3), [8, pitch(2)], ...stallSeeks(10, 6, 12), [16.5, snap('apos travas no +2')], [17, pause], [18, snap('fim (pausado)')]],
    // Repertório: A (24 canais) +2, B (10) +3, C (30) +2, remove B com C tocando,
    // volta pra A (ainda +2) e A no tom 0. A reserva de worklets trabalha aqui.
    SONGS: [[0, play], [1, pitch(2)], [4, snap('A 24 canais +2')], [5, jump(1)], [6, pitch(3)], [9, snap('B 10 canais +3')],
      [10, jump(2)], [11, pitch(2)], [14.5, snap('C 30 canais +2')], [15.5, removeSong(1)], [17, snap('C depois de remover B')],
      [18, jump(0)], [21, snap('A de volta (+2)')], [22, pitch(0)], [25, snap('A tom 0')], [26, pause], [27, snap('fim (pausado)')]],
    // Play transposto pendente e troca de música antes do worklet nascer, pelos 3
    // caminhos: A + jumpToSong(C), C + prevSong (B) e B + nextSong (C). O botão
    // de próxima sempre toca a música seguinte (comportamento de antes), então no
    // fim C tem de estar tocando, e não B. Os pause() entre os casos deixam cada
    // um começar parado mesmo no código antigo (onde o anterior ficava tocando).
    PENDENTE: [[0.5, pendingSwitch(0, 2, 'jumpToSong')], [2.5, pause], [3, pendingSwitch(2, 3, 'prevSong')], [5.5, snap('fim das trocas (nada tocando)')],
      [6.5, pause], [7, pendingSwitch(1, 4, 'nextSong')], [10.5, snap('C tocando (+3), pelo botão de próxima')], [11.5, pause], [12.5, snap('fim (pausado)')]],
    // Nível de faixa mono e estéreo, pan total e centro, no tom 0 e transposto.
    LEVELS: [[0, play], [3, snap('tom 0')], [4, pitch(2)], [8, snap('apos +2')], [9, pitch(0)], [12, snap('apos volta 0')], [13, pause], [14, snap('fim (pausado)')]],
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
  const srcRecs = sources.filter((r) => r.started).map((r) => ({
    id: r.id, ch: bufSong.get(r.s.buffer)?.ch || '?', song: bufSong.get(r.s.buffer)?.song ?? -1, when: r.when, offset: +r.offset.toFixed(4), ctxAtStart: +r.ctxAtStart.toFixed(5),
    eff: +r.eff.toFixed(5), tStart: r.tStart, ctxAtStop: r.ctxAtStop !== undefined ? +r.ctxAtStop.toFixed(5) : null,
    tStop: r.tStop ?? null, startMark: r.startMark ?? 0, stopMark: r.stopMark ?? 0,
  }));
  const res = {
    cfg: { SEQ, N, ORDER, CLICK, measure, DUR, sampleRate: ctx.sampleRate, pansAtLoad, pannerCfg, songSizes,
      maxTransposable: MULTI ? Math.max(...SONG_SIZES) : undefined, voice: [...VOICE].filter((v) => instr.includes(v)), instruments: instr, channels: chNames },
    events, snaps, rRelLms: pairs, onsetsL: L_on.map((x) => +x.toFixed(5)), onsetsR: R_on.map((x) => +x.toFixed(5)),
    rms: rms.map((r) => [r[0], +(20 * Math.log10(r[1] + 1e-9)).toFixed(1), +(20 * Math.log10(r[2] + 1e-9)).toFixed(1), r[3]]),
    sources: srcRecs, workletsCreated: worklets.map((w) => w.createdAt),
  };
  await fetch('/result?name=' + encodeURIComponent(OUT), { method: 'POST', body: JSON.stringify(res) });
  document.body.dataset.done = '1';
}

main().catch((e) => fetch('/result?name=' + encodeURIComponent(OUT), { method: 'POST', body: JSON.stringify({ fatal: String(e && e.stack || e), events }) }));

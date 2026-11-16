// Instrumentação do Web Audio para a verificação. Precisa ser importado ANTES
// do hook: registra fontes (start/stop), worklets do signalsmith e ligações.
// Não muda o comportamento: só observa.

const perf0 = performance.now();
export const now = () => +(performance.now() - perf0).toFixed(1);
export const events = [];
export const ev = (type, data = {}) => {
  const c = window.__ctx;
  const e = { t: now(), ctx: c ? +c.currentTime.toFixed(4) : null, type, ...data };
  events.push(e);
  return e;
};

// Ligações (de -> para): rota de cada fonte e de cada worklet.
export const edges = new WeakMap();
export const inbound = new Map(); // destino -> Set(origens), só pra diagnóstico
const origConnect = AudioNode.prototype.connect;
AudioNode.prototype.connect = function (dest, ...rest) {
  if (dest instanceof AudioNode) {
    let s = edges.get(this);
    if (!s) edges.set(this, (s = new Set()));
    s.add(dest);
    let i = inbound.get(dest);
    if (!i) inbound.set(dest, (i = new Set()));
    i.add(this);
  }
  return origConnect.call(this, dest, ...rest);
};
const origDisconnect = AudioNode.prototype.disconnect;
AudioNode.prototype.disconnect = function (...a) {
  if (a.length === 0) { edges.get(this)?.forEach((d) => inbound.get(d)?.delete(this)); edges.delete(this); }
  else if (a[0] instanceof AudioNode) { edges.get(this)?.delete(a[0]); inbound.get(a[0])?.delete(this); }
  return origDisconnect.apply(this, a);
};

// Worklets do signalsmith (o pacote faz `new AudioWorkletNode(ctx, 'signalsmith-stretch')`).
export const worklets = [];
export const OrigAWN = window.AudioWorkletNode;
class TrackedAWN extends OrigAWN {
  constructor(ctx, name, opts) {
    super(ctx, name, opts);
    if (name === 'signalsmith-stretch') worklets.push({ node: this, id: worklets.length, createdAt: now() });
  }
}
window.AudioWorkletNode = TrackedAWN;

// Marca de "mesma execução": o 1º stop() abre uma marca que só vale até a
// próxima microtask. Um start() com a mesma marca do stop() anterior rodou sem
// nenhum await no meio (o reinício foi síncrono).
let syncMark = 0, syncSeq = 0;
const markSync = () => {
  if (!syncMark) { syncMark = ++syncSeq; queueMicrotask(() => { syncMark = 0; }); }
  return syncMark;
};

// Fontes: guarda when/offset de cada start() e o instante do stop().
export const sources = [];
const origCreateBS = BaseAudioContext.prototype.createBufferSource;
BaseAudioContext.prototype.createBufferSource = function () {
  const ctx = this;
  const s = origCreateBS.call(ctx);
  const rec = { s, id: sources.length, created: now(), started: false, stopped: false, ended: false };
  sources.push(rec);
  s.addEventListener('ended', () => { rec.ended = true; });
  const oStart = s.start.bind(s);
  const oStop = s.stop.bind(s);
  s.start = (when = 0, offset = 0, ...r) => {
    // STALL: trava o laço de start() do play (busy-wait) depois de `skip`
    // chamadas, uma vez só, pra simular o motor de áudio passando do instante.
    const st = window.__stall;
    if (st) {
      if (st.skip > 0) st.skip--;
      else { window.__stall = null; const t0 = performance.now(); while (performance.now() - t0 < st.ms) { /* trava */ } }
    }
    rec.startMark = syncMark;
    rec.started = true;
    rec.when = when;
    rec.offset = offset;
    rec.ctxAtStart = ctx.currentTime;
    rec.tStart = now();
    rec.eff = Math.max(when, ctx.currentTime);
    return oStart(when, offset, ...r);
  };
  s.stop = (...a) => {
    if (!rec.stopped) { rec.stopped = true; rec.ctxAtStop = ctx.currentTime; rec.tStop = now(); rec.stopMark = markSync(); }
    return oStop(...a);
  };
  return s;
};

window.addEventListener('error', (e) => ev('page_error', { msg: String(e.message) }));
window.addEventListener('unhandledrejection', (e) => ev('page_rejection', { msg: String(e.reason && (e.reason.stack || e.reason)) }));
const origErr = console.error.bind(console);
console.error = (...a) => { ev('console_error', { msg: a.map(String).join(' ').slice(0, 300) }); origErr(...a); };

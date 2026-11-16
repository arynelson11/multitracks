// Gabarito de uma música a partir da faixa de click: BPM (com decimais, por
// regressão dos tempos), fase (1º tempo), acento do "1" e se há subdivisão.
//
// Estrutura do click (altura, classe de som e volume de cada ataque, de clickOnsets.mjs):
// - "alternado": forte e fraco se revezando (padrão do MultiTracks.com): o
//   click está em colcheias e o tempo é o forte (BPM = metade da taxa de clicks).
// - "acento a cada N": um click diferente a cada N, o resto igual. Até 7 é o
//   compasso no nível do click; 8 ou mais vira colcheia (N/2 tempos por compasso),
//   a não ser que o nome da pasta diga a própria taxa de clicks.
// - "uniforme": todos iguais (sem acento): tempo = click e o "1" não se mede.
//   Só se presume: o 1º click em 0:00 é começo de compasso, como em todo click
//   exportado do começo da sessão (nos clicks com acento isso sempre bateu).
// O nome da pasta (ou do arquivo de click) só decide o nível no caso do acento a
// cada 8 e é conferido no fim (bate, dobro, metade).

const PERIODS = [2, 3, 4, 6, 8, 12, 16];
const HZ_BIN = 44100 / 1024;

const median = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[s.length >> 1] : NaN; };

/** BPM escrito no nome (pasta ou arquivo): "148.00bpm", "128Bpm", "BPM132", "CLICK64", "click108", "BIT 162". */
export function nameBpm(...names) {
  const pats = [/(\d{2,3}(?:[.,]\d+)?)\s*-?\s*bpm/i, /bpm\s*(\d{2,3}(?:[.,]\d+)?)/i, /click\s*_?(\d{2,3})(?!\d)/i, /\bbit\s*(\d{2,3})\b/i];
  for (const n of names) {
    for (const p of pats) {
      const m = n.match(p);
      if (m) {
        const v = parseFloat(m[1].replace(',', '.'));
        if (v >= 40 && v <= 240) return v;
      }
    }
  }
  return null;
}

// Menor período N em que as posições (k mod N) têm uma classe dominante (85% no
// total e pelo menos 75% em cada posição) e não são todas iguais. O mínimo por
// posição impede que um acento a cada 8 passe por acento a cada 4.
function periodic(seq, minPurity = 0.85, minEach = 0.75) {
  for (const N of PERIODS) {
    const pos = Array.from({ length: N }, () => new Map());
    for (const [k, c] of seq) { const m = pos[((k % N) + N) % N]; m.set(c, (m.get(c) || 0) + 1); }
    let good = 0, tot = 0, worst = 1;
    const modal = [];
    for (const m of pos) {
      let bc = null, bn = 0, s = 0;
      for (const [c, n] of m) { s += n; if (n > bn) { bn = n; bc = c; } }
      good += bn; tot += s; modal.push(bc);
      if (s) worst = Math.min(worst, bn / s);
    }
    if (tot && good / tot >= minPurity && worst >= minEach && new Set(modal).size > 1) return { N, modal, purity: good / tot };
  }
  return null;
}

const FEATURES = [
  ['altura', (o) => Math.round(o.hz / HZ_BIN)],
  ['som', (o) => o.cls],
  ['volume', (o) => Math.round(o.db / 1.5)],
  ['som+volume', (o) => `${o.cls}|${Math.round(o.db / 1.5)}`],
];

function findPattern(items) {
  for (const [name, f] of FEATURES) {
    const p = periodic(items.map((o) => [o.k, f(o)]));
    if (p) return { ...p, feature: name };
  }
  return null;
}

// Como ler um padrão de N posições: alternado (forte e fraco), acento numa posição
// (as outras iguais) ou forte e fraco com classes diferentes nas duas paridades.
function interpret(pat, items) {
  const { N, modal } = pat;
  const medDb = (p) => median(items.filter((o) => ((o.k % N) + N) % N === p).map((o) => o.db));
  if (N === 2) return { kind: 'alternado', strong: medDb(1) > medDb(0) + 0.3 ? 1 : 0 };
  const cnt = new Map();
  for (const c of modal) cnt.set(c, (cnt.get(c) || 0) + 1);
  const uniq = modal.map((c, p) => (cnt.get(c) === 1 ? p : -1)).filter((p) => p >= 0);
  const rest = modal.filter((c) => cnt.get(c) > 1);
  const halfBar = uniq.length === 2 && N >= 6 && N % 2 === 0 && uniq[1] - uniq[0] === N / 2;
  if ((uniq.length === 1 || halfBar) && new Set(rest).size === 1) {
    // duas posições únicas a meio compasso (6/8: acento no 1 e no 4): fica a mais forte; no empate, a 1ª
    let best = uniq[0];
    for (const p of uniq) if (medDb(p) > medDb(best) + 0.3) best = p;
    return { kind: 'acento', accentPos: best, secondary: uniq.filter((p) => p !== best) };
  }
  if (N % 2 === 0) {
    for (const par of [0, 1]) {
      const strongC = modal.filter((_, p) => p % 2 === par);
      const weakC = modal.filter((_, p) => p % 2 !== par);
      if (!weakC.some((c) => strongC.includes(c)) && medDb(par) >= medDb(1 - par) - 0.3) return { kind: 'alternado', strong: par };
    }
  }
  return { kind: 'complexo' };
}

function linreg(xs, ys) {
  const n = xs.length;
  let sx = 0, sy = 0;
  for (let i = 0; i < n; i++) { sx += xs[i]; sy += ys[i]; }
  const mx = sx / n, my = sy / n;
  let sxx = 0, sxy = 0;
  for (let i = 0; i < n; i++) { sxx += (xs[i] - mx) ** 2; sxy += (xs[i] - mx) * (ys[i] - my); }
  const b = sxy / sxx;
  const a = my - b * mx;
  let r2 = 0;
  for (let i = 0; i < n; i++) r2 += (ys[i] - a - b * xs[i]) ** 2;
  return { a, b, rms: Math.sqrt(r2 / n) };
}

/**
 * @param on ataques do click (clickOnsets + soundClasses)
 * @param opts.nameBpm BPM do nome da pasta/arquivo (ou null)
 */
export function clickTruth(on, opts = {}) {
  if (on.length < 32) return { ok: false, reason: `só ${on.length} clicks` };
  const ioi = on.slice(1).map((o, i) => o.t - on[i].t);
  const med = median(ioi);
  // índice de cada click na grade de clicks (buraco de 1 click pula 2)
  const items = [{ ...on[0], k: 0 }];
  for (let i = 1; i < on.length; i++) items.push({ ...on[i], k: items[i - 1].k + Math.max(1, Math.round(ioi[i - 1] / med)) });
  const rate = 60 / linreg(items.map((o) => o.k), items.map((o) => o.t)).b;
  const nb = opts.nameBpm ?? null;
  const near = (a, b, tol = 0.015) => Math.abs(a / b - 1) <= tol;

  const pat = findPattern(items);
  let it = pat ? interpret(pat, items) : null;
  let patternText = pat ? `${pat.feature} N=${pat.N}: ${pat.modal.join(' ')}` : '';
  if (!pat) {
    // sem padrão por classe: alternância só por volume (par x ímpar com 1,5 dB ou mais, em 85% dos pares)
    const even = items.filter((o) => o.k % 2 === 0), odd = items.filter((o) => o.k % 2 === 1);
    const d = median(even.map((o) => o.db)) - median(odd.map((o) => o.db));
    const byK = new Map(items.map((o) => [o.k, o.db]));
    let same = 0, tot = 0;
    for (const o of even) if (byK.has(o.k + 1)) { tot++; if (Math.sign(o.db - byK.get(o.k + 1)) === Math.sign(d)) same++; }
    if (Math.abs(d) >= 1.5 && tot && same / tot >= 0.85) {
      it = { kind: 'alternado', strong: d > 0 ? 0 : 1 };
      patternText = `volume par x ímpar ${d.toFixed(1)} dB`;
    }
  }
  let kind = 'uniforme', m = 1, k0 = 0, accentEvery = null, accentPos = null, subdivision = false;
  if (it?.kind === 'alternado') {
    kind = 'alternado'; subdivision = true; m = 2; k0 = it.strong;
  } else if (it?.kind === 'acento') {
    kind = 'acento'; accentEvery = pat.N; accentPos = it.accentPos;
    if (pat.N >= 8 && pat.N % 2 === 0 && !(nb && near(rate, nb))) { m = 2; subdivision = true; }
    k0 = accentPos % m;
    if (it.secondary.length) patternText += ` (acento secundário na posição ${it.secondary.join(',')})`;
  } else if (it?.kind === 'complexo') kind = 'complexo';
  if (kind === 'uniforme') {
    // confere se é mesmo uniforme (uma classe de altura com 85% dos clicks)
    const c = new Map();
    for (const o of items) { const h = Math.round(o.hz / HZ_BIN); c.set(h, (c.get(h) || 0) + 1); }
    if (Math.max(...c.values()) / items.length < 0.85) kind = 'irregular';
  }

  // Tempos: clicks na posição k0 mod m; índice de tempo j.
  const beatsAll = items.filter((o) => (((o.k - k0) % m) + m) % m === 0).map((o) => ({ t: o.t, j: (o.k - k0) / m, o }));
  const reg = linreg(beatsAll.map((b) => b.j), beatsAll.map((b) => b.t));
  const bpmGlobal = 60 / reg.b;
  // Andamento local (janelas de 32 tempos, passo 16)
  const local = [];
  for (let i = 0; i + 32 <= beatsAll.length; i += 16) {
    const w = beatsAll.slice(i, i + 32);
    const r = linreg(w.map((b) => b.j), w.map((b) => b.t));
    local.push({ t: w[0].t, bpm: 60 / r.b });
  }
  const lb = local.map((l) => l.bpm);
  const localMin = lb.length ? Math.min(...lb) : bpmGlobal, localMax = lb.length ? Math.max(...lb) : bpmGlobal;
  const variable = (localMax - localMin) / bpmGlobal > 0.004;
  // Com andamento variável, o BPM do gabarito é o do trecho mais comum (mediana dos locais).
  const bpm = variable && lb.length ? median(lb) : bpmGlobal;
  const changes = [];
  for (let i = 1; i < local.length; i++) if (Math.abs(local[i].bpm - local[i - 1].bpm) / bpmGlobal > 0.004) changes.push(`${local[i].t.toFixed(0)} s: ${local[i - 1].bpm.toFixed(2)} -> ${local[i].bpm.toFixed(2)}`);

  // Compasso: com acento, N/m tempos (8 ou mais no nível do click vira 4, com acento a cada 2 compassos).
  let beatsPerBar = 4, bpbSource = 'presumido 4/4 (sem acento)';
  let accentBeat = null; // índice de tempo (mod beatsPerBar) do "1"
  if (kind === 'alternado') {
    // acento de compasso entre os tempos fortes?
    const strong = beatsAll.map((b) => ({ ...b.o, k: b.j }));
    const p2 = findPattern(strong);
    const i2 = p2 ? interpret(p2, strong) : null;
    if (i2?.kind === 'acento' && p2.N <= 7) {
      accentEvery = p2.N * 2; beatsPerBar = p2.N; accentBeat = i2.accentPos; bpbSource = `acento a cada ${p2.N} tempos`;
      patternText += ` | nos tempos: ${p2.feature} N=${p2.N}: ${p2.modal.join(' ')}`;
    }
  } else if (kind === 'acento') {
    const barBeats = accentEvery / m;
    if (Number.isInteger(barBeats)) {
      beatsPerBar = barBeats <= 7 ? barBeats : barBeats % 4 === 0 ? 4 : barBeats % 3 === 0 ? 3 : 4;
      accentBeat = ((accentPos - k0) / m) % beatsPerBar;
      bpbSource = barBeats <= 7 ? `acento a cada ${barBeats} tempos` : `acento a cada ${barBeats} tempos (fica ${beatsPerBar} por compasso)`;
    }
  }
  const accents = accentBeat === null ? [] : beatsAll.filter((b) => (((b.j - accentBeat) % beatsPerBar) + beatsPerBar) % beatsPerBar === 0).map((b) => b.t);
  const presumedOne = accentBeat === null && beatsAll[0].t < 0.05 ? beatsAll[0].t : null;

  let nameRel = null;
  if (nb) {
    for (const [f, lab] of [[1, 'bate'], [2, 'nome = dobro'], [0.5, 'nome = metade'], [1.5, 'nome = 3/2'], [2 / 3, 'nome = 2/3'], [3, 'nome = triplo'], [1 / 3, 'nome = 1/3']]) {
      if (near(nb, bpm * f, 0.006)) { nameRel = { factor: f, label: lab }; break; }
    }
    if (!nameRel) nameRel = { factor: null, label: `não bate (${nb})` };
  }

  return {
    ok: true, nClicks: on.length, clickRate: rate, kind, subdivision, clicksPerBeat: m, accentEvery, patternText,
    bpm, bpmGlobal, firstBeat: beatsAll[0].t, residualMs: reg.rms * 1000,
    localMin, localMax, variable, changes: changes.slice(0, 6), beatsPerBar, bpbSource,
    beats: beatsAll.map((b) => b.t), beatIdx: beatsAll.map((b) => b.j), accents, presumedOne,
    nameBpm: nb, nameRel, lastClick: on[on.length - 1].t,
  };
}

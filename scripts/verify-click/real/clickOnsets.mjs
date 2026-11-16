// Ataques da faixa de click (sinal limpo): envelope de 1 ms, subida de +10 dB
// sobre os 12 ms anteriores acima de -36 dB do pico da faixa, refinado pra
// 1ª amostra >= 20% do pico local. Cada ataque leva o pico (dB do maior pico
// da faixa) e a frequência dominante dos primeiros 23 ms (FFT de 1024 pontos),
// pra achar o acento (mais forte ou mais agudo) e a subdivisão (mais fraca).

function fftMag(re) {
  const n = re.length;
  const im = new Float64Array(n);
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { const t = re[i]; re[i] = re[j]; re[j] = t; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    for (let i = 0; i < n; i += len) {
      for (let k = 0; k < len / 2; k++) {
        const wr = Math.cos(ang * k), wi = Math.sin(ang * k);
        const ar = re[i + k + len / 2], ai = im[i + k + len / 2];
        const tr = ar * wr - ai * wi, ti = ar * wi + ai * wr;
        re[i + k + len / 2] = re[i + k] - tr; im[i + k + len / 2] = im[i + k] - ti;
        re[i + k] += tr; im[i + k] += ti;
      }
    }
  }
  const m = new Float64Array(n / 2);
  for (let i = 0; i < n / 2; i++) m[i] = Math.hypot(re[i], im[i]);
  return m;
}

function peakHz(x, on, sr) {
  const N = 1024;
  const re = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    const v = x[on + i] ?? 0;
    re[i] = v * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (N - 1)));
  }
  const m = fftMag(re);
  let best = 1;
  for (let i = 2; i < N / 2; i++) if (m[i] > m[best]) best = i;
  return (best * sr) / N;
}

export function clickOnsets(x, sr) {
  const win = Math.max(1, Math.round(sr * 0.001));
  const nf = Math.floor(x.length / win);
  const env = new Float32Array(nf);
  for (let j = 0; j < nf; j++) {
    let s = 0;
    const b = j * win;
    for (let k = 0; k < win; k++) s += x[b + k] * x[b + k];
    env[j] = Math.sqrt(s / win);
  }
  let gmax = 0;
  for (const e of env) if (e > gmax) gmax = e;
  let amax = 0;
  for (let i = 0; i < x.length; i++) { const a = Math.abs(x[i]); if (a > amax) amax = a; }
  const thr = gmax * 0.016; // -36 dB
  const out = [];
  let lastOn = -1e9;
  for (let j = 0; j < nf - 40; j++) {
    if (env[j] < thr) continue;
    let before = 0;
    for (let k = Math.max(0, j - 12); k < j - 1; k++) if (env[k] > before) before = env[k];
    if (env[j] < 3.2 * before) continue;
    if (j - lastOn < 50) continue;
    let pkF = j, pkE = 0;
    for (let k = j; k < j + 25; k++) if (env[k] > pkE) { pkE = env[k]; pkF = k; }
    const s0 = Math.max(0, (j - 3) * win), s1 = (pkF + 1) * win;
    let pk = 0;
    for (let i = s0; i < s1; i++) pk = Math.max(pk, Math.abs(x[i]));
    let on = s0;
    for (let i = s0; i < s1; i++) if (Math.abs(x[i]) >= 0.2 * pk) { on = i; break; }
    out.push({ t: on / sr, s: on, db: 20 * Math.log10(pk / amax + 1e-12), hz: peakHz(x, on, sr) });
    lastOn = j;
    j = pkF + 10;
  }
  return out;
}

/**
 * Classe de som de cada ataque (mesmo som = mesma classe): correlação
 * normalizada dos primeiros 30 ms com os moldes já vistos (deslocamento de até
 * ±8 amostras); abaixo de 0,8 com todos vira molde novo (até 8). O ganho não
 * conta aqui (o acento por volume sai do dB).
 */
export function soundClasses(x, onsets, sr) {
  const L = Math.round(sr * 0.03);
  const lag = 8;
  const templates = [];
  const snip = (s) => x.subarray(s, Math.min(x.length, s + L));
  const ncorr = (a, b) => {
    let best = -1;
    for (let d = -lag; d <= lag; d++) {
      let s = 0, sa = 0, sb = 0;
      for (let i = Math.max(0, -d); i < a.length && i + d < b.length; i++) {
        const u = a[i], v = b[i + d];
        s += u * v; sa += u * u; sb += v * v;
      }
      const c = s / Math.sqrt(sa * sb + 1e-30);
      if (c > best) best = c;
    }
    return best;
  };
  for (const o of onsets) {
    const a = snip(o.s);
    let bi = -1, bc = -2;
    for (let k = 0; k < templates.length; k++) {
      const c = ncorr(a, templates[k]);
      if (c > bc) { bc = c; bi = k; }
    }
    if (bc < 0.8 && templates.length < 8) { templates.push(a); bi = templates.length - 1; }
    o.cls = bi;
  }
  return templates.length;
}

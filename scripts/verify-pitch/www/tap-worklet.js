// Medidor na saída do principal. Sempre: RMS por janela de 50 ms (L/R), NaN e onsets por canal.
// Com `processorOptions.freqs` (cenários do palco novo, T30): a cada passo de `hop` amostras
// (1 ms), a amplitude em cada frequência pedida, por saída, pelo Goertzel sobre os últimos `win`
// amostras (10 ms) com janela de Hann, mais o RMS do último passo por saída. A amplitude sai na
// escala do seno: um seno de amplitude A na frequência lê A. Vai em lotes de 50 passos, com o
// instante (tempo do contexto) do fim da janela de cada passo.
class Tap extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.win = Math.round(sampleRate * 0.05);
    this.acc = [0, 0]; this.n = 0; this.nan = 0;
    this.env = [0, 0]; this.armed = [true, true];
    this.decay = Math.exp(-1 / (sampleRate * 0.02));
    this.t0 = null;
    const o = (options && options.processorOptions) || {};
    this.freqs = Array.isArray(o.freqs) ? o.freqs.map(Number) : [];
    if (this.freqs.length) {
      this.gWin = o.win || Math.round(sampleRate * 0.01);
      this.gHop = o.hop || Math.round(sampleRate * 0.001);
      this.hann = new Float32Array(this.gWin);
      let sum = 0;
      for (let k = 0; k < this.gWin; k++) { this.hann[k] = 0.5 - 0.5 * Math.cos((2 * Math.PI * k) / this.gWin); sum += this.hann[k]; }
      this.gScale = 2 / sum;
      this.coef = this.freqs.map((f) => 2 * Math.cos((2 * Math.PI * f) / sampleRate));
      this.ring = [new Float32Array(this.gWin), new Float32Array(this.gWin)];
      this.pos = 0; this.filled = 0; this.sinceHop = 0; this.hopSq = [0, 0];
      // Por passo: 2 saídas x frequências, mais o RMS das 2 saídas.
      this.stride = 2 * this.freqs.length + 2;
      this.BATCH = 50;
      this.bt = new Float64Array(this.BATCH);
      this.bv = new Float32Array(this.BATCH * this.stride);
      this.bn = 0;
    }
  }
  // Amplitude na frequência `fi` da saída `c`, nos últimos gWin amostras (da mais velha pra mais nova).
  goertzel(c, fi) {
    const ring = this.ring[c], w = this.hann, coef = this.coef[fi], N = this.gWin;
    let s1 = 0, s2 = 0, k = 0;
    for (let i = this.pos; i < N; i++, k++) { const s = ring[i] * w[k] + coef * s1 - s2; s2 = s1; s1 = s; }
    for (let i = 0; i < this.pos; i++, k++) { const s = ring[i] * w[k] + coef * s1 - s2; s2 = s1; s1 = s; }
    const p = s1 * s1 + s2 * s2 - coef * s1 * s2;
    return Math.sqrt(p > 0 ? p : 0) * this.gScale;
  }
  process(inputs, outputs) {
    const inp = inputs[0] || [];
    const out = outputs[0];
    const L = inp[0], R = inp[1] || inp[0];
    const frames = 128;
    for (let i = 0; i < frames; i++) {
      const s = [L ? L[i] : 0, R ? R[i] : 0];
      for (let c = 0; c < 2; c++) {
        let v = s[c];
        if (v !== v) { this.nan++; v = 0; }
        this.acc[c] += v * v;
        const a = Math.abs(v);
        this.env[c] = Math.max(a, this.env[c] * this.decay);
        if (this.armed[c] && this.env[c] > 0.25) {
          this.port.postMessage(['on', c, currentTime + i / sampleRate]);
          this.armed[c] = false;
        } else if (!this.armed[c] && this.env[c] < 0.05) {
          this.armed[c] = true;
        }
        if (this.freqs.length) { this.ring[c][this.pos] = v; this.hopSq[c] += v * v; }
      }
      this.n++;
      if (this.n >= this.win) {
        const rl = Math.sqrt(this.acc[0] / this.n), rr = Math.sqrt(this.acc[1] / this.n);
        this.port.postMessage(['rms', currentTime + i / sampleRate, rl, rr, this.nan]);
        this.acc = [0, 0]; this.n = 0; this.nan = 0;
      }
      if (this.freqs.length) {
        this.pos = (this.pos + 1) % this.gWin;
        if (this.filled < this.gWin) this.filled++;
        if (++this.sinceHop >= this.gHop) {
          if (this.filled >= this.gWin) {
            const base = this.bn * this.stride, nf = this.freqs.length;
            this.bt[this.bn] = currentTime + (i + 1) / sampleRate;
            for (let c = 0; c < 2; c++) for (let f = 0; f < nf; f++) this.bv[base + c * nf + f] = this.goertzel(c, f);
            this.bv[base + 2 * nf] = Math.sqrt(this.hopSq[0] / this.sinceHop);
            this.bv[base + 2 * nf + 1] = Math.sqrt(this.hopSq[1] / this.sinceHop);
            if (++this.bn >= this.BATCH) {
              this.port.postMessage(['g', this.bt.slice(0, this.bn), this.bv.slice(0, this.bn * this.stride)]);
              this.bn = 0;
            }
          }
          this.sinceHop = 0; this.hopSq = [0, 0];
        }
      }
    }
    if (out) for (let c = 0; c < out.length; c++) { const src = inp[c] || inp[0]; if (src) out[c].set(src); }
    return true;
  }
}
registerProcessor('tap', Tap);

// Medidor na saída do master: RMS por janela de 50 ms (L/R), NaN, e onsets por canal.
class Tap extends AudioWorkletProcessor {
  constructor() {
    super();
    this.win = Math.round(sampleRate * 0.05);
    this.acc = [0, 0]; this.n = 0; this.nan = 0;
    this.env = [0, 0]; this.armed = [true, true];
    this.decay = Math.exp(-1 / (sampleRate * 0.02));
    this.t0 = null;
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
      }
      this.n++;
      if (this.n >= this.win) {
        const rl = Math.sqrt(this.acc[0] / this.n), rr = Math.sqrt(this.acc[1] / this.n);
        this.port.postMessage(['rms', currentTime + i / sampleRate, rl, rr, this.nan]);
        this.acc = [0, 0]; this.n = 0; this.nan = 0;
      }
    }
    if (out) for (let c = 0; c < out.length; c++) { const src = inp[c] || inp[0]; if (src) out[c].set(src); }
    return true;
  }
}
registerProcessor('tap', Tap);

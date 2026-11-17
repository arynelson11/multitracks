// Grava as duas saídas do principal amostra a amostra entre 'start' e 'dump' (section-jump.mjs).
class Rec extends AudioWorkletProcessor {
  constructor() {
    super();
    this.on = false; this.t0 = 0; this.chunksL = []; this.chunksR = [];
    this.port.onmessage = (e) => {
      if (e.data === 'start') { this.on = true; this.t0 = currentTime; this.chunksL = []; this.chunksR = []; }
      else if (e.data === 'dump') {
        this.on = false;
        const n = this.chunksL.length * 128;
        const L = new Float32Array(n), R = new Float32Array(n);
        this.chunksL.forEach((c, i) => L.set(c, i * 128));
        this.chunksR.forEach((c, i) => R.set(c, i * 128));
        this.port.postMessage({ t0: this.t0, L, R }, [L.buffer, R.buffer]);
      }
    };
  }
  process(inputs, outputs) {
    const inp = inputs[0] || [];
    if (this.on) {
      this.chunksL.push(inp[0] ? new Float32Array(inp[0]) : new Float32Array(128));
      this.chunksR.push(inp[1] ? new Float32Array(inp[1]) : (inp[0] ? new Float32Array(inp[0]) : new Float32Array(128)));
    }
    const out = outputs[0];
    if (out) for (let c = 0; c < out.length; c++) out[c].fill(0);
    return true;
  }
}
registerProcessor('rec', Rec);

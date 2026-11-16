// Consistência no demo real: a grade de cada stem concorda com a da bateria?
import { detectBeatGrid } from '../../src/lib/beatGrid';
import { readWav } from './wav.mjs';
const dir = new URL('../demo-wav/', import.meta.url).pathname;
const ref = { bpm: 135.03, fb: 0.1735 };
const P = 60 / ref.bpm;
for (const id of ['bateria', 'baixo', 'guitarra', 'teclado', 'vocais', 'outros']) {
  const w = readWav(dir + id + '.wav');
  const g = detectBeatGrid(w.channels, w.sampleRate, { beatsPerBar: 4 });
  let d = ((g.firstBeat - ref.fb) % P + P) % P; if (d > P / 2) d -= P;
  console.log(JSON.stringify({ stem: id, bpm: g.bpm, firstBeat: +g.firstBeat.toFixed(4), downbeat: g.downbeat, conf: +g.confidence.toFixed(3), difFaseVsBateriaMs: +(d * 1000).toFixed(1) }));
}

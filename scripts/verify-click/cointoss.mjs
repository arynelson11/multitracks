// Baixo em colcheias iguais / shaker: a fase trava no tempo ou no contratempo?
import { detectBeatGrid } from '../../src/lib/beatGrid';
import { makeSong } from './synth.mjs';
for (const track of ['bass8', 'shaker']) {
  let on = 0, off = 0, other = 0; const det = [];
  for (let i = 0; i < 12; i++) {
    const bpm = 80 + i * 7.3, fb = 0.2 + (i * 0.137) % 0.5;
    const s = makeSong({ sr: 48000, duration: 120, bpm, firstBeat: fb, seed: 11 + i });
    const g = detectBeatGrid(s.tracks[track], 48000, { beatsPerBar: 4 });
    const P = 60 / bpm;
    if (Math.abs(g.bpm - bpm) > 0.5) { other++; det.push(`${bpm.toFixed(1)}->${g.bpm}`); continue; }
    let d = ((g.firstBeat - fb) % P + P) % P; if (d > P / 2) d -= P;
    if (Math.abs(d) < 0.03) on++; else if (Math.abs(Math.abs(d) - P / 2) < 0.03) off++; else other++;
    det.push(`${bpm.toFixed(1)}:${(d * 1000).toFixed(0)}ms`);
  }
  console.log(JSON.stringify({ track, noTempo: on, noContratempo: off, outro: other, det }));
}

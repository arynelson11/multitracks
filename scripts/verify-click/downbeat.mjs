// Varredura do "1" (acento) em 4/4: onde a música começa, com/sem intro e virada.
import { detectBeatGrid } from '../../src/lib/beatGrid';
import { makeSong } from './synth.mjs';
const rows = []; let ok = 0, tot = 0;
for (const pattern of ['rock44', 'disco44', 'popsync44']) for (const fb of [0, 0.25, 0.5, 1.0, 1.37, 2.0]) for (const intro of ['sem', 'intro4', 'intro4+virada']) {
  const bpm = pattern === 'disco44' ? 124 : pattern === 'popsync44' ? 84 : 120;
  const s = makeSong({ sr: 48000, duration: 120, bpm, firstBeat: fb, pattern, introBars: intro === 'sem' ? 0 : 4, fillBeforeEntry: intro === 'intro4+virada' ? 4 : null });
  const g = detectBeatGrid(s.tracks.drums, 48000, { beatsPerBar: 4 });
  const P = 60 / bpm;
  const accT = g.firstBeat + g.downbeat * P;
  const pos = ((Math.round((accT - fb) / P) % 4) + 4) % 4; // 0 = cai no 1
  tot++; if (pos === 0) ok++;
  rows.push(`${pattern}/${fb}s/${intro}: acento no ${pos + 1}`);
}
console.log(`acento no 1: ${ok}/${tot}`);
console.log(rows.join('\n'));

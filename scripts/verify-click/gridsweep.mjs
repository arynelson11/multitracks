// Medição auxiliar: erro do firstBeat de detectBeatGrid em função de onde o
// ataque cai dentro do hop, nas duas taxas comuns; e confiança de faixas sem pulso.
import { detectBeatGrid } from '../../src/lib/beatGrid';
import { makeSong } from './synth.mjs';

const part = process.argv[2] || 'all';

if (part === 'all' || part === 'phase') {
  for (const sr of [48000, 44100]) {
    const rows = [];
    for (const bpm of [120, 97.3]) {
      for (let off = 0; off < 5.5; off += 0.5) {
        const fb = 0.5 + off / 1000;
        const s = makeSong({ sr, duration: 120, bpm, firstBeat: fb, withPad: false, withBass: false });
        const g = detectBeatGrid(s.tracks.drums, sr, { beatsPerBar: 4 });
        const period = 60 / bpm;
        let e = (g.firstBeat - (fb % period)) * 1000;
        if (e > period * 500) e -= period * 1000;
        rows.push({ sr, bpm, offMs: off, bpmErr: +(g.bpm - bpm).toFixed(3), firstBeatErrMs: +e.toFixed(2) });
      }
    }
    const errs = rows.map(r => r.firstBeatErrMs);
    console.log(JSON.stringify({ sr, min: Math.min(...errs), max: Math.max(...errs), mean: +(errs.reduce((a, b) => a + b, 0) / errs.length).toFixed(2), rows }));
  }
}

if (part === 'all' || part === 'conf') {
  const sr = 48000, dur = 120;
  const n = sr * dur;
  const mk = (f) => { const a = new Float32Array(n); for (let i = 0; i < n; i++) a[i] = f(i / sr, i); return [a, Float32Array.from(a)]; };
  let seed = 7; const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  const cases = {
    silencio: mk(() => 0),
    ruido_branco: mk(() => (rnd() * 2 - 1) * 0.1),
    pad_por_compasso: makeSong({ sr, duration: dur, bpm: 120, firstBeat: 0.8 }).tracks.pad,
    baixo_por_compasso: makeSong({ sr, duration: dur, bpm: 120, firstBeat: 0.8 }).tracks.bass,
    voz_glissando: mk((t) => Math.sin(2 * Math.PI * (220 + 60 * Math.sin(2 * Math.PI * 0.13 * t)) * t) * (0.5 + 0.5 * Math.sin(2 * Math.PI * 0.07 * t)) * 0.3),
    bateria_SNR_m10dB: (() => { const s = makeSong({ sr, duration: dur, bpm: 120, firstBeat: 0.8, gain: 0.03, noiseDb: -20 }); return s.tracks.drums; })(),
    bateria_SNR_m20dB: (() => { const s = makeSong({ sr, duration: dur, bpm: 120, firstBeat: 0.8, gain: 0.01, noiseDb: -20 }); return s.tracks.drums; })(),
    bateria_SNR_m30dB: (() => { const s = makeSong({ sr, duration: dur, bpm: 120, firstBeat: 0.8, gain: 0.003, noiseDb: -20 }); return s.tracks.drums; })(),
  };
  for (const [k, ch] of Object.entries(cases)) {
    const g = detectBeatGrid(ch, sr, { beatsPerBar: 4 });
    console.log(JSON.stringify({ caso: k, bpm: g.bpm, firstBeat: +g.firstBeat.toFixed(4), downbeat: g.downbeat, confidence: +g.confidence.toFixed(3), caminho: g.confidence >= 0.1 ? 'grade' : 'reserva' }));
  }
}

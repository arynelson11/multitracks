// Etapa do "1": qual tempo da grade abre o compasso.
//
// M1: a regra de hoje. Posição do compasso com mais energia de bumbo (banda
// grave); em compasso par o bumbo costuma cair no 1 E no 3 (empate), então o
// desempate é onde a música começa: introdução quase sempre entra no tempo 1.
// A M3 troca pelo voto da troca de acorde e do baixo (`votes`).
import { ONSET_LAG_FRAMES, sampleAt, type OnsetBands } from './onsets';

/** Faixas que votam no "1" além da faixa de pulso. */
export interface DownbeatVotes {
  bass?: OnsetBands;
  harmony?: OnsetBands[];
}

/**
 * @param b ataques por banda da faixa de pulso
 * @param period período da grade, em SEGUNDOS
 * @param firstBeat primeiro tempo da grade, em segundos, em [0, period)
 * @param beatsPerBar tempos por compasso (>= 1)
 * @param votes faixas que votam no "1" (M1: ainda não usadas)
 * @returns qual tempo, contado a partir de `firstBeat` (0..beatsPerBar-1), é o "1"
 */
export function chooseDownbeat(b: OnsetBands, period: number, firstBeat: number, beatsPerBar: number, votes?: DownbeatVotes): number {
  void votes; // M1: o "1" ainda sai só da faixa de pulso (a M3 usa o baixo e a harmonia)
  const fps = b.fps;
  const o = b.full;
  const oLow = b.low;
  const barSums: number[] = new Array(beatsPerBar).fill(0);
  const beatOnsets: number[] = [];
  for (let k = 0; ; k++) {
    const x = (firstBeat + k * period) * fps - ONSET_LAG_FRAMES;
    if (x > oLow.length - 1) break;
    barSums[k % beatsPerBar] += sampleAt(oLow, x);
    beatOnsets.push(sampleAt(o, x));
  }
  let downbeat = 0;
  for (let m = 1; m < beatsPerBar; m++) if (barSums[m] > barSums[downbeat]) downbeat = m;
  if (beatsPerBar % 2 === 0 && beatOnsets.length > 0) {
    const sorted = [...beatOnsets].sort((x, y) => x - y);
    const strong = sorted[Math.floor(sorted.length * 0.9)] * 0.3;
    const startBeat = beatOnsets.findIndex(v => v > strong);
    const alt = (downbeat + beatsPerBar / 2) % beatsPerBar;
    const pairClose = Math.abs(barSums[alt] - barSums[downbeat]) < 0.35 * barSums[downbeat];
    if (pairClose && startBeat >= 0 && startBeat % beatsPerBar === alt) downbeat = alt;
  }
  return downbeat;
}

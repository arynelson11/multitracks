// Etapa de tempo x contratempo: depois da busca de período e fase, decide se a
// fase achada é o tempo ou o contratempo (meio período depois).
//
// A busca acha a fase com mais energia de ataque em cima da grade, e numa levada
// sincopada (bumbo no "e", chimbal acentuado no "e") essa fase é o contratempo.
// Aqui a fase e a fase + meio período disputam pelo que marca o tempo de verdade:
// o bumbo e a caixa, cada um dividido pelo próprio máximo (um não pesa mais que o
// outro por ser mais alto) e somados. Fica a que tiver mais.
import { combScore, type OnsetBands } from './onsets';

/** Diferença relativa abaixo da qual tempo e contratempo ficam parecidos demais (risco de meio tempo). */
export const OFFBEAT_RISK_DIFF = 0.15;

function maxOf(o: Float32Array): number {
  let m = 0;
  for (let i = 0; i < o.length; i++) if (o[i] > m) m = o[i];
  return m;
}

// Bumbo + caixa em cima da grade na fase `phase`, cada banda dividida pelo próprio máximo.
function beatEvidence(b: OnsetBands, period: number, phase: number, kickMax: number, snareMax: number): number {
  let e = 0;
  if (b.hasKick && kickMax > 0) e += combScore(b.kick, period, phase) / kickMax;
  if (b.hasSnare && snareMax > 0) e += combScore(b.snare, period, phase) / snareMax;
  return e;
}

/**
 * @param b ataques por banda da faixa de pulso (ou a soma das faixas de pulso)
 * @param period período da grade, em quadros de `b`
 * @param phase fase achada pela busca, em quadros de `b`, em [0, period)
 * @returns a fase do tempo, em quadros, em [0, period), e se há risco de a grade
 *   estar no contratempo: tempo e contratempo com menos de 15% de diferença, ou
 *   faixa sem bumbo nem caixa (baixo em colcheias, shaker), em que a fase da busca fica.
 */
export function choosePhase(b: OnsetBands, period: number, phase: number): { phase: number; offbeatRisk: boolean } {
  if (!b.hasKick && !b.hasSnare) return { phase, offbeatRisk: true };
  const kickMax = maxOf(b.kick);
  const snareMax = maxOf(b.snare);
  const half = (phase + period / 2) % period;
  const onPhase = beatEvidence(b, period, phase, kickMax, snareMax);
  const onHalf = beatEvidence(b, period, half, kickMax, snareMax);
  const top = Math.max(onPhase, onHalf);
  const offbeatRisk = top <= 0 || Math.abs(onPhase - onHalf) / top < OFFBEAT_RISK_DIFF;
  return { phase: onHalf > onPhase ? half : phase, offbeatRisk };
}

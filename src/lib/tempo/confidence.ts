// Etapa de confiança: quanto a grade achada é pulso de verdade.
//
// M1: a regra de hoje (o quanto a melhor fase se destaca da média das fases
// nesse período). A M2 troca por uma medida contra controle e recalibra o corte.
import { combScore } from './onsets';

/**
 * Abaixo deste valor a música não tem pulso confiável e nada é gerado sozinho.
 * M1: 0,1, o corte de hoje no botão AUTO do Metrônomo (`MetronomeModal.tsx`,
 * `grid.confidence >= 0.1`) e no Separador.
 */
export const CONFIDENCE_CUT = 0.1;

/**
 * Confiança da grade, de 0 a 1.
 * @param o função de onset (banda cheia)
 * @param period período da grade, em quadros
 * @param phase fase da grade, em quadros
 */
export function measureConfidence(o: Float32Array, period: number, phase: number): number {
  const best = combScore(o, period, phase);
  let phaseMean = 0;
  let phaseCount = 0;
  for (let ph = 0; ph < period; ph += 1) {
    phaseMean += combScore(o, period, ph);
    phaseCount++;
  }
  phaseMean /= phaseCount || 1;
  return best > 0 ? Math.max(0, Math.min(1, (best - phaseMean) / best)) : 0;
}

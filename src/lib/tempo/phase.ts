// Etapa de tempo x contratempo: depois da busca de período e fase, decide se a
// fase achada é o tempo ou o contratempo (meio período depois).
//
// M1: devolve a fase recebida e nunca avisa risco (é o comportamento de hoje:
// vence a fase com mais energia de ataque em cima da grade). A M2 troca pela
// comparação de bumbo e caixa entre a fase e a fase + meio período.
import type { OnsetBands } from './onsets';

/**
 * @param b ataques por banda da faixa de pulso
 * @param period período da grade, em quadros de `b`
 * @param phase fase achada pela busca, em quadros de `b`
 * @returns a fase do tempo, em quadros, e se há risco de a grade estar no contratempo
 */
export function choosePhase(b: OnsetBands, period: number, phase: number): { phase: number; offbeatRisk: boolean } {
  void b; // M1: ainda sem as bandas do bumbo e da caixa (a M2 usa)
  void period;
  return { phase, offbeatRisk: false };
}

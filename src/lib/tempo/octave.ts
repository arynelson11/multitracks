// Etapa do andamento: tempo aproximado e escolha da oitava (60 x 120, 80 x 160).
//
// M1: a regra de hoje. Um candidato só (o tempo aproximado da autocorrelação,
// com preferência suave por andamentos perto de 110 BPM) e vence o de maior
// pontuação. A M4 troca por metade, inteiro e dobro, com o BPM da música como
// referência e o compasso composto.
import type { TimeSignatureType } from '../AudioAnalyzer';

/**
 * Tempo aproximado (BPM) por autocorrelação da função de onset, entre 55 e 200
 * BPM, com preferência suave por andamentos comuns (centro 110 BPM, 1 oitava de
 * desvio) pra decidir entre 60 e 120, 80 e 160 etc.
 */
export function roughTempo(o: Float32Array, fps: number): number {
  const minLag = Math.floor((fps * 60) / 200);
  const maxLag = Math.ceil((fps * 60) / 55);
  const n = o.length;
  let mean = 0;
  for (let i = 0; i < n; i++) mean += o[i];
  mean /= n || 1;
  let bestLag = Math.round((fps * 60) / 110);
  let best = -Infinity;
  for (let lag = minLag; lag <= maxLag; lag++) {
    let s = 0;
    for (let i = 0; i + lag < n; i++) s += (o[i] - mean) * (o[i + lag] - mean);
    s /= n - lag;
    const bpm = (fps * 60) / lag;
    // Preferência suave por andamentos comuns (centro 110 BPM, 1 oitava de desvio)
    // pra decidir entre 60 e 120, 80 e 160 etc. O usuário ainda tem 2× e ½×.
    const prior = Math.exp(-0.5 * (Math.log2(bpm / 110) / 1.0) ** 2);
    const score = s * prior;
    if (score > best) {
      best = score;
      bestLag = lag;
    }
  }
  return (fps * 60) / bestLag;
}

/**
 * Andamentos (BPM) a testar na busca fina, a partir do tempo aproximado (ou do
 * BPM de referência, quando vier). M1: só o próprio `rough`.
 */
export function tempoCandidates(rough: number, opts: { nearBpm?: number; signature?: TimeSignatureType }): number[] {
  void opts; // M1: sem metade, dobro nem compasso composto (a M4 usa)
  return [rough];
}

/**
 * Escolhe o andamento entre os candidatos já medidos. M1: o de maior pontuação
 * (no empate, o primeiro) e nenhuma alternativa.
 * @returns o BPM escolhido (como veio no candidato) e os outros pra oferecer
 */
export function pickTempo(cands: { bpm: number; score: number }[], opts: { nearBpm?: number }): { bpm: number; alternatives: number[] } {
  void opts; // M1: sem preferência pelo BPM da música (a M4 usa)
  if (!cands.length) throw new Error('pickTempo: nenhum candidato de andamento');
  let best = 0;
  for (let i = 1; i < cands.length; i++) if (cands[i].score > cands[best].score) best = i;
  return { bpm: cands[best].bpm, alternatives: [] };
}

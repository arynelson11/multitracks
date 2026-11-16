// Etapa do andamento: tempo aproximado, candidatos e a escolha do nível da grade.
//
// O tempo aproximado (autocorrelação com preferência por ~110 BPM) erra de três
// jeitos: a oitava (160 sai 80, uma balada de 64 sai 128), a proporção 3:2 ou 4:3
// (126 sai 84, 66 sai 88: a grade cai um tempo sim, um não) e o compasso composto
// (6/8 sai no pulso de semínima pontuada, ou na metade dele). Por isso a busca fina
// roda em vários candidatos em volta dele (metade, dobro, 2/3, 3/4, 4/3 e 3/2) e a
// escolha usa o que cada um mostra:
// - proporção: o tempo aproximado com ataque forte nos terços do tempo (1/3 e 2/3)
//   é uma grade 3:2 ou 4:3 da música; troca pelo parente sem ataque nos terços;
// - oitava: fica no candidato com bumbo no tempo e caixa um tempo depois (backbeat),
//   só com evidência clara (na bateria real a banda aguda é quase toda prato e
//   chimbal, então sem evidência fica o tempo aproximado);
// - o BPM da música (`preferBpm`), quando vem, escolhe o nível (pesa mais que a
//   evidência), e o BPM exato ainda sai da música;
// - compasso composto: o pulso de semínima pontuada vira colcheia (vezes 3).
// O `nearBpm` (BPM digitado no Separador) continua o refino rígido de ±0,8%: um
// candidato só, sem trocar de nível.
import { isCompound, type TimeSignature } from '../stageContracts';
import { combScore, type OnsetBands } from './onsets';

/** Proporções do tempo aproximado testadas na busca fina (o 1 primeiro). */
const RATIOS = [1, 1 / 2, 2, 2 / 3, 3 / 4, 4 / 3, 3 / 2] as const;
/** No compasso composto só a oitava: a proporção 3:2 do pulso é a colcheia (vira o triplo depois). */
const COMPOUND_RATIOS = [1, 1 / 2, 2] as const;
/** Dois candidatos são parentes (metade, 3:2...) com até isto de diferença na proporção (cada busca fina anda até 2,5%). */
const RELATION_TOLERANCE = 0.06;
/** Candidatos fora daqui não viram grade (é a faixa que a grade da música aceita). */
const MIN_CANDIDATE_BPM = 30;
const MAX_CANDIDATE_BPM = 300;
/** A evidência sozinha (sem o BPM da música) só escolhe nesta faixa. */
const MIN_AUTO_BPM = 40;
const MAX_AUTO_BPM = 240;
/** O BPM da música vale pro candidato a até 5% dele (BPM salvo inteiro, música com decimais). */
const PREFER_TOLERANCE = 0.05;
/** Ataque nos terços a partir disto (da energia no tempo): a grade é 3:2 ou 4:3 da música. */
const THIRDS_WRONG = 0.5;
/** Parente aceito na troca de proporção: terços abaixo disto (subdivisão binária limpa). */
const THIRDS_CLEAN = 0.25;
/** Na troca de proporção, o parente precisa de pelo menos isto da pontuação do aproximado. */
const RATIO_MIN_SCORE = 0.8;
/** Backbeat (bumbo x caixa, 0 a 1) que já conta como evidência clara de oitava. */
const BACKBEAT_STRONG = 0.4;
/** A oitava só troca se o backbeat do candidato for pelo menos isto vezes o do atual. */
const BACKBEAT_RATIO = 2;
/** Compasso composto: terços acima disto = o pulso é a semínima pontuada (a colcheia está nos terços). */
const THIRDS_COMPOUND = 0.25;
/** Colcheia plausível no 6/8 e no 12/8 (semínima pontuada de 30 a 80). */
const MIN_EIGHTH_BPM = 90;
const MAX_EIGHTH_BPM = 240;

/** Um andamento candidato depois da busca fina, com a evidência que decide o nível. */
export interface TempoCandidate {
  /** BPM achado na busca fina em volta do candidato. */
  bpm: number;
  /** Média da onset (banda cheia) em cima da grade: a pontuação da busca fina. */
  score: number;
  /**
   * Bumbo no tempo, de 0 a 1: num ciclo de 2 tempos, quanto o bumbo fica num tempo
   * e não no outro (1 = só no 1 e no 3). Zero sem bumbo.
   */
  kickOnBeat: number;
  /**
   * Caixa no contratempo do compasso (o 2 e o 4, um tempo depois do bumbo), de 0 a 1,
   * no mesmo ciclo de 2 tempos. Zero sem caixa ou com a caixa junto do bumbo.
   */
  snareOffBeat: number;
  /**
   * Ataque nos terços do tempo (1/3 e 2/3 do período) dividido pelo ataque no tempo,
   * na banda cheia. Perto de 1: a grade é 3:2 ou 4:3 da música (os terços caem em
   * tempos de verdade). Num 6/8 em semínima pontuada, os terços são as colcheias.
   */
  thirds: number;
}

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
    const score = s * tempoPrior(bpm);
    if (score > best) {
      best = score;
      bestLag = lag;
    }
  }
  return (fps * 60) / bestLag;
}

/** Preferência suave por andamentos comuns: centro 110 BPM, 1 oitava de desvio. */
function tempoPrior(bpm: number): number {
  return Math.exp(-0.5 * (Math.log2(bpm / 110) / 1.0) ** 2);
}

const logDistance = (a: number, b: number) => Math.abs(Math.log2(a / b));

/**
 * Andamentos (BPM) a testar na busca fina, o tempo aproximado primeiro.
 * - Com `nearBpm`: só ele (refino rígido do Separador).
 * - Sem: o aproximado, a metade, o dobro e as proporções 2/3, 3/4, 4/3 e 3/2,
 *   só os que ficam entre 30 e 300 BPM. No compasso composto (6/8, 12/8), só a
 *   metade e o dobro: lá o ataque nos terços é a colcheia, não uma grade errada.
 * - Com `preferBpm` longe (mais de 5%) de todos eles, ele entra no fim.
 */
export function tempoCandidates(rough: number, opts: { nearBpm?: number; preferBpm?: number; signature?: TimeSignature }): number[] {
  if (opts.nearBpm && opts.nearBpm > 0) return [opts.nearBpm];
  const ratios = opts.signature && isCompound(opts.signature) ? COMPOUND_RATIOS : RATIOS;
  const out = ratios.map(r => rough * r).filter((bpm, i) => i === 0 || (bpm >= MIN_CANDIDATE_BPM && bpm <= MAX_CANDIDATE_BPM));
  const pref = opts.preferBpm;
  if (pref && pref > 0 && !out.some(bpm => logDistance(bpm, pref) <= Math.log2(1 + PREFER_TOLERANCE))) out.push(pref);
  return out;
}

function maxOf(o: Float32Array): number {
  let m = 0;
  for (let i = 0; i < o.length; i++) if (o[i] > m) m = o[i];
  return m;
}

// Contraste entre os dois tempos de um ciclo de 2 tempos: 1 quando só `on` tem ataque.
const contrast = (on: number, off: number) => (on > off && on + off > 0 ? (on - off) / (on + off) : 0);

/**
 * Evidência de um candidato já ajustado (período e fase do tempo, em quadros de `b`).
 * `kickOnBeat` e `snareOffBeat` vêm do ciclo de 2 tempos que melhor põe o bumbo num
 * tempo e a caixa no outro; `thirds` sai da banda cheia.
 */
export function candidateEvidence(b: OnsetBands, period: number, phase: number): Omit<TempoCandidate, 'bpm' | 'score'> {
  if (!(period > 0)) return { kickOnBeat: 0, snareOffBeat: 0, thirds: 0 };
  const onBeat = combScore(b.full, period, phase);
  const thirds = onBeat > 0
    ? (combScore(b.full, period, (phase + period / 3) % period) + combScore(b.full, period, (phase + (2 * period) / 3) % period)) / 2 / onBeat
    : 0;
  const kickMax = b.hasKick ? maxOf(b.kick) : 0;
  const snareMax = b.hasSnare ? maxOf(b.snare) : 0;
  const at = (o: Float32Array, max: number, j: number) => (max > 0 ? combScore(o, 2 * period, (phase + j * period) % (2 * period)) / max : 0);
  const k = [at(b.kick, kickMax, 0), at(b.kick, kickMax, 1)];
  const s = [at(b.snare, snareMax, 0), at(b.snare, snareMax, 1)];
  // O bumbo no tempo j e a caixa no outro: fica o j em que os dois concordam mais.
  const j = k[0] - k[1] + s[1] - s[0] >= k[1] - k[0] + s[0] - s[1] ? 0 : 1;
  return { kickOnBeat: contrast(k[j], k[1 - j]), snareOffBeat: contrast(s[1 - j], s[j]), thirds };
}

const backbeat = (c: TempoCandidate) => c.kickOnBeat * c.snareOffBeat;
const sameBpm = (a: number, b: number, tol = RELATION_TOLERANCE) => logDistance(a, b) <= Math.log2(1 + tol);
const inAutoRange = (c: TempoCandidate) => c.bpm >= MIN_AUTO_BPM && c.bpm <= MAX_AUTO_BPM;

// Troca de proporção: o tempo aproximado com ataque forte nos terços é uma grade 3:2
// ou 4:3 da música; fica o parente (2/3, 3/4, 4/3 ou 3/2) sem ataque nos terços, com
// pontuação parecida, e entre os dois da mesma família o de pontuação vezes a
// preferência por andamentos comuns.
function fixRatio(base: TempoCandidate, cands: readonly TempoCandidate[]): TempoCandidate {
  if (base.thirds < THIRDS_WRONG) return base;
  let best: TempoCandidate | null = null;
  let bestValue = -Infinity;
  for (const c of cands) {
    const r = c.bpm / base.bpm;
    const related = [2 / 3, 3 / 4, 4 / 3, 3 / 2].some(x => sameBpm(r, x));
    if (!related || !inAutoRange(c) || c.thirds >= THIRDS_CLEAN || c.score < RATIO_MIN_SCORE * base.score) continue;
    const value = c.score * tempoPrior(c.bpm);
    if (value > bestValue) {
      bestValue = value;
      best = c;
    }
  }
  return best ?? base;
}

// Troca de oitava: o dobro ou a metade com backbeat claro e bem maior que o do atual.
function fixOctave(base: TempoCandidate, cands: readonly TempoCandidate[]): TempoCandidate {
  let best = base;
  for (const c of cands) {
    if (!(sameBpm(c.bpm, base.bpm * 2) || sameBpm(c.bpm, base.bpm / 2)) || !inAutoRange(c)) continue;
    const bb = backbeat(c);
    if (bb >= BACKBEAT_STRONG && bb >= BACKBEAT_RATIO * backbeat(base) && bb > backbeat(best)) best = c;
  }
  return best;
}

const round2 = (x: number) => Math.round(x * 100) / 100;

/** Metade e dobro do BPM (o que oferecer ao lado do escolhido), com 2 casas. */
export function halfAndDouble(bpm: number): number[] {
  return [round2(bpm / 2), round2(bpm * 2)];
}

/**
 * Escolhe o andamento entre os candidatos já medidos. O primeiro é o tempo
 * aproximado (1x); os outros, proporções dele em qualquer ordem.
 * - `nearBpm`: o candidato mais perto dele (o Separador passa só esse).
 * - `preferBpm`: o candidato mais perto dele, se algum está a até 5%.
 * - Senão a evidência: primeiro a proporção (terços), depois a oitava (backbeat).
 *   Sem evidência clara fica o tempo aproximado.
 * @returns o BPM escolhido (como veio no candidato) e a metade e o dobro dele
 */
export function pickTempo(cands: readonly TempoCandidate[], opts: { nearBpm?: number; preferBpm?: number }): { bpm: number; alternatives: number[] } {
  if (!cands.length) throw new Error('pickTempo: nenhum candidato de andamento');
  const ref = opts.nearBpm && opts.nearBpm > 0 ? opts.nearBpm : opts.preferBpm && opts.preferBpm > 0 ? opts.preferBpm : null;
  if (ref !== null) {
    let near = cands[0];
    for (const c of cands) if (logDistance(c.bpm, ref) < logDistance(near.bpm, ref)) near = c;
    if (opts.nearBpm || logDistance(near.bpm, ref) <= Math.log2(1 + PREFER_TOLERANCE)) return { bpm: near.bpm, alternatives: halfAndDouble(near.bpm) };
  }
  const chosen = fixOctave(fixRatio(cands[0], cands), cands);
  return { bpm: chosen.bpm, alternatives: halfAndDouble(chosen.bpm) };
}

/**
 * Compasso composto (6/8, 12/8): a grade da música é em colcheia. Se o pulso
 * escolhido tem ataque nos terços (é a semínima pontuada ou a metade dela), a
 * colcheia é 3 vezes ele; senão ele já é a colcheia. Depois o nível vai pra faixa
 * plausível da colcheia (90 a 240) e, com o BPM da música, pro nível mais perto
 * dele lido como colcheia, semínima (metade) ou semínima pontuada (um terço).
 * Compasso simples (ou sem compasso): o pulso como veio.
 * @returns o BPM da colcheia (ou o do pulso, no compasso simples)
 */
export function compoundPulseBpm(pulse: { bpm: number; thirds: number }, signature: TimeSignature | undefined, preferBpm?: number): number {
  if (!signature || !isCompound(signature)) return pulse.bpm;
  let eighth = pulse.thirds >= THIRDS_COMPOUND ? pulse.bpm * 3 : pulse.bpm;
  while (eighth > MAX_EIGHTH_BPM) eighth /= 2;
  while (eighth < MIN_EIGHTH_BPM) eighth *= 2;
  if (preferBpm && preferBpm > 0) {
    const fit = (e: number) => Math.min(logDistance(e, preferBpm), logDistance(e / 2, preferBpm), logDistance(e / 3, preferBpm));
    let best = eighth;
    for (const e of [eighth / 2, eighth * 2]) if (fit(e) < fit(best)) best = e;
    eighth = best;
  }
  return eighth;
}

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
// - o BPM da música (`preferBpm`), quando vem, só escolhe entre candidatos tirados do
//   áudio: decide a oitava; na proporção 3:2 só desempata quando os terços são
//   ambíguos. Se nenhum candidato admitido bate com ele (5%), vale a evidência e o
//   resultado avisa (`preferConflict`);
// - compasso composto: o pulso de semínima pontuada vira colcheia (vezes 3).
// Tudo aqui é em BPM do pulso (a colcheia no composto); a conversão pra semínima
// (o BPM que se mostra e salva) é do beatGrid, pela conversão única dos contratos.
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
/**
 * Ataque nos terços a partir disto (da energia no tempo): a grade é 3:2 ou 4:3 da
 * música e a evidência troca sozinha. Nas 45 multitracks do dono (gabarito pelo
 * click), o aproximado nas grades 3:2 e 4:3 deu de 0,68 a 0,99, menos a Fé (6/8 sem
 * compasso pedido, metade da semínima pontuada), com 0,34; as certas e as de oitava,
 * no máximo 0,32. Entre `THIRDS_CLEAN` e este valor é ambíguo: só o BPM da música
 * desempata.
 */
const THIRDS_WRONG = 0.5;
/**
 * Terços abaixo disto: subdivisão binária limpa. O aproximado limpo recusa qualquer
 * troca de proporção (nem o BPM da música derruba); o parente precisa ser limpo pra
 * entrar numa troca. Nas 5 trocas reais, os parentes certos deram de 0,02 a 0,17.
 */
const THIRDS_CLEAN = 0.25;
/** Na troca de proporção pela evidência, o parente precisa de pelo menos isto da pontuação do aproximado. */
const RATIO_MIN_SCORE = 0.8;
/** No desempate pelo BPM da música (terços ambíguos), o parente precisa de pelo menos isto (Fé real: 77%). */
const PREFER_RATIO_MIN_SCORE = 0.6;
/**
 * Backbeat (bumbo x caixa, 0 a 1) que já conta como evidência clara de oitava. Nos
 * sintéticos o nível certo dá de 0,55 a 0,58 e os outros, no máximo 0,35 (o dobro do
 * one drop). Nas multitracks reais, a metade e o dobro do aproximado (os únicos que a
 * oitava pode escolher) ficam em até 0,343, e o próprio aproximado chega a 0,406 (a
 * simeão, no nível 2/3, que não é alvo da troca): a banda aguda da bateria real é
 * quase toda prato, e a evidência não troca a oitava de música real.
 */
const BACKBEAT_STRONG = 0.45;
/** A oitava só troca se o backbeat do candidato for pelo menos isto vezes o do atual. */
const BACKBEAT_RATIO = 2;
/**
 * Compasso composto: terços acima disto = o pulso é a semínima pontuada, ou a metade
 * dela (a colcheia está nos terços). Medido: semínima pontuada e metade de 0,26 a 0,68
 * (sintético 6/8 e os três 6/8 reais), pulso já em colcheia até 0,14.
 */
const THIRDS_COMPOUND = 0.2;
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

const withinPrefer = (bpm: number, prefer: number) => logDistance(bpm, prefer) <= Math.log2(1 + PREFER_TOLERANCE);

function nearestTo<T>(items: readonly T[], target: number, bpmOf: (x: T) => number): T {
  let best = items[0];
  for (const x of items) if (logDistance(bpmOf(x), target) < logDistance(bpmOf(best), target)) best = x;
  return best;
}

/**
 * Andamentos (BPM do pulso) a testar na busca fina, o tempo aproximado primeiro.
 * Só saem do áudio: o BPM da música nunca entra como candidato.
 * - Com `nearBpm`: só ele (refino rígido do Separador).
 * - Sem: o aproximado, a metade, o dobro e as proporções 2/3, 3/4, 4/3 e 3/2,
 *   só os que ficam entre 30 e 300 BPM. No compasso composto (6/8, 12/8), só a
 *   metade e o dobro: lá o ataque nos terços é a colcheia, não uma grade errada.
 */
export function tempoCandidates(rough: number, opts: { nearBpm?: number; signature?: TimeSignature }): number[] {
  if (opts.nearBpm && opts.nearBpm > 0) return [opts.nearBpm];
  const ratios = opts.signature && isCompound(opts.signature) ? COMPOUND_RATIOS : RATIOS;
  return ratios.map(r => rough * r).filter((bpm, i) => i === 0 || (bpm >= MIN_CANDIDATE_BPM && bpm <= MAX_CANDIDATE_BPM));
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

const isRatioRelative = (c: TempoCandidate, base: TempoCandidate) => [2 / 3, 3 / 4, 4 / 3, 3 / 2].some(x => sameBpm(c.bpm / base.bpm, x));
const isOctaveRelative = (c: TempoCandidate, base: TempoCandidate) => sameBpm(c.bpm, base.bpm * 2) || sameBpm(c.bpm, base.bpm / 2);

// Proporção (a evidência manda):
// - aproximado com ataque forte nos terços: é uma grade 3:2 ou 4:3 da música e troca
//   pelo parente (2/3, 3/4, 4/3 ou 3/2) sem ataque nos terços, com pontuação parecida;
//   entre os dois da mesma família, o de pontuação vezes a preferência por andamentos
//   comuns (a oitava fica pra depois);
// - aproximado limpo: nenhuma troca, nem pedida pelo BPM da música;
// - no meio (ambíguo): só o BPM da música desempata, pelo parente limpo perto dele.
function fixRatio(base: TempoCandidate, cands: readonly TempoCandidate[], prefer: number | null): TempoCandidate {
  if (base.thirds >= THIRDS_WRONG) {
    let best: TempoCandidate | null = null;
    let bestValue = -Infinity;
    for (const c of cands) {
      if (!isRatioRelative(c, base) || !inAutoRange(c) || c.thirds >= THIRDS_CLEAN || c.score < RATIO_MIN_SCORE * base.score) continue;
      const value = c.score * tempoPrior(c.bpm);
      if (value > bestValue) {
        bestValue = value;
        best = c;
      }
    }
    return best ?? base;
  }
  if (base.thirds < THIRDS_CLEAN || prefer === null) return base;
  const clean = cands.filter(c => isRatioRelative(c, base) && c.thirds < THIRDS_CLEAN && c.score >= PREFER_RATIO_MIN_SCORE * base.score);
  if (!clean.length) return base;
  const near = nearestTo(clean, prefer, c => c.bpm);
  return withinPrefer(near.bpm, prefer) ? near : base;
}

// Troca de oitava: o dobro ou a metade com backbeat claro e bem maior que o do atual.
function fixOctave(base: TempoCandidate, cands: readonly TempoCandidate[]): TempoCandidate {
  let best = base;
  for (const c of cands) {
    if (!isOctaveRelative(c, base) || !inAutoRange(c)) continue;
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
 * Escolhe o andamento entre os candidatos já medidos (tudo em BPM do pulso). O
 * primeiro é o tempo aproximado (1x); os outros, proporções dele em qualquer ordem.
 * - `nearBpm`: o candidato mais perto dele (o Separador passa só esse).
 * - Senão, primeiro a proporção (terços; o `preferBpm` só desempata terços ambíguos),
 *   depois a oitava: com `preferBpm`, o candidato da oitava (o escolhido, a metade ou
 *   o dobro) a até 5% dele; sem, ou se nenhum bate, o backbeat. Sem evidência clara
 *   fica o tempo aproximado.
 * @returns o BPM escolhido (como veio no candidato), a metade e o dobro dele e
 *   `preferConflict`: veio `preferBpm` e nenhum candidato admitido ficou a até 5% dele
 *   (o BPM salvo não bate com o áudio; vale o do áudio)
 */
export function pickTempo(
  cands: readonly TempoCandidate[],
  opts: { nearBpm?: number; preferBpm?: number },
): { bpm: number; alternatives: number[]; preferConflict: boolean } {
  if (!cands.length) throw new Error('pickTempo: nenhum candidato de andamento');
  const result = (c: TempoCandidate, preferConflict: boolean) => ({ bpm: c.bpm, alternatives: halfAndDouble(c.bpm), preferConflict });
  if (opts.nearBpm && opts.nearBpm > 0) return result(nearestTo(cands, opts.nearBpm, c => c.bpm), false);
  const prefer = opts.preferBpm && opts.preferBpm > 0 ? opts.preferBpm : null;
  const base = fixRatio(cands[0], cands, prefer);
  if (prefer === null) return result(fixOctave(base, cands), false);
  const octave = nearestTo(cands.filter(c => c === base || isOctaveRelative(c, base)), prefer, c => c.bpm);
  return withinPrefer(octave.bpm, prefer) ? result(octave, false) : result(fixOctave(base, cands), true);
}

/**
 * Compasso composto (6/8, 12/8): a grade da música é em colcheia. Se o pulso
 * escolhido tem ataque nos terços (é a semínima pontuada ou a metade dela), a
 * colcheia é 3 vezes ele; senão ele já é a colcheia. Depois o nível vai pra faixa
 * plausível da colcheia (90 a 240) e, com o BPM salvo, pra oitava a até 5% dele.
 * Compasso simples (ou sem compasso): o pulso como veio (lá o BPM salvo já entrou
 * na escolha do pulso).
 * @param preferPulseBpm o BPM salvo já convertido pro pulso (a colcheia no composto)
 * @returns o BPM do pulso (a colcheia no composto) e `preferConflict`: veio BPM salvo
 *   e nenhuma oitava da colcheia ficou a até 5% dele (vale a colcheia do áudio)
 */
export function compoundPulseBpm(
  pulse: { bpm: number; thirds: number },
  signature: TimeSignature | undefined,
  preferPulseBpm?: number,
): { bpm: number; preferConflict: boolean } {
  if (!signature || !isCompound(signature)) return { bpm: pulse.bpm, preferConflict: false };
  let eighth = pulse.thirds >= THIRDS_COMPOUND ? pulse.bpm * 3 : pulse.bpm;
  while (eighth > MAX_EIGHTH_BPM) eighth /= 2;
  while (eighth < MIN_EIGHTH_BPM) eighth *= 2;
  if (!preferPulseBpm || !(preferPulseBpm > 0)) return { bpm: eighth, preferConflict: false };
  const level = nearestTo([eighth, eighth / 2, eighth * 2], preferPulseBpm, e => e);
  return withinPrefer(level, preferPulseBpm) ? { bpm: level, preferConflict: false } : { bpm: eighth, preferConflict: true };
}

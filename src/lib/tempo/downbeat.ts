// Etapa do "1": qual tempo da grade abre o compasso.
//
// M3 (recomendação 4 do relatório do metrônomo automático). Cada faixa dá o seu
// perfil do compasso: a média da onset em cada tempo, dividida pela média dos
// tempos (perfil plano = 1 em todos). O "1" é o tempo com a maior soma dos
// desvios (perfil - 1), com estes pesos:
// - voto principal: a nota do baixo (peso 1) e a troca de acorde das faixas de
//   harmonia (peso 1, dividido entre elas), que caem no 1;
// - depois o bumbo da faixa de pulso (peso 1), na banda abaixo de ~100 Hz com 2
//   polos, onde a caixa vaza bem menos que na banda grave de 150 Hz de antes.
// O voto principal pesa mais (até 2 contra 1), mas não manda sozinho: nas
// multitracks reais o bumbo no 1 às vezes é muito mais claro que um baixo
// sincopado, e a soma acerta onde a ordem rígida (o bumbo só no empate) errava.
// Sem baixo nem harmonia, bumbo empatado (no 1 e no 3, ou em todo tempo) desempata
// por onde a bateria começa; com eles, não: uma virada antes da entrada não puxa
// mais o 1 pro 3 ou pro 4.
import { ONSET_LAG_FRAMES, sampleAt, type OnsetBands } from './onsets';

/** Faixas que votam no "1" além da faixa de pulso. */
export interface DownbeatVotes {
  bass?: OnsetBands;
  harmony?: OnsetBands[];
}

/**
 * Sem voto do baixo e da harmonia, tempos com o bumbo a até 25% do mais forte
 * empatam. A caixa ainda vaza um pouco na banda de 100 Hz: com bumbo em todo tempo
 * (sintético do relatório), o 1 e o 3 ficam 20% abaixo do 2 e do 4.
 */
const KICK_TIE = 0.25;

/**
 * O pico do bumbo na onset é estreito (energia linear, suavizada só em ~7 ms):
 * alguns ms de erro da grade ou do baterista tiram a amostra do pico. Vale o maior
 * valor a até 15 ms do tempo.
 */
const KICK_WINDOW_S = 0.015;

// Quadro da onset do tempo `k` da grade. O 1º tempo pode cair antes do atraso da
// onset (golpe em 0,000): aí vale o quadro 0, onde está o ataque.
function beatFrame(firstBeat: number, period: number, k: number, fps: number): number {
  return Math.max(0, (firstBeat + k * period) * fps - ONSET_LAG_FRAMES);
}

// Valor da onset no quadro `x`, ou o maior a até `win` quadros dele.
function valueNear(o: Float32Array, x: number, win: number): number {
  let v = sampleAt(o, x);
  for (let d = 1; d <= win; d++) v = Math.max(v, sampleAt(o, x + d), sampleAt(o, Math.max(0, x - d)));
  return v;
}

/**
 * Média da onset `o` em cada tempo do compasso (0..beatsPerBar-1), dividida pela
 * média dos tempos. `win`: quadros de folga em volta de cada tempo (ver
 * KICK_WINDOW_S). `null` quando a faixa não tem ataque nenhum em cima da grade.
 */
function barProfile(o: Float32Array, fps: number, period: number, firstBeat: number, beatsPerBar: number, win = 0): number[] | null {
  const sums: number[] = new Array(beatsPerBar).fill(0);
  const counts: number[] = new Array(beatsPerBar).fill(0);
  for (let k = 0; ; k++) {
    const x = beatFrame(firstBeat, period, k, fps);
    if (x > o.length - 1) break;
    sums[k % beatsPerBar] += valueNear(o, x, win);
    counts[k % beatsPerBar]++;
  }
  const means = sums.map((s, m) => (counts[m] ? s / counts[m] : 0));
  const avg = means.reduce((a, v) => a + v, 0) / beatsPerBar;
  return avg > 0 ? means.map(v => v / avg) : null;
}

// Soma `weight * (perfil - 1)` em `score`.
function addDeviation(score: number[], profile: readonly number[], weight: number): void {
  for (let m = 0; m < score.length; m++) score[m] += weight * (profile[m] - 1);
}

// O primeiro tempo com o maior valor de `score` entre `cands`.
function best(score: readonly number[], cands: readonly number[]): number {
  return cands.reduce((a, m) => (score[m] > score[a] ? m : a), cands[0]);
}

// Tempo (contado da grade) em que a bateria começa: o 1º com ataque acima de 30%
// dos golpes fortes (o 90º percentil). -1 sem nenhum.
function startBeat(o: Float32Array, fps: number, period: number, firstBeat: number): number {
  const onsets: number[] = [];
  for (let k = 0; ; k++) {
    const x = beatFrame(firstBeat, period, k, fps);
    if (x > o.length - 1) break;
    onsets.push(sampleAt(o, x));
  }
  if (!onsets.length) return -1;
  const sorted = [...onsets].sort((x, y) => x - y);
  const strong = sorted[Math.floor(sorted.length * 0.9)] * 0.3;
  return onsets.findIndex(v => v > strong);
}

/**
 * @param b ataques por banda da faixa de pulso
 * @param period período da grade, em SEGUNDOS
 * @param firstBeat primeiro tempo da grade, em segundos, em [0, period)
 * @param beatsPerBar tempos por compasso (>= 1)
 * @param votes baixo e harmonia: o voto principal do "1"
 * @returns qual tempo, contado a partir de `firstBeat` (0..beatsPerBar-1), é o "1"
 */
export function chooseDownbeat(b: OnsetBands, period: number, firstBeat: number, beatsPerBar: number, votes?: DownbeatVotes): number {
  // Grade inválida: o laço dos tempos não andaria (período 0) ou não terminaria (NaN).
  if (beatsPerBar <= 1 || !(period > 0) || !Number.isFinite(firstBeat)) return 0;
  const profileOf = (t: OnsetBands, o: Float32Array, win = 0) => barProfile(o, t.fps, period, firstBeat, beatsPerBar, win);
  const all = Array.from({ length: beatsPerBar }, (_, m) => m);
  const score: number[] = new Array(beatsPerBar).fill(0);

  // Voto principal: o baixo pesa 1 e as faixas de harmonia dividem 1 entre si.
  let voted = false;
  const bass = votes?.bass ? profileOf(votes.bass, votes.bass.full) : null;
  if (bass) {
    addDeviation(score, bass, 1);
    voted = true;
  }
  const harmony = (votes?.harmony ?? []).map(h => profileOf(h, h.full)).filter((p): p is number[] => p !== null);
  for (const p of harmony) addDeviation(score, p, 1 / harmony.length);
  voted ||= harmony.length > 0;

  // Bumbo: a banda de 100 Hz; faixa de pulso sem bumbo usa a grave de 150 Hz.
  const kick = profileOf(b, b.hasKick ? b.kick : b.low, Math.round(KICK_WINDOW_S * b.fps));
  if (kick) addDeviation(score, kick, 1);
  if (voted || !kick) return best(score, all);

  // Só o bumbo: os empatados com o mais forte desempatam por onde a bateria começa.
  const top = Math.max(...kick);
  const tied = all.filter(m => kick[m] >= top * (1 - KICK_TIE));
  const start = tied.length > 1 ? startBeat(b.full, b.fps, period, firstBeat) : -1;
  return start >= 0 && tied.includes(start % beatsPerBar) ? start % beatsPerBar : best(score, tied);
}

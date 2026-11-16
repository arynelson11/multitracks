// Etapa do "1": qual tempo da grade abre o compasso.
//
// M3 (recomendação 4 do relatório do metrônomo automático). Cada faixa dá o seu
// perfil do compasso: a média da onset em cada tempo, dividida pela média dos
// tempos (perfil plano = 1 em todos). O "1" é o tempo com a maior soma dos
// desvios (perfil - 1), cada perfil com um peso:
// - voto principal: a nota do baixo (peso 1) e a troca de acorde das faixas de
//   harmonia (peso 1, dividido entre elas), que caem no 1. Os dois são lidos no
//   ponto do tempo, como o bumbo (ataque rápido de teclado, piano e violão fica
//   inteiro). A harmonia também é lida numa janela depois do tempo
//   (`HARMONY_WINDOW_S`) e só vota quando as duas leituras apontam o mesmo tempo:
//   o acorde de pad, que sobe devagar, lido no ponto aponta outro tempo e não vota
//   contra o 1. Só vota o perfil que se destaca (`MIN_VOTE_SPREAD`);
// - depois o bumbo da faixa de pulso (peso 1), na banda abaixo de ~100 Hz com 2
//   polos, onde a caixa vaza bem menos que na banda grave de 150 Hz de antes.
// Os pesos multiplicam o desvio, e o desvio é do tamanho do destaque: bumbo só num
// tempo chega a +3 no 4/4 (tempos por compasso - 1), um baixo que só se destaca um
// pouco no 1 dá +0,2 ou +0,3. Então o voto principal pesa mais quando os três se
// destacam parecido, mas um bumbo muito claro vence um voto fraco. Nas multitracks
// reais é isso que acerta onde a ordem rígida (o bumbo só no empate) errava; o
// outro lado é que um bumbo só no 3 vence baixo e harmonia moderados no 1.
// Sem voto do baixo nem da harmonia, bumbo empatado (no 1 e no 3, ou em todo
// tempo) desempata por onde a bateria começa, em qualquer compasso; com voto, não:
// uma virada antes da entrada não puxa mais o 1 pro 3 ou pro 4. Com baixo ou
// harmonia presentes que não votam (não marcam o compasso), o bumbo que lidera com
// folga (`KICK_LEAD`) vale antes desse desempate.
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

/**
 * A troca de acorde de um pad (ataque de ~250 ms) só sobe de 10 a 100 ms depois do
 * tempo. Lido no ponto, o acorde do pad do catálogo aponta outro tempo (o 1 fica
 * no vale do acorde anterior saindo). A harmonia é lida também no maior valor até
 * 50 ms depois do ponto e só vota quando as duas leituras concordam no tempo mais
 * forte, com folga na janela (`HARMONY_WINDOW_LEAD`) (Ruling M3-consistencia); aí
 * vale a do ponto, que não achata ataque rápido. Faixa sem nada no ponto (só
 * ataque lento) vale a da janela. Medido na rodada 2 da M3: de 30 a 60 ms dá o
 * mesmo nas multitracks reais; com 80 ms ou mais a janela achata o teclado de uma
 * música com acento e ela perde o 1.
 */
const HARMONY_WINDOW_S = 0.05;

/**
 * Na janela, o tempo mais forte precisa ficar 0,15 acima do segundo (o perfil tem
 * média 1). Sem folga, o pad do catálogo concordava por acaso (0,02 a 0,06 de
 * diferença na janela) e votava no tempo errado; o teclado real que vota certo fica
 * com 0,16 ou mais. De 0,05 a 0,15 dá o mesmo nas reais; 0,15 também segura o pad
 * que troca a cada 2 compassos.
 */
const HARMONY_WINDOW_LEAD = 0.15;

/**
 * Só vota o perfil cujo tempo mais forte fica mais de 20% acima da média (Ruling
 * M3-voto): pad sustentado e faixa quase muda têm perfil plano (drone: até 0,19), e
 * o perfil é dividido pela própria média, então sem esse piso eles pesariam como
 * um baixo nítido e desligariam o desempate por onde a bateria começa.
 */
const MIN_VOTE_SPREAD = 0.2;

/**
 * Com baixo ou harmonia presentes que não votam, o bumbo mais forte vale sozinho
 * quando fica pelo menos 10% acima do segundo, mesmo dentro do empate de 25%: o
 * começo da bateria nesses arranjos costuma ser virada ou anacruse (a música sem
 * projeto das multitracks reais: bumbo 1,21 no 1 contra 1,06 e 1,00, bateria
 * entrando no 2). Só com a bateria (sem outras faixas) fica o desempate de antes,
 * que nas reais acerta mais (com a regra, 2 músicas com acento erram).
 */
const KICK_LEAD = 0.1;

// Quadro da onset do tempo `k` da grade. O 1º tempo pode cair antes do atraso da
// onset (golpe em 0,000): aí vale o quadro 0, onde está o ataque.
function beatFrame(firstBeat: number, period: number, k: number, fps: number): number {
  return Math.max(0, (firstBeat + k * period) * fps - ONSET_LAG_FRAMES);
}

/** Quadros de folga em volta do ponto de cada tempo: antes e depois. */
interface ReadWindow {
  before: number;
  after: number;
}

const AT_POINT: ReadWindow = { before: 0, after: 0 };

// O maior valor da onset de `x - before` a `x + after` quadros.
function valueNear(o: Float32Array, x: number, w: ReadWindow): number {
  let v = sampleAt(o, x);
  for (let d = 1; d <= w.after; d++) v = Math.max(v, sampleAt(o, x + d));
  for (let d = 1; d <= w.before; d++) v = Math.max(v, sampleAt(o, Math.max(0, x - d)));
  return v;
}

/**
 * Média da onset `o` em cada tempo do compasso (0..beatsPerBar-1), dividida pela
 * média dos tempos. `w`: folga em volta de cada tempo (ver KICK_WINDOW_S e
 * HARMONY_WINDOW_S). `null` quando a faixa não tem ataque nenhum em cima da grade.
 */
function barProfile(o: Float32Array, fps: number, period: number, firstBeat: number, beatsPerBar: number, w: ReadWindow = AT_POINT): number[] | null {
  const sums: number[] = new Array(beatsPerBar).fill(0);
  const counts: number[] = new Array(beatsPerBar).fill(0);
  for (let k = 0; ; k++) {
    const x = beatFrame(firstBeat, period, k, fps);
    if (x > o.length - 1) break;
    sums[k % beatsPerBar] += valueNear(o, x, w);
    counts[k % beatsPerBar]++;
  }
  const means = sums.map((s, m) => (counts[m] ? s / counts[m] : 0));
  const avg = means.reduce((a, v) => a + v, 0) / beatsPerBar;
  return avg > 0 ? means.map(v => v / avg) : null;
}

// O perfil vota: o tempo mais forte fica mais de MIN_VOTE_SPREAD acima da média.
const isVote = (p: readonly number[] | null): p is number[] => p !== null && Math.max(...p) - 1 > MIN_VOTE_SPREAD;

const strongest = (p: readonly number[]) => p.indexOf(Math.max(...p));

// Quanto o tempo mais forte do perfil fica acima do segundo.
function leadOf(p: readonly number[]): number {
  const top = strongest(p);
  return p[top] - Math.max(...p.filter((_, m) => m !== top));
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
 * @param votes baixo e harmonia: o voto principal do "1" (só os perfis que se destacam)
 * @returns qual tempo, contado a partir de `firstBeat` (0..beatsPerBar-1), é o "1"
 */
export function chooseDownbeat(b: OnsetBands, period: number, firstBeat: number, beatsPerBar: number, votes?: DownbeatVotes): number {
  // Grade inválida: o laço dos tempos não andaria (período 0) ou não terminaria (NaN).
  if (beatsPerBar <= 1 || !(period > 0) || !Number.isFinite(firstBeat)) return 0;
  const profileOf = (t: OnsetBands, o: Float32Array, w: ReadWindow = AT_POINT) => barProfile(o, t.fps, period, firstBeat, beatsPerBar, w);
  const all = Array.from({ length: beatsPerBar }, (_, m) => m);
  const score: number[] = new Array(beatsPerBar).fill(0);

  // Harmonia: no ponto e na janela depois do tempo; vota a do ponto quando as duas
  // apontam o mesmo tempo, com folga na janela (a da janela, se não há nada no ponto).
  const harmonyReads = (votes?.harmony ?? []).map(h => ({
    atPoint: profileOf(h, h.full),
    after: profileOf(h, h.full, { before: 0, after: Math.round(HARMONY_WINDOW_S * h.fps) }),
  }));
  const harmonyVote = ({ atPoint, after }: { atPoint: number[] | null; after: number[] | null }) => {
    if (!atPoint) return after;
    if (!after || strongest(after) !== strongest(atPoint) || leadOf(after) < HARMONY_WINDOW_LEAD) return null;
    return atPoint;
  };

  // Voto principal: o baixo pesa 1 e as faixas de harmonia que votam dividem 1 entre si.
  const bassAtPoint = votes?.bass ? profileOf(votes.bass, votes.bass.full) : null;
  const bass = isVote(bassAtPoint) ? bassAtPoint : null;
  if (bass) addDeviation(score, bass, 1);
  const harmony = harmonyReads.map(harmonyVote).filter(isVote);
  for (const p of harmony) addDeviation(score, p, 1 / harmony.length);
  const voted = bass !== null || harmony.length > 0;
  // Baixo ou harmonia com som, votando ou não (faixa em silêncio é como faixa ausente).
  const hasOtherTracks = bassAtPoint !== null || harmonyReads.some(r => r.atPoint !== null || r.after !== null);

  // Bumbo: a banda de 100 Hz; faixa de pulso sem bumbo usa a grave de 150 Hz.
  const kickWin = Math.round(KICK_WINDOW_S * b.fps);
  const kick = profileOf(b, b.hasKick ? b.kick : b.low, { before: kickWin, after: kickWin });
  if (kick) addDeviation(score, kick, 1);
  if (voted || !kick) return best(score, all);

  // Só o bumbo: os empatados com o mais forte desempatam por onde a bateria começa;
  // com baixo ou harmonia presentes, antes vale o bumbo que lidera com folga.
  const top = Math.max(...kick);
  const tied = all.filter(m => kick[m] >= top * (1 - KICK_TIE));
  if (tied.length > 1 && hasOtherTracks) {
    const lead = strongest(kick);
    const second = Math.max(...all.filter(m => m !== lead).map(m => kick[m]));
    if (top >= second * (1 + KICK_LEAD)) return lead;
  }
  const start = tied.length > 1 ? startBeat(b.full, b.fps, period, firstBeat) : -1;
  return start >= 0 && tied.includes(start % beatsPerBar) ? start % beatsPerBar : best(score, tied);
}

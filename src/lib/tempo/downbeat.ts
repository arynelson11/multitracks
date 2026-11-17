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
//   (`HARMONY_WINDOW_S`): quando a janela sobe muito acima do ponto em algum tempo
//   (`SLOW_ATTACK_LIFT`), o ataque é lento (pad) e o ponto cai no vale antes da
//   subida; aí vale a janela, se ela aponta um tempo com folga, senão a faixa não
//   vota. Só vota o perfil que se destaca (`MIN_VOTE_SPREAD`). Sem baixo, harmonia
//   com cara de ataque lento lido no vale só vence o que a bateria sozinha decide
//   com margem clara (`SLOW_HARMONY_MARGIN`);
// - depois o bumbo da faixa de pulso (peso 1), na banda abaixo de ~100 Hz com 2
//   polos, onde a caixa vaza bem menos que na banda grave de 150 Hz de antes.
// Os pesos multiplicam o desvio, e o desvio é do tamanho do destaque: bumbo só num
// tempo chega a +3 no 4/4 (tempos por compasso - 1); um baixo que só se destaca um
// pouco no 1 (perfil 1,3, logo acima do piso de voto) soma +0,3. Então o voto
// principal pesa mais quando os três se destacam parecido, mas um bumbo muito claro
// vence um voto fraco. Nas multitracks reais é isso que acerta onde a ordem rígida
// (o bumbo só no empate) errava; o outro lado é que um bumbo só no 3 vence baixo e
// harmonia moderados no 1.
// Sem voto do baixo nem da harmonia, bumbo empatado (no 1 e no 3, ou em todo
// tempo) desempata por onde a bateria começa, em qualquer compasso; com voto, não:
// uma virada antes da entrada não puxa mais o 1 pro 3 ou pro 4. Com baixo ou
// harmonia presentes que não votam (não marcam o compasso), o bumbo claramente mais
// alto dentro do empate (`KICK_LEAD_DB`) vale antes desse desempate.
// `decideDownbeat` devolve também de onde veio o "1" e a folga da decisão, pra quem
// mostra o "1" poder marcar quando ele é incerto (`SongGridDetection.downbeatFrom`).
import { ONSET_LAG_FRAMES, sampleAt, type OnsetBands } from './onsets';

/** Faixas que votam no "1" além da faixa de pulso. */
export interface DownbeatVotes {
  bass?: OnsetBands;
  harmony?: OnsetBands[];
}

/**
 * De onde veio o "1":
 * - `baixo`: o baixo votou (com ou sem harmonia), somado ao bumbo;
 * - `harmonia`: só a harmonia votou (sem baixo), somada ao bumbo;
 * - `bumbo`: sem voto, o bumbo de um tempo ficou mais de 25% acima dos outros (ou,
 *   empatado, o mais forte quando o começo da bateria não está no empate, com folga 0);
 * - `bumbo-lidera`: sem voto, com baixo ou harmonia presentes que não votam, o bumbo
 *   ficou pelo menos 1,1 dB acima do segundo dentro do empate;
 * - `inicio-da-bateria`: sem voto, bumbo empatado desfeito por onde a bateria começa;
 * - `reserva`: nada pra medir (compasso de 1 tempo, grade inválida, sem bumbo nem
 *   voto); o "1" é o 0.
 */
export type DownbeatSource = 'baixo' | 'harmonia' | 'bumbo' | 'bumbo-lidera' | 'inicio-da-bateria' | 'reserva';

/** O "1" escolhido, de onde ele veio e a folga sobre o segundo tempo. */
export interface DownbeatChoice {
  downbeat: number;
  from: DownbeatSource;
  /**
   * Folga do tempo escolhido sobre o segundo, na conta que decidiu (perfis com média
   * 1: com voto, a soma dos desvios; sem voto, o perfil do bumbo). 0 quando o "1"
   * saiu de um empate do bumbo (desfeito por onde a bateria começa ou pelo mais forte
   * dele) ou da reserva.
   */
  margin: number;
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
 * no vale do acorde anterior saindo). Por isso a harmonia também é lida no maior
 * valor até 50 ms depois do ponto (Ruling M3-consistencia, rodada 2 da M3).
 */
const HARMONY_WINDOW_S = 0.05;

/**
 * Ataque lento: em algum tempo o perfil da janela fica mais de 0,5 acima do perfil
 * do ponto (os dois têm média 1). Medido na rodada 2 da M3: o pad do catálogo sobe
 * de 0,88 a 1,05; nas multitracks reais, na música inteira, as faixas de harmonia
 * ficam até 0,48 e continuam lidas no ponto, como no e80c789 (ataque rápido
 * inteiro); nos cortes e no nearBpm 10 leituras passam de 0,5 (até 0,83) e vão pra
 * janela sem mudar nenhum resultado. Drones sobem até 0,2.
 */
const SLOW_ATTACK_LIFT = 0.5;

/**
 * Faixa de ataque lento vota pela janela só quando, nela, o tempo mais forte fica
 * 0,15 acima do segundo: no disco sintético o pad do catálogo aponta o tempo errado
 * na janela com diferença menor que isso.
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
 * Com baixo ou harmonia presentes que não votam, o bumbo mais forte vale sozinho,
 * dentro do empate de 25%, quando fica pelo menos 1,1 dB acima do segundo (o perfil
 * do bumbo é de energia: 10^(1,1/10) = 1,288 vezes). Ruling M3-r3: um bumbo só 0,5 a
 * 1 dB mais alto num tempo (diferença de mixagem) não decide o "1"; medido no rock
 * sintético com o bumbo do 3 a +1 dB, o perfil fica de 0,57 a 0,99 dB acima. Acima
 * de 1,25 dB (fora do empate) o bumbo já decide sozinho como `bumbo`. Só com a
 * bateria (sem outras faixas) fica o desempate de antes.
 */
const KICK_LEAD_DB = 1.1;

/**
 * Cara de ataque lento lido cedo (Ruling M3-r3): na faixa de harmonia, o tempo em
 * que a janela mais sobe acima do ponto (mais de 0,15) é o mais baixo no ponto, e
 * ali o ponto fica abaixo de 0,6 da média. É o vale antes da subida do acorde: o
 * ponto aponta outro tempo. Nas multitracks reais nenhuma leitura com o vale abaixo
 * de 0,6 muda de resultado com a guarda; com 0,8, um teclado real de ataque rápido
 * (vale de 0,65 a 0,76) perderia o 1.
 */
const SLOW_LIFT_MIN = 0.15;
const SLOW_VALLEY_MAX = 0.6;

/**
 * Sem voto do baixo, harmonia com cara de ataque lento lido cedo só vence o que a
 * bateria sozinha decide com folga de 1,0 na soma (perfis com média 1); senão vale
 * a bateria. Medido nos sintéticos: com 0,5 o pad de 800 ms no disco ainda vence com
 * o tempo errado; de 1,0 pra cima o resultado é o mesmo.
 */
const SLOW_HARMONY_MARGIN = 1.0;

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

interface HarmonyRead {
  atPoint: number[] | null;
  after: number[] | null;
}

// Ataque lento lido cedo: o tempo onde a janela mais sobe (mais de SLOW_LIFT_MIN) é o
// mais baixo no ponto, abaixo de SLOW_VALLEY_MAX.
function looksSlowReadEarly({ atPoint, after }: HarmonyRead): boolean {
  if (!atPoint || !after) return false;
  const lift = after.map((v, m) => v - atPoint[m]);
  const valley = strongest(lift);
  const low = Math.min(...atPoint);
  return lift[valley] > SLOW_LIFT_MIN && atPoint[valley] === low && low < SLOW_VALLEY_MAX;
}

// Folga do tempo `m` sobre o melhor dos outros, em `score`.
const marginOf = (score: readonly number[], m: number) => score[m] - Math.max(...score.filter((_, i) => i !== m));

// Sem voto: o bumbo, e o empate desfeito por onde a bateria começa.
function drumsChoice(
  b: OnsetBands, period: number, firstBeat: number, beatsPerBar: number,
  kick: number[] | null, hasOtherTracks: boolean,
): DownbeatChoice {
  if (!kick) return { downbeat: 0, from: 'reserva', margin: 0 };
  const all = Array.from({ length: beatsPerBar }, (_, m) => m);
  const top = strongest(kick);
  const tied = all.filter(m => kick[m] >= kick[top] * (1 - KICK_TIE));
  if (tied.length === 1) return { downbeat: top, from: 'bumbo', margin: marginOf(kick, top) };
  // Com baixo ou harmonia presentes, antes vale o bumbo claramente mais alto.
  if (hasOtherTracks && kick[top] >= (kick[top] - marginOf(kick, top)) * 10 ** (KICK_LEAD_DB / 10)) {
    return { downbeat: top, from: 'bumbo-lidera', margin: marginOf(kick, top) };
  }
  const start = startBeat(b.full, b.fps, period, firstBeat);
  if (start >= 0 && tied.includes(start % beatsPerBar)) return { downbeat: start % beatsPerBar, from: 'inicio-da-bateria', margin: 0 };
  // O começo da bateria não está no empate: vale o bumbo mais forte dele, ainda empate.
  return { downbeat: best(kick, tied), from: 'bumbo', margin: 0 };
}

/**
 * O "1" do compasso, de onde ele veio e a folga da decisão (ver `DownbeatSource` e
 * `DownbeatChoice`).
 * @param b ataques por banda da faixa de pulso
 * @param period período da grade, em SEGUNDOS
 * @param firstBeat primeiro tempo da grade, em segundos, em [0, period)
 * @param beatsPerBar tempos por compasso (>= 1)
 * @param votes baixo e harmonia: o voto principal do "1" (só os perfis que se destacam)
 */
export function decideDownbeat(b: OnsetBands, period: number, firstBeat: number, beatsPerBar: number, votes?: DownbeatVotes): DownbeatChoice {
  // Grade inválida: o laço dos tempos não andaria (período 0) ou não terminaria (NaN).
  if (beatsPerBar <= 1 || !(period > 0) || !Number.isFinite(firstBeat)) return { downbeat: 0, from: 'reserva', margin: 0 };
  const profileOf = (t: OnsetBands, o: Float32Array, w: ReadWindow = AT_POINT) => barProfile(o, t.fps, period, firstBeat, beatsPerBar, w);
  const all = Array.from({ length: beatsPerBar }, (_, m) => m);
  const score: number[] = new Array(beatsPerBar).fill(0);

  // Harmonia: no ponto e na janela depois do tempo. Ataque rápido vota pelo ponto.
  // Ataque lento (a janela sobe mais de SLOW_ATTACK_LIFT acima do ponto) vota pela
  // janela só quando ela aponta um tempo com folga; sem nada no ponto, vale a janela
  // como está.
  const harmonyReads: HarmonyRead[] = (votes?.harmony ?? []).map(h => ({
    atPoint: profileOf(h, h.full),
    after: profileOf(h, h.full, { before: 0, after: Math.round(HARMONY_WINDOW_S * h.fps) }),
  }));
  const harmonyVote = ({ atPoint, after }: HarmonyRead) => {
    if (!atPoint) return after;
    if (!after || Math.max(...after.map((v, m) => v - atPoint[m])) <= SLOW_ATTACK_LIFT) return atPoint;
    return leadOf(after) >= HARMONY_WINDOW_LEAD ? after : null;
  };

  // Voto principal: o baixo pesa 1 e as faixas de harmonia que votam dividem 1 entre si.
  const bassAtPoint = votes?.bass ? profileOf(votes.bass, votes.bass.full) : null;
  const bass = isVote(bassAtPoint) ? bassAtPoint : null;
  if (bass) addDeviation(score, bass, 1);
  const voting = harmonyReads.map(read => ({ read, profile: harmonyVote(read) })).filter(v => isVote(v.profile));
  for (const { profile } of voting) if (profile) addDeviation(score, profile, 1 / voting.length);
  // Baixo ou harmonia com som, votando ou não (faixa em silêncio é como faixa ausente).
  const hasOtherTracks = bassAtPoint !== null || harmonyReads.some(r => r.atPoint !== null || r.after !== null);

  // Bumbo: a banda de 100 Hz; faixa de pulso sem bumbo usa a grave de 150 Hz.
  const kickWin = Math.round(KICK_WINDOW_S * b.fps);
  const kick = profileOf(b, b.hasKick ? b.kick : b.low, { before: kickWin, after: kickWin });
  if (!bass && !voting.length) return drumsChoice(b, period, firstBeat, beatsPerBar, kick, hasOtherTracks);
  if (kick) addDeviation(score, kick, 1);
  const downbeat = best(score, all);
  if (bass) return { downbeat, from: 'baixo', margin: marginOf(score, downbeat) };

  // Só a harmonia: com cara de ataque lento lido cedo, ela só vence o que a bateria
  // sozinha decide com margem clara.
  if (voting.some(v => looksSlowReadEarly(v.read))) {
    const drums = drumsChoice(b, period, firstBeat, beatsPerBar, kick, hasOtherTracks);
    if (drums.downbeat !== downbeat && score[downbeat] - score[drums.downbeat] < SLOW_HARMONY_MARGIN) return drums;
  }
  return { downbeat, from: 'harmonia', margin: marginOf(score, downbeat) };
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
  return decideDownbeat(b, period, firstBeat, beatsPerBar, votes).downbeat;
}

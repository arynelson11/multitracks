// Grade de tempo da música: BPM preciso + onde cai o primeiro tempo.
//
// Por que existe: o metrônomo do Separador era gerado com o 1º click colado em
// 0:00.000 do arquivo e com BPM inteiro digitado à mão. Música real quase nunca
// tem um tempo exatamente em 0:00, e meio BPM de erro vira ~0,75 s de atraso no
// fim de uma música de 3 min. Resultado: click "fora". Aqui a gente mede a grade
// direto do áudio (de preferência da bateria) pra o click nascer alinhado.
//
// Método: função de onset (subida de energia, comprimida em log) a ~200 quadros/s,
// tempo aproximado por autocorrelação e depois busca fina conjunta de período +
// fase maximizando a energia de onset que cai em cima da grade na música INTEIRA
// (é isso que mata a deriva), em vários candidatos em volta do tempo aproximado
// (metade, dobro, 3:2), e a etapa do andamento escolhe o nível. Bumbo e caixa decidem entre tempo e contratempo; a
// confiança compara a grade com a mesma busca em versões embaralhadas da música.
// O tempo forte (o "1") sai da banda grave (bumbo). Várias faixas de pulso (kit
// separado) entram somadas.
//
// Este arquivo é o orquestrador: cada etapa mora em src/lib/tempo/ (ataques por
// banda, andamento, tempo x contratempo, confiança e o "1") e pode ser trocada
// sozinha, com o teste de equivalência (beatGrid.equivalence.test.ts) segurando
// o que não mudou.
import { displayBpmFromPulseBpm, isCompound, isEighthPulse, pulseBpmFromDisplayBpm, pulsesPerBar, type TimeSignature } from './stageContracts';
import { measureConfidence } from './tempo/confidence';
import { decideDownbeat, type DownbeatSource, type DownbeatVotes } from './tempo/downbeat';
import { candidateEvidence, eighthPulseBpm, halfAndDouble, pickTempo, roughTempo, tempoCandidates, type TempoCandidate } from './tempo/octave';
import { combScore, ONSET_LAG_FRAMES, onsetBands, sumOnsetBands, type OnsetBands } from './tempo/onsets';
import { choosePhase } from './tempo/phase';

export interface BeatGrid {
  /**
   * BPM preciso em semínima (ex.: 119.87): o que mostrar e salvar (Ruling T3-BPM). Em
   * x/4 é o BPM da grade; em x/8 (`signature` com denominador 8 no `detectSongGrid`)
   * é a metade da colcheia (`pulseBpm`).
   */
  bpm: number;
  /** Segundos do primeiro pulso da grade, sempre em [0, 60/pulso) (o pulso é o `bpm` em x/4). */
  firstBeat: number;
  /** Qual pulso (contado a partir de firstBeat, 0..beatsPerBar-1) é o "1" do compasso. */
  downbeat: number;
  /** 0..1. Abaixo de ~0.15 a música não tem pulso claro (o click ainda sai no BPM pedido). */
  confidence: number;
}

export interface BeatGridOptions {
  /**
   * BPM de referência digitado (Separador), em semínima. Se vier, só refina em volta
   * dele (±0,8%, no pulso que ele dá pelo compasso), sem trocar de oitava nem de
   * proporção, e vence o `preferBpm`.
   */
  nearBpm?: number;
  /** Pulsos por compasso, pra achar o "1". Padrão: os pulsos do compasso (`signature`), senão 4. */
  beatsPerBar?: number;
  /**
   * BPM salvo da música, em semínima (referência suave). Nunca vira candidato: só
   * escolhe entre os candidatos do áudio (decide a oitava; na proporção 3:2 só
   * desempata terços ambíguos), e o BPM exato sai da música. Se nenhum candidato
   * admitido fica a até 5% dele, vale o áudio e `preferConflict` avisa.
   */
  preferBpm?: number;
}

/** Uma faixa da música entregue à análise, com o papel que ela tem na conta. */
export interface TempoTrack {
  id: string;
  /** Nome pra mostrar (ex.: "Bateria"). */
  label: string;
  /** `pulse` marca o tempo (bateria, percussão); `bass` e `harmony` votam no "1". */
  use: 'pulse' | 'bass' | 'harmony';
  channels: Float32Array[];
}

export interface SongGridDetection extends BeatGrid {
  /**
   * BPM do pulso da grade (os tiques do click): a colcheia em x/8 (Ruling M4-x8),
   * igual ao `bpm` em x/4. `firstBeat` e `downbeat` contam este pulso. Não é pra
   * mostrar nem salvar (isso é o `bpm`, pela conversão única dos contratos).
   */
  pulseBpm: number;
  /** A grade pode estar no contratempo (meio tempo fora): bumbo e caixa não decidem, ou não há nenhum dos dois. */
  offbeatRisk: boolean;
  /**
   * Veio `preferBpm` e nenhum candidato do áudio admitido ficou a até 5% dele: o BPM
   * salvo não bate com o áudio e a grade é a do áudio (a M7 e a T27 avisam).
   */
  preferConflict: boolean;
  /**
   * Só aparece (sempre `true`) quando o `preferBpm` escolheu a família 3:2 da grade no
   * desempate de terços ambíguos, sem a evidência do áudio confirmar: a M7 e a T27
   * pedem pra conferir o andamento. Ausente nos outros casos.
   */
  preferChoseFamily?: true;
  /**
   * De onde veio o "1" (`downbeat`), pra quem mostra o "1" (M7, T27) marcar quando ele
   * é incerto: `baixo` (o baixo votou), `harmonia` (só a harmonia votou), `bumbo`,
   * `bumbo-lidera` (com faixas que não votam, o bumbo 1,1 dB ou mais acima),
   * `inicio-da-bateria` (empate do bumbo desfeito por onde a bateria começa) ou
   * `reserva`. Medido na rodada 3 da M3, marcando como incerto todo "1" que não vem
   * de `baixo` ou `bumbo` com `downbeatMargin` de 0,3 ou mais: nos sintéticos sem baixo
   * da revisão, todo "1" errado fica marcado; nas multitracks reais (140 leituras),
   * ficam marcados 14 dos 20 errados e 56 dos 120 certos (os 6 errados sem marca vêm
   * do baixo ou do bumbo sozinho). Ausente só na grade de reserva sem faixa de pulso
   * que dê pra medir (aí o "1" é o 0, como `reserva`).
   */
  downbeatFrom?: DownbeatSource;
  /**
   * Folga do "1" sobre o segundo tempo, na conta que decidiu (perfis com média 1: com
   * voto, a soma dos desvios; sem voto, o perfil do bumbo). 0 quando saiu de um empate
   * do bumbo (desfeito por onde a bateria começa ou pelo mais forte dele) ou da
   * reserva. Ausente junto com `downbeatFrom`.
   */
  downbeatMargin?: number;
  /** Metade e dobro do `bpm` (em semínima), pra oferecer (vazio na grade de reserva). */
  alternatives: number[];
  /** Ids das faixas que entraram na conta: as de pulso primeiro, depois as que votam no "1". */
  tracksUsed: string[];
}

/** Melhor grade pra um andamento candidato. Período e fase em quadros da onset. */
interface GridFit {
  bpm: number;
  period: number;
  phase: number;
  score: number;
}

// Busca conjunta de período e fase em volta de `roughBpm` (±`range`).
function fitGrid(o: Float32Array, fps: number, roughBpm: number, range: number): GridFit {
  const P0 = (fps * 60) / roughBpm;

  // Busca grossa: período em passos de 0,05% e fase em passos de 1 quadro.
  let bestP = P0;
  let bestPhase = 0;
  let best = -Infinity;
  const coarseStep = P0 * 0.0005;
  for (let P = P0 * (1 - range); P <= P0 * (1 + range); P += coarseStep) {
    for (let ph = 0; ph < P; ph += 1) {
      const s = combScore(o, P, ph);
      if (s > best) {
        best = s;
        bestP = P;
        bestPhase = ph;
      }
    }
  }
  // Busca fina em volta do melhor ponto. A grade é ancorada no tempo mais perto
  // do MEIO da música: assim mexer no período gira a grade em torno do centro em
  // vez de arrastar o começo. Ancorando no início, período e fase se compensavam
  // (grade certa no meio, ~13 ms adiantada no começo: visto no teste sintético).
  const mid = o.length / 2;
  const anchor0 = bestPhase + Math.round((mid - bestPhase) / bestP) * bestP;
  const fineP0 = bestP;
  let bestAnchor = anchor0;
  for (let P = fineP0 - 2 * coarseStep; P <= fineP0 + 2 * coarseStep; P += coarseStep / 10) {
    for (let an = anchor0 - 3; an <= anchor0 + 3; an += 0.1) {
      const ph = ((an % P) + P) % P;
      const s = combScore(o, P, ph);
      if (s > best) {
        best = s;
        bestP = P;
        bestAnchor = an;
      }
    }
  }
  bestPhase = ((bestAnchor % bestP) + bestP) % bestP;
  return { bpm: 60 / (bestP / fps), period: bestP, phase: bestPhase, score: best };
}

/** Um candidato de andamento ajustado: a grade, o tempo x contratempo e a evidência que decide o nível. */
interface FittedCandidate extends GridFit, TempoCandidate {
  offbeatRisk: boolean;
}

// Busca fina em volta de `bpm`, fase no tempo (bumbo e caixa) e a evidência medida nessa fase.
function fitCandidate(b: OnsetBands, bpm: number, range: number): FittedCandidate {
  const fit = fitGrid(b.full, b.fps, bpm, range);
  const { phase, offbeatRisk } = choosePhase(b, fit.period, fit.phase);
  return { ...fit, phase, offbeatRisk, ...candidateEvidence(b, fit.period, phase) };
}

// A grade da metade a partir da grade inteira: o dobro do período e, dos dois tempos
// dela, o de mais ataque (banda cheia), depois o tempo x contratempo de bumbo e caixa.
function halfOf(b: OnsetBands, f: FittedCandidate): FittedCandidate {
  const period = 2 * f.period;
  const other = (f.phase + f.period) % period;
  const start = combScore(b.full, period, other) > combScore(b.full, period, f.phase) ? other : f.phase;
  const { phase, offbeatRisk } = choosePhase(b, period, start);
  return { bpm: f.bpm / 2, period, phase, score: combScore(b.full, period, phase), offbeatRisk, ...candidateEvidence(b, period, phase) };
}

/**
 * Grade da música a partir das faixas dela. Todas as faixas `pulse` que dão pra
 * medir entram somadas (cada banda dividida pelo próprio máximo; kit separado
 * conta inteiro); `bass` (a primeira) e `harmony` vão pra etapa do "1" como votos.
 * Sem faixa de pulso que dê pra medir, devolve a grade de reserva com confiança 0.
 * O andamento sai da etapa da oitava (metade, dobro, 3:2, `preferBpm`). Com
 * `signature` x/8 a grade fica em colcheia (`pulseBpm`) e o `bpm` em semínima;
 * `nearBpm` e `preferBpm` são sempre lidos em semínima. O "1" usa
 * `beatsPerBar`, que sem valor vem dos pulsos do compasso (`signature`), senão 4.
 */
export function detectSongGrid(
  tracks: readonly TempoTrack[],
  sampleRate: number,
  opts: BeatGridOptions & { signature?: TimeSignature } = {}
): SongGridDetection {
  const beatsPerBar = Math.max(1, opts.beatsPerBar ?? (opts.signature ? pulsesPerBar(opts.signature) : 4));
  // Sem compasso, a conversão é a do compasso simples (pulso = semínima).
  const sig: TimeSignature = opts.signature ?? '4/4';
  const nearBpm = opts.nearBpm && opts.nearBpm > 0 ? opts.nearBpm : undefined;
  const preferBpm = !nearBpm && opts.preferBpm && opts.preferBpm > 0 ? opts.preferBpm : undefined;
  // Reserva (sem nada pra medir): no BPM de referência, em semínima; o salvo só vale de 30 a 300, como a grade da música.
  const reserveBpm = nearBpm ?? (preferBpm !== undefined && preferBpm >= 30 && preferBpm <= 300 ? preferBpm : undefined) ?? 120;
  const fallback: SongGridDetection = {
    bpm: reserveBpm, pulseBpm: pulseBpmFromDisplayBpm(reserveBpm, sig), firstBeat: 0, downbeat: 0, confidence: 0,
    offbeatRisk: false, preferConflict: false, alternatives: [], tracksUsed: [],
  };
  const tracksUsed: string[] = [];
  const pulseBands: OnsetBands[] = [];
  for (const t of tracks) {
    if (t.use !== 'pulse') continue;
    const pb = onsetBands(t.channels, sampleRate);
    if (!pb) continue;
    pulseBands.push(pb);
    tracksUsed.push(t.id);
  }
  if (!pulseBands.length) return fallback;
  const b = sumOnsetBands(pulseBands);

  const votes: DownbeatVotes = {};
  const bassTrack = tracks.find(t => t.use === 'bass');
  const bass = bassTrack ? onsetBands(bassTrack.channels, sampleRate) : null;
  if (bassTrack && bass) {
    votes.bass = bass;
    tracksUsed.push(bassTrack.id);
  }
  const harmony: OnsetBands[] = [];
  for (const t of tracks) {
    if (t.use !== 'harmony') continue;
    const h = onsetBands(t.channels, sampleRate);
    if (!h) continue;
    harmony.push(h);
    tracksUsed.push(t.id);
  }
  if (harmony.length) votes.harmony = harmony;

  const { fps } = b;
  const o = b.full;
  // As referências vêm em semínima e a busca anda no pulso (a colcheia em x/8).
  const nearPulse = nearBpm !== undefined ? pulseBpmFromDisplayBpm(nearBpm, sig) : undefined;
  const preferPulse = preferBpm !== undefined ? pulseBpmFromDisplayBpm(preferBpm, sig) : undefined;
  // Em x/8 o pulso vai pra faixa da colcheia depois da escolha (Ruling M4-x8). No
  // composto o BPM salvo só entra aí (o pulso achado pode ser a semínima pontuada).
  const eighthStage = nearPulse === undefined && isEighthPulse(sig);
  const pulsePrefer = isCompound(sig) ? undefined : preferPulse;
  const roughBpm = nearPulse ?? roughTempo(o, fps);
  const range = nearPulse ? 0.008 : 0.025;
  const fits = tempoCandidates(roughBpm, { nearBpm: nearPulse, signature: opts.signature })
    .map(c => fitCandidate(b, c, range));
  const tempo = pickTempo(fits, { nearBpm: nearPulse, preferBpm: pulsePrefer });
  let preferConflict = tempo.preferConflict;
  let fit = fits.find(f => f.bpm === tempo.bpm) ?? fits[0];
  // A metade do tempo aproximado sai dele (grade com o dobro de ataques, BPM mais preciso).
  if (fit !== fits[0] && Math.abs((2 * fit.bpm) / fits[0].bpm - 1) < 0.03) fit = halfOf(b, fits[0]);
  if (eighthStage) {
    const eighth = eighthPulseBpm(fit, sig, preferPulse);
    preferConflict = eighth.preferConflict;
    // Refino curto em volta da colcheia: a fase da grade do pulso nem sempre cai numa colcheia (pulso 3:2).
    if (Math.abs(eighth.bpm / fit.bpm - 1) > 1e-9) fit = fitCandidate(b, eighth.bpm, 0.008);
  }
  const round2 = (x: number) => Math.round(x * 100) / 100;
  const pulseBpm = round2(fit.bpm);
  const bpm = round2(displayBpmFromPulseBpm(fit.bpm, sig));

  const { phase, offbeatRisk } = fit;
  const confidence = measureConfidence(o, fit.period, phase, fps);

  const period = fit.period / fps;
  let firstBeat = (phase + ONSET_LAG_FRAMES) / fps;
  firstBeat = ((firstBeat % period) + period) % period;
  const { downbeat, from: downbeatFrom, margin: downbeatMargin } = decideDownbeat(b, period, firstBeat, beatsPerBar, votes);

  return {
    bpm, pulseBpm, firstBeat, downbeat, confidence, offbeatRisk, preferConflict,
    ...(tempo.preferChoseFamily ? { preferChoseFamily: true as const } : {}),
    alternatives: halfAndDouble(bpm), tracksUsed, downbeatFrom, downbeatMargin,
  };
}

export function detectBeatGrid(
  channels: Float32Array[],
  sampleRate: number,
  opts: BeatGridOptions = {}
): BeatGrid {
  const { bpm, firstBeat, downbeat, confidence } = detectSongGrid(
    [{ id: 'faixa', label: '', use: 'pulse', channels }], sampleRate, opts
  );
  return { bpm, firstBeat, downbeat, confidence };
}

/** BPM pra mostrar: inteiro quando está a menos de 0,05 de um inteiro, senão 1 casa. */
export function formatBpm(bpm: number): string {
  const r = Math.round(bpm);
  return Math.abs(bpm - r) < 0.05 ? String(r) : bpm.toFixed(1);
}

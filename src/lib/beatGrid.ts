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
import { isCompound, pulsesPerBar, type TimeSignature } from './stageContracts';
import { measureConfidence } from './tempo/confidence';
import { chooseDownbeat, type DownbeatVotes } from './tempo/downbeat';
import { candidateEvidence, compoundPulseBpm, halfAndDouble, pickTempo, roughTempo, tempoCandidates, type TempoCandidate } from './tempo/octave';
import { combScore, ONSET_LAG_FRAMES, onsetBands, sumOnsetBands, type OnsetBands } from './tempo/onsets';
import { choosePhase } from './tempo/phase';

export interface BeatGrid {
  /** BPM preciso (ex.: 119.87). */
  bpm: number;
  /** Segundos do primeiro tempo da grade, sempre em [0, 60/bpm). */
  firstBeat: number;
  /** Qual tempo (contado a partir de firstBeat, 0..beatsPerBar-1) é o "1" do compasso. */
  downbeat: number;
  /** 0..1. Abaixo de ~0.15 a música não tem pulso claro (o click ainda sai no BPM pedido). */
  confidence: number;
}

export interface BeatGridOptions {
  /**
   * BPM de referência digitado (Separador). Se vier, só refina em volta dele
   * (±0,8%), sem trocar de oitava nem de proporção, e vence o `preferBpm`.
   */
  nearBpm?: number;
  /** Tempos por compasso, pra achar o "1". Padrão: os pulsos do compasso (`signature`), senão 4. */
  beatsPerBar?: number;
  /**
   * BPM salvo da música (referência suave). Escolhe o nível da grade (metade, dobro,
   * 3:2) quando um candidato está a até 5% dele; o BPM exato ainda sai da música. No
   * compasso composto ele pode estar em colcheia, semínima ou semínima pontuada.
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
  /** A grade pode estar no contratempo (meio tempo fora): bumbo e caixa não decidem, ou não há nenhum dos dois. */
  offbeatRisk: boolean;
  /** Metade e dobro do BPM achado, pra oferecer (vazio na grade de reserva). */
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
 * `signature` 6/8 ou 12/8 a grade fica em colcheia; o "1" usa `beatsPerBar`, que
 * sem valor vem dos pulsos do compasso (`signature`), senão 4.
 */
export function detectSongGrid(
  tracks: readonly TempoTrack[],
  sampleRate: number,
  opts: BeatGridOptions & { signature?: TimeSignature } = {}
): SongGridDetection {
  const beatsPerBar = Math.max(1, opts.beatsPerBar ?? (opts.signature ? pulsesPerBar(opts.signature) : 4));
  const nearBpm = opts.nearBpm && opts.nearBpm > 0 ? opts.nearBpm : undefined;
  const preferBpm = !nearBpm && opts.preferBpm && opts.preferBpm > 0 ? opts.preferBpm : undefined;
  const fallback: SongGridDetection = {
    bpm: nearBpm ?? preferBpm ?? 120, firstBeat: 0, downbeat: 0, confidence: 0,
    offbeatRisk: false, alternatives: [], tracksUsed: [],
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
  // No composto o BPM da música é lido na colcheia (depois do pulso), não no pulso.
  const compound = !nearBpm && !!opts.signature && isCompound(opts.signature);
  const pulsePrefer = compound ? undefined : preferBpm;
  const roughBpm = nearBpm ?? roughTempo(o, fps);
  const range = nearBpm ? 0.008 : 0.025;
  const fits = tempoCandidates(roughBpm, { nearBpm, preferBpm: pulsePrefer, signature: opts.signature })
    .map(c => fitCandidate(b, c, range));
  const tempo = pickTempo(fits, { nearBpm, preferBpm: pulsePrefer });
  let fit = fits.find(f => f.bpm === tempo.bpm) ?? fits[0];
  // A metade do tempo aproximado sai dele (grade com o dobro de ataques, BPM mais preciso).
  if (fit !== fits[0] && Math.abs((2 * fit.bpm) / fits[0].bpm - 1) < 0.03) fit = halfOf(b, fits[0]);
  if (compound) {
    const eighth = compoundPulseBpm(fit, opts.signature, preferBpm);
    // Refino curto em volta da colcheia: a fase da grade do pulso nem sempre cai numa colcheia (pulso 3:2).
    if (Math.abs(eighth / fit.bpm - 1) > 1e-9) fit = fitCandidate(b, eighth, 0.008);
  }
  const bpm = Math.round(fit.bpm * 100) / 100;

  const { phase, offbeatRisk } = fit;
  const confidence = measureConfidence(o, fit.period, phase, fps);

  const period = fit.period / fps;
  let firstBeat = (phase + ONSET_LAG_FRAMES) / fps;
  firstBeat = ((firstBeat % period) + period) % period;
  const downbeat = chooseDownbeat(b, period, firstBeat, beatsPerBar, votes);

  return { bpm, firstBeat, downbeat, confidence, offbeatRisk, alternatives: halfAndDouble(bpm), tracksUsed };
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

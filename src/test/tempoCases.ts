// Catálogo único, com nome, dos casos do relatório do metrônomo automático
// (.superpowers/sdd/2026-11-15-parte2-palco-novo/refs/metronomo-auto-investigacao.md),
// pros testes do detector de tempo (M2, M3, M4 e M6).
//
// Os ids dos casos de bateria são os de scripts/verify-click/harness.mjs. Os
// controles negativos vêm do gridsweep.mjs (parte "conf": faixas sem pulso), mais
// um segundo caso de cada tipo; o baixo em colcheias e o shaker vêm do
// cointoss.mjs e do harness (pacote com KICK e BASS, pacote só com Loop).
//
// Todos com 60 s a 48 kHz (o relatório usou 300 s e o gridsweep, 120 s): o erro
// de uma grade travada é constante, e 60 s deixam os testes rápidos.
//
// `positive`: o sintético tem pulso periódico de verdade, que a confiança deve
// reconhecer. A confiança não mede acerto de fase nem de oitava: alguns positivos
// ainda saem com a grade errada e estão marcados em `knownIssue`. `false`: não há
// pulso em que confiar (ruído, pad, voz, baixo só de compasso, bateria afogada em
// chiado); a grade sai errada ou não quer dizer nada, e o click não pode sair sozinho.
//
// `group`: `calibracao` calibra o corte de confiança (CONFIDENCE_CUT) e
// `validacao` confere o corte em casos que não entraram na conta. Os positivos se
// alternam entre os dois na ordem do relatório; os negativos do gridsweep também,
// e o segundo caso de cada tipo fica no outro grupo (todo tipo de negativo aparece
// nos dois).
import type { TempoTrack } from '../lib/beatGrid';
import { makeSong, type SongOptions, type StereoTrack, type SynthSong } from './synthMusic';

const SR = 48000;
const DURATION = 60;

/** Faixas de uma música sintética; `kick`, `snare` e `hihat` são o kit separado. */
export type TempoCaseTrack = 'drums' | 'pad' | 'bass' | 'shaker' | 'bass8' | 'kick' | 'snare' | 'hihat';

/** `votes: false` pula o pad e o baixo quando eles não são o pulso do caso (só deixa o teste mais rápido). */
export interface TempoCaseSongOptions {
  votes?: boolean;
}

export interface TempoCase {
  id: string;
  group: 'calibracao' | 'validacao';
  positive: boolean;
  /** A música (com Bateria, Baixo e Pad, como o pacote padrão do harness). */
  song: (opts?: TempoCaseSongOptions) => SynthSong;
  note: string;
  /** Faixas que entram como pulso (padrão: a bateria). */
  pulse?: readonly TempoCaseTrack[];
  /** Tempos por compasso pra pedir ao detector (padrão: o do padrão da música). */
  beatsPerBar?: number;
  /** Quantos tempos do sintético cabem num pulso da grade (6/8 em semínima pontuada: 3). Padrão 1. */
  pulseEvery?: number;
  /** Outros nomes do mesmo caso (o plano da M3 chama alguns por descrição). */
  aliases?: readonly string[];
  /** Falha conhecida do detector neste caso (o que sai errado hoje e quem deve corrigir). */
  knownIssue?: string;
}

// Música do relatório: Bateria, Baixo e Pad (o pacote padrão do harness), 60 s a
// 48 kHz. Pad e baixo não sorteiam nada, então tirar os dois não muda as outras faixas.
const synth = (opts: SongOptions) => (o: TempoCaseSongOptions = {}) =>
  makeSong({ sr: SR, duration: DURATION, ...opts, ...(o.votes === false ? { withPad: false, withBass: false } : {}) });
// Mesmo assim, com o pad e o baixo sempre (o caso analisa um dos dois).
const synthAll = (opts: SongOptions) => () => makeSong({ sr: SR, duration: DURATION, ...opts });

// Faixa que não é música do sintetizador (ruído, voz): vai no lugar da bateria,
// as outras faixas ficam vazias e a música não tem tempos.
function signalSong(fill: (t: number) => number): SynthSong {
  const n = SR * DURATION;
  const a = new Float32Array(n);
  for (let i = 0; i < n; i++) a[i] = fill(i / SR);
  const empty = (): StereoTrack => [new Float32Array(0), new Float32Array(0)];
  return {
    tracks: { drums: [a, Float32Array.from(a)], pad: empty(), bass: empty(), shaker: empty(), bass8: empty() },
    beats: [], bars: [], sr: SR, duration: DURATION, bpm: 0, firstBeat: 0, beatsPerBar: 4,
  };
}

// O gerador do gridsweep.mjs pro ruído branco (com a mesma semente, o mesmo ruído).
function gridsweepRandom(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
}

const whiteNoise = (seed: number) => () => {
  const rnd = gridsweepRandom(seed);
  return signalSong(() => (rnd() * 2 - 1) * 0.1);
};

// Voz em glissando (o do gridsweep: 220 Hz +- 60 Hz a 0,13 Hz, volume a 0,07 Hz).
const glissando = (f0: number, depth: number, rate: number, ampRate: number) => () => signalSong(
  t => Math.sin(2 * Math.PI * (f0 + depth * Math.sin(2 * Math.PI * rate * t)) * t) * (0.5 + 0.5 * Math.sin(2 * Math.PI * ampRate * t)) * 0.3
);

export const TEMPO_CASES: readonly TempoCase[] = [
  // ── Bateria (harness.mjs) ──
  { id: 'a', group: 'calibracao', positive: true, song: synth({ bpm: 120, firstBeat: 0 }), aliases: ['comeca-em-zero'],
    note: '1º tempo em 0,000 s, 120 BPM: o golpe em 0,000 precisa contar' },
  { id: 'b', group: 'validacao', positive: true, song: synth({ bpm: 120, firstBeat: 1.37 }),
    note: '1º tempo em 1,37 s, 120 BPM' },
  { id: 'b44k', group: 'calibracao', positive: true, song: synth({ sr: 44100, bpm: 120, firstBeat: 1.37 }),
    note: 'igual ao b, faixa a 44,1 kHz' },
  { id: 'c1', group: 'validacao', positive: true, song: synth({ bpm: 72.5, firstBeat: 0.43 }),
    note: 'BPM decimal 72,5' },
  { id: 'c2', group: 'calibracao', positive: true, song: synth({ bpm: 135.04, firstBeat: 0.21 }),
    note: 'BPM decimal 135,04' },
  { id: 'd', group: 'validacao', positive: true, song: synth({ bpm: 100, firstBeat: 0.62, introBars: 8 }),
    note: 'intro de 8 compassos só com pad, bateria entra no 9 (100 BPM)' },
  { id: 'e1', group: 'calibracao', positive: true, song: synth({ bpm: 96, firstBeat: 0.35, pattern: 'sync44' }),
    note: 'síncope forte (gospel/funk em semicolcheias, chimbal acentuado no "e"), 96 BPM: a busca cai no contratempo' },
  { id: 'e2', group: 'validacao', positive: true, song: synth({ bpm: 76, firstBeat: 0.5, pattern: 'offbeat44' }),
    note: 'contratempo dominante (one drop), 76 BPM: caixa em todo "e", bumbo só no 3',
    knownIssue: 'a grade fica no contratempo e sem aviso de risco: o ruído da caixa (todo "e") vence o bumbo (só no 3)' },
  { id: 'f1', group: 'calibracao', positive: true, song: synth({ bpm: 90, firstBeat: 0.3, pattern: 'waltz34' }), beatsPerBar: 3,
    note: 'valsa 3/4, 90 BPM, compasso pedido 3/4' },
  { id: 'f3', group: 'validacao', positive: true, song: synth({ bpm: 180, firstBeat: 0.3, pattern: 'sixeight' }), beatsPerBar: 6, pulseEvery: 3,
    note: '6/8 com colcheia a 180 (semínima pontuada a 60), compasso pedido 6/8; a grade sai na semínima pontuada' },
  { id: 'g1', group: 'calibracao', positive: true, song: synth({ bpm: 120, firstBeat: 0.8, gain: 0.01 }),
    note: 'bateria a -40 dB, sem ruído' },
  { id: 'h', group: 'validacao', positive: true, song: synth({ bpm: 118, firstBeat: 0.8, jitterMs: 5 }),
    note: 'humanizado (cada golpe +-5 ms), 118 BPM' },
  { id: 'x_disco', group: 'calibracao', positive: true, song: synth({ bpm: 124, firstBeat: 0.9, pattern: 'disco44' }), aliases: ['bumbo-em-todo-tempo'],
    note: 'bumbo em todo tempo e chimbal aberto forte no "e" (worship/disco), 124 BPM' },
  { id: 'x_popsync', group: 'validacao', positive: true, song: synth({ bpm: 84, firstBeat: 0.5, pattern: 'popsync44' }),
    note: 'pop sincopado leve (bumbo no 1, no "e" do 2 e no 3; chimbal em colcheias iguais), 84 BPM' },
  { id: 'x_kicksync', group: 'calibracao', positive: true, song: synth({ bpm: 92, firstBeat: 0.5, pattern: 'kicksync44' }),
    note: 'bumbo no 1, no "e" do 2 e no "e" do 3; caixa no 2 e no 4; chimbal em colcheias iguais, 92 BPM' },
  { id: 'x_hat16on', group: 'validacao', positive: true, song: synth({ bpm: 100, firstBeat: 0.5, pattern: 'hat16on44' }),
    note: 'chimbal em semicolcheias com acento no tempo; bumbo no 1 e no "e" do 3, 100 BPM' },
  { id: 'x_sync16even', group: 'calibracao', positive: true, song: synth({ bpm: 96, firstBeat: 0.35, pattern: 'sync44even' }),
    note: 'igual ao e1, chimbal em semicolcheias sem acento, 96 BPM: a busca cai no contratempo' },
  { id: 'x_a_crash', group: 'validacao', positive: true, song: synth({ bpm: 120, firstBeat: 0, crashEvery: 4 }),
    note: 'igual ao a (começa em 0,000), prato no 1 a cada 4 compassos' },
  { id: 'x_a_popsync0', group: 'calibracao', positive: true, song: synth({ bpm: 84, firstBeat: 0, pattern: 'popsync44' }),
    note: 'pop sincopado começando em 0,000 (bumbo no 1 e no 3 do compasso não empatam)' },
  { id: 'x_d_fill4', group: 'validacao', positive: true, song: synth({ bpm: 100, firstBeat: 0.62, introBars: 8, fillBeforeEntry: 4 }), aliases: ['virada-antes-da-entrada'],
    note: 'intro de 8 compassos e virada de caixa no tempo 4 antes da entrada da bateria' },
  { id: 'x_d_fill3', group: 'calibracao', positive: true, song: synth({ bpm: 100, firstBeat: 0.62, introBars: 8, fillBeforeEntry: 3 }),
    note: 'intro de 8 compassos e virada de caixa a partir do tempo 3 antes da entrada' },
  { id: 'x_d_pickup', group: 'validacao', positive: true, song: synth({ bpm: 110, firstBeat: 2.0, introBars: 4, fillBeforeEntry: 4, crashEvery: 8 }),
    note: 'intro de 4 compassos, 1º tempo em 2,00 s, bateria entra com virada no 4' },
  { id: 't_64', group: 'calibracao', positive: true, song: synth({ bpm: 64, firstBeat: 0.7 }),
    note: 'balada 64 BPM, chimbal em colcheias' },
  { id: 't_68_16', group: 'validacao', positive: true, song: synth({ bpm: 68, firstBeat: 0.7, pattern: 'hat16on44' }),
    note: 'balada 68 BPM, chimbal em semicolcheias com acento no tempo' },
  { id: 't_58', group: 'calibracao', positive: true, song: synth({ bpm: 58, firstBeat: 0.7 }),
    note: 'balada 58 BPM, chimbal em colcheias' },
  { id: 't_160', group: 'validacao', positive: true, song: synth({ bpm: 160, firstBeat: 0.7 }),
    note: 'rápida 160 BPM, chimbal em colcheias',
    knownIssue: 'o BPM sai pela metade (80): a oitava é da M4' },
  { id: 't_176', group: 'calibracao', positive: true, song: synth({ bpm: 176, firstBeat: 0.7 }),
    note: 'rápida 176 BPM, chimbal em colcheias',
    knownIssue: 'o BPM sai pela metade (88): a oitava é da M4' },
  { id: 'n_kicksplit', group: 'validacao', positive: true, song: synth({ bpm: 104, firstBeat: 0.55 }),
    note: 'pacote com a bateria numa faixa "KICK" (sem "drum"): o pulso é a bateria (o AUTO antigo caía no BASS)' },
  // ── Só baixo ou só shaker (cointoss.mjs e harness.mjs) ──
  { id: 'bass-colcheias', group: 'calibracao', positive: true, song: synth({ bpm: 104, firstBeat: 0.55 }), pulse: ['bass8'],
    note: 'só baixo em colcheias iguais (o BASS do pacote n_kicksplit), 104 BPM: tempo e contratempo empatam' },
  { id: 'loop-shaker', group: 'validacao', positive: true, song: synth({ bpm: 104, firstBeat: 0.55 }), pulse: ['shaker'],
    note: 'só Loop de shaker em semicolcheias com acento no "e" (o n_loop do harness), 104 BPM',
    knownIssue: 'a grade fica no contratempo (sem bumbo nem caixa não há como decidir); pelo menos avisa o risco' },
  // ── Kit separado ──
  { id: 'kit-separado', group: 'calibracao', positive: true, song: synth({ bpm: 96, firstBeat: 0.35, pattern: 'sync44', splitKit: true }), pulse: ['kick', 'snare', 'hihat'],
    note: 'o e1 em três faixas (KICK, SNARE, HIHAT): nenhuma peça sozinha acha o tempo, as três somadas acham' },
  // ── Controles negativos (gridsweep.mjs, parte "conf") ──
  { id: 'silencio', group: 'calibracao', positive: false, song: () => signalSong(() => 0),
    note: 'silêncio absoluto' },
  { id: 'ruido-branco', group: 'validacao', positive: false, song: whiteNoise(7),
    note: 'ruído branco (o do gridsweep, semente 7)' },
  { id: 'pad-por-compasso', group: 'calibracao', positive: false, song: synthAll({ bpm: 120, firstBeat: 0.8 }), pulse: ['pad'],
    note: 'só o pad (um acorde por compasso, ataque de 250 ms), 120 BPM' },
  { id: 'baixo-por-compasso', group: 'validacao', positive: false, song: synthAll({ bpm: 120, firstBeat: 0.8 }), pulse: ['bass'],
    note: 'só o baixo de uma nota por compasso, 120 BPM: pulso só de compasso, a grade de tempo não quer dizer nada' },
  { id: 'voz-glissando', group: 'calibracao', positive: false, song: glissando(220, 60, 0.13, 0.07),
    note: 'voz em glissando (a do gridsweep)' },
  { id: 'bateria-afogada-m10db', group: 'validacao', positive: false, song: synth({ bpm: 120, firstBeat: 0.8, gain: 0.03, noiseDb: -20 }),
    note: 'bateria a -30 dB sob chiado a -20 dB (SNR -10 dB): a grade sai com BPM errado' },
  { id: 'bateria-afogada-m20db', group: 'calibracao', positive: false, song: synth({ bpm: 120, firstBeat: 0.8, gain: 0.01, noiseDb: -20 }),
    note: 'bateria a -40 dB sob chiado a -20 dB (SNR -20 dB): a grade sai com BPM errado' },
  { id: 'bateria-afogada-m30db', group: 'validacao', positive: false, song: synth({ bpm: 120, firstBeat: 0.8, gain: 0.003, noiseDb: -20 }),
    note: 'bateria a -50 dB sob chiado a -20 dB (SNR -30 dB): a grade sai com BPM errado' },
  // ── Segundo caso de cada tipo de negativo, no outro grupo ──
  { id: 'ruido-branco-2', group: 'calibracao', positive: false, song: whiteNoise(11),
    note: 'ruído branco, semente 11' },
  { id: 'pad-por-compasso-96', group: 'validacao', positive: false, song: synthAll({ bpm: 96, firstBeat: 0.5 }), pulse: ['pad'],
    note: 'só o pad, 96 BPM' },
  { id: 'baixo-por-compasso-96', group: 'calibracao', positive: false, song: synthAll({ bpm: 96, firstBeat: 0.5 }), pulse: ['bass'],
    note: 'só o baixo de uma nota por compasso, 96 BPM' },
  { id: 'voz-glissando-2', group: 'validacao', positive: false, song: glissando(330, 80, 0.21, 0.11),
    note: 'voz em glissando, 330 Hz +- 80 Hz a 0,21 Hz' },
  { id: 'g2', group: 'validacao', positive: false, song: synth({ bpm: 120, firstBeat: 0.8, gain: 0.00316, noiseDb: -45 }),
    note: 'bateria a -50 dB sob chiado a -45 dB (harness): em 60 s a grade sai com BPM errado, então é controle negativo' },
];

/** O caso pelo id (ou por um dos nomes em `aliases`). Lança erro se não existir. */
export function tempoCase(id: string): TempoCase {
  const c = TEMPO_CASES.find(x => x.id === id || x.aliases?.includes(id));
  if (!c) throw new Error(`caso de tempo desconhecido: ${id}`);
  return c;
}

/** As faixas de pulso do caso, prontas pro detectSongGrid (id = nome da faixa). */
export function caseTracks(c: TempoCase, song: SynthSong): TempoTrack[] {
  return (c.pulse ?? ['drums']).map((name): TempoTrack => {
    const kit = song.tracks.kit;
    const channels = name === 'kick' || name === 'snare' || name === 'hihat'
      ? kit?.[name]
      : song.tracks[name];
    if (!channels) throw new Error(`o caso ${c.id} não tem a faixa ${name}`);
    return { id: name, label: name, use: 'pulse', channels };
  });
}

/** Tempos por compasso que o caso pede ao detector. */
export function caseBeatsPerBar(c: TempoCase, song: SynthSong): number {
  return c.beatsPerBar ?? song.beatsPerBar;
}

/**
 * Distância, em segundos, do `firstBeat` detectado até o pulso real mais perto
 * (a grade real estendida pra trás), em (-P/2, P/2]. Positivo = grade atrasada.
 * No contratempo dá perto de +-P/2.
 */
export function firstBeatError(c: TempoCase, song: SynthSong, firstBeat: number): number {
  const P = (60 / song.bpm) * (c.pulseEvery ?? 1);
  let d = (((firstBeat - song.firstBeat) % P) + P) % P;
  if (d > P / 2) d -= P;
  return d;
}

/** BPM da grade que o caso espera: o do sintético dividido por `pulseEvery`. */
export function expectedBpm(c: TempoCase, song: SynthSong): number {
  return song.bpm / (c.pulseEvery ?? 1);
}

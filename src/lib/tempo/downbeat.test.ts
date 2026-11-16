// O "1" do compasso (M3, recomendação 4 do relatório do metrônomo automático):
// a troca de acorde (harmonia) e a nota do baixo votam primeiro, depois o bumbo,
// e "onde a bateria começa" só desempata quando não há outro voto.
//
// A matriz de 54 cenários 4/4 é a do scripts/verify-click/downbeat.mjs (3 levadas,
// 6 inícios, sem intro / intro de 4 compassos / intro com virada no tempo 4), aqui
// com Bateria + Baixo + Pad (o pacote padrão do harness) e 30 s em vez de 120 s:
// a grade trava igual e o teste fica no tempo. Os casos com nome vêm do catálogo
// (src/test/tempoCases.ts).
import { beforeAll, describe, expect, it } from 'vitest';
import { detectBeatGrid, detectSongGrid, type SongGridDetection, type TempoTrack } from '../beatGrid';
import { legacyDetectBeatGrid } from '../../test/legacyBeatGrid';
import { makeSong, type PatternName, type SynthSong } from '../../test/synthMusic';
import { caseBeatsPerBar, caseTracks, tempoCase, type TempoCase } from '../../test/tempoCases';
import { chooseDownbeat } from './downbeat';
import type { OnsetBands } from './onsets';

const SR = 48000;
const LENTO = 30_000;

interface Cenario {
  pattern: PatternName;
  firstBeat: number;
  intro: 'sem' | 'intro4' | 'intro4+virada';
}

const BPM_DA_LEVADA: Partial<Record<PatternName, number>> = { rock44: 120, disco44: 124, popsync44: 84 };

const cenarios54: Cenario[] = (['rock44', 'disco44', 'popsync44'] as const).flatMap(pattern =>
  [0, 0.25, 0.5, 1.0, 1.37, 2.0].flatMap(firstBeat =>
    (['sem', 'intro4', 'intro4+virada'] as const).map(intro => ({ pattern, firstBeat, intro }))));

function musicaDoCenario({ pattern, firstBeat, intro }: Cenario): SynthSong {
  return makeSong({
    sr: SR, duration: 30, bpm: BPM_DA_LEVADA[pattern] ?? 120, firstBeat, pattern, withExtras: false,
    introBars: intro === 'sem' ? 0 : 4, fillBeforeEntry: intro === 'intro4+virada' ? 4 : null,
  });
}

/** Pulso, Baixo e Pad (os dois votam no "1"), como um pacote de multitracks. */
function faixasComVotos(song: SynthSong, pulso: readonly TempoTrack[]): TempoTrack[] {
  return [
    ...pulso,
    { id: 'baixo', label: 'Baixo', use: 'bass', channels: song.tracks.bass },
    { id: 'pad', label: 'Pad', use: 'harmony', channels: song.tracks.pad },
  ];
}

/** Em que tempo do compasso real cai o "1" detectado (0 = no 1). */
function posicaoDoUm(song: SynthSong, grid: Pick<SongGridDetection, 'firstBeat' | 'downbeat' | 'pulseBpm'>, beatsPerBar: number): number {
  const um = grid.firstBeat + grid.downbeat * (60 / grid.pulseBpm);
  const n = Math.round((um - song.firstBeat) / (60 / song.bpm));
  return ((n % beatsPerBar) + beatsPerBar) % beatsPerBar;
}

function downbeatCerto(c: TempoCase): boolean {
  const song = c.song();
  const beatsPerBar = caseBeatsPerBar(c, song);
  const grid = detectSongGrid(faixasComVotos(song, caseTracks(c, song)), song.sr, { beatsPerBar });
  return posicaoDoUm(song, grid, beatsPerBar) === 0;
}

describe('o "1" nos casos do relatório (Bateria + Baixo + Pad)', () => {
  const errados: string[] = [];
  let acertos = 0;
  // Cada cenário: 30 s sintetizados e uma detecção com 3 faixas (~1 s cada).
  beforeAll(() => {
    for (const c of cenarios54) {
      const song = musicaDoCenario(c);
      const pulso: TempoTrack = { id: 'bateria', label: 'Bateria', use: 'pulse', channels: song.tracks.drums };
      const pos = posicaoDoUm(song, detectSongGrid(faixasComVotos(song, [pulso]), SR, { beatsPerBar: 4 }), 4);
      if (pos === 0) acertos++;
      else errados.push(`${c.pattern}/${c.firstBeat}s/${c.intro}: no ${pos + 1}`);
    }
  }, 240_000);

  it('acerta o 1 em pelo menos 50 dos 54 cenários 4/4 (hoje 31)', () => {
    expect(acertos, errados.join('; ')).toBeGreaterThanOrEqual(50);
  });

  it.each(['virada-antes-da-entrada', 'comeca-em-zero', 'bumbo-em-todo-tempo'])('%s', (id) => {
    expect(downbeatCerto(tempoCase(id))).toBe(true);
  }, LENTO);

  it('3/4 com compasso pedido 3/4 acerta o 1', () => {
    const c = tempoCase('f1');
    expect(c.beatsPerBar).toBe(3);
    expect(downbeatCerto(c)).toBe(true);
  }, LENTO);
});

// O Separador e o Metrônomo chamam o detectBeatGrid só com a bateria: sem voto, o
// bumbo de 100 Hz e o desempate por onde a bateria começa (a virada antes da
// entrada continua sem como saber, ver o relatório da M3).
describe('o "1" só com a bateria', () => {
  it.each(['comeca-em-zero', 'bumbo-em-todo-tempo'])('%s', (id) => {
    const c = tempoCase(id);
    const song = c.song({ votes: false });
    const [pulso] = caseTracks(c, song);
    const grid = detectBeatGrid(pulso.channels, song.sr, { beatsPerBar: 4 });
    expect(posicaoDoUm(song, { ...grid, pulseBpm: grid.bpm }, 4)).toBe(0);
  }, LENTO);

  // Saiu do teste de equivalência na M3: 7 tempos pedidos numa música 4/4 não têm
  // "1" certo. O antigo dava o máximo da banda grave (tempo 6), sem desempate porque
  // o compasso é ímpar; agora o bumbo empata nos 7 e vale onde a bateria começa.
  it('compasso ímpar pedido (7 numa música 4/4): o bumbo empatado desempata por onde a bateria começa', () => {
    const song = makeSong({ sr: SR, duration: 60, bpm: 84, firstBeat: 0.5, pattern: 'popsync44', withPad: false, withBass: false });
    const opts = { beatsPerBar: 7 };
    const grid = detectBeatGrid(song.tracks.drums, SR, opts);
    expect(legacyDetectBeatGrid(song.tracks.drums, SR, opts).downbeat).toBe(6);
    expect(Math.abs(grid.firstBeat + grid.downbeat * (60 / grid.bpm) - song.firstBeat)).toBeLessThan(0.01);
  }, LENTO);
});

// ── chooseDownbeat com ataques montados à mão (sem áudio) ──

const FPS = 200;
/** Período da grade: 0,5 s (100 quadros, 120 BPM). */
const PERIODO = 0.5;
const TEMPOS = 64;
const QUADROS = TEMPOS * PERIODO * FPS + 10;

/**
 * Onset com um ataque em cada tempo `k` da grade (contado de 0,000) e o peso que
 * `peso(k)` der (0 = sem ataque). O pico ocupa os 2 quadros em volta do atraso da
 * onset (1,5 quadro antes do tempo), como numa faixa de verdade.
 */
function onset(peso: (k: number) => number): Float32Array {
  const o = new Float32Array(QUADROS);
  for (let k = 0; k < TEMPOS; k++) {
    const p = peso(k);
    if (p <= 0) continue;
    const x = k * PERIODO * FPS - 1.5;
    for (const i of [Math.floor(x), Math.ceil(x)]) o[Math.max(0, i)] = p;
  }
  return o;
}

/** Peso por tempo do compasso de 4 (0..3), a partir do tempo `desde`. */
const porTempo = (pesos: readonly number[], desde = 0) => (k: number) => (k >= desde ? pesos[k % 4] : 0);

function bandas(partes: Partial<Pick<OnsetBands, 'full' | 'kick'>>): OnsetBands {
  const zero = new Float32Array(QUADROS);
  const kick = partes.kick ?? zero;
  return { fps: FPS, full: partes.full ?? zero, low: kick, kick, snare: zero, hasKick: Boolean(partes.kick), hasSnare: false };
}

/** Bateria de rock (bumbo no 1 e no 3, ataque em todo tempo) entrando no tempo `desde`. */
const rock = (desde = 0) => bandas({ full: onset(porTempo([1, 1, 1, 1], desde)), kick: onset(porTempo([1, 0, 1, 0], desde)) });

describe('chooseDownbeat: a ordem dos votos', () => {
  it('o baixo e a troca de acorde pesam mais que o bumbo', () => {
    const bumboNo3 = bandas({ full: onset(porTempo([1, 1, 1, 1])), kick: onset(porTempo([0.6, 0, 1, 0])) });
    const baixo = bandas({ full: onset(porTempo([1, 0.2, 0.3, 0.2])) });
    const pad = bandas({ full: onset(porTempo([1, 0, 0, 0])) });
    expect(chooseDownbeat(bumboNo3, PERIODO, 0, 4)).toBe(2);
    expect(chooseDownbeat(bumboNo3, PERIODO, 0, 4, { bass: baixo, harmony: [pad] })).toBe(0);
  });

  // Nas multitracks reais (calibração da M3): bumbo só no 1 e um baixo sincopado que
  // puxa de leve pro 2. A ordem rígida (o bumbo só no empate) dava o 2 ou o 4.
  it('um bumbo muito claro no 1 vence um baixo e uma harmonia que puxam de leve pra outro tempo', () => {
    const bumboSoNo1 = bandas({ full: onset(porTempo([1, 1, 1, 1])), kick: onset(porTempo([1, 0, 0, 0])) });
    const baixo = bandas({ full: onset(porTempo([1.05, 1.2, 0.8, 0.95])) });
    const teclado = bandas({ full: onset(porTempo([0.8, 1, 1, 1.2])) });
    expect(chooseDownbeat(bumboSoNo1, PERIODO, 0, 4, { bass: baixo, harmony: [teclado] })).toBe(0);
  });

  it('com o baixo sem preferência (todo tempo igual), o bumbo decide', () => {
    const bumboNo1 = bandas({ full: onset(porTempo([1, 1, 1, 1])), kick: onset(porTempo([1, 0, 0.5, 0])) });
    const baixoIgual = bandas({ full: onset(porTempo([1, 1, 1, 1])) });
    expect(chooseDownbeat(bumboNo1, PERIODO, 0, 4, { bass: baixoIgual })).toBe(0);
  });

  it('sem voto, com o bumbo empatado no 1 e no 3, vale onde a bateria começa', () => {
    expect(chooseDownbeat(rock(4), PERIODO, 0, 4)).toBe(0);
    // A bateria entra no 3 do 2º compasso (tempo 6): sem outro voto, ali é o 1.
    expect(chooseDownbeat(rock(6), PERIODO, 0, 4)).toBe(2);
  });

  it('com voto, onde a bateria começa não desempata', () => {
    const pad = bandas({ full: onset(porTempo([1, 0, 0, 0])) });
    expect(chooseDownbeat(rock(6), PERIODO, 0, 4, { harmony: [pad] })).toBe(0);
  });

  it('o golpe em 0,000 conta (o 1º tempo cai antes do atraso da onset)', () => {
    // Sem o golpe do quadro 0, o bumbo do 3 venceria e a bateria "começaria" no 2.
    expect(chooseDownbeat(rock(0), PERIODO, 0, 4)).toBe(0);
  });

  it('faixa de voto em silêncio não vota', () => {
    const silencio = bandas({});
    expect(chooseDownbeat(rock(6), PERIODO, 0, 4, { bass: silencio, harmony: [silencio] })).toBe(2);
  });

  it('compasso de 1 tempo devolve 0', () => {
    expect(chooseDownbeat(rock(6), PERIODO, 0, 1)).toBe(0);
  });

  it('grade inválida (período 0 ou NaN, 1º tempo NaN) devolve 0 sem travar', () => {
    for (const [period, firstBeat] of [[0, 0], [Number.NaN, 0], [PERIODO, Number.NaN]]) {
      expect(chooseDownbeat(rock(6), period, firstBeat, 4)).toBe(0);
    }
  });
});

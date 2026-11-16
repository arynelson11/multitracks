// Tempo x contratempo (M2): bumbo e caixa decidem entre a fase da busca e a fase
// + meio período. Casos do relatório do metrônomo automático (src/test/tempoCases.ts).
import { describe, expect, it } from 'vitest';
import { detectSongGrid, type SongGridDetection } from '../beatGrid';
import { legacyDetectBeatGrid } from '../../test/legacyBeatGrid';
import { TEMPO_CASES, caseBeatsPerBar, caseTracks, expectedBpm, firstBeatError, tempoCase, type TempoCase } from '../../test/tempoCases';
import type { SynthSong } from '../../test/synthMusic';
import { choosePhase } from './phase';
import { combScore, onsetBands, type OnsetBands } from './onsets';

const LENTO = 60_000;

function detect(c: TempoCase): { song: SynthSong; grid: SongGridDetection } {
  const song = c.song({ votes: false });
  return { song, grid: detectSongGrid(caseTracks(c, song), song.sr, { beatsPerBar: caseBeatsPerBar(c, song) }) };
}

/** Erro, em segundos, do 1º click da grade detectada contra o tempo real mais perto. */
function erroDoPrimeiroClick(c: TempoCase): number {
  const { song, grid } = detect(c);
  expect(grid.bpm).toBeCloseTo(expectedBpm(c, song), 1);
  return firstBeatError(c, song, grid.firstBeat);
}

describe('tempo x contratempo nos casos do relatório', () => {
  it.each(['x_popsync', 'x_kicksync', 'x_sync16even', 'e1'])('%s: click no tempo, não no contratempo', (id) => {
    expect(Math.abs(erroDoPrimeiroClick(tempoCase(id)))).toBeLessThan(0.010);
  });

  // Os dois avisam o risco, por caminhos diferentes (o teste confere qual).
  it('loop-shaker: sem bumbo nem caixa, avisa o risco de meio tempo', () => {
    const c = tempoCase('loop-shaker');
    const { song, grid } = detect(c);
    const b = onsetBands(caseTracks(c, song)[0].channels, song.sr);
    expect({ bumbo: b?.hasKick, caixa: b?.hasSnare }).toEqual({ bumbo: false, caixa: false });
    expect(grid.offbeatRisk).toBe(true);
  });

  it('bass-colcheias: o baixo acende a banda grave, mas tempo e contratempo empatam (menos de 15%) e avisa o risco', () => {
    const c = tempoCase('bass-colcheias');
    const { song, grid } = detect(c);
    const b = onsetBands(caseTracks(c, song)[0].channels, song.sr);
    // O baixo passa por "tem grave" (hasKick); o risco vem do empate, não da ausência.
    expect({ grave: b?.hasKick, caixa: b?.hasSnare }).toEqual({ grave: true, caixa: false });
    expect(grid.offbeatRisk).toBe(true);
  });

  it('levada comum (rock no b) não avisa risco', () => {
    expect(detect(tempoCase('b')).grid.offbeatRisk).toBe(false);
  });

  // Antes da M2 estes já saíam no tempo certo (detector congelado da v1.4.15):
  // a decisão de bumbo e caixa não pode tirar nenhum do lugar. O relatório mediu
  // o click entre +0,2 e +6,8 ms do golpe; a grade sozinha fica abaixo disso.
  it('os casos que já davam certo continuam no mesmo erro (até +6,8 ms)', () => {
    let conferidos = 0;
    for (const c of TEMPO_CASES) {
      if (!c.positive || (c.pulse && c.pulse.length > 1)) continue;
      const { song, grid } = detect(c);
      const [pulso] = caseTracks(c, song);
      const antigo = legacyDetectBeatGrid(pulso.channels, song.sr, { beatsPerBar: caseBeatsPerBar(c, song) });
      const erroAntigo = firstBeatError(c, song, antigo.firstBeat);
      const davaCerto = Math.abs(antigo.bpm - expectedBpm(c, song)) < 0.05 && Math.abs(erroAntigo) < 0.010;
      if (!davaCerto) continue;
      conferidos++;
      expect({ id: c.id, bpm: grid.bpm }).toEqual({ id: c.id, bpm: antigo.bpm });
      const erro = firstBeatError(c, song, grid.firstBeat);
      expect(Math.abs(erro - erroAntigo), c.id).toBeLessThanOrEqual(0.0005);
      expect(Math.abs(erro), c.id).toBeLessThanOrEqual(0.0068);
    }
    // a, b, b44k, c1, c2, d, f1, f3, g1, h, x_disco, x_popsync, x_kicksync,
    // x_hat16on, x_a_crash, x_a_popsync0, x_d_fill4, x_d_fill3, x_d_pickup,
    // t_64, t_68_16, t_58, n_kicksplit e bass-colcheias: a lista não é vazia.
    expect(conferidos).toBeGreaterThanOrEqual(20);
  }, LENTO);
});

// ── choosePhase com ataques montados à mão (sem áudio) ──

const FPS = 200;
const PERIODO = 100;

/** Ataques de 1 quadro nas posições `k * PERIODO + offset` (com peso), em 20 tempos. */
function pulsos(offsets: readonly (readonly [number, number])[]): Float32Array {
  const o = new Float32Array(PERIODO * 20);
  for (let k = 0; k < 20; k++) for (const [off, peso] of offsets) o[k * PERIODO + off] = peso;
  return o;
}

function bandas(kick: Float32Array | null, snare: Float32Array | null): OnsetBands {
  const zeros = new Float32Array(PERIODO * 20);
  return { fps: FPS, full: zeros, low: zeros, kick: kick ?? zeros, snare: snare ?? zeros, hasKick: !!kick, hasSnare: !!snare };
}

describe('choosePhase', () => {
  it('bumbo e caixa no meio período puxam a fase pra lá', () => {
    const b = bandas(pulsos([[60, 1]]), pulsos([[60, 1]]));
    expect(choosePhase(b, PERIODO, 10)).toEqual({ phase: 60, offbeatRisk: false });
  });

  it('bumbo e caixa na fase da busca ficam nela', () => {
    const b = bandas(pulsos([[10, 1]]), pulsos([[10, 1], [60, 0.2]]));
    expect(choosePhase(b, PERIODO, 10)).toEqual({ phase: 10, offbeatRisk: false });
  });

  it('cada banda pelo próprio máximo: a caixa baixinha pesa tanto quanto se fosse alta', () => {
    // Bumbo alto em 3 de 4 contratempos; caixa 40 dB abaixo, em todo tempo. Sem dividir
    // cada banda pelo próprio máximo o bumbo decidiria (0,75 contra 0,26); dividindo, a caixa vale 1.
    const kick = new Float32Array(PERIODO * 20);
    const snare = new Float32Array(PERIODO * 20);
    for (let k = 0; k < 20; k++) {
      kick[k * PERIODO + (k % 4 === 0 ? 10 : 60)] = 1;
      snare[k * PERIODO + 10] = 0.01;
    }
    expect(choosePhase(bandas(kick, snare), PERIODO, 60).phase).toBe(10);
  });

  it('diferença menor que 15% avisa o risco (mas ainda fica com a maior)', () => {
    const b = bandas(pulsos([[10, 1], [60, 0.9]]), null);
    expect(choosePhase(b, PERIODO, 10)).toEqual({ phase: 10, offbeatRisk: true });
  });

  it('sem bumbo nem caixa, fica a fase da busca e avisa o risco', () => {
    expect(choosePhase(bandas(null, null), PERIODO, 37)).toEqual({ phase: 37, offbeatRisk: true });
  });

  it('a fase devolvida fica dentro do período', () => {
    const b = bandas(pulsos([[20, 1]]), null);
    const r = choosePhase(b, PERIODO, 70);
    expect(r.phase).toBe(20);
    expect(r.phase).toBeGreaterThanOrEqual(0);
    expect(r.phase).toBeLessThan(PERIODO);
  });

  // Período inválido (0, negativo ou NaN) não pode travar: `combScore` andava a
  // grade com passo 0 ou pra trás e nunca saía do laço.
  it('período NaN: fica a fase da busca, com risco, e combScore dá 0', () => {
    const b = bandas(pulsos([[20, 1]]), pulsos([[20, 1]]));
    expect(choosePhase(b, NaN, 10)).toEqual({ phase: 10, offbeatRisk: true });
    expect(combScore(pulsos([[0, 1]]), NaN, 0)).toBe(0);
  });

  it.each([0, -5])('período %s: fica a fase da busca, com risco, e combScore dá 0 (sem laço infinito)', (periodo) => {
    const b = bandas(pulsos([[20, 1]]), pulsos([[20, 1]]));
    expect(choosePhase(b, periodo, 10)).toEqual({ phase: 10, offbeatRisk: true });
    expect(combScore(pulsos([[0, 1]]), periodo, 0)).toBe(0);
  });
});

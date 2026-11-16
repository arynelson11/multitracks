// Andamento (M4): a oitava (metade, inteiro, dobro), as proporções 3:2 e 4:3, o
// compasso composto (6/8 e 12/8 em colcheia) e o BPM da música como referência
// suave (`preferBpm`), sem mexer no refino rígido do Separador (`nearBpm`).
// Casos do relatório do metrônomo automático (src/test/tempoCases.ts).
import { describe, expect, it } from 'vitest';
import { detectBeatGrid, detectSongGrid, type BeatGridOptions, type SongGridDetection } from '../beatGrid';
import { legacyDetectBeatGrid } from '../../test/legacyBeatGrid';
import { caseBeatsPerBar, caseTracks, tempoCase } from '../../test/tempoCases';
import type { SynthSong } from '../../test/synthMusic';
import type { TimeSignature } from '../stageContracts';
import { compoundPulseBpm, pickTempo, tempoCandidates, type TempoCandidate } from './octave';

const LENTO = 30_000;

type Opcoes = BeatGridOptions & { signature?: TimeSignature };

// A mesma música não é sintetizada duas vezes (1 min de áudio por caso).
const musicas = new Map<string, SynthSong>();
function musica(id: string): SynthSong {
  let s = musicas.get(id);
  if (!s) {
    s = tempoCase(id).song({ votes: false });
    musicas.set(id, s);
  }
  return s;
}

/** Detecta no caso do catálogo; sem `opts`, com os tempos por compasso do caso. */
function detect(id: string, opts?: Opcoes): { song: SynthSong; grid: SongGridDetection } {
  const c = tempoCase(id);
  const song = musica(id);
  const o = opts ?? { beatsPerBar: caseBeatsPerBar(c, song) };
  return { song, grid: detectSongGrid(caseTracks(c, song), song.sr, o) };
}

/** Distância, em segundos, de `t` até a grade `t0 + k * passo` mais perto (com sinal). */
function foraDaGrade(t: number, t0: number, passo: number): number {
  let d = (((t - t0) % passo) + passo) % passo;
  if (d > passo / 2) d -= passo;
  return d;
}

/** Onde cai o "1" da grade detectada (o primeiro), em segundos. */
const primeiroUm = (g: SongGridDetection) => g.firstBeat + g.downbeat * (60 / g.bpm);

describe('oitava do andamento', () => {
  it.each([['t_160', 160], ['t_176', 176]])('%s: %s BPM sai inteiro, não pela metade', (id, bpm) => {
    const { song, grid } = detect(id);
    expect(grid.bpm).toBeCloseTo(bpm, 1);
    // A grade cai no tempo (não no contratempo do dobro).
    expect(Math.abs(foraDaGrade(grid.firstBeat, song.firstBeat, 60 / bpm))).toBeLessThan(0.010);
  }, LENTO);

  it.each(['t_58', 't_64', 't_68_16'])('%s: balada continua no BPM dela, sem dobrar', (id) => {
    const { song, grid } = detect(id);
    expect(grid.bpm).toBeCloseTo(song.bpm, 1);
  }, LENTO);

  it('sempre oferece metade e dobro', () => {
    expect(detect('b').grid.alternatives).toEqual([60, 240]);
    expect(detect('t_160').grid.alternatives).toEqual([80, 320]);
  }, LENTO);
});

describe('BPM da música como referência', () => {
  it('com preferBpm escolhe a oitava dele', () => {
    expect(detect('b', { preferBpm: 60 }).grid.bpm).toBeCloseTo(60, 1);
    expect(detect('t_160', { preferBpm: 80 }).grid.bpm).toBeCloseTo(80, 1);
    expect(detect('t_64', { preferBpm: 128 }).grid.bpm).toBeCloseTo(128, 1);
  }, LENTO);

  it('preferBpm é suave: o BPM ainda sai da música, não fica preso ao de referência', () => {
    // Com nearBpm 118 o refino fica em volta de 118 (no máximo ~119,1); com preferBpm acha o 120.
    expect(detect('b', { preferBpm: 118 }).grid.bpm).toBe(120);
    expect(detect('c1', { preferBpm: 72 }).grid.bpm).toBeCloseTo(72.5, 1);
  }, LENTO);

  it('com nearBpm continua o refino rígido (Separador)', () => {
    const c = tempoCase('b');
    const ch = caseTracks(c, musica('b'))[0].channels;
    const opts = { nearBpm: 118, beatsPerBar: 4 };
    const novo = detectBeatGrid(ch, 48000, opts);
    expect(novo).toEqual({ ...legacyDetectBeatGrid(ch, 48000, opts), confidence: novo.confidence });
    expect(novo.bpm).toBeLessThan(119.5);
    // O nearBpm não troca de oitava: 80 pedido numa música de 160 fica em 80.
    expect(detect('t_160', { nearBpm: 80, beatsPerBar: 4 }).grid.bpm).toBeCloseTo(80, 1);
  }, LENTO);
});

describe('compasso', () => {
  it('6/8 pedido em 6/8 conta colcheias (180) com o acento a cada compasso', () => {
    const { song, grid } = detect('f3', { signature: '6/8' });
    const colcheia = 60 / 180;
    expect(grid.bpm).toBeCloseTo(180, 1);
    expect(Math.abs(foraDaGrade(grid.firstBeat, song.firstBeat, colcheia))).toBeLessThan(0.010);
    // O "1" cai no começo de um compasso de 6 colcheias.
    expect(Math.abs(foraDaGrade(primeiroUm(grid), song.firstBeat, 6 * colcheia))).toBeLessThan(0.010);
    expect(grid.alternatives).toEqual([90, 360]);
  }, LENTO);

  it('12/8 pedido em 12/8 também fica em colcheia', () => {
    expect(detect('f3', { signature: '12/8' }).grid.bpm).toBeCloseTo(180, 1);
  }, LENTO);

  it('6/8 sem compasso pedido continua no pulso de semínima pontuada (60), como hoje', () => {
    expect(detect('f3', { beatsPerBar: 6 }).grid.bpm).toBeCloseTo(60, 1);
  }, LENTO);

  it('signature 3/4 sem beatsPerBar acha o 1 a cada 3', () => {
    const { song, grid } = detect('f1', { signature: '3/4' });
    const tempo = 60 / 90;
    expect(grid.bpm).toBeCloseTo(90, 1);
    expect(Math.abs(foraDaGrade(primeiroUm(grid), song.firstBeat, 3 * tempo))).toBeLessThan(0.010);
  }, LENTO);

  it('6/8 com o BPM da música em colcheia, em semínima ou em semínima pontuada acha a colcheia', () => {
    for (const preferBpm of [180, 90, 60]) {
      expect({ preferBpm, bpm: detect('f3', { signature: '6/8', preferBpm }).grid.bpm }).toEqual({ preferBpm, bpm: 180 });
    }
  }, LENTO);
});

// ── pickTempo e tempoCandidates com a evidência montada à mão (sem áudio) ──

/** Candidato com a evidência montada: backbeat (bumbo x caixa) e ataque nos terços do tempo. */
const cand = (bpm: number, score: number, kickOnBeat = 0, snareOffBeat = 0, thirds = 0): TempoCandidate =>
  ({ bpm, score, kickOnBeat, snareOffBeat, thirds });

describe('tempoCandidates', () => {
  it('em volta do tempo aproximado: metade, dobro e as proporções 2:3, 3:4, 4:3 e 3:2, o aproximado primeiro', () => {
    expect(tempoCandidates(120, {})).toEqual([120, 60, 240, 80, 90, 160, 180]);
  });

  it('só entre 30 e 300 BPM (o aproximado sempre fica)', () => {
    expect(tempoCandidates(200, {})).toEqual([200, 100, 133.33333333333331, 150, 266.66666666666663, 300]);
  });

  it('com nearBpm, só ele', () => {
    expect(tempoCandidates(97, { nearBpm: 97 })).toEqual([97]);
  });

  it('no compasso composto, só a metade e o dobro (a proporção 3:2 do pulso é a colcheia)', () => {
    expect(tempoCandidates(60, { signature: '6/8' })).toEqual([60, 30, 120]);
    expect(tempoCandidates(60, { signature: '3/4' })).toEqual([60, 30, 120, 40, 45, 80, 90]);
  });

  it('preferBpm longe de todos entra no fim; perto de um (até 5%), não', () => {
    expect(tempoCandidates(120, { preferBpm: 108 })).toEqual([120, 60, 240, 80, 90, 160, 180, 108]);
    expect(tempoCandidates(120, { preferBpm: 62 })).toEqual([120, 60, 240, 80, 90, 160, 180]);
  });
});

describe('pickTempo', () => {
  it('sem evidência, fica o tempo aproximado (o primeiro), mesmo com pontuação menor', () => {
    const r = pickTempo([cand(100, 1), cand(50, 1.2), cand(200, 0.8)], {});
    expect(r).toEqual({ bpm: 100, alternatives: [50, 200] });
  });

  it('o dobro com bumbo no tempo e caixa um tempo depois (backbeat) ganha do aproximado', () => {
    const r = pickTempo([cand(80, 1, 0, 0), cand(40, 1.1), cand(160, 0.9, 0.9, 0.8)], {});
    expect(r).toEqual({ bpm: 160, alternatives: [80, 320] });
  });

  it('a metade com o backbeat ganha do aproximado', () => {
    expect(pickTempo([cand(128, 1, 0.3, 0.1), cand(64, 1.1, 0.9, 0.8), cand(256, 0.7)], {}).bpm).toBe(64);
  });

  it('backbeat fraco ou pouco maior que o do aproximado não troca a oitava', () => {
    expect(pickTempo([cand(80, 1), cand(160, 0.9, 0.5, 0.5)], {}).bpm).toBe(80);
    expect(pickTempo([cand(80, 1, 0.6, 0.6), cand(160, 0.9, 0.8, 0.8)], {}).bpm).toBe(80);
  });

  it('a evidência sozinha não escolhe fora de 40 a 240 BPM', () => {
    expect(pickTempo([cand(150, 1), cand(300, 0.9, 1, 1)], {}).bpm).toBe(150);
  });

  it('aproximado com ataque nos terços (3:2) troca pelo parente sem ataque nos terços', () => {
    const cands = [cand(84, 0.55, 0, 0, 0.99), cand(42, 0.63, 0, 0, 1), cand(168, 0.35, 0, 0, 0.98),
      cand(56, 0.22, 0, 0, 0.17), cand(63, 0.77, 0, 0, 0.03), cand(112, 0.2, 0, 0, 0.33), cand(126, 0.64, 0, 0, 0.03)];
    // 63 e 126 são da mesma família; fica o de pontuação vezes a preferência por ~110 BPM.
    expect(pickTempo(cands, {}).bpm).toBe(126);
  });

  it('sem ataque nos terços, a proporção não troca, mesmo com pontuação maior', () => {
    expect(pickTempo([cand(84, 0.5, 0, 0, 0.1), cand(126, 0.9, 0, 0, 0.02)], {}).bpm).toBe(84);
  });

  it('parente com pontuação bem menor que a do aproximado não troca', () => {
    expect(pickTempo([cand(84, 0.5, 0, 0, 0.99), cand(126, 0.3, 0, 0, 0.02)], {}).bpm).toBe(84);
  });

  it('preferBpm escolhe o candidato mais perto dele, mesmo com evidência contra', () => {
    const r = pickTempo([cand(80, 1), cand(40, 1.1), cand(160, 0.9, 0.9, 0.9)], { preferBpm: 82 });
    expect(r).toEqual({ bpm: 80, alternatives: [40, 160] });
  });

  it('preferBpm longe de todos (mais de 5%) fica de fora e vale a evidência', () => {
    expect(pickTempo([cand(80, 1), cand(160, 0.9, 0.9, 0.9)], { preferBpm: 120 }).bpm).toBe(160);
  });

  it('nearBpm fica com o candidato dele', () => {
    expect(pickTempo([cand(97, 1)], { nearBpm: 97 })).toEqual({ bpm: 97, alternatives: [48.5, 194] });
  });

  it('sem candidato, erro', () => {
    expect(() => pickTempo([], {})).toThrow();
  });
});

describe('compoundPulseBpm', () => {
  it('compasso simples (ou sem compasso): o pulso como veio', () => {
    expect(compoundPulseBpm({ bpm: 60, thirds: 0.9 }, undefined)).toBe(60);
    expect(compoundPulseBpm({ bpm: 60, thirds: 0.9 }, '3/4')).toBe(60);
  });

  it('pulso com ataque nos terços é semínima pontuada: a colcheia é o triplo', () => {
    expect(compoundPulseBpm({ bpm: 60, thirds: 0.6 }, '6/8')).toBe(180);
    expect(compoundPulseBpm({ bpm: 52, thirds: 0.26 }, '12/8')).toBe(156);
  });

  it('a metade da semínima pontuada também vira colcheia (o triplo cai na faixa de 90 a 240)', () => {
    expect(compoundPulseBpm({ bpm: 104, thirds: 0.34 }, '6/8')).toBe(156);
  });

  it('pulso sem ataque nos terços já é a colcheia', () => {
    expect(compoundPulseBpm({ bpm: 156, thirds: 0.14 }, '6/8')).toBe(156);
    expect(compoundPulseBpm({ bpm: 70, thirds: 0.02 }, '6/8')).toBe(140);
  });

  it('o BPM da música em colcheia, semínima ou semínima pontuada escolhe o nível da colcheia', () => {
    expect(compoundPulseBpm({ bpm: 60, thirds: 0.6 }, '6/8', 90)).toBe(180);
    expect(compoundPulseBpm({ bpm: 60, thirds: 0.6 }, '6/8', 60)).toBe(180);
    expect(compoundPulseBpm({ bpm: 60, thirds: 0.6 }, '6/8', 360)).toBe(360);
    expect(compoundPulseBpm({ bpm: 60, thirds: 0.6 }, '6/8', 45)).toBe(90);
  });
});

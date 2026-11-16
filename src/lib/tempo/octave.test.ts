// Andamento (M4): a oitava (metade, inteiro, dobro), as proporções 3:2 e 4:3, o
// compasso composto (6/8 e 12/8: grade em colcheia, BPM em semínima) e o BPM da
// música como referência suave (`preferBpm`: escolhe entre os candidatos do áudio e
// avisa quando não bate), sem mexer no refino rígido do Separador (`nearBpm`).
// Casos do relatório do metrônomo automático (src/test/tempoCases.ts).
import { describe, expect, it } from 'vitest';
import { detectBeatGrid, detectSongGrid, type BeatGridOptions, type SongGridDetection } from '../beatGrid';
import { legacyDetectBeatGrid } from '../../test/legacyBeatGrid';
import { caseBeatsPerBar, caseTracks, tempoCase } from '../../test/tempoCases';
import { makeSong, type SynthSong } from '../../test/synthMusic';
import type { TimeSignature } from '../stageContracts';
import { eighthPulseBpm, pickTempo, tempoCandidates, type TempoCandidate } from './octave';

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

/** Onde cai o "1" da grade detectada (o primeiro), em segundos. A grade anda no pulso (`pulseBpm`). */
const primeiroUm = (g: SongGridDetection) => g.firstBeat + g.downbeat * (60 / g.pulseBpm);

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
  const comPrefer = (id: string, preferBpm: number) => {
    const { grid } = detect(id, { beatsPerBar: 4, preferBpm });
    return { bpm: Math.round(grid.bpm * 10) / 10, preferConflict: grid.preferConflict };
  };

  it('com preferBpm escolhe a oitava dele', () => {
    expect(comPrefer('b', 60)).toEqual({ bpm: 60, preferConflict: false });
    expect(comPrefer('t_160', 80)).toEqual({ bpm: 80, preferConflict: false });
    expect(comPrefer('t_64', 128)).toEqual({ bpm: 128, preferConflict: false });
  }, LENTO);

  it('preferBpm é suave: o BPM ainda sai da música, não fica preso ao de referência', () => {
    // Com nearBpm 118 o refino fica em volta de 118 (no máximo ~119,1); com preferBpm acha o 120.
    expect(comPrefer('b', 118)).toEqual({ bpm: 120, preferConflict: false });
    expect(comPrefer('c1', 72)).toEqual({ bpm: 72.5, preferConflict: false });
  }, LENTO);

  it('BPM salvo que não bate com o áudio: vale o andamento do áudio e avisa (preferConflict)', () => {
    // f1 com 120 seria uma grade 4:3 (ataque nos terços); b com 100 não tem parente nenhum; b com 90 é 3:4.
    expect(comPrefer('f1', 120)).toEqual({ bpm: 90, preferConflict: true });
    expect(comPrefer('b', 100)).toEqual({ bpm: 120, preferConflict: true });
    expect(comPrefer('b', 90)).toEqual({ bpm: 120, preferConflict: true });
  }, LENTO);

  it('sem preferBpm não há aviso', () => {
    expect(detect('b').grid.preferConflict).toBe(false);
  }, LENTO);

  it('tercina (72) com o BPM salvo no 3:2 dela (108): o salvo escolhe a família e avisa (preferChoseFamily)', () => {
    const r = (opts: Opcoes) => {
      const { grid } = detect('tercina-72', { beatsPerBar: 4, ...opts });
      return { bpm: Math.round(grid.bpm * 10) / 10, preferConflict: grid.preferConflict, preferChoseFamily: grid.preferChoseFamily ?? false };
    };
    expect(r({ preferBpm: 108 })).toEqual({ bpm: 108, preferConflict: false, preferChoseFamily: true });
    // O salvo que bate com o áudio, ou nenhum salvo: o campo fica desligado.
    expect(r({ preferBpm: 72 })).toEqual({ bpm: 72, preferConflict: false, preferChoseFamily: false });
    expect(r({})).toEqual({ bpm: 72, preferConflict: false, preferChoseFamily: false });
    // O campo só aparece quando liga.
    expect('preferChoseFamily' in detect('tercina-72', { beatsPerBar: 4, preferBpm: 72 }).grid).toBe(false);
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
  // Unidade (Ruling T3-BPM): `bpm` e `alternatives` sempre em semínima (o que mostrar e
  // salvar); a grade anda no pulso (`pulseBpm`, colcheia no 6/8 e no 12/8).
  const unidades = (g: SongGridDetection) => ({ bpm: Math.round(g.bpm * 10) / 10, pulseBpm: Math.round(g.pulseBpm * 10) / 10 });

  it('6/8 pedido em 6/8: grade em colcheia (180) com o acento a cada compasso, BPM em semínima (90)', () => {
    const { song, grid } = detect('f3', { signature: '6/8' });
    const colcheia = 60 / 180;
    expect(unidades(grid)).toEqual({ bpm: 90, pulseBpm: 180 });
    expect(Math.abs(foraDaGrade(grid.firstBeat, song.firstBeat, colcheia))).toBeLessThan(0.010);
    // O "1" cai no começo de um compasso de 6 colcheias.
    expect(Math.abs(foraDaGrade(primeiroUm(grid), song.firstBeat, 6 * colcheia))).toBeLessThan(0.010);
    expect(grid.alternatives).toEqual([45, 180]);
  }, LENTO);

  it('12/8 pedido em 12/8 também fica em colcheia', () => {
    expect(unidades(detect('f3', { signature: '12/8' }).grid)).toEqual({ bpm: 90, pulseBpm: 180 });
  }, LENTO);

  it('6/8 sem compasso pedido continua no pulso de semínima pontuada (60), como hoje', () => {
    expect(unidades(detect('f3', { beatsPerBar: 6 }).grid)).toEqual({ bpm: 60, pulseBpm: 60 });
  }, LENTO);

  it('signature 3/4 sem beatsPerBar acha o 1 a cada 3', () => {
    const { song, grid } = detect('f1', { signature: '3/4' });
    const tempo = 60 / 90;
    expect(unidades(grid)).toEqual({ bpm: 90, pulseBpm: 90 });
    expect(Math.abs(foraDaGrade(primeiroUm(grid), song.firstBeat, 3 * tempo))).toBeLessThan(0.010);
  }, LENTO);

  it('6/8: o BPM da música é lido em semínima; outra leitura não vale e avisa', () => {
    const r = (preferBpm: number) => {
      const { grid } = detect('f3', { signature: '6/8', preferBpm });
      return { ...unidades(grid), preferConflict: grid.preferConflict };
    };
    expect(r(90)).toEqual({ bpm: 90, pulseBpm: 180, preferConflict: false });
    // 45 em semínima = colcheia 90: a oitava é do BPM salvo.
    expect(r(45)).toEqual({ bpm: 45, pulseBpm: 90, preferConflict: false });
    // 60 seria a semínima pontuada: não é a convenção, então vale o áudio e avisa.
    expect(r(60)).toEqual({ bpm: 90, pulseBpm: 180, preferConflict: true });
  }, LENTO);

  // Ruling M4-x8: em todo x/8 o pulso é a colcheia, inclusive no 7/8 (simples).
  it.each([
    { nome: 'pulso já na colcheia (140)', bpm: 140 },
    { nome: 'pulso na semínima (70): vai pra colcheia', bpm: 70 },
  ])('7/8 com colcheia a 140, sem BPM salvo: bpm 70 e pulseBpm 140 ($nome)', ({ bpm }) => {
    const s = makeSong({ sr: 48000, duration: 60, bpm, firstBeat: 0.3, withPad: false, withBass: false });
    const grid = detectSongGrid([{ id: 'bat', label: 'Bateria', use: 'pulse', channels: s.tracks.drums }], 48000, { signature: '7/8' });
    expect(unidades(grid)).toEqual({ bpm: 70, pulseBpm: 140 });
    expect(grid.alternatives).toEqual([35, 140]);
  }, LENTO);

  it('nearBpm no composto também é lido em semínima (refino rígido em volta da colcheia)', () => {
    expect(unidades(detect('f3', { signature: '6/8', nearBpm: 90 }).grid)).toEqual({ bpm: 90, pulseBpm: 180 });
  }, LENTO);

  it('grade de reserva na mesma convenção: BPM em semínima e o pulso pela conversão', () => {
    const vazio = [new Float32Array(48000 * 5)];
    const reserva = (opts: Opcoes) => detectSongGrid([{ id: 'x', label: '', use: 'pulse', channels: vazio }], 48000, opts);
    expect(reserva({ signature: '6/8', preferBpm: 78 })).toEqual({
      bpm: 78, pulseBpm: 156, firstBeat: 0, downbeat: 0, confidence: 0,
      offbeatRisk: false, preferConflict: false, alternatives: [], tracksUsed: [],
    });
    // Fora de 30 a 300 o BPM salvo não vale nem pra reserva.
    expect(reserva({ preferBpm: 1000 })).toMatchObject({ bpm: 120, pulseBpm: 120 });
  });
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

});

describe('pickTempo', () => {
  it('sem evidência, fica o tempo aproximado (o primeiro), mesmo com pontuação menor', () => {
    const r = pickTempo([cand(100, 1), cand(50, 1.2), cand(200, 0.8)], {});
    expect(r).toEqual({ bpm: 100, alternatives: [50, 200], preferConflict: false, preferChoseFamily: false });
  });

  it('o dobro com bumbo no tempo e caixa um tempo depois (backbeat) ganha do aproximado', () => {
    const r = pickTempo([cand(80, 1, 0, 0), cand(40, 1.1), cand(160, 0.9, 0.9, 0.8)], {});
    expect(r).toEqual({ bpm: 160, alternatives: [80, 320], preferConflict: false, preferChoseFamily: false });
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

  it('na oitava o preferBpm decide, mesmo com o backbeat contra', () => {
    const r = pickTempo([cand(80, 1), cand(40, 1.1), cand(160, 0.9, 0.9, 0.9)], { preferBpm: 82 });
    expect(r).toEqual({ bpm: 80, alternatives: [40, 160], preferConflict: false, preferChoseFamily: false });
  });

  it('preferBpm longe de todos (mais de 5%): vale a evidência e avisa', () => {
    expect(pickTempo([cand(80, 1), cand(160, 0.9, 0.9, 0.9)], { preferBpm: 120 })).toMatchObject({ bpm: 160, preferConflict: true });
  });

  it('na família 3:2 manda a evidência: aproximado sem ataque nos terços recusa a troca que o preferBpm pede', () => {
    const cands = [cand(104, 0.36, 0, 0, 0.1), cand(78, 0.28, 0, 0, 0.11), cand(156, 0.26, 0, 0, 0.12)];
    expect(pickTempo(cands, { preferBpm: 78 })).toMatchObject({ bpm: 104, preferConflict: true });
  });

  it('terços ambíguos no aproximado: o preferBpm desempata pelo parente limpo', () => {
    // Como a Fé real (6/8 sem compasso pedido): aproximado 104 com terços 0,34, parentes 78 e 156 limpos.
    const cands = [cand(104, 0.36, 0, 0, 0.34), cand(52, 0.5, 0, 0, 0.26), cand(208, 0.19, 0, 0, 0.41),
      cand(78, 0.28, 0, 0, 0.11), cand(156, 0.26, 0, 0, 0.12)];
    expect(pickTempo(cands, { preferBpm: 78 })).toMatchObject({ bpm: 78, preferConflict: false, preferChoseFamily: true });
    expect(pickTempo(cands, { preferBpm: 156 })).toMatchObject({ bpm: 156, preferConflict: false, preferChoseFamily: true });
    // O salvo no próprio aproximado não escolhe família; sem o BPM da música, terços ambíguos não trocam.
    expect(pickTempo(cands, { preferBpm: 104 })).toMatchObject({ bpm: 104, preferConflict: false, preferChoseFamily: false });
    expect(pickTempo(cands, {})).toMatchObject({ bpm: 104, preferChoseFamily: false });
  });

  it('terços ambíguos: parente com ataque nos terços ou com pontuação baixa não serve pro desempate', () => {
    expect(pickTempo([cand(104, 0.36, 0, 0, 0.34), cand(78, 0.28, 0, 0, 0.6)], { preferBpm: 78 })).toMatchObject({ bpm: 104, preferConflict: true });
    expect(pickTempo([cand(104, 0.36, 0, 0, 0.34), cand(78, 0.1, 0, 0, 0.1)], { preferBpm: 78 })).toMatchObject({ bpm: 104, preferConflict: true });
  });

  it('troca 3:2 pela evidência: o preferBpm no aproximado recusado não vale, mas escolhe a oitava da troca', () => {
    const cands = [cand(84, 0.55, 0, 0, 0.99), cand(42, 0.63, 0, 0, 1), cand(168, 0.35, 0, 0, 0.98),
      cand(63, 0.77, 0, 0, 0.03), cand(126, 0.64, 0, 0, 0.03)];
    // A família veio da evidência (terços altos), não do salvo: preferChoseFamily fica desligado.
    expect(pickTempo(cands, { preferBpm: 84 })).toMatchObject({ bpm: 126, preferConflict: true, preferChoseFamily: false });
    expect(pickTempo(cands, { preferBpm: 63 })).toMatchObject({ bpm: 63, preferConflict: false, preferChoseFamily: false });
  });

  it('nearBpm fica com o candidato dele', () => {
    expect(pickTempo([cand(97, 1)], { nearBpm: 97 })).toEqual({ bpm: 97, alternatives: [48.5, 194], preferConflict: false, preferChoseFamily: false });
  });

  it('sem candidato, erro', () => {
    expect(() => pickTempo([], {})).toThrow();
  });
});

describe('eighthPulseBpm (tudo em BPM do pulso: a colcheia em x/8)', () => {
  const colcheia = (bpm: number, thirds: number, sig: TimeSignature | undefined, preferPulseBpm?: number) =>
    eighthPulseBpm({ bpm, thirds }, sig, preferPulseBpm);

  it('compasso x/4 (ou sem compasso): o pulso como veio', () => {
    expect(colcheia(60, 0.9, undefined)).toEqual({ bpm: 60, preferConflict: false });
    expect(colcheia(60, 0.9, '3/4')).toEqual({ bpm: 60, preferConflict: false });
  });

  it('7/8 (x/8 simples): o pulso vai pra faixa da colcheia, sem o triplo da semínima pontuada', () => {
    expect(colcheia(70, 0.05, '7/8')).toEqual({ bpm: 140, preferConflict: false });
    expect(colcheia(140, 0.05, '7/8')).toEqual({ bpm: 140, preferConflict: false });
    // Ataque nos terços não vira triplo fora do composto.
    expect(colcheia(60, 0.6, '7/8')).toEqual({ bpm: 120, preferConflict: false });
    expect(colcheia(70, 0.05, '7/8', 70)).toEqual({ bpm: 70, preferConflict: false });
    expect(colcheia(70, 0.05, '7/8', 100)).toEqual({ bpm: 140, preferConflict: true });
  });

  it('pulso com ataque nos terços é semínima pontuada: a colcheia é o triplo', () => {
    expect(colcheia(60, 0.6, '6/8').bpm).toBe(180);
    expect(colcheia(52, 0.26, '12/8').bpm).toBe(156);
  });

  it('a metade da semínima pontuada também vira colcheia (o triplo cai na faixa de 90 a 240)', () => {
    expect(colcheia(104, 0.34, '6/8').bpm).toBe(156);
  });

  it('pulso sem ataque nos terços já é a colcheia', () => {
    expect(colcheia(156, 0.14, '6/8').bpm).toBe(156);
    expect(colcheia(70, 0.02, '6/8').bpm).toBe(140);
  });

  it('o BPM salvo (já convertido pra colcheia) escolhe a oitava da colcheia quando bate a até 5%', () => {
    expect(colcheia(60, 0.6, '6/8', 180)).toEqual({ bpm: 180, preferConflict: false });
    expect(colcheia(60, 0.6, '6/8', 360)).toEqual({ bpm: 360, preferConflict: false });
    expect(colcheia(60, 0.6, '6/8', 90)).toEqual({ bpm: 90, preferConflict: false });
    // Semínima de 90 e de 135 com o aproximado na semínima: a colcheia é 180 e 270.
    expect(colcheia(90, 0.05, '6/8', 180)).toEqual({ bpm: 180, preferConflict: false });
    expect(colcheia(135, 0.05, '6/8', 270)).toEqual({ bpm: 270, preferConflict: false });
  });

  it('BPM salvo sem nível a até 5%: fica a colcheia do áudio e avisa', () => {
    expect(colcheia(60, 0.6, '6/8', 120)).toEqual({ bpm: 180, preferConflict: true });
  });
});

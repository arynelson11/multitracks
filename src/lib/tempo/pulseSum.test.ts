// Várias faixas de pulso somadas (Ruling M1-a) e as bandas de bumbo e caixa
// (M2). O kit separado (KICK, SNARE, HIHAT) é o e1 do relatório em três faixas.
import { describe, expect, it } from 'vitest';
import { detectSongGrid } from '../beatGrid';
import { caseTracks, expectedBpm, firstBeatError, tempoCase } from '../../test/tempoCases';
import { makeSong } from '../../test/synthMusic';
import { onsetBands, sumOnsetBands, type OnsetBands } from './onsets';

const SR = 48000;
const LENTO = 30_000;

describe('kit separado somado', () => {
  it('kit separado (KICK, SNARE, HIHAT) somado acha o tempo que a peça sozinha não acha', () => {
    const c = tempoCase('kit-separado');
    const song = c.song({ votes: false });
    const tracks = caseTracks(c, song);
    const bpm = expectedBpm(c, song);
    const acha = (g: { bpm: number; firstBeat: number }) =>
      Math.abs(g.bpm - bpm) < 0.05 && Math.abs(firstBeatError(c, song, g.firstBeat)) < 0.010;

    const somado = detectSongGrid(tracks, SR, { beatsPerBar: 4 });
    expect(somado.tracksUsed).toEqual(['kick', 'snare', 'hihat']);
    expect(acha(somado)).toBe(true);
    // Sozinhos: o bumbo e o chimbal caem no contratempo, a caixa (só 2 e 4) erra o BPM.
    for (const t of tracks) expect({ peca: t.id, acha: acha(detectSongGrid([t], SR, { beatsPerBar: 4 })) }).toEqual({ peca: t.id, acha: false });
  }, LENTO);

  // A banda grave do "1" só vem das peças com bumbo: o vazamento grave do chimbal e
  // da caixa, dividido pelo próprio máximo, pesaria tanto quanto o bumbo.
  it.each([
    { id: 'x_kicksync', song: { bpm: 92, firstBeat: 0.5, pattern: 'kicksync44' as const } },
    { id: 'x_popsync', song: { bpm: 84, firstBeat: 0.5, pattern: 'popsync44' as const } },
  ])('$id: o kit separado acha o "1" igual à bateria inteira', ({ song: opts }) => {
    const s = makeSong({ sr: SR, duration: 60, withPad: false, withBass: false, splitKit: true, ...opts });
    const kit = s.tracks.kit;
    if (!kit) throw new Error('sem kit');
    const inteira = detectSongGrid([{ id: 'bat', label: 'Bateria', use: 'pulse', channels: s.tracks.drums }], SR, { beatsPerBar: 4 });
    const somado = detectSongGrid([
      { id: 'kick', label: 'KICK', use: 'pulse', channels: kit.kick },
      { id: 'snare', label: 'SNARE', use: 'pulse', channels: kit.snare },
      { id: 'hihat', label: 'HIHAT', use: 'pulse', channels: kit.hihat },
    ], SR, { beatsPerBar: 4 });
    // Em que tempo do compasso real cai o "1" detectado (0 = certo).
    const posicao = (g: { bpm: number; firstBeat: number; downbeat: number }) => {
      const P = 60 / s.bpm;
      return ((Math.round((g.firstBeat + g.downbeat * P - s.firstBeat) / P) % 4) + 4) % 4;
    };
    expect(somado.bpm).toBe(inteira.bpm);
    expect(posicao(inteira)).toBe(0);
    expect(posicao(somado)).toBe(0);
  }, LENTO);

  it('uma faixa de pulso de 6 s não corta a bateria de 4 min: mesma grade e mesma confiança', () => {
    // 22,05 kHz pra caber 4 min na memória do teste; a análise trabalha em ~200 quadros/s em qualquer taxa.
    const sr = 22050;
    const s = makeSong({ sr, duration: 240, bpm: 120, firstBeat: 1.37, withPad: false, withBass: false });
    const bateria = { id: 'bat', label: 'Bateria', use: 'pulse' as const, channels: s.tracks.drums };
    const curta = { id: 'loop', label: 'Loop', use: 'pulse' as const, channels: s.tracks.shaker.map(c => c.slice(0, sr * 6)) };
    const so = detectSongGrid([bateria], sr);
    const somado = detectSongGrid([bateria, curta], sr);
    expect(somado.tracksUsed).toEqual(['bat', 'loop']);
    expect(somado.bpm).toBe(so.bpm);
    expect(Math.abs(somado.firstBeat - so.firstBeat)).toBeLessThanOrEqual(0.001);
    expect(somado.confidence).toBeGreaterThanOrEqual(so.confidence - 0.05);
    expect(so.bpm).toBe(120);
  }, LENTO);

  it('a faixa de pulso que não dá pra medir fica de fora e a seguinte vale', () => {
    const c = tempoCase('b');
    const song = c.song({ votes: false });
    const [bateria] = caseTracks(c, song);
    const r = detectSongGrid([
      { id: 'curta', label: 'Loop', use: 'pulse', channels: [new Float32Array(SR * 2)] },
      { id: 'vazia', label: 'Perc', use: 'pulse', channels: [] },
      { ...bateria, id: 'bat' },
    ], SR);
    expect(r.tracksUsed).toEqual(['bat']);
    const so = detectSongGrid([{ ...bateria, id: 'bat' }], SR);
    expect(r).toEqual(so);
    expect(r.bpm).toBe(120);
  }, LENTO);

  it('tracksUsed lista todas as faixas de pulso, depois o baixo e a harmonia', () => {
    const s = makeSong({ sr: SR, duration: 20, bpm: 104, firstBeat: 0.55, splitKit: true });
    const kit = s.tracks.kit;
    if (!kit) throw new Error('sem kit');
    const r = detectSongGrid([
      { id: 'pad', label: 'Pad', use: 'harmony', channels: s.tracks.pad },
      { id: 'kick', label: 'KICK', use: 'pulse', channels: kit.kick },
      { id: 'bx', label: 'Baixo', use: 'bass', channels: s.tracks.bass },
      { id: 'snare', label: 'SNARE', use: 'pulse', channels: kit.snare },
      { id: 'hh', label: 'HIHAT', use: 'pulse', channels: kit.hihat },
    ], SR);
    expect(r.tracksUsed).toEqual(['kick', 'snare', 'hh', 'bx', 'pad']);
    expect(r.bpm).toBeCloseTo(104, 1);
  }, LENTO);
});

describe('sumOnsetBands', () => {
  const banda = (vals: number[]) => Float32Array.from(vals);
  const b = (o: Partial<OnsetBands>): OnsetBands => ({
    fps: 200, full: banda([0, 0, 0]), low: banda([0, 0, 0]), kick: banda([0, 0, 0]), snare: banda([0, 0, 0]),
    hasKick: false, hasSnare: false, ...o,
  });

  it('com uma faixa só, devolve ela mesma', () => {
    const uma = b({ full: banda([1, 2, 3]) });
    expect(sumOnsetBands([uma])).toBe(uma);
  });

  it('divide cada banda pelo próprio máximo e soma banda a banda, no tamanho da mais longa (a curta completa com zeros)', () => {
    const r = sumOnsetBands([
      b({ full: banda([2, 4, 0, 8]), kick: banda([0, 10, 0, 0]), hasKick: true }),
      b({ full: banda([0.1, 0, 0.1]), snare: banda([3, 0, 0]), hasSnare: true }),
    ]);
    expect(Array.from(r.full)).toEqual([1.25, 0.5, 1, 1]);
    expect(Array.from(r.kick)).toEqual([0, 1, 0, 0]);
    expect(Array.from(r.snare)).toEqual([1, 0, 0, 0]);
    expect(Array.from(r.low)).toEqual([0, 0, 0, 0]);
    expect(r.hasKick).toBe(true);
    expect(r.hasSnare).toBe(true);
    expect(r.fps).toBe(200);
  });

  it('a banda grave só soma as faixas com bumbo (sem nenhuma, soma todas)', () => {
    const kick = b({ low: banda([0, 2, 0]), hasKick: true });
    const chimbal = b({ low: banda([5, 0, 0]) });
    expect(Array.from(sumOnsetBands([kick, chimbal]).low)).toEqual([0, 1, 0]);
    expect(Array.from(sumOnsetBands([chimbal, b({ low: banda([0, 0, 3]) })]).low)).toEqual([1, 0, 1]);
  });

  it('recusa lista vazia e taxas diferentes', () => {
    expect(() => sumOnsetBands([])).toThrow();
    expect(() => sumOnsetBands([b({}), b({ fps: 199.55 })])).toThrow();
  });
});

describe('bandas de bumbo e caixa (onsetBands)', () => {
  it('cada peça do kit acende só a banda dela', () => {
    const s = makeSong({ sr: SR, duration: 10, bpm: 104, firstBeat: 0.55, splitKit: true, withPad: false, withBass: false });
    const kit = s.tracks.kit;
    if (!kit) throw new Error('sem kit');
    const presenca = (ch: Float32Array[]) => {
      const o = onsetBands(ch, SR);
      return o && { bumbo: o.hasKick, caixa: o.hasSnare };
    };
    expect(presenca(kit.kick)).toEqual({ bumbo: true, caixa: false });
    expect(presenca(kit.snare)).toEqual({ bumbo: false, caixa: true });
    expect(presenca(kit.hihat)).toEqual({ bumbo: false, caixa: false });
    expect(presenca(s.tracks.drums)).toEqual({ bumbo: true, caixa: true });
    expect(presenca(s.tracks.shaker)).toEqual({ bumbo: false, caixa: false });
    // Banda ausente vem zerada.
    const hh = onsetBands(kit.hihat, SR);
    expect(hh?.kick.every(v => v === 0)).toBe(true);
    expect(hh?.snare.every(v => v === 0)).toBe(true);
  });

  it('o golpe em 0,000 conta (caso a)', () => {
    const c = tempoCase('a');
    const song = c.song({ votes: false });
    const o = onsetBands(caseTracks(c, song)[0].channels, SR);
    if (!o) throw new Error('sem bandas');
    // Pico de cada banda perto de cada tempo (até 3 quadros depois), do 2º tempo em diante.
    const picoPerto = (arr: Float32Array, t: number) => {
      const i = Math.round(t * o.fps);
      let m = 0;
      for (let k = Math.max(0, i - 1); k <= i + 3 && k < arr.length; k++) m = Math.max(m, arr[k]);
      return m;
    };
    const mediana = (vals: number[]) => [...vals].sort((x, y) => x - y)[vals.length >> 1];
    // Banda cheia: o 1º golpe (bumbo e chimbal em 0,000) contra os outros tempos.
    const cheia = mediana(song.beats.slice(1, 40).map(t => picoPerto(o.full, t)));
    expect(picoPerto(o.full, 0)).toBeGreaterThanOrEqual(0.5 * cheia);
    // Bumbo: no rock ele cai no 1 e no 3 (tempos pares contando do 0).
    const bumbo = mediana(song.beats.slice(2, 40).filter((_, k) => k % 2 === 0).map(t => picoPerto(o.kick, t)));
    expect(picoPerto(o.kick, 0)).toBeGreaterThanOrEqual(0.5 * bumbo);
  });
});

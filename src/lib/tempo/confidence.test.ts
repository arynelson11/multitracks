// Confiança contra controle (M2): a grade comparada com a mesma busca de fase em
// versões da faixa com blocos de 2 s embaralhados, e o corte calibrado com os
// casos do relatório (src/test/tempoCases.ts).
import { beforeAll, describe, expect, it } from 'vitest';
import { detectSongGrid } from '../beatGrid';
import { TEMPO_CASES, caseBeatsPerBar, caseTracks, type TempoCase } from '../../test/tempoCases';
import { CONFIDENCE_CUT, measureConfidence } from './confidence';

const confiancas = new Map<string, number>();
const confianca = (c: TempoCase): number => {
  const v = confiancas.get(c.id);
  if (v === undefined) throw new Error(`sem confiança medida pra ${c.id}`);
  return v;
};

beforeAll(() => {
  for (const c of TEMPO_CASES) {
    const song = c.song({ votes: false });
    confiancas.set(c.id, detectSongGrid(caseTracks(c, song), song.sr, { beatsPerBar: caseBeatsPerBar(c, song) }).confidence);
  }
}, 180_000);

describe('corte de confiança nos casos do relatório', () => {
  it('cada grupo tem positivos e negativos (e todo tipo de negativo aparece nos dois)', () => {
    for (const g of ['calibracao', 'validacao'] as const) {
      const grupo = TEMPO_CASES.filter(c => c.group === g);
      expect(grupo.filter(c => c.positive).length).toBeGreaterThanOrEqual(10);
      expect(grupo.filter(c => !c.positive).length).toBeGreaterThanOrEqual(5);
    }
    for (const tipo of ['ruido-branco', 'pad-por-compasso', 'baixo-por-compasso', 'voz-glissando', 'bateria-afogada']) {
      const grupos = new Set(TEMPO_CASES.filter(c => !c.positive && c.id.startsWith(tipo)).map(c => c.group));
      expect({ tipo, grupos: [...grupos].sort() }).toEqual({ tipo, grupos: ['calibracao', 'validacao'] });
    }
  });

  // Sem números fixos dos casos (mudam com qualquer ajuste nos ataques): só a ordem,
  // com folga. Os valores medidos na calibração ficam anotados na constante.
  it('o corte fica no vão do grupo de calibração, com folga dos dois lados', () => {
    const cal = TEMPO_CASES.filter(c => c.group === 'calibracao');
    const maiorNegativo = Math.max(...cal.filter(c => !c.positive).map(confianca));
    const menorPositivo = Math.min(...cal.filter(c => c.positive).map(confianca));
    const FOLGA = 0.1;
    expect(maiorNegativo + FOLGA).toBeLessThanOrEqual(CONFIDENCE_CUT);
    expect(CONFIDENCE_CUT + FOLGA).toBeLessThanOrEqual(menorPositivo);
  });

  it('corte calibrado no grupo de calibração separa o grupo de validação', () => {
    const val = TEMPO_CASES.filter(c => c.group === 'validacao');
    expect(Math.max(...val.filter(c => !c.positive).map(confianca))).toBeLessThan(CONFIDENCE_CUT);
    expect(Math.min(...val.filter(c => c.positive).map(confianca))).toBeGreaterThanOrEqual(CONFIDENCE_CUT);
  });

  it('ruído, pad, voz e bateria afogada ficam longe do corte (hoje davam 0,16 a 0,63)', () => {
    for (const id of ['ruido-branco', 'pad-por-compasso', 'voz-glissando', 'bateria-afogada-m10db', 'bateria-afogada-m20db', 'bateria-afogada-m30db']) {
      const c = TEMPO_CASES.find(x => x.id === id);
      if (!c) throw new Error(id);
      expect({ id, baixa: confianca(c) < 0.2 }).toEqual({ id, baixa: true });
    }
  });
});

// ── measureConfidence com ataques montados à mão (sem áudio) ──

const FPS = 200;

function sorteio(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

describe('measureConfidence', () => {
  it('pulso regular em 60 s dá confiança cheia (também quando 2 s fecham tempos inteiros, como em 120 BPM)', () => {
    for (const periodo of [100, 97.3]) {
      const o = new Float32Array(FPS * 60);
      for (let x = 10; x < o.length; x += periodo) o[Math.round(x)] = 1;
      expect({ periodo, c: measureConfidence(o, periodo, 10, FPS) }).toEqual({ periodo, c: 1 });
    }
  });

  it('ataques ao acaso ficam bem abaixo do corte', () => {
    const r = sorteio(3);
    const o = new Float32Array(FPS * 60);
    for (let i = 0; i < o.length; i++) if (r() < 0.02) o[i] = r();
    expect(measureConfidence(o, 100, 0, FPS)).toBeLessThan(CONFIDENCE_CUT / 2);
  });

  it('silêncio, período inválido e faixa menor que 2 blocos dão 0', () => {
    expect(measureConfidence(new Float32Array(FPS * 60), 100, 0, FPS)).toBe(0);
    const o = new Float32Array(FPS * 60).fill(0.1);
    expect(measureConfidence(o, 0, 0, FPS)).toBe(0);
    expect(measureConfidence(o, 100, 0, 0)).toBe(0);
    expect(measureConfidence(new Float32Array(FPS * 3).fill(1), 100, 0, FPS)).toBe(0);
  });

  it('a semente é fixa: a mesma faixa dá sempre a mesma confiança', () => {
    const r = sorteio(9);
    const o = new Float32Array(FPS * 30);
    for (let i = 0; i < o.length; i++) o[i] = (i % 113 === 5 ? 1 : 0) + 0.3 * r();
    expect(measureConfidence(o, 113, 5, FPS)).toBe(measureConfidence(o, 113, 5, FPS));
  });
});

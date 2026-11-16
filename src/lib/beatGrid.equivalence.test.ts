// Equivalência do detector de tempo em etapas (src/lib/tempo/) com a cópia
// congelada do detector antigo (src/test/legacyBeatGrid.ts), nas músicas
// sintéticas do relatório .superpowers/sdd/metronomo-auto-investigacao.md, e um
// teste de fumaça do sintetizador e da sonda de click.
//
// Regra pras tarefas seguintes do Grupo M: um caso que mudar de resultado por
// causa de uma correção sai desta lista e vira teste da tarefa, com o motivo.
//
// M2: a confiança saiu da comparação (virou medida contra controle, com outro
// corte; testada em src/lib/tempo/confidence.test.ts). BPM, 1º tempo e o "1"
// continuam iguais em todos os casos daqui. O teste "só a primeira faixa de pulso
// entra na conta" saiu: as faixas de pulso agora somam (src/lib/tempo/pulseSum.test.ts).
//
// M4: a etapa do andamento testa metade, dobro e as proporções 3:2 e 4:3, mas nenhum
// caso daqui muda de BPM (nem o 6/8 sem compasso pedido, que continua em 60). O
// detectSongGrid passa a oferecer a metade e o dobro em `alternatives`.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { generateManualClickTrackFromSample } from './AudioAnalyzer';
import { detectBeatGrid, detectSongGrid, type BeatGrid, type BeatGridOptions } from './beatGrid';
import { legacyDetectBeatGrid } from '../test/legacyBeatGrid';
import { makeSong, type SongOptions } from '../test/synthMusic';
import { detectClicks, evaluate, mixToMono, parseWav } from '../test/clickProbe';

const SR = 48000;
// 1 min basta: a conta é a mesma de 5 min (o relatório usou 300 s) e o teste fica rápido.
const DURACAO = 60;
// Cada caso sintetiza 1 min e roda os dois detectores (~1,5 s; mais com a máquina carregada).
const LENTO = 20_000;

interface Caso {
  nome: string;
  song: SongOptions;
  beatsPerBar: number;
  /** Taxa da faixa. Padrão 48 kHz. */
  sr?: number;
  /** BPM em que o detector antigo trava, quando não é o da música (6/8 sai no pulso de semínima pontuada). */
  bpmTravado?: number;
}

// Os 8 casos do relatório que a M1 congela (tabela da seção 2), mais os que a
// revisão da M1 pediu antes de mudar o detector: 44,1 kHz (hop de 221, fps não
// inteiro) e os compassos 5, 6, 7 e 12 (ramos par e ímpar da regra do "1").
const CASOS: Caso[] = [
  { nome: 'b: 1º tempo em 1,37 s, 120 BPM', song: { bpm: 120, firstBeat: 1.37 }, beatsPerBar: 4 },
  { nome: 'c: BPM decimal 72,5', song: { bpm: 72.5, firstBeat: 0.43 }, beatsPerBar: 4 },
  { nome: 'c: BPM decimal 135,04', song: { bpm: 135.04, firstBeat: 0.21 }, beatsPerBar: 4 },
  { nome: 'd: intro de 8 compassos só com pad, bateria no 9 (100 BPM)', song: { bpm: 100, firstBeat: 0.62, introBars: 8 }, beatsPerBar: 4 },
  { nome: 'e: pop sincopado leve, 84 BPM', song: { bpm: 84, firstBeat: 0.5, pattern: 'popsync44' }, beatsPerBar: 4 },
  { nome: 'f: valsa 3/4, 90 BPM, compasso pedido 3/4', song: { bpm: 90, firstBeat: 0.3, pattern: 'waltz34' }, beatsPerBar: 3 },
  { nome: 'g: bateria a -40 dB', song: { bpm: 120, firstBeat: 0.8, gain: 0.01 }, beatsPerBar: 4 },
  { nome: 'humanizado (±5 ms), 118 BPM', song: { bpm: 118, firstBeat: 0.8, jitterMs: 5 }, beatsPerBar: 4 },
  { nome: 'b a 44,1 kHz', song: { bpm: 120, firstBeat: 1.37 }, beatsPerBar: 4, sr: 44100 },
  { nome: 'c 72,5 a 44,1 kHz', song: { bpm: 72.5, firstBeat: 0.43 }, beatsPerBar: 4, sr: 44100 },
  { nome: '6/8 (colcheia 180), compasso pedido 6/8', song: { bpm: 180, firstBeat: 0.3, pattern: 'sixeight' }, beatsPerBar: 6, bpmTravado: 60 },
  { nome: '6/8 (colcheia 180), compasso pedido 12/8', song: { bpm: 180, firstBeat: 0.3, pattern: 'sixeight' }, beatsPerBar: 12, bpmTravado: 60 },
  { nome: 'rock 110 BPM, compasso pedido 5/4', song: { bpm: 110, firstBeat: 0.45 }, beatsPerBar: 5 },
  { nome: 'pop sincopado 84 BPM, compasso pedido 7/8', song: { bpm: 84, firstBeat: 0.5, pattern: 'popsync44' }, beatsPerBar: 7 },
];

// Pad e baixo não sorteiam nada, então tirar os dois não muda a bateria (e corta 2/3 do tempo).
const bateria = (song: SongOptions, sr = SR) => makeSong({ sr, duration: DURACAO, withPad: false, withBass: false, ...song }).tracks.drums;

function expectMesmaGrade(novo: BeatGrid, antigo: BeatGrid) {
  expect(Object.keys(novo).sort()).toEqual(['bpm', 'confidence', 'downbeat', 'firstBeat']);
  expect(Math.abs(novo.bpm - antigo.bpm)).toBeLessThanOrEqual(0.01);
  expect(Math.abs(novo.firstBeat - antigo.firstBeat)).toBeLessThanOrEqual(1e-6);
  expect(novo.downbeat).toBe(antigo.downbeat);
  // Confiança: medida nova desde a M2 (ver o cabeçalho); aqui só o intervalo.
  expect(novo.confidence).toBeGreaterThanOrEqual(0);
  expect(novo.confidence).toBeLessThanOrEqual(1);
}

describe('detectBeatGrid em etapas dá o mesmo resultado do detector antigo', () => {
  it.each(CASOS)('$nome', ({ song, beatsPerBar, sr = SR, bpmTravado }) => {
    const ch = bateria(song, sr);
    const opts: BeatGridOptions = { beatsPerBar };
    const antigo = legacyDetectBeatGrid(ch, sr, opts);
    // O caso trava no tempo certo (é o que o relatório mediu): a comparação não é vazia.
    expect(antigo.bpm).toBeCloseTo(bpmTravado ?? song.bpm, 1);
    expect(antigo.confidence).toBeGreaterThan(0.1);
    expectMesmaGrade(detectBeatGrid(ch, sr, opts), antigo);
  }, LENTO);

  // O Separador chama com o BPM digitado (busca fina de ±0,8% em volta dele).
  it.each([
    { nome: 'b com BPM de referência 119', song: CASOS[0].song, nearBpm: 119, beatsPerBar: 4 },
    { nome: 'c 72,5 com BPM de referência 72', song: CASOS[1].song, nearBpm: 72, beatsPerBar: 4 },
    { nome: 'f 3/4 com BPM de referência 90', song: CASOS[5].song, nearBpm: 90, beatsPerBar: 3 },
    { nome: 'b a 44,1 kHz com BPM de referência 119', song: CASOS[0].song, nearBpm: 119, beatsPerBar: 4, sr: 44100 },
  ])('$nome', ({ song, nearBpm, beatsPerBar, sr = SR }) => {
    const ch = bateria(song, sr);
    const opts: BeatGridOptions = { nearBpm, beatsPerBar };
    expectMesmaGrade(detectBeatGrid(ch, sr, opts), legacyDetectBeatGrid(ch, sr, opts));
  }, LENTO);

  it('sem áudio que dê pra medir, devolve a mesma grade de reserva', () => {
    const curto = [new Float32Array(SR * 3)];
    const entradas: [Float32Array[], number, BeatGridOptions][] = [
      [[], SR, {}],
      [[new Float32Array(0)], SR, {}],
      [curto, SR, {}],
      [curto, SR, { nearBpm: 97 }],
      // Taxa inválida: a reserva sai antes de olhar o áudio, então 5 s de silêncio bastam.
      [[new Float32Array(SR * 5)], 0, {}],
    ];
    for (const [ch, sr, opts] of entradas) {
      const novo = detectBeatGrid(ch, sr, opts);
      expect(novo).toEqual(legacyDetectBeatGrid(ch, sr, opts));
      expect(novo.confidence).toBe(0);
    }
  });
});

describe('detectSongGrid', () => {
  it('com uma faixa de pulso só, é o detectBeatGrid de hoje mais os campos novos', () => {
    const ch = bateria(CASOS[0].song);
    const r = detectSongGrid([{ id: 'bat', label: 'Bateria', use: 'pulse', channels: ch }], SR, { beatsPerBar: 4 });
    const { offbeatRisk, alternatives, tracksUsed, ...grade } = r;
    expect(grade).toEqual(detectBeatGrid(ch, SR, { beatsPerBar: 4 }));
    expect(offbeatRisk).toBe(false);
    expect(alternatives).toEqual([60, 240]);
    expect(tracksUsed).toEqual(['bat']);
  }, LENTO);

  it('baixo e harmonia viram votos do "1" (ainda não mudam o resultado; a M3 usa)', () => {
    const s = makeSong({ sr: SR, duration: DURACAO, ...CASOS[3].song });
    const so = detectSongGrid([{ id: 'bat', label: 'Bateria', use: 'pulse', channels: s.tracks.drums }], SR);
    const comVotos = detectSongGrid([
      { id: 'pad', label: 'Pad', use: 'harmony', channels: s.tracks.pad },
      { id: 'bx', label: 'Baixo', use: 'bass', channels: s.tracks.bass },
      { id: 'bat', label: 'Bateria', use: 'pulse', channels: s.tracks.drums },
    ], SR);
    expect({ ...comVotos, tracksUsed: [] }).toEqual({ ...so, tracksUsed: [] });
    expect(comVotos.tracksUsed).toEqual(['bat', 'bx', 'pad']);
  }, LENTO);

  it('sem faixa de pulso, devolve a grade de reserva sem confiança (no BPM de referência)', () => {
    // A reserva sai antes de olhar o áudio: 5 s bastam. O 97 (não o padrão 120) prova que o nearBpm é usado.
    const r = detectSongGrid([{ id: 'pad', label: 'Pad', use: 'harmony', channels: [new Float32Array(SR * 5)] }], SR, { nearBpm: 97 });
    expect(r).toEqual({ bpm: 97, firstBeat: 0, downbeat: 0, confidence: 0, offbeatRisk: false, alternatives: [], tracksUsed: [] });
  });
});

// ── Fumaça do sintetizador e da sonda ──────────────────────────────────────

const PUBLIC_DIR = fileURLToPath(new URL('../../public/', import.meta.url));

// Só o que generateManualClickTrackFromSample usa: decodificar a amostra de click
// (WAV na taxa do contexto, sem reamostrar) e fechar.
class FakeAudioContext {
  readonly sampleRate: number;
  constructor(opts: { sampleRate?: number } = {}) {
    this.sampleRate = opts.sampleRate ?? 48000;
  }
  async decodeAudioData(ab: ArrayBuffer) {
    const w = parseWav(ab);
    if (w.sampleRate !== this.sampleRate) throw new Error(`amostra a ${w.sampleRate} Hz, contexto a ${this.sampleRate} Hz`);
    return {
      sampleRate: w.sampleRate, numberOfChannels: w.numberOfChannels, length: w.frames,
      duration: w.frames / w.sampleRate, getChannelData: (c: number) => w.channels[c],
    };
  }
  async close() {}
}

async function fakeFetch(url: string) {
  const rel = decodeURIComponent(url.replace(/^\.?\//, ''));
  try {
    const buf = readFileSync(join(PUBLIC_DIR, rel));
    const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    return { ok: true, arrayBuffer: async () => ab };
  } catch {
    return { ok: false, arrayBuffer: async () => new ArrayBuffer(0) };
  }
}

/** Gera o click como o Metrônomo gera (Classic 1/4, acento no 1, 4/4) e devolve os clicks achados no WAV. */
async function clicksGerados(bpm: number, duration: number, grid: { firstBeat: number; downbeat: number }) {
  vi.stubGlobal('window', { AudioContext: FakeAudioContext });
  vi.stubGlobal('fetch', fakeFetch);
  let blob: Blob | null = null;
  vi.spyOn(URL, 'createObjectURL').mockImplementation((b) => {
    blob = b as Blob;
    return 'blob:teste';
  });
  await generateManualClickTrackFromSample('Classic', 'quarter', bpm, duration, true, '4/4', grid);
  if (!blob) throw new Error('o gerador não criou o WAV');
  const wav = parseWav(await (blob as Blob).arrayBuffer());
  expect(wav.sampleRate).toBe(44100);
  return detectClicks(mixToMono(wav.channels), wav.sampleRate);
}

describe('fumaça: synthMusic + clickProbe', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('rampMs 0 dá ataque instantâneo, sem NaN no áudio', () => {
    const s = makeSong({ sr: SR, duration: 6, bpm: 120, firstBeat: 0.5, withPad: false, withBass: false, rampMs: 0 });
    const drums = s.tracks.drums[0];
    expect(drums.some(Number.isNaN)).toBe(false);
    // Sem rampa, a amostra seguinte ao golpe já soa perto do pico do bumbo (0,9, mais
    // ou menos 0,36 do chimbal); com a rampa padrão de 0,3 ms ela ficaria em ~0,06.
    expect(Math.abs(drums[Math.round(0.5 * SR) + 1])).toBeGreaterThan(0.5);
  });

  it('caso b: o 1º golpe da bateria cai em 1,37 s e o click com a grade certa fica a menos de 4 ms', async () => {
    const song = makeSong({ sr: SR, duration: DURACAO, bpm: 120, firstBeat: 1.37, withPad: false, withBass: false });
    const drums = song.tracks.drums[0];
    expect(song.beats[0]).toBe(1.37);
    // A rampa de ataque começa do zero, então a 1ª amostra que soa vem 1 amostra depois do golpe.
    const primeiraQueSoa = drums.findIndex(v => v !== 0);
    expect(primeiraQueSoa).toBeGreaterThanOrEqual(Math.round(1.37 * SR));
    expect(primeiraQueSoa).toBeLessThanOrEqual(Math.round(1.37 * SR) + 1);

    const certo = evaluate(await clicksGerados(120, song.duration, { firstBeat: 1.37, downbeat: 0 }), song);
    expect(certo.far).toBe(0);
    expect(certo.max).toBeLessThan(4);
    expect(certo.first).toBeGreaterThanOrEqual(0);
    expect(certo.accentOn1).toBe(100);
  }, LENTO);

  it('caso b com a grade detectada: o mesmo +3,6 ms do relatório, acento no 1', async () => {
    const song = makeSong({ sr: SR, duration: DURACAO, bpm: 120, firstBeat: 1.37, withPad: false, withBass: false });
    const grid = detectBeatGrid(song.tracks.drums, SR, { beatsPerBar: 4 });
    expect(grid.bpm).toBe(120);
    const ev = evaluate(await clicksGerados(grid.bpm, song.duration, grid), song);
    expect(ev.far).toBe(0);
    expect(ev.max).toBeLessThan(4);
    expect(ev.mean).toBeCloseTo(3.6, 0);
    expect(ev.accentOn1).toBe(100);
    // A detecção ficou ~3 vezes mais pesada na M2 (bandas de bumbo e caixa): folga pra máquina carregada.
  }, LENTO);
});

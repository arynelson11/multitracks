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
import { chooseDownbeat, decideDownbeat, type DownbeatVotes } from './downbeat';
import { onsetBands, type OnsetBands } from './onsets';

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

/**
 * Pad sustentado (drone): um acorde só do começo ao fim, ataque de 2 s e volume
 * oscilando 20% a 0,15 Hz. Não marca compasso nenhum.
 */
function padDrone(duration: number): Float32Array[] {
  const n = Math.round(duration * SR);
  const out = new Float32Array(n);
  const notas = [261.6, 329.6, 392.0];
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const env = Math.min(1, t / 2) * (1 + 0.2 * Math.sin(2 * Math.PI * 0.15 * t));
    let v = 0;
    for (const f of notas) v += Math.sin(2 * Math.PI * f * t) + 0.3 * Math.sin(2 * Math.PI * 2 * f * t + 0.5);
    out[i] = (0.25 * env * v) / notas.length;
  }
  return [out, Float32Array.from(out)];
}

/**
 * Pad que troca de acorde a cada `cada` compassos a partir do 1º tempo, com ataque
 * de `ataque` s e saída de 0,2 s (os acordes do pad do catálogo).
 */
function padLento(song: SynthSong, cada: number, ataque: number): Float32Array[] {
  const out = new Float32Array(song.tracks.drums[0].length);
  const acordes = [[261.6, 329.6, 392.0], [220.0, 261.6, 329.6], [174.6, 220.0, 261.6], [196.0, 246.9, 293.7]];
  const compasso = (60 / song.bpm) * song.beatsPerBar;
  for (let i = 0; i < song.bars.length; i += cada) {
    const n0 = Math.round(song.bars[i] * SR);
    const dur = cada * compasso;
    const notas = acordes[(i / cada) % 4];
    for (let j = 0; j < Math.round(dur * SR) && n0 + j < out.length; j++) {
      const t = j / SR;
      const env = Math.min(1, t / ataque) * Math.min(1, (dur - t) / 0.2);
      let v = 0;
      for (const f of notas) v += Math.sin(2 * Math.PI * f * t) + 0.3 * Math.sin(2 * Math.PI * 2 * f * t + 0.5);
      out[n0 + j] += (0.25 * env * v) / notas.length;
    }
  }
  return [out, Float32Array.from(out)];
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
  // Sem baixo (rodada 1 da M3): o mesmo cenário com só a bateria, com bateria + pad
  // do catálogo (um acorde por compasso, ataque de 250 ms) e com bateria + pad drone.
  // A grade é a da detecção completa (os votos não mudam a grade); o "1" de cada
  // combinação sai do chooseDownbeat com as faixas de cada uma.
  const semBaixo = new Map<string, { soBateria: number[]; comPad: number[]; comDrone: number[]; comPad400: number[] }>();
  const fontes = new Set<string>();
  // Cada cenário: 30 s sintetizados, uma detecção com 3 faixas e os ataques da
  // bateria e do pad (~1,5 s cada).
  beforeAll(() => {
    const drone = onsetBands(padDrone(30), SR);
    if (!drone) throw new Error('drone sem ataques');
    for (const c of cenarios54) {
      const song = musicaDoCenario(c);
      const pulso: TempoTrack = { id: 'bateria', label: 'Bateria', use: 'pulse', channels: song.tracks.drums };
      const grid = detectSongGrid(faixasComVotos(song, [pulso]), SR, { beatsPerBar: 4 });
      fontes.add(grid.downbeatFrom ?? 'ausente');
      const pos = posicaoDoUm(song, grid, 4);
      if (pos === 0) acertos++;
      else errados.push(`${c.pattern}/${c.firstBeat}s/${c.intro}: no ${pos + 1}`);

      const b = onsetBands(song.tracks.drums, SR);
      const pad = onsetBands(song.tracks.pad, SR);
      if (!b || !pad) throw new Error('cenário sem ataques');
      const um = (votes?: DownbeatVotes) =>
        posicaoDoUm(song, { ...grid, downbeat: chooseDownbeat(b, 60 / grid.pulseBpm, grid.firstBeat, 4, votes) }, 4);
      const linha = semBaixo.get(c.pattern) ?? { soBateria: [], comPad: [], comDrone: [], comPad400: [] };
      linha.soBateria.push(um());
      linha.comPad.push(um({ harmony: [pad] }));
      linha.comDrone.push(um({ harmony: [drone] }));
      if (c.pattern === 'disco44') {
        const pad400 = onsetBands(padLento(song, 1, 0.4), SR);
        if (!pad400) throw new Error('pad de 400 ms sem ataques');
        linha.comPad400.push(um({ harmony: [pad400] }));
      }
      semBaixo.set(c.pattern, linha);
    }
  }, 300_000);

  const certos = (posicoes: readonly number[]) => posicoes.filter(p => p === 0).length;

  // O acorde do pad sobe de 10 a 100 ms depois do tempo: lido no ponto do bumbo, ele
  // votava contra o 1 (0/18 nas 3 levadas). Lido na janela depois do tempo, ele não
  // tira nenhum acerto da bateria.
  it.each(['rock44', 'disco44', 'popsync44'])('%s: bateria + pad do catálogo, sem baixo, nunca erra onde a bateria sozinha acerta', (pattern) => {
    const linha = semBaixo.get(pattern);
    if (!linha) throw new Error(`sem a levada ${pattern}`);
    const perdidos = linha.soBateria.filter((p, i) => p === 0 && linha.comPad[i] !== 0).length;
    expect({ perdidos, comPad: certos(linha.comPad) >= certos(linha.soBateria) }).toEqual({ perdidos: 0, comPad: true });
  });

  // Pad sustentado (drone): perfil plano não é voto e não desliga o desempate por
  // onde a bateria começa (era 6/18, 0/18 e 10/18 contra 14, 12 e 16 só com a bateria).
  it.each(['rock44', 'disco44', 'popsync44'])('%s: pad drone sem baixo não vota, o 1 sai igual ao de só a bateria', (pattern) => {
    const linha = semBaixo.get(pattern);
    if (!linha) throw new Error(`sem a levada ${pattern}`);
    expect(linha.comDrone).toEqual(linha.soBateria);
  });

  it('acerta o 1 em pelo menos 50 dos 54 cenários 4/4 (hoje 31)', () => {
    expect(acertos, errados.join('; ')).toBeGreaterThanOrEqual(50);
  });

  it('com o baixo votando, o 1 sai do baixo nos 54 (downbeatFrom)', () => {
    expect([...fontes]).toEqual(['baixo']);
  });

  // Rodada 3: pad de 400 ms no disco, sem baixo. Lido na janela ele apontava o tempo
  // errado com folga (0/18); agora a harmonia com vale de ataque lento só vence a
  // bateria sozinha com margem clara.
  it('disco44: bateria + pad de ataque de 400 ms, sem baixo, nunca erra onde a bateria sozinha acerta', () => {
    const linha = semBaixo.get('disco44');
    if (!linha) throw new Error('sem a levada disco44');
    expect(linha.soBateria.filter((p, i) => p === 0 && linha.comPad400[i] !== 0).length).toBe(0);
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

  it('diz de onde veio o 1: empate do bumbo desfeito por onde a bateria começa (folga 0) e bumbo sozinho', () => {
    const b = tempoCase('b');
    const rockB = b.song({ votes: false, duration: 30 });
    const doRock = detectSongGrid(caseTracks(b, rockB), SR, { beatsPerBar: 4 });
    expect({ de: doRock.downbeatFrom, folga: doRock.downbeatMargin }).toEqual({ de: 'inicio-da-bateria', folga: 0 });
    const f1 = tempoCase('f1');
    const valsa = f1.song({ votes: false, duration: 30 });
    const daValsa = detectSongGrid(caseTracks(f1, valsa), SR, { beatsPerBar: 3 });
    expect(daValsa.downbeatFrom).toBe('bumbo');
    expect(daValsa.downbeatMargin).toBeGreaterThan(1);
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

// Limite conhecido (rodada 3): pad de 250 ms trocando a cada 2 compassos, a 110 BPM,
// sem baixo. Lido no ponto ele cai no vale antes da subida e vota no tempo errado,
// e o vale não é fundo o bastante pra guarda (0,73 a 0,81). O erro não sai como
// certeza: a fonte é a harmonia sozinha, que a M7 e a T27 mostram como incerta.
describe('limite conhecido: pad lento a cada 2 compassos sem baixo', () => {
  it('quando erra o 1, a fonte é a harmonia (nunca baixo nem bumbo)', () => {
    const fontesDosErros = new Set<string>();
    for (const firstBeat of [0.25, 0.5, 1.0]) {
      const song = makeSong({ sr: SR, duration: 30, bpm: 110, firstBeat, pattern: 'rock44', withPad: false, withBass: false, withExtras: false });
      const pulso: TempoTrack = { id: 'bateria', label: 'Bateria', use: 'pulse', channels: song.tracks.drums };
      const pad: TempoTrack = { id: 'pad', label: 'Pad', use: 'harmony', channels: padLento(song, 2, 0.25) };
      const grid = detectSongGrid([pulso, pad], SR, { beatsPerBar: 4 });
      if (posicaoDoUm(song, grid, 4) !== 0) fontesDosErros.add(grid.downbeatFrom ?? 'ausente');
    }
    expect([...fontesDosErros].filter(f => f !== 'harmonia')).toEqual([]);
  }, 60_000);
});

/** A bateria do `song` (gerada com `splitKit`) com o bumbo do 3 de cada compasso `db` mais alto. */
function comBumboDo3(song: SynthSong, db: number): Float32Array[] {
  const kit = song.tracks.kit;
  if (!kit) throw new Error('música sem o kit separado');
  const extra = 10 ** (db / 20) - 1;
  const bateria = Float32Array.from(song.tracks.drums[0]);
  const tempo = 60 / song.bpm;
  // O golpe do bumbo dura 0,35 s: cabe no tempo do 3 sem pegar o do 1.
  for (const inicio of song.bars) {
    const de = Math.round((inicio + 2 * tempo) * SR);
    const ate = Math.min(bateria.length, Math.round((inicio + 3 * tempo) * SR));
    for (let i = de; i < ate; i++) bateria[i] += extra * kit.kick[0][i];
  }
  return [bateria, Float32Array.from(bateria)];
}

// Rodada 4 (Ruling M3-r4): rock sem baixo com o bumbo do 3 de 0,5 a 1 dB mais alto (uma
// diferença de mixagem) e uma harmonia que não vota (drone) ou o pad do catálogo. Com o
// limiar de 0,41 dB do 58c9306, o bumbo do 3 decide e o "1" erra, mas nunca sem marca:
// sai como `bumbo-lidera` com a folga medida, da harmonia, ou de um empate (folga 0).
describe('bumbo do 3 de 0,5 a 1 dB mais alto, sem baixo', () => {
  it('quando o 1 erra, sai marcado: bumbo-lidera com a folga medida, harmonia ou empate', () => {
    const erros: { com: string; de?: string; folga?: number }[] = [];
    const drone = padDrone(30);
    for (const db of [0.5, 1]) {
      for (const firstBeat of [0, 0.5, 1.37]) {
        for (const virada of [false, true]) {
          const song = makeSong({
            sr: SR, duration: 30, bpm: 120, firstBeat, pattern: 'rock44', withExtras: false, splitKit: true,
            introBars: virada ? 4 : 0, fillBeforeEntry: virada ? 4 : null,
          });
          const pulso: TempoTrack = { id: 'bateria', label: 'Bateria', use: 'pulse', channels: comBumboDo3(song, db) };
          for (const [com, harmonia] of [['drone', drone], ['pad do catálogo', song.tracks.pad]] as const) {
            const grid = detectSongGrid([pulso, { id: 'pad', label: 'Pad', use: 'harmony', channels: harmonia }], SR, { beatsPerBar: 4 });
            if (posicaoDoUm(song, grid, 4) !== 0) erros.push({ com, de: grid.downbeatFrom, folga: grid.downbeatMargin });
          }
        }
      }
    }
    // Sem marca seria vir do baixo, ou do bumbo com folga de 0,3 ou mais (ver o JSDoc de downbeatFrom).
    expect(erros.filter(e => e.de === 'baixo' || (e.de === 'bumbo' && (e.folga ?? 0) >= 0.3))).toEqual([]);
    const doBumboQueLidera = erros.filter(e => e.de === 'bumbo-lidera');
    expect(doBumboQueLidera.length).toBeGreaterThan(0);
    expect(doBumboQueLidera.filter(e => !((e.folga ?? 0) > 0))).toEqual([]);
    // Com o drone (não vota) todo erro é do bumbo: o que lidera, com folga, ou o empate da virada.
    expect(erros.filter(e => e.com === 'drone' && e.de !== 'bumbo-lidera' && !(e.de === 'bumbo' && e.folga === 0))).toEqual([]);
  }, 120_000);
});

// ── chooseDownbeat com ataques montados à mão (sem áudio) ──

const FPS = 200;
/** Período da grade: 0,5 s (100 quadros, 120 BPM). */
const PERIODO = 0.5;
const TEMPOS = 64;
// Termina antes do tempo 64: todo tempo do compasso entra o mesmo número de vezes.
const QUADROS = TEMPOS * PERIODO * FPS - 5;

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

  it('troca de acorde com ataque lento (pico de 40 a 90 ms depois do tempo) vota no 1', () => {
    // Bumbo mais forte no 3; o pad troca no 1 e só sobe depois do tempo.
    const bumboNo3 = bandas({ full: onset(porTempo([1, 1, 1, 1])), kick: onset(porTempo([0.6, 0, 1, 0])) });
    const lento = new Float32Array(QUADROS);
    for (let k = 0; k < TEMPOS; k += 4) {
      const x = k * PERIODO * FPS;
      for (let d = 8; d <= 18; d++) lento[x + d] = 1;
    }
    expect(chooseDownbeat(bumboNo3, PERIODO, 0, 4, { harmony: [bandas({ full: lento })] })).toBe(0);
  });

  // A música do relatório com projeto do Ableton: um teclado de ataque rápido no 1, com
  // notas logo depois dos outros tempos. Lido só na janela depois do tempo, ele ficava
  // plano, não votava, e o desempate por onde a bateria começa errava.
  it('teclado de ataque rápido no 1 vota mesmo com notas logo depois dos outros tempos (a janela não achata)', () => {
    const entraNo3 = bandas({ full: onset(porTempo([1, 1, 1, 1], 6)), kick: onset(porTempo([1, 0, 1, 0], 4)) });
    const teclado = onset(porTempo([1.34, 0.88, 0.91, 0.87]));
    // Nota de 2 quadros a 60 ms de cada tempo (a janela lê entre quadros).
    for (let k = 0; k < TEMPOS; k++) teclado.fill(1.2, k * PERIODO * FPS + 12, k * PERIODO * FPS + 14);
    expect(chooseDownbeat(entraNo3, PERIODO, 0, 4)).toBe(2);
    expect(chooseDownbeat(entraNo3, PERIODO, 0, 4, { harmony: [bandas({ full: teclado })] })).toBe(0);
  });

  // Música com acento das multitracks reais, cortada em 120 e 240 s: o teclado tem
  // ataque rápido no 1, mas uma nota logo depois do 3 faz a janela preferir o 3.
  // Ataque rápido vale pelo ponto: a janela só manda quando sobe muito (ataque lento).
  it('teclado de ataque rápido vota pelo ponto mesmo quando a janela depois do tempo prefere outro tempo', () => {
    const entraNo3 = bandas({ full: onset(porTempo([1, 1, 1, 1], 6)), kick: onset(porTempo([1, 0, 1, 0], 4)) });
    const teclado = onset(porTempo([1.26, 0.72, 1.15, 0.87]));
    for (let k = 2; k < TEMPOS; k += 4) teclado.fill(1.4, k * PERIODO * FPS + 6, k * PERIODO * FPS + 8);
    expect(chooseDownbeat(entraNo3, PERIODO, 0, 4, { harmony: [bandas({ full: teclado })] })).toBe(0);
  });

  // Rodada 4 (Ruling M3-r4): com baixo e harmonia presentes que não votam, o bumbo
  // mais forte decide sozinho, dentro do empate de 25%, quando lidera por 0,41 dB (10%)
  // ou mais, o limiar do 58c9306 (o real vence: a música sem projeto lidera por 0,58
  // dB). Aqui a bateria começa no 1 e o bumbo do 3 sai 0,5 a 1,2 dB mais alto (uma
  // diferença de mixagem): o "1" cai no 3, errado, mas sai como `bumbo-lidera` com a
  // folga medida (nunca o 0 do empate), pra M7 e a T27 pedirem confirmação.
  const faixasPlanas = { bass: bandas({ full: onset(porTempo([0.98, 1.02, 1, 1])) }), harmony: [bandas({ full: onset(porTempo([1.03, 0.97, 1, 1])) })] };
  const bumboDo3MaisAlto = (razao: number) =>
    bandas({ full: onset(porTempo([1, 1, 1, 1], 4)), kick: onset(porTempo([1, 0, razao, 0], 4)) });
  // Perfil do bumbo: 4 / (1 + razao) no 1 e 4 * razao / (1 + razao) no 3.
  const folgaDoBumbo = (razao: number) => (4 * (razao - 1)) / (1 + razao);

  it.each([
    ['0,5 dB', 10 ** 0.05],
    ['1 dB', 10 ** 0.1],
    ['1,2 dB', 10 ** 0.12],
  ])('bumbo do 3 %s mais alto, com faixas que não votam, decide o 3 como bumbo-lidera com a folga medida', (_nome, razao) => {
    const r = decideDownbeat(bumboDo3MaisAlto(razao), PERIODO, 0, 4, faixasPlanas);
    expect({ downbeat: r.downbeat, from: r.from }).toEqual({ downbeat: 2, from: 'bumbo-lidera' });
    expect(r.margin).toBeCloseTo(folgaDoBumbo(razao), 3);
    // Só com a bateria (sem outras faixas) fica o desempate de antes.
    expect(decideDownbeat(bumboDo3MaisAlto(razao), PERIODO, 0, 4)).toEqual({ downbeat: 0, from: 'inicio-da-bateria', margin: 0 });
  });

  it('bumbo do 3 só 0,3 dB mais alto (abaixo de 0,41 dB) não decide: vale onde a bateria começa, folga 0', () => {
    expect(decideDownbeat(bumboDo3MaisAlto(10 ** 0.03), PERIODO, 0, 4, faixasPlanas)).toEqual({ downbeat: 0, from: 'inicio-da-bateria', margin: 0 });
  });

  it('diz de onde veio o 1 e a folga', () => {
    const baixo = bandas({ full: onset(porTempo([1, 0.2, 0.3, 0.2])) });
    const pad = bandas({ full: onset(porTempo([1, 0, 0, 0])) });
    const doBaixo = decideDownbeat(rock(4), PERIODO, 0, 4, { bass: baixo, harmony: [pad] });
    expect({ downbeat: doBaixo.downbeat, from: doBaixo.from }).toEqual({ downbeat: 0, from: 'baixo' });
    expect(doBaixo.margin).toBeGreaterThan(1);
    const daHarmonia = decideDownbeat(rock(6), PERIODO, 0, 4, { harmony: [pad] });
    expect({ downbeat: daHarmonia.downbeat, from: daHarmonia.from }).toEqual({ downbeat: 0, from: 'harmonia' });
    const doBumbo = decideDownbeat(bandas({ full: onset(porTempo([1, 1, 1, 1])), kick: onset(porTempo([1, 0, 0.5, 0])) }), PERIODO, 0, 4);
    expect({ downbeat: doBumbo.downbeat, from: doBumbo.from }).toEqual({ downbeat: 0, from: 'bumbo' });
    expect(doBumbo.margin).toBeCloseTo(4 / 3, 2);
    expect(decideDownbeat(rock(6), PERIODO, 0, 4)).toEqual({ downbeat: 2, from: 'inicio-da-bateria', margin: 0 });
    expect(decideDownbeat(rock(6), PERIODO, 0, 1)).toEqual({ downbeat: 0, from: 'reserva', margin: 0 });
    expect(decideDownbeat(rock(6), 0, 0, 4)).toEqual({ downbeat: 0, from: 'reserva', margin: 0 });
    // chooseDownbeat continua devolvendo só o tempo.
    expect(chooseDownbeat(rock(4), PERIODO, 0, 4, { bass: baixo, harmony: [pad] })).toBe(doBaixo.downbeat);
  });

  // Rodada 3 (Ruling M3-r3), o lado ruim da janela: pad de ataque lento lido no ponto
  // cai no vale antes da subida (o 1 fica o tempo mais baixo no ponto e é onde a
  // janela mais sobe) e aponta outro tempo. Sem baixo, essa harmonia só vence o que a
  // bateria sozinha decide com folga de 1,0; senão vale a bateria.
  it('pad lento lido no vale, sem baixo e sem margem clara: vale o que a bateria sozinha decide', () => {
    const padNoVale = onset(porTempo([0.5, 1.1, 1.4, 1.0]));
    // A subida do acorde no 1, 40 ms depois do tempo.
    for (let k = 0; k < TEMPOS; k += 4) padNoVale.fill(0.9, k * PERIODO * FPS + 8, k * PERIODO * FPS + 10);
    const pad = bandas({ full: padNoVale });
    expect(decideDownbeat(rock(4), PERIODO, 0, 4)).toEqual({ downbeat: 0, from: 'inicio-da-bateria', margin: 0 });
    expect(decideDownbeat(rock(4), PERIODO, 0, 4, { harmony: [pad] })).toEqual({ downbeat: 0, from: 'inicio-da-bateria', margin: 0 });
    // O mesmo pad com o baixo marcando o 1: a guarda não vale (há voto do baixo).
    const baixo = bandas({ full: onset(porTempo([1, 0.2, 0.3, 0.2])) });
    expect(decideDownbeat(rock(4), PERIODO, 0, 4, { bass: baixo, harmony: [pad] }).from).toBe('baixo');
  });

  it('voto plano (desvio de até 0,2) não vota e o desempate por onde a bateria começa continua', () => {
    // Bumbo igual no 1 e no 3 desde o tempo 4; a bateria toda começa no tempo 6 (o 3).
    const entraNo3 = bandas({ full: onset(porTempo([1, 1, 1, 1], 6)), kick: onset(porTempo([1, 0, 1, 0], 4)) });
    const quasePlano = bandas({ full: onset(porTempo([1.15, 0.95, 0.95, 0.95])) });
    const baixoQuasePlano = bandas({ full: onset(porTempo([0.9, 1.1, 1, 1])) });
    expect(chooseDownbeat(entraNo3, PERIODO, 0, 4)).toBe(2);
    expect(chooseDownbeat(entraNo3, PERIODO, 0, 4, { harmony: [quasePlano] })).toBe(2);
    expect(chooseDownbeat(entraNo3, PERIODO, 0, 4, { bass: baixoQuasePlano, harmony: [quasePlano] })).toBe(2);
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

// Ataque de cada amostra de click e a colocação compensada no gerador (recomendação 7
// do relatório do metrônomo): cada amostra leva de 0,05 a 5,3 ms pra chegar a -20 dB
// do pico, e o gerador copiava a amostra começando no tempo, então o click soava
// atrasado por esse tanto. Agora cada click entra adiantado pelo ataque da amostra.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { generateEndlessClickTrackFromSample, generateManualClickTrackFromSample, type ClickGridAlignment } from './AudioAnalyzer';
import { CLICK_ATTACK_MS, attackSeconds } from './clickAttack';
import { CLICK_SUBDIVISIONS, CLICK_TYPES, getClickSampleUrl, type ClickSubdivision, type ClickTrackType } from './clickLibrary';
import { makeClickShims } from '../test/clickShims';
import { detectClicks, evaluate, mixToMono, parseWav, type DetectedClick } from '../test/clickProbe';
import { makeSong } from '../test/synthMusic';

const PUBLIC_DIR = fileURLToPath(new URL('../../public/', import.meta.url));
const SAMPLES_JSON = fileURLToPath(new URL('../../scripts/verify-click/samples.json', import.meta.url));
const PREFIXO = 'New Click -  ';
// O gerador escreve o WAV a 44,1 kHz: 1 amostra = 0,023 ms.
const SR_CLICK = 44100;
// Gerar 1 min de click e sintetizar a bateria do caso b leva ~1 s; folga pra máquina carregada.
const LENTO = 20_000;

interface LinhaSamples { file: string; first_m20dB_ms: number }
const samples = JSON.parse(readFileSync(SAMPLES_JSON, 'utf8')) as LinhaSamples[];

function lerPublic(rel: string): ArrayBuffer | null {
  try {
    const buf = readFileSync(join(PUBLIC_DIR, rel));
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
  } catch {
    return null;
  }
}

/** Nome do arquivo que o getClickSampleUrl pede, sem a pasta e sem o prefixo. */
function arquivoDaUrl(type: ClickTrackType, subdivision: ClickSubdivision): string {
  const url = getClickSampleUrl(type, subdivision);
  const nome = decodeURIComponent(url.slice(url.lastIndexOf('/') + 1));
  expect(nome.startsWith(PREFIXO)).toBe(true);
  return nome.slice(PREFIXO.length);
}

function instalarCalcos() {
  const shims = makeClickShims(lerPublic);
  vi.stubGlobal('window', { AudioContext: shims.AudioContext });
  vi.stubGlobal('fetch', shims.fetch);
  vi.spyOn(URL, 'createObjectURL').mockImplementation(shims.createObjectURL);
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(shims.revokeObjectURL);
  return shims;
}

async function lerWav(blob: Blob) {
  const wav = parseWav(await blob.arrayBuffer());
  expect(wav.sampleRate).toBe(SR_CLICK);
  return wav;
}

/** Gera o click (acento no 1, 4/4) e devolve os inícios audíveis (-20 dB) achados no WAV. */
async function clicksGerados(type: ClickTrackType, subdivision: ClickSubdivision, bpm: number, duration: number, grid?: ClickGridAlignment): Promise<DetectedClick[]> {
  const shims = instalarCalcos();
  await generateManualClickTrackFromSample(type, subdivision, bpm, duration, true, '4/4', grid);
  const blob = shims.lastBlob();
  if (!blob) throw new Error('o gerador não criou o WAV');
  const wav = await lerWav(blob);
  return detectClicks(mixToMono(wav.channels), wav.sampleRate);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('CLICK_ATTACK_MS', () => {
  it('tem as 29 amostras de scripts/verify-click/samples.json, com o ataque a -20 dB de cada uma', () => {
    expect(samples).toHaveLength(29);
    expect(Object.keys(CLICK_ATTACK_MS).sort()).toEqual(samples.map(s => s.file).sort());
    for (const s of samples) expect(CLICK_ATTACK_MS[s.file]).toBe(s.first_m20dB_ms);
    expect(Object.isFrozen(CLICK_ATTACK_MS)).toBe(true);
  });

  it('confere com os arquivos de public/Click Tracks (1ª amostra a 10% do pico, no mono)', () => {
    for (const [file, ms] of Object.entries(CLICK_ATTACK_MS)) {
      const ab = lerPublic(`Click Tracks/${PREFIXO}${file}`);
      if (!ab) throw new Error(`amostra ${file} não está em public/Click Tracks`);
      const wav = parseWav(ab);
      const mono = mixToMono(wav.channels);
      let pico = 0;
      for (const v of mono) pico = Math.max(pico, Math.abs(v));
      const limiar = pico * Math.pow(10, -20 / 20);
      const idx = mono.findIndex(v => Math.abs(v) >= limiar);
      expect((idx / wav.sampleRate) * 1000, file).toBeCloseTo(ms, 3);
    }
  });
});

describe('attackSeconds', () => {
  it('acha a amostra de cada tipo e subdivisão pelo mesmo nome que o getClickSampleUrl pede', () => {
    let achadas = 0;
    for (const { id: type } of CLICK_TYPES) {
      for (const { id: subdivision } of CLICK_SUBDIVISIONS) {
        const file = arquivoDaUrl(type, subdivision);
        const existe = lerPublic(`Click Tracks/${PREFIXO}${file}`) !== null;
        if (existe) {
          achadas++;
          expect(attackSeconds(type, subdivision), file).toBe(CLICK_ATTACK_MS[file] / 1000);
          expect(attackSeconds(type, subdivision), file).toBeGreaterThan(0);
        } else {
          expect(attackSeconds(type, subdivision), file).toBe(0);
        }
      }
    }
    // 7 tipos x 4 subdivisões, menos o Saw 1/16, que não tem arquivo.
    expect(achadas).toBe(27);
  });

  it('dá os valores medidos do Classic e do Percussive, e 0 pra amostra que não existe', () => {
    expect(attackSeconds('Classic', 'quarter')).toBeCloseTo(0.001088, 9);
    expect(attackSeconds('Percussive', 'quarter')).toBeCloseTo(0.004444, 9);
    expect(attackSeconds('Saw', 'sixteenth')).toBe(0);
    expect(attackSeconds('Nenhum' as ClickTrackType, 'quarter')).toBe(0);
    expect(attackSeconds('Classic', 'nenhuma' as ClickSubdivision)).toBe(0);
  });
});

describe('gerador com a compensação do ataque', () => {
  // Caso b do relatório: 120 BPM, 1º tempo em 1,37 s. Sem a compensação, com a grade
  // certa, o início audível ficava 1,09 ms (Classic) e 4,44 ms (Percussive) atrás do golpe.
  it.each([
    { type: 'Classic' as const },
    { type: 'Percussive' as const },
  ])('caso b com a grade certa: o início audível do $type fica a no máximo 0,3 ms do golpe', async ({ type }) => {
    const song = makeSong({ sr: 48000, duration: 60, bpm: 120, firstBeat: 1.37, withPad: false, withBass: false });
    const ev = evaluate(await clicksGerados(type, 'quarter', 120, song.duration, { firstBeat: 1.37, downbeat: 0 }), song);
    expect(ev.far).toBe(0);
    expect(ev.max).toBeLessThanOrEqual(0.3);
    expect(ev.accentOn1).toBe(100);
  }, LENTO);

  it('sem grade, o 1º click fica preso em 0:00 e os outros saem adiantados pelo ataque', async () => {
    const ataque = attackSeconds('Percussive', 'quarter');
    const clicks = await clicksGerados('Percussive', 'quarter', 120, 4);
    expect(clicks).toHaveLength(8);
    // O 1º não tem como entrar antes de 0:00: soa com o atraso da amostra.
    expect(Math.abs(clicks[0].t - ataque) * 1000).toBeLessThanOrEqual(0.3);
    for (let k = 1; k < clicks.length; k++) expect(Math.abs(clicks[k].t - k * 0.5) * 1000, `click ${k + 1}`).toBeLessThanOrEqual(0.3);
  }, LENTO);

  it('o click infinito (um compasso em loop) continua com os clicks a intervalos iguais', async () => {
    instalarCalcos();
    const bpm = 100;
    const periodo = 60 / bpm;
    const { clickBlob } = await generateEndlessClickTrackFromSample('Percussive', 'quarter', bpm);
    const wav = await lerWav(clickBlob);
    expect(wav.frames).toBe(Math.ceil(SR_CLICK * 4 * periodo));
    // Três voltas do loop, como o motor toca (source.loop).
    const mono = mixToMono(wav.channels);
    const voltas = new Float32Array(mono.length * 3);
    for (let v = 0; v < 3; v++) voltas.set(mono, v * mono.length);
    const clicks = detectClicks(voltas, wav.sampleRate);
    expect(clicks).toHaveLength(12);
    for (let k = 1; k < clicks.length; k++) {
      expect(Math.abs(clicks[k].t - clicks[k - 1].t - periodo) * 1000, `intervalo ${k}`).toBeLessThanOrEqual(0.3);
    }
  }, LENTO);
});

// Calços pra rodar o gerador de click (generateManualClickTrackFromSample e
// generateEndlessClickTrackFromSample, em src/lib/AudioAnalyzer.ts) nos testes, fora do
// navegador: um AudioContext que só decodifica a amostra, um fetch que lê os arquivos de
// public/ e devolve os Blobs criados, e o par URL.createObjectURL/revokeObjectURL com
// um registro desses Blobs.
// Sem API do Node: o tsconfig.app.json checa src/test. Quem lê o arquivo do disco é o
// próprio teste, que passa a função de leitura (`ReadPublicFile`).
import { parseWav } from './clickProbe';

/** Lê um arquivo de public/ pelo caminho relativo (ex. "Click Tracks/New Click -  Classic-quarter.wav"); null se não existe. */
export type ReadPublicFile = (relPath: string) => ArrayBuffer | null;

/** Só o que o gerador usa do AudioBuffer decodificado. */
export interface DecodedClickSample {
  sampleRate: number;
  numberOfChannels: number;
  length: number;
  duration: number;
  getChannelData(channel: number): Float32Array;
}

/**
 * Só o que o gerador usa do AudioContext: decodificar a amostra de click e fechar.
 * O WAV tem de vir na taxa do contexto (não reamostra); se não vier, lança.
 */
export class FakeClickAudioContext {
  readonly sampleRate: number;
  constructor(opts: { sampleRate?: number } = {}) {
    this.sampleRate = opts.sampleRate ?? 48000;
  }
  async decodeAudioData(ab: ArrayBuffer): Promise<DecodedClickSample> {
    const w = parseWav(ab);
    if (w.sampleRate !== this.sampleRate) throw new Error(`amostra a ${w.sampleRate} Hz, contexto a ${this.sampleRate} Hz`);
    return {
      sampleRate: w.sampleRate, numberOfChannels: w.numberOfChannels, length: w.frames,
      duration: w.frames / w.sampleRate, getChannelData: (c: number) => w.channels[c],
    };
  }
  async close() {}
}

/** Só o que o gerador usa da resposta do fetch. */
export interface FakeClickResponse {
  ok: boolean;
  arrayBuffer(): Promise<ArrayBuffer>;
  blob(): Promise<Blob>;
}

export interface ClickShims {
  /** Vai em `window.AudioContext`. */
  AudioContext: typeof FakeClickAudioContext;
  /** Vai no `fetch` global: URL de Blob criado aqui devolve o Blob; o resto é lido de public/. */
  fetch(url: string): Promise<FakeClickResponse>;
  /** Vai no `URL.createObjectURL`. */
  createObjectURL(obj: Blob | MediaSource): string;
  /** Vai no `URL.revokeObjectURL`. */
  revokeObjectURL(url: string): void;
  /** O último Blob criado (o WAV do click que o gerador entregou), ou null. */
  lastBlob(): Blob | null;
}

/**
 * Monta os calços. O teste instala cada peça, ex.:
 * `vi.stubGlobal('window', { AudioContext: s.AudioContext })`, `vi.stubGlobal('fetch', s.fetch)`
 * e `vi.spyOn(URL, 'createObjectURL').mockImplementation(s.createObjectURL)`.
 */
export function makeClickShims(readPublic: ReadPublicFile): ClickShims {
  const blobs = new Map<string, Blob>();
  let last: Blob | null = null;
  let next = 0;
  const respond = (ok: boolean, ab: ArrayBuffer): FakeClickResponse => ({
    ok, arrayBuffer: async () => ab, blob: async () => new Blob([ab]),
  });
  return {
    AudioContext: FakeClickAudioContext,
    async fetch(url: string) {
      const blob = blobs.get(url);
      if (blob) return { ok: true, arrayBuffer: () => blob.arrayBuffer(), blob: async () => blob };
      // BASE_URL é '/' no teste ('./' no desktop): o caminho vem relativo a public/.
      const ab = readPublic(decodeURIComponent(url.replace(/^\.?\//, '')));
      return ab ? respond(true, ab) : respond(false, new ArrayBuffer(0));
    },
    createObjectURL(obj: Blob | MediaSource) {
      const url = `blob:click-shims/${++next}`;
      last = obj as Blob;
      blobs.set(url, last);
      return url;
    },
    revokeObjectURL(url: string) {
      blobs.delete(url);
    },
    lastBlob: () => last,
  };
}

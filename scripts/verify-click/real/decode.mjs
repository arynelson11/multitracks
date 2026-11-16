// Decodifica um arquivo de áudio com o ffmpeg local (~/.local/bin) pra Float32 mono.
// Só leitura do arquivo; nada é gravado em disco.
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';

const FFMPEG = process.env.FFMPEG || path.join(os.homedir(), '.local/bin/ffmpeg');

/** `file` inteiro (ou os primeiros `seconds` segundos), mono, em `sampleRate`. */
export function decodeMono(file, { seconds = Infinity, sampleRate = 44100 } = {}) {
  const lim = Number.isFinite(seconds) ? ['-t', String(seconds)] : [];
  const r = spawnSync(FFMPEG, ['-v', 'error', '-i', file, ...lim, '-ac', '1', '-ar', String(sampleRate), '-f', 'f32le', '-'],
    { maxBuffer: 1 << 30 });
  if (r.status !== 0) throw new Error(`ffmpeg falhou em ${file}: ${r.stderr?.toString().slice(0, 300)}`);
  const b = r.stdout;
  // cópia alinhada (o Buffer do Node pode começar fora de múltiplo de 4); f32le = ordem da máquina (x86/ARM)
  return new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + (b.byteLength & ~3)));
}

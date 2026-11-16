// Leitor/escritor WAV mínimo (PCM 16/24/32 e float32), sem dependências.
import fs from 'node:fs';

export function parseWav(buf) {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const tag = (o) => String.fromCharCode(dv.getUint8(o), dv.getUint8(o + 1), dv.getUint8(o + 2), dv.getUint8(o + 3));
  if (tag(0) !== 'RIFF' || tag(8) !== 'WAVE') throw new Error('nao e WAV');
  let off = 12;
  let fmt = null;
  let dataOff = -1;
  let dataLen = 0;
  const chunks = [];
  while (off + 8 <= buf.length) {
    const id = tag(off);
    const size = dv.getUint32(off + 4, true);
    chunks.push({ id, size, off });
    if (id === 'fmt ') {
      fmt = {
        format: dv.getUint16(off + 8, true),
        channels: dv.getUint16(off + 10, true),
        sampleRate: dv.getUint32(off + 12, true),
        bits: dv.getUint16(off + 22, true),
      };
    } else if (id === 'data') {
      dataOff = off + 8;
      dataLen = Math.min(size, buf.length - dataOff);
    }
    off += 8 + size + (size & 1);
  }
  if (!fmt || dataOff < 0) throw new Error('WAV sem fmt/data');
  const bps = fmt.bits / 8;
  const frames = Math.floor(dataLen / (bps * fmt.channels));
  const ch = [];
  for (let c = 0; c < fmt.channels; c++) ch.push(new Float32Array(frames));
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < fmt.channels; c++) {
      const p = dataOff + (i * fmt.channels + c) * bps;
      let v;
      if (fmt.format === 3 && fmt.bits === 32) v = dv.getFloat32(p, true);
      else if (fmt.bits === 16) v = dv.getInt16(p, true) / 32768;
      else if (fmt.bits === 24) {
        let x = dv.getUint8(p) | (dv.getUint8(p + 1) << 8) | (dv.getUint8(p + 2) << 16);
        if (x & 0x800000) x |= ~0xffffff;
        v = x / 8388608;
      } else if (fmt.bits === 32) v = dv.getInt32(p, true) / 2147483648;
      else throw new Error('bits nao suportado ' + fmt.bits);
      ch[c][i] = v;
    }
  }
  return { ...fmt, frames, channels: ch, numberOfChannels: fmt.channels, chunks, dataOff };
}

export function readWav(path) {
  return parseWav(fs.readFileSync(path));
}

export function writeWavMono(path, data, sampleRate) {
  const n = data.length;
  const b = Buffer.alloc(44 + n * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVE', 8);
  b.write('fmt ', 12); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(sampleRate, 24); b.writeUInt32LE(sampleRate * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34);
  b.write('data', 36); b.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) {
    const s = Math.max(-1, Math.min(1, data[i]));
    b.writeInt16LE(Math.round(s < 0 ? s * 32768 : s * 32767), 44 + i * 2);
  }
  fs.writeFileSync(path, b);
}

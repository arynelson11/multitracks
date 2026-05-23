import { Mp3Encoder } from '@breezystack/lamejs';

function floatTo16BitPCM(input: Float32Array): Int16Array {
  const output = new Int16Array(input.length);
  for (let i = 0; i < input.length; i++) {
    const s = Math.max(-1, Math.min(1, input[i]));
    output[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return output;
}

export async function audioBlobToMp3Blob(srcBlob: Blob, kbps = 320): Promise<Blob> {
  const arrayBuffer = await srcBlob.arrayBuffer();
  const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const ctx = new AudioCtx();
  let audioBuffer: AudioBuffer;
  try {
    audioBuffer = await ctx.decodeAudioData(arrayBuffer.slice(0));
  } finally {
    ctx.close();
  }

  const channels = Math.min(audioBuffer.numberOfChannels, 2);
  const sampleRate = audioBuffer.sampleRate;
  const left = floatTo16BitPCM(audioBuffer.getChannelData(0));
  const right = channels > 1 ? floatTo16BitPCM(audioBuffer.getChannelData(1)) : null;

  const encoder = new Mp3Encoder(channels, sampleRate, kbps);
  const blockSize = 1152;
  const chunks: Uint8Array[] = [];

  for (let i = 0; i < left.length; i += blockSize) {
    const l = left.subarray(i, i + blockSize);
    const r = right ? right.subarray(i, i + blockSize) : undefined;
    const buf = r ? encoder.encodeBuffer(l, r) : encoder.encodeBuffer(l);
    if (buf.length > 0) chunks.push(buf);
  }
  const tail = encoder.flush();
  if (tail.length > 0) chunks.push(tail);

  return new Blob(chunks as BlobPart[], { type: 'audio/mpeg' });
}

// Gerador do click da biblioteca (generateManualClickTrackFromSample) em pedaços que cedem a vez à
// tela (Ruling T27-gerador): montar o WAV de uma música de 5 min travava a thread principal ~450 ms
// (medido no Chrome) e um play nesse instante esperava. O WAV tem de sair BYTE A BYTE igual ao de
// antes: os hashes abaixo foram tirados do gerador síncrono (AudioAnalyzer.ts do 11c4132, o mesmo do
// HEAD 7bda816) com estes mesmos casos, duas vezes, iguais.
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { generateEndlessClickTrackFromSample, generateManualClickTrackFromSample } from './AudioAnalyzer'
import { makeClickShims } from '../test/clickShims'

const PUBLIC_DIR = fileURLToPath(new URL('../../public/', import.meta.url))
// Gerar 10 min de click leva ~1 s; folga pra máquina carregada.
const LENTO = 30_000

function lerPublic(rel: string): ArrayBuffer | null {
  try {
    const buf = readFileSync(join(PUBLIC_DIR, rel))
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer
  } catch {
    return null
  }
}

function instalarCalcos() {
  const shims = makeClickShims(lerPublic)
  vi.stubGlobal('window', { AudioContext: shims.AudioContext })
  vi.stubGlobal('fetch', shims.fetch)
  vi.spyOn(URL, 'createObjectURL').mockImplementation(shims.createObjectURL)
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(shims.revokeObjectURL)
  return shims
}

async function hashDoWav(shims: ReturnType<typeof makeClickShims>): Promise<{ bytes: number; sha256: string }> {
  const blob = shims.lastBlob()
  if (!blob) throw new Error('o gerador não criou o WAV')
  const buf = Buffer.from(await blob.arrayBuffer())
  return { bytes: buf.length, sha256: createHash('sha256').update(buf).digest('hex') }
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

type Caso = { nome: string; gerar: () => Promise<unknown>; bytes: number; sha256: string }
const CASOS: Caso[] = [
  {
    nome: 'curto (8 s, Classic semínima, 4/4, com grade)',
    gerar: () => generateManualClickTrackFromSample('Classic', 'quarter', 120, 8, true, '4/4', { firstBeat: 0.37, downbeat: 1 }),
    bytes: 705644, sha256: '1c3570cc24ffb0296a6b50f3d457a2e2e61b0c9dd1009756eacd1afa7fc41526',
  },
  {
    nome: '5 min (Percussive colcheia a 97,3, 4/4, o 1 no 4º tempo)',
    gerar: () => generateManualClickTrackFromSample('Percussive', 'eighth', 97.3, 300, true, '4/4', { firstBeat: 0.123, downbeat: 3 }),
    bytes: 26460044, sha256: '4b3de7fab6dcc3ec01e5cd3de8d74f3cc1c5d8feba9ea532088c122c801bab17',
  },
  {
    nome: '6/8 (Cowbell com acentos, 140 pulsos, 30 s)',
    gerar: () => generateManualClickTrackFromSample('Cowbell', 'accents', 140, 30, true, '6/8', { firstBeat: 0.2, downbeat: 2 }),
    bytes: 2646044, sha256: '9bf964ad1ec4ac595d0a7d3a10126ce1b5cd9ab856610446d1821642627fab11',
  },
  {
    nome: '3/4 sem grade e sem acento (Woodblock semicolcheia a 72, 20 s)',
    gerar: () => generateManualClickTrackFromSample('Woodblock', 'sixteenth', 72, 20, false, '3/4'),
    bytes: 1764044, sha256: 'f0a598a892cb27ea1973b1cef58240145fe7328740b33e778263e0e11c8d0a7a',
  },
  {
    nome: 'loop do metrônomo infinito (Gentle semínima a 133)',
    gerar: () => generateEndlessClickTrackFromSample('Gentle', 'quarter', 133),
    bytes: 159202, sha256: '2acb3cc34b0b326336f077a7a4490569fae9386289156da66b4dd21d01b9ae19',
  },
]

describe('generateManualClickTrackFromSample: o mesmo WAV de antes', () => {
  it.each(CASOS)('$nome', async (c) => {
    const shims = instalarCalcos()
    await c.gerar()
    const got = await hashDoWav(shims)
    expect(got).toEqual({ bytes: c.bytes, sha256: c.sha256 })
  }, LENTO)
})

describe('generateManualClickTrackFromSample: cede a vez enquanto monta', () => {
  it('10 min de click: a thread nunca fica presa mais que 50 ms, e um timer marcado no meio roda antes do fim', async () => {
    const shims = instalarCalcos()
    // Relógio da thread: um timer de 1 ms anota quando consegue rodar; o maior vão entre duas
    // voltas é a maior tarefa que o gerador segurou.
    let last = performance.now()
    let maxGap = 0
    let turns = 0
    const tick = setInterval(() => {
      const now = performance.now()
      maxGap = Math.max(maxGap, now - last)
      last = now
      turns++
    }, 1)
    let done = false
    let ranBeforeDone: boolean | null = null
    // O "play" pedido no meio: marcado quando o gerador já começou a montar (a amostra já foi lida).
    const realFetch = shims.fetch
    vi.stubGlobal('fetch', async (url: string) => {
      const r = await realFetch(url)
      if (!url.startsWith('blob:')) setTimeout(() => { if (ranBeforeDone === null) ranBeforeDone = !done }, 5)
      return r
    })
    try {
      last = performance.now()
      await generateManualClickTrackFromSample('Percussive', 'quarter', 120, 600, true, '4/4', { firstBeat: 0.37, downbeat: 1 })
      done = true
    } finally {
      clearInterval(tick)
    }
    expect(ranBeforeDone).toBe(true)
    expect(turns).toBeGreaterThan(5)
    expect(maxGap).toBeLessThan(50)
  }, LENTO)
})

// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mp3 = vi.hoisted(() => ({ audioBlobToMp3Blob: vi.fn() }))
vi.mock('../audioExport', () => mp3)

import { DOWNLOAD_FORMAT_KEY, downloadStem, readDownloadFormat, stemDownloadName, writeDownloadFormat } from './stemFiles'

let clicked: { href: string; download: string }[] = []
beforeEach(() => {
  clicked = []
  mp3.audioBlobToMp3Blob.mockReset()
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    clicked.push({ href: this.href, download: this.download })
  })
  URL.createObjectURL = vi.fn(() => 'blob:saida')
  URL.revokeObjectURL = vi.fn()
  localStorage.clear()
})
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('stemFiles', () => {
  it('stemDownloadName segue a regra de hoje', () => {
    expect(stemDownloadName('Águas Puras', 'Vocais', 'mp3')).toBe('_guas_Puras_Vocais.mp3')
    expect(stemDownloadName('', 'Baixo', 'wav')).toBe('stem_Baixo.wav')
  })

  it('readDownloadFormat: mp3 guardado vale; sem nada, wav; armazenamento quebrado volta wav', () => {
    expect(readDownloadFormat()).toBe('wav')
    writeDownloadFormat('mp3')
    expect(localStorage.getItem(DOWNLOAD_FORMAT_KEY)).toBe('mp3')
    expect(readDownloadFormat()).toBe('mp3')
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('bloqueado') })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('bloqueado') })
    expect(readDownloadFormat()).toBe('wav')
    expect(() => writeDownloadFormat('wav')).not.toThrow()
  })

  it('downloadStem em WAV baixa o arquivo como veio, com o nome certo', async () => {
    const wav = new Blob(['x'], { type: 'audio/wav' })
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, blob: async () => wav })))
    await downloadStem({ url: 'https://r2/vocais.wav', songName: 'Ao Vivo', stemName: 'Vocais', format: 'wav' })
    expect(mp3.audioBlobToMp3Blob).not.toHaveBeenCalled()
    expect(clicked).toEqual([{ href: 'blob:saida', download: 'Ao_Vivo_Vocais.wav' }])
  })

  it('downloadStem em MP3 converte a 320 kbps e baixa com o nome certo', async () => {
    const wav = new Blob(['x'], { type: 'audio/wav' })
    mp3.audioBlobToMp3Blob.mockResolvedValue(new Blob(['y'], { type: 'audio/mpeg' }))
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, blob: async () => wav })))
    await downloadStem({ url: 'https://r2/vocais.wav', songName: 'Ao Vivo', stemName: 'Vocais', format: 'mp3' })
    expect(mp3.audioBlobToMp3Blob).toHaveBeenCalledWith(wav, 320)
    expect(clicked[0].download).toBe('Ao_Vivo_Vocais.mp3')
  })

  it('downloadStem lança quando o arquivo não chega', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('sem internet') }))
    await expect(downloadStem({ url: 'https://r2/a.wav', songName: 'A', stemName: 'B', format: 'wav' })).rejects.toThrow()
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 404, blob: async () => new Blob() })))
    await expect(downloadStem({ url: 'https://r2/a.wav', songName: 'A', stemName: 'B', format: 'wav' })).rejects.toThrow()
    expect(clicked).toEqual([])
  })
})

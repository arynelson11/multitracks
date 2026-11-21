// Baixar uma faixa da separação, fora da tela (Parte 3): o formato escolhido (WAV ou MP3, guardado
// no aparelho), o nome do arquivo e o download. Usado pelo Separador de reserva e pelo painel
// SEPARAÇÃO do palco. Erro lança; quem chama mostra a frase na tela.
import { audioBlobToMp3Blob } from '../audioExport'

export type DownloadFormat = 'wav' | 'mp3'
export const DOWNLOAD_FORMAT_KEY = 'playback-studio:download-format'

export function readDownloadFormat(): DownloadFormat {
  try {
    return window.localStorage.getItem(DOWNLOAD_FORMAT_KEY) === 'mp3' ? 'mp3' : 'wav'
  } catch {
    return 'wav'
  }
}

export function writeDownloadFormat(f: DownloadFormat): void {
  try {
    window.localStorage.setItem(DOWNLOAD_FORMAT_KEY, f)
  } catch {
    // Armazenamento bloqueado: o formato vale só nesta sessão.
  }
}

/** A regra de hoje: tudo que não é letra sem acento ou número vira _, sem nome vira 'stem'. */
export function stemDownloadName(songName: string, stemName: string, ext: DownloadFormat): string {
  return `${(songName || 'stem').replace(/[^a-zA-Z0-9]/g, '_')}_${stemName}.${ext}`
}

/** Baixa a faixa no formato escolhido (MP3 a 320 kbps). Lança se o arquivo não chega. */
export async function downloadStem(i: { url: string; songName: string; stemName: string; format: DownloadFormat }): Promise<void> {
  const res = await fetch(i.url)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const wavBlob = await res.blob()
  const useMp3 = i.format === 'mp3'
  const outBlob = useMp3 ? await audioBlobToMp3Blob(wavBlob, 320) : wavBlob
  const a = document.createElement('a')
  a.href = URL.createObjectURL(outBlob)
  a.download = stemDownloadName(i.songName, i.stemName, useMp3 ? 'mp3' : 'wav')
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  const href = a.href
  setTimeout(() => URL.revokeObjectURL(href), 10000)
}

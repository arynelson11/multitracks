// Publicar a separação na biblioteca da nuvem, fora da tela (Parte 3): é o "Salvar & Publicar" de
// hoje do Separador sem o estado da tela. Capa no R2, a música, cada faixa (a remota copiada pelo
// servidor, a local subida pelo R2), a voz guia renderizada no fim e o registro das faixas. Quem
// chama decide o `isGlobal` (só admin) e o 100% do fim. Erro lança com a frase.
import { apiUrl } from '../api'
import { uploadToR2 } from '../r2'
import { getAuthHeaders } from '../supabase'

export interface CloudPublishInput {
  songName: string; artist: string; songKey: string; bpm: number; cover: File | null; isGlobal: boolean; userId: string | null
  stems: readonly { id: string; name: string; url: string }[]
  /** Renderiza a voz guia; nulo quando ela já é uma das faixas (ou não há marcações). */
  voiceGuide: (() => Promise<Blob | null>) | null
}

type Status = { status: string; progress: number }

/** Frases do andamento, pra quem usa (sem banco de dados, sem emoji). */
export const CLOUD_STATUS = {
  start: 'Criando a música na sua biblioteca...',
  cover: 'Enviando a capa...',
  stem: (name: string, n: number, total: number) => `Enviando ${name} pra nuvem (${n} de ${total})...`,
  guide: 'Preparando a voz guia...',
  finish: 'Terminando de salvar...',
} as const

async function errorText(res: Response, fallback: string): Promise<string> {
  const b = await res.json().catch(() => ({})) as { error?: string }
  return b.error || fallback
}

export async function publishToCloud(i: CloudPublishInput, onStatus: (s: Status) => void): Promise<void> {
  let progress = 0
  const status = (text: string, p = progress) => { progress = p; onStatus({ status: text, progress }) }
  status(CLOUD_STATUS.start, 0)

  let cover_url: string | null = null
  if (i.cover) {
    status(CLOUD_STATUS.cover)
    const cName = `${Date.now()}_${i.cover.name.replace(/\\s+/g, '_')}`
    const rRes = await uploadToR2('covers', cName, i.cover)
    if (!rRes.error && rRes.url) cover_url = rRes.url
  }

  const songRes = await fetch(apiUrl('/api/insert-song'), {
    method: 'POST',
    headers: await getAuthHeaders(),
    body: JSON.stringify({
      name: i.songName, artist: i.artist || 'Desconhecido',
      key: i.songKey, bpm: i.bpm, cover_url,
      is_global: i.isGlobal,
    }),
  })
  if (!songRes.ok) throw new Error(await errorText(songRes, `HTTP ${songRes.status}`))
  const { id: songId } = await songRes.json() as { id?: string }
  if (!songId) throw new Error('Falha ao criar música')
  status(CLOUD_STATUS.start, 10)

  const stemsData: { song_id: string; name: string; file_url: string; order: number }[] = []
  const total = i.stems.length
  for (let n = 0; n < total; n++) {
    const stem = i.stems[n]
    status(CLOUD_STATUS.stem(stem.name, n + 1, total))
    let fileUrl: string
    if (/^https?:\/\//.test(stem.url)) {
      const key = `stems/${i.userId}/${songId}/${stem.id}_${Date.now()}.wav`
      const copyRes = await fetch(apiUrl('/api/upload-stem-from-url'), {
        method: 'POST',
        headers: await getAuthHeaders(),
        body: JSON.stringify({ sourceUrl: stem.url, key, contentType: 'audio/wav' }),
      })
      if (!copyRes.ok) throw new Error(await errorText(copyRes, `Falha no upload server-side: HTTP ${copyRes.status}`))
      fileUrl = (await copyRes.json() as { url: string }).url
    } else {
      const blob = await (await fetch(stem.url)).blob()
      const stemFile = new File([blob], `${stem.id}.wav`, { type: blob.type || 'audio/wav' })
      const up = await uploadToR2('stems', `${songId}/IA_${Date.now()}_${stem.id}.wav`, stemFile)
      if (up.error || !up.url) throw new Error(up.error || 'Falha ao subir a faixa')
      fileUrl = up.url
    }
    stemsData.push({ song_id: songId, name: stem.name || stem.id, file_url: fileUrl, order: n + 1 })
    progress = 10 + Math.floor(((n + 1) / total) * 80)
    status(CLOUD_STATUS.stem(stem.name, n + 1, total))
  }

  if (i.voiceGuide) {
    status(CLOUD_STATUS.guide)
    try {
      const guideBlob = await i.voiceGuide()
      if (guideBlob) {
        const guideFile = new File([guideBlob], 'voz_guia.wav', { type: 'audio/wav' })
        const up = await uploadToR2('stems', `${songId}/voz_guia_${Date.now()}.wav`, guideFile)
        if (!up.error && up.url) stemsData.push({ song_id: songId, name: 'Voz Guia', file_url: up.url, order: total + 1 })
      }
    } catch (e) { console.error('Voz Guia render error', e) }
  }

  status(CLOUD_STATUS.finish)
  const stemsRes = await fetch(apiUrl('/api/insert-stems'), {
    method: 'POST',
    headers: await getAuthHeaders(),
    body: JSON.stringify({ stems: stemsData }),
  })
  if (!stemsRes.ok) throw new Error(await errorText(stemsRes, `HTTP ${stemsRes.status}`))
}

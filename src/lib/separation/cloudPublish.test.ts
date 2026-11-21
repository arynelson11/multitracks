import { beforeEach, describe, expect, it, vi } from 'vitest'

const r2 = vi.hoisted(() => ({ uploadToR2: vi.fn() }))
vi.mock('../r2', () => r2)
vi.mock('../supabase', () => ({ getAuthHeaders: async () => ({ 'Content-Type': 'application/json', Authorization: 'Bearer t' }) }))

import { publishToCloud, type CloudPublishInput } from './cloudPublish'

const TRAVESSAO = String.fromCharCode(0x2014)
type Call = { url: string; body: Record<string, unknown> | null }
let calls: Call[] = []

function server(over: Partial<Record<string, () => { ok: boolean; status?: number; json: () => Promise<unknown> }>> = {}) {
  return vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : null })
    for (const [k, v] of Object.entries(over)) if (url.includes(k) && v) return v()
    if (url.includes('/api/insert-song')) return { ok: true, json: async () => ({ id: 'song_9' }) }
    if (url.includes('/api/upload-stem-from-url')) return { ok: true, json: async () => ({ url: 'https://r2/copia.wav' }) }
    if (url.includes('/api/insert-stems')) return { ok: true, json: async () => ({}) }
    if (url.startsWith('blob:')) return { ok: true, blob: async () => new Blob(['l'], { type: 'audio/wav' }) }
    throw new Error('url inesperada ' + url)
  })
}

const base = (over: Partial<CloudPublishInput> = {}): CloudPublishInput => ({
  songName: 'Águas', artist: '', songKey: 'D', bpm: 72, cover: null, isGlobal: false, userId: 'u1',
  stems: [
    { id: 'vocals', name: 'Vocais', url: 'https://r2/vocais.wav' },
    { id: 'metronome', name: 'Metrônomo', url: 'blob:click' },
  ],
  voiceGuide: async () => new Blob(['g'], { type: 'audio/wav' }),
  ...over,
})

beforeEach(() => {
  calls = []
  r2.uploadToR2.mockReset()
  r2.uploadToR2.mockImplementation(async (folder: string, name: string) => ({ url: `https://r2/${folder}/${name}` }))
})

describe('publishToCloud', () => {
  it('música, faixas remotas pelo servidor, locais pelo R2, voz guia no fim e o registro das faixas, nessa ordem', async () => {
    vi.stubGlobal('fetch', server())
    await publishToCloud(base(), () => {})
    const api = calls.map((c) => c.url.replace(/^https?:\/\/[^/]+/, '')).filter((u) => u.startsWith('/api/'))
    expect(api).toEqual(['/api/insert-song', '/api/upload-stem-from-url', '/api/insert-stems'])
    const copy = calls.find((c) => c.url.includes('upload-stem-from-url'))!.body!
    expect(copy.sourceUrl).toBe('https://r2/vocais.wav')
    expect(String(copy.key)).toMatch(/^stems\/u1\/song_9\/vocals_\d+\.wav$/)
    // A local (blob:) vai pelo R2, e a voz guia depois dela.
    expect(r2.uploadToR2.mock.calls.map((c) => c[0])).toEqual(['stems', 'stems'])
    expect(String(r2.uploadToR2.mock.calls[0][1])).toMatch(/^song_9\/IA_\d+_metronome\.wav$/)
    expect(String(r2.uploadToR2.mock.calls[1][1])).toMatch(/^song_9\/voz_guia_\d+\.wav$/)
    const stems = calls.find((c) => c.url.includes('insert-stems'))!.body!.stems as { name: string; order: number }[]
    expect(stems.map((s) => [s.name, s.order])).toEqual([['Vocais', 1], ['Metrônomo', 2], ['Voz Guia', 3]])
  })

  it('publishToCloud manda is_global só como recebeu e artista vazio como Desconhecido', async () => {
    vi.stubGlobal('fetch', server())
    await publishToCloud(base({ isGlobal: true, voiceGuide: null }), () => {})
    const song = calls.find((c) => c.url.includes('insert-song'))!.body!
    expect(song).toEqual({ name: 'Águas', artist: 'Desconhecido', key: 'D', bpm: 72, cover_url: null, is_global: true })
    calls = []
    await publishToCloud(base({ artist: 'Hillsong' }), () => {})
    expect(calls.find((c) => c.url.includes('insert-song'))!.body!).toMatchObject({ artist: 'Hillsong', is_global: false })
  })

  it('capa sobe pro R2 em covers e entra na música', async () => {
    vi.stubGlobal('fetch', server())
    const cover = new File(['c'], 'capa.png', { type: 'image/png' })
    await publishToCloud(base({ cover, voiceGuide: null }), () => {})
    expect(r2.uploadToR2.mock.calls[0][0]).toBe('covers')
    expect(String(calls.find((c) => c.url.includes('insert-song'))!.body!.cover_url)).toMatch(/^https:\/\/r2\/covers\//)
  })

  it('publishToCloud: erro do servidor na música vira a frase dele', async () => {
    vi.stubGlobal('fetch', server({ '/api/insert-song': () => ({ ok: false, status: 403, json: async () => ({ error: 'sem permissão' }) }) }))
    await expect(publishToCloud(base(), () => {})).rejects.toThrow('sem permissão')
  })

  it('falha ao copiar uma faixa derruba a publicação com a frase do servidor', async () => {
    vi.stubGlobal('fetch', server({ '/api/upload-stem-from-url': () => ({ ok: false, status: 500, json: async () => ({ error: 'R2 fora' }) }) }))
    await expect(publishToCloud(base(), () => {})).rejects.toThrow('R2 fora')
  })

  it('progresso de 10 até 90 pelas faixas e nenhum texto de status com travessão', async () => {
    vi.stubGlobal('fetch', server())
    const seen: { status: string; progress: number }[] = []
    await publishToCloud(base(), (s) => seen.push(s))
    expect(seen[0]).toEqual({ status: 'Criando a música na sua biblioteca...', progress: 0 })
    expect(seen.map((s) => s.status)).toContain('Enviando Vocais pra nuvem (1 de 2)...')
    // Nada técnico nem emoji na tela (banco de dados, implantando, renderizando).
    for (const s of seen) expect(s.status).not.toMatch(/banco de dados|Implantando|Renderizando|☁/)
    expect(seen.map((s) => s.progress)).toContain(10)
    expect(Math.max(...seen.map((s) => s.progress))).toBe(90)
    expect(seen.at(-1)!.status).toBe('Terminando de salvar...')
    for (const s of seen) expect(s.status).not.toContain(TRAVESSAO)
  })
})

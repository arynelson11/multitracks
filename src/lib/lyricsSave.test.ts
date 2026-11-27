// Manutenção (2026-11-27): a letra e a cifra vão pra música da id que o editor guardou ao abrir,
// no aparelho e na nuvem, mesmo que a música ativa tenha mudado; fora do repertório, nada é gravado.
import { describe, expect, it, vi } from 'vitest'
import { saveSongLyrics } from './lyricsSave'

const DATA = { lyrics: 'Grande é o Senhor', lyricsSynced: null, chords: 'E  B' }
const PLAYLIST = [
  { id: 'ativa', name: 'Aclame ao Senhor', sourceId: 'cloud-ativa' },
  { id: 'aberta', name: 'Grande é o Senhor', sourceId: 'cloud-aberta' },
  { id: 'local', name: 'Do computador' },
]

function deps(over: Partial<Parameters<typeof saveSongLyrics>[2]> = {}) {
  return {
    playlist: PLAYLIST,
    setLocal: vi.fn(),
    fetchCloudSongs: vi.fn(async () => [{ id: 'cloud-ativa' }, { id: 'cloud-aberta' }]),
    updateSong: vi.fn(async () => true),
    ...over,
  }
}

describe('saveSongLyrics', () => {
  it('grava no aparelho e na nuvem a música da id, não a ativa', async () => {
    const d = deps()
    expect(await saveSongLyrics('aberta', DATA, d)).toBe(true)
    expect(d.setLocal).toHaveBeenCalledWith('aberta', DATA)
    expect(d.updateSong).toHaveBeenCalledWith('cloud-aberta', { lyrics: 'Grande é o Senhor', lyrics_synced: null, chords: 'E  B' })
  })

  it('música sem a id da nuvem fica só no aparelho', async () => {
    const d = deps()
    expect(await saveSongLyrics('local', DATA, d)).toBe(false)
    expect(d.setLocal).toHaveBeenCalledWith('local', DATA)
    expect(d.fetchCloudSongs).not.toHaveBeenCalled()
  })

  it('a nuvem falhou ou não achou: fica só no aparelho', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    const falha = deps({ fetchCloudSongs: vi.fn(async () => { throw new Error('rede') }) })
    expect(await saveSongLyrics('aberta', DATA, falha)).toBe(false)
    expect(falha.setLocal).toHaveBeenCalledWith('aberta', DATA)
    err.mockRestore()
    const sumiu = deps({ fetchCloudSongs: vi.fn(async () => [{ id: 'cloud-ativa' }]) })
    expect(await saveSongLyrics('aberta', DATA, sumiu)).toBe(false)
    expect(sumiu.updateSong).not.toHaveBeenCalled()
  })

  it('a música saiu do repertório: nada é gravado, nem no aparelho nem na nuvem', async () => {
    const d = deps()
    expect(await saveSongLyrics('apagada', DATA, d)).toBe('missing')
    expect(d.setLocal).not.toHaveBeenCalled()
    expect(d.fetchCloudSongs).not.toHaveBeenCalled()
    expect(d.updateSong).not.toHaveBeenCalled()
  })
})

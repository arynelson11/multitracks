import { describe, expect, it } from 'vitest'
import type { CloudSong } from '../../lib/supabase'
import { downloadStateOf, libraryCountText, libraryEmptyText, songsForTab } from './libraryRows'

const song = (id: string, over: Partial<CloudSong>) => ({ id, name: id, artist: '', key: 'C', bpm: 120, cover_url: null, markers: null, created_at: '', ...over }) as CloudSong

describe('regras da Biblioteca', () => {
  const songs = [
    song('global', { is_global: true, user_id: 'u1' }),
    song('minha', { is_global: false, user_id: 'u1' }),
    song('sem-flag', { user_id: 'u1' }),
    song('de-outro', { is_global: false, user_id: 'u2' }),
  ]

  it('songsForTab: Plataforma só global; Minhas Músicas só do usuário e não global', () => {
    expect(songsForTab(songs, 'platform', 'u1').map((s) => s.id)).toEqual(['global'])
    expect(songsForTab(songs, 'personal', 'u1').map((s) => s.id)).toEqual(['minha', 'sem-flag'])
    expect(songsForTab(songs, 'personal', 'u2').map((s) => s.id)).toEqual(['de-outro'])
    // Sem conta, nenhuma pessoal.
    expect(songsForTab(songs, 'personal', null)).toEqual([])
  })

  it('libraryEmptyText: com busca, Nenhuma música encontrada.; sem, por aba', () => {
    expect(libraryEmptyText('fé', 'platform')).toBe('Nenhuma música encontrada.')
    expect(libraryEmptyText('fé', 'personal')).toBe('Nenhuma música encontrada.')
    expect(libraryEmptyText('', 'platform')).toBe('Plataforma vazia.')
    expect(libraryEmptyText('', 'personal')).toBe('Nenhuma música pessoal encontrada.')
  })

  it('libraryCountText: 1 música exibida e 3 músicas exibidas', () => {
    expect(libraryCountText(1)).toBe('1 música exibida')
    expect(libraryCountText(3)).toBe('3 músicas exibidas')
    expect(libraryCountText(0)).toBe('0 músicas exibidas')
  })
})

describe('estado do botão de baixar', () => {
  it('downloadStateOf segue a ordem de hoje: baixando > adicionada > offline fora do cache > abrir no cache > importar', () => {
    const base = { downloading: false, added: false, online: true, cached: false }
    expect(downloadStateOf({ ...base, downloading: true, added: true, online: false })).toBe('downloading')
    expect(downloadStateOf({ ...base, added: true, online: false })).toBe('added')
    expect(downloadStateOf({ ...base, online: false })).toBe('offline')
    expect(downloadStateOf({ ...base, online: false, cached: true })).toBe('open')
    expect(downloadStateOf({ ...base, cached: true })).toBe('open')
    expect(downloadStateOf(base)).toBe('import')
  })
})

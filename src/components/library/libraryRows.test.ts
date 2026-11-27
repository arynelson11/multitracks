import { describe, expect, it } from 'vitest'
import type { CloudSong } from '../../lib/supabase'
import { DELETE_COPY, ROW_COPY, downloadStateOf, libraryCountText, libraryEmptyText, removeScopeHolds, removeScopeOf, songsForTab } from './libraryRows'

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

describe('a lixeira (inicio-1 M5, Ruling lixeira-biblioteca)', () => {
  it('removeScopeOf: da nuvem só o admin com internet; deste aparelho quem tem a música nele; senão nenhuma', () => {
    expect(removeScopeOf({ online: true, isAdmin: true, cached: false })).toBe('cloud')
    expect(removeScopeOf({ online: true, isAdmin: true, cached: true })).toBe('cloud')
    expect(removeScopeOf({ online: true, isAdmin: false, cached: true })).toBe('device')
    expect(removeScopeOf({ online: false, isAdmin: true, cached: true })).toBe('device')
    expect(removeScopeOf({ online: false, isAdmin: false, cached: true })).toBe('device')
    // O dono que não é admin não apaga na nuvem (a RLS não deixa): sem a música no aparelho, nada.
    expect(removeScopeOf({ online: true, isAdmin: false, cached: false })).toBeNull()
    expect(removeScopeOf({ online: false, isAdmin: true, cached: false })).toBeNull()
  })

  it('removeScopeHolds: a confirmação aberta continua com o escopo dela enquanto ele dá pra fazer (Ruling INICIO-residuais)', () => {
    // Aberta como tirar do aparelho: a internet voltar (o admin passaria a excluir da nuvem) não muda nada.
    expect(removeScopeHolds('device', { online: true, isAdmin: true, cached: true })).toBe(true)
    expect(removeScopeHolds('device', { online: false, isAdmin: false, cached: true })).toBe(true)
    // A música saiu do aparelho: não tem mais o que tirar.
    expect(removeScopeHolds('device', { online: true, isAdmin: true, cached: false })).toBe(false)
    // Aberta como excluir da nuvem: só com internet e sendo admin.
    expect(removeScopeHolds('cloud', { online: true, isAdmin: true, cached: false })).toBe(true)
    expect(removeScopeHolds('cloud', { online: false, isAdmin: true, cached: true })).toBe(false)
    expect(removeScopeHolds('cloud', { online: true, isAdmin: false, cached: true })).toBe(false)
  })
})

describe('textos pro usuário (Ruling INICIO-residuais)', () => {
  it('a dica do ABRIR e as janelas da lixeira falam do aparelho, nunca de cache', () => {
    expect(ROW_COPY.openTitle).toBe('Abrir a música guardada neste aparelho')
    expect(DELETE_COPY.body('Fé', 'cloud')).toBe('Excluir "Fé" da Nuvem e deste aparelho? Isso removerá permanentemente para todos os usuários.')
    for (const t of [ROW_COPY.openTitle, ROW_COPY.importTitle, ROW_COPY.offlineTitle, DELETE_COPY.body('Fé', 'cloud'), DELETE_COPY.body('Fé', 'device')]) {
      expect(t).not.toMatch(/cache|offline/i)
    }
  })
})

// Regras e textos da Biblioteca na Nuvem (LibraryModal + LibraryView), fora do componente: a
// aba de cada música, as frases de vazio e do rodapé. As regras são as de antes da linguagem do palco.
import type { CloudSong } from '../../lib/supabase'

export type LibraryTab = 'platform' | 'personal'

export const LIBRARY_COPY = {
  title: 'Biblioteca na Nuvem',
  search: 'Pesquisar',
  searchPlaceholder: 'Pesquisar por nome, artista ou tom...',
  refresh: 'Atualizar',
  refreshTitle: 'Atualizar a lista',
  tabs: 'Biblioteca',
  platform: 'Plataforma',
  personal: 'Minhas Músicas',
  loading: 'Carregando a biblioteca...',
} as const

/** Plataforma: só as globais. Minhas Músicas: as do próprio usuário que não são globais. */
export function songsForTab(songs: readonly CloudSong[], tab: LibraryTab, userId: string | null | undefined): CloudSong[] {
  return songs.filter((s) => (tab === 'platform' ? s.is_global === true : s.is_global !== true && s.user_id === userId))
}

/** Lista vazia: com busca, nada encontrado; sem busca, a frase da aba. */
export function libraryEmptyText(query: string, tab: LibraryTab): string {
  if (query) return 'Nenhuma música encontrada.'
  return tab === 'platform' ? 'Plataforma vazia.' : 'Nenhuma música pessoal encontrada.'
}

/** Rodapé: quantas músicas a aba mostra. */
export function libraryCountText(n: number): string {
  return n === 1 ? '1 música exibida' : `${n} músicas exibidas`
}

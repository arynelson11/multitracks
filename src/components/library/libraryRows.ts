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

// ---------- As músicas da lista (T3) ----------

/** O botão de baixar de cada música, na ordem de antes: baixando, adicionada, sem internet fora do cache, abrir do cache, importar. */
export type DownloadState = 'downloading' | 'added' | 'offline' | 'open' | 'import'

export function downloadStateOf(i: { downloading: boolean; added: boolean; online: boolean; cached: boolean }): DownloadState {
  if (i.downloading) return 'downloading'
  if (i.added) return 'added'
  if (!i.online && !i.cached) return 'offline'
  return i.cached ? 'open' : 'import'
}

/** Uma música da lista, pronta pra vista. */
export interface LibraryRow {
  id: string
  name: string
  artist: string | null
  coverUrl: string | null
  key: string | null
  bpm: number | undefined
  cached: boolean
  state: DownloadState
  /** O andamento do download (a frase do useCloudLibrary). */
  progress: string
  /** Editar: com internet, admin ou dono. */
  canEdit: boolean
  /** Excluir: no cache, ou com internet sendo admin ou dono. */
  canDelete: boolean
  deleting: boolean
}

/** A edição aberta numa linha: o que está digitado (o BPM como texto, aceita "72,5"). */
export interface LibraryEdit {
  id: string
  name: string
  artist: string
  bpmText: string
  key: string
  file: File | null
}

export const ROW_COPY = {
  unknownArtist: 'Artista Desconhecido',
  key: (k: string) => `TOM: ${k}`,
  bpm: (b: number) => `${b} BPM`,
  cached: 'OFFLINE',
  edit: 'Editar metadados',
  deleteOnline: 'Excluir da Nuvem',
  deleteOffline: 'Remover do Cache Local',
  import: 'IMPORTAR',
  importTitle: 'Baixar e importar da Nuvem',
  open: 'ABRIR',
  openTitle: 'Carregar do cache local offline',
  offline: 'OFFLINE',
  offlineTitle: 'Conecte-se à internet para baixar esta música',
  added: 'ADICIONADA',
  cancel: 'Cancelar',
  cancelTitle: 'Cancelar download',
  downloading: 'Baixando',
} as const

export const EDIT_COPY = {
  title: 'Editar Música',
  close: 'Fechar a edição',
  name: 'Nome',
  artist: 'Artista',
  bpm: 'BPM',
  key: 'Tom',
  cover: 'Nova Capa (Opcional)',
  coverPick: 'Escolher imagem...',
  save: 'SALVAR',
  saving: 'Salvando',
  saveError: 'Erro ao salvar alterações na música.',
  editError: 'Erro ao editar.',
} as const

/** A confirmação de excluir: com internet some da nuvem pra todos; sem, só sai do aparelho. Os textos de antes. */
export const DELETE_COPY = {
  titleOnline: 'Excluir da nuvem?',
  titleOffline: 'Remover do aparelho?',
  body: (name: string, online: boolean) => (online
    ? `Excluir "${name}" da Nuvem e do Cache Local? Isso removerá permanentemente para todos os usuários.`
    : `Remover "${name}" do Cache Offline local?`),
  cancel: 'Cancelar',
  confirm: 'Excluir',
} as const

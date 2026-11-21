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

/** De onde a lixeira tira a música: da nuvem pra todos, ou só deste aparelho. */
export type RemoveScope = 'cloud' | 'device'

/**
 * A lixeira (inicio-1 M5, Ruling lixeira-biblioteca): excluir da nuvem, com o aviso de que some pra
 * todos, só o admin com internet (a nuvem não deixa mais ninguém apagar); quem tem a música no
 * aparelho tira só dele. Sem as duas coisas, nada de lixeira.
 */
export function removeScopeOf(i: { online: boolean; isAdmin: boolean; cached: boolean }): RemoveScope | null {
  if (i.online && i.isAdmin) return 'cloud'
  return i.cached ? 'device' : null
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
  /** A lixeira (removeScopeOf): da nuvem, deste aparelho, ou nenhuma. */
  remove: RemoveScope | null
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
  deleteCloud: 'Excluir da Nuvem',
  deleteDevice: 'Tirar deste aparelho',
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

/** A confirmação da lixeira: o admin exclui da nuvem pra todos (o texto de antes); quem tira deste aparelho tem o texto dele. */
export const DELETE_COPY = {
  title: (scope: RemoveScope) => (scope === 'cloud' ? 'Excluir da nuvem?' : 'Tirar deste aparelho?'),
  body: (name: string, scope: RemoveScope) => (scope === 'cloud'
    ? `Excluir "${name}" da Nuvem e do Cache Local? Isso removerá permanentemente para todos os usuários.`
    : `Tirar "${name}" deste aparelho? Ela continua na Biblioteca na Nuvem e dá pra baixar de novo.`),
  cancel: 'Cancelar',
  confirmLabel: (scope: RemoveScope) => (scope === 'cloud' ? 'Excluir' : 'Tirar'),
} as const

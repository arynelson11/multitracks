import type { Channel, ChannelOrderMode, ChannelRole, Marker, Song } from '../types'
import { normalizeCustomName } from './channelRoles'

// Formato do repertório do usuário salvo no aparelho (IndexedDB, chave
// mt_meta_playlist_<userId>) e do manifest.json do ZIP de repertório.
// v1: registros sem schemaVersion (antes da Parte 1).
// v2: ganha sourceId, nome e papel escolhidos pelo usuário em cada canal e o modo de ordem.
export const REPERTOIRE_SCHEMA_VERSION = 2

export interface SavedChannel {
  id: string
  // Nome original do arquivo. Nunca é sobrescrito.
  name: string
  volume: number
  muted: boolean
  soloed: boolean
  pan: number
  bus: '1' | '2' | '1/2'
  // Ponteiro pro stem no cache offline (músicas baixadas). Quando presente, o
  // repertório lê os bytes do cache em vez de ter uma 2ª cópia própria.
  srcId?: string
  srcIdx?: number
  customName?: string
  role?: ChannelRole
}

export interface SavedSong {
  id: string
  sourceId?: string
  name: string
  bpm?: number
  coverImage?: string
  channels: SavedChannel[]
  duration: number
  pitch?: number
  originalKey?: string | null
  // Metadados que também precisam sobreviver offline (reabrir o app). Sem
  // isso, marcadores/seções, letra e cifra se perdiam ao fechar.
  artist?: string
  markers?: Marker[]
  lyrics?: string | null
  lyricsSynced?: string | null
  chords?: string | null
  channelOrder?: ChannelOrderMode
  schemaVersion?: number
}

// Só os campos persistidos do canal: aceita o Channel vivo (com buffer e nós de
// áudio) sem que nada disso entre no registro salvo.
export type ChannelLike = Pick<Channel, 'id' | 'name' | 'volume' | 'muted' | 'soloed' | 'pan' | 'bus' | 'srcId' | 'srcIdx' | 'customName' | 'role'>
export type SongLike = Omit<Song, 'channels'> & { channels: ChannelLike[] }

// Monta campo a campo de propósito: espalhar o canal levaria buffer, nós de áudio e file pro IndexedDB.
export function toSavedChannel(ch: ChannelLike): SavedChannel {
  return {
    id: ch.id,
    name: ch.name,
    volume: ch.volume,
    muted: ch.muted,
    soloed: ch.soloed,
    pan: ch.pan,
    bus: ch.bus || '1/2',
    srcId: ch.srcId,
    srcIdx: ch.srcIdx,
    customName: ch.customName,
    role: ch.role,
  }
}

export function toSavedSong(song: SongLike): SavedSong {
  return {
    id: song.id,
    sourceId: song.sourceId,
    name: song.name,
    coverImage: song.coverImage,
    duration: song.duration,
    channels: song.channels.map(toSavedChannel),
    pitch: song.pitch || 0,
    originalKey: song.originalKey || null,
    bpm: song.bpm,
    artist: song.artist,
    markers: song.markers,
    lyrics: song.lyrics ?? null,
    lyricsSynced: song.lyricsSynced ?? null,
    chords: song.chords ?? null,
    channelOrder: song.channelOrder ?? 'auto',
    schemaVersion: REPERTOIRE_SCHEMA_VERSION,
  }
}

// Registro v1 não diz se a ordem foi arrumada na mão. Só dá pra provar quando
// todo canal tem srcIdx (posição original no download): o carregamento monta os
// canais em srcIdx crescente, então um srcIdx que decresce só vem de arraste.
export function inferChannelOrder(channels: readonly SavedChannel[]): ChannelOrderMode {
  const order: number[] = []
  for (const ch of channels) {
    if (typeof ch.srcIdx !== 'number') return 'auto'
    order.push(ch.srcIdx)
  }
  return order.some((idx, i) => i > 0 && idx < order[i - 1]) ? 'manual' : 'auto'
}

// Repertório salvo no aparelho. Idempotente: registro v2 volta igual.
export function migrateSavedSong(saved: SavedSong): SavedSong {
  if (saved.schemaVersion === REPERTOIRE_SCHEMA_VERSION) return saved
  return {
    ...saved,
    channelOrder: saved.channelOrder ?? inferChannelOrder(saved.channels),
    schemaVersion: REPERTOIRE_SCHEMA_VERSION,
  }
}

const CHANNEL_ROLES: ReadonlySet<unknown> = new Set<ChannelRole>(['click', 'guide', 'normal'])

// O ZIP pode vir de outra igreja, de outra versão ou mexido à mão: papel desconhecido
// é descartado (o canal fica no automático) e o nome passa pela mesma regra do EDITAR CANAIS.
function sanitizeManifestChannel(ch: SavedChannel): SavedChannel {
  const { customName, role, ...rest } = ch
  const out: SavedChannel = rest
  const name = typeof customName === 'string' ? normalizeCustomName(customName) : ''
  if (name) out.customName = name
  if (CHANNEL_ROLES.has(role)) out.role = role
  return out
}

// Música lida do manifest.json de um ZIP importado. O manifest da versão antiga
// não tem channelOrder nem srcIdx: a ordem do arquivo é a que o usuário deixou,
// então ela fica manual em vez de virar a ordem padrão. Idempotente.
export function migrateManifestSong(entry: SavedSong): SavedSong {
  return {
    ...entry,
    channels: Array.isArray(entry.channels) ? entry.channels.map(sanitizeManifestChannel) : entry.channels,
    channelOrder: entry.channelOrder ?? 'manual',
    schemaVersion: REPERTOIRE_SCHEMA_VERSION,
  }
}

export interface ManifestChannel {
  id: string
  name: string
  volume: number
  muted: boolean
  soloed: boolean
  pan: number
  bus: '1' | '2' | '1/2'
  customName?: string
  role?: ChannelRole
}

export interface ManifestSong {
  id: string
  name: string
  coverImage?: string
  duration: number
  channelOrder: ChannelOrderMode
  channels: ManifestChannel[]
}

// Entrada do manifest.json do ZIP de repertório. Sem srcId/srcIdx: o áudio vai
// dentro do ZIP, e o ponteiro pro cache offline só vale no aparelho que exportou.
export function toManifestSong(song: SongLike): ManifestSong {
  return {
    id: song.id,
    name: song.name,
    coverImage: song.coverImage,
    duration: song.duration,
    channelOrder: song.channelOrder ?? 'auto',
    channels: song.channels.map((ch) => ({
      id: ch.id,
      name: ch.name,
      volume: ch.volume,
      muted: ch.muted,
      soloed: ch.soloed,
      pan: ch.pan,
      bus: ch.bus || '1/2',
      customName: ch.customName,
      role: ch.role,
    })),
  }
}

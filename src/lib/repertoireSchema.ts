import type { Channel, ChannelOrderMode, ChannelRole, Marker, Song, SeparationLink } from '../types'
import { normalizeCustomName } from './channelRoles'
import { sanitizeTimeSignature } from './cloudBpm'
import { sanitizeGrid } from './songGrid'
import type { SongGrid, TimeSignature } from './stageContracts'

// Formato do repertório do usuário salvo no aparelho (IndexedDB, chave
// mt_meta_playlist_<userId>) e do manifest.json do ZIP de repertório.
// v1: registros sem schemaVersion (antes da Parte 1).
// v2: ganha sourceId, nome e papel escolhidos pelo usuário em cada canal e o modo de ordem.
// v3: ganha a grade da música (lida no click, com o compasso manual do EDITAR), o compasso
//     salvo na nuvem e, junto da grade de click, a marca do 1 não provado (downbeatAssumed,
//     Ruling T27-campo). Todos opcionais: registro sem eles abre como antes (sem aviso).
export const REPERTOIRE_SCHEMA_VERSION = 3

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
  // Grade da música (v3). Só grade que o sanitizeGrid aceita chega aqui.
  grid?: SongGrid
  // Compasso salvo na nuvem (songs.time_signature), quando a música tem (v3).
  timeSignature?: TimeSignature
  // O 1 da grade de click não foi provado (Ruling T27-campo): o COMPASSO ASSUMIDO volta ao
  // reabrir, também com o compasso escolhido no EDITAR. Só `true` e só com grade de click;
  // ausente (registros de antes) quer dizer sem aviso. Não vai pro ZIP, como a grade.
  downbeatAssumed?: true
  // O usuário apagou um canal de Click (Ruling X1-critical): o click gerado não volta no lugar.
  // Só `true`; ausente nos registros de antes. Não vai pro ZIP, como a grade.
  clickRemoved?: true
  // A separação de onde a música veio (Parte 3). Só a conta usa; não vai pro ZIP (P11).
  separation?: SeparationLink
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
    grid: sanitizeGrid(song.grid) ?? undefined,
    timeSignature: sanitizeTimeSignature(song.timeSignature) ?? undefined,
    downbeatAssumed: oneAssumedWith(song.grid, song.downbeatAssumed),
    clickRemoved: song.clickRemoved === true ? true : undefined,
    ...separationField(song.separation),
    schemaVersion: REPERTOIRE_SCHEMA_VERSION,
  }
}

// Só cria a chave quando há ligação: o registro de música comum fica igual ao de antes.
function separationField(v: unknown): Pick<SavedSong, 'separation'> {
  const link = sanitizeSeparationLink(v)
  return link ? { separation: link } : {}
}

/** Ligação com a separação que pode entrar no aparelho: id em texto não vazio e data em número finito. */
export function sanitizeSeparationLink(v: unknown): SeparationLink | undefined {
  if (!v || typeof v !== 'object') return undefined
  const { id, createdAt } = v as { id?: unknown; createdAt?: unknown }
  if (typeof id !== 'string' || id === '' || typeof createdAt !== 'number' || !Number.isFinite(createdAt)) return undefined
  return { id, createdAt }
}

// O 1 assumido só vale com grade de click (é dela) e só como `true`.
function oneAssumedWith(grid: unknown, downbeatAssumed: unknown): true | undefined {
  return downbeatAssumed === true && sanitizeGrid(grid)?.source === 'click' ? true : undefined
}

// Grade e compasso que podem entrar no aparelho: grade quebrada (bpm NaN, compasso
// desconhecido) e compasso que o banco recusaria saem do registro, sem chave com null,
// e a música abre sem grade, como antes da Parte 2. O 1 assumido só fica com grade de click.
// O resto do registro não muda.
function savedMeter(grid: unknown, timeSignature: unknown, downbeatAssumed: unknown): Pick<SavedSong, 'grid' | 'timeSignature' | 'downbeatAssumed'> {
  const out: Pick<SavedSong, 'grid' | 'timeSignature' | 'downbeatAssumed'> = {}
  const g = sanitizeGrid(grid)
  if (g) out.grid = g
  const ts = sanitizeTimeSignature(timeSignature)
  if (ts) out.timeSignature = ts
  if (oneAssumedWith(g, downbeatAssumed)) out.downbeatAssumed = true
  return out
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

// Repertório salvo no aparelho, de qualquer versão até a atual, sem perder campo nenhum.
// v1 → v2: só registro sem versão infere a ordem (o v2 já gravou a dele).
// v2 → v3: grade e compasso passam pela regra do palco também no registro v3, porque o
// aparelho guarda o que vier (inclusive NaN). Idempotente.
export function migrateSavedSong(saved: SavedSong): SavedSong {
  const { grid, timeSignature, downbeatAssumed, separation, ...rest } = saved
  const isV1 = typeof saved.schemaVersion !== 'number' || saved.schemaVersion < 2
  // A ligação com a separação (Parte 3) passa pela mesma regra: estragada, a música abre sem ela.
  return {
    ...rest,
    ...(isV1 ? { channelOrder: saved.channelOrder ?? inferChannelOrder(saved.channels) } : {}),
    ...savedMeter(grid, timeSignature, downbeatAssumed),
    ...separationField(separation),
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
// então ela fica manual em vez de virar a ordem padrão. O ZIP não leva a grade (nem
// marcadores nem tom): a que vier num manifest mexido à mão sai, e a grade é lida de
// novo do click depois do import. Idempotente.
export function migrateManifestSong(entry: SavedSong): SavedSong {
  const out: SavedSong = {
    ...entry,
    channels: Array.isArray(entry.channels) ? entry.channels.map(sanitizeManifestChannel) : entry.channels,
    channelOrder: entry.channelOrder ?? 'manual',
    schemaVersion: REPERTOIRE_SCHEMA_VERSION,
  }
  delete out.grid
  delete out.timeSignature
  delete out.downbeatAssumed
  // A ligação com a separação vale só na conta de quem separou (P11): nunca entra pelo ZIP.
  delete out.separation
  return { ...out, ...savedMeter(null, entry.timeSignature, undefined) }
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

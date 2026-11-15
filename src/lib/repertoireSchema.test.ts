import { describe, expect, it } from 'vitest'
import {
  inferChannelOrder,
  migrateManifestSong,
  migrateSavedSong,
  toManifestSong,
  toSavedSong,
  type SavedSong,
  type SongLike,
} from './repertoireSchema'

const v1: SavedSong = {
  id: 's1', name: 'Ministério - Grande és Tu', bpm: 72, coverImage: 'data:image/png;base64,AAA', duration: 312.5,
  pitch: -2, originalKey: 'G', artist: 'Ministério',
  markers: [{ id: 'm1', time: 12.3, label: 'Refrão', color: '#FF6B35', lyrics: 'linha' }],
  lyrics: 'letra', lyricsSynced: '[00:12.30] linha', chords: 'G D Em',
  channels: [
    { id: 'a', name: 'CLICK 13', volume: 0.7, muted: false, soloed: false, pan: -1, bus: '1', srcId: 'cloud-1', srcIdx: 0 },
    { id: 'b', name: 'BASS_1', volume: 1.1, muted: true, soloed: false, pan: 1, bus: '2', srcId: 'cloud-1', srcIdx: 1 },
    { id: 'c', name: 'GTR SOLO_1', volume: 0.5, muted: false, soloed: true, pan: 0.3, bus: '1/2', srcId: 'cloud-1', srcIdx: 2 },
  ],
}

// Formato exato do manifest.json que a versão antiga grava no ZIP (exportPlaylist
// antes da Parte 1): sem channelOrder, sem srcId/srcIdx e sem os metadados da música.
const manifestAntigo: SavedSong = {
  id: v1.id, name: v1.name, coverImage: v1.coverImage, duration: v1.duration,
  channels: v1.channels.map(({ id, name, volume, muted, soloed, pan, bus }) => ({ id, name, volume, muted, soloed, pan, bus })),
}

describe('repertório v2', () => {
  it('migrateSavedSong preserva um registro v1 real inteiro', () => {
    expect(migrateSavedSong(v1)).toEqual({ ...v1, channelOrder: 'auto', schemaVersion: 2 })
  })
  it('ordem só é manual quando dá pra provar pelo srcIdx', () => {
    const ch = v1.channels
    expect(inferChannelOrder([ch[2], ch[0], ch[1]])).toBe('manual')
    expect(inferChannelOrder(ch)).toBe('auto')
    expect(inferChannelOrder(ch.map((c) => ({ ...c, srcIdx: undefined })))).toBe('auto')
    expect(inferChannelOrder([ch[1], { ...ch[0], srcIdx: undefined }])).toBe('auto')
  })
  it('migrateSavedSong respeita channelOrder que já veio no manifest e é idempotente', () => {
    const fromZip = { ...v1, channels: v1.channels.map((c) => ({ ...c, srcId: undefined, srcIdx: undefined })), channelOrder: 'manual' as const }
    expect(migrateSavedSong(fromZip).channelOrder).toBe('manual')
    const once = migrateSavedSong(v1)
    expect(migrateSavedSong(once)).toEqual(once)
  })
  it('ZIP da versão antiga (manifest sem channelOrder) volta em ordem manual e a restauração não desfaz', () => {
    const importado = migrateManifestSong(manifestAntigo)
    expect(importado).toEqual({ ...manifestAntigo, channelOrder: 'manual', schemaVersion: 2 })
    expect(migrateManifestSong(importado)).toEqual(importado)
    expect(migrateSavedSong(importado)).toEqual(importado)
    // O mesmo registro salvo no aparelho, sem passar pelo import do ZIP, continua inferindo.
    expect(migrateSavedSong(manifestAntigo).channelOrder).toBe('auto')
  })
  it('manifest novo devolve a ordem exportada, manual ou automática', () => {
    for (const channelOrder of ['manual', 'auto'] as const) {
      const manifest = JSON.parse(JSON.stringify(toManifestSong({ ...v1, channelOrder } as unknown as SongLike)))
      expect(migrateSavedSong(migrateManifestSong(manifest)).channelOrder).toBe(channelOrder)
    }
  })
  it('toSavedSong salva sourceId, nome e papel do usuário e nunca leva áudio', () => {
    const song = { ...v1, sourceId: 'cloud-1', channelOrder: 'manual',
      channels: v1.channels.map((c, i) => ({ ...c, buffer: {}, gainNode: {}, pannerNode: {}, sourceNode: null,
        pitchShiftNode: null, file: {}, ...(i === 1 ? { customName: 'Baixo do Zé', role: 'guide' } : {}) })),
    } as unknown as SongLike
    const saved = toSavedSong(song)
    expect(saved).toMatchObject({ sourceId: 'cloud-1', channelOrder: 'manual', schemaVersion: 2 })
    expect(saved.channels[1]).toMatchObject({ customName: 'Baixo do Zé', role: 'guide' })
    for (const ch of saved.channels) {
      expect(Object.keys(ch).every((k) => ['id', 'name', 'volume', 'muted', 'soloed', 'pan', 'bus', 'srcId', 'srcIdx', 'customName', 'role'].includes(k))).toBe(true)
    }
  })
  it('manifest do ZIP leva ordem, nome e papel', () => {
    const m = toManifestSong({ ...v1, channelOrder: 'manual', channels: v1.channels.map((c) => ({ ...c, role: 'normal' })) } as unknown as SongLike)
    expect(m.channelOrder).toBe('manual')
    expect(Object.keys(m).sort()).toEqual(['channelOrder', 'channels', 'coverImage', 'duration', 'id', 'name'])
    expect(m.channels[0]).toMatchObject({ id: 'a', name: 'CLICK 13', role: 'normal', bus: '1' })
    expect('srcIdx' in m.channels[0]).toBe(false)
  })
})

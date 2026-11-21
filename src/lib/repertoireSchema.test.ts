import { describe, expect, it } from 'vitest'
import {
  REPERTOIRE_SCHEMA_VERSION,
  inferChannelOrder,
  migrateManifestSong,
  migrateSavedSong,
  sanitizeSeparationLink,
  toManifestSong,
  toSavedSong,
  type SavedSong,
  type SongLike,
} from './repertoireSchema'
import { CUSTOM_NAME_MAX, applyChannelMetaPatch } from './channelRoles'
import { resolveChannelRole, type ChannelIdentity } from './channelNames'
import { keepManualMeter, sanitizeGrid, withMeter } from './songGrid'
import type { SongGrid } from './stageContracts'

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
    expect(importado).toEqual({ ...manifestAntigo, channelOrder: 'manual', schemaVersion: REPERTOIRE_SCHEMA_VERSION })
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
    expect(saved).toMatchObject({ sourceId: 'cloud-1', channelOrder: 'manual', schemaVersion: REPERTOIRE_SCHEMA_VERSION })
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

// Revisão final (N2): ZIP compartilhado entre igrejas (ou mexido à mão) não traz papel
// desconhecido nem nome maior que o do EDITAR CANAIS.
describe('ZIP importado: papel e nome validados', () => {
  const withMeta = (meta: object[]): SavedSong => ({
    ...manifestAntigo, channelOrder: 'manual', channels: manifestAntigo.channels.map((c, i) => ({ ...c, ...meta[i] })),
  })
  it('papel desconhecido é descartado e o canal fica no automático', () => {
    const [ch] = migrateManifestSong(withMeta([{ role: 'foo' }])).channels
    expect('role' in ch).toBe(false)
    expect(resolveChannelRole(ch)).toBe('click')
  })
  it('nome de 200 caracteres sai com no máximo 24, pela mesma regra do EDITAR CANAIS', () => {
    const [ch] = migrateManifestSong(withMeta([{ customName: 'A'.repeat(200) }])).channels
    expect(ch.customName?.length).toBeLessThanOrEqual(CUSTOM_NAME_MAX)
    expect(ch.customName).toBe(applyChannelMetaPatch<ChannelIdentity>({ id: 'a', name: 'x' }, { customName: 'A'.repeat(200) }).customName)
  })
  it('nome vazio ou que não é texto vira automático', () => {
    const channels = migrateManifestSong(withMeta([{ customName: '   ' }, { customName: 42 }])).channels
    expect(channels.slice(0, 2).map((c) => 'customName' in c)).toEqual([false, false])
  })
  it('valores válidos passam intactos e a migração continua idempotente', () => {
    const entry = withMeta([{ role: 'normal', customName: 'Click do Zé' }, { role: 'guide' }, { role: 'click', customName: 'Baixo do Zé' }])
    const importado = migrateManifestSong(entry)
    expect(importado.channels).toEqual(entry.channels)
    expect(migrateManifestSong(importado)).toEqual(importado)
    expect(migrateSavedSong(importado)).toEqual(importado)
  })
})

// Registro v2 real, como a v1.4.16 grava no IndexedDB (toSavedSong da Parte 1 passado pelo
// structured clone): toda chave presente, inclusive as que ficaram undefined.
const v2: SavedSong = {
  id: 's4', sourceId: 'cloud-1', name: v1.name, coverImage: v1.coverImage, duration: v1.duration,
  channels: [
    { id: 'vb', name: 'BASS_1', volume: 1.1, muted: false, soloed: false, pan: 1, bus: '2', srcId: 'cloud-1', srcIdx: 1, customName: 'Baixo do Zé', role: 'guide' },
    { id: 'va', name: 'CLICK 13', volume: 0.7, muted: false, soloed: false, pan: -1, bus: '1', srcId: 'cloud-1', srcIdx: 0, customName: undefined, role: undefined },
    { id: 'vc', name: 'GTR SOLO_1', volume: 0.5, muted: false, soloed: true, pan: 0.3, bus: '1/2', srcId: 'cloud-1', srcIdx: 2, customName: undefined, role: 'normal' },
  ],
  pitch: -2, originalKey: 'G', bpm: 72, artist: 'Ministério', markers: v1.markers,
  lyrics: 'letra', lyricsSynced: '[00:12.30] linha', chords: 'G D Em', channelOrder: 'manual', schemaVersion: 2,
}

// Grade lida no click (T2): 72,5 tempos por minuto, primeiro 1 em 0,42 s, compasso pelo acento.
const clickGrid: SongGrid = { bpm: 72.5, firstDownbeat: 0.42, signature: '4/4', countEvery: 1, source: 'click', meterSource: 'acento' }
// O IndexedDB grava uma cópia (structured clone), que guarda NaN e chaves undefined.
const noAparelho = <T>(x: T): T => structuredClone(x)

describe('repertório v3: grade e compasso da música', () => {
  it('migrateSavedSong preserva um registro v2 real inteiro e marca v3', () => {
    expect(REPERTOIRE_SCHEMA_VERSION).toBe(3)
    const migrado = migrateSavedSong(noAparelho(v2))
    expect(migrado).toStrictEqual({ ...v2, schemaVersion: 3 })
    expect(migrateSavedSong(migrado)).toStrictEqual(migrado)
    // O primeiro save depois de abrir (grade ainda não lida) grava v3 sem perder nada.
    expect(toSavedSong(migrado)).toEqual({ ...v2, schemaVersion: 3 })
    // A inferência de ordem é só da v1: um v2 sem channelOrder abre como na v1.4.16 (automático).
    const semOrdem = migrateSavedSong({ ...v2, channelOrder: undefined })
    expect(semOrdem.channelOrder).toBeUndefined()
  })

  it('grade com bpm NaN é descartada e o resto fica', () => {
    const esperado: SavedSong = { ...v2, schemaVersion: REPERTOIRE_SCHEMA_VERSION, timeSignature: '6/8' }
    const quebradas: unknown[] = [
      { ...clickGrid, bpm: NaN }, { ...clickGrid, firstDownbeat: NaN }, { ...clickGrid, bpm: 400 },
      { ...clickGrid, signature: '9/8' }, { ...clickGrid, meterSource: 'chute' }, null, 'grade', 42,
    ]
    for (const grid of quebradas) {
      const gravado = { ...esperado, grid } as SavedSong
      expect(migrateSavedSong(noAparelho(gravado))).toStrictEqual(esperado)
      // Na gravação também: grade quebrada nunca chega no aparelho.
      const salvo = toSavedSong(gravado)
      expect(salvo.grid).toBeUndefined()
      expect(salvo).toEqual(esperado)
    }
  })

  it('compasso manual sobrevive a toSavedSong e migrate', () => {
    // Compasso da nuvem 4/4; no EDITAR o usuário escolheu 6/8 contando de 3 em 3.
    const manual = withMeter(clickGrid, '6/8', 3)
    expect(manual.meterSource).toBe('manual')
    const viva = { ...migrateSavedSong(v1), grid: manual, timeSignature: '4/4' as const }
    const salvo = toSavedSong(viva)
    expect(salvo).toMatchObject({ grid: manual, timeSignature: '4/4', schemaVersion: REPERTOIRE_SCHEMA_VERSION })
    const reaberto = migrateSavedSong(noAparelho(salvo))
    expect(reaberto.grid).toStrictEqual(manual)
    expect(reaberto.timeSignature).toBe('4/4')
    expect(migrateSavedSong(reaberto)).toStrictEqual(reaberto)
    // "Ler o click de novo" depois de reabrir: BPM e fase da leitura nova, o compasso manual fica.
    // A leitura nova veio em 4/4 (semínima 73); no 6/8 manual a grade conta colcheias: 146.
    const relido = keepManualMeter({ ...clickGrid, bpm: 73, firstDownbeat: 0.4 }, reaberto.grid ?? null)
    expect(relido).toMatchObject({ bpm: 146, firstDownbeat: 0.4, signature: '6/8', countEvery: 3, meterSource: 'manual' })
  })

  it('registro v1 real da Parte 1 chega em v3 igual', () => {
    // Fixture da T5 da Parte 1 (o mesmo v1 do useAudioEngine.persistence.test.ts).
    const migrado = migrateSavedSong(noAparelho(v1))
    expect(migrado).toStrictEqual({ ...v1, channelOrder: 'auto', schemaVersion: 3 })
    expect(migrateSavedSong(migrado)).toStrictEqual(migrado)
    const ch = v1.channels
    expect(migrateSavedSong({ ...v1, channels: [ch[2], ch[0], ch[1]] }).channelOrder).toBe('manual')
  })

  // Ruling T2/T3: a leitura do click da T3 pode levar campos a mais (subdivision, downbeatSource);
  // o repertório guarda exatamente o que o sanitizeGrid aceita, com ou sem eles.
  it('grade com ou sem os campos da leitura do click fica como o sanitizeGrid devolve', () => {
    for (const grid of [clickGrid, { ...clickGrid, subdivision: 2, downbeatSource: 'assumed' }]) {
      const salvo = toSavedSong({ ...v1, grid: grid as SongGrid })
      expect(salvo.grid).toStrictEqual(sanitizeGrid(grid))
      expect(migrateSavedSong(noAparelho(salvo)).grid).toStrictEqual(sanitizeGrid(grid))
    }
  })

  it('compasso salvo desconhecido sai e o resto fica', () => {
    for (const timeSignature of ['9/8', '', 44, null]) {
      const gravado = { ...v2, schemaVersion: REPERTOIRE_SCHEMA_VERSION, grid: clickGrid, timeSignature } as unknown as SavedSong
      const migrado = migrateSavedSong(noAparelho(gravado))
      expect('timeSignature' in migrado).toBe(false)
      expect(migrado).toStrictEqual({ ...v2, schemaVersion: REPERTOIRE_SCHEMA_VERSION, grid: clickGrid })
      expect(toSavedSong(gravado).timeSignature).toBeUndefined()
    }
  })

  it('ZIP não leva a grade: o manifest sai sem ela e o import descarta a que vier', () => {
    const viva = { ...migrateSavedSong(v1), grid: clickGrid, timeSignature: '3/4' as const }
    expect(Object.keys(toManifestSong(viva)).sort()).toEqual(['channelOrder', 'channels', 'coverImage', 'duration', 'id', 'name'])
    // Manifest mexido à mão ou de outra versão: a grade é lida de novo do click depois do import.
    const importado = migrateManifestSong(noAparelho<SavedSong>({ ...manifestAntigo, grid: clickGrid, timeSignature: '3/4' }))
    expect('grid' in importado).toBe(false)
    expect(importado.timeSignature).toBe('3/4')
    expect(migrateSavedSong(importado)).toStrictEqual(importado)
    const estranho = migrateManifestSong({ ...manifestAntigo, timeSignature: '9/8' } as unknown as SavedSong)
    expect('timeSignature' in estranho).toBe(false)
  })
})

// Ruling T27-campo: o "1" que o click não provou (nem o acento nem as seções) fica marcado na
// música (`downbeatAssumed`), pro COMPASSO ASSUMIDO sobreviver a reabrir mesmo com o compasso
// escolhido no EDITAR (que troca o meterSource da grade pra 'manual'). Ausente = sem aviso.
describe('repertório v3: o 1 assumido da grade de click', () => {
  const manual = withMeter(clickGrid, '3/4', 1)

  it('vai e volta junto da grade de click (toSavedSong e migrateSavedSong)', () => {
    const salvo = toSavedSong({ ...v1, grid: manual, downbeatAssumed: true })
    expect(salvo.downbeatAssumed).toBe(true)
    const reaberto = migrateSavedSong(noAparelho(salvo))
    expect(reaberto.downbeatAssumed).toBe(true)
    expect(reaberto.grid).toStrictEqual(manual)
    expect(migrateSavedSong(reaberto)).toStrictEqual(reaberto)
  })

  it('sem grade de click, ou com valor estranho, sai do registro (sem chave)', () => {
    const semClick = migrateSavedSong(noAparelho({ ...v2, grid: { ...clickGrid, source: 'bpm' }, downbeatAssumed: true } as SavedSong))
    expect('downbeatAssumed' in semClick).toBe(false)
    expect(toSavedSong({ ...v1, downbeatAssumed: true }).downbeatAssumed).toBeUndefined()
    for (const estranho of [false, 'sim', 1, null]) {
      const gravado = { ...v2, grid: clickGrid, downbeatAssumed: estranho } as unknown as SavedSong
      expect('downbeatAssumed' in migrateSavedSong(noAparelho(gravado))).toBe(false)
      expect(toSavedSong(gravado).downbeatAssumed).toBeUndefined()
    }
    // Registro antigo, sem o campo: continua igual (sem aviso).
    expect(migrateSavedSong(noAparelho({ ...v2, grid: clickGrid }))).toStrictEqual({ ...v2, schemaVersion: REPERTOIRE_SCHEMA_VERSION, grid: clickGrid })
  })

  it('o ZIP não leva a grade nem o 1 assumido', () => {
    const importado = migrateManifestSong(noAparelho<SavedSong>({ ...manifestAntigo, grid: clickGrid, downbeatAssumed: true }))
    expect('downbeatAssumed' in importado).toBe(false)
    expect('downbeatAssumed' in toManifestSong({ ...migrateSavedSong(v1), grid: clickGrid, downbeatAssumed: true })).toBe(false)
  })
})

// Parte 3 (faixa D): a música do palco sabe de qual separação veio (a conta do Livre e as
// ferramentas do painel SEPARAÇÃO usam). Vale só na conta: não vai pro .zip (P11).
describe('ligação com a separação', () => {
  const SONG = { id: 's9', name: 'Separada', duration: 120, channels: [], pitch: 0, originalKey: null } as unknown as SongLike

  it('a ligação com a separação vai e volta no repertório salvo e não vai pro .zip', () => {
    const saved = toSavedSong({ ...SONG, separation: { id: 'sep_1', createdAt: 1_700_000_000_000 } })
    expect(saved.separation).toEqual({ id: 'sep_1', createdAt: 1_700_000_000_000 })
    expect(migrateSavedSong(saved).separation).toEqual({ id: 'sep_1', createdAt: 1_700_000_000_000 })
    expect(toManifestSong({ ...SONG, separation: { id: 'sep_1', createdAt: 1 } })).not.toHaveProperty('separation')
    // Um manifest mexido à mão não traz a ligação pro aparelho.
    const fromZip = migrateManifestSong({ ...(saved as SavedSong), separation: { id: 'sep_1', createdAt: 1 } })
    expect(fromZip).not.toHaveProperty('separation')
    // Música comum: nenhuma chave nova.
    expect(toSavedSong(SONG).separation).toBeUndefined()
  })

  it('sanitizeSeparationLink descarta id vazio e data quebrada', () => {
    expect(sanitizeSeparationLink({ id: '', createdAt: 1 })).toBeUndefined()
    expect(sanitizeSeparationLink({ id: 'a', createdAt: NaN })).toBeUndefined()
    expect(sanitizeSeparationLink({ id: 'a', createdAt: '5' })).toBeUndefined()
    expect(sanitizeSeparationLink(null)).toBeUndefined()
    expect(sanitizeSeparationLink('sep')).toBeUndefined()
    expect(sanitizeSeparationLink({ id: 'a', createdAt: 5, extra: true })).toEqual({ id: 'a', createdAt: 5 })
  })

  it('registro salvo com a ligação estragada abre sem ela', () => {
    const bad = { ...toSavedSong(SONG), separation: { id: 7, createdAt: 'x' } } as unknown as SavedSong
    expect(migrateSavedSong(bad)).not.toHaveProperty('separation')
  })
})

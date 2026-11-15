import { describe, expect, it } from 'vitest'
import {
  FAMILY_COLOR, arrangeChannels, buildChannelLabels, channelFamily, recognizeChannel,
  resolveChannelRole, roleFromName, sortChannelsByDefault, type ChannelIdentity,
} from './channelNames'

const mk = (names: string[]): ChannelIdentity[] => names.map((name, i) => ({ id: `c${i}`, name }))
const labels = (names: string[]) => buildChannelLabels(mk(names)).map((l) => l.label)

describe('reconhecimento (spec 5c)', () => {
  it.each([
    ['CLICK 13', 'Click', 'click'], ['Click_IA_120bpm', 'Click', 'click'], ['Metrônomo', 'Click', 'click'],
    ['Metronomo Loop', 'Click', 'click'], ['CLK', 'Click', 'click'], ['MTR', 'Click', 'click'],
    ['TEMPO', 'Click', 'click'], ['BEAT', 'Click', 'click'],
    ['Voz Guia', 'Guia', 'guia'], ['GUIDE VOX', 'Guia', 'guia'], ['CUE', 'Guia', 'guia'],
    ['DRUMS_1', 'Bateria', 'bateria'], ['BAT', 'Bateria', 'bateria'], ['KIT', 'Bateria', 'bateria'],
    ['KICK', 'Bumbo', 'bateria'], ['SNARE', 'Caixa', 'bateria'], ['HH', 'Chimbal', 'bateria'],
    ['PERC', 'Percussão', 'percussao'], ['BASS_1', 'Baixo', 'baixo'], ['BX', 'Baixo', 'baixo'],
    ['baixo', 'Baixo', 'baixo'], ['SYNTH BASS', 'Synth Bass', 'synthBass'], ['SUB', 'Synth Bass', 'synthBass'],
    ['AG BASE_1', 'Violão Base', 'violao'], ['AG DEDIL', 'Violão Dedilhado', 'violao'],
    ['ACOUSTIC GTR', 'Violão', 'violao'], ['VL', 'Violão', 'violao'],
    ['GTR SOLO', 'Guitarra Solo', 'guitarra'], ['GTR AMB', 'Guitarra Ambiente', 'guitarra'],
    ['EG LEAD', 'Guitarra Solo', 'guitarra'], ['GUIT', 'Guitarra', 'guitarra'],
    ['KEYS', 'Teclado', 'teclado'], ['LEAD SYNTH', 'Teclado Solo', 'teclado'], ['RHODES', 'Teclado', 'teclado'],
    ['PIANO DELAY', 'Piano', 'piano'], ['PNO', 'Piano', 'piano'], ['Piano/TeCL', 'Piano', 'piano'],
    ['PAD L', 'Pad L', 'pad'], ['SYNTH PAD', 'Pad', 'pad'], ['AMB REVERSE', 'Ambiência Reverso', 'ambiencia'],
    ['LEAD VOX', 'Vocal', 'vocal'], ['Vocais', 'Vocal', 'vocal'], ['VOZ', 'Vocal', 'vocal'],
    ['BV', 'Backing', 'backing'], ['BACKING VOCAL', 'Backing', 'backing'], ['CORO', 'Backing', 'backing'],
    ['CHOIR', 'Backing', 'backing'], ['drums copy.wav', 'Bateria', 'bateria'],
    ['MASTER_1', 'Master', 'desconhecido'], ['stage', 'Stage', 'desconhecido'], ['legato', 'Legato', 'desconhecido'],
    ['Outros/Fx', 'Outros/Fx', 'desconhecido'], ['Track 5', 'Track 5', 'desconhecido'],
    ['🎸 GTR', 'Guitarra', 'guitarra'], ['01', '01', 'desconhecido'], ['', 'Canal', 'desconhecido'],
    ['   ', 'Canal', 'desconhecido'],
  ])('%s vira %s (%s)', (raw, label, family) => {
    expect(recognizeChannel(raw)).toEqual({ label, family })
  })
})

describe('rótulos da lista', () => {
  it('lista real do dono', () => {
    expect(labels(['CLICK 13', 'BASS_1', 'DRUMS_1', 'AG BASE_1', 'AG DEDIL_1', 'AMB REVERSE_1', 'GTR AMB_1',
      'GTR SOLO_1', 'GTR1_1', 'KEY 1_1', 'KEY 2_1', 'MASTER_1', 'PIANO DELAY_1'])).toEqual(['Click', 'Baixo',
      'Bateria', 'Violão Base', 'Violão Dedilhado', 'Ambiência Reverso', 'Guitarra Ambiente', 'Guitarra Solo',
      'Guitarra', 'Teclado 1', 'Teclado 2', 'Master', 'Piano'])
  })
  it('número segue o nome original, não a posição', () => {
    expect(labels(['KEY 2_1', 'KEY 1_1'])).toEqual(['Teclado 2', 'Teclado 1'])
  })
  it('numeração estável com nomes idênticos (srcIdx desempata, reordenar não troca)', () => {
    const a = { id: 'a', name: 'GTR_1', srcIdx: 5 }
    const b = { id: 'b', name: 'GTR_1', srcIdx: 2 }
    const byId = (list: ChannelIdentity[]) => Object.fromEntries(buildChannelLabels(list).map((l) => [l.id, l.label]))
    expect(byId([a, b])).toEqual({ a: 'Guitarra 2', b: 'Guitarra 1' })
    expect(byId([b, a])).toEqual({ a: 'Guitarra 2', b: 'Guitarra 1' })
  })
  it('nome do usuário vence, não entra na numeração e guarda o automático', () => {
    const [x, y] = buildChannelLabels([{ id: 'x', name: 'GTR_1', customName: 'Solo do Zé' }, { id: 'y', name: 'GTR_2' }])
    expect([x.label, x.isCustom, x.autoLabel, y.label]).toEqual(['Solo do Zé', true, 'Guitarra', 'Guitarra'])
  })
  it('cor pela família, inclusive pelo nome do usuário', () => {
    expect(buildChannelLabels([{ id: 'v', name: 'Track 7', customName: 'Violão do Zé' }])[0].color).toBe(FAMILY_COLOR.violao)
    expect(FAMILY_COLOR).toEqual({ click: '#FF6B35', guia: '#f59e0b', bateria: '#ef4444', percussao: '#f97316',
      baixo: '#22c55e', synthBass: '#16a34a', violao: '#ec4899', guitarra: '#f43f5e', teclado: '#8b5cf6',
      piano: '#a855f7', pad: '#6366f1', ambiencia: '#818cf8', vocal: '#06b6d4', backing: '#0ea5e9', desconhecido: '#9d9da8' })
  })
})

describe('papel', () => {
  it.each([['CLICK', 'click'], ['Metrônomo', 'click'], ['BEAT', 'click'], ['GUIDE', 'guide'], ['CUE', 'guide'],
    ['Voz Guia', 'guide'], ['Vocal', 'normal'], ['stage', 'normal'], ['guitarra', 'normal']])('%s = %s', (n, r) => {
    expect(roleFromName(n)).toBe(r)
  })
  it('manual vence; renomear não tira o papel do original; nome do usuário conta se o original for normal', () => {
    expect(resolveChannelRole({ id: '1', name: 'CLICK', role: 'normal' })).toBe('normal')
    expect(resolveChannelRole({ id: '2', name: 'Track 7', role: 'click' })).toBe('click')
    expect(resolveChannelRole({ id: '3', name: 'CLICK', customName: 'Pulso' })).toBe('click')
    expect(resolveChannelRole({ id: '4', name: 'Track 7', customName: 'Click' })).toBe('click')
  })
  it('papel Normal manual tira o canal da família click/guia', () => {
    expect(channelFamily({ id: '1', name: 'CUE VOX', role: 'normal' })).toBe('vocal')
    expect(buildChannelLabels([{ id: '2', name: 'CLICK 13', role: 'normal' }])[0]).toMatchObject({ label: 'Click 13', family: 'desconhecido' })
  })
})

describe('ordem padrão', () => {
  it('Click, Guia, Bateria... não reconhecido no fim; mesma família mantém a ordem original', () => {
    const input = ['Vocal', 'Track X', 'GTR 2', 'Click', 'Pad', 'Bass', 'GTR 1', 'Guia', 'Backing', 'Piano', 'KEYS', 'AG', 'SUB', 'PERC', 'DRUMS', 'AMB']
    expect(sortChannelsByDefault(mk(input)).map((c) => c.name)).toEqual(['Click', 'Guia', 'DRUMS', 'PERC', 'Bass',
      'SUB', 'AG', 'GTR 2', 'GTR 1', 'KEYS', 'Piano', 'Pad', 'AMB', 'Vocal', 'Backing', 'Track X'])
  })
  it('manual não reordena; automático é idempotente e não muta a entrada', () => {
    const list = mk(['Vocal', 'Click'])
    expect(arrangeChannels(list, 'manual').map((c) => c.name)).toEqual(['Vocal', 'Click'])
    const once = arrangeChannels(list, 'auto')
    expect(arrangeChannels(once, undefined)).toEqual(once)
    expect(list.map((c) => c.name)).toEqual(['Vocal', 'Click'])
  })
})

// Casos que vêm das decisões do coordenador (progress.md, Ruling 6 e item 10 do preflight.md).
describe('limpeza do nome do arquivo', () => {
  it.each([
    ['Stage.WAV', 'Stage'], ['stage copy.mp3', 'Stage'], ['Stage (Copy 2).aif', 'Stage'], ['stage (1).flac', 'Stage'],
    ['Stage cópia 3.m4a', 'Stage'], ['Stage - Copy.ogg', 'Stage'], ['MASTER_12.wav', 'Master'], ['Stage_1_2', 'Stage 1'],
    ['Sample-7.caf', 'Sample'], ['loop  de   abertura', 'Loop De Abertura'],
  ])('%s vira %s', (raw, label) => {
    expect(recognizeChannel(raw)).toEqual({ label, family: 'desconhecido' })
  })
  it('a limpeza vale antes do reconhecimento', () => {
    expect(recognizeChannel('Bass (1).wav')).toEqual({ label: 'Baixo', family: 'baixo' })
    expect(recognizeChannel('GTR cópia 2.mp3')).toEqual({ label: 'Guitarra', family: 'guitarra' })
  })
})

describe('nome não reconhecido longo (Ruling 6)', () => {
  it('corta em palavra inteira e fica com no máximo 24 caracteres', () => {
    const label = recognizeChannel('SEQUENCIA ESPECIAL ABERTURA DO CULTO').label
    expect(label).toBe('Sequencia Especial')
    expect(label.length).toBeLessThanOrEqual(24)
    expect(recognizeChannel('sequencia_especial_abertura_do_culto_domingo').label).toBe('Sequencia Especial')
  })
  it('nome com exatamente 24 caracteres fica inteiro', () => {
    expect(recognizeChannel('Sequencia_Especial_Do_Ze').label).toBe('Sequencia Especial Do Ze')
  })
  it('palavra única maior que 24 fica inteira: nunca corta no meio nem fica vazio', () => {
    expect(recognizeChannel('BackgroundAtmosphereLayer01').label).toBe('BackgroundAtmosphereLayer01')
  })
  it('o limite também vale no rótulo da lista e com papel Normal manual', () => {
    const [l] = buildChannelLabels([{ id: '1', name: 'CLICK SEQUENCIA ESPECIAL ABERTURA', role: 'normal' }])
    expect(l).toMatchObject({ label: 'Click Sequencia Especial', family: 'desconhecido' })
  })
})

describe('rótulo automático e ordem (item 10 do preflight)', () => {
  it('autoLabel de canal numerado leva o número', () => {
    expect(buildChannelLabels(mk(['KEY 1_1', 'KEY 2_1'])).map((l) => [l.label, l.autoLabel, l.isCustom])).toEqual([
      ['Teclado 1', 'Teclado 1', false], ['Teclado 2', 'Teclado 2', false]])
  })
  it('numeração não diferencia caixa', () => {
    expect(labels(['TrackX', 'trackx'])).toEqual(['TrackX 1', 'Trackx 2'])
  })
  it('ordem usa a família resolvida: papel manual e nome do usuário contam', () => {
    const list: ChannelIdentity[] = [
      { id: 'a', name: 'CLICK', role: 'normal' }, { id: 'b', name: 'Track 7', role: 'click' },
      { id: 'c', name: 'Bass' }, { id: 'd', name: 'Track 9', customName: 'Violão do Zé' },
    ]
    expect(sortChannelsByDefault(list).map((c) => c.id)).toEqual(['b', 'c', 'd', 'a'])
  })
  it('peças da bateria: a peça vence o genérico', () => {
    expect(recognizeChannel('KICK DRUM')).toEqual({ label: 'Bumbo', family: 'bateria' })
    expect(recognizeChannel('DRUMS OH L')).toEqual({ label: 'Overhead L', family: 'bateria' })
    expect(recognizeChannel('HI HAT')).toEqual({ label: 'Chimbal', family: 'bateria' })
  })
  it('complemento: no máximo 2, na ordem, sem repetir', () => {
    expect(recognizeChannel('GTR L LEFT DBL SOLO')).toEqual({ label: 'Guitarra L Dobra', family: 'guitarra' })
    expect(recognizeChannel('CLICK SOLO L')).toEqual({ label: 'Click', family: 'click' })
  })
})

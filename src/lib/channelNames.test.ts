import { describe, expect, it } from 'vitest'
import {
  FAMILY_COLOR, arrangeChannels, buildChannelLabels, channelFamily, isDrumPieceToken, nameTokens, recognizeChannel,
  resolveChannelRole, roleFromName, sortChannelsByDefault, type ChannelFamily, type ChannelIdentity,
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
    ['CHOIR', 'Backing', 'backing'], ['Coral', 'Backing', 'backing'], ['CORAIS', 'Backing', 'backing'],
    ['drums copy.wav', 'Bateria', 'bateria'],
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
  it('nome do Mac em NFD e cópia encadeada também saem', () => {
    expect(recognizeChannel('Stage cópia.wav')).toEqual({ label: 'Stage', family: 'desconhecido' })
    expect(recognizeChannel('stage copy (1).wav')).toEqual({ label: 'Stage', family: 'desconhecido' })
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
  it('trecho único maior que 24, sem nenhuma quebra, fica inteiro: nunca corta no meio nem fica vazio', () => {
    expect(recognizeChannel('BACKGROUNDATMOSPHERELAYER01').label).toBe('Backgroundatmospherelayer01')
  })
  it('hífen, ponto e camelCase também quebram palavra antes do limite (correção da revisão)', () => {
    const cases = [
      ['Sequencia-Especial-Abertura-Do-Culto.wav', 'Sequencia Especial'],
      ['intro-especial-do-culto-de-domingo', 'Intro Especial Do Culto'],
      ['Sequencia.Especial.Abertura.Do.Culto', 'Sequencia Especial'],
      ['SequenciaEspecialAberturaDoCulto', 'Sequencia Especial'],
      ['BackgroundAtmosphereLayer01', 'Background Atmosphere'],
    ]
    for (const [raw, label] of cases) {
      expect(recognizeChannel(raw)).toEqual({ label, family: 'desconhecido' })
      expect(label.length).toBeLessThanOrEqual(24)
    }
  })
  it('sigla em caixa alta não é camelCase; nome curto com separador só troca por espaço', () => {
    expect(recognizeChannel('STAGEMIX').label).toBe('Stagemix')
    expect(recognizeChannel('Intro-Loop').label).toBe('Intro Loop')
    expect(recognizeChannel('stage.mix').label).toBe('Stage Mix')
    expect(recognizeChannel('Outros/Fx').label).toBe('Outros/Fx')
  })
  it('separadores e camelCase não mudam o reconhecimento das famílias', () => {
    expect(recognizeChannel('GTR-SOLO')).toEqual({ label: 'Guitarra Solo', family: 'guitarra' })
    expect(recognizeChannel('Piano/TeCL')).toEqual({ label: 'Piano', family: 'piano' })
    expect(recognizeChannel('GTR1_1')).toEqual({ label: 'Guitarra', family: 'guitarra' })
    expect(recognizeChannel('Click_IA_120bpm')).toEqual({ label: 'Click', family: 'click' })
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
    expect(labels(['DJ', 'dj'])).toEqual(['DJ 1', 'Dj 2'])
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

// Rodada de correção 2 (Ruling do coordenador): o reconhecimento decide roteamento, tom e Solo.
describe('BEAT e TEMPO são palavras fracas de Click', () => {
  it('Ambient Beat Pad é Pad, papel Normal', () => {
    expect(recognizeChannel('Ambient Beat Pad')).toEqual({ label: 'Pad Ambiente', family: 'pad' })
    expect(roleFromName('Ambient Beat Pad')).toBe('normal')
    const ch = { id: '1', name: 'Ambient Beat Pad' }
    expect([resolveChannelRole(ch), channelFamily(ch)]).toEqual(['normal', 'pad'])
    expect(buildChannelLabels([ch])[0]).toMatchObject({ label: 'Pad Ambiente', family: 'pad', role: 'normal' })
  })
  it('com outra família no nome, a família vem do resto', () => {
    expect(recognizeChannel('Beat Amb')).toEqual({ label: 'Ambiência', family: 'ambiencia' })
    expect(recognizeChannel('BEAT DRUMS')).toEqual({ label: 'Bateria', family: 'bateria' })
    expect(recognizeChannel('Tempo Guia')).toEqual({ label: 'Guia', family: 'guia' })
    expect([roleFromName('Beat Amb'), roleFromName('BEAT DRUMS'), roleFromName('Tempo Guia')]).toEqual(['normal', 'normal', 'guide'])
  })
  it('sozinhas (ou sem outra família) continuam Click', () => {
    expect(recognizeChannel('Tempo')).toEqual({ label: 'Click', family: 'click' })
    expect(recognizeChannel('Beat')).toEqual({ label: 'Click', family: 'click' })
    expect(recognizeChannel('Tempo 120')).toEqual({ label: 'Click', family: 'click' })
    expect([roleFromName('Tempo'), roleFromName('Beat')]).toEqual(['click', 'click'])
  })
  it('CLICK, CLK, METRO, METRONOMO e MTR continuam fortes mesmo com outras palavras', () => {
    expect(['CLICK PAD', 'CLK BASS', 'METRO AMB', 'Metrônomo Drums', 'MTR GTR'].map((n) => recognizeChannel(n).family))
      .toEqual(['click', 'click', 'click', 'click', 'click'])
  })
  it('sem papel de Click, o nome com palavra fraca entra na família pelo resto quando o papel é Normal manual', () => {
    expect(channelFamily({ id: '1', name: 'Tempo Pad', role: 'normal' })).toBe('pad')
  })
})

// Re-revisão da v1.4.16: grafias de voz que a regra antiga de formantes pegava por
// pedaço do nome (v1.4.15) e a regra central não reconhecia. Viram Vocal ou Backing
// (e ganham formantes), mas o papel continua Normal: não vão pro ouvido nem saem do tom.
describe('grafias de voz grudadas e plurais', () => {
  it.each([
    ['Backvocal', 'Backing', 'backing'], ['BACKVOCAL', 'Backing', 'backing'], ['backvocals', 'Backing', 'backing'],
    ['BACKVOX', 'Backing', 'backing'], ['BVox', 'Backing', 'backing'], ['BVOX', 'Backing', 'backing'], ['bvox 2', 'Backing', 'backing'],
    ['LEADVOCAL', 'Vocal', 'vocal'], ['Leadvocal', 'Vocal', 'vocal'], ['LEADVOX', 'Vocal', 'vocal'],
    ['Coros', 'Backing', 'backing'], ['COROS', 'Backing', 'backing'], ['Choirs', 'Backing', 'backing'],
    ['Vocalista', 'Vocal', 'vocal'], ['VOCALISTA', 'Vocal', 'vocal'],
  ])('%s vira %s (%s), papel Normal', (raw, label, family) => {
    const ch = { id: '1', name: raw }
    expect(recognizeChannel(raw)).toMatchObject({ family })
    expect(channelFamily(ch)).toBe(family)
    expect(buildChannelLabels([ch])[0]).toMatchObject({ family, role: 'normal' })
    expect(buildChannelLabels([ch])[0].label).toMatch(new RegExp(`^${label}`))
    expect(roleFromName(raw)).toBe('normal')
    expect(resolveChannelRole(ch)).toBe('normal')
  })
})

describe('camelCase no reconhecimento', () => {
  it.each([
    ['ClickTrack', 'Click', 'click', 'click'], ['VozGuia', 'Guia', 'guia', 'guide'], ['LeadVox', 'Vocal', 'vocal', 'normal'],
    ['AcousticGtr', 'Violão', 'violao', 'normal'], ['GtrSolo', 'Guitarra Solo', 'guitarra', 'normal'],
  ])('%s vira %s (%s, papel %s)', (raw, label, family, role) => {
    expect(recognizeChannel(raw)).toEqual({ label, family })
    expect(roleFromName(raw)).toBe(role)
  })
  it('siglas em caixa alta não quebram', () => {
    expect(recognizeChannel('GTR1_1')).toEqual({ label: 'Guitarra', family: 'guitarra' })
    expect(recognizeChannel('GTR-SOLO')).toEqual({ label: 'Guitarra Solo', family: 'guitarra' })
    expect(recognizeChannel('Click_IA_120bpm')).toEqual({ label: 'Click', family: 'click' })
    expect(recognizeChannel('BVS')).toEqual({ label: 'Backing', family: 'backing' })
    expect(recognizeChannel('SUBBASS')).toEqual({ label: 'Synth Bass', family: 'synthBass' })
  })
})

describe('plurais de Click e Guia', () => {
  it.each([['GUIAS', 'Guia', 'guia', 'guide'], ['CLICKS', 'Click', 'click', 'click'], ['CUES', 'Guia', 'guia', 'guide'],
    ['Guias', 'Guia', 'guia', 'guide'], ['Clicks 2', 'Click', 'click', 'click']])('%s vira %s (%s)', (raw, label, family, role) => {
    expect(recognizeChannel(raw)).toEqual({ label, family })
    expect(roleFromName(raw)).toBe(role)
  })
})

// Acréscimo da rodada de correção 2 (revisão da T7).
describe('bateria: compostos, plurais e camelCase', () => {
  it('Drum Beat é Bateria, papel Normal', () => {
    expect(recognizeChannel('Drum Beat')).toEqual({ label: 'Bateria', family: 'bateria' })
    expect(roleFromName('Drum Beat')).toBe('normal')
  })
  it.each([
    ['DrumLoop', 'Bateria Loop'], ['Drumset', 'Bateria'], ['DRUMSET', 'Bateria'], ['DRUMKIT', 'Bateria'],
    ['Baterias', 'Bateria'], ['BASS DRUM', 'Bumbo'], ['BASSDRUM', 'Bumbo'], ['Bass Drum', 'Bumbo'], ['BassDrum', 'Bumbo'],
  ])('%s vira %s (bateria)', (raw, label) => {
    expect(recognizeChannel(raw)).toEqual({ label, family: 'bateria' })
    expect(roleFromName(raw)).toBe('normal')
  })
  it('BASS sozinho continua Baixo; o bumbo não muda o baixo do lado', () => {
    expect(recognizeChannel('BASS_1')).toEqual({ label: 'Baixo', family: 'baixo' })
    expect(recognizeChannel('BASS DI')).toEqual({ label: 'Baixo', family: 'baixo' })
    expect(sortChannelsByDefault(mk(['BASS', 'BASS DRUM'])).map((c) => c.name)).toEqual(['BASS DRUM', 'BASS'])
  })
})

// Rodada de correção 3 (Ruling do coordenador).
describe('BEAT e TEMPO só são Click com o resto em número ou andamento', () => {
  it.each([['Beat'], ['Tempo'], ['Beat 01'], ['Tempo_120bpm']])('%s é Click', (raw) => {
    expect(recognizeChannel(raw)).toEqual({ label: 'Click', family: 'click' })
    expect(roleFromName(raw)).toBe('click')
  })
  it.each([
    ['Beat Loop', 'Beat Loop', 'desconhecido'], ['Tempo FX', 'Tempo FX', 'desconhecido'],
    ['Drum Beat', 'Bateria', 'bateria'], ['Ambient Beat Pad', 'Pad Ambiente', 'pad'],
  ])('%s não é Click: vira %s (%s), papel Normal', (raw, label, family) => {
    expect(recognizeChannel(raw)).toEqual({ label, family })
    expect(roleFromName(raw)).toBe('normal')
    expect(buildChannelLabels([{ id: '1', name: raw }])[0]).toMatchObject({ label, family, role: 'normal' })
  })
})

describe('overhead, bumbo no plural, CLICKTRACK e TeCL', () => {
  it.each([['OverHead'], ['OverHeads'], ['OVERHEAD'], ['Overheads']])('%s é a peça Overhead da bateria', (raw) => {
    expect(recognizeChannel(raw)).toEqual({ label: 'Overhead', family: 'bateria' })
  })
  it('overhead em camelCase vence o genérico da bateria', () => {
    expect(recognizeChannel('Drums OverHead L')).toEqual({ label: 'Overhead L', family: 'bateria' })
  })
  it.each([['BASS DRUMS'], ['BassDrums'], ['Bass Drums']])('%s é Bumbo da bateria', (raw) => {
    expect(recognizeChannel(raw)).toEqual({ label: 'Bumbo', family: 'bateria' })
  })
  it('BASS sozinho continua Baixo', () => {
    expect(recognizeChannel('BASS')).toEqual({ label: 'Baixo', family: 'baixo' })
    expect(recognizeChannel('BASS GTR')).toEqual({ label: 'Baixo', family: 'baixo' })
  })
  it.each([['CLICKTRACK'], ['Clicktrack'], ['ClickTrack']])('%s é Click', (raw) => {
    expect(recognizeChannel(raw)).toEqual({ label: 'Click', family: 'click' })
    expect(roleFromName(raw)).toBe('click')
  })
  it('TeCL sozinho volta a Teclado; Piano/TeCL continua Piano', () => {
    expect(recognizeChannel('TeCL')).toEqual({ label: 'Teclado', family: 'teclado' })
    expect(recognizeChannel('Piano/TeCL')).toEqual({ label: 'Piano', family: 'piano' })
  })
})

// Revisão final (C1): o detector antigo (includes click/metronomo/guia/guide) pegava
// estes nomes. O novo nunca pode ser mais estreito, senão a guia ou o click vão pra PA.
describe('compatibilidade com o detector antigo: o antigo pegava, o novo tem que pegar', () => {
  it.each([
    ['vozguia', 'guide', 'guia', 'Guia'], ['VOZGUIA', 'guide', 'guia', 'Guia'],
    ['voiceguide', 'guide', 'guia', 'Guia'], ['guidevocal', 'guide', 'guia', 'Guia'],
    ['GUIDEVOX', 'guide', 'guia', 'Guia'], ['clickguia', 'click', 'click', 'Click'],
    ['clicktrk', 'click', 'click', 'Click'], ['LGuia', 'guide', 'guia', 'Guia'],
    ['Metrônomo', 'click', 'click', 'Click'], ['vozguia bass', 'guide', 'guia', 'Guia'],
  ])('%s: papel %s, família %s, rótulo %s', (name, role, family, label) => {
    const ch = { id: '1', name }
    expect(roleFromName(name)).toBe(role)
    expect([resolveChannelRole(ch), channelFamily(ch)]).toEqual([role, family])
    expect(buildChannelLabels([ch])[0]).toMatchObject({ label, role, family, color: FAMILY_COLOR[family as 'click' | 'guia'] })
  })
  it('duplicados entram na mesma numeração das outras famílias', () => {
    expect(labels(['VOZGUIA', 'Voz Guia', 'clicktrk', 'CLICK'])).toEqual(['Guia 2', 'Guia 1', 'Click 2', 'Click 1'])
  })
  // Ajuste do coordenador: quando a palavra já reconhece Click ou Guia, é ela que decide
  // entre os dois; o teste antigo só promove a Click/Guia o que ficaria com outro papel.
  it.each([
    ['MTR Guia', 'click', 'Click'], ['CLK Guide', 'click', 'Click'], ['Metro Guia', 'click', 'Click'],
    ['Clique Guia', 'click', 'Click'], ['CUE clicktrk', 'guide', 'Guia'],
  ])('%s: a palavra decide entre Click e Guia (papel %s)', (name, role, label) => {
    expect(roleFromName(name)).toBe(role)
    expect(buildChannelLabels([{ id: '1', name }])[0]).toMatchObject({ label, role })
  })
  // Junção (R1): o teste antigo existe pras músicas já salvas, então só vale no nome
  // do ARQUIVO. O nome digitado pelo usuário só conta por palavra inteira.
  it.each([
    ['GTR', 'Violão Aguiar', 'normal', 'violao'],
    ['Piano', 'Teclado guiado', 'normal', 'teclado'],
  ])('%s renomeado "%s": letras de guia/click dentro de outra palavra não mudam o papel', (name, customName, role, family) => {
    const ch = { id: '1', name, customName }
    expect([resolveChannelRole(ch), channelFamily(ch)]).toEqual([role, family])
  })
  it('vozguia renomeado "Click": a palavra do nome do usuário decide antes do teste antigo', () => {
    expect(resolveChannelRole({ id: '1', name: 'vozguia', customName: 'Click' })).toBe('click')
  })
  it('vozguia renomeado sem palavra de papel continua Guia pelo teste antigo no nome do arquivo', () => {
    const ch = { id: '1', name: 'vozguia', customName: 'Voz do Zé' }
    expect([resolveChannelRole(ch), channelFamily(ch)]).toEqual(['guide', 'guia'])
  })
  it('papel manual vence: vozguia com papel Normal continua Normal', () => {
    const ch = { id: '1', name: 'vozguia', role: 'normal' as const }
    expect([resolveChannelRole(ch), channelFamily(ch)]).toEqual(['normal', 'desconhecido'])
    expect(buildChannelLabels([ch])[0]).toMatchObject({ label: 'Vozguia', role: 'normal' })
  })
})

// Junção (R6): recognizeChannel sem ignoreRoleFamilies diz o mesmo que o papel e a
// família do canal, então quem chamar direto não cai na armadilha de "vozguia bass" = Baixo.
describe('recognizeChannel segue o teste antigo de Click e Guia', () => {
  it.each([
    ['vozguia bass', 'guia', 'Guia'], ['vozguia', 'guia', 'Guia'], ['clicktrk', 'click', 'Click'],
    ['GUIDEVOX', 'guia', 'Guia'], ['MTR Guia', 'click', 'Click'], ['CUE clicktrk', 'guia', 'Guia'],
  ])('%s: família %s, rótulo %s, igual ao channelFamily', (name, family, label) => {
    expect(recognizeChannel(name)).toEqual({ family, label })
    expect(recognizeChannel(name).family).toBe(channelFamily({ id: '1', name }))
  })
  it('com ignoreRoleFamilies continua só o instrumento (rótulo de canal Normal)', () => {
    expect(recognizeChannel('vozguia bass', { ignoreRoleFamilies: true })).toEqual({ family: 'baixo', label: 'Baixo' })
    expect(recognizeChannel('vozguia', { ignoreRoleFamilies: true }).family).toBe('desconhecido')
  })
})

// Revisão final (N1): canal sem nome (ZIP, repertório ou stem com jsonb estragado) não pode derrubar a tela.
describe('nome ausente', () => {
  it.each([[undefined], [null]])('name %s: rótulo e família não lançam e o rótulo cai em "Canal"', (missing) => {
    const ch = { id: 'x', name: missing as unknown as string }
    expect(() => channelFamily(ch)).not.toThrow()
    expect(channelFamily(ch)).toBe('desconhecido')
    expect(() => buildChannelLabels([ch])).not.toThrow()
    expect(buildChannelLabels([ch, { id: 'y', name: 'GTR' }]).map((l) => l.label)).toEqual(['Canal', 'Guitarra'])
    expect(resolveChannelRole(ch)).toBe('normal')
  })
})

// Parte 2, M5 (achado 19 da varredura): nomes de bateria em português e espanhol,
// SHAKER e LOOP como Percussão, BAJO como Baixo. Muda rótulo, cor e ordem.
describe('peças e palavras novas (M5)', () => {
  it.each([
    ['BUMBO', 'Bumbo', 'bateria'], ['CAIXA', 'Caixa', 'bateria'], ['CHIMBAL', 'Chimbal', 'bateria'],
    ['Bumbo_1.wav', 'Bumbo', 'bateria'], ['caixa', 'Caixa', 'bateria'], ['Chimbal 2', 'Chimbal', 'bateria'],
    ['BATERA', 'Bateria', 'bateria'], ['Batera', 'Bateria', 'bateria'], ['Batería', 'Bateria', 'bateria'],
    ['SHAKER', 'Shaker', 'percussao'], ['Shaker Loop', 'Shaker Loop', 'percussao'],
    ['LOOP', 'Loop', 'percussao'], ['Loops', 'Loop', 'percussao'], ['Loop 2', 'Loop', 'percussao'],
    ['LOOP_120bpm', 'Loop', 'percussao'],
    ['BAJO', 'Baixo', 'baixo'], ['Bajo', 'Baixo', 'baixo'],
  ])('%s vira %s (%s), com a cor da família e papel Normal', (raw, label, family) => {
    expect(recognizeChannel(raw)).toEqual({ label, family })
    expect(roleFromName(raw)).toBe('normal')
    expect(buildChannelLabels([{ id: '1', name: raw }])[0]).toMatchObject({
      label, family, role: 'normal', color: FAMILY_COLOR[family as ChannelFamily],
    })
  })
  it('LOOP só é Percussão quando é a única palavra reconhecível; com outra família, fica de complemento', () => {
    expect(recognizeChannel('Drum Loop')).toEqual({ label: 'Bateria Loop', family: 'bateria' })
    expect(recognizeChannel('PERC LOOP')).toEqual({ label: 'Percussão Loop', family: 'percussao' })
    expect(recognizeChannel('Pad Loop')).toEqual({ label: 'Pad Loop', family: 'pad' })
    expect(recognizeChannel('Metronomo Loop')).toEqual({ label: 'Click', family: 'click' })
  })
  it('LOOP com palavra desconhecida continua não reconhecido', () => {
    expect(recognizeChannel('Beat Loop')).toEqual({ label: 'Beat Loop', family: 'desconhecido' })
    expect(recognizeChannel('Intro-Loop')).toEqual({ label: 'Intro Loop', family: 'desconhecido' })
    expect(recognizeChannel('loop de abertura')).toEqual({ label: 'Loop De Abertura', family: 'desconhecido' })
  })
  it('ordem padrão: peças na Bateria, Shaker e Loop na Percussão, Bajo no Baixo', () => {
    const input = ['LOOP', 'BAJO', 'Vocal', 'CAIXA', 'Click', 'SHAKER', 'BUMBO', 'Guía', 'CHIMBAL', 'Batera']
    expect(sortChannelsByDefault(mk(input)).map((c) => c.name)).toEqual(['Click', 'Guía', 'CAIXA', 'BUMBO', 'CHIMBAL',
      'Batera', 'LOOP', 'SHAKER', 'BAJO', 'Vocal'])
  })
  it('dois loops entram na numeração', () => {
    expect(labels(['Loop 2', 'LOOP'])).toEqual(['Loop 2', 'Loop 1'])
  })
})

describe('nameTokens', () => {
  it.each([
    ['Batería_Loop 2.wav', ['bateria', 'loop', '2']],
    ['DrumFills', ['drum', 'fills']],
    ['KICK_1.wav', ['kick']],
    ['Bass Drum', ['bassdrum']],
    ['GTR1_1', ['gtr', '1']],
    ['Guía copy.mp3', ['guia']],
    ['', []],
  ])('%s vira %j', (raw, tokens) => {
    expect(nameTokens(raw)).toEqual(tokens)
  })
  it('nome ausente não lança', () => {
    expect(nameTokens(undefined as unknown as string)).toEqual([])
  })
})

// Rodada 1 da M5, item 1: o teste de peça que o tempoSources usa pra não tratar peça como kit inteiro.
describe('isDrumPieceToken', () => {
  it.each(['kick', 'KICK', 'Kick', 'bassdrum', 'bumbo', 'snare', 'caixa', 'hat', 'hihat', 'hh', 'chimbal', 'oh',
    'overhead', 'overheads', 'tom', 'toms'])('%s é peça da bateria', (token) => {
    expect(isDrumPieceToken(token)).toBe(true)
  })
  it.each(['drum', 'drums', 'bateria', 'batera', 'kit', 'bat', 'loop', 'perc', 'shaker', 'bass', ''])('%s não é peça da bateria', (token) => {
    expect(isDrumPieceToken(token)).toBe(false)
  })
  it('cada token de peça do nome é reconhecido como peça pelo reconhecimento', () => {
    for (const raw of ['Snare Drum', 'Kick Drum', 'HH', 'OH', 'Bass Drum', 'Bumbo', 'Chimbal']) {
      expect(nameTokens(raw).some(isDrumPieceToken)).toBe(true)
      expect(recognizeChannel(raw).family).toBe('bateria')
    }
  })
  it('TOM vira a peça Tom da bateria, sem mudar o papel de Click e Guia', () => {
    expect(recognizeChannel('TOM')).toEqual({ label: 'Tom', family: 'bateria' })
    expect(recognizeChannel('Tom 1')).toEqual({ label: 'Tom', family: 'bateria' })
    expect(recognizeChannel('Floor Tom')).toEqual({ label: 'Tom', family: 'bateria' })
    expect(recognizeChannel('TOMS')).toEqual({ label: 'Tons', family: 'bateria' })
    expect([roleFromName('Tom Guia'), roleFromName('Tom Click'), roleFromName('TOM')]).toEqual(['guide', 'click', 'normal'])
  })
})

// Rodada 1 da M5, item 3: as palavras novas (peças, LOOP, SHAKER, BAJO) não mudam o papel
// de Click e Guia. Valores iguais aos da base cb539ec (sonda da revisão e da rodada 1).
describe('palavras novas da M5 com Click e Guia mantêm o papel', () => {
  it.each([
    ['Loop Click', 'click', 'click', 'Click'], ['Bumbo Click', 'click', 'click', 'Click'],
    ['Shaker Click', 'click', 'click', 'Click'], ['Caixa Guia', 'guide', 'guia', 'Guia'],
    ['LOOP CUE', 'guide', 'guia', 'Guia'], ['Chimbal Guia', 'guide', 'guia', 'Guia'],
    ['Bajo Guia', 'guide', 'guia', 'Guia'],
  ])('%s: papel %s, família %s, rótulo %s', (name, role, family, label) => {
    const ch = { id: '1', name }
    expect(roleFromName(name)).toBe(role)
    expect([resolveChannelRole(ch), channelFamily(ch)]).toEqual([role, family])
    expect(buildChannelLabels([ch])[0]).toMatchObject({ label, role, family })
    expect(resolveChannelRole({ id: '2', name: 'Track 1', customName: name })).toBe(role)
  })
})

// Rodada 1 da M5, item 4: loop em par estéreo ou em variações. Só a regra da Percussão
// aceita esses lados ao lado de LOOP; a marca de andamento do Click não muda.
describe('loop estéreo e variações (M5, rodada 1)', () => {
  it.each([
    ['Loop L', 'Loop L'], ['Loop R', 'Loop R'], ['LOOP LEFT', 'Loop L'], ['Loops_R', 'Loop R'], ['Loop Esq', 'Loop L'],
    ['Loop Dir', 'Loop R'], ['Loop A', 'Loop'], ['Loop B', 'Loop'], ['Loop Fx', 'Loop FX'], ['Loop L 2', 'Loop L'],
  ])('%s vira Percussão %s, papel Normal', (raw, label) => {
    expect(recognizeChannel(raw)).toEqual({ label, family: 'percussao' })
    expect(roleFromName(raw)).toBe('normal')
  })
  it('Loop A e Loop B entram na numeração', () => {
    expect(labels(['Loop B', 'Loop A'])).toEqual(['Loop 2', 'Loop 1'])
  })
  it.each([
    ['Beat L', 'Beat L'], ['Beat R', 'Beat R'], ['Tempo L', 'Tempo L'], ['Beat A', 'Beat A'], ['Tempo Fx', 'Tempo Fx'],
  ])('%s continua como antes: não reconhecido (%s), papel Normal', (raw, label) => {
    expect(recognizeChannel(raw)).toEqual({ label, family: 'desconhecido' })
    expect(roleFromName(raw)).toBe('normal')
    expect(resolveChannelRole({ id: '1', name: raw })).toBe('normal')
  })
  it('os lados só valem ao lado de LOOP', () => {
    expect(recognizeChannel('L')).toEqual({ label: 'L', family: 'desconhecido' })
    expect(recognizeChannel('Beat Loop L')).toEqual({ label: 'Beat Loop L', family: 'desconhecido' })
    expect(recognizeChannel('Intro Loop R')).toEqual({ label: 'Intro Loop R', family: 'desconhecido' })
    expect(recognizeChannel('Pad Loop L')).toEqual({ label: 'Pad Loop L', family: 'pad' })
  })
})

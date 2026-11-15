import { describe, expect, it } from 'vitest'
import {
  CUSTOM_NAME_MAX, applyChannelMetaPatch, applyChannelMetaToList, autoPanFor, channelGain, findClickChannel, isPitchExempt,
  isSilencedBySolo, isSoloSafe, pickMainChannel, pickTempoSourceChannel, pitchChangeAction,
} from './channelRoles'
import { recognizeChannel, type ChannelIdentity } from './channelNames'

const mix = (id: string, name: string, extra: object = {}) => ({ id, name, volume: 0.8, muted: false, soloed: false, ...extra })

describe('solo não cala Click e Guia (spec 9b)', () => {
  it('solo no Baixo: Click e Guia seguem, Bateria cala', () => {
    const all = [mix('c', 'CLICK'), mix('g', 'Voz Guia'), mix('d', 'DRUMS'), mix('b', 'BASS', { soloed: true })]
    expect(all.map((ch) => channelGain(ch, all))).toEqual([0.8, 0.8, 0, 0.8])
    expect(all.map((ch) => isSilencedBySolo(ch, all))).toEqual([false, false, true, false])
    expect([isSoloSafe({ id: '1', name: 'CUE' }), isSoloSafe({ id: '2', name: 'CLICK', role: 'normal' })]).toEqual([true, false])
  })
  it('o M do Click continua funcionando com solo ligado', () => {
    const all = [mix('c', 'CLICK', { muted: true }), mix('b', 'BASS', { soloed: true })]
    expect(channelGain(all[0], all)).toBe(0)
  })
  it('vale o papel manual: Normal num CLICK cala; Click num Track segue', () => {
    const all = [mix('c', 'CLICK', { role: 'normal' }), mix('t', 'Track 7', { role: 'click' }), mix('b', 'BASS', { soloed: true })]
    expect(all.map((ch) => channelGain(ch, all))).toEqual([0, 0.8, 0.8])
  })
  it('sem solo vale o volume; solo no próprio Click cala os normais e mantém a Guia', () => {
    const none = [mix('d', 'DRUMS')]
    expect(channelGain(none[0], none)).toBe(0.8)
    const all = [mix('c', 'CLICK', { soloed: true }), mix('g', 'GUIA'), mix('d', 'DRUMS')]
    expect(all.map((ch) => channelGain(ch, all))).toEqual([0.8, 0.8, 0])
  })
})

describe('efeitos do papel', () => {
  it('troca de tom e pan automático seguem o papel', () => {
    expect(isPitchExempt({ id: '1', name: 'Metrônomo' })).toBe(true)
    expect(isPitchExempt({ id: '2', name: 'BASS', role: 'guide' })).toBe(true)
    expect(autoPanFor({ id: '1', name: 'CUE' }, true)).toEqual({ pan: -1, bus: '1' })
    expect(autoPanFor({ id: '2', name: 'BASS' }, true)).toEqual({ pan: 1, bus: '2' })
    expect(autoPanFor({ id: '3', name: 'CLICK' }, false)).toEqual({ pan: 0, bus: '1/2' })
  })
  it('achadores', () => {
    const list = [{ id: 'a', name: 'CLICK', role: 'normal' as const }, { id: 'b', name: 'Track', role: 'click' as const },
      { id: 'c', name: 'Voz Guia' }, { id: 'd', name: 'BASS' }, { id: 'e', name: 'DRUMS' }]
    expect(findClickChannel(list)?.id).toBe('b')
    expect(pickMainChannel(list)?.id).toBe('a')
    expect(pickTempoSourceChannel(list)?.id).toBe('e')
    expect(pickTempoSourceChannel([{ id: 'x', name: 'Click' }, { id: 'y', name: 'Pad' }])?.id).toBe('y')
  })
  it('patch de nome e papel: limpa, corta em 24, vazio volta ao automático, não muta', () => {
    const ch = { id: '1', name: 'GTR_1', customName: 'Velho', role: 'click' as const }
    expect(applyChannelMetaPatch(ch, { customName: '  Guitarra   do  Zé ' }).customName).toBe('Guitarra do Zé')
    expect(applyChannelMetaPatch(ch, { customName: 'x'.repeat(30) }).customName).toHaveLength(24)
    expect('customName' in applyChannelMetaPatch(ch, { customName: '   ' })).toBe(false)
    expect('role' in applyChannelMetaPatch(ch, { role: null })).toBe(false)
    expect(applyChannelMetaPatch(ch, {})).toEqual(ch)
    expect(ch.customName).toBe('Velho')
  })
  it('aplicar na lista reordena no automático, respeita o manual e avisa mudança de papel', () => {
    const list = [{ id: 'v', name: 'Vocal' }, { id: 't', name: 'Track 7' }]
    const auto = applyChannelMetaToList(list, 't', { role: 'click' }, 'auto')
    expect(auto.channels.map((c) => c.id)).toEqual(['t', 'v'])
    expect(auto.roleChanged).toBe(true)
    expect(auto.channels).toContain(auto.after)
    expect(applyChannelMetaToList(list, 't', { role: 'click' }, 'manual').channels.map((c) => c.id)).toEqual(['v', 't'])
    expect(applyChannelMetaToList(list, 't', { customName: 'Zé' }, 'auto').roleChanged).toBe(false)
    expect(applyChannelMetaToList(list, 'nao-existe', { role: 'click' }, 'auto').after).toBeUndefined()
  })
  it('pitchChangeAction decide o que o motor faz quando o papel muda', () => {
    const normal = { id: '1', name: 'BASS' }
    const guia = { id: '1', name: 'BASS', role: 'guide' as const }
    expect(pitchChangeAction(normal, guia, { isPlaying: true, pitch: 2 })).toBe('restart')
    expect(pitchChangeAction(normal, guia, { isPlaying: false, pitch: 2 })).toBe('release')
    expect(pitchChangeAction(guia, normal, { isPlaying: false, pitch: 2 })).toBe('none')
    expect(pitchChangeAction(normal, guia, { isPlaying: true, pitch: 0 })).toBe('none')
    expect(pitchChangeAction(normal, { ...normal, customName: 'Zé' }, { isPlaying: true, pitch: 2 })).toBe('none')
  })
})

// Casos que vêm das decisões do coordenador (item 10 do preflight.md) e de bordas do contrato.
describe('bordas do patch e da lista', () => {
  it('corta em 24 e não deixa espaço sobrando no fim', () => {
    const ch: ChannelIdentity = { id: '1', name: 'GTR_1' }
    expect(applyChannelMetaPatch(ch, { customName: `${'a'.repeat(23)} bcd` }).customName).toBe('a'.repeat(23))
  })
  it('corte em 24 não parte emoji ao meio', () => {
    const ch: ChannelIdentity = { id: '1', name: 'GTR_1' }
    expect(applyChannelMetaPatch(ch, { customName: `${'a'.repeat(23)}🎸` }).customName).toBe('a'.repeat(23))
  })
  it('o rótulo de nome não reconhecido usa o mesmo limite do nome do usuário', () => {
    for (const raw of ['SEQUENCIA ESPECIAL ABERTURA DO CULTO', 'Sequencia-Especial-Abertura-Do-Culto', 'SequenciaEspecialAberturaDoCulto']) {
      expect(recognizeChannel(raw).label.length).toBeLessThanOrEqual(CUSTOM_NAME_MAX)
    }
  })
  it('customName null volta ao automático; role define e undefined não mexe', () => {
    const ch = { id: '1', name: 'GTR_1', customName: 'Velho', role: 'click' as const }
    const out = applyChannelMetaPatch(ch, { customName: null, role: 'guide' })
    expect('customName' in out).toBe(false)
    expect(out.role).toBe('guide')
    expect(applyChannelMetaPatch(ch, { customName: 'Novo' })).toEqual({ ...ch, customName: 'Novo' })
    expect(applyChannelMetaPatch(ch, {})).not.toBe(ch)
  })
  it('lista: before é o original, after é cópia nova, entrada intacta; id desconhecido não reordena', () => {
    const list = [{ id: 'v', name: 'Vocal' }, { id: 't', name: 'Track 7' }]
    const res = applyChannelMetaToList(list, 't', { customName: 'Click' }, 'auto')
    expect(res.before).toBe(list[1])
    expect(res.after).not.toBe(list[1])
    expect(res.after).toMatchObject({ customName: 'Click' })
    expect(res.roleChanged).toBe(true)
    expect(res.channels.map((c) => c.id)).toEqual(['t', 'v'])
    expect(list.map((c) => c.id)).toEqual(['v', 't'])
    expect('customName' in list[1]).toBe(false)
    const none = applyChannelMetaToList(list, 'nao-existe', { role: 'click' }, 'auto')
    expect([none.channels.map((c) => c.id), none.before, none.roleChanged]).toEqual([['v', 't'], undefined, false])
  })
  it('isSilencedBySolo: sem solo ninguém é calado pelo solo', () => {
    const all = [mix('d', 'DRUMS'), mix('b', 'BASS')]
    expect(all.map((ch) => isSilencedBySolo(ch, all))).toEqual([false, false])
  })
  it('achadores com lista vazia e fonte de tempo pelo baixo', () => {
    expect([findClickChannel([]), pickMainChannel([]), pickTempoSourceChannel([])]).toEqual([undefined, undefined, undefined])
    expect(pickTempoSourceChannel([{ id: 'p', name: 'Pad' }, { id: 'b', name: 'BASS' }])?.id).toBe('b')
    expect(pickTempoSourceChannel([{ id: 'c', name: 'CLICK' }, { id: 'g', name: 'GUIA' }])?.id).toBe('c')
  })
})

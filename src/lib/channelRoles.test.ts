import { describe, expect, it } from 'vitest'
import {
  CUSTOM_NAME_MAX, applyChannelMetaPatch, applyChannelMetaToList, autoPanFor, channelFaderFill, channelGain, findClickChannel,
  isPitchExempt, isSilencedBySolo, isSoloSafe, pickMainChannel, pickTempoSourceChannel, pickWaveformChannel, pitchChangeAction,
} from './channelRoles'
import { FAMILY_COLOR, buildChannelLabels, recognizeChannel, sortChannelsByDefault, type ChannelIdentity } from './channelNames'

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
  it('Ambient Beat Pad é Normal: entra na troca de tom, vai pro PA e cala no Solo (rodada de correção 2)', () => {
    const pad = { id: 'p', name: 'Ambient Beat Pad' }
    expect([isPitchExempt(pad), isSoloSafe(pad)]).toEqual([false, false])
    expect(autoPanFor(pad, true)).toEqual({ pan: 1, bus: '2' })
    const all = [mix('p', 'Ambient Beat Pad'), mix('t', 'Tempo'), mix('b', 'BASS', { soloed: true })]
    expect(all.map((ch) => channelGain(ch, all))).toEqual([0, 0.8, 0.8])
    expect(findClickChannel([pad, { id: 't', name: 'Tempo' }])?.id).toBe('t')
  })
  it('Beat Loop é Normal: troca de tom, PA e cala no Solo; Tempo_120bpm segue tocando (rodada de correção 3)', () => {
    const loop = { id: 'l', name: 'Beat Loop' }
    expect([isPitchExempt(loop), isSoloSafe(loop)]).toEqual([false, false])
    expect(autoPanFor(loop, true)).toEqual({ pan: 1, bus: '2' })
    const all = [mix('l', 'Beat Loop'), mix('t', 'Tempo_120bpm'), mix('b', 'BASS', { soloed: true })]
    expect(all.map((ch) => channelGain(ch, all))).toEqual([0, 0.8, 0.8])
    expect(autoPanFor({ id: 't', name: 'Tempo_120bpm' }, true)).toEqual({ pan: -1, bus: '1' })
  })
  it('ClickTrack, VozGuia e Guias seguem tocando no Solo (rodada de correção 2)', () => {
    const all = [mix('c', 'ClickTrack'), mix('v', 'VozGuia'), mix('g', 'Guias'), mix('d', 'DRUMS'), mix('b', 'BASS', { soloed: true })]
    expect(all.map((ch) => channelGain(ch, all))).toEqual([0.8, 0.8, 0.8, 0, 0.8])
    expect([isPitchExempt({ id: '1', name: 'ClickTrack' }), isPitchExempt({ id: '2', name: 'VozGuia' })]).toEqual([true, true])
  })
  it('achadores com lista vazia e fonte de tempo pelo baixo', () => {
    expect([findClickChannel([]), pickMainChannel([]), pickTempoSourceChannel([])]).toEqual([undefined, undefined, undefined])
    expect(pickTempoSourceChannel([{ id: 'p', name: 'Pad' }, { id: 'b', name: 'BASS' }])?.id).toBe('b')
    expect(pickTempoSourceChannel([{ id: 'c', name: 'CLICK' }, { id: 'g', name: 'GUIA' }])?.id).toBe('c')
  })
})

// Revisão final (I3): o vermelho é a cor da família Bateria; não pode dizer "calado" também.
describe('fader do canal calado', () => {
  it('com Solo em outro canal, Bateria calada e Bateria tocando têm preenchimentos diferentes; calado nunca é vermelho', () => {
    const all = [mix('k', 'KICK', { soloed: true }), mix('s', 'SNARE'), mix('h', 'HH', { soloed: true, muted: true })]
    const colors = new Map(buildChannelLabels(all).map((l) => [l.id, l.color]))
    // Mesma conta do mixer no App: M ligado ou calado pelo Solo de outro canal.
    const fill = (ch: (typeof all)[number]) => channelFaderFill(colors.get(ch.id)!, ch.muted || isSilencedBySolo(ch, all))
    const [playing, silencedBySolo, muted] = all.map(fill)
    expect([...colors.values()]).toEqual([FAMILY_COLOR.bateria, FAMILY_COLOR.bateria, FAMILY_COLOR.bateria])
    expect(playing).toContain(FAMILY_COLOR.bateria)
    expect(silencedBySolo).not.toBe(playing)
    for (const silenced of [silencedBySolo, muted]) {
      expect(silenced).toBe('linear-gradient(to top, rgba(255,255,255,0.12), rgba(255,255,255,0.04))')
      expect(silenced.replace(/\s/g, '')).not.toContain('239,68,68')
      expect(silenced.toLowerCase()).not.toContain(FAMILY_COLOR.bateria.toLowerCase())
    }
  })
  it('a cor da família Bateria não muda', () => {
    expect(FAMILY_COLOR.bateria).toBe('#ef4444')
  })
})

// Revisão final (N3): a ordem padrão põe a bateria como primeiro Normal; a onda não usa ela.
describe('canal da onda do SectionBar', () => {
  it('prefere o primeiro Normal que não seja bateria nem percussão', () => {
    const list = sortChannelsByDefault([{ id: 'v', name: 'Vocal' }, { id: 'b', name: 'BASS' }, { id: 'k', name: 'KICK' },
      { id: 'p', name: 'SHAKER' }, { id: 'd', name: 'DRUMS' }, { id: 'c', name: 'CLICK' }, { id: 'g', name: 'Voz Guia' }])
    expect(list.map((c) => c.id)).toEqual(['c', 'g', 'k', 'd', 'p', 'b', 'v'])
    expect(pickWaveformChannel(list)?.id).toBe('b')
  })
  it('vale a família resolvida: nome do usuário e papel manual contam', () => {
    expect(pickWaveformChannel([{ id: 'd', name: 'DRUMS' }, { id: 't', name: 'Track 9', customName: 'Violão do Zé' }])?.id).toBe('t')
    expect(pickWaveformChannel([{ id: 'g', name: 'GTR', role: 'guide' }, { id: 'a', name: 'AG' }])?.id).toBe('a')
  })
  it('só bateria e percussão: o primeiro Normal; só Click e Guia: nenhum (o App cai no primeiro canal)', () => {
    expect(pickWaveformChannel([{ id: 'c', name: 'CLICK' }, { id: 'p', name: 'PERC' }, { id: 'd', name: 'DRUMS' }])?.id).toBe('p')
    expect(pickWaveformChannel([{ id: 'c', name: 'CLICK' }, { id: 'g', name: 'GUIA' }])).toBeUndefined()
    expect(pickWaveformChannel([])).toBeUndefined()
  })
  it('pickMainChannel não muda pros outros chamadores (tom e tempo)', () => {
    expect(pickMainChannel([{ id: 'c', name: 'CLICK' }, { id: 'd', name: 'DRUMS' }, { id: 'b', name: 'BASS' }])?.id).toBe('d')
  })
})

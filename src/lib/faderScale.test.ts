import { describe, expect, it } from 'vitest'
import {
  FADER_MAX_DB, FADER_MAX_GAIN, FADER_MIN_DB, FADER_ZERO, dbText, dragFader, dragPan, faderToDb, faderToGain, fitStrips, gainToFader,
  gestureIntent, panText, stepGainDb, stepPan,
} from './faderScale'

const TRAVESSAO = String.fromCharCode(0x2014)
const MENOS = '−'

describe('escala do fader (v6: dbOf e dbGain)', () => {
  it('0 dB fica em 3/4 do curso', () => expect(FADER_ZERO).toBe(0.75))

  it.each([[0.75, 0], [1, 6], [0.375, 40 * Math.log10(0.5)], [0.01, -Infinity]])('faderToDb(%s)', (f, db) => expect(faderToDb(f)).toBeCloseTo(db, 6))

  it('abaixo de 0,02 é silêncio; acima do teto não passa de +6 dB; valor inválido é silêncio', () => {
    expect(faderToDb(0.0199)).toBe(-Infinity)
    expect(faderToDb(0.02)).toBeCloseTo(40 * Math.log10(0.02 / 0.75), 6)
    expect(faderToDb(1.4)).toBe(6)
    expect(faderToDb(Number.NaN)).toBe(-Infinity)
  })

  it('ganho: 0 dB = 1, +6 dB perto de 2, silêncio = 0', () => {
    expect(faderToGain(0.75)).toBe(1)
    expect(faderToGain(1)).toBeCloseTo(10 ** (6 / 20), 9)
    expect(faderToGain(0.01)).toBe(0)
    expect(faderToGain(0)).toBe(0)
  })

  it('ida e volta do ganho', () => { for (const g of [0, 0.1, 0.5, 1, 1.5, 1.99]) expect(faderToGain(gainToFader(g))).toBeCloseTo(g, 4) })

  it('ganho pro fader: 0 e inválido no pé, 1 em 0 dB, teto em +6 dB', () => {
    expect(gainToFader(0)).toBe(0)
    expect(gainToFader(-1)).toBe(0)
    expect(gainToFader(Number.NaN)).toBe(0)
    expect(gainToFader(1)).toBe(0.75)
    expect(gainToFader(10)).toBe(1)
    expect(gainToFader(Infinity)).toBe(1)
  })

  it('os números da escala do PRINCIPAL caem na curva (+6 no topo, 0 em 25%, -12 em 62,5%, -24 em 81,25%)', () => {
    const at = (fromTop: number) => Math.round(faderToDb(1 - fromTop))
    expect(at(0)).toBe(6)
    expect(at(0.25)).toBe(0)
    expect(at(0.625)).toBe(-12)
    expect(at(0.8125)).toBe(-24)
    expect(faderToDb(0)).toBe(-Infinity)
  })
})

describe('textos', () => {
  it.each([[1, '0.0 dB'], [0, `${MENOS}∞ dB`], [0.5, `${MENOS}6.0 dB`]])('dbText(%s)', (g, t) => expect(dbText(g)).toBe(t))

  it('sinal de mais e de menos tipográfico; perto de 0 dB é 0.0', () => {
    expect(dbText(10 ** (2 / 20))).toBe('+2.0 dB')
    expect(dbText(10 ** (-3.5 / 20))).toBe(`${MENOS}3.5 dB`)
    expect(dbText(10 ** (0.04 / 20))).toBe('0.0 dB')
    expect(dbText(10 ** (-0.04 / 20))).toBe('0.0 dB')
    expect(dbText(Number.NaN)).toBe(`${MENOS}∞ dB`)
    for (const g of [0, 0.5, 1, 1.5]) {
      expect(dbText(g)).not.toContain('-')
      expect(dbText(g)).not.toContain(TRAVESSAO)
    }
  })

  it.each([[-0.5, 'L50'], [0, 'C'], [0.3, 'R30']])('panText(%s)', (p, t) => expect(panText(p)).toBe(t))

  it('pan nas pontas, quase no centro e inválido', () => {
    expect(panText(-1)).toBe('L100')
    expect(panText(1)).toBe('R100')
    expect(panText(1.5)).toBe('R100')
    expect(panText(0.004)).toBe('C')
    expect(panText(Number.NaN)).toBe('C')
  })
})

describe('arrasto', () => {
  it('fader: deslocamento pra cima sobre o curso, preso entre 0 e 1, curso de no mínimo 40 px', () => {
    expect(dragFader(0.75, 20, 200)).toBeCloseTo(0.85, 9)
    expect(dragFader(0.75, -20, 200)).toBeCloseTo(0.65, 9)
    expect(dragFader(0.75, 10, 0)).toBe(1) // curso desconhecido vale 40 px
    expect(dragFader(0.5, 10, 20)).toBeCloseTo(0.75, 9)
    expect(dragFader(0.1, -500, 200)).toBe(0)
    expect(dragFader(0.9, 500, 200)).toBe(1)
  })

  it('gesto: vertical passou de 3 px e domina = arrasto; lateral chegou primeiro (ou empata) = rolagem; senão espera', () => {
    expect(gestureIntent(0, 2)).toBe('espera')
    expect(gestureIntent(2, -2)).toBe('espera')
    expect(gestureIntent(1, 3)).toBe('arrasto')
    expect(gestureIntent(-2, -10)).toBe('arrasto')
    expect(gestureIntent(20, 4)).toBe('rolagem')
    expect(gestureIntent(-3, 1)).toBe('rolagem')
    expect(gestureIntent(5, 5)).toBe('rolagem')
    expect(gestureIntent(5, -5)).toBe('rolagem')
    expect(gestureIntent(Number.NaN, 10)).toBe('arrasto')
  })

  it('pan: 0,014 por px, preso entre -1 e 1, perto do centro vira 0', () => {
    expect(dragPan(0, 10)).toBeCloseTo(0.14, 9)
    expect(dragPan(0, -10)).toBeCloseTo(-0.14, 9)
    expect(dragPan(0, 2)).toBe(0) // 0,028 fica no centro
    expect(dragPan(0.5, -34)).toBe(0) // 0,024 também
    expect(dragPan(0.5, 1000)).toBe(1)
    expect(dragPan(-0.5, -1000)).toBe(-1)
  })
})

describe('teto e piso (constantes únicas, a T29 usa no celular da banda)', () => {
  it('topo em +6 dB, ganho perto de 2; pé audível perto de -63 dB', () => {
    expect(FADER_MAX_DB).toBe(6)
    expect(FADER_MAX_GAIN).toBeCloseTo(10 ** (6 / 20), 12)
    expect(FADER_MAX_GAIN).toBe(faderToGain(1))
    expect(gainToFader(FADER_MAX_GAIN)).toBe(1)
    expect(FADER_MIN_DB).toBeCloseTo(40 * Math.log10(0.02 / 0.75), 9)
    expect(faderToDb(0.02)).toBeCloseTo(FADER_MIN_DB, 9)
  })
})

describe('teclado', () => {
  const db = (g: number) => 20 * Math.log10(g)

  it('passo em dB a partir do ganho, arredondado em 0,1 dB', () => {
    expect(db(stepGainDb(1, 1))).toBeCloseTo(1, 9)
    expect(db(stepGainDb(1, -1))).toBeCloseTo(-1, 9)
    expect(db(stepGainDb(1, 6))).toBeCloseTo(6, 9)
    expect(db(stepGainDb(1, -6))).toBeCloseTo(-6, 9)
    expect(db(stepGainDb(0.5, 1))).toBeCloseTo(-5, 9) // -6,02 + 1 = -5,02, fica -5,0
  })

  it('teto em +6 dB; abaixo do pé vira silêncio; do silêncio, subir sai do pé', () => {
    expect(stepGainDb(1.9, 1)).toBe(FADER_MAX_GAIN)
    expect(stepGainDb(FADER_MAX_GAIN, 6)).toBe(FADER_MAX_GAIN)
    expect(stepGainDb(10 ** (-62 / 20), -1)).toBe(0)
    expect(stepGainDb(0, -1)).toBe(0)
    expect(stepGainDb(Number.NaN, -6)).toBe(0)
    expect(db(stepGainDb(0, 1))).toBeCloseTo(-62, 9)
    expect(db(stepGainDb(0, 6))).toBeCloseTo(-57, 9)
    expect(gainToFader(stepGainDb(0, 1))).toBeGreaterThanOrEqual(0.02) // aparece no fader, não é silêncio
  })

  it('pan pelo teclado: soma o passo, preso em ±1, passos de 0,01 e centro que gruda', () => {
    expect(stepPan(0, 0.05)).toBeCloseTo(0.05, 9)
    expect(stepPan(0.5, 0.05)).toBeCloseTo(0.55, 9)
    expect(stepPan(-0.98, -0.05)).toBe(-1)
    expect(stepPan(0.03, -0.05)).toBe(0) // -0,02 gruda no centro
    expect(stepPan(Number.NaN, 0.05)).toBeCloseTo(0.05, 9)
  })
})

describe('largura das faixas', () => {
  it('14 canais em 1280px cabem inteiros', () => expect(fitStrips(1114, 0, 76).count).toBe(14))

  it('a largura reparte o espaço entre os canais que cabem inteiros', () => {
    expect(fitStrips(1114, 0, 76).width).toBeCloseTo(1114 / 14, 9)
    expect(fitStrips(600, 0, 76)).toEqual({ count: 7, width: 600 / 7 })
    const withGap = fitStrips(1000, 10, 76)
    expect(withGap.count).toBe(11)
    expect(withGap.width).toBeCloseTo((1000 - 10 * 10) / 11, 9)
  })

  it('nunca menos de um canal nem mais estreito que o mínimo', () => {
    expect(fitStrips(50, 0, 76)).toEqual({ count: 1, width: 76 })
    expect(fitStrips(0, 0, 76)).toEqual({ count: 1, width: 76 })
    expect(fitStrips(Number.NaN, 0, 76)).toEqual({ count: 1, width: 76 })
  })
})

import { describe, expect, expectTypeOf, it } from 'vitest'
import type { TimeSignatureType } from './AudioAnalyzer'
import {
  GRID_WARNING_TEXT, TIME_SIGNATURES, countPulses, gridHasPhase, isCompound, pulsesPerBar, signatureForPulses,
  type SongGrid, type TimeSignature,
} from './stageContracts'

const TRAVESSAO = String.fromCharCode(0x2014)

describe('compasso', () => {
  it('pulsos e contagem por compasso', () => {
    expect(TIME_SIGNATURES.map(pulsesPerBar)).toEqual([3, 4, 5, 6, 7, 12])
    expect(countPulses('6/8', 3)).toBe(2); expect(countPulses('12/8', 3)).toBe(4); expect(countPulses('4/4', 1)).toBe(4)
    expect(signatureForPulses(2)).toBeNull(); expect(signatureForPulses(6)).toBe('6/8')
  })
  it('lista na ordem e o tipo é o mesmo do AudioAnalyzer', () => {
    expect(TIME_SIGNATURES).toEqual(['3/4', '4/4', '5/4', '6/8', '7/8', '12/8'])
    expectTypeOf<TimeSignature>().toEqualTypeOf<TimeSignatureType>()
  })
  it('composto só 6/8 e 12/8; contar de 3 em 3 só encurta o composto', () => {
    expect(TIME_SIGNATURES.filter(isCompound)).toEqual(['6/8', '12/8'])
    expect(TIME_SIGNATURES.map((s) => countPulses(s, 3))).toEqual([3, 4, 5, 2, 7, 4])
    expect(TIME_SIGNATURES.map((s) => countPulses(s, 1))).toEqual([3, 4, 5, 6, 7, 12])
  })
  it('pulsos voltam pro compasso e o resto é nulo', () => {
    for (const s of TIME_SIGNATURES) expect(signatureForPulses(pulsesPerBar(s))).toBe(s)
    for (const n of [0, 1, 2, 8, 9, 10, 11, 13, 4.5, -4, NaN, Infinity]) expect(signatureForPulses(n)).toBeNull()
  })
})

describe('grade', () => {
  const grid: SongGrid = { bpm: 120, firstDownbeat: 0.2, signature: '4/4', countEvery: 1, source: 'click', meterSource: 'acento' }
  it('só a grade lida no click tem fase', () => {
    expect(gridHasPhase(grid)).toBe(true)
    expect(gridHasPhase({ ...grid, source: 'bpm' })).toBe(false)
  })
  it('avisos da grade curtos e sem travessão', () => {
    for (const w of Object.values(GRID_WARNING_TEXT)) {
      expect(w.label.length).toBeLessThanOrEqual(16)
      expect(w.label + w.title).not.toContain(TRAVESSAO)
    }
  })
  it('textos dos avisos', () => {
    expect(GRID_WARNING_TEXT).toEqual({
      'sem-grade': { label: 'SEM GRADE', title: 'Sem click e sem BPM salvo: o pulo cai na marca da seção, sem contagem.' },
      'sem-click-lido': { label: 'SEM CLICK LIDO', title: 'A contagem usa o BPM salvo da música. Confira o canal de click.' },
      'compasso-assumido': { label: '4/4 ASSUMIDO', title: 'O click não tem acento no 1. Confira o compasso no EDITAR.' },
    })
  })
})

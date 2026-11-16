import { describe, expect, expectTypeOf, it } from 'vitest'
import type { TimeSignatureType } from './AudioAnalyzer'
import {
  GRID_WARNING_TEXT, TIME_SIGNATURES, countPulses, displayBpmFromPulseBpm, gridHasPhase, isCompound, isEighthPulse,
  pulseBpmFromDisplayBpm, pulsesPerBar, signatureForPulses, type SongGrid, type TimeSignature,
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

describe('BPM do pulso e BPM exibido (Ruling T3-BPM: o exibido e o salvo são sempre na semínima)', () => {
  // Ruling D1-denominador: decide o denominador do compasso, não o composto.
  it('em compasso de colcheia (x/8) o pulso é a colcheia: 156 em 6/8 é 78, 140 em 7/8 é 70, e a volta', () => {
    expect(displayBpmFromPulseBpm(156, '6/8')).toBe(78); expect(pulseBpmFromDisplayBpm(78, '6/8')).toBe(156)
    expect(displayBpmFromPulseBpm(150, '12/8')).toBe(75); expect(pulseBpmFromDisplayBpm(75, '12/8')).toBe(150)
    expect(displayBpmFromPulseBpm(140, '7/8')).toBe(70); expect(pulseBpmFromDisplayBpm(70, '7/8')).toBe(140)
    expect(TIME_SIGNATURES.filter(isEighthPulse)).toEqual(['6/8', '7/8', '12/8'])
  })
  it('em compasso de semínima (x/4) os dois devolvem o próprio valor', () => {
    expect(displayBpmFromPulseBpm(120, '4/4')).toBe(120); expect(pulseBpmFromDisplayBpm(120, '4/4')).toBe(120)
    for (const s of ['3/4', '4/4', '5/4'] as const) {
      expect(displayBpmFromPulseBpm(72.5, s)).toBe(72.5); expect(pulseBpmFromDisplayBpm(72.5, s)).toBe(72.5)
    }
  })
  it('ida e volta dá o número original em todos os compassos', () => {
    for (const s of TIME_SIGNATURES) {
      for (const bpm of [30, 62.5, 67.5, 72.5, 78, 140 / 3, 299.99, 300]) {
        expect(displayBpmFromPulseBpm(pulseBpmFromDisplayBpm(bpm, s), s)).toBe(bpm)
        expect(pulseBpmFromDisplayBpm(displayBpmFromPulseBpm(bpm, s), s)).toBe(bpm)
      }
    }
  })
  it('entrada não finita ou menor ou igual a 0 devolve NaN', () => {
    for (const s of TIME_SIGNATURES) {
      for (const bad of [0, -78, NaN, Infinity, -Infinity]) {
        expect(displayBpmFromPulseBpm(bad, s)).toBeNaN(); expect(pulseBpmFromDisplayBpm(bad, s)).toBeNaN()
      }
    }
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

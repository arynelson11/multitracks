import { describe, expect, it } from 'vitest'
import type { Marker } from '../types'
import { TIME_SIGNATURES, type SongGrid, type TimeSignature } from './stageContracts'
import {
  barIndexAt, barSeconds, gridFromBpm, gridFromClick, gridWarning, keepManualMeter, markerIdForSpan, nearestBarLine,
  pulseSeconds, sanitizeGrid, sectionIndexAt, sectionSpans, snapToBar, withMeter,
} from './songGrid'

/** Tempo exato a menos de arredondamento: tolerância de 1 microssegundo. */
const TOL = 1e-6
function expectTime(got: number, want: number) {
  expect(got).toBeGreaterThanOrEqual(want - TOL); expect(got).toBeLessThanOrEqual(want + TOL)
}

// Valores literais do plano (Tarefa 2).
const g: SongGrid = { bpm: 120, firstDownbeat: 0.25, signature: '4/4', countEvery: 1, source: 'click', meterSource: 'acento' }
it('barras e encaixe', () => {
  expect(barSeconds(g)).toBe(2); expect(nearestBarLine(4.1, g)).toBeCloseTo(4.25)
  expect(snapToBar(4.6, g)).toBeCloseTo(4.25)   // a 0,35 s da barra: encaixa (limite 0,5 s)
  expect(snapToBar(5.3, g)).toBe(5.3)           // a 0,95 s da barra de 6,25: marca crua
  expect(snapToBar(0, g)).toBe(0); expect(snapToBar(4.6, { ...g, source: 'bpm' })).toBe(4.6); expect(snapToBar(4.6, null)).toBe(4.6)
})
it('seções encaixadas e a última nunca passa do áudio', () => {
  const m = [{ id: 'b', time: 8.2, label: 'Refrão' }, { id: 'a', time: 0, label: 'Intro' }, { id: 'c', time: 16.4, label: 'Final' }]
  expect(sectionSpans(m, 20.1, g)).toEqual([{ index: 0, start: 0, end: 8.25, snappedTo: 'raw' }, { index: 1, start: 8.25, end: 16.25, snappedTo: 'bar' }, { index: 2, start: 16.25, end: 20.1, snappedTo: 'bar' }])
  expect(markerIdForSpan(m, 20.1, g, 1)).toBe('b')
})
it('ignora marca inválida e o índice é o da lista de spans', () => expect(sectionSpans([{ id: 'x', time: NaN, label: 'X' }, { id: 'y', time: 99, label: 'Y' }, { id: 'z', time: 3, label: 'Z' }], 30, null)).toEqual([{ index: 0, start: 3, end: 30, snappedTo: 'raw' }]))
it('grade a partir do bpm salvo e do click, com a origem do compasso', () => {
  expect(gridFromBpm(72.5)).toEqual({ bpm: 72.5, firstDownbeat: 0, signature: '4/4', countEvery: 1, source: 'bpm', meterSource: 'padrao' })
  expect(gridFromBpm(72.5, '3/4')!.meterSource).toBe('salvo'); expect(gridFromBpm(0)).toBeNull()
  expect(gridFromClick({ bpm: 90, firstPulse: 0.3, pulsesPerBar: 3, firstDownbeat: 0.97 })).toMatchObject({ signature: '3/4', meterSource: 'acento' })
  expect(gridFromClick({ bpm: 90, firstPulse: 0.3, pulsesPerBar: null, firstDownbeat: null })).toMatchObject({ signature: '4/4', meterSource: 'padrao' })
  expect(gridFromClick({ bpm: 90, firstPulse: 0.3, pulsesPerBar: 3, firstDownbeat: 0.97 }, '6/8')).toMatchObject({ signature: '6/8', meterSource: 'salvo' })
})
it('compasso manual sobrevive a reler o click', () => expect(keepManualMeter(g, withMeter(g, '6/8', 3))).toMatchObject({ signature: '6/8', countEvery: 3, meterSource: 'manual', bpm: 120 }))
it('aviso da grade nunca some em silêncio', () => {
  expect(gridWarning(null)).toBe('sem-grade'); expect(gridWarning(gridFromBpm(80))).toBe('sem-click-lido')
  expect(gridWarning({ ...g, meterSource: 'padrao' })).toBe('compasso-assumido'); expect(gridWarning(g)).toBeNull()
})
it('compasso manual e sanitização', () => {
  expect(withMeter(g, '6/8', 3)).toMatchObject({ signature: '6/8', countEvery: 3, meterSource: 'manual', source: 'click' })
  expect(withMeter(g, '3/4', 3).countEvery).toBe(1)
  expect(sanitizeGrid({ ...g, bpm: NaN })).toBeNull(); expect(sanitizeGrid({ ...g, signature: '9/8' })).toBeNull(); expect(sanitizeGrid({ ...g, source: 'manual' })).toBeNull()
  expect(sanitizeGrid(g)).toEqual(g)
})

// Casos de borda além do plano.
const mk = (id: string, time: number): Marker => ({ id, time, label: id })

describe('pulso, compasso e barras', () => {
  it('o pulso é o do click e o compasso soma os pulsos dele', () => {
    expect(pulseSeconds(g)).toBe(0.5)
    const seisPorOito: SongGrid = { ...g, bpm: 180, signature: '6/8' }
    expect(pulseSeconds(seisPorOito)).toBeCloseTo(1 / 3); expect(barSeconds(seisPorOito)).toBeCloseTo(2)
  })
  it('índice do compasso conta a partir do primeiro 1; antes dele é a anacruse (-1)', () => {
    expect(barIndexAt(0.25, g)).toBe(0); expect(barIndexAt(2.2, g)).toBe(0); expect(barIndexAt(2.25, g)).toBe(1)
    expect(barIndexAt(0.1, g)).toBe(-1); expect(barIndexAt(16.25, g)).toBe(8)
  })
  it('barra mais perto antes do primeiro 1 continua na mesma grade', () => {
    expect(nearestBarLine(0.1, g)).toBeCloseTo(0.25); expect(nearestBarLine(-1.6, g)).toBeCloseTo(-1.75)
  })
})

describe('encaixe', () => {
  it('nunca devolve tempo negativo: barra antes de 0:00 encaixa em 0', () => {
    const tarde: SongGrid = { ...g, firstDownbeat: 1.9 } // barras em -0,1; 1,9; 3,9...
    expect(snapToBar(0.3, tarde)).toBe(0); expect(snapToBar(-1, g)).toBe(0)
  })
  it('exatamente a 1/4 de compasso ainda encaixa', () => {
    expect(snapToBar(4.75, g)).toBeCloseTo(4.25); expect(snapToBar(4.76, g)).toBe(4.76)
  })
  it('grade quebrada ou fora da faixa conta como sem grade: marca crua', () => {
    for (const bpm of [NaN, 0, -120, Infinity, 500]) expect(snapToBar(4.6, { ...g, bpm })).toBe(4.6)
    expect(snapToBar(4.6, { ...g, firstDownbeat: NaN })).toBe(4.6)
  })
})

describe('seções', () => {
  it('duas marcas no mesmo compasso: o trecho vazio sai e a lista continua contínua', () => {
    const m = [mk('a', 0), mk('b', 8.2), mk('c', 8.3), mk('d', 16.4)]
    expect(sectionSpans(m, 20.1, g)).toEqual([{ index: 0, start: 0, end: 8.25, snappedTo: 'raw' }, { index: 1, start: 8.25, end: 16.25, snappedTo: 'bar' }, { index: 2, start: 16.25, end: 20.1, snappedTo: 'bar' }])
    expect(markerIdForSpan(m, 20.1, g, 1)).toBe('c'); expect(markerIdForSpan(m, 20.1, g, 2)).toBe('d')
  })
  it('marca que encaixaria depois do fim do áudio cai no último pulso antes do fim', () => {
    expect(sectionSpans([mk('a', 0), mk('b', 20)], 20.1, g)).toEqual([{ index: 0, start: 0, end: 19.75, snappedTo: 'raw' }, { index: 1, start: 19.75, end: 20.1, snappedTo: 'pulse' }])
    expect(sectionSpans([mk('a', 0), mk('b', 20)], 20.1, null)).toEqual([{ index: 0, start: 0, end: 20, snappedTo: 'raw' }, { index: 1, start: 20, end: 20.1, snappedTo: 'raw' }])
  })
  it('a última termina na barra antes do fim, ou no fim quando essa barra não deixa a seção existir', () => {
    expect(sectionSpans([mk('a', 0)], 20.6, g)).toEqual([{ index: 0, start: 0, end: 20.25, snappedTo: 'raw' }])
    expect(sectionSpans([mk('a', 0), mk('b', 20.3)], 20.6, g)).toEqual([{ index: 0, start: 0, end: 20.25, snappedTo: 'raw' }, { index: 1, start: 20.25, end: 20.6, snappedTo: 'bar' }])
  })
  it('sem marcas ou sem duração, nenhuma seção', () => {
    expect(sectionSpans([], 30, g)).toEqual([])
    for (const d of [NaN, Infinity, 0, -5]) expect(sectionSpans([mk('a', 0)], d, g)).toEqual([])
  })
  it('marca negativa ou no fim exato fica de fora; a lista recebida não muda', () => {
    const m = [mk('b', 10), mk('neg', -1), mk('fim', 30), mk('a', 2)]
    expect(sectionSpans(m, 30, null)).toEqual([{ index: 0, start: 2, end: 10, snappedTo: 'raw' }, { index: 1, start: 10, end: 30, snappedTo: 'raw' }])
    expect(m.map((x) => x.id)).toEqual(['b', 'neg', 'fim', 'a'])
  })
  it('marcas da nuvem sem limpeza: item nulo, vazio ou sem tempo numérico é ignorado, nunca lança', () => {
    const sujas = [null, {}, { time: 'x' }, { time: 10 }] as unknown as Marker[]
    expect(() => sectionSpans(sujas, 30, g)).not.toThrow()
    expect(sectionSpans(sujas, 30, null)).toEqual([{ index: 0, start: 10, end: 30, snappedTo: 'raw' }])
    expect(markerIdForSpan(sujas, 30, null, 0)).toBeNull() // a marca não tem id
    const comVazio = [undefined, ...sujas, { id: 'ok', time: 20 }] as unknown as Marker[]
    expect(() => markerIdForSpan(comVazio, 30, g, 1)).not.toThrow()
    expect(markerIdForSpan(comVazio, 30, null, 1)).toBe('ok')
  })
  it('índice fora da lista não acha marca', () => {
    const m = [mk('a', 0), mk('b', 8.2)]
    for (const i of [-1, 2, 0.5, NaN]) expect(markerIdForSpan(m, 20, g, i)).toBeNull()
    expect(markerIdForSpan(m, 20, g, 0)).toBe('a')
  })
  it('seção em cada tempo: -1 antes da primeira, a última segue até o áudio acabar', () => {
    const spans = sectionSpans([mk('a', 3), mk('b', 10)], 30, null)
    expect(sectionIndexAt(spans, 0)).toBe(-1); expect(sectionIndexAt(spans, 2.99)).toBe(-1)
    expect(sectionIndexAt(spans, 3)).toBe(0); expect(sectionIndexAt(spans, 9.99)).toBe(0); expect(sectionIndexAt(spans, 10)).toBe(1)
    expect(sectionIndexAt(spans, 31)).toBe(1); expect(sectionIndexAt(spans, NaN)).toBe(-1); expect(sectionIndexAt([], 5)).toBe(-1)
  })
  it('no início exato de uma seção, um erro de arredondamento não volta pra anterior', () => {
    const spans = sectionSpans([mk('a', 0), mk('b', 8.2)], 20, g)
    expect(sectionIndexAt(spans, 8.25 - 1e-9)).toBe(1)
  })
})

describe('início da seção: barra, pulso ou cru', () => {
  it('longe da barra encaixa no pulso mais perto do click, nunca fica fora do pulso', () => {
    expect(sectionSpans([mk('a', 0), mk('b', 5.3)], 20.1, g)).toEqual([{ index: 0, start: 0, end: 5.25, snappedTo: 'raw' }, { index: 1, start: 5.25, end: 20.1, snappedTo: 'pulse' }])
  })
  it('com grade de click todo início fora de 0:00 cai na barra (até 1/4 de compasso) ou no pulso', () => {
    const pulso = pulseSeconds(g), bar = barSeconds(g)
    for (let k = 1; k * 0.07 < 40; k++) {
      const t = k * 0.07
      const s = sectionSpans([mk('a', 0), mk('x', t)], 60, g)[1]
      expect(['bar', 'pulse']).toContain(s.snappedTo)
      const pulsos = (s.start - g.firstDownbeat) / pulso
      expect(Math.abs(pulsos - Math.round(pulsos))).toBeLessThanOrEqual(TOL)
      expect(Math.abs(s.start - t)).toBeLessThanOrEqual((s.snappedTo === 'bar' ? bar / 4 : pulso / 2) + TOL)
    }
  })
  it('6/8 a 180: o pulso é a colcheia do click', () => {
    const seis: SongGrid = { ...g, bpm: 180, signature: '6/8', firstDownbeat: 0 }
    const s = sectionSpans([mk('a', 0), mk('b', 0.9)], 10, seis)
    expect(s[1].snappedTo).toBe('pulse'); expectTime(s[1].start, 1)
  })
  it('sem fase ou com grade quebrada continua cru', () => {
    for (const grade of [{ ...g, source: 'bpm' as const }, { ...g, bpm: NaN }, null]) {
      expect(sectionSpans([mk('b', 5.3)], 20, grade)).toEqual([{ index: 0, start: 5.3, end: 20, snappedTo: 'raw' }])
    }
  })
  it('marca em 0:00 nunca mexe e diz se 0:00 já cai na barra ou no pulso', () => {
    expect(sectionSpans([mk('a', 0)], 10, { ...g, firstDownbeat: 0 })[0].snappedTo).toBe('bar')
    expect(sectionSpans([mk('a', 0)], 10, { ...g, firstDownbeat: 0.5 })[0].snappedTo).toBe('pulse')
    expect(sectionSpans([mk('a', 0)], 10, g)[0]).toEqual({ index: 0, start: 0, end: 10, snappedTo: 'raw' })
  })
  it('barra antes de 0:00 encaixa em 0, como o snapToBar', () => {
    const tarde: SongGrid = { ...g, firstDownbeat: 1.9 } // barras em -0,1; 1,9; pulsos em -0,1; 0,4; 0,9...
    const [s] = sectionSpans([mk('a', 0.3)], 10, tarde)
    expect(s).toMatchObject({ index: 0, start: 0, snappedTo: 'raw' }); expect(snapToBar(0.3, tarde)).toBe(0)
    expectTime(s.end, 9.9) // fim na barra de 9,9 (a 0,1 s do fim do áudio)
  })
  it('duas marcas no mesmo pulso: fica a de depois', () => {
    const m = [mk('a', 0), mk('b', 5.2), mk('c', 5.35)]
    expect(sectionSpans(m, 20, g)).toEqual([{ index: 0, start: 0, end: 5.25, snappedTo: 'raw' }, { index: 1, start: 5.25, end: 20, snappedTo: 'pulse' }])
    expect(markerIdForSpan(m, 20, g, 1)).toBe('c')
  })
})

describe('grade da música', () => {
  it('bpm salvo: faixa [30, 300], compasso desconhecido vira 4/4 assumido', () => {
    for (const bpm of [29.9, 300.1, NaN, Infinity, -90]) expect(gridFromBpm(bpm)).toBeNull()
    expect(gridFromBpm(30)!.bpm).toBe(30); expect(gridFromBpm(300)!.bpm).toBe(300)
    expect(gridFromBpm(100, null)).toMatchObject({ signature: '4/4', meterSource: 'padrao' })
    expect(gridFromBpm(100, '9/8' as unknown as TimeSignature)).toMatchObject({ signature: '4/4', meterSource: 'padrao' })
    expect(gridFromBpm(100, '12/8')).toMatchObject({ signature: '12/8', meterSource: 'salvo', countEvery: 1 })
  })
  it('click: o primeiro 1 vai pra dentro do primeiro compasso, pelo compasso que vale', () => {
    const base = { bpm: 120, firstPulse: 0.1, pulsesPerBar: 4 }
    expect(gridFromClick({ ...base, firstDownbeat: 5.3 })).toMatchObject({ source: 'click', countEvery: 1, signature: '4/4', meterSource: 'acento' })
    expect(gridFromClick({ ...base, firstDownbeat: 5.3 }).firstDownbeat).toBeCloseTo(1.3)
    expect(gridFromClick({ ...base, firstDownbeat: -0.5 }).firstDownbeat).toBeCloseTo(1.5)
    expect(gridFromClick({ ...base, pulsesPerBar: null, firstPulse: 2.6, firstDownbeat: null }).firstDownbeat).toBeCloseTo(0.6)
    expect(gridFromClick({ ...base, firstDownbeat: 5.3 }, '3/4').firstDownbeat).toBeCloseTo(0.8) // compasso de 1,5 s
    expect(gridFromClick({ ...base, firstDownbeat: 4 }).firstDownbeat).toBe(0)
  })
  it('click: pulsos do acento viram compasso; número desconhecido é 4/4 assumido', () => {
    expect(gridFromClick({ bpm: 180, firstPulse: 0, pulsesPerBar: 6, firstDownbeat: 0 })).toMatchObject({ signature: '6/8', meterSource: 'acento' })
    expect(gridFromClick({ bpm: 180, firstPulse: 0, pulsesPerBar: 9, firstDownbeat: 0 })).toMatchObject({ signature: '4/4', meterSource: 'padrao' })
  })
  it('click com fase quebrada não inventa o 1: grade recusada e aviso de sem grade', () => {
    const base = { bpm: 120, firstPulse: 0.3, pulsesPerBar: 4, firstDownbeat: 0.8 }
    const quebradas = [
      { ...base, firstDownbeat: NaN }, { ...base, firstDownbeat: Infinity }, { ...base, firstDownbeat: -Infinity },
      { ...base, firstPulse: NaN }, { ...base, firstPulse: Infinity }, { ...base, firstPulse: NaN, firstDownbeat: null },
    ]
    for (const a of quebradas) {
      const grid = gridFromClick(a)
      expect(grid.firstDownbeat).not.toBe(0)
      expect(sanitizeGrid(grid)).toBeNull(); expect(gridWarning(grid)).toBe('sem-grade')
      expect(snapToBar(4.6, grid)).toBe(4.6)
    }
  })
  it('click com BPM quebrado não vira NaN na fase e cai em sem grade', () => {
    const quebrada = gridFromClick({ bpm: NaN, firstPulse: 0.3, pulsesPerBar: 4, firstDownbeat: null })
    expect(Number.isNaN(quebrada.firstDownbeat)).toBe(false)
    expect(sanitizeGrid(quebrada)).toBeNull(); expect(gridWarning(quebrada)).toBe('sem-grade')
  })
})

describe('compasso manual', () => {
  it('troca só o compasso: BPM, fase e origem ficam', () => {
    expect(withMeter(gridFromBpm(100)!, '12/8', 3)).toEqual({ bpm: 100, firstDownbeat: 0, signature: '12/8', countEvery: 3, source: 'bpm', meterSource: 'manual' })
  })
  it('reler o click sem compasso manual antes fica com o que o click leu', () => {
    const lida = gridFromClick({ bpm: 96, firstPulse: 0.4, pulsesPerBar: 4, firstDownbeat: 0.4 })
    expect(keepManualMeter(lida, null)).toEqual(lida)
    expect(keepManualMeter(lida, gridFromBpm(80, '3/4'))).toEqual(lida)
  })
  it('reler o click com compasso manual: BPM e fase novos, compasso do usuário', () => {
    const lida = gridFromClick({ bpm: 96, firstPulse: 0.4, pulsesPerBar: 4, firstDownbeat: 0.4 })
    expect(keepManualMeter(lida, withMeter(g, '3/4', 1))).toEqual({ ...lida, signature: '3/4', countEvery: 1, meterSource: 'manual' })
  })
})

describe('fase dentro do primeiro compasso', () => {
  it('trocar o compasso traz o 1 pra dentro do compasso novo sem mexer nas barras', () => {
    const tarde: SongGrid = { ...g, firstDownbeat: 1.9 } // 4/4 a 120: compasso de 2 s
    const tres = withMeter(tarde, '3/4', 1) // compasso de 1,5 s: o 1 em 1,9 é o mesmo do 0,4
    expectTime(tres.firstDownbeat, 0.4)
    expect(barIndexAt(0, tres)).toBe(-1); expect(barIndexAt(0.3, tres)).toBe(-1); expect(barIndexAt(0.4, tres)).toBe(0)
    expectTime(nearestBarLine(1.8, tres), 1.9)
    expectTime(keepManualMeter(tarde, withMeter(g, '3/4', 1)).firstDownbeat, 0.4)
  })
  it('grade de fora com o 1 lá na frente volta pro primeiro compasso', () => {
    expect(sanitizeGrid({ ...g, firstDownbeat: 500 })!.firstDownbeat).toBe(0) // 250 compassos de 2 s
    expectTime(sanitizeGrid({ ...g, firstDownbeat: 501.3 })!.firstDownbeat, 1.3)
    expect(sanitizeGrid({ ...g, firstDownbeat: 0.97 })!.firstDownbeat).toBe(0.97) // já dentro: o número não muda
  })
  it('o compasso de 0:00 em diante nunca passa da anacruse (-1)', () => {
    for (const sig of TIME_SIGNATURES) {
      for (const fd of [0, 0.3, 1.9, 7.7, 123.4, 599.99]) {
        const s = sanitizeGrid({ ...g, bpm: 72.5, signature: sig, firstDownbeat: fd })!
        expect(barIndexAt(0, s)).toBeGreaterThanOrEqual(-1)
        for (const outro of TIME_SIGNATURES) expect(barIndexAt(0, withMeter(s, outro, 3))).toBeGreaterThanOrEqual(-1)
      }
    }
  })
})

describe('aviso e sanitização', () => {
  it('compasso salvo ou manual não avisa; grade quebrada é sem grade', () => {
    expect(gridWarning({ ...g, meterSource: 'salvo' })).toBeNull(); expect(gridWarning({ ...g, meterSource: 'manual' })).toBeNull()
    expect(gridWarning({ ...g, bpm: NaN })).toBe('sem-grade'); expect(gridWarning({ ...g, bpm: 400 })).toBe('sem-grade')
  })
  it('recusa o que não é grade', () => {
    for (const raw of [null, undefined, 'grade', 120, [], {}]) expect(sanitizeGrid(raw)).toBeNull()
    for (const patch of [{ bpm: '120' }, { bpm: 29 }, { firstDownbeat: -0.1 }, { firstDownbeat: Infinity }, { countEvery: 2 }, { meterSource: 'auto' }, { signature: undefined }]) {
      expect(sanitizeGrid({ ...g, ...patch })).toBeNull()
    }
  })
  it('devolve uma grade nova só com os campos conhecidos; contar de 3 em 3 só vale no composto', () => {
    const limpa = sanitizeGrid({ ...g, extra: 1 })
    expect(limpa).toStrictEqual(g); expect(limpa).not.toBe(g)
    expect(sanitizeGrid({ ...g, countEvery: 3 })!.countEvery).toBe(1)
    expect(sanitizeGrid({ ...g, signature: '6/8', countEvery: 3 })!.countEvery).toBe(3)
  })
})

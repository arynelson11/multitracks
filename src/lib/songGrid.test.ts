import { describe, expect, it } from 'vitest'
import type { Marker } from '../types'
import { TIME_SIGNATURES, countPulses, displayBpmFromPulseBpm, pulsesPerBar, type SongGrid, type TimeSignature } from './stageContracts'
import {
  barIndexAt, barSeconds, gridFromBpm, gridFromClick, gridWarning, keepManualMeter, markerIdForSpan, nearestBarLine,
  pulseSeconds, sanitizeGrid, sectionIndexAt, sectionSpans, snapToBar, withMeter,
} from './songGrid'
import { planTransition } from './sectionTransition'

/** Tempo exato a menos de arredondamento: tolerância de 1 microssegundo. */
const TOL = 1e-6
function expectTime(got: number, want: number) {
  expect(got).toBeGreaterThanOrEqual(want - TOL); expect(got).toBeLessThanOrEqual(want + TOL)
}

// Valores literais do plano (Tarefa 2).
const g: SongGrid = { bpm: 120, firstDownbeat: 0.25, signature: '4/4', countEvery: 1, source: 'click', meterSource: 'acento' }
it('barras e encaixe', () => {
  expect(barSeconds(g)).toBe(2); expectTime(nearestBarLine(4.1, g), 4.25)
  expectTime(snapToBar(4.6, g), 4.25)   // a 0,35 s da barra: encaixa (limite 0,5 s)
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
  expect(gridFromClick({ bpm: 90, subdivision: 1, compound: false, firstPulse: 0.3, pulsesPerBar: 3, firstDownbeat: 0.97 })).toMatchObject({ signature: '3/4', meterSource: 'acento' })
  expect(gridFromClick({ bpm: 90, subdivision: 1, compound: false, firstPulse: 0.3, pulsesPerBar: null, firstDownbeat: null })).toMatchObject({ signature: '4/4', meterSource: 'padrao' })
  expect(gridFromClick({ bpm: 90, subdivision: 1, compound: false, firstPulse: 0.3, pulsesPerBar: 3, firstDownbeat: 0.97 }, '6/8')).toMatchObject({ signature: '6/8', meterSource: 'salvo' })
})
it('compasso manual sobrevive a reler o click', () => expect(keepManualMeter(g, withMeter(g, '6/8', 3))).toMatchObject({ signature: '6/8', countEvery: 3, meterSource: 'manual', bpm: 240 })) // 6/8 conta colcheias: semínima 120 = 240 colcheias
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
    expectTime(pulseSeconds(seisPorOito), 1 / 3); expectTime(barSeconds(seisPorOito), 2)
  })
  it('índice do compasso conta a partir do primeiro 1; antes dele é a anacruse (-1)', () => {
    expect(barIndexAt(0.25, g)).toBe(0); expect(barIndexAt(2.2, g)).toBe(0); expect(barIndexAt(2.25, g)).toBe(1)
    expect(barIndexAt(0.1, g)).toBe(-1); expect(barIndexAt(16.25, g)).toBe(8)
  })
  it('barra mais perto antes do primeiro 1 continua na mesma grade', () => {
    expectTime(nearestBarLine(0.1, g), 0.25); expectTime(nearestBarLine(-1.6, g), -1.75)
  })
})

describe('encaixe', () => {
  it('nunca devolve tempo negativo: barra antes de 0:00 encaixa em 0', () => {
    const tarde: SongGrid = { ...g, firstDownbeat: 1.9 } // barras em -0,1; 1,9; 3,9...
    expect(snapToBar(0.3, tarde)).toBe(0); expect(snapToBar(-1, g)).toBe(0)
  })
  it('exatamente a 1/4 de compasso ainda encaixa', () => {
    expectTime(snapToBar(4.75, g), 4.25); expect(snapToBar(4.76, g)).toBe(4.76)
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
  it('áudio que acaba antes do primeiro 1: barra e pulso depois do fim, último pulso antes de 0:00, a marca vai pra 0:00', () => {
    expect(sectionSpans([mk('a', 0.2)], 0.22, g)).toEqual([{ index: 0, start: 0, end: 0.22, snappedTo: 'raw' }])
  })
  it('duas marcas no mesmo pulso: fica a de depois', () => {
    const m = [mk('a', 0), mk('b', 5.2), mk('c', 5.35)]
    expect(sectionSpans(m, 20, g)).toEqual([{ index: 0, start: 0, end: 5.25, snappedTo: 'raw' }, { index: 1, start: 5.25, end: 20, snappedTo: 'pulse' }])
    expect(markerIdForSpan(m, 20, g, 1)).toBe('c')
  })
})

describe('música longa: 10 min a 72,5 BPM', () => {
  const DUR = 600
  const BPM = 72.5
  const pulso = 60 / BPM
  it('barra, encaixe e compasso com erro 0 contra a conta direta (fase + k compassos)', () => {
    for (const signature of TIME_SIGNATURES) {
      const bar = (60 / BPM) * pulsesPerBar(signature)
      for (const fd of [0, 0.37, bar / 2, bar - 0.01]) {
        const grid: SongGrid = { bpm: BPM, firstDownbeat: fd, signature, countEvery: 1, source: 'click', meterSource: 'acento' }
        for (let k = 0; fd + k * bar < DUR; k++) {
          const direto = fd + k * bar
          for (const off of [-0.24, -0.1, 0, 0.1, 0.24]) {
            const t = direto + off * bar
            if (t <= 0 || t >= DUR) continue
            expect(nearestBarLine(t, grid)).toBe(direto); expect(snapToBar(t, grid)).toBe(direto)
          }
          expect(barIndexAt(direto, grid)).toBe(k)
        }
        const marcas: Marker[] = []
        for (let k = 0; fd + k * bar + 0.2 * bar < DUR; k++) marcas.push(mk(`c${k}`, fd + k * bar + 0.2 * bar))
        const spans = sectionSpans(marcas, DUR, grid)
        expect(spans).toHaveLength(marcas.length)
        spans.forEach((s, k) => { expect(s.start).toBe(fd + k * bar); expect(s.snappedTo).toBe('bar') })
        expect(spans[spans.length - 1].end).toBeLessThanOrEqual(DUR)
      }
    }
  })
  it('início no pulso com erro 0 contra a conta direta (fase + j pulsos), até o fim do áudio', () => {
    for (const signature of TIME_SIGNATURES) {
      const bar = (60 / BPM) * pulsesPerBar(signature)
      for (const fd of [0, 0.37, bar / 2, bar - 0.01]) {
        const grid: SongGrid = { bpm: BPM, firstDownbeat: fd, signature, countEvery: 1, source: 'click', meterSource: 'acento' }
        const marcas: Marker[] = [mk('fim', DUR - 0.05), mk('quase', DUR - pulso / 2)]
        for (let j = 0; fd + (j + 0.3) * pulso < DUR; j++) marcas.push(mk(`p${j}`, fd + (j + 0.3) * pulso))
        const spans = sectionSpans(marcas, DUR, grid)
        expect(spans.length).toBeGreaterThan(0)
        for (const s of spans) {
          expect(s.snappedTo).not.toBe('raw')
          const passo = s.snappedTo === 'bar' ? bar : pulso
          expect(s.start).toBe(fd + Math.round((s.start - fd) / passo) * passo)
          expect(s.start).toBeLessThan(DUR)
        }
      }
    }
  })
})

describe('grade da música', () => {
  it('bpm salvo: faixa [30, 300], compasso desconhecido vira 4/4 assumido', () => {
    for (const bpm of [29.9, 300.1, NaN, Infinity, -90]) expect(gridFromBpm(bpm)).toBeNull()
    expect(gridFromBpm(30)!.bpm).toBe(30); expect(gridFromBpm(300)!.bpm).toBe(300)
    expect(gridFromBpm(100, null)).toMatchObject({ signature: '4/4', meterSource: 'padrao' })
    expect(gridFromBpm(100, '9/8' as unknown as TimeSignature)).toMatchObject({ signature: '4/4', meterSource: 'padrao' })
    expect(gridFromBpm(100, '12/8')).toMatchObject({ bpm: 200, signature: '12/8', meterSource: 'salvo', countEvery: 3 })
  })
  it('click: o primeiro 1 vai pra dentro do primeiro compasso, pelo compasso que vale', () => {
    const base = { bpm: 120, subdivision: 1 as const, compound: false, firstPulse: 0.1, pulsesPerBar: 4 }
    expect(gridFromClick({ ...base, firstDownbeat: 5.3 })).toMatchObject({ source: 'click', countEvery: 1, signature: '4/4', meterSource: 'acento' })
    expectTime(gridFromClick({ ...base, firstDownbeat: 5.3 }).firstDownbeat, 1.3)
    expectTime(gridFromClick({ ...base, firstDownbeat: -0.5 }).firstDownbeat, 1.5)
    expectTime(gridFromClick({ ...base, pulsesPerBar: null, firstPulse: 2.6, firstDownbeat: null }).firstDownbeat, 0.6)
    expectTime(gridFromClick({ ...base, firstDownbeat: 5.3 }, '3/4').firstDownbeat, 0.8) // compasso de 1,5 s
    expect(gridFromClick({ ...base, firstDownbeat: 4 }).firstDownbeat).toBe(0)
  })
  it('click: pulsos do acento viram compasso; número desconhecido é 4/4 assumido', () => {
    expect(gridFromClick({ bpm: 90, subdivision: 3, compound: true, firstPulse: 0, pulsesPerBar: 6, firstDownbeat: 0 })).toMatchObject({ bpm: 180, signature: '6/8', meterSource: 'acento' })
    expect(gridFromClick({ bpm: 180, subdivision: 1, compound: false, firstPulse: 0, pulsesPerBar: 9, firstDownbeat: 0 })).toMatchObject({ signature: '4/4', meterSource: 'padrao' })
  })
  it('click com fase quebrada não inventa o 1: grade recusada e aviso de sem grade', () => {
    const base = { bpm: 120, subdivision: 1 as const, compound: false, firstPulse: 0.3, pulsesPerBar: 4, firstDownbeat: 0.8 }
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
    const quebrada = gridFromClick({ bpm: NaN, subdivision: 1, compound: false, firstPulse: 0.3, pulsesPerBar: 4, firstDownbeat: null })
    expect(Number.isNaN(quebrada.firstDownbeat)).toBe(false)
    expect(sanitizeGrid(quebrada)).toBeNull(); expect(gridWarning(quebrada)).toBe('sem-grade')
  })
})

describe('grade do click com subdivisão (T3: BPM na semínima)', () => {
  // A leitura dá o BPM sempre na semínima (Ruling T3-BPM) e a subdivisão. A grade conta pulsos
  // do compasso: tempos no simples, colcheias no 6/8 e no 12/8 (6 e 12 pulsos, o dobro da
  // semínima), com a contagem de 3 em 3, que é o tempo do composto.
  const leitura = (o: Partial<Parameters<typeof gridFromClick>[0]>) => ({ bpm: 66, subdivision: 1 as const, compound: false, firstPulse: 0, pulsesPerBar: null, firstDownbeat: null, ...o })
  it('4/4 em colcheias: a grade e a contagem ficam em semínimas, o 1 no primeiro tempo', () => {
    const grid = gridFromClick(leitura({ bpm: 66, subdivision: 2, firstPulse: 0.45 }))
    expect(grid).toMatchObject({ bpm: 66, signature: '4/4', countEvery: 1, meterSource: 'padrao' })
    expectTime(grid.firstDownbeat, 0.45); expect(countPulses(grid.signature, grid.countEvery)).toBe(4); expectTime(barSeconds(grid), 4 * 60 / 66)
  })
  it('6/8 em colcheias e em pontuada dão a mesma grade: colcheias, contagem de 2 tempos', () => {
    for (const subdivision of [3, 1] as const) {
      const grid = gridFromClick(leitura({ bpm: 90, subdivision, compound: true, pulsesPerBar: 6, firstDownbeat: 1.2 }))
      expect(grid).toMatchObject({ bpm: 180, signature: '6/8', countEvery: 3, meterSource: 'acento' })
      expect(countPulses(grid.signature, grid.countEvery)).toBe(2); expectTime(barSeconds(grid), 2); expectTime(grid.firstDownbeat, 1.2)
    }
  })
  it('12/8 em pontuada: 4 tempos de contagem num compasso de 12 colcheias', () => {
    const grid = gridFromClick(leitura({ bpm: 75, compound: true, pulsesPerBar: 12, firstDownbeat: 0.3 }))
    expect(grid).toMatchObject({ bpm: 150, signature: '12/8', countEvery: 3 })
    expect(countPulses(grid.signature, grid.countEvery)).toBe(4); expectTime(barSeconds(grid), 4.8)
  })
  it('leitura composta sem compasso lido nem salvo: 6/8 assumido, não 4/4', () => {
    expect(gridFromClick(leitura({ bpm: 99, subdivision: 3, compound: true }))).toMatchObject({ bpm: 198, signature: '6/8', countEvery: 3, meterSource: 'padrao' })
  })
  it('semicolcheias (subdivisão 4): a grade fica na semínima', () => {
    expect(gridFromClick(leitura({ bpm: 66, subdivision: 4, firstPulse: 0.33 }))).toMatchObject({ bpm: 66, signature: '4/4', countEvery: 1 })
  })
  it('compasso salvo diferente da leitura: a grade converte sem triplicar nem dividir errado', () => {
    // Leitura feita sem o 6/8 (a T27 deve passar o compasso salvo, mas a grade não pode quebrar).
    expect(gridFromClick(leitura({ bpm: 66, subdivision: 2 }), '6/8')).toMatchObject({ bpm: 132, signature: '6/8', countEvery: 3 })
    expect(gridFromClick(leitura({ bpm: 60 }), '6/8')).toMatchObject({ bpm: 180, signature: '6/8', countEvery: 3 })
    // Leitura em 6/8 de um 3/4 em colcheias: o BPM já é a semínima, que é o tempo do 3/4.
    const tres = gridFromClick(leitura({ bpm: 70, subdivision: 3, compound: true, pulsesPerBar: 6 }), '3/4')
    expect(tres).toMatchObject({ signature: '3/4', countEvery: 1, meterSource: 'salvo' }); expectTime(tres.bpm, 70)
  })
})

describe('compasso manual', () => {
  it('troca só o compasso: BPM exibido, fase e origem ficam (no composto a grade conta colcheias)', () => {
    expect(withMeter(gridFromBpm(100)!, '12/8', 3)).toEqual({ bpm: 200, firstDownbeat: 0, signature: '12/8', countEvery: 3, source: 'bpm', meterSource: 'manual' })
  })
  it('reler o click sem compasso manual antes fica com o que o click leu', () => {
    const lida = gridFromClick({ bpm: 96, subdivision: 1, compound: false, firstPulse: 0.4, pulsesPerBar: 4, firstDownbeat: 0.4 })
    expect(keepManualMeter(lida, null)).toEqual(lida)
    expect(keepManualMeter(lida, gridFromBpm(80, '3/4'))).toEqual(lida)
  })
  it('reler o click com compasso manual: BPM e fase novos, compasso do usuário', () => {
    const lida = gridFromClick({ bpm: 96, subdivision: 1, compound: false, firstPulse: 0.4, pulsesPerBar: 4, firstDownbeat: 0.4 })
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

describe('BPM da música na semínima (Ruling T3-BPM)', () => {
  // A grade conta colcheias no 6/8 e no 12/8; o BPM exibido e salvo (bpm_exact) é a semínima.
  const bpmOf = (grid: SongGrid) => displayBpmFromPulseBpm(grid.bpm, grid.signature)
  it('gridFromBpm(78, "6/8"): compasso de 2,308 s contando 2 tempos', () => {
    const fe = gridFromBpm(78, '6/8')!
    expect(fe).toMatchObject({ bpm: 156, signature: '6/8', countEvery: 3, source: 'bpm', meterSource: 'salvo' })
    expect(Math.abs(barSeconds(fe) - 2.308)).toBeLessThan(0.001); expect(countPulses(fe.signature, fe.countEvery)).toBe(2)
    expect(bpmOf(fe)).toBe(78)
    const doze = gridFromBpm(50, '12/8')!
    expect(doze).toMatchObject({ bpm: 100, countEvery: 3 }); expectTime(barSeconds(doze), 7.2); expect(countPulses(doze.signature, doze.countEvery)).toBe(4)
    expect(gridFromBpm(78, '4/4')).toMatchObject({ bpm: 78, countEvery: 1 }); expectTime(barSeconds(gridFromBpm(78, '4/4')!), 4 * 60 / 78)
  })
  it('o plano do pulo com gridFromBpm(78, "6/8") conta 2 tempos pontuados', () => {
    const bar = 6 * 60 / 156
    const spans = [{ index: 0, start: 0, end: 4 * bar }, { index: 1, start: 4 * bar, end: 8 * bar }]
    const p = planTransition({ spans, grid: gridFromBpm(78, '6/8'), position: 1, intent: { target: 1, plays: 1 } })!
    expect(p.countTotal).toBe(2); expect(p.countLabels).toEqual([1, 2]); expect(p.countTimes).toHaveLength(2)
    expectTime(p.countTimes[1] - p.countTimes[0], 3 * 60 / 156)
  })
  it('4/4 -> 6/8 -> 4/4 pelo withMeter volta ao mesmo BPM e ao mesmo compasso; a semínima não muda', () => {
    const seis = withMeter(g, '6/8', 3)
    expect(seis).toMatchObject({ bpm: 240, signature: '6/8', countEvery: 3 }); expect(bpmOf(seis)).toBe(120)
    expectTime(pulseSeconds(seis) * 2, pulseSeconds(g)); expectTime(barSeconds(seis), 1.5)
    const volta = withMeter(seis, '4/4', 1)
    expect(volta).toEqual({ ...g, meterSource: 'manual' }); expect(barSeconds(volta)).toBe(barSeconds(g))
    // Entre compostos e entre simples a grade não muda de unidade.
    expect(withMeter(seis, '12/8', 3).bpm).toBe(240); expect(withMeter(g, '3/4', 1).bpm).toBe(120)
  })
  it('ida e volta do compasso não tira o 1 do lugar (adiado D4): 4/4 -> 6/8 -> 4/4 e 4/4 -> 3/4 -> 4/4 com o 1 em 1,7 s', () => {
    // 4/4 a 120 (compasso de 2 s) com o 1 no último quarto do primeiro compasso.
    const lida: SongGrid = { bpm: 120, firstDownbeat: 1.7, signature: '4/4', countEvery: 1, source: 'click', meterSource: 'acento' }
    for (const [ida, conta] of [['6/8', 3], ['3/4', 1]] as const) {
      const meio = withMeter(lida, ida, conta)
      // No compasso mais curto o 1 vai pra dentro do 1º compasso (as barras são as mesmas)...
      expect(meio.firstDownbeat).toBeLessThan(barSeconds(meio))
      expectTime(meio.firstDownbeat, 1.7 - barSeconds(meio))
      // ...e a âncora guarda o 1 de antes, inclusive pelo repertório (sanitizeGrid).
      expect(meio.anchor).toBe(1.7)
      const salvo = sanitizeGrid(JSON.parse(JSON.stringify(meio)))!
      expect(salvo).toStrictEqual(meio)
      const volta = withMeter(salvo, '4/4', 1)
      expect(volta.firstDownbeat).toBe(1.7)
      expect(volta.anchor).toBeUndefined()
      expect(volta).toEqual({ ...lida, meterSource: 'manual' })
    }
    // Duas trocas seguidas pelo curto (4/4 -> 3/4 -> 6/8 -> 4/4) também voltam.
    expect(withMeter(withMeter(withMeter(lida, '3/4', 1), '6/8', 3), '4/4', 1).firstDownbeat).toBe(1.7)
    // O 1 que já cabe no compasso novo não ganha âncora.
    expect(withMeter({ ...lida, firstDownbeat: 0.25 }, '3/4', 1).anchor).toBeUndefined()
  })
  it('âncora que não cai numa barra da grade (registro mexido) sai e o 1 fica', () => {
    const base = { bpm: 120, firstDownbeat: 0.2, signature: '3/4', countEvery: 1, source: 'click', meterSource: 'manual' }
    expect(sanitizeGrid({ ...base, anchor: 1.7 })!.anchor).toBe(1.7)
    for (const anchor of [1.6, -1.3, NaN, Infinity, '1.7', null]) {
      const limpa = sanitizeGrid({ ...base, anchor })!
      expect(limpa.firstDownbeat).toBe(0.2)
      expect('anchor' in limpa).toBe(false)
    }
  })
  it('reler o click em 4/4 com o 6/8 manual: a grade nova também conta colcheias', () => {
    const lida = gridFromClick({ bpm: 78, subdivision: 2, compound: false, firstPulse: 0.001, pulsesPerBar: null, firstDownbeat: null })
    const manual = withMeter(gridFromBpm(78)!, '6/8', 3)
    const relida = keepManualMeter(lida, manual)
    expect(relida).toMatchObject({ bpm: 156, signature: '6/8', countEvery: 3, meterSource: 'manual', source: 'click' })
    expect(Math.abs(barSeconds(relida) - 2.308)).toBeLessThan(0.001)
  })
  it('7/8 conta colcheias (Ruling D1-denominador): a grade é o dobro do BPM salvo, contando os 7 pulsos', () => {
    const sete = gridFromBpm(70, '7/8')!
    expect(sete).toMatchObject({ bpm: 140, signature: '7/8', countEvery: 1 }); expectTime(barSeconds(sete), 3)
    expect(bpmOf(sete)).toBe(70); expect(countPulses(sete.signature, sete.countEvery)).toBe(7)
    const ida = withMeter(g, '7/8', 1)
    expect(ida.bpm).toBe(240); expect(bpmOf(ida)).toBe(120)
    expect(withMeter(ida, '4/4', 1)).toEqual({ ...g, meterSource: 'manual' })
    expect(withMeter(ida, '6/8', 3).bpm).toBe(240) // entre compassos de colcheia a grade não muda de unidade
  })
  it('a faixa [30, 300] vale no BPM exibido, não nas colcheias do composto', () => {
    expect(gridFromBpm(300, '6/8')!.bpm).toBe(600); expect(gridFromBpm(30, '12/8')!.bpm).toBe(60)
    for (const bpm of [29.9, 300.1]) expect(gridFromBpm(bpm, '6/8')).toBeNull()
    const seis: SongGrid = { ...g, signature: '6/8', countEvery: 3 }
    for (const bpm of [60, 500, 600]) expect(sanitizeGrid({ ...seis, bpm })).toMatchObject({ bpm })
    for (const bpm of [59, 601]) expect(sanitizeGrid({ ...seis, bpm })).toBeNull()
    expect(snapToBar(4.6, { ...seis, bpm: 480, firstDownbeat: 0 })).toBe(4.5) // compasso de 0,75 s: grade usável
    expect(gridWarning({ ...seis, bpm: 50 })).toBe('sem-grade')
    expect(gridWarning({ ...seis, bpm: 500 })).toBeNull()
  })
})

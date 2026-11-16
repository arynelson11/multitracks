import { describe, expect, it } from 'vitest'
import type { Marker } from '../types'
import { sectionSpans } from './songGrid'
import type { ArmIntent, SectionSpan, SongGrid } from './stageContracts'
import { GUIDE_MUTE_ON_JUMP, MIN_LEAD, planTransition } from './sectionTransition'

// Grade de referência: 120 pulsos por minuto em 4/4, o 1 em 0:00 (pulso 0,5 s, compasso 2 s).
const grid: SongGrid = { bpm: 120, firstDownbeat: 0, signature: '4/4', countEvery: 1, source: 'click', meterSource: 'acento' }
const spans = [{ index: 0, start: 0, end: 8 }, { index: 1, start: 8, end: 16 }, { index: 2, start: 16, end: 30 }]
const marks = (...times: number[]): Marker[] => times.map((time, i) => ({ id: `m${i}`, time, label: `S${i}` }))

describe('constantes', () => {
  it('folga mínima de 50 ms e guia calada ligada (R-31)', () => {
    expect(MIN_LEAD).toBe(0.05)
    expect(GUIDE_MUTE_ON_JUMP).toBe(true)
  })
})

describe('instante, alvo e contagem', () => {
  it('contagem inteira no último compasso', () => expect(planTransition({ spans, grid, position: 5, intent: { target: 0, plays: 1 } })).toEqual({
    from: 0, to: 0, switchAt: 8, targetOffset: 0, countTimes: [6, 6.5, 7, 7.5], countLabels: [1, 2, 3, 4], countTotal: 4, guideMuteFrom: 6, barsLeft: 2 }))

  it('armou tarde: contagem curta com o número real', () => {
    const p = planTransition({ spans, grid, position: 6.8, intent: { target: 2, plays: 1 } })!
    expect(p.countTimes).toEqual([7, 7.5]); expect(p.countLabels).toEqual([3, 4]); expect(p.switchAt).toBe(8)
  })

  it('a guia cala a partir do primeiro bipe que ainda vai soar', () => {
    const p = planTransition({ spans, grid, position: 6.8, intent: { target: 2, plays: 1 } })!
    expect(p.guideMuteFrom).toBe(7); expect(p.countTotal).toBe(4); expect(p.targetOffset).toBe(16); expect(p.barsLeft).toBe(1)
  })

  it('armou depois do último tempo: sem bipe, guia livre, último compasso', () => expect(planTransition({ spans, grid, position: 7.6, intent: { target: 1, plays: 1 } })).toEqual({
    from: 0, to: 1, switchAt: 8, targetOffset: 8, countTimes: [], countLabels: [], countTotal: 4, guideMuteFrom: null, barsLeft: 1 }))

  it('armar a menos da folga mínima mira o fim da seção seguinte', () => expect(planTransition({ spans, grid, position: 7.96, intent: { target: 0, plays: 1 } })!.switchAt).toBe(16))

  it('bipe a menos da folga mínima não dá tempo de agendar: fica de fora', () => {
    // Armar no início do último compasso (preflight, achado 28): o bipe do 1 já ficou pra trás da folga.
    const p = planTransition({ spans, grid, position: 5.97, intent: { target: 1, plays: 1 } })!
    expect(p.countTimes).toEqual([6.5, 7, 7.5]); expect(p.countLabels).toEqual([2, 3, 4]); expect(p.guideMuteFrom).toBe(6.5)
  })

  it('a folga vem do parâmetro e o bipe exatamente na folga fica', () => {
    expect(planTransition({ spans, grid, position: 7.96, intent: { target: 0, plays: 1 }, minLead: 0 })!.switchAt).toBe(8)
    const p = planTransition({ spans, grid, position: 6, intent: { target: 0, plays: 1 }, minLead: 0 })!
    expect(p.countTimes).toEqual([6, 6.5, 7, 7.5]); expect(p.countLabels).toEqual([1, 2, 3, 4])
  })

  it('6/8 contando 2', () => {
    const p = planTransition({ spans, grid: { ...grid, bpm: 180, signature: '6/8', countEvery: 3 }, position: 1, intent: { target: 2, plays: 1 } })!
    expect(p.countTimes).toEqual([6, 7]); expect(p.countTotal).toBe(2)
  })

  it('12/8 conta 4 tempos pontuados', () => {
    const g12: SongGrid = { ...grid, bpm: 240, signature: '12/8', countEvery: 3 } // colcheia 0,25 s, tempo 0,75 s, compasso 3 s
    const p = planTransition({ spans: [{ index: 0, start: 0, end: 12 }, { index: 1, start: 12, end: 24 }], grid: g12, position: 8, intent: { target: 1, plays: 1 } })!
    expect(p).toMatchObject({ switchAt: 12, countTimes: [9, 9.75, 10.5, 11.25], countLabels: [1, 2, 3, 4], countTotal: 4, barsLeft: 2 })
  })

  it('6/8 contado pulso a pulso (escolha do EDITAR) dá 6 bipes', () => {
    const p = planTransition({ spans, grid: { ...grid, bpm: 180, signature: '6/8', countEvery: 1 }, position: 5, intent: { target: 2, plays: 1 } })!
    expect(p.countTotal).toBe(6); expect(p.countLabels).toEqual([1, 2, 3, 4, 5, 6])
    p.countTimes.forEach((t, i) => expect(t).toBeCloseTo(6 + i / 3, 9))
  })

  it('3 em 3 fora do composto vale 1 (a grade passa pelo sanitizeGrid)', () => {
    const p = planTransition({ spans, grid: { ...grid, countEvery: 3 }, position: 5, intent: { target: 0, plays: 1 } })!
    expect(p.countTimes).toEqual([6, 6.5, 7, 7.5]); expect(p.countTotal).toBe(4)
  })

  it('BPM salvo sem fase: contagem ancorada no 1 de destino', () => expect(planTransition({ spans, grid: { ...grid, source: 'bpm', bpm: 100 }, position: 5, intent: { target: 0, plays: 1 } })!.countTimes).toEqual([5.6, 6.2, 6.8, 7.4]))

  it('antes da primeira marca vai pro início da primeira', () => {
    const later = [{ index: 0, start: 4, end: 8 }, { index: 1, start: 8, end: 16 }]
    expect(planTransition({ spans: later, grid, position: 1, intent: { target: 1, plays: 1 } })).toEqual({
      from: -1, to: 1, switchAt: 4, targetOffset: 8, countTimes: [2, 2.5, 3, 3.5], countLabels: [1, 2, 3, 4], countTotal: 4, guideMuteFrom: 2, barsLeft: 2 })
  })
})

describe('loop, REPETIR e infinito (regras da T4)', () => {
  it('loop infinito da própria seção não conta nem cala a guia', () => expect(planTransition({ spans, grid, position: 5, intent: { target: 0, plays: 'infinite' } })).toEqual({
    from: 0, to: 0, switchAt: 8, targetOffset: 0, countTimes: [], countLabels: [], countTotal: 0, guideMuteFrom: null, barsLeft: 2 }))

  it('REPETIR N conta a cada volta', () => {
    const p = planTransition({ spans, grid, position: 5, intent: { target: 0, plays: 3 } })!
    expect(p.countTimes).toEqual([6, 6.5, 7, 7.5]); expect(p.guideMuteFrom).toBe(6)
  })

  it('infinito em outra seção conta o primeiro pulo (as voltas seguintes são o loop da própria)', () => {
    const p = planTransition({ spans, grid, position: 5, intent: { target: 2, plays: 'infinite' } })!
    expect(p.countTimes).toEqual([6, 6.5, 7, 7.5]); expect(p.guideMuteFrom).toBe(6)
    expect(planTransition({ spans, grid, position: 20, intent: { target: 2, plays: 'infinite' } })!.countTimes).toEqual([])
  })
})

describe('sem grade', () => {
  const semGrade = { from: 0, to: 2, switchAt: 8, targetOffset: 16, countTimes: [], countLabels: [], countTotal: 0, guideMuteFrom: null, barsLeft: null }

  it('sem grade: marca crua, sem contagem', () => expect(planTransition({ spans, grid: null, position: 5, intent: { target: 2, plays: 1 } })).toEqual(semGrade))

  it('grade que o sanitizeGrid recusa conta como sem grade', () => {
    const quebradas: SongGrid[] = [
      { ...grid, bpm: 500 }, { ...grid, bpm: 0 }, { ...grid, bpm: Infinity }, { ...grid, firstDownbeat: -1 }, { ...grid, firstDownbeat: NaN },
      { ...grid, signature: '2/4' as SongGrid['signature'] }, { ...grid, countEvery: 2 as SongGrid['countEvery'] },
    ]
    for (const g of quebradas) expect(planTransition({ spans, grid: g, position: 5, intent: { target: 2, plays: 1 } })).toEqual(semGrade)
  })

  it('nunca NaN com grade quebrada', () => {
    const p = planTransition({ spans, grid: { ...grid, bpm: NaN }, position: 5, intent: { target: 1, plays: 1 } })!
    expect(Object.values(p).flat().some(Number.isNaN)).toBe(false)
  })
})

describe('sem plano', () => {
  it('alvo fora da lista ou lista vazia', () => {
    for (const target of [3, -1, 1.5, NaN]) expect(planTransition({ spans, grid, position: 5, intent: { target, plays: 1 } })).toBeNull()
    expect(planTransition({ spans: [], grid, position: 5, intent: { target: 0, plays: 1 } })).toBeNull()
  })

  it('posição que não é número', () => {
    for (const position of [NaN, Infinity]) expect(planTransition({ spans, grid, position, intent: { target: 0, plays: 1 } })).toBeNull()
  })

  it('depois do fim da última seção não há barra pra pular (sectionIndexAt continua na última)', () => {
    // 30,3 s de áudio: a final termina na barra de 30 e o resto (0,3 s) fica depois dela.
    const s = sectionSpans(marks(0, 8, 16), 30.3, grid)
    expect(s[2].end).toBe(30)
    expect(planTransition({ spans: s, grid, position: 30.1, intent: { target: 2, plays: 1 } })).toBeNull()
    expect(planTransition({ spans: s, grid, position: 29.97, intent: { target: 0, plays: 1 } })).toBeNull() // fim a menos da folga
    expect(planTransition({ spans: s, grid: null, position: 30.1, intent: { target: 2, plays: 1 } })).toBeNull()
  })
})

describe('fim da seção final fora da grade (Ruling T2-contrato)', () => {
  it('termina na barra: o pulo é o fim da seção', () => {
    const p = planTransition({ spans, grid, position: 25, intent: { target: 2, plays: 1 } })!
    expect(p).toMatchObject({ from: 2, switchAt: 30, countTimes: [28, 28.5, 29, 29.5] })
  })

  it('repetir a final que termina no fim cru do áudio ancora na última barra', () => {
    // 30,7 s de áudio: a barra mais perto (30) fica a mais de 1/4 de compasso, então a final termina cru em 30,7.
    const s = sectionSpans(marks(0, 8, 16), 30.7, grid)
    expect(s[2]).toMatchObject({ end: 30.7, snappedTo: 'bar' })
    expect(planTransition({ spans: s, grid, position: 27, intent: { target: 2, plays: 1 } })).toEqual({
      from: 2, to: 2, switchAt: 30, targetOffset: 16, countTimes: [28, 28.5, 29, 29.5], countLabels: [1, 2, 3, 4], countTotal: 4, guideMuteFrom: 28, barsLeft: 2 })
    // Depois da última barra a final não tem mais onde pular no tempo.
    expect(planTransition({ spans: s, grid, position: 30.1, intent: { target: 2, plays: 1 } })).toBeNull()
    // Na própria barra, sem folga: ainda é o último compasso (1, nunca 0 ou -0), sem bipe.
    expect(planTransition({ spans: s, grid, position: 30, intent: { target: 2, plays: 1 }, minLead: 0 })).toMatchObject({ switchAt: 30, countTimes: [], barsLeft: 1 })
  })

  it('áudio que acaba logo antes de uma barra também ancora na barra de dentro, com a fase da grade', () => {
    const g = { ...grid, firstDownbeat: 0.25 } // barras em 0,25 + 2j
    const s = sectionSpans(marks(0, 8.25, 16.25), 31.95, g) // a barra mais perto (32,25) fica depois do fim
    expect(s[2].end).toBe(31.95)
    expect(planTransition({ spans: s, grid: g, position: 27, intent: { target: 1, plays: 1 } })).toMatchObject({
      switchAt: 30.25, targetOffset: 8.25, countTimes: [28.25, 28.75, 29.25, 29.75], countLabels: [1, 2, 3, 4] })
  })

  it('final sem barra dentro ancora no último pulso; sem pulso dentro, o fim cru', () => {
    // Marca em 30,6 vai pro pulso 30,5 (a barra 30 fica a mais de 1/4); 31,8 s de áudio.
    const s = sectionSpans(marks(0, 8, 16, 30.6), 31.8, grid)
    expect(s[3]).toMatchObject({ start: 30.5, end: 31.8, snappedTo: 'pulse' })
    expect(planTransition({ spans: s, grid, position: 30.6, intent: { target: 3, plays: 1 } })).toMatchObject({ from: 3, switchAt: 31.5, countTimes: [31], countLabels: [4] })
    // Marca em 31,45 vai pro pulso 31,5: nenhuma barra nem pulso depois do início, o pulo fica no fim cru.
    const t = sectionSpans(marks(0, 8, 16, 31.45), 31.8, grid)
    expect(t[3]).toMatchObject({ start: 31.5, end: 31.8 })
    expect(planTransition({ spans: t, grid, position: 31.6, intent: { target: 0, plays: 1 } })).toMatchObject({ from: 3, switchAt: 31.8, countTimes: [], barsLeft: 1 })
  })

  it('sem fase (só BPM salvo) o fim cru continua sendo o pulo, com a contagem no 1 de destino', () => {
    const g: SongGrid = { ...grid, source: 'bpm' }
    const s = sectionSpans(marks(0, 8, 16), 30.7, g)
    const p = planTransition({ spans: s, grid: g, position: 27, intent: { target: 2, plays: 1 } })!
    expect(p.switchAt).toBe(30.7)
    expect(p.countTimes).toHaveLength(4); p.countTimes.forEach((t, i) => expect(t).toBeCloseTo(28.7 + i * 0.5, 9))
  })
})

describe('no tempo do click', () => {
  it('pulo e bipes caem no pulso da grade, também aos 10 minutos e com início encaixado no pulso', () => {
    const g: SongGrid = { ...grid, bpm: 72.5, firstDownbeat: 0.31 }
    const pulse = 60 / g.bpm
    const onPulse = (t: number) => Math.abs((t - g.firstDownbeat) / pulse - Math.round((t - g.firstDownbeat) / pulse)) * pulse < 1e-6
    // Marcas cruas espalhadas até ~10 min; as que ficam longe da barra (35,06 e 302,95) vão pro
    // pulso. Com 640,9 s de áudio a barra do fim passaria dele: a final termina cru, fora do pulso.
    const s = sectionSpans(marks(0, 35.06, 95.7, 302.95, 598.9), 640.9, g)
    expect(s.map((x) => x.snappedTo)).toEqual(['raw', 'pulse', 'bar', 'pulse', 'bar'])
    expect(s[4].end).toBe(640.9); expect(onPulse(640.9)).toBe(false)
    for (let from = 1; from < s.length; from++) {
      const p = planTransition({ spans: s, grid: g, position: s[from].start + 0.01, intent: { target: 0, plays: 1 } })!
      expect(onPulse(p.switchAt)).toBe(true)
      for (const t of p.countTimes) expect(onPulse(t)).toBe(true)
    }
  })

  it('nunca mexe no que recebe', () => {
    const frozenSpans = Object.freeze(spans.map((s) => Object.freeze({ ...s }))) as readonly SectionSpan[]
    const frozenGrid = Object.freeze({ ...grid })
    const intent: ArmIntent = Object.freeze({ target: 2, plays: 1 })
    expect(() => planTransition({ spans: frozenSpans, grid: frozenGrid, position: 5, intent })).not.toThrow()
    expect(frozenGrid).toEqual(grid)
  })
})

import { describe, expect, it } from 'vitest'
import type { TransitionView } from './stageContracts'
import { countState, transitionWaitText } from './transitionView'

const TRAVESSAO = String.fromCharCode(0x2014)

// Pulo armado pra Intro, contagem inteira de 4 no último compasso (passo 0,5 s), troca em 22 s.
const t: TransitionView = { from: 1, to: 0, kind: 'proxima', plays: 1, switchAt: 22, countTimes: [20, 20.5, 21, 21.5], countLabels: [1, 2, 3, 4], countTotal: 4, barsLeft: 1, committed: true, clickAudible: true, hasGrid: true }
// Armou tarde: só os tempos 3 e 4, mas o último compasso começou em 20.
const late: TransitionView = { ...t, countTimes: [21, 21.5], countLabels: [3, 4] }
// Sem contagem: loop infinito da própria seção.
const noCount: TransitionView = { ...t, from: 1, to: 1, kind: 'repete', plays: 'infinite', countTimes: [], countLabels: [], barsLeft: 3 }

describe('texto de espera do pulo', () => {
  const cases: [Partial<TransitionView>, number, string | null][] = [
    [{ hasGrid: false }, 10, 'no fim da seção'], [{ clickAudible: false }, 10, 'CLICK DESLIGADO'],
    [{ barsLeft: 3 }, 10, 'em 3 comp.'], [{}, 19.9, 'último comp.'], [{}, 20.6, null],
  ]
  it.each(cases)('texto de espera %#', (patch, now, text) => expect(transitionWaitText({ ...t, ...patch }, now)).toBe(text))

  it('prioridade: sem grade vence click desligado, que vence a contagem', () => {
    expect(transitionWaitText({ ...t, hasGrid: false, clickAudible: false }, 20.6)).toBe('no fim da seção')
    expect(transitionWaitText({ ...t, clickAudible: false }, 20.6)).toBe('CLICK DESLIGADO')
  })
  it('dois compassos ou mais contam; um ou nenhum é o último', () => {
    expect(transitionWaitText({ ...t, barsLeft: 2 }, 10)).toBe('em 2 comp.')
    expect(transitionWaitText({ ...t, barsLeft: 0 }, 10)).toBe('último comp.')
    expect(transitionWaitText(noCount, 10)).toBe('em 3 comp.')
  })
  it('nenhum texto com travessão', () => {
    const all = [
      transitionWaitText({ ...t, hasGrid: false }, 10), transitionWaitText({ ...t, clickAudible: false }, 10),
      transitionWaitText({ ...t, barsLeft: 3 }, 10), transitionWaitText(t, 19.9),
    ]
    for (const s of all) expect(s).not.toContain(TRAVESSAO)
  })
})

describe('estado da contagem pelo tempo ouvido', () => {
  it('bolinhas pelo tempo ouvido e contagem curta com o número real', () => {
    expect(countState(t, 20.6)).toMatchObject({ lit: [true, true, false, false], currentLabel: 2, counting: true })
    expect(countState(late, 21.2).lit).toEqual([false, false, true, false])
  })
  it('antes do primeiro bipe nada acende', () => {
    expect(countState(t, 19.9)).toEqual({ lit: [false, false, false, false], currentLabel: null, inLastBar: false, counting: false })
  })
  it('o bipe acende no instante exato em que é ouvido', () => {
    expect(countState(t, 20)).toMatchObject({ lit: [true, false, false, false], currentLabel: 1, counting: true })
    expect(countState(t, 21.5)).toMatchObject({ lit: [true, true, true, true], currentLabel: 4, inLastBar: true })
  })
  it('último compasso pelo primeiro tempo possível, mesmo com a contagem curta', () => {
    expect(countState(late, 19.99).inLastBar).toBe(false)
    expect(countState(late, 20.5)).toEqual({ lit: [false, false, false, false], currentLabel: null, inLastBar: true, counting: false })
    expect(countState(late, 21.6)).toMatchObject({ lit: [false, false, true, true], currentLabel: 4, counting: true })
  })
  it('6/8 contando 2: passo de um tempo pontuado', () => {
    const six: TransitionView = { ...t, switchAt: 8, countTimes: [7], countLabels: [2], countTotal: 2 }
    expect(countState(six, 6.1)).toMatchObject({ lit: [false, false], inLastBar: true, counting: false })
    expect(countState(six, 7.2)).toMatchObject({ lit: [false, true], currentLabel: 2, counting: true })
  })
  it('na troca a contagem acaba', () => {
    expect(countState(t, 22)).toEqual({ lit: [false, false, false, false], currentLabel: null, inLastBar: false, counting: false })
  })
  it('sem tempos de contagem, o último compasso vem dos compassos que faltam', () => {
    expect(countState(noCount, 10)).toEqual({ lit: [false, false, false, false], currentLabel: null, inLastBar: false, counting: false })
    expect(countState({ ...noCount, barsLeft: 1 }, 10).inLastBar).toBe(true)
    expect(countState({ ...t, hasGrid: false, countTimes: [], countLabels: [], countTotal: 0, barsLeft: null }, 21)).toEqual({ lit: [], currentLabel: null, inLastBar: false, counting: false })
  })
  it('dado quebrado não gera NaN nem lança', () => {
    const broken: TransitionView = { ...t, switchAt: null, countTotal: Number.NaN, countLabels: [0, 9, Number.NaN, 2] }
    const s = countState(broken, 30)
    expect(s.lit).toEqual([])
    expect(s.currentLabel).toBeNull()
    expect(countState({ ...t, switchAt: null }, 20.6)).toMatchObject({ lit: [true, true, false, false], currentLabel: 2, inLastBar: true })
  })
})

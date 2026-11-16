import { describe, expect, it } from 'vitest'
import { annualPerMonth, annualSavings, formatReais } from './prices'
import { PRICES } from '../content/site'

describe('preços do site', () => {
  it('escreve em reais com ponto de milhar e vírgula', () => {
    expect(formatReais(0)).toBe('0,00')
    expect(formatReais(49.9)).toBe('49,90')
    expect(formatReais(454.8)).toBe('454,80')
    expect(formatReais(1078.8)).toBe('1.078,80')
    expect(formatReais(1438.8)).toBe('1.438,80')
  })

  it('os preços batem com o FATOS (R$ 49,90 / 454,80 e R$ 119,90 / 1.078,80)', () => {
    expect(PRICES.pro).toMatchObject({ monthly: 49.9, annualTotal: 454.8 })
    expect(PRICES.studio).toMatchObject({ monthly: 119.9, annualTotal: 1078.8 })
    expect(annualPerMonth(PRICES.pro.annualTotal)).toBe(37.9)
    expect(annualPerMonth(PRICES.studio.annualTotal)).toBe(89.9)
  })

  it('o desconto do anual é o de cada plano: 24% no Pro e 25% no Studio', () => {
    expect(annualSavings(PRICES.pro.monthly, PRICES.pro.annualTotal)).toEqual({ reais: 144, percent: 24 })
    expect(annualSavings(PRICES.studio.monthly, PRICES.studio.annualTotal)).toEqual({ reais: 360, percent: 25 })
  })
})

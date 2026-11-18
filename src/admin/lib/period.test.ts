import { describe, expect, it } from 'vitest'
import { addDaysLocal, brtTodayLocal, monthRange } from './period'

describe('period (dias de Brasília no front)', () => {
  it("brtTodayLocal(new Date('2026-12-01T02:30:00Z')) dá 2026-11-30", () => {
    expect(brtTodayLocal(new Date('2026-12-01T02:30:00Z'))).toBe('2026-11-30')
    expect(brtTodayLocal(new Date('2026-12-01T03:00:00Z'))).toBe('2026-12-01')
  })

  it("addDaysLocal('2026-11-16', 30) dá 2026-12-16", () => {
    expect(addDaysLocal('2026-11-16', 30)).toBe('2026-12-16')
    expect(addDaysLocal('2026-12-31', 1)).toBe('2027-01-01')
    expect(addDaysLocal('2026-03-01', -1)).toBe('2026-02-28')
    expect(addDaysLocal('2028-02-28', 1)).toBe('2028-02-29')
  })

  it("monthRange('2026-11-16', -1) dá outubro inteiro", () => {
    expect(monthRange('2026-11-16', -1)).toEqual({ from: '2026-10-01', to: '2026-10-31' })
    expect(monthRange('2026-11-16', 0)).toEqual({ from: '2026-11-01', to: '2026-11-30' })
  })

  it('monthRange atravessa o ano e acerta fevereiro', () => {
    expect(monthRange('2026-01-10', -1)).toEqual({ from: '2025-12-01', to: '2025-12-31' })
    expect(monthRange('2026-11-30', 3)).toEqual({ from: '2027-02-01', to: '2027-02-28' })
    expect(monthRange('2026-11-16', -11)).toEqual({ from: '2025-12-01', to: '2025-12-31' })
  })

  it('dia fora do formato AAAA-MM-DD é recusado', () => {
    expect(() => addDaysLocal('16/11/2026', 1)).toThrow()
    expect(() => monthRange('2026-11', 0)).toThrow()
  })
})

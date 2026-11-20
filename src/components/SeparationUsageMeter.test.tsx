// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'

const fetchUsage = vi.fn()
const fetchBonus = vi.fn()
vi.mock('../lib/separationUsage', async (orig) => ({
  ...(await orig<typeof import('../lib/separationUsage')>()),
  fetchSeparationUsage: () => fetchUsage(),
  fetchQuotaBonus: () => fetchBonus(),
}))

import { SeparationUsageMeter } from './SeparationUsageMeter'

const TRAVESSAO = String.fromCharCode(0x2014)

beforeEach(() => {
  fetchUsage.mockReset()
  fetchBonus.mockReset()
  fetchBonus.mockResolvedValue(0)
  localStorage.clear()
})
afterEach(cleanup)

describe('SeparationUsageMeter (aba Assinatura)', () => {
  it('mostra o contador do banco, não o do navegador', async () => {
    localStorage.setItem('separator_usage', '99')
    fetchUsage.mockResolvedValue({ used: 2, periodStart: '2026-11-01T03:00:00Z', resetsAt: '2026-12-01T03:00:00Z' })

    render(<SeparationUsageMeter plan="free" />)

    expect(await screen.findByText('2 / 3 usadas')).toBeTruthy()
    expect(screen.getByText(/volta a zero em 01\/12\/2026/)).toBeTruthy()
    expect(screen.queryByText(/99/)).toBeNull()
  })

  it('usa o limite do plano (Studio = 150)', async () => {
    fetchUsage.mockResolvedValue({ used: 40, periodStart: '2026-11-01T03:00:00Z', resetsAt: '2026-12-01T03:00:00Z' })
    render(<SeparationUsageMeter plan="pro_anual" />)
    expect(await screen.findByText('40 / 150 usadas')).toBeTruthy()
  })

  it('avisa quando não deu pra ler o contador', async () => {
    fetchUsage.mockResolvedValue(null)
    render(<SeparationUsageMeter plan="free" />)
    expect(await screen.findByText(/Não deu para carregar o contador agora/)).toBeTruthy()
  })

  it('medidor com bônus mostra 4 / 13 usadas e a frase dos extras', async () => {
    fetchUsage.mockResolvedValue({ used: 4, periodStart: '2026-11-01T03:00:00Z', resetsAt: '2026-12-01T03:00:00Z' })
    fetchBonus.mockResolvedValue(10)
    const { container } = render(<SeparationUsageMeter plan="free" />)
    expect(await screen.findByText('4 / 13 usadas')).toBeTruthy()
    expect(screen.getByText('3 separações por mês + 10 extras neste mês. O contador volta a zero em 01/12/2026.')).toBeTruthy()
    expect(container.textContent).not.toContain(TRAVESSAO)
  })

  it('um extra só fica no singular', async () => {
    fetchUsage.mockResolvedValue({ used: 3, periodStart: '2026-11-01T03:00:00Z', resetsAt: '2026-12-01T03:00:00Z' })
    fetchBonus.mockResolvedValue(1)
    render(<SeparationUsageMeter plan="free" />)
    expect(await screen.findByText('3 / 4 usadas')).toBeTruthy()
    expect(screen.getByText('3 separações por mês + 1 extra neste mês. O contador volta a zero em 01/12/2026.')).toBeTruthy()
  })

  it('sem bônus a frase de hoje não muda', async () => {
    fetchUsage.mockResolvedValue({ used: 2, periodStart: '2026-11-01T03:00:00Z', resetsAt: '2026-12-01T03:00:00Z' })
    const { container } = render(<SeparationUsageMeter plan="free" />)
    expect(await screen.findByText('2 / 3 usadas')).toBeTruthy()
    expect(screen.getByText('3 separações por mês. O contador volta a zero em 01/12/2026.')).toBeTruthy()
    expect(container.textContent).not.toMatch(/extra/)
    expect(container.textContent).not.toContain(TRAVESSAO)
  })

  it('a leitura do extra que falha mostra o limite do plano, nunca menos', async () => {
    fetchUsage.mockResolvedValue({ used: 2, periodStart: '2026-11-01T03:00:00Z', resetsAt: '2026-12-01T03:00:00Z' })
    // fetchQuotaBonus já devolve 0 em erro; aqui até uma rejeição inesperada fica no limite do plano.
    fetchBonus.mockRejectedValue(new Error('rede caiu'))
    render(<SeparationUsageMeter plan="pro_mensal" />)
    expect(await screen.findByText('2 / 150 usadas')).toBeTruthy()
  })

  it('conta admin segue sem limite e sem a frase dos extras', async () => {
    fetchUsage.mockResolvedValue({ used: 2, periodStart: '2026-11-01T03:00:00Z', resetsAt: '2026-12-01T03:00:00Z' })
    fetchBonus.mockResolvedValue(10)
    render(<SeparationUsageMeter plan="free" isAdmin />)
    expect(screen.getByText('Conta admin: sem limite de separações.')).toBeTruthy()
    await new Promise((r) => setTimeout(r, 0))
    expect(screen.queryByText(/extras? neste mês/)).toBeNull()
  })
})

// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'

const fetchUsage = vi.fn()
vi.mock('../lib/separationUsage', async (orig) => ({
  ...(await orig<typeof import('../lib/separationUsage')>()),
  fetchSeparationUsage: () => fetchUsage(),
}))

import { SeparationUsageMeter } from './SeparationUsageMeter'

beforeEach(() => {
  fetchUsage.mockReset()
  localStorage.clear()
})
afterEach(cleanup)

describe('SeparationUsageMeter (aba Assinatura)', () => {
  it('mostra o contador do banco, não o do navegador', async () => {
    localStorage.setItem('separator_usage', '99')
    fetchUsage.mockResolvedValue({ used: 2, periodStart: '2026-11-01T03:00:00Z', resetsAt: '2026-12-01T03:00:00Z' })

    render(<SeparationUsageMeter plan="free" />)

    expect(await screen.findByText('2 / 5 usadas')).toBeTruthy()
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
})

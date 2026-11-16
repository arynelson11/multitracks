import { beforeEach, describe, expect, it, vi } from 'vitest'

const rpc = vi.fn()
vi.mock('./supabase', () => ({ supabase: { rpc: (...a: unknown[]) => rpc(...a) } }))

import { fetchSeparationUsage, formatDateBR } from './separationUsage'

beforeEach(() => { rpc.mockReset() })

describe('fetchSeparationUsage', () => {
  it('lê o contador do mês no banco pelo RPC get_my_separation_usage', async () => {
    rpc.mockResolvedValue({
      data: [{ used: 2, period_start: '2026-11-01T03:00:00+00:00', resets_at: '2026-12-01T03:00:00+00:00' }],
      error: null,
    })
    await expect(fetchSeparationUsage()).resolves.toEqual({
      used: 2,
      periodStart: '2026-11-01T03:00:00+00:00',
      resetsAt: '2026-12-01T03:00:00+00:00',
    })
    expect(rpc).toHaveBeenCalledWith('get_my_separation_usage')
  })

  it('devolve null quando o banco falha (a tela mostra que não deu pra carregar)', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'boom' } })
    await expect(fetchSeparationUsage()).resolves.toBeNull()
  })

  it('devolve null com resposta fora do formato', async () => {
    rpc.mockResolvedValue({ data: [{ used: 'dois' }], error: null })
    await expect(fetchSeparationUsage()).resolves.toBeNull()
  })
})

describe('formatDateBR', () => {
  it('mostra a data no horário de Brasília', () => {
    // 1º de dezembro 00:00 em Brasília = 03:00 UTC
    expect(formatDateBR('2026-12-01T03:00:00Z')).toBe('01/12/2026')
    // 02:59 UTC ainda é 30/11 em Brasília
    expect(formatDateBR('2026-12-01T02:59:00Z')).toBe('30/11/2026')
  })
})

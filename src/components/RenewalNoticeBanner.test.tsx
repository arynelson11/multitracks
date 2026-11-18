// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { MySubscription } from '../lib/subscription'

const fetchSub = vi.fn()
vi.mock('../lib/subscription', async (orig) => ({
  ...(await orig<typeof import('../lib/subscription')>()),
  fetchMySubscription: () => fetchSub(),
}))

import { RenewalNoticeBanner } from './RenewalNoticeBanner'

const monthly = (next: string): MySubscription => ({
  id: 'chk_1', kind: 'asaas', plan_key: 'essencial_mensal', cycle: 'MONTHLY', status: 'active',
  started_at: '2026-10-16T15:00:00Z', next_due_date: next, paid_until: null, access_until: null,
  cancel_source: null, canceled_at: null, created_at: '2026-10-16T15:00:00Z',
})

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-11-16T15:00:00Z'))
  fetchSub.mockReset()
  localStorage.clear()
})
afterEach(() => { cleanup(); vi.useRealTimers() })

describe('RenewalNoticeBanner', () => {
  it('3 dias antes: "Sua assinatura vence em 3 dias"', async () => {
    fetchSub.mockResolvedValue(monthly('2026-11-19'))
    render(<RenewalNoticeBanner userId="u1" plan="essencial_mensal" />)
    expect(await screen.findByText('Sua assinatura vence em 3 dias (19/11).')).toBeTruthy()
    expect(screen.getByText(/no dia seguinte a conta volta para o Livre/)).toBeTruthy()
  })

  it('no dia: "Sua assinatura vence hoje"', async () => {
    fetchSub.mockResolvedValue(monthly('2026-11-16'))
    render(<RenewalNoticeBanner userId="u1" plan="essencial_mensal" />)
    expect(await screen.findByText('Sua assinatura vence hoje (16/11).')).toBeTruthy()
  })

  it('1 dia antes usa o singular', async () => {
    fetchSub.mockResolvedValue(monthly('2026-11-17'))
    render(<RenewalNoticeBanner userId="u1" plan="essencial_mensal" />)
    expect(await screen.findByText('Sua assinatura vence em 1 dia (17/11).')).toBeTruthy()
  })

  it('"Entendi" esconde até o dia seguinte', async () => {
    fetchSub.mockResolvedValue(monthly('2026-11-19'))
    const { unmount } = render(<RenewalNoticeBanner userId="u1" plan="essencial_mensal" />)
    fireEvent.click(await screen.findByRole('button', { name: 'Entendi' }))
    expect(screen.queryByText(/vence em/)).toBeNull()
    unmount()
    render(<RenewalNoticeBanner userId="u1" plan="essencial_mensal" />)
    await Promise.resolve()
    expect(screen.queryByText(/vence em/)).toBeNull()
  })

  it('não aparece no Livre nem longe do vencimento', async () => {
    fetchSub.mockResolvedValue(monthly('2026-11-25'))
    render(<RenewalNoticeBanner userId="u1" plan="essencial_mensal" />)
    await Promise.resolve()
    expect(screen.queryByText(/vence/)).toBeNull()
    cleanup()
    render(<RenewalNoticeBanner userId="u1" plan="free" />)
    expect(fetchSub).toHaveBeenCalledTimes(1)
  })
})

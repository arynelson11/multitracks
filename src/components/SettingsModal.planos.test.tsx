// @vitest-environment jsdom
// Revisão da 1b (Ruling hideOffer-config-1b): os Planos abertos pelas Configurações > Assinatura
// seguem a Ruling pads-tocando como os outros do App. Com a música tocando ou na pré-contagem
// (hideOffer), o Livre não vê o desconto do primeiro mês e o checkout vai sem a oferta.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import type { OutputSettings } from '../lib/stageContracts'

const { authState, settingsState } = vi.hoisted(() => ({
  authState: {
    user: { id: 'u1', email: 'pessoa@exemplo.com', user_metadata: {}, created_at: '2026-07-01T00:00:00Z' } as Record<string, unknown> | null,
    userPlan: 'free',
    planExpiresAt: null as string | null,
    isAdmin: false,
    refreshPlan: vi.fn(async () => {}),
    updateProfile: vi.fn(async () => ({})),
    updatePassword: vi.fn(async () => {}),
    signOutEverywhere: vi.fn(async () => {}),
    deleteAccount: vi.fn(async () => {}),
  },
  settingsState: {
    settings: {
      autoPan: false,
      audioDeviceId: 'default',
      outputs: { mode: 'stereo', earOnSecond: false, multi: { vsPair: 0, click: 2, guide: 3 } } as OutputSettings,
      stageVersion: 'novo' as 'novo' | 'antigo',
      stageVersionChosen: false,
      legacyPanReset: false,
    },
    updateSetting: vi.fn(),
    canPickOutput: true,
    outputLoadWarnings: [] as readonly string[],
  },
}))

vi.mock('../hooks/useAuth', () => ({ useAuth: () => authState }))
vi.mock('../contexts/SettingsContext', () => ({ useSettings: () => settingsState }))
vi.mock('../lib/supabase', () => ({ supabase: null, getAuthHeaders: async () => ({ Authorization: 'Bearer t' }) }))
vi.mock('../lib/api', () => ({ apiUrl: (p: string) => p }))
const desktop = vi.hoisted(() => ({ isElectron: true, openExternalUrl: vi.fn() }))
vi.mock('../lib/desktop', () => ({
  get isElectron() { return desktop.isElectron },
  openExternalUrl: (url: string) => desktop.openExternalUrl(url),
}))
// O que não é a Assinatura nem os Planos fica de fora: o teste olha só o caminho até o checkout.
vi.mock('./ProfileTab', () => ({ ProfileTab: () => null }))
vi.mock('./SeparationUsageMeter', () => ({ SeparationUsageMeter: () => null }))
vi.mock('./SubscriptionPanel', () => ({ SubscriptionPanel: () => null }))

import { SettingsModal } from './SettingsModal'

const PRICES = { essencial_mensal: 24.9, pro_mensal: 59.9 }
const fetchMock = vi.fn()
const answer = (status: number, body: unknown) => ({ ok: status >= 200 && status < 300, status, statusText: 'x', text: async () => JSON.stringify(body) })
const bodies = (path: string) => fetchMock.mock.calls.filter(([url]) => url === path).map(([, init]) => JSON.parse(init.body))
const card = (name: string) => screen.getByRole('heading', { name }).closest('div.relative') as HTMLElement

beforeEach(() => {
  authState.userPlan = 'free'
  desktop.isElectron = true
  desktop.openExternalUrl.mockReset()
  fetchMock.mockReset()
  fetchMock.mockImplementation(async (url: string) => {
    if (url === '/api/checkout?action=offer') return answer(200, { status: 'active', expiresAt: new Date(Date.now() + 47 * 3_600_000).toISOString(), prices: PRICES })
    if (url === '/api/checkout') return answer(200, { url: 'https://asaas.test/c/chk_cfg' })
    throw new Error(`rota inesperada: ${url}`)
  })
  vi.stubGlobal('fetch', fetchMock)
  vi.stubGlobal('alert', vi.fn())
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

const openPlansFromSettings = (hideOffer?: boolean) => {
  render(
    <SettingsModal
      isOpen
      onClose={() => {}}
      channels={[]}
      onSetChannelBus={() => {}}
      onOpenAdmin={() => {}}
      onReplayTour={() => {}}
      {...(hideOffer === undefined ? {} : { hideOffer })}
    />,
  )
  // Na casca reescrita (faixa B) as abas são role tab do kit, não botões soltos.
  fireEvent.click(screen.getByRole('tab', { name: 'Assinatura' }))
  fireEvent.click(screen.getByRole('button', { name: 'Ver Planos & Assinar' }))
}

describe('SettingsModal: Planos abertos pela Assinatura', () => {
  it('com a música tocando (hideOffer) não mostram o desconto e assinar vai sem a oferta', async () => {
    openPlansFromSettings(true)
    await vi.waitFor(() => expect(bodies('/api/checkout?action=offer')).toHaveLength(1))
    await new Promise((res) => setTimeout(res, 0))
    expect(screen.queryByText(/Primeiro mês/)).toBeNull()
    expect(card('Pro Mensal').textContent).toContain('R$ 49,90/mês')
    fireEvent.click(within(card('Pro Mensal')).getByRole('button', { name: 'Assinar Agora' }))
    await vi.waitFor(() => expect(bodies('/api/checkout')).toHaveLength(1))
    expect(bodies('/api/checkout')[0]).toEqual({ planKey: 'essencial_mensal', confirmedSwitch: false })
  })

  it('sem a prop (música parada) a oferta aberta aparece e assinar manda offer true', async () => {
    openPlansFromSettings()
    await vi.waitFor(() => expect(card('Pro Mensal').textContent).toContain('Primeiro mês por'))
    fireEvent.click(within(card('Pro Mensal')).getByRole('button', { name: 'Assinar Agora' }))
    await vi.waitFor(() => expect(bodies('/api/checkout')).toHaveLength(1))
    expect(bodies('/api/checkout')[0]).toEqual({ planKey: 'essencial_mensal', confirmedSwitch: false, offer: true })
  })
})

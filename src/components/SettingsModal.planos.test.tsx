// @vitest-environment jsdom
// As Configurações com os Planos de verdade por dentro (inicio-2 Minor 6): desde a Parte 3 os Planos
// são uma janela do palco que segura o clique (PricingView) e o Esc (pilha), então o Esc e o toque
// no fundo dos Planos fecham só os Planos, e as Configurações continuam abertas.
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
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
    availableAudioDevices: [] as MediaDeviceInfo[],
    refreshAudioDevices: vi.fn(async () => {}),
    canPickOutput: true,
    outputLoadWarnings: [] as readonly string[],
  },
}))

vi.mock('../hooks/useAuth', () => ({ useAuth: () => authState }))
vi.mock('../contexts/SettingsContext', () => ({ useSettings: () => settingsState }))
vi.mock('./SeparationUsageMeter', () => ({ SeparationUsageMeter: () => <div data-testid="usage" /> }))
vi.mock('./SubscriptionPanel', () => ({ SubscriptionPanel: () => <div data-testid="subscription" /> }))
vi.mock('./ProfileTab', () => ({
  ProfileTab: (p: { onUpgrade(): void }) => <div data-testid="profile"><button type="button" onClick={p.onUpgrade}>upgrade do perfil</button></div>,
}))
// O PricingModal de verdade lê a oferta e o checkout: o servidor fica de mentira.
vi.mock('../lib/supabase', () => ({ supabase: null, getAuthHeaders: async () => ({ Authorization: 'Bearer t' }) }))
vi.mock('../lib/api', () => ({ apiUrl: (p: string) => p }))

import { SettingsModal } from './SettingsModal'

beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn()
})
beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, statusText: 'OK', text: async () => '{"status":"none"}' })))
})
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  vi.unstubAllGlobals()
})

function open() {
  const onClose = vi.fn()
  render(<SettingsModal isOpen onClose={onClose} channels={[]} onSetChannelBus={vi.fn()} onOpenAdmin={vi.fn()} onReplayTour={vi.fn()} />)
  fireEvent.click(screen.getByText('upgrade do perfil'))
  expect(screen.getByRole('dialog', { name: 'Escolha seu Plano' })).toBeTruthy()
  return onClose
}

describe('Configurações com os Planos de verdade', () => {
  it('Esc fecha só os Planos; o Esc seguinte fecha as Configurações', () => {
    const onClose = open()
    fireEvent.keyDown(window, { key: 'Escape', code: 'Escape' })
    expect(screen.queryByRole('dialog', { name: 'Escolha seu Plano' })).toBeNull()
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog', { name: 'Configurações' })).toBeTruthy()
    fireEvent.keyDown(window, { key: 'Escape', code: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('o toque no fundo dos Planos fecha só os Planos', () => {
    const onClose = open()
    const backdrop = screen.getByRole('dialog', { name: 'Escolha seu Plano' }).parentElement as HTMLElement
    fireEvent.pointerDown(backdrop)
    fireEvent.click(backdrop)
    expect(screen.queryByRole('dialog', { name: 'Escolha seu Plano' })).toBeNull()
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog', { name: 'Configurações' })).toBeTruthy()
  })

  it('o toque dentro dos Planos (num cartão) não fecha nada', () => {
    const onClose = open()
    const plans = screen.getByRole('dialog', { name: 'Escolha seu Plano' })
    const card = plans.querySelector('[data-plan-card="essencial_anual"]') as HTMLElement
    fireEvent.pointerDown(card)
    fireEvent.click(card)
    expect(screen.getByRole('dialog', { name: 'Escolha seu Plano' })).toBeTruthy()
    expect(onClose).not.toHaveBeenCalled()
  })
})

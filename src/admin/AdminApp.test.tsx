// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import AdminApp from './AdminApp'
import type { GuardStatus } from './hooks/useAdminGuard'

type Guard = { status: GuardStatus; email: string | null; signOut: () => Promise<void> }

const h = vi.hoisted(() => ({
  guard: null as unknown as Guard,
  adminGet: vi.fn(),
  signOut: vi.fn(async () => {}),
}))

vi.mock('./hooks/useAdminGuard', () => ({ useAdminGuard: () => h.guard }))
vi.mock('./lib/adminApi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./lib/adminApi')>()),
  adminGet: h.adminGet,
}))
vi.mock('../lib/supabase', () => ({ supabase: null, getAuthHeaders: async () => ({}) }))

const REVIEW = {
  actions: [],
  flags: [],
  events: [],
  counts: { manual: 2, auto: 1, total: 3 },
  generatedAt: '2026-11-16T15:00:00Z',
}

beforeEach(() => {
  h.adminGet.mockReset()
  h.adminGet.mockResolvedValue(REVIEW)
  h.signOut.mockClear()
  h.guard = { status: 'ok', email: 'admin@exemplo.com', signOut: h.signOut }
})
afterEach(cleanup)

const CORTE_A = ['Pendências', 'Visão geral', 'Assinantes', 'Financeiro', 'Custos de IA', 'Registro', 'Uso']
const tabLabels = () => screen.getAllByRole('tab').map((t) => (t.textContent ?? '').replace(/\d+/g, '').trim())

describe('AdminApp', () => {
  it('com onClose mostra Voltar ao app e chama onClose', async () => {
    const onClose = vi.fn()
    render(<AdminApp onClose={onClose} />)
    fireEvent.click(screen.getByRole('button', { name: 'Voltar ao app' }))
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('button', { name: 'Sair' })).toBeNull()
    await waitFor(() => expect(h.adminGet).toHaveBeenCalled())
  })

  it('sem onClose mostra Sair', async () => {
    render(<AdminApp />)
    expect(screen.queryByRole('button', { name: 'Voltar ao app' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Sair' }))
    expect(h.signOut).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(h.adminGet).toHaveBeenCalled())
  })

  it('abas na ordem do Corte A, com Pendências aberta primeiro', async () => {
    render(<AdminApp />)
    expect(screen.getByRole('tablist')).toBeTruthy()
    expect(tabLabels()).toEqual(CORTE_A)
    const tabs = screen.getAllByRole('tab')
    expect(tabs[0].getAttribute('aria-selected')).toBe('true')
    expect(tabs.slice(1).every((t) => t.getAttribute('aria-selected') === 'false')).toBe(true)
    await waitFor(() => expect(h.adminGet).toHaveBeenCalled())
  })

  it('a aba Pendências mostra o total vindo de review', async () => {
    const { container } = render(<AdminApp />)
    const pend = screen.getByRole('tab', { name: /Pendências/ })
    await waitFor(() => expect(pend.textContent).toContain('3'))
    expect(h.adminGet.mock.calls[0][0]).toBe('review')
    // Há pendência manual: o Led de alerta acende na aba.
    expect(container.querySelector('[role="tab"] .bg-ps-alert')).not.toBeNull()
  })

  it('sem pendência manual a aba não acende o alerta', async () => {
    h.adminGet.mockResolvedValue({ ...REVIEW, counts: { manual: 0, auto: 1, total: 1 } })
    const { container } = render(<AdminApp />)
    const pend = screen.getByRole('tab', { name: /Pendências/ })
    await waitFor(() => expect(pend.textContent).toContain('1'))
    expect(container.querySelector('[role="tab"] .bg-ps-alert')).toBeNull()
  })

  it('clicar numa aba troca a selecionada', async () => {
    render(<AdminApp />)
    const audit = screen.getByRole('tab', { name: 'Registro' })
    fireEvent.click(audit)
    expect(audit.getAttribute('aria-selected')).toBe('true')
    expect(screen.getByRole('tab', { name: /Pendências/ }).getAttribute('aria-selected')).toBe('false')
    expect(screen.getByRole('tabpanel').getAttribute('aria-labelledby')).toBe(audit.id)
    await waitFor(() => expect(h.adminGet).toHaveBeenCalled())
  })

  it('setas do teclado andam entre as abas', async () => {
    render(<AdminApp />)
    const first = screen.getByRole('tab', { name: /Pendências/ })
    fireEvent.keyDown(first, { key: 'ArrowRight' })
    expect(screen.getByRole('tab', { name: 'Visão geral' }).getAttribute('aria-selected')).toBe('true')
    fireEvent.keyDown(screen.getByRole('tab', { name: 'Visão geral' }), { key: 'End' })
    expect(screen.getByRole('tab', { name: 'Uso' }).getAttribute('aria-selected')).toBe('true')
    expect(document.activeElement).toBe(screen.getByRole('tab', { name: 'Uso' }))
    await waitFor(() => expect(h.adminGet).toHaveBeenCalled())
  })

  it('tela de acesso negado não usa text-primary nem bg-[#0e0e10]', () => {
    h.guard = { status: 'denied', email: 'outro@exemplo.com', signOut: h.signOut }
    const { container } = render(<AdminApp />)
    expect(screen.getByText('Acesso negado')).toBeTruthy()
    expect(container.innerHTML).not.toContain('text-primary')
    expect(container.innerHTML).not.toContain('bg-[#0e0e10]')
    expect(container.innerHTML).toContain('bg-ps-ink')
    expect(container.innerHTML).toContain('text-ps-alert')
    fireEvent.click(screen.getByRole('button', { name: 'Trocar de conta' }))
    expect(h.signOut).toHaveBeenCalledTimes(1)
    expect(h.adminGet).not.toHaveBeenCalled()
  })

  it('acesso negado dentro do app volta ao app em vez de sair da conta', () => {
    h.guard = { status: 'denied', email: 'outro@exemplo.com', signOut: h.signOut }
    const onClose = vi.fn()
    render(<AdminApp onClose={onClose} />)
    expect(screen.queryByRole('button', { name: 'Trocar de conta' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Voltar ao app' }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('tela de carregando não usa text-primary nem bg-[#0e0e10]', () => {
    h.guard = { status: 'loading', email: null, signOut: h.signOut }
    const { container } = render(<AdminApp />)
    expect(screen.getByText('Carregando...')).toBeTruthy()
    expect(container.innerHTML).not.toContain('text-primary')
    expect(container.innerHTML).not.toContain('bg-[#0e0e10]')
    expect(container.innerHTML).toContain('bg-ps-ink')
    expect(h.adminGet).not.toHaveBeenCalled()
  })
})

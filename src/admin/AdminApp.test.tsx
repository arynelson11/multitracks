// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import AdminApp from './AdminApp'
import { AdminApiError } from './lib/adminApi'
import type { GuardStatus } from './hooks/useAdminGuard'

type Guard = { status: GuardStatus; email: string | null; signOut: () => Promise<void> }

const h = vi.hoisted(() => ({
  guard: null as unknown as Guard,
  adminGet: vi.fn(),
  adminPost: vi.fn(),
  signOut: vi.fn(async () => {}),
  responses: {} as Record<string, unknown>,
}))

vi.mock('./hooks/useAdminGuard', () => ({ useAdminGuard: () => h.guard }))
vi.mock('./lib/adminApi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./lib/adminApi')>()),
  adminGet: h.adminGet,
  adminPost: h.adminPost,
}))
vi.mock('../lib/supabase', () => ({ supabase: null, getAuthHeaders: async () => ({}) }))

const REVIEW = {
  actions: [],
  flags: [],
  events: [],
  counts: { manual: 2, auto: 1, total: 3 },
  generatedAt: '2026-11-16T15:00:00Z',
}
const AUDIT_EMPTY = { total: 0, page: 1, pageSize: 50, rows: [] }
const ANA = '44444444-4444-4444-8444-444444444444'
const SUBSCRIBERS = {
  total: 1, page: 1, pageSize: 50,
  rows: [{
    userId: ANA, email: 'ana@igreja.com', name: 'Ana Souza', plan: 'free', courtesyPlan: null, status: 'free', nextDueDate: null,
    accessUntil: null, separationsMonth: 1, createdAt: '2026-11-01T12:00:00Z', lastSeenAt: null, lastSignInAt: null, flags: [],
  }],
}
const SUBSCRIBER = {
  profile: {
    userId: ANA, email: 'ana@igreja.com', name: 'Ana Souza', provider: 'email', plan: 'free', planExpiresAt: null, isAdmin: false,
    blockedAt: null, blockedReason: null, createdAt: '2026-11-01T12:00:00Z', lastSignInAt: null, lastSeenAt: null,
  },
  quota: { used: 1, bonus: 0, periodStart: '2026-11-01T03:00:00Z', resetsAt: '2026-12-01T03:00:00Z', limit: 5 },
  subscriptions: [], payments: [], legacyPayments: [], separations: { month: 1, total: 2 },
  aiCost: { monthBrl: 0, totalBrl: 0, jobsWithoutCost: 0 }, openActions: [], plans: [], asaasLive: [], mismatches: [],
}

beforeEach(() => {
  h.adminGet.mockReset()
  // Responde por ação, como o servidor: cada aba recebe o formato dela, e ação sem resposta
  // aqui é recusada como desconhecida (400), nunca com o corpo de outra ação.
  h.responses = { review: REVIEW, audit: AUDIT_EMPTY }
  h.adminGet.mockImplementation(async (action: string) => {
    if (Object.hasOwn(h.responses, action)) return h.responses[action]
    throw new AdminApiError(`Ação desconhecida: ${action}`, 400)
  })
  h.adminPost.mockReset()
  h.adminPost.mockResolvedValue({ result: 'blocked' })
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

  it('o botão de saída fica dentro do respiro de 16 px, sem margem negativa até a borda', async () => {
    const { rerender } = render(<AdminApp onClose={() => {}} />)
    expect(screen.getByRole('button', { name: 'Voltar ao app' }).className).not.toMatch(/(^|\s)-m[rx]-/)
    rerender(<AdminApp />)
    expect(screen.getByRole('button', { name: 'Sair' }).className).not.toMatch(/(^|\s)-m[rx]-/)
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
    h.responses.review = { ...REVIEW, counts: { manual: 0, auto: 1, total: 1 } }
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
    // o Registro pede a ação dele e recebe o formato dele
    expect(await screen.findByText('Nenhuma ação registrada ainda.')).toBeTruthy()
    expect(h.adminGet).toHaveBeenCalledWith('audit', { page: 1 })
  })

  it('depois de uma ação na ficha do assinante, a fila de Pendências é pedida de novo e o número muda', async () => {
    h.responses = { ...h.responses, subscribers: SUBSCRIBERS, subscriber: SUBSCRIBER }
    render(<AdminApp />)
    const pend = screen.getByRole('tab', { name: /Pendências/ })
    await waitFor(() => expect(pend.textContent).toContain('3'))
    fireEvent.click(screen.getByRole('tab', { name: 'Assinantes' }))
    fireEvent.click(await screen.findByRole('button', { name: /Ana Souza/ }))
    fireEvent.click(await screen.findByRole('button', { name: 'Bloquear' }))
    const dialog = screen.getByRole('dialog', { name: 'Bloquear a conta' })
    fireEvent.change(within(dialog).getByLabelText('Motivo'), { target: { value: 'fraude no cartão' } })

    const reviewCalls = () => h.adminGet.mock.calls.filter((c) => c[0] === 'review').length
    const before = reviewCalls()
    // A ação mudou a fila: o servidor passa a responder outra contagem.
    h.responses.review = { ...REVIEW, counts: { manual: 4, auto: 1, total: 5 } }
    fireEvent.click(within(dialog).getByRole('button', { name: 'Bloquear' }))
    await waitFor(() => expect(h.adminPost).toHaveBeenCalledWith('block', { userId: ANA, reason: 'fraude no cartão' }))
    await waitFor(() => expect(reviewCalls()).toBe(before + 1))
    await waitFor(() => expect(pend.textContent).toContain('5'))
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

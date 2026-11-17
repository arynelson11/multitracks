// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { AdminErrorBoundary } from './AdminErrorBoundary'
import AdminApp from '../AdminApp'
import type { GuardStatus } from '../hooks/useAdminGuard'

// Rede de segurança (Ruling ADM-T7-forma): um erro de render numa aba mostra a frase pronta no
// lugar da aba, com a casca de pé. O app nunca fica em branco.

type Guard = { status: GuardStatus; email: string | null; signOut: () => Promise<void> }

const h = vi.hoisted(() => ({
  guard: null as unknown as Guard,
  adminGet: vi.fn(),
  signOut: vi.fn(async () => {}),
  auditThrows: true,
}))

vi.mock('../hooks/useAdminGuard', () => ({ useAdminGuard: () => h.guard }))
vi.mock('../lib/adminApi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/adminApi')>()),
  adminGet: h.adminGet,
}))
vi.mock('../../lib/supabase', () => ({ supabase: null, getAuthHeaders: async () => ({}) }))
// Uma aba que lança no render (no lugar do Registro).
vi.mock('../tabs/AuditTab', () => ({
  AuditTab: () => {
    if (h.auditThrows) throw new Error('aba quebrada no teste')
    return <p>Registro de pé</p>
  },
}))

const MSG = 'Esta aba teve um problema. Tente de novo ou volte ao app.'
const REVIEW = { actions: [], flags: [], events: [], counts: { manual: 0, auto: 0, total: 0 }, generatedAt: '2026-11-16T15:00:00Z' }

let consoleError: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  h.adminGet.mockReset()
  h.adminGet.mockImplementation(async (action: string) => {
    if (action === 'review') return REVIEW
    throw new Error(`ação sem resposta no teste: ${action}`)
  })
  h.signOut.mockClear()
  h.auditThrows = true
  h.guard = { status: 'ok', email: 'admin@exemplo.com', signOut: h.signOut }
  // O React escreve no console o erro que a rede de segurança pegou.
  consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => {
  cleanup()
  consoleError.mockRestore()
})

let shouldThrow = true
function Flaky() {
  if (shouldThrow) throw new Error('quebrou')
  return <p>Conteúdo da aba</p>
}

describe('AdminErrorBoundary', () => {
  it('sem erro mostra a aba como ela é', () => {
    render(
      <AdminErrorBoundary onSignOut={() => {}}>
        <p>Conteúdo da aba</p>
      </AdminErrorBoundary>,
    )
    expect(screen.getByText('Conteúdo da aba')).toBeTruthy()
    expect(screen.queryByText(MSG)).toBeNull()
  })

  it('erro de render mostra a frase, Tentar de novo e Voltar ao app dentro do app', () => {
    shouldThrow = true
    const onClose = vi.fn()
    render(
      <AdminErrorBoundary onClose={onClose} onSignOut={() => {}}>
        <Flaky />
      </AdminErrorBoundary>,
    )
    const box = screen.getByRole('alert')
    expect(within(box).getByText(MSG)).toBeTruthy()
    expect(within(box).queryByRole('button', { name: 'Sair' })).toBeNull()
    fireEvent.click(within(box).getByRole('button', { name: 'Voltar ao app' }))
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(consoleError).toHaveBeenCalled()
  })

  it('na web, sem onClose, a saída é Sair', () => {
    shouldThrow = true
    const onSignOut = vi.fn()
    render(
      <AdminErrorBoundary onSignOut={onSignOut}>
        <Flaky />
      </AdminErrorBoundary>,
    )
    const box = screen.getByRole('alert')
    expect(within(box).queryByRole('button', { name: 'Voltar ao app' })).toBeNull()
    fireEvent.click(within(box).getByRole('button', { name: 'Sair' }))
    expect(onSignOut).toHaveBeenCalledTimes(1)
  })

  it('Tentar de novo monta a aba outra vez', () => {
    shouldThrow = true
    render(
      <AdminErrorBoundary onSignOut={() => {}}>
        <Flaky />
      </AdminErrorBoundary>,
    )
    expect(screen.getByText(MSG)).toBeTruthy()
    shouldThrow = false
    fireEvent.click(screen.getByRole('button', { name: 'Tentar de novo' }))
    expect(screen.getByText('Conteúdo da aba')).toBeTruthy()
    expect(screen.queryByText(MSG)).toBeNull()
  })

  it('no AdminApp, a aba que lança não deixa a tela em branco: a casca e as outras abas continuam', async () => {
    const onClose = vi.fn()
    render(<AdminApp onClose={onClose} />)
    await screen.findByText('Nada pendente agora.')
    fireEvent.click(screen.getByRole('tab', { name: 'Registro' }))

    const box = await screen.findByRole('alert')
    expect(within(box).getByText(MSG)).toBeTruthy()
    // a casca continua de pé: abas e a saída do topo
    expect(screen.getByRole('tablist')).toBeTruthy()
    expect(screen.getAllByRole('button', { name: 'Voltar ao app' })).toHaveLength(2)

    // trocar de aba sai do erro; voltar ao Registro tenta de novo
    fireEvent.click(screen.getByRole('tab', { name: /Pendências/ }))
    expect(screen.queryByText(MSG)).toBeNull()
    h.auditThrows = false
    fireEvent.click(screen.getByRole('tab', { name: 'Registro' }))
    expect(screen.getByText('Registro de pé')).toBeTruthy()

    // e o Voltar ao app da caixa fecha o admin
    h.auditThrows = true
    fireEvent.click(screen.getByRole('tab', { name: /Pendências/ }))
    fireEvent.click(screen.getByRole('tab', { name: 'Registro' }))
    fireEvent.click(within(await screen.findByRole('alert')).getByRole('button', { name: 'Voltar ao app' }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})

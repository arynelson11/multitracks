// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { AuditTab } from './AuditTab'
import { AdminApiError } from '../lib/adminApi'
import type { AuditEntry, AuditPage } from '../lib/auditTypes'

const h = vi.hoisted(() => ({ adminGet: vi.fn() }))

vi.mock('../lib/adminApi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/adminApi')>()),
  adminGet: h.adminGet,
}))
vi.mock('../../lib/supabase', () => ({ supabase: null, getAuthHeaders: async () => ({}) }))

const TRAVESSAO = String.fromCharCode(0x2014)
const USER_ID = '11111111-1111-4111-8111-111111111111'
const tabProps = { onNavigate: () => {}, focusUserId: null }

function entry(over: Partial<AuditEntry> = {}): AuditEntry {
  return {
    id: 1, createdAt: '2026-11-16T15:00:00Z', finishedAt: '2026-11-16T15:00:01Z', adminEmail: 'admin@igreja.com',
    action: 'resolve_flag', targetUserId: USER_ID, targetEmail: 'quem@igreja.com', targetRef: 'chk_1', result: 'ok',
    message: null, note: null, before: null, after: null, ...over,
  }
}

function pageOf(rows: AuditEntry[], over: Partial<AuditPage> = {}): AuditPage {
  return { total: rows.length, page: 1, pageSize: 50, rows, ...over }
}

// O item da lista que contém o texto.
const itemWith = (text: string) => screen.getByText(text).closest('li') as HTMLElement

beforeEach(() => {
  h.adminGet.mockReset()
})
afterEach(cleanup)

describe('AuditTab', () => {
  it('pede a primeira página do registro e mostra data, admin, ação, conta, resultado e mensagem', async () => {
    h.adminGet.mockResolvedValue(pageOf([
      entry({ id: 2, action: 'change_plan', result: 'failed', message: 'O Asaas não respondeu. Status do Asaas: 503.' }),
      entry({ id: 1, action: 'retry_event', targetUserId: null, targetEmail: null, targetRef: 'evt_9', createdAt: '2026-12-01T02:30:00Z' }),
    ]))
    render(<AuditTab {...tabProps} />)
    expect(screen.getByText('Carregando...')).toBeTruthy()
    await screen.findByText('mudou o plano')
    expect(h.adminGet).toHaveBeenCalledWith('audit', { page: 1 })

    const plan = itemWith('mudou o plano')
    expect(within(plan).getByText('16/11/2026 12:00')).toBeTruthy()
    expect(within(plan).getByText('admin@igreja.com', { exact: false })).toBeTruthy()
    expect(within(plan).getByText('quem@igreja.com')).toBeTruthy()
    expect(within(plan).getByText('O Asaas não respondeu. Status do Asaas: 503.')).toBeTruthy()

    // sem e-mail mostra a referência; a hora é de Brasília (01/12 02:30 UTC ainda é 30/11)
    const event = itemWith('reprocessou aviso do Asaas')
    expect(within(event).getByText('evt_9')).toBeTruthy()
    expect(within(event).getByText('30/11/2026 23:30')).toBeTruthy()
  })

  it('a tela mostra sem confirmação pro pendente', async () => {
    h.adminGet.mockResolvedValue(pageOf([entry({ action: 'cancel_subscription', result: 'pending', finishedAt: null })]))
    render(<AuditTab {...tabProps} />)
    await screen.findByText('cancelou a assinatura')
    const item = itemWith('cancelou a assinatura')
    const chip = within(item).getByRole('button', { name: 'sem confirmação' })
    expect(chip.className).not.toContain('text-ps-or')
    expect(within(chip).getByText('sem confirmação').className).not.toContain('text-ps-alert')
  })

  it('resultado em Chip small: laranja só em feito, âmbar em falhou, em parte e falhou de novo', async () => {
    h.adminGet.mockResolvedValue(pageOf([
      entry({ id: 5, action: 'block', result: 'ok' }),
      entry({ id: 4, action: 'unblock', result: 'failed' }),
      entry({ id: 3, action: 'adjust_quota', result: 'partial' }),
      entry({ id: 2, action: 'retry_action', result: 'ok', after: { status: 'pending', attempts: 3, lastError: 'O Asaas não respondeu.' } }),
      entry({ id: 1, action: 'retry_event', result: 'ok', after: { processed: false, result: null } }),
    ]))
    render(<AuditTab {...tabProps} />)
    await screen.findByText('bloqueou')

    const chipIn = (action: string, label: string) => within(itemWith(action)).getByRole('button', { name: label })
    const done = chipIn('bloqueou', 'feito')
    expect(done.className).toContain('text-ps-or')
    expect(done.className).toContain('text-ps-sm')

    for (const [action, label] of [['desbloqueou', 'falhou'], ['ajustou a cota', 'em parte'], ['tentou pendência de novo', 'falhou de novo'], ['reprocessou aviso do Asaas', 'falhou de novo']]) {
      const chip = chipIn(action, label)
      expect(chip.className, label).not.toContain('text-ps-or')
      expect(within(chip).getByText(label).className, label).toContain('text-ps-alert')
    }
    // o Tentar agora que falhou de novo mostra o último erro do depois como mensagem
    expect(within(itemWith('tentou pendência de novo')).getByText('O Asaas não respondeu.')).toBeTruthy()
  })

  it('Ver antes e depois abre os dois JSON', async () => {
    h.adminGet.mockResolvedValue(pageOf([
      entry({ action: 'close_action', before: { action: 'refund_payment', status: 'pending' }, after: { status: 'done', doneNote: 'admin: estornado' } }),
    ]))
    render(<AuditTab {...tabProps} />)
    await screen.findByText('fechou pendência')
    const toggle = screen.getByRole('button', { name: 'Ver antes e depois' })
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByText(/"refund_payment"/)).toBeNull()

    fireEvent.click(toggle)
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    const before = screen.getByText(/"refund_payment"/)
    const after = screen.getByText(/"admin: estornado"/)
    expect(before.textContent).toBe('{\n  "action": "refund_payment",\n  "status": "pending"\n}')
    expect(after.textContent).toBe('{\n  "status": "done",\n  "doneNote": "admin: estornado"\n}')
    for (const el of [before, after]) expect(el.className).toContain('ps-num')
    expect(toggle.textContent).toBe('Esconder antes e depois')

    fireEvent.click(toggle)
    expect(screen.queryByText(/"refund_payment"/)).toBeNull()
  })

  it('antes ou depois vazio aparece como sem dado', async () => {
    h.adminGet.mockResolvedValue(pageOf([entry({ action: 'cancel_subscription', result: 'pending', before: { status: 'active' }, after: null })]))
    render(<AuditTab {...tabProps} />)
    await screen.findByText('cancelou a assinatura')
    fireEvent.click(screen.getByRole('button', { name: 'Ver antes e depois' }))
    const item = itemWith('cancelou a assinatura')
    expect(within(item).getByText('sem dado').className).toContain('ps-num')
  })

  it('sem registros mostra Nenhuma ação registrada ainda.', async () => {
    h.adminGet.mockResolvedValue(pageOf([]))
    render(<AuditTab {...tabProps} />)
    expect(await screen.findByText('Nenhuma ação registrada ainda.')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Anteriores' })).toBeNull()
  })

  it('Anteriores pede a página seguinte e Mais novos volta', async () => {
    const rows = Array.from({ length: 50 }, (_, i) => entry({ id: 200 - i }))
    h.adminGet.mockImplementation(async (_action: string, params: { page: number }) =>
      pageOf(params.page === 3 ? [entry({ id: 1, action: 'unblock' })] : rows, { total: 101, page: params.page }))
    render(<AuditTab {...tabProps} />)
    await screen.findAllByText('conferiu marcação')
    const older = screen.getByRole('button', { name: 'Anteriores' }) as HTMLButtonElement
    const newer = screen.getByRole('button', { name: 'Mais novos' }) as HTMLButtonElement
    expect(newer.disabled).toBe(true)
    expect(older.disabled).toBe(false)
    expect(screen.getByText('Página 1 de 3')).toBeTruthy()

    fireEvent.click(older)
    await waitFor(() => expect(h.adminGet).toHaveBeenLastCalledWith('audit', { page: 2 }))
    await screen.findByText('Página 2 de 3')
    await waitFor(() => expect(newer.disabled).toBe(false))

    fireEvent.click(older)
    await screen.findByText('desbloqueou')
    expect(h.adminGet).toHaveBeenLastCalledWith('audit', { page: 3 })
    expect(older.disabled).toBe(true)

    fireEvent.click(newer)
    await waitFor(() => expect(h.adminGet).toHaveBeenLastCalledWith('audit', { page: 2 }))
    await screen.findByText('Página 2 de 3')
  })

  it('com userId pede só o registro dessa conta', async () => {
    h.adminGet.mockResolvedValue(pageOf([entry()]))
    render(<AuditTab {...tabProps} userId={USER_ID} />)
    await screen.findByText('conferiu marcação')
    expect(h.adminGet).toHaveBeenCalledWith('audit', { page: 1, userId: USER_ID })
  })

  it('trocar de conta volta pra primeira página', async () => {
    const rows = Array.from({ length: 50 }, (_, i) => entry({ id: 100 - i }))
    h.adminGet.mockImplementation(async (_action: string, params: { page: number }) => pageOf(rows, { total: 120, page: params.page }))
    const { rerender } = render(<AuditTab {...tabProps} userId={USER_ID} />)
    await screen.findByText('Página 1 de 3')
    fireEvent.click(screen.getByRole('button', { name: 'Anteriores' }))
    await screen.findByText('Página 2 de 3')
    const other = '22222222-2222-4222-8222-222222222222'
    rerender(<AuditTab {...tabProps} userId={other} />)
    await waitFor(() => expect(h.adminGet).toHaveBeenLastCalledWith('audit', { page: 1, userId: other }))
    await screen.findByText('Página 1 de 3')
  })

  it('erro mostra a frase e Tentar de novo pede outra vez', async () => {
    h.adminGet.mockRejectedValueOnce(new AdminApiError('O servidor demorou demais pra responder. Tente de novo.', 0))
    h.adminGet.mockResolvedValueOnce(pageOf([entry()]))
    render(<AuditTab {...tabProps} />)
    expect(await screen.findByText('O servidor demorou demais pra responder. Tente de novo.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Tentar de novo' }))
    expect(await screen.findByText('conferiu marcação')).toBeTruthy()
    expect(h.adminGet).toHaveBeenCalledTimes(2)
  })

  it('nenhum texto da tela tem travessão', async () => {
    h.adminGet.mockResolvedValue(pageOf([
      entry({ id: 3, result: 'pending', finishedAt: null, before: null, after: null }),
      entry({ id: 2, action: 'retry_event', result: 'ok', after: { processed: false }, note: 'tentando de novo' }),
      entry({ id: 1, action: 'block', result: 'failed', message: 'Erro inesperado no servidor.', targetEmail: null, targetRef: null }),
    ], { total: 120 }))
    const { container } = render(<AuditTab {...tabProps} />)
    await screen.findByText('bloqueou')
    for (const toggle of screen.getAllByRole('button', { name: 'Ver antes e depois' })) fireEvent.click(toggle)
    expect(container.textContent?.includes(TRAVESSAO)).toBe(false)
  })
})

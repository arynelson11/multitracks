// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { SubscriberDetail } from './SubscriberDetail'
import { AdminApiError } from '../lib/adminApi'
import type { AuditEntry, AuditPage } from '../lib/auditTypes'
import type { ReviewAction } from '../lib/reviewTypes'
import type { SubscriberDetailData, SubscriberPayment, SubscriptionRow } from '../lib/subscribersTypes'

const h = vi.hoisted(() => ({ adminGet: vi.fn(), responses: {} as Record<string, unknown> }))

vi.mock('../lib/adminApi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/adminApi')>()),
  adminGet: h.adminGet,
}))
vi.mock('../../lib/supabase', () => ({ supabase: null, getAuthHeaders: async () => ({}) }))

const TRAVESSAO = String.fromCharCode(0x2014)
const USER = '22222222-2222-4222-8222-222222222222'
// O Intl põe espaço fixo (U+00A0) entre R$ e o número.
const norm = (s: string | null | undefined) => (s ?? '').replace(/\u00a0/g, ' ')

function subscription(over: Partial<SubscriptionRow> = {}): SubscriptionRow {
  return {
    id: 'sub-1', kind: 'asaas', planKey: 'essencial_mensal', cycle: 'MONTHLY', status: 'active', startedAt: '2026-10-01T12:00:00Z',
    nextDueDate: '2026-12-01', paidUntil: '2026-12-02T03:00:00+00:00', accessUntil: null, cancelSource: null, canceledAt: null,
    asaasSubscriptionId: 'sub_abc123', asaasStoppedAt: null, lastPaidDueDate: '2026-11-01', needsAdminReview: false, adminNote: null, ...over,
  }
}

function payment(over: Partial<SubscriberPayment> = {}): SubscriberPayment {
  return {
    paymentId: 'pay_111', userId: USER, email: 'ana@igreja.com', planKey: 'essencial_mensal', status: 'RECEIVED', value: 49.9, netValue: 47.91,
    dueDate: '2026-11-01', paymentDate: '2026-11-02', confirmedDate: null, refundedAt: null, lastEvent: 'PAYMENT_RECEIVED',
    lastEventAt: '2026-11-02T12:00:00Z', subscriptionRef: 'sub-1', originalDueDate: '2026-11-01', ...over,
  }
}

function action(over: Partial<ReviewAction> = {}): ReviewAction {
  return {
    id: 7, action: 'refund_payment', reason: 'estorno_recusado_pelo_asaas', autoRetry: false, attempts: 0, lastError: null,
    nextAttemptAt: '2026-11-16T21:30:00Z', createdAt: '2026-11-16T12:00:00Z', subscriptionRef: 'sub-1', asaasSubscriptionId: 'sub_abc123',
    paymentId: 'pay_111', dueDate: '2026-11-10', amount: 49.9, userId: USER, email: 'ana@igreja.com', planKey: 'essencial_mensal', ...over,
  }
}

function detail(over: Partial<SubscriberDetailData> = {}): SubscriberDetailData {
  return {
    profile: {
      userId: USER, email: 'ana@igreja.com', name: 'Ana Souza', provider: 'google', plan: 'essencial_mensal', planExpiresAt: null, isAdmin: false,
      blockedAt: null, blockedReason: null, createdAt: '2026-12-01T02:30:00Z', lastSignInAt: '2026-11-10T12:00:00Z', lastSeenAt: '2026-11-16T15:00:00Z',
    },
    quota: { used: 4, bonus: 10, periodStart: '2026-11-01', resetsAt: '2026-12-01', limit: 5 },
    subscriptions: [subscription()],
    payments: [payment()],
    legacyPayments: [],
    separations: { month: 3, total: 41 },
    aiCost: { monthBrl: 1.23, totalBrl: 17.5, jobsWithoutCost: 3 },
    openActions: [],
    plans: [
      { key: 'essencial_mensal', label: 'Pro Mensal', value: 49.9, cycle: 'MONTHLY' },
      { key: 'pro_mensal', label: 'Studio Mensal', value: 119.9, cycle: 'MONTHLY' },
    ],
    asaasLive: [{ subscriptionRef: 'sub-1', ok: true, status: 'ACTIVE', value: 49.9, cycle: 'MONTHLY', openDueDate: '2026-12-01', deleted: false }],
    mismatches: [],
    ...over,
  }
}

function auditEntry(over: Partial<AuditEntry> = {}): AuditEntry {
  return {
    id: 1, createdAt: '2026-11-16T15:00:00Z', finishedAt: '2026-11-16T15:00:01Z', adminEmail: 'admin@igreja.com', action: 'block',
    targetUserId: USER, targetEmail: 'ana@igreja.com', targetRef: null, result: 'ok', message: null, note: null, before: null, after: null, ...over,
  }
}

const auditPage = (rows: AuditEntry[], total = rows.length): AuditPage => ({ total, page: 1, pageSize: 50, rows })

beforeEach(() => {
  h.adminGet.mockReset()
  h.responses = { subscriber: detail(), audit: auditPage([]) }
  h.adminGet.mockImplementation(async (name: string) => {
    if (!Object.hasOwn(h.responses, name)) throw new AdminApiError(`Ação desconhecida: ${name}`, 400)
    const r = h.responses[name]
    if (r instanceof Error) throw r
    return r
  })
})
afterEach(cleanup)

const props = { userId: USER, onClose: () => {}, onNavigate: () => {} }
const region = (name: string) => screen.getByRole('region', { name })
// O valor de um campo da lista de dados (dt seguido do dd).
const field = (scope: HTMLElement, label: string) => norm(within(scope).getByText(label).nextElementSibling?.textContent)

describe('SubscriberDetail', () => {
  it('pede a ficha e o registro da conta e mostra a conta com datas de Brasília', async () => {
    render(<SubscriberDetail {...props} />)
    expect(screen.getByText('Carregando...')).toBeTruthy()
    await screen.findByRole('heading', { name: 'Ana Souza' })
    expect(h.adminGet).toHaveBeenCalledWith('subscriber', { userId: USER })
    expect(h.adminGet).toHaveBeenCalledWith('audit', { page: 1, userId: USER })

    const dialog = screen.getByRole('dialog', { name: 'Ana Souza' })
    expect(dialog.getAttribute('aria-modal')).toBe('true')
    expect(within(dialog).getAllByText('ana@igreja.com').length).toBeGreaterThan(0)

    const conta = region('Conta')
    // 01/12 02:30 UTC ainda é 30/11 em Brasília
    expect(field(conta, 'Cadastro')).toBe('30/11/2026')
    expect(field(conta, 'Último acesso')).toBe('16/11/2026 12:00')
    expect(field(conta, 'Último login')).toBe('10/11/2026 09:00')
    expect(field(conta, 'Entra com')).toBe('Google')
    expect(field(conta, 'Plano no app')).toBe('Pro Mensal')
    expect(field(conta, 'Bloqueio')).toBe('Não bloqueada')
    expect(field(conta, 'Id da conta')).toBe(USER)
  })

  it('conta bloqueada mostra desde quando e o motivo; sem último acesso fica sem dado', async () => {
    h.responses.subscriber = detail({
      profile: { ...detail().profile, blockedAt: '2026-11-16T15:00:00Z', blockedReason: 'Pediu reembolso no cartão e segue usando', lastSeenAt: null, planExpiresAt: '2026-12-17T03:00:00+00:00' },
    })
    render(<SubscriberDetail {...props} />)
    await screen.findByRole('heading', { name: 'Ana Souza' })
    const conta = region('Conta')
    expect(field(conta, 'Bloqueio')).toBe('Bloqueada desde 16/11/2026 12:00')
    expect(field(conta, 'Motivo do bloqueio')).toBe('Pediu reembolso no cartão e segue usando')
    expect(field(conta, 'Último acesso')).toBe('sem dado')
    expect(field(conta, 'Plano no app')).toBe('Pro Mensal, até 16/12/2026')
  })

  it('assinaturas com motivo do cancelamento e nota do admin', async () => {
    h.responses.subscriber = detail({
      subscriptions: [
        subscription(),
        subscription({
          id: 'sub-0', planKey: 'pro_mensal', status: 'canceled', nextDueDate: null, paidUntil: '2026-09-01T03:00:00+00:00', accessUntil: '2026-09-01T03:00:00+00:00',
          cancelSource: 'admin', canceledAt: '2026-09-15T12:00:00Z', needsAdminReview: true, adminNote: 'Valor do Asaas diferente | Conferir estorno',
        }),
        subscription({ id: 'cor-1', kind: 'courtesy', planKey: 'pro_anual', cycle: null, nextDueDate: null, paidUntil: null, asaasSubscriptionId: null, adminNote: 'Cortesia pro líder de louvor' }),
        // cortesia de 30 dias pedida às 22:00 de Brasília do dia 16/11 (courtesyUntil da T16)
        subscription({ id: 'cor-2', kind: 'courtesy', planKey: 'pro_mensal', cycle: null, nextDueDate: null, paidUntil: null, asaasSubscriptionId: null, accessUntil: '2026-12-17T03:00:00.000Z' }),
      ],
    })
    render(<SubscriberDetail {...props} />)
    await screen.findByRole('heading', { name: 'Ana Souza' })
    const subs = region('Assinaturas')
    const items = within(subs).getAllByRole('listitem')
    expect(items).toHaveLength(4)

    // O banco guarda os fins como 00:00 de Brasília do dia seguinte: a tela mostra o último dia.
    const active = items[0]
    expect(within(active).getByText('Pro Mensal, assinatura paga')).toBeTruthy()
    expect(within(active).getByText('ativa')).toBeTruthy()
    expect(field(active, 'Ciclo')).toBe('mensal')
    expect(field(active, 'Próxima cobrança')).toBe('01/12/2026')
    expect(field(active, 'Pago até')).toBe('01/12/2026')
    expect(field(active, 'Id no Asaas')).toBe('sub_abc123')

    const canceled = items[1]
    expect(within(canceled).getByText('encerrada')).toBeTruthy()
    expect(field(canceled, 'Motivo')).toBe('pelo admin')
    expect(field(canceled, 'Encerrada em')).toBe('15/09/2026 09:00')
    expect(field(canceled, 'Acesso até')).toBe('31/08/2026')
    expect(field(canceled, 'Pago até')).toBe('31/08/2026')
    const review = within(canceled).getByText('Para conferir')
    expect(review.className).toContain('text-ps-alert')
    expect(within(canceled).getByText('Valor do Asaas diferente')).toBeTruthy()
    expect(within(canceled).getByText('Conferir estorno')).toBeTruthy()

    const courtesy = items[2]
    expect(within(courtesy).getByText('Studio Anual, cortesia')).toBeTruthy()
    expect(field(courtesy, 'Acesso até')).toBe('sem data para acabar')
    expect(within(courtesy).getByText('Nota: Cortesia pro líder de louvor')).toBeTruthy()

    const dated = items[3]
    expect(within(dated).getByText('Studio Mensal, cortesia')).toBeTruthy()
    expect(field(dated, 'Acesso até')).toBe('16/12/2026')
  })

  it('pagamentos com status, valor, líquido, vencimento e pagamento', async () => {
    h.responses.subscriber = detail({
      payments: [
        payment({ paymentId: 'pay_222', status: 'OVERDUE', dueDate: '2026-11-10', paymentDate: null, confirmedDate: null }),
        payment({ paymentId: 'pay_111', status: 'RECEIVED', confirmedDate: '2026-12-01', paymentDate: '2026-11-30' }),
        payment({ paymentId: 'pay_000', status: 'REFUNDED', value: null, netValue: null, refundedAt: '2026-11-05T12:00:00Z' }),
      ],
    })
    render(<SubscriberDetail {...props} />)
    await screen.findByRole('heading', { name: 'Ana Souza' })
    const items = within(region('Pagamentos')).getAllByRole('listitem')
    expect(items).toHaveLength(3)

    expect(within(items[0]).getByText('vencida').className).toContain('text-ps-alert')
    expect(field(items[0], 'Pagamento')).toBe('sem dado')

    const paid = items[1]
    expect(within(paid).getByText('recebida').className).not.toContain('text-ps-alert')
    expect(field(paid, 'Valor')).toBe('R$ 49,90')
    expect(field(paid, 'Líquido')).toBe('R$ 47,91')
    expect(field(paid, 'Vencimento')).toBe('01/11/2026')
    // a data de pagamento é a de confirmação e o dia AAAA-MM-DD não volta um dia
    expect(field(paid, 'Pagamento')).toBe('01/12/2026')
    expect(within(paid).getByText('pay_111')).toBeTruthy()

    expect(field(items[2], 'Valor')).toBe('sem dado')
    expect(field(items[2], 'Estornada em')).toBe('05/11/2026')
  })

  it('uso e custo: separações, cota, custo de IA e trabalhos sem custo', async () => {
    render(<SubscriberDetail {...props} />)
    await screen.findByRole('heading', { name: 'Ana Souza' })
    const usage = region('Uso e custo')
    expect(field(usage, 'Separações no mês')).toBe('3')
    expect(field(usage, 'Separações no total')).toBe('41')
    expect(field(usage, 'Cota do mês')).toBe('4 / 5 + 10 extra')
    expect(field(usage, 'Renova em')).toBe('01/12/2026')
    expect(field(usage, 'Custo de IA no mês')).toBe('R$ 1,23')
    expect(field(usage, 'Custo de IA no total')).toBe('R$ 17,50')
    expect(within(usage).getByText('3 trabalhos sem custo')).toBeTruthy()
  })

  it('No Asaas agora mostra status, valor, ciclo e o vencimento da cobrança em aberto', async () => {
    render(<SubscriberDetail {...props} />)
    await screen.findByRole('heading', { name: 'Ana Souza' })
    const live = region('No Asaas agora')
    const item = within(live).getByRole('listitem')
    expect(within(item).getByText('Pro Mensal, assinatura paga')).toBeTruthy()
    expect(field(item, 'Status')).toBe('ativa')
    expect(field(item, 'Valor')).toBe('R$ 49,90')
    expect(field(item, 'Ciclo')).toBe('mensal')
    expect(field(item, 'Cobrança em aberto vence')).toBe('01/12/2026')
    expect(within(live).queryByText('Diferença entre o app e o Asaas')).toBeNull()
  })

  it('ficha mostra as diferenças com o Asaas em alerta', async () => {
    const lines = [
      'No Asaas o valor é R$ 119,90, mas o plano no app é Pro Mensal (R$ 49,90).',
      'No Asaas a cobrança em aberto vence em 16/12/2026, mas no app a próxima cobrança é 17/12/2026.',
    ]
    h.responses.subscriber = detail({
      asaasLive: [{ subscriptionRef: 'sub-1', ok: true, status: 'ACTIVE', value: 119.9, cycle: 'MONTHLY', openDueDate: '2026-12-16', deleted: false }],
      mismatches: lines,
    })
    render(<SubscriberDetail {...props} />)
    const title = await screen.findByText('Diferença entre o app e o Asaas')
    expect(title.className).toContain('text-ps-alert')
    const panel = title.parentElement as HTMLElement
    expect(panel.className).toContain('inset-ring-ps-alert-line')
    expect(within(panel).getAllByRole('listitem').map((li) => li.textContent)).toEqual(lines)
    expect(region('No Asaas agora').contains(panel)).toBe(true)
  })

  it('ficha com o Asaas fora mostra a frase e nenhuma diferença', async () => {
    h.responses.subscriber = detail({
      asaasLive: [{ subscriptionRef: 'sub-1', ok: false, error: 'O Asaas não respondeu agora.' }],
      mismatches: [],
    })
    render(<SubscriberDetail {...props} />)
    await screen.findByRole('heading', { name: 'Ana Souza' })
    const live = region('No Asaas agora')
    expect(within(live).getByText('O Asaas não respondeu agora.')).toBeTruthy()
    expect(within(live).queryByText('Status')).toBeNull()
    expect(screen.queryByText('Diferença entre o app e o Asaas')).toBeNull()
  })

  it('sem assinatura pra consultar, diz que não há nada no Asaas', async () => {
    h.responses.subscriber = detail({ subscriptions: [], asaasLive: [], payments: [] })
    render(<SubscriberDetail {...props} />)
    await screen.findByRole('heading', { name: 'Ana Souza' })
    expect(within(region('No Asaas agora')).getByText('Nenhuma assinatura pra consultar no Asaas.')).toBeTruthy()
    expect(within(region('Assinaturas')).getByText('Nenhuma assinatura.')).toBeTruthy()
    expect(within(region('Pagamentos')).getByText('Nenhum pagamento registrado.')).toBeTruthy()
  })

  it('pendências desta conta com link pra aba Pendências', async () => {
    const onNavigate = vi.fn()
    h.responses.subscriber = detail({
      openActions: [
        action(),
        action({ id: 8, action: 'inactivate_subscription', reason: 'rede_de_seguranca', autoRetry: true, attempts: 3, lastError: 'O Asaas não respondeu.' }),
      ],
    })
    render(<SubscriberDetail {...props} onNavigate={onNavigate} />)
    await screen.findByRole('heading', { name: 'Ana Souza' })
    const pend = region('Pendências desta conta')
    const items = within(pend).getAllByRole('listitem')
    expect(within(items[0]).getByText('Estornar à mão')).toBeTruthy()
    expect(within(items[0]).getByText('O Asaas recusou o estorno automático do arrependimento')).toBeTruthy()
    expect(within(items[0]).getByText('Precisa de você').className).toContain('text-ps-alert')
    expect(within(items[1]).getByText('Inativar assinatura no Asaas')).toBeTruthy()
    expect(within(items[1]).getByText('Tentando sozinha').className).not.toContain('text-ps-alert')
    expect(within(items[1]).getByText('O Asaas não respondeu.')).toBeTruthy()

    fireEvent.click(within(pend).getByRole('button', { name: 'Abrir Pendências' }))
    expect(onNavigate).toHaveBeenCalledWith('review')
  })

  it('sem pendência nem marcação não mostra o link', async () => {
    render(<SubscriberDetail {...props} />)
    await screen.findByRole('heading', { name: 'Ana Souza' })
    const pend = region('Pendências desta conta')
    expect(within(pend).getByText('Nenhuma pendência aberta desta conta.')).toBeTruthy()
    expect(within(pend).queryByRole('button', { name: 'Abrir Pendências' })).toBeNull()
  })

  it('registro desta conta mostra as 10 mais novas', async () => {
    const rows = Array.from({ length: 12 }, (_, i) => auditEntry({ id: 100 - i, action: i === 0 ? 'change_plan' : 'adjust_quota', result: i === 0 ? 'failed' : 'ok', message: i === 0 ? 'O Asaas recusou o pedido. Status do Asaas: 400.' : null }))
    h.responses.audit = auditPage(rows, 12)
    render(<SubscriberDetail {...props} />)
    await screen.findByText('mudou o plano')
    const log = region('Registro desta conta')
    const items = within(log).getAllByRole('listitem')
    expect(items).toHaveLength(10)
    expect(within(items[0]).getByText('falhou').className).toContain('text-ps-alert')
    expect(within(items[0]).getByText('O Asaas recusou o pedido. Status do Asaas: 400.')).toBeTruthy()
    expect(within(items[0]).getByText('16/11/2026 12:00')).toBeTruthy()
    expect(within(items[1]).getByText('feito').className).toContain('text-ps-or')
    expect(within(log).getByText('Mostrando as 10 mais novas de 12.')).toBeTruthy()
  })

  it('registro com erro mostra a frase e Tentar de novo sem derrubar a ficha', async () => {
    h.responses.audit = new AdminApiError('O servidor demorou demais pra responder. Tente de novo.', 0)
    render(<SubscriberDetail {...props} />)
    const log = await screen.findByRole('region', { name: 'Registro desta conta' })
    await within(log).findByText('O servidor demorou demais pra responder. Tente de novo.')
    expect(region('Conta')).toBeTruthy()
    h.responses.audit = auditPage([])
    fireEvent.click(within(log).getByRole('button', { name: 'Tentar de novo' }))
    expect(await within(log).findByText('Nenhuma ação do admin nesta conta.')).toBeTruthy()
  })

  it('renderActions no topo recebe a ficha e o recarregar', async () => {
    const renderActions = vi.fn((d: SubscriberDetailData, reload: () => void) => (
      <button type="button" onClick={reload}>{`Ações de ${d.profile.email}`}</button>
    ))
    render(<SubscriberDetail {...props} renderActions={renderActions} />)
    const button = await screen.findByRole('button', { name: 'Ações de ana@igreja.com' })
    expect(renderActions.mock.lastCall?.[0]).toEqual(detail())
    // fica acima das seções
    expect(button.compareDocumentPosition(region('Conta')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()

    const before = h.adminGet.mock.calls.length
    fireEvent.click(button)
    await waitFor(() => expect(h.adminGet.mock.calls.length).toBe(before + 2))
    expect(h.adminGet.mock.calls.slice(before).map((c) => c[0]).sort()).toEqual(['audit', 'subscriber'])
  })

  it('ficha fora do formato mostra a frase e Tentar de novo', async () => {
    h.responses.subscriber = { profile: null }
    const renderActions = vi.fn(() => null)
    render(<SubscriberDetail {...props} renderActions={renderActions} />)
    expect(await screen.findByText('Não deu pra carregar a ficha. Tente de novo.')).toBeTruthy()
    expect(renderActions).not.toHaveBeenCalled()
    h.responses.subscriber = detail()
    fireEvent.click(screen.getByRole('button', { name: 'Tentar de novo' }))
    expect(await screen.findByRole('heading', { name: 'Ana Souza' })).toBeTruthy()
  })

  it('ficha de outra conta não aparece nem chega às ações', async () => {
    h.responses.subscriber = detail({ profile: { ...detail().profile, userId: 'outra-conta' } })
    const renderActions = vi.fn(() => null)
    render(<SubscriberDetail {...props} renderActions={renderActions} />)
    expect(await screen.findByText('Não deu pra carregar a ficha. Tente de novo.')).toBeTruthy()
    expect(renderActions).not.toHaveBeenCalled()
  })

  it('erro do servidor mostra a frase dele', async () => {
    h.responses.subscriber = new AdminApiError('Conta não encontrada.', 404)
    render(<SubscriberDetail {...props} />)
    expect(await screen.findByText('Conta não encontrada.')).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Ficha do assinante' })).toBeTruthy()
  })

  it('Fechar e Esc chamam onClose, e o foco começa na ficha', async () => {
    const onClose = vi.fn()
    render(<SubscriberDetail {...props} onClose={onClose} />)
    await screen.findByRole('heading', { name: 'Ana Souza' })
    const dialog = screen.getByRole('dialog')
    expect(dialog.contains(document.activeElement)).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Fechar' }))
    fireEvent.keyDown(dialog, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(2)
  })

  it('painel lateral a partir de 1024 px e tela cheia abaixo, com alvos de 44 px', async () => {
    render(<SubscriberDetail {...props} />)
    await screen.findByRole('heading', { name: 'Ana Souza' })
    const dialog = screen.getByRole('dialog')
    expect(dialog.className).toContain('w-full')
    expect(dialog.className).toContain('lg:max-w-[560px]')
    expect(dialog.className).toContain('h-full')
    expect(screen.getByRole('button', { name: 'Fechar' }).className).toContain('min-h-ps-touch')
  })

  it('texto sem TRAVESSAO', async () => {
    h.responses.subscriber = detail({
      openActions: [action()],
      asaasLive: [{ subscriptionRef: 'sub-1', ok: false, error: 'O Asaas não respondeu agora.' }],
      mismatches: ['No Asaas o ciclo é mensal, mas o plano no app é anual.'],
      legacyPayments: [{ id: 'leg-1', planKey: 'pro_mensal', value: 39.9, cycle: null, paidAt: '2026-06-01T12:00:00Z' }],
    })
    h.responses.audit = auditPage([auditEntry()])
    const { container } = render(<SubscriberDetail {...props} />)
    await screen.findByText('bloqueou')
    expect(container.ownerDocument.body.textContent).not.toContain(TRAVESSAO)
  })
})

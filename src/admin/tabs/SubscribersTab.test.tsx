// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { SubscribersTab } from './SubscribersTab'
import { AdminApiError } from '../lib/adminApi'
import type { SubscriberDetailData, SubscriberPage, SubscriberRow } from '../lib/subscribersTypes'

const h = vi.hoisted(() => ({ adminGet: vi.fn(), responses: {} as Record<string, unknown> }))

vi.mock('../lib/adminApi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/adminApi')>()),
  adminGet: h.adminGet,
}))
vi.mock('../../lib/supabase', () => ({ supabase: null, getAuthHeaders: async () => ({}) }))

const TRAVESSAO = String.fromCharCode(0x2014)
const ANA = '11111111-1111-4111-8111-111111111111'
const LONG = 'maria.aparecida.dos.santos.ministerio.de.louvor@comunidadeevangelicadomontesiao.com.br'

function row(over: Partial<SubscriberRow> = {}): SubscriberRow {
  return {
    userId: ANA, email: 'ana@igreja.com', name: 'Ana Souza', plan: 'essencial_mensal', courtesyPlan: null, status: 'paid_active',
    nextDueDate: '2026-12-01', accessUntil: null, separationsMonth: 7, createdAt: '2026-11-01T12:00:00Z',
    lastSeenAt: '2026-12-01T02:30:00Z', lastSignInAt: '2026-11-01T12:00:00Z', flags: ['red', 'due7'], ...over,
  }
}

const pageOf = (rows: SubscriberRow[], over: Partial<SubscriberPage> = {}): SubscriberPage => ({ total: rows.length, page: 1, pageSize: 50, rows, ...over })

function detail(userId = ANA): SubscriberDetailData {
  return {
    profile: {
      userId, email: 'ana@igreja.com', name: 'Ana Souza', provider: 'email', plan: 'essencial_mensal', planExpiresAt: null, isAdmin: false,
      blockedAt: null, blockedReason: null, createdAt: '2026-11-01T12:00:00Z', lastSignInAt: null, lastSeenAt: null,
    },
    quota: { used: 1, bonus: 0, periodStart: '2026-11-01', resetsAt: '2026-12-01', limit: 5 },
    subscriptions: [], payments: [], legacyPayments: [], separations: { month: 1, total: 2 },
    aiCost: { monthBrl: 0.5, totalBrl: 1, jobsWithoutCost: 0 }, openActions: [], plans: [], asaasLive: [], mismatches: [],
  }
}

type Params = Record<string, string | number>
const subscriberCalls = () => h.adminGet.mock.calls.filter((c) => c[0] === 'subscribers').map((c) => c[1] as Params)

beforeEach(() => {
  h.adminGet.mockReset()
  h.responses = {
    subscribers: pageOf([row()]),
    subscriber: detail(),
    audit: { total: 0, page: 1, pageSize: 50, rows: [] },
  }
  h.adminGet.mockImplementation(async (name: string, params: Params) => {
    if (!Object.hasOwn(h.responses, name)) throw new AdminApiError(`Ação desconhecida: ${name}`, 400)
    const r = h.responses[name]
    if (r instanceof Error) throw r
    return typeof r === 'function' ? (r as (p: Params) => unknown)(params) : r
  })
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

const tabProps = { onNavigate: () => {}, focusUserId: null }
const rowButton = (name: string | RegExp) => screen.getByRole('button', { name })

describe('SubscribersTab', () => {
  it('pede a primeira página e mostra nome, e-mail, plano, status, data, separações, último acesso e marcações', async () => {
    render(<SubscribersTab {...tabProps} />)
    expect(screen.getByText('Carregando...')).toBeTruthy()
    const item = (await screen.findByText('Ana Souza')).closest('li') as HTMLElement
    expect(h.adminGet).toHaveBeenCalledWith('subscribers', { page: 1, sort: 'created' })

    expect(within(item).getByText('ana@igreja.com')).toBeTruthy()
    expect(within(item).getByText('Pro Mensal')).toBeTruthy()
    expect(within(item).getByText('Pagando')).toBeTruthy()
    expect(within(item).getByText('Próxima cobrança')).toBeTruthy()
    expect(within(item).getByText('01/12/2026')).toBeTruthy()
    expect(within(item).getByText('Separações no mês').nextElementSibling?.textContent).toBe('7')
    expect(within(item).getByText('Último acesso 30/11/2026 23:30')).toBeTruthy()
    // No vermelho precisa de você (âmbar); Vence em 7 dias é neutro
    expect(within(item).getByText('No vermelho').className).toContain('text-ps-alert')
    expect(within(item).getByText('Vence em 7 dias').className).not.toContain('text-ps-alert')
    expect(screen.getByText('1 a 1 de 1')).toBeTruthy()
  })

  it('sem nome mostra o e-mail; cortesia aparece com o plano dela; sem acesso cai pro login', async () => {
    h.responses.subscribers = pageOf([
      row({ userId: 'u2', name: null, email: LONG, status: 'courtesy', plan: 'pro_anual', courtesyPlan: 'pro_anual', nextDueDate: null, accessUntil: null, lastSeenAt: null, lastSignInAt: '2026-11-16T15:00:00Z', flags: [] }),
      row({ userId: 'u3', name: null, email: null, status: 'free', plan: 'free', nextDueDate: null, lastSeenAt: null, lastSignInAt: null, flags: ['inactive30'] }),
    ])
    render(<SubscribersTab {...tabProps} />)
    const courtesy = (await screen.findByText(LONG)).closest('li') as HTMLElement
    expect(within(courtesy).getByText('Cortesia')).toBeTruthy()
    expect(within(courtesy).getByText('Cortesia até')).toBeTruthy()
    expect(within(courtesy).getByText('sem data para acabar')).toBeTruthy()
    expect(within(courtesy).getByText('Último login 16/11/2026 12:00')).toBeTruthy()

    const noEmail = screen.getByText('u3').closest('li') as HTMLElement
    // plano e status: os dois são Livre
    expect(within(noEmail).getAllByText('Livre')).toHaveLength(2)
    // sem acesso nem login: o sem dado vem com o rótulo
    expect(within(noEmail).getByText('sem dado').previousElementSibling?.textContent).toBe('Último acesso')
    expect(within(noEmail).queryByText('Próxima cobrança')).toBeNull()
    expect(within(noEmail).getByText('Sumido há 30 dias')).toBeTruthy()
  })

  it('filtros viram parâmetros', async () => {
    render(<SubscribersTab {...tabProps} />)
    await screen.findByText('Ana Souza')
    fireEvent.click(screen.getByRole('radio', { name: 'Bloqueados' }))
    fireEvent.click(screen.getByRole('button', { name: 'No vermelho' }))
    await waitFor(() => expect(h.adminGet).toHaveBeenLastCalledWith('subscribers', { status: 'blocked', flag: 'red', page: 1, sort: 'created' }))
    expect(screen.getByRole('radio', { name: 'Bloqueados' }).getAttribute('aria-checked')).toBe('true')
    expect(screen.getByRole('button', { name: 'No vermelho' }).getAttribute('aria-pressed')).toBe('true')
  })

  it('marcação é uma por vez e clicar de novo tira o filtro', async () => {
    render(<SubscribersTab {...tabProps} />)
    await screen.findByText('Ana Souza')
    fireEvent.click(screen.getByRole('button', { name: 'No vermelho' }))
    fireEvent.click(screen.getByRole('button', { name: 'Para conferir' }))
    await waitFor(() => expect(h.adminGet).toHaveBeenLastCalledWith('subscribers', { flag: 'review', page: 1, sort: 'created' }))
    expect(screen.getByRole('button', { name: 'No vermelho' }).getAttribute('aria-pressed')).toBe('false')
    fireEvent.click(screen.getByRole('button', { name: 'Para conferir' }))
    await waitFor(() => expect(h.adminGet).toHaveBeenLastCalledWith('subscribers', { page: 1, sort: 'created' }))
  })

  it('plano e ordem viram parâmetros e voltam pra página 1', async () => {
    h.responses.subscribers = (p: Params) => pageOf(Array.from({ length: 50 }, (_, i) => row({ userId: `u${i}`, name: `Pessoa ${i}` })), { total: 132, page: Number(p.page) })
    render(<SubscribersTab {...tabProps} />)
    await screen.findByText('1 a 50 de 132')
    fireEvent.click(screen.getByRole('button', { name: 'Próxima' }))
    await screen.findByText('51 a 100 de 132')

    const plan = screen.getByLabelText('Plano') as HTMLSelectElement
    expect(Array.from(plan.options).map((o) => o.textContent)).toEqual(['Todos os planos', 'Pro Mensal', 'Pro Anual', 'Studio Mensal', 'Studio Anual'])
    fireEvent.change(plan, { target: { value: 'pro_mensal' } })
    await waitFor(() => expect(h.adminGet).toHaveBeenLastCalledWith('subscribers', { plan: 'pro_mensal', page: 1, sort: 'created' }))
    fireEvent.click(screen.getByRole('radio', { name: 'Mais separações' }))
    await waitFor(() => expect(h.adminGet).toHaveBeenLastCalledWith('subscribers', { plan: 'pro_mensal', page: 1, sort: 'separations' }))
    fireEvent.click(screen.getByRole('radio', { name: 'Último acesso' }))
    await waitFor(() => expect(h.adminGet).toHaveBeenLastCalledWith('subscribers', { plan: 'pro_mensal', page: 1, sort: 'last_seen' }))
  })

  it('busca espera 300 ms', async () => {
    render(<SubscribersTab {...tabProps} />)
    await screen.findByText('Ana Souza')
    vi.useFakeTimers()
    const search = screen.getByLabelText('Buscar') as HTMLInputElement
    expect(search.placeholder).toBe('Nome, e-mail ou id')
    fireEvent.change(search, { target: { value: 'an' } })
    act(() => { vi.advanceTimersByTime(200) })
    fireEvent.change(search, { target: { value: ' ana ' } })
    act(() => { vi.advanceTimersByTime(299) })
    expect(subscriberCalls().some((p) => 'q' in p)).toBe(false)
    act(() => { vi.advanceTimersByTime(1) })
    expect(subscriberCalls().filter((p) => 'q' in p)).toEqual([{ q: 'ana', page: 1, sort: 'created' }])
    vi.useRealTimers()
    await waitFor(() => expect(screen.getByText('Ana Souza')).toBeTruthy())
  })

  it('paginação mostra 51 a 100 de 132 na página 2', async () => {
    h.responses.subscribers = (p: Params) => {
      const page = Number(p.page)
      const count = page === 3 ? 32 : 50
      return pageOf(Array.from({ length: count }, (_, i) => row({ userId: `p${page}-${i}`, name: `Pessoa ${page}-${i}` })), { total: 132, page })
    }
    render(<SubscribersTab {...tabProps} />)
    await screen.findByText('1 a 50 de 132')
    const prev = screen.getByRole('button', { name: 'Anterior' }) as HTMLButtonElement
    const next = screen.getByRole('button', { name: 'Próxima' }) as HTMLButtonElement
    expect(prev.disabled).toBe(true)
    expect(next.disabled).toBe(false)

    fireEvent.click(next)
    expect(await screen.findByText('51 a 100 de 132')).toBeTruthy()
    expect(h.adminGet).toHaveBeenLastCalledWith('subscribers', { page: 2, sort: 'created' })
    expect(screen.getByText('Pessoa 2-0')).toBeTruthy()
    expect(prev.disabled).toBe(false)

    fireEvent.click(next)
    expect(await screen.findByText('101 a 132 de 132')).toBeTruthy()
    expect(next.disabled).toBe(true)
    fireEvent.click(prev)
    expect(await screen.findByText('51 a 100 de 132')).toBeTruthy()
  })

  it('clicar na linha abre a ficha e Fechar volta pra lista', async () => {
    render(<SubscribersTab {...tabProps} />)
    await screen.findByText('Ana Souza')
    expect(screen.queryByRole('dialog')).toBeNull()
    fireEvent.click(rowButton(/Ana Souza/))
    expect(await screen.findByRole('dialog', { name: 'Ana Souza' })).toBeTruthy()
    expect(h.adminGet).toHaveBeenCalledWith('subscriber', { userId: ANA })
    fireEvent.click(screen.getByRole('button', { name: 'Fechar' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.getByText('Ana Souza')).toBeTruthy()
  })

  it('focusUserId abre a ficha', async () => {
    h.responses.subscriber = detail('u-foco')
    render(<SubscribersTab onNavigate={() => {}} focusUserId="u-foco" />)
    expect(await screen.findByRole('dialog', { name: 'Ana Souza' })).toBeTruthy()
    expect(h.adminGet).toHaveBeenCalledWith('subscriber', { userId: 'u-foco' })
  })

  it('focusUserId novo com a aba aberta troca a ficha', async () => {
    const { rerender } = render(<SubscribersTab {...tabProps} />)
    await screen.findByText('Ana Souza')
    h.responses.subscriber = detail('u-outro')
    rerender(<SubscribersTab onNavigate={() => {}} focusUserId="u-outro" />)
    expect(await screen.findByRole('dialog', { name: 'Ana Souza' })).toBeTruthy()
    expect(h.adminGet).toHaveBeenCalledWith('subscriber', { userId: 'u-outro' })
  })

  it('renderActions recebe a ficha', async () => {
    const renderActions = vi.fn((d: SubscriberDetailData, reload: () => void) => (
      <button type="button" onClick={reload}>{`Ações de ${d.profile.email}`}</button>
    ))
    render(<SubscribersTab onNavigate={() => {}} focusUserId={ANA} renderActions={renderActions} />)
    const button = await screen.findByRole('button', { name: 'Ações de ana@igreja.com' })
    expect(renderActions.mock.lastCall?.[0]).toEqual(detail())
    expect(typeof renderActions.mock.lastCall?.[1]).toBe('function')

    // Recarregar depois de uma ação traz de novo a ficha, o registro dela e a lista.
    await screen.findByText('1 a 1 de 1')
    const before = h.adminGet.mock.calls.length
    fireEvent.click(button)
    await waitFor(() => expect(h.adminGet.mock.calls.length).toBe(before + 3))
    expect(h.adminGet.mock.calls.slice(before).map((c) => c[0]).sort()).toEqual(['audit', 'subscriber', 'subscribers'])
  })

  it('Pendências desta conta leva pra aba Pendências', async () => {
    const onNavigate = vi.fn()
    h.responses.subscriber = { ...detail(), subscriptions: [], openActions: [{
      id: 7, action: 'refund_payment', reason: 'estorno_recusado_pelo_asaas', autoRetry: false, attempts: 0, lastError: null, nextAttemptAt: '2026-11-16T21:30:00Z',
      createdAt: '2026-11-16T12:00:00Z', subscriptionRef: 'sub-1', asaasSubscriptionId: null, paymentId: 'pay_1', dueDate: null, amount: 49.9, userId: ANA,
      email: 'ana@igreja.com', planKey: 'essencial_mensal',
    }] }
    render(<SubscribersTab onNavigate={onNavigate} focusUserId={ANA} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Abrir Pendências' }))
    expect(onNavigate).toHaveBeenCalledWith('review')
  })

  it('lista fora do formato mostra a frase e Tentar de novo', async () => {
    h.responses.subscribers = { rows: 'nada' }
    render(<SubscribersTab {...tabProps} />)
    expect(await screen.findByText('Não deu pra carregar os assinantes. Tente de novo.')).toBeTruthy()
    // os filtros continuam na tela
    expect(screen.getByLabelText('Buscar')).toBeTruthy()
    h.responses.subscribers = pageOf([row()])
    fireEvent.click(screen.getByRole('button', { name: 'Tentar de novo' }))
    expect(await screen.findByText('Ana Souza')).toBeTruthy()
  })

  it('erro do servidor mostra a frase dele', async () => {
    h.responses.subscribers = new AdminApiError('Filtro inválido.', 400)
    render(<SubscribersTab {...tabProps} />)
    expect(await screen.findByText('Filtro inválido.')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Tentar de novo' })).toBeTruthy()
  })

  it('nenhuma conta com os filtros', async () => {
    h.responses.subscribers = pageOf([])
    render(<SubscribersTab {...tabProps} />)
    expect(await screen.findByText('Nenhuma conta encontrada.')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Próxima' })).toBeNull()
  })

  it('alvos de 44 px e o seletor de plano sem largura fixa', async () => {
    render(<SubscribersTab {...tabProps} />)
    await screen.findByText('Ana Souza')
    expect(rowButton(/Ana Souza/).className).toContain('min-h-ps-touch')
    expect((screen.getByLabelText('Buscar') as HTMLElement).className).toContain('min-h-ps-touch')
    expect((screen.getByLabelText('Plano') as HTMLElement).className).toContain('min-h-ps-touch')
  })

  it('texto sem TRAVESSAO', async () => {
    h.responses.subscribers = pageOf([row(), row({ userId: 'u2', status: 'ending', accessUntil: '2026-12-10', flags: ['review', 'blocked', 'inactive30'] })])
    const { container } = render(<SubscribersTab onNavigate={() => {}} focusUserId={ANA} />)
    await screen.findByRole('dialog', { name: 'Ana Souza' })
    await screen.findAllByText('Último acesso 30/11/2026 23:30')
    expect(container.ownerDocument.body.textContent).not.toContain(TRAVESSAO)
  })
})

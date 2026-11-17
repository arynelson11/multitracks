// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { FinanceTab } from './FinanceTab'
import type { FinanceMonth, FinancePage, FinanceRow } from '../lib/financeTypes'

// O caractere montado em tempo de execução: assim este arquivo nunca o contém.
const TRAVESSAO = String.fromCharCode(0x2014)
const RULE = 'Estorno é feito no painel do Asaas. Antes de estornar, confira se a cobrança já não está estornada.'

// O adminApi e o useAdminQuery são os de verdade; só a renovação do token e o fetch são falsos.
vi.mock('../../lib/supabase', () => ({ supabase: null, getAuthHeaders: async () => ({ Authorization: 'Bearer t' }) }))

const ROW: FinanceRow = {
  paymentId: 'pay_1',
  userId: 'user-ana',
  email: 'ana@exemplo.com',
  planKey: 'essencial_mensal',
  status: 'RECEIVED',
  value: 29.9,
  netValue: 28.41,
  dueDate: '2026-11-10',
  paymentDate: '2026-11-11',
  confirmedDate: null,
  refundedAt: null,
  lastEvent: 'PAYMENT_RECEIVED',
  lastEventAt: '2026-11-11T13:00:00Z',
}

const OVERDUE = { paymentId: 'pay_2', userId: 'user-bia', email: 'bia@exemplo.com', planKey: 'pro_anual', dueDate: '2026-12-01', value: 299 }

const MONTHS: FinanceMonth[] = [
  { month: '2026-09', grossBrl: 250, netBrl: 240, byPlan: { essencial_mensal: 250 } },
  { month: '2026-10', grossBrl: 500, netBrl: 480, byPlan: { essencial_mensal: 200, pro_anual: 300 } },
  { month: '2026-11', grossBrl: 1000, netBrl: 950, byPlan: { pro_mensal: 1000 } },
]

function financePage(over: Partial<FinancePage> = {}): FinancePage {
  return {
    range: { from: '2026-11-01', to: '2026-11-30' },
    totals: { grossBrl: 1234.5, netBrl: 1180.25, paidCount: 42, refundedBrl: 59.8, overdueBrl: 299, overdueCount: 1 },
    byMonth: MONTHS,
    overdue: [OVERDUE],
    rows: [ROW],
    total: 1,
    page: 1,
    pageSize: 50,
    ...over,
  }
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

type Route = (q: URLSearchParams) => Response | Promise<Response>

/** Fetch falso que responde por ação, como o servidor; ação sem rota é recusada (400). */
function serve(routes: Record<string, Route>) {
  const fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(String(input), 'http://localhost')
    const action = url.searchParams.get('action') ?? ''
    const route = routes[action]
    return route ? route(url.searchParams) : json({ error: `Ação desconhecida: ${action}` }, 400)
  })
  vi.stubGlobal('fetch', fetch)
  return fetch
}

/** Parâmetros de cada pedido de uma ação, na ordem. */
function callsOf(fetch: ReturnType<typeof serve>, action: string): Record<string, string>[] {
  return fetch.mock.calls
    .map(([input]) => new URL(String(input), 'http://localhost').searchParams)
    .filter((q) => q.get('action') === action)
    .map((q) => Object.fromEntries(q))
}

// O real usa espaço que não quebra entre "R$" e o número.
const text = (el: Element | null) => (el?.textContent ?? '').replace(/\u00a0/g, ' ')
const tile = (name: string) => screen.getByRole('group', { name })
const monthItem = (label: string) => screen.getByText(label).closest('li') as HTMLElement
const rowItem = (id: string) => screen.getByText(id).closest('li') as HTMLElement
const bar = (container: HTMLElement, month: string) => container.querySelector<HTMLElement>(`[data-bar="${month}"]`)

function setup() {
  const onNavigate = vi.fn()
  const view = render(<FinanceTab onNavigate={onNavigate} focusUserId={null} />)
  return { ...view, onNavigate }
}

// Aba nova falsa: o window.open devolve esta janela, e o teste confere o que a tela fez com ela.
function fakeTab() {
  return { opener: {} as unknown, closed: false, close: vi.fn(), location: { replace: vi.fn() } }
}

beforeEach(() => {
  // Só o relógio é falso: os tetos de tempo do adminApi e o waitFor seguem com o tempo de verdade.
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-11-16T15:00:00Z'))
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  Reflect.deleteProperty(navigator, 'clipboard')
})

describe('FinanceTab', () => {
  it('abre em Este mês e pede 2026-11-01 a 2026-11-30, todas as cobranças, página 1', async () => {
    const fetch = serve({ finance: () => json(financePage()) })
    setup()
    expect(screen.getByText('Carregando...')).toBeTruthy()
    await screen.findByText('pay_1')
    expect(callsOf(fetch, 'finance')).toEqual([
      { action: 'finance', from: '2026-11-01', to: '2026-11-30', status: 'all', page: '1' },
    ])
    expect(screen.getByRole('radio', { name: 'Este mês' }).getAttribute('aria-checked')).toBe('true')
    expect(screen.getByRole('radio', { name: 'Todas' }).getAttribute('aria-checked')).toBe('true')
  })

  it('Mês passado em 16/11/2026 pede 2026-10-01 a 2026-10-31', async () => {
    const fetch = serve({ finance: () => json(financePage()) })
    setup()
    await screen.findByText('pay_1')
    fireEvent.click(screen.getByRole('radio', { name: 'Mês passado' }))
    await waitFor(() => expect(callsOf(fetch, 'finance')).toHaveLength(2))
    expect(callsOf(fetch, 'finance')[1]).toEqual({ action: 'finance', from: '2026-10-01', to: '2026-10-31', status: 'all', page: '1' })
  })

  it('Últimos 12 meses pede de 2025-12-01 a 2026-11-30', async () => {
    const fetch = serve({ finance: () => json(financePage()) })
    setup()
    await screen.findByText('pay_1')
    fireEvent.click(screen.getByRole('radio', { name: 'Últimos 12 meses' }))
    await waitFor(() => expect(callsOf(fetch, 'finance')).toHaveLength(2))
    expect(callsOf(fetch, 'finance')[1]).toMatchObject({ from: '2025-12-01', to: '2026-11-30' })
  })

  it('às 23:30 do dia 30 em Brasília, que já é dia 1º em UTC, Este mês ainda é novembro', async () => {
    vi.setSystemTime(new Date('2026-12-01T02:30:00Z'))
    const fetch = serve({ finance: () => json(financePage()) })
    setup()
    await screen.findByText('pay_1')
    expect(callsOf(fetch, 'finance')[0]).toMatchObject({ from: '2026-11-01', to: '2026-11-30' })
  })

  it('Vencidas pede status overdue', async () => {
    const fetch = serve({ finance: () => json(financePage()) })
    setup()
    await screen.findByText('pay_1')
    fireEvent.click(screen.getByRole('radio', { name: 'Vencidas' }))
    await waitFor(() => expect(callsOf(fetch, 'finance')).toHaveLength(2))
    expect(callsOf(fetch, 'finance')[1]).toEqual({ action: 'finance', from: '2026-11-01', to: '2026-11-30', status: 'overdue', page: '1' })
    // Cada filtro de status manda o nome que o servidor aceita.
    const sent: string[] = []
    for (const name of ['Pagas', 'Em aberto', 'Estornadas', 'Removidas', 'Todas']) {
      fireEvent.click(screen.getByRole('radio', { name }))
      await waitFor(() => expect(callsOf(fetch, 'finance')).toHaveLength(3 + sent.length))
      sent.push(callsOf(fetch, 'finance').at(-1)?.status ?? '')
    }
    expect(sent).toEqual(['paid', 'pending', 'refunded', 'deleted', 'all'])
  })

  it('trocar o filtro volta pra primeira página', async () => {
    const fetch = serve({
      finance: (q) => json(financePage({ total: 120, page: Number(q.get('page')), rows: [{ ...ROW, paymentId: `pay_p${q.get('page')}` }] })),
    })
    setup()
    await screen.findByText('pay_p1')
    expect(screen.getByText('Página 1 de 3')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Próxima página' }))
    await screen.findByText('pay_p2')
    expect(callsOf(fetch, 'finance')[1]).toMatchObject({ page: '2' })
    fireEvent.click(screen.getByRole('radio', { name: 'Pagas' }))
    await screen.findByText('pay_p1')
    expect(callsOf(fetch, 'finance')[2]).toMatchObject({ status: 'paid', page: '1' })
  })

  it('mostra os totais do período, o período em dias de Brasília e a frase do estorno, sem travessão', async () => {
    serve({ finance: () => json(financePage()) })
    const { container } = setup()
    await screen.findByText('pay_1')
    expect(text(tile('Recebido bruto'))).toContain('R$ 1.234,50')
    expect(text(tile('Líquido'))).toContain('R$ 1.180,25')
    expect(text(tile('Pagas'))).toContain('42')
    expect(text(tile('Estornado'))).toContain('R$ 59,80')
    // Só estorno confirmado entra no total (Ruling ADM-T22-totais).
    expect(text(tile('Estornado'))).toContain('Só estorno confirmado')
    // Vencimento dentro do período e ainda não paga (Ruling ADM-T22-totais).
    expect(text(tile('Vencido no período'))).toContain('R$ 299,00')
    expect(text(tile('Vencido no período'))).toContain('1 cobrança')
    expect(text(tile('Vencido no período'))).not.toContain('1 cobranças')
    expect(screen.getByText('De 01/11/2026 a 30/11/2026')).toBeTruthy()
    expect(screen.getByText(RULE)).toBeTruthy()
    expect(container.textContent).not.toContain(TRAVESSAO)
    // Números na fonte de números.
    expect(tile('Recebido bruto').querySelector('.ps-num')).not.toBeNull()
  })

  it('valor ausente nos totais e na cobrança aparece como sem dado, nunca R$ 0,00', async () => {
    const totals = { grossBrl: null, paidCount: null, refundedBrl: 0, overdueBrl: 299, overdueCount: null } as unknown as FinancePage['totals']
    serve({ finance: () => json(financePage({ totals, rows: [{ ...ROW, value: null, netValue: null, paymentDate: null }] })) })
    setup()
    await screen.findByText('pay_1')
    expect(text(tile('Recebido bruto'))).toContain('sem dado')
    expect(text(tile('Recebido bruto'))).not.toContain('R$ 0,00')
    // netBrl nem veio na resposta.
    expect(text(tile('Líquido'))).toContain('sem dado')
    expect(text(tile('Pagas'))).toContain('sem dado')
    expect(text(tile('Pagas'))).not.toMatch(/\b0\b/)
    // Zero de verdade continua zero.
    expect(text(tile('Estornado'))).toContain('R$ 0,00')
    expect(text(tile('Vencido no período'))).toContain('sem dado')
    const row = rowItem('pay_1')
    expect(text(row)).not.toContain('R$ 0,00')
    expect(text(within(row).getByText('Valor').parentElement)).toContain('sem dado')
    expect(text(within(row).getByText('Líquido').parentElement)).toContain('sem dado')
    expect(text(within(row).getByText('Pagamento').parentElement)).toContain('sem dado')
  })

  it('barras na proporção do maior mês', async () => {
    serve({ finance: () => json(financePage()) })
    const { container } = setup()
    await screen.findByText('pay_1')
    expect(bar(container, '2026-11')?.style.width).toBe('100%')
    expect(bar(container, '2026-10')?.style.width).toBe('50%')
    expect(bar(container, '2026-09')?.style.width).toBe('25%')
    // Valor escrito ao lado, separado por plano.
    const oct = monthItem('out/2026')
    expect(text(oct)).toContain('R$ 500,00')
    // O líquido fica sozinho na linha dele; os planos repartem o BRUTO (Ruling ADM-T22-byPlan).
    expect(text(within(oct).getByText('Líquido'))).toBe('Líquido R$ 480,00')
    expect(text(oct)).toContain('Bruto por plano: Pro Mensal R$ 200,00')
    expect(text(oct)).toContain('Studio Anual R$ 300,00')
  })

  it('mês sem valor fica fora da escala, sem barra, e aparece como sem dado', async () => {
    const byMonth = [
      { month: '2026-09', grossBrl: 200, netBrl: 190, byPlan: {} },
      { month: '2026-10', netBrl: null },
      { month: '2026-11', grossBrl: 400, netBrl: 380, byPlan: {} },
    ] as unknown as FinanceMonth[]
    serve({ finance: () => json(financePage({ byMonth })) })
    const { container } = setup()
    await screen.findByText('pay_1')
    // O mês ausente não estraga a proporção dos outros.
    expect(bar(container, '2026-11')?.style.width).toBe('100%')
    expect(bar(container, '2026-09')?.style.width).toBe('50%')
    expect(bar(container, '2026-10')).toBeNull()
    expect(text(monthItem('out/2026'))).toContain('sem dado')
    expect(text(monthItem('out/2026'))).toContain('Bruto por plano: sem dado')
    // Mês sem plano nenhum não mostra a linha vazia.
    expect(text(monthItem('nov/2026'))).not.toContain('Bruto por plano')
    expect(container.textContent).not.toContain('NaN')
  })

  it('No vermelho lista as vencidas e o e-mail leva à ficha', async () => {
    serve({ finance: () => json(financePage()) })
    const { onNavigate } = setup()
    await screen.findByText('pay_1')
    const red = screen.getByRole('region', { name: 'No vermelho' })
    const item = within(red).getByText('bia@exemplo.com').closest('li') as HTMLElement
    // Dia AAAA-MM-DD é dia de Brasília: 2026-12-01 aparece como 01/12/2026.
    expect(text(item)).toContain('01/12/2026')
    expect(text(item)).toContain('R$ 299,00')
    expect(text(item)).toContain('Studio Anual')
    fireEvent.click(within(red).getByRole('button', { name: 'bia@exemplo.com' }))
    expect(onNavigate).toHaveBeenCalledWith('subscribers', { userId: 'user-bia' })
  })

  it('a tabela mostra status, valor, líquido, vencimento, pagamento, conta e plano', async () => {
    serve({ finance: () => json(financePage()) })
    const { onNavigate } = setup()
    await screen.findByText('pay_1')
    const row = rowItem('pay_1')
    expect(text(row)).toContain('recebida')
    expect(text(within(row).getByText('Valor').parentElement)).toContain('R$ 29,90')
    expect(text(within(row).getByText('Líquido').parentElement)).toContain('R$ 28,41')
    expect(text(within(row).getByText('Vencimento').parentElement)).toContain('10/11/2026')
    expect(text(within(row).getByText('Pagamento').parentElement)).toContain('11/11/2026')
    expect(text(within(row).getByText('Plano').parentElement)).toContain('Pro Mensal')
    fireEvent.click(within(row).getByRole('button', { name: 'ana@exemplo.com' }))
    expect(onNavigate).toHaveBeenCalledWith('subscribers', { userId: 'user-ana' })
  })

  it('Ver no Asaas abre a fatura', async () => {
    const fetch = serve({
      finance: () => json(financePage()),
      'payment-link': (q) => json({ paymentId: q.get('id'), status: 'RECEIVED', invoiceUrl: 'https://www.asaas.com/i/abc1' }),
    })
    const tab = fakeTab()
    const open = vi.spyOn(window, 'open').mockImplementation(() => tab as unknown as Window)
    setup()
    await screen.findByText('pay_1')
    fireEvent.click(within(rowItem('pay_1')).getByRole('button', { name: 'Ver no Asaas' }))
    // A aba abre no próprio clique (o navegador bloqueia depois de um await) e recebe o endereço depois.
    expect(open).toHaveBeenCalledWith('', '_blank')
    expect(tab.opener).toBeNull()
    await waitFor(() => expect(tab.location.replace).toHaveBeenCalledWith('https://www.asaas.com/i/abc1'))
    expect(callsOf(fetch, 'payment-link')).toEqual([{ action: 'payment-link', id: 'pay_1' }])
    expect(open).toHaveBeenCalledTimes(1)
    expect(tab.close).not.toHaveBeenCalled()
  })

  it('Ver no Asaas sem link da fatura fecha a aba e avisa', async () => {
    serve({
      finance: () => json(financePage()),
      'payment-link': () => json({ paymentId: 'pay_1', status: 'RECEIVED', invoiceUrl: null }),
    })
    const tab = fakeTab()
    vi.spyOn(window, 'open').mockImplementation(() => tab as unknown as Window)
    setup()
    await screen.findByText('pay_1')
    fireEvent.click(within(rowItem('pay_1')).getByRole('button', { name: 'Ver no Asaas' }))
    await waitFor(() => expect(text(rowItem('pay_1'))).toContain('O Asaas não mandou o link da fatura.'))
    expect(tab.close).toHaveBeenCalledTimes(1)
    expect(tab.location.replace).not.toHaveBeenCalled()
  })

  it('Ver no Asaas com o Asaas fora fecha a aba e mostra a frase do servidor', async () => {
    serve({
      finance: () => json(financePage()),
      'payment-link': () => json({ error: 'O Asaas não respondeu agora.' }, 502),
    })
    const tab = fakeTab()
    vi.spyOn(window, 'open').mockImplementation(() => tab as unknown as Window)
    setup()
    await screen.findByText('pay_1')
    fireEvent.click(within(rowItem('pay_1')).getByRole('button', { name: 'Ver no Asaas' }))
    await waitFor(() => expect(text(rowItem('pay_1'))).toContain('O Asaas não respondeu agora.'))
    expect(tab.close).toHaveBeenCalledTimes(1)
  })

  it('dois cliques seguidos em Ver no Asaas abrem uma aba só e pedem a fatura uma vez', async () => {
    let release: (r: Response) => void = () => {}
    const fetch = serve({
      finance: () => json(financePage()),
      'payment-link': () => new Promise<Response>((resolve) => (release = resolve)),
    })
    const tab = fakeTab()
    const open = vi.spyOn(window, 'open').mockImplementation(() => tab as unknown as Window)
    setup()
    await screen.findByText('pay_1')
    const verNoAsaas = within(rowItem('pay_1')).getByRole('button', { name: 'Ver no Asaas' })
    fireEvent.click(verNoAsaas)
    fireEvent.click(verNoAsaas)
    expect(open).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(callsOf(fetch, 'payment-link')).toHaveLength(1))
    await act(async () => release(json({ paymentId: 'pay_1', status: 'RECEIVED', invoiceUrl: 'https://www.asaas.com/i/abc1' })))
    await waitFor(() => expect(tab.location.replace).toHaveBeenCalledWith('https://www.asaas.com/i/abc1'))
    expect(callsOf(fetch, 'payment-link')).toHaveLength(1)
    expect(open).toHaveBeenCalledTimes(1)
  })

  it('Ver no Asaas com endereço que não é https fecha a aba e avisa', async () => {
    for (const invoiceUrl of ['http://www.asaas.com/i/abc1', 'javascript:alert(1)', '']) {
      serve({
        finance: () => json(financePage()),
        'payment-link': () => json({ paymentId: 'pay_1', status: 'RECEIVED', invoiceUrl }),
      })
      const tab = fakeTab()
      vi.spyOn(window, 'open').mockImplementation(() => tab as unknown as Window)
      setup()
      await screen.findByText('pay_1')
      fireEvent.click(within(rowItem('pay_1')).getByRole('button', { name: 'Ver no Asaas' }))
      await waitFor(() => expect(text(rowItem('pay_1'))).toContain('O Asaas não mandou o link da fatura.'))
      expect(tab.close).toHaveBeenCalledTimes(1)
      expect(tab.location.replace).not.toHaveBeenCalled()
      cleanup()
      vi.restoreAllMocks()
    }
  })

  it('o total de cobranças sai com separador de milhar', async () => {
    serve({ finance: () => json(financePage({ total: 1234 })) })
    setup()
    await screen.findByText('pay_1')
    expect(text(screen.getByRole('region', { name: 'Cobranças' }))).toContain('1.234')
  })

  it('Copiar id copia pay_1', async () => {
    const writeText = vi.fn(async () => {})
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    serve({ finance: () => json(financePage()) })
    setup()
    await screen.findByText('pay_1')
    fireEvent.click(within(rowItem('pay_1')).getByRole('button', { name: 'Copiar id' }))
    expect(writeText).toHaveBeenCalledWith('pay_1')
    await waitFor(() => expect(text(rowItem('pay_1'))).toContain('Id copiado.'))
  })

  it('sem área de transferência, Copiar id mostra o id pra copiar à mão', async () => {
    serve({ finance: () => json(financePage()) })
    setup()
    await screen.findByText('pay_1')
    fireEvent.click(within(rowItem('pay_1')).getByRole('button', { name: 'Copiar id' }))
    await waitFor(() => expect(text(rowItem('pay_1'))).toContain('Não deu pra copiar. O id é pay_1.'))
  })

  it('trocar o período não mostra os números do período anterior enquanto carrega', async () => {
    let release: (r: Response) => void = () => {}
    let calls = 0
    serve({
      finance: () => {
        calls += 1
        if (calls === 1) return json(financePage())
        return new Promise<Response>((resolve) => (release = resolve))
      },
    })
    setup()
    await screen.findByText('pay_1')
    fireEvent.click(screen.getByRole('radio', { name: 'Mês passado' }))
    await waitFor(() => expect(calls).toBe(2))
    expect(screen.getByText('Carregando...')).toBeTruthy()
    expect(screen.queryByText('pay_1')).toBeNull()
    expect(screen.queryByRole('group', { name: 'Recebido bruto' })).toBeNull()
    await act(async () => release(json(financePage({ range: { from: '2026-10-01', to: '2026-10-31' }, rows: [{ ...ROW, paymentId: 'pay_out' }] }))))
    await screen.findByText('pay_out')
    expect(screen.getByText('De 01/10/2026 a 31/10/2026')).toBeTruthy()
  })

  it('resposta fora do formato mostra a frase pronta e Tentar de novo, sem quebrar a tela', async () => {
    let calls = 0
    serve({
      finance: () => {
        calls += 1
        return calls === 1 ? json({ range: { from: '2026-11-01', to: '2026-11-30' }, rows: 'x' }) : json(financePage())
      },
    })
    setup()
    expect(await screen.findByText('Não deu pra carregar o financeiro. Tente de novo.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Tentar de novo' }))
    await screen.findByText('pay_1')
  })

  it('erro do servidor mostra a frase dele e Tentar de novo', async () => {
    serve({ finance: () => json({ error: 'Escolha um período de até um ano.' }, 400) })
    setup()
    expect(await screen.findByText('Escolha um período de até um ano.')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Tentar de novo' })).toBeTruthy()
  })
})

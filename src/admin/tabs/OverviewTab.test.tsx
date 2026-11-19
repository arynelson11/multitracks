// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { OverviewTab } from './OverviewTab'
import { AdminApiError } from '../lib/adminApi'
import type { Overview } from '../lib/overviewTypes'
import type { Funnel } from '../lib/funnelTypes'

// Responde por ação, como o servidor (Ruling R3): a visão geral e o funil do Livre, que o painel
// do funil pede sozinho, têm cada um o seu formato e a sua fila de respostas.
const h = vi.hoisted(() => ({ adminGet: vi.fn(), overview: vi.fn(), funnel: vi.fn() }))

vi.mock('../lib/adminApi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/adminApi')>()),
  adminGet: h.adminGet,
}))
vi.mock('../../lib/supabase', () => ({ supabase: null, getAuthHeaders: async () => ({}) }))

// O caractere montado em tempo de execução: assim este arquivo nunca o contém.
const TRAVESSAO = String.fromCharCode(0x2014)
const MSG_BAD_SHAPE = 'Não deu pra carregar a visão geral. Tente de novo.'
const FX_SOURCE = '(PTAX de venda do Banco Central, sem IOF nem spread).'

// A resposta de `?action=funnel` (T2): um mês com números e um vazio.
const FUNNEL: Funnel = {
  months: [
    { month: '2026-11', label: 'novembro de 2026', signups: 3, firstSeparation: 2, paying: 1, medianDaysToPay: 2.5, offersShown: 0, offersUsed: 0, adsShown: 0, adsClicked: 0 },
    { month: '2026-10', label: 'outubro de 2026', signups: 0, firstSeparation: 0, paying: 0, medianDaysToPay: null, offersShown: 0, offersUsed: 0, adsShown: 0, adsClicked: 0 },
  ],
}

// Sem custo (Ruling ADM-sem-custo-visao): o alerta conta só o que a varredura ainda completa
// (alerts.withoutCostPending); as notas do custo e da margem contam o total (aiCost.withoutCost).
const QUIET = { manual: 0, auto: 0, blockedWithActiveSub: 0, withoutCostPending: 0, fxOld: false }
// aiCost do servidor (Ruling ADM-sem-custo-sql): o total e os pendentes vêm do mesmo admin_overview.
const aiCostWith = (withoutCost: number, withoutCostPending = 0) =>
  ({ jobs: 40, succeeded: 37, failed: 3, costBrl: 12.4, costUsd: 2.31, withoutCost, withoutCostPending })

// A resposta de `?action=overview` no formato do contrato (seção Arquitetura B do plano).
function overview(over: Partial<Overview> = {}): Overview {
  return {
    month: { start: '2026-11-01', end: '2026-11-30', label: 'novembro de 2026' },
    revenue: { grossBrl: 480.5, netBrl: 452.3, payments: 6, refundedBrl: 49.9, refunds: 1, disputed: 0 },
    mrrBrl: 172.7,
    subscribers: {
      activeByPlan: { essencial_mensal: 2, pro_anual: 1 },
      endingByPlan: { pro_mensal: 1 },
      courtesyByPlan: { essencial_mensal: 1 },
      overdueAccounts: 1,
      blockedWithActiveSub: 0,
      legacyPaid: 0,
    },
    cancellations: { total: 2, bySource: { user: 1, unpaid: 1 } },
    aiCost: { jobs: 40, succeeded: 37, failed: 3, costBrl: 12.4, costUsd: 2.31, withoutCost: 0, withoutCostPending: 0 },
    marginBrl: 439.9,
    fx: { date: '2026-11-16', rate: 5.37, ageDays: 0 },
    alerts: QUIET,
    ...over,
  }
}

// O Intl separa "R$" do número com espaço fixo; o teste compara com espaço comum.
const text = (el: Element | null): string => (el?.textContent ?? '').replace(/\u00a0/g, ' ')
const group = (name: string) => screen.getByRole('group', { name })
const alertsList = () => screen.getByRole('list', { name: 'Pedindo atenção' })
const fxLine = () => screen.getByText((_, el) => el?.tagName === 'P' && text(el).startsWith('Câmbio guardado mais recente:'))

async function show(data: unknown, onNavigate = vi.fn()) {
  h.overview.mockResolvedValue(data)
  const view = render(<OverviewTab onNavigate={onNavigate} focusUserId={null} />)
  await screen.findByRole('heading', { level: 2, name: /Visão geral/ })
  return { ...view, onNavigate }
}

beforeEach(() => {
  h.adminGet.mockReset()
  h.overview.mockReset()
  h.funnel.mockReset()
  h.funnel.mockResolvedValue(FUNNEL)
  // Ação sem resposta aqui é recusada como desconhecida (400), nunca com o corpo de outra ação.
  h.adminGet.mockImplementation(async (action: string, params?: unknown) => {
    if (action === 'overview') return h.overview(params)
    if (action === 'funnel') return h.funnel(params)
    throw new AdminApiError(`Ação desconhecida: ${action}`, 400)
  })
})
afterEach(cleanup)

describe('OverviewTab', () => {
  it('pede a ação overview e mostra o mês no título e os quatro números', async () => {
    h.overview.mockResolvedValue(overview())
    render(<OverviewTab onNavigate={vi.fn()} focusUserId={null} />)
    expect(screen.getByText('Carregando...')).toBeTruthy()
    await screen.findByRole('heading', { level: 2, name: 'Visão geral de novembro de 2026' })
    expect(h.adminGet).toHaveBeenCalledWith('overview', undefined)

    const received = group('Recebido no mês')
    expect(text(received)).toContain('R$ 480,50')
    expect(text(received)).toContain('Líquido R$ 452,30')
    expect(text(group('MRR'))).toContain('R$ 172,70')
    const ai = group('Custo de IA no mês')
    expect(text(ai)).toContain('R$ 12,40')
    expect(text(ai)).toContain('US$ 2,31')
    expect(text(group('Margem do mês'))).toContain('R$ 439,90')
    // os números grandes em ps-num
    for (const name of ['Recebido no mês', 'MRR', 'Custo de IA no mês', 'Margem do mês']) {
      expect(group(name).querySelector('.ps-num'), name).not.toBeNull()
    }
  })

  // FINAL-review, Minor 1: o estornado já saiu do recebido; estorno pedido, em andamento e
  // contestação não estão em nenhum dos dois e contam à parte.
  it('o estorno diz que já está fora do recebido, e estorno ou contestação contam à parte', async () => {
    await show(overview({ revenue: { grossBrl: 480.5, netBrl: 452.3, payments: 6, refundedBrl: 49.9, refunds: 1, disputed: 2 } }))
    const received = group('Recebido no mês')
    expect(text(received)).toContain('1 estorno, R$ 49,90, já fora do recebido')
    expect(text(received)).toContain('2 em estorno ou contestação, fora do recebido')
    cleanup()
    // Sem nenhum, a linha não aparece.
    await show(overview())
    expect(text(group('Recebido no mês'))).not.toContain('em estorno ou contestação')
  })

  it('sem a contagem de estorno ou contestação, a visão geral mostra a frase pronta', async () => {
    const data = overview()
    const revenue: Record<string, unknown> = { ...data.revenue }
    delete revenue.disputed
    h.overview.mockResolvedValue({ ...data, revenue })
    render(<OverviewTab onNavigate={vi.fn()} focusUserId={null} />)
    expect((await screen.findByRole('alert')).textContent).toBe(MSG_BAD_SHAPE)
  })

  it('a margem mostra a legenda do que fica de fora', async () => {
    await show(overview())
    expect(text(group('Margem do mês'))).toContain('receita líquida menos IA; sem R2, Supabase e Vercel')
  })

  it('sem alertas mostra Nada pedindo atenção agora.', async () => {
    const { container } = await show(overview())
    expect(screen.getByText('Nada pedindo atenção agora.')).toBeTruthy()
    expect(screen.queryByRole('list', { name: 'Pedindo atenção' })).toBeNull()
    expect(container.querySelector('.bg-ps-alert')).toBeNull()
  })

  it('alerta de pendências leva pra aba Pendências', async () => {
    const { onNavigate } = await show(overview({ alerts: { ...QUIET, manual: 3 } }))
    const button = within(alertsList()).getByRole('button', { name: '3 pendências precisam de você' })
    expect(button.querySelector('.bg-ps-alert')).not.toBeNull()
    fireEvent.click(button)
    expect(onNavigate).toHaveBeenCalledWith('review')
    expect(screen.queryByText('Nada pedindo atenção agora.')).toBeNull()
  })

  it('alerta de tentando sozinho leva pra Pendências', async () => {
    const { onNavigate } = await show(overview({ alerts: { ...QUIET, auto: 1 } }))
    const button = within(alertsList()).getByRole('button', { name: '1 aviso do Asaas ou pendência tentando sozinho' })
    expect(button.querySelector('.bg-ps-alert')).not.toBeNull()
    fireEvent.click(button)
    expect(onNavigate).toHaveBeenCalledWith('review')
  })

  it('trabalhos sem custo e câmbio velho levam pra Custos de IA; bloqueados com assinatura ativa, pra Assinantes', async () => {
    const data = overview({
      aiCost: aiCostWith(3, 3),
      fx: { date: '2026-11-10', rate: 5.41, ageDays: 6 },
      alerts: { manual: 0, auto: 0, blockedWithActiveSub: 2, withoutCostPending: 3, fxOld: true },
    })
    const { onNavigate } = await show(data)
    const list = alertsList()
    const cases: [string, string][] = [
      ['3 trabalhos ainda sem custo no mês', 'aicost'],
      ['2 bloqueados com assinatura ativa', 'subscribers'],
      ['Câmbio velho: de 10/11/2026, há 6 dias', 'aicost'],
    ]
    const buttons = within(list).getAllByRole('button')
    expect(buttons).toHaveLength(cases.length)
    for (const [name, tab] of cases) {
      // Pelo texto: o jsdom põe espaço em volta do span ps-num no nome acessível ("2026 , há").
      const button = buttons.find((b) => text(b) === name) as HTMLElement
      expect(button, name).toBeTruthy()
      expect(button.querySelector('.bg-ps-alert'), name).not.toBeNull()
      onNavigate.mockClear()
      fireEvent.click(button)
      expect(onNavigate, name).toHaveBeenCalledWith(tab)
    }
  })

  it('câmbio com mais de 4 dias: a linha do câmbio fica em âmbar e mostra a data', async () => {
    await show(overview({ fx: { date: '2026-11-10', rate: 5.41, ageDays: 6 }, alerts: { ...QUIET, fxOld: true } }))
    const line = fxLine()
    expect(text(line)).toBe(`Câmbio guardado mais recente: R$ 5,41 por US$ em 10/11/2026 ${FX_SOURCE}`)
    expect(line.className).toContain('text-ps-alert')
  })

  it('linha do câmbio em dia, sem âmbar', async () => {
    await show(overview())
    const line = fxLine()
    expect(text(line)).toBe(`Câmbio guardado mais recente: R$ 5,37 por US$ em 16/11/2026 ${FX_SOURCE}`)
    expect(line.className).not.toContain('text-ps-alert')
  })

  it('a linha do câmbio diz que é o guardado mais recente, PTAX de venda sem IOF nem spread, e que cada trabalho usa o do seu dia', async () => {
    await show(overview())
    expect(text(fxLine())).toContain('(PTAX de venda do Banco Central, sem IOF nem spread).')
    expect(screen.getByText('Cada trabalho usa o câmbio do próprio dia.')).toBeTruthy()
  })

  it('o MRR diz que sai da tabela de preços e pode diferir do cobrado', async () => {
    await show(overview())
    const mrr = group('MRR')
    expect(text(mrr)).toContain('Pela tabela de preços: assinaturas pagas que renovam, o anual dividido por 12.')
    expect(text(mrr)).toContain('Pode diferir do cobrado se o preço mudar ou se a assinatura for editada no painel do Asaas.')
  })

  it('assinaturas antigas sem registro ficam fora do MRR e a tela diz', async () => {
    const data = overview()
    await show({ ...data, subscribers: { ...data.subscribers, legacyPaid: 1 } })
    expect(text(group('MRR'))).toContain('Não inclui 1 assinatura antiga sem registro.')
  })

  it('câmbio sem dado mostra sem dado', async () => {
    await show(overview({ fx: { date: null, rate: null, ageDays: null }, alerts: { ...QUIET, fxOld: true } }))
    const line = fxLine()
    expect(text(line)).toBe(`Câmbio guardado mais recente: sem dado ${FX_SOURCE}`)
    expect(line.className).toContain('text-ps-alert')
    expect(within(alertsList()).getByRole('button', { name: 'Câmbio sem dado' })).toBeTruthy()
  })

  it('trabalhos sem custo ficam fora da soma e a tela diz isso no custo e na margem', async () => {
    await show(overview({
      aiCost: aiCostWith(3, 3),
      alerts: { ...QUIET, withoutCostPending: 3 },
    }))
    expect(text(group('Custo de IA no mês'))).toContain('3 trabalhos sem custo, fora da soma')
    expect(text(group('Margem do mês'))).toContain('Não inclui 3 trabalhos sem custo.')
  })

  const noteOf = (name: string, start: string) =>
    within(group(name)).getByText((_, el) => el?.tagName === 'P' && text(el).startsWith(start))

  it('só trabalhos sem preço conhecido: nenhum âmbar, e as notas do custo e da margem com o total', async () => {
    const { container } = await show(overview({ aiCost: aiCostWith(5), alerts: { ...QUIET, withoutCostPending: 0 } }))
    expect(screen.getByText('Nada pedindo atenção agora.')).toBeTruthy()
    expect(text(noteOf('Margem do mês', 'Não inclui'))).toBe('Não inclui 5 trabalhos sem custo.')
    expect(text(noteOf('Custo de IA no mês', '5 trabalhos'))).toBe('5 trabalhos sem custo, fora da soma')
    expect(container.querySelector('[class*="ps-alert"]')).toBeNull()
  })

  it('com pendentes, âmbar: o alerta conta os pendentes e as notas o total', async () => {
    const { onNavigate } = await show(overview({ aiCost: aiCostWith(7, 2), alerts: { ...QUIET, withoutCostPending: 2 } }))
    const button = within(alertsList()).getAllByRole('button').find((b) => text(b) === '2 trabalhos ainda sem custo no mês') as HTMLElement
    expect(button).toBeTruthy()
    expect(button.querySelector('.bg-ps-alert')).not.toBeNull()
    fireEvent.click(button)
    expect(onNavigate).toHaveBeenCalledWith('aicost')
    const margin = noteOf('Margem do mês', 'Não inclui')
    expect(text(margin)).toBe('Não inclui 7 trabalhos sem custo.')
    expect(margin.className).toContain('text-ps-alert')
    const cost = noteOf('Custo de IA no mês', '7 trabalhos')
    expect(text(cost)).toBe('7 trabalhos sem custo, fora da soma')
    expect(cost.className).toContain('text-ps-alert')
  })

  it('resposta sem a divisão do sem custo (servidor de antes) ou sem o total vira a frase pronta', async () => {
    const old = { manual: 0, auto: 0, blockedWithActiveSub: 0, withoutCost: 3, fxOld: false }
    h.overview.mockResolvedValueOnce({ ...overview(), alerts: old })
    const first = render(<OverviewTab onNavigate={vi.fn()} focusUserId={null} />)
    expect((await screen.findByRole('alert')).textContent).toBe(MSG_BAD_SHAPE)
    first.unmount()
    h.overview.mockResolvedValueOnce({ ...overview(), aiCost: { jobs: 40, succeeded: 37, failed: 3, costBrl: 12.4, costUsd: 2.31 } })
    render(<OverviewTab onNavigate={vi.fn()} focusUserId={null} />)
    expect((await screen.findByRole('alert')).textContent).toBe(MSG_BAD_SHAPE)
  })

  it('assinantes por plano: Pagando, Até o fim do período e Cortesia, e as contas no vermelho', async () => {
    await show(overview())
    const paying = group('Pagando')
    expect(text(paying)).toContain('Pro Mensal')
    expect(text(paying)).toContain('Studio Anual')
    expect(within(paying).getByText('3').className).toContain('ps-num')
    expect(text(group('Até o fim do período'))).toContain('Studio Mensal')
    expect(text(group('Cortesia'))).toContain('Pro Mensal')
    expect(screen.getByText((_, el) => el?.tagName === 'P' && text(el) === 'No vermelho: 1 conta')).toBeTruthy()
    // sem assinatura antiga, o atalho não aparece
    expect(screen.queryByRole('button', { name: /assinatura.* antiga/ })).toBeNull()
  })

  it('assinaturas antigas sem registro aparecem', async () => {
    const data = overview()
    const { onNavigate } = await show({ ...data, subscribers: { ...data.subscribers, legacyPaid: 2 } })
    const button = screen.getByRole('button', { name: '2 assinaturas antigas sem registro' })
    fireEvent.click(button)
    expect(onNavigate).toHaveBeenCalledWith('subscribers')
  })

  it('cancelamentos do mês por motivo', async () => {
    await show(overview({ cancellations: { total: 3, bySource: { user: 2, admin: 1 } } }))
    const box = group('Cancelamentos do mês')
    expect(text(box)).toContain('Pelo app')
    expect(text(box)).toContain('Pelo admin')
    expect(within(box).getByText('3').className).toContain('ps-num')
  })

  it('quantidades grandes com ponto de milhar', async () => {
    const data = overview()
    await show({
      ...data,
      revenue: { ...data.revenue, payments: 1234 },
      subscribers: { ...data.subscribers, activeByPlan: { essencial_mensal: 1200, pro_anual: 52 } },
      aiCost: { ...data.aiCost, jobs: 18342 },
      alerts: { ...QUIET, manual: 1500 },
    })
    expect(text(group('Recebido no mês'))).toContain('1.234 pagamentos')
    expect(text(group('Custo de IA no mês'))).toContain('em 18.342 trabalhos')
    expect(within(group('Pagando')).getByText('1.252')).toBeTruthy()
    expect(within(group('Pagando')).getByText('1.200')).toBeTruthy()
    expect(text(within(alertsList()).getByRole('button'))).toBe('1.500 pendências precisam de você')
  })

  it('sem cancelamento no mês diz isso', async () => {
    await show(overview({ cancellations: { total: 0, bySource: {} } }))
    expect(text(group('Cancelamentos do mês'))).toContain('Nenhum cancelamento no mês.')
  })

  it('valor ausente aparece como sem dado, nunca como 0', async () => {
    const data = overview()
    const broken = {
      ...data,
      revenue: { netBrl: 452.3, payments: 6, refundedBrl: 0, refunds: 0, disputed: 0 },
      subscribers: { activeByPlan: { essencial_mensal: 2 }, courtesyByPlan: { essencial_mensal: 'dois' }, blockedWithActiveSub: 0, legacyPaid: 0 },
      cancellations: { total: 1 },
    }
    await show(broken)
    const received = group('Recebido no mês')
    expect(text(received)).toContain('sem dado')
    expect(text(received)).not.toContain('R$ 0,00')
    expect(text(group('Até o fim do período'))).toContain('sem dado')
    expect(text(group('Cortesia'))).toContain('sem dado')
    expect(screen.getByText((_, el) => el?.tagName === 'P' && text(el) === 'No vermelho: sem dado')).toBeTruthy()
    expect(text(group('Cancelamentos do mês'))).toContain('sem dado')
  })

  it('resposta fora do formato mostra a frase pronta e Tentar de novo pede de novo', async () => {
    h.overview.mockResolvedValueOnce({ rows: [], total: 0 }).mockResolvedValueOnce(overview())
    render(<OverviewTab onNavigate={vi.fn()} focusUserId={null} />)
    expect((await screen.findByRole('alert')).textContent).toBe(MSG_BAD_SHAPE)
    fireEvent.click(screen.getByRole('button', { name: 'Tentar de novo' }))
    await screen.findByRole('heading', { level: 2, name: 'Visão geral de novembro de 2026' })
    expect(h.overview).toHaveBeenCalledTimes(2)
  })

  it('alertas fora do formato não viram Nada pedindo atenção', async () => {
    h.overview.mockResolvedValue({ ...overview(), alerts: { manual: '3', auto: 0, blockedWithActiveSub: 0, withoutCostPending: 0, fxOld: false } })
    render(<OverviewTab onNavigate={vi.fn()} focusUserId={null} />)
    expect((await screen.findByRole('alert')).textContent).toBe(MSG_BAD_SHAPE)
    expect(screen.queryByText('Nada pedindo atenção agora.')).toBeNull()
  })

  it('erro do servidor mostra a frase dele e Tentar de novo', async () => {
    h.overview.mockRejectedValue(new AdminApiError('Erro inesperado no servidor.', 500))
    render(<OverviewTab onNavigate={vi.fn()} focusUserId={null} />)
    expect((await screen.findByRole('alert')).textContent).toBe('Erro inesperado no servidor.')
    expect(screen.getByRole('button', { name: 'Tentar de novo' })).toBeTruthy()
  })

  it('Atualizar pede a visão geral de novo', async () => {
    await show(overview())
    await screen.findByRole('table', { name: 'Funil do Livre' })
    fireEvent.click(screen.getByRole('button', { name: 'Atualizar' }))
    await waitFor(() => expect(h.overview).toHaveBeenCalledTimes(2))
    // O funil foi pedido uma vez, quando a visão geral abriu, e continua na tela.
    expect(h.funnel).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('table', { name: 'Funil do Livre' })).toBeTruthy()
  })

  it('o funil do Livre aparece depois dos números do mês, pedido com 6 meses', async () => {
    await show(overview())
    const panel = screen.getByRole('group', { name: 'Funil do Livre' })
    await within(panel).findByRole('table', { name: 'Funil do Livre' })
    expect(h.adminGet).toHaveBeenCalledWith('funnel', { months: 6 })
    expect(h.funnel).toHaveBeenCalledTimes(1)
    expect(text(panel)).toContain('2 (67%)')
    // depois dos quatro números e antes dos assinantes
    const after = (a: Element, b: Element) => Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING)
    expect(after(group('Margem do mês'), panel)).toBe(true)
    expect(after(panel, group('Assinantes'))).toBe(true)
  })

  it('erro no funil fica no painel dele e não derruba os números do mês', async () => {
    h.funnel.mockReset()
    h.funnel.mockRejectedValueOnce(new AdminApiError('Erro inesperado no servidor.', 500)).mockResolvedValueOnce(FUNNEL)
    await show(overview())
    const panel = screen.getByRole('group', { name: 'Funil do Livre' })
    expect((await within(panel).findByRole('alert')).textContent).toBe('Erro inesperado no servidor.')
    expect(text(group('Recebido no mês'))).toContain('R$ 480,50')
    expect(screen.getAllByRole('alert')).toHaveLength(1)
    fireEvent.click(within(panel).getByRole('button', { name: 'Tentar de novo' }))
    await within(panel).findByRole('table', { name: 'Funil do Livre' })
    expect(h.funnel).toHaveBeenCalledTimes(2)
    expect(h.overview).toHaveBeenCalledTimes(1)
  })

  it('a visão geral sem resposta não pede o funil', async () => {
    h.overview.mockRejectedValue(new AdminApiError('Erro inesperado no servidor.', 500))
    render(<OverviewTab onNavigate={vi.fn()} focusUserId={null} />)
    await screen.findByRole('alert')
    expect(h.funnel).not.toHaveBeenCalled()
    expect(screen.queryByRole('group', { name: 'Funil do Livre' })).toBeNull()
  })

  it('botões com alvo de 44 px, só tokens ps-* e texto sem travessão', async () => {
    const data = overview({ aiCost: aiCostWith(1, 1), alerts: { manual: 1, auto: 2, blockedWithActiveSub: 1, withoutCostPending: 1, fxOld: true } })
    const { container } = await show({ ...data, subscribers: { ...data.subscribers, legacyPaid: 1 } })
    await screen.findByRole('table', { name: 'Funil do Livre' })
    const buttons = screen.getAllByRole('button')
    expect(buttons.length).toBe(7)
    for (const b of buttons) expect(b.className, b.textContent ?? '').toContain('min-h-ps-touch')
    expect(container.innerHTML).not.toContain('text-primary')
    expect(container.innerHTML).not.toMatch(/#[0-9a-fA-F]{3,6}\b/)
    expect(container.textContent).not.toContain(TRAVESSAO)
  })
})

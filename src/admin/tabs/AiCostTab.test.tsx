// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { AiCostTab } from './AiCostTab'
import { AdminApiError } from '../lib/adminApi'
import type { AiCosts, AiJob } from '../lib/aiCostsTypes'

// O caractere montado em tempo de execução: assim este arquivo nunca o contém.
const TRAVESSAO = String.fromCharCode(0x2014)
// Frase do Registro: a resposta da ação não chegou e o servidor pode ter feito (Ruling ADM-T4-incerto).
const LOST = 'A resposta do servidor não chegou. Confira no Registro se a ação foi feita antes de tentar de novo.'
const SWEEP = 'Completar custos que faltam'

const h = vi.hoisted(() => ({ adminPost: vi.fn(), adminGet: vi.fn(), served: null as unknown }))

vi.mock('../lib/adminApi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/adminApi')>()),
  adminPost: h.adminPost,
  adminGet: h.adminGet,
}))
vi.mock('../../lib/supabase', () => ({ supabase: null, getAuthHeaders: async () => ({}) }))

const JOB_OK: AiJob = {
  replicateId: 'r_ok_1a2b3c',
  createdAt: '2026-11-17T17:32:00Z',
  userId: 'user-ana',
  email: 'ana@exemplo.com',
  model: 'htdemucs',
  stemCount: 4,
  status: 'succeeded',
  predictSeconds: 83.4,
  hardware: 'gpu-t4',
  costUsd: 0.018765,
  costBrl: 0.11,
  fxRate: 5.8612,
  fxDate: '2026-11-17',
}
// Gravado sem câmbio: tem dólar e não tem real. Conta como sem custo (Aviso T19).
const JOB_USD_ONLY: AiJob = { ...JOB_OK, replicateId: 'r_usd_only', costUsd: 0.05, costBrl: null, fxRate: null, fxDate: null }
const JOB_UNKNOWN: AiJob = {
  ...JOB_OK,
  replicateId: 'r_9x8y7z',
  status: 'unknown',
  predictSeconds: null,
  hardware: null,
  costUsd: null,
  costBrl: null,
  fxRate: null,
  fxDate: null,
}
const JOB_DELETED: AiJob = { ...JOB_OK, replicateId: 'r_deleted', userId: null, email: null }

function costs(over: Partial<AiCosts> = {}): AiCosts {
  return {
    range: { from: '2026-11-01', to: '2026-11-30' },
    totals: {
      jobs: 14,
      succeeded: 11,
      failed: 2,
      canceled: 0,
      unknown: 1,
      withoutCost: 3,
      costUsd: 2.1,
      costBrl: 12.34,
      avgBrlPerSucceeded: 1.1218,
      predictSeconds: 3725,
    },
    byUser: [
      { userId: 'user-ana', email: 'ana@exemplo.com', jobs: 9, costBrl: 8.5 },
      { userId: null, email: null, jobs: 2, costBrl: 0.3 },
    ],
    byModel: [
      { model: 'htdemucs', stemCount: 4, jobs: 10, costBrl: 9.2, avgSeconds: 61.5 },
      { model: 'htdemucs_6s', stemCount: 6, jobs: 4, costBrl: 3.14, avgSeconds: 95 },
    ],
    fx: { minDate: '2026-11-03', maxDate: '2026-11-17' },
    rows: [JOB_OK, JOB_USD_ONLY, JOB_UNKNOWN, JOB_DELETED],
    total: 4,
    page: 1,
    pageSize: 50,
    prices: { checkedAt: '2026-11-17', source: 'https://replicate.com/pricing', table: [{ hardware: 'gpu-t4', usdPerSecond: 0.000225 }] },
    sweep: { recorded: 0, unknown: 0, failed: 0, brlCompleted: 0, more: false, skipped: false },
    ...over,
  }
}

const noCost = (n: number) => costs({ totals: { ...costs().totals, withoutCost: n } })

function deferred<T>() {
  let resolve!: (v: T) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

function setup() {
  const onNavigate = vi.fn()
  const view = render(<AiCostTab onNavigate={onNavigate} focusUserId={null} />)
  return { ...view, onNavigate }
}

/** Espera a tela com os números (o primeiro pedido respondido). */
const ready = () => screen.findByRole('heading', { name: 'Trabalhos' })
const sweepButton = () => screen.getByRole('button', { name: SWEEP }) as HTMLButtonElement
const jobRow = (replicateId: string) => screen.getByText(replicateId).closest('li') as HTMLElement

beforeEach(() => {
  h.adminPost.mockReset()
  h.adminGet.mockReset()
  h.served = costs()
  // Cada resposta é um objeto novo, como o JSON lido do servidor.
  h.adminGet.mockImplementation(async () => structuredClone(h.served))
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('AiCostTab', () => {
  it('mostra "3 trabalhos sem custo" e a data do câmbio', async () => {
    const { container } = setup()
    await ready()
    expect(screen.getByRole('heading', { name: '3 trabalhos sem custo' })).toBeTruthy()
    expect(sweepButton().disabled).toBe(false)
    const text = container.textContent ?? ''
    expect(text).toContain('Câmbio PTAX de venda do Banco Central, de 03/11/2026 a 17/11/2026, sem IOF nem spread do cartão')
    expect(text).toContain('Preço do hardware conferido em 17/11/2026 (replicate.com/pricing)')
    expect(text).toContain('gpu-t4')
    expect(text).toContain('0,000225')
    // O período que a resposta cobre, pra o número nunca ficar sem data.
    expect(text).toContain('01/11/2026 a 30/11/2026')
    expect(h.adminGet).toHaveBeenCalledWith('ai-costs', { from: '2026-11-01', to: '2026-11-30', page: 1 })
  })

  it('um trabalho sem custo fica no singular', async () => {
    h.served = noCost(1)
    setup()
    await ready()
    expect(screen.getByRole('heading', { name: '1 trabalho sem custo' })).toBeTruthy()
  })

  it('mostra os totais do servidor: R$, US$, trabalhos, concluídos, falhas, média e tempo', async () => {
    setup()
    await ready()
    const totals = screen.getByRole('region', { name: 'Totais do período' })
    const text = totals.textContent ?? ''
    expect(text).toContain('12,34')
    expect(text).toContain('US$')
    expect(text).toContain('2,10')
    expect(text).toContain('14')
    expect(text).toContain('11')
    expect(text).toContain('1,12')
    expect(text).toContain('1 h 2 min')
    expect(text).toContain('As somas só contam trabalhos com custo gravado em US$ e R$.')
    // Números em fonte de número.
    expect(totals.querySelectorAll('.ps-num').length).toBeGreaterThanOrEqual(7)
  })

  it('linha com US$ e sem R$ aparece como sem custo, sem o valor em dólar', async () => {
    setup()
    await ready()
    const row = jobRow('r_usd_only')
    expect(row.textContent).toContain('sem custo')
    expect(row.textContent).not.toContain('0,05')
    const ok = jobRow('r_ok_1a2b3c')
    expect(ok.textContent).toContain('0,11')
    expect(ok.textContent).not.toContain('sem custo')
  })

  it('Completar custos chama a varredura e recarrega', async () => {
    h.adminPost.mockResolvedValue({ recorded: 3, unknown: 0, failed: 0, brlCompleted: 0, more: false })
    setup()
    await ready()
    expect(h.adminGet).toHaveBeenCalledTimes(1)
    h.served = noCost(0)
    fireEvent.click(sweepButton())
    expect(h.adminPost).toHaveBeenCalledTimes(1)
    expect(h.adminPost).toHaveBeenCalledWith('ai-costs-sweep', {})
    await waitFor(() => expect(h.adminGet).toHaveBeenCalledTimes(2))
    expect(h.adminGet.mock.calls[1]).toEqual(['ai-costs', { from: '2026-11-01', to: '2026-11-30', page: 1 }])
    await waitFor(() => expect(screen.queryByRole('heading', { name: /sem custo/ })).toBeNull())
    expect(screen.getByText('Varredura feita: 3 custos gravados.')).toBeTruthy()
  })

  it('a frase da varredura conta o que faltou e pede pra continuar', async () => {
    h.adminPost.mockResolvedValue({ recorded: 1, unknown: 2, failed: 1, brlCompleted: 1, more: true })
    setup()
    await ready()
    fireEvent.click(sweepButton())
    expect(
      await screen.findByText(
        'Varredura feita: 1 custo gravado, 1 trabalho ganhou o valor em R$, 2 sem dado do Replicate e 1 sem resposta do Replicate. Ainda faltam trabalhos: clique de novo pra continuar.',
      ),
    ).toBeTruthy()
    await waitFor(() => expect(sweepButton().disabled).toBe(false))
  })

  it('dois cliques seguidos mandam a varredura uma vez', async () => {
    const d = deferred<unknown>()
    h.adminPost.mockReturnValue(d.promise)
    setup()
    await ready()
    const button = sweepButton()
    fireEvent.click(button)
    fireEvent.click(button)
    expect(h.adminPost).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(sweepButton().disabled).toBe(true))
    d.resolve({ recorded: 0, unknown: 0, failed: 0, brlCompleted: 0, more: false })
    expect(await screen.findByText('Varredura feita: nada pra completar agora.')).toBeTruthy()
    await waitFor(() => expect(sweepButton().disabled).toBe(false))
    expect(h.adminPost).toHaveBeenCalledTimes(1)
  })

  it('resposta incerta segura o botão até recarregar, sem recarregar sozinha', async () => {
    h.adminPost.mockRejectedValue(new AdminApiError(LOST, 0, true))
    setup()
    await ready()
    fireEvent.click(sweepButton())
    expect(await screen.findByText(LOST)).toBeTruthy()
    expect(sweepButton().disabled).toBe(true)
    fireEvent.click(sweepButton())
    expect(h.adminPost).toHaveBeenCalledTimes(1)
    // Nada recarrega sozinho: a pessoa confere e atualiza.
    expect(h.adminGet).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: 'Atualizar' }))
    await waitFor(() => expect(h.adminGet).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(sweepButton().disabled).toBe(false))
    expect(h.adminPost).toHaveBeenCalledTimes(1)
  })

  it('erro que não veio do adminApi também segura', async () => {
    h.adminPost.mockRejectedValue(new Error('quebrou'))
    setup()
    await ready()
    fireEvent.click(sweepButton())
    expect(await screen.findByText('Erro inesperado. Confira no Registro se a ação foi feita antes de tentar de novo.')).toBeTruthy()
    expect(sweepButton().disabled).toBe(true)
    expect(h.adminGet).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: 'Atualizar' }))
    await waitFor(() => expect(sweepButton().disabled).toBe(false))
  })

  it('erro certo do servidor mostra a frase, recarrega e solta o botão', async () => {
    h.adminPost.mockRejectedValue(new AdminApiError('Configuração do servidor incompleta. Avise o suporte.', 500))
    setup()
    await ready()
    fireEvent.click(sweepButton())
    expect(await screen.findByText('Configuração do servidor incompleta. Avise o suporte.')).toBeTruthy()
    await waitFor(() => expect(h.adminGet).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(sweepButton().disabled).toBe(false))
  })

  it('trocar de aba com a varredura no ar não deixa mandar de novo', async () => {
    const d = deferred<unknown>()
    h.adminPost.mockReturnValue(d.promise)
    const first = setup()
    await ready()
    fireEvent.click(sweepButton())
    first.unmount()
    // Volta pra aba: a tela nova pede os números de novo, e o botão continua preso.
    setup()
    await ready()
    expect(sweepButton().disabled).toBe(true)
    fireEvent.click(sweepButton())
    expect(h.adminPost).toHaveBeenCalledTimes(1)
    d.resolve({ recorded: 2, unknown: 0, failed: 0, brlCompleted: 0, more: false })
    expect(await screen.findByText('Varredura feita: 2 custos gravados.')).toBeTruthy()
    // A resposta recarrega a aba aberta agora.
    await waitFor(() => expect(h.adminGet).toHaveBeenCalledTimes(3))
    await waitFor(() => expect(sweepButton().disabled).toBe(false))
  })

  it('incerto continua segurado depois de trocar de aba, com a frase', async () => {
    const d = deferred<unknown>()
    h.adminPost.mockReturnValue(d.promise)
    const first = setup()
    await ready()
    fireEvent.click(sweepButton())
    first.unmount()
    // A resposta se perde com a aba fora da tela.
    d.reject(new AdminApiError(LOST, 0, true))
    await Promise.resolve()
    setup()
    await ready()
    expect(screen.getByText(LOST)).toBeTruthy()
    // A volta trouxe números novos: isso já é o recarregar que solta o botão.
    await waitFor(() => expect(sweepButton().disabled).toBe(false))
    expect(h.adminPost).toHaveBeenCalledTimes(1)
  })

  it('sem trabalhos sem custo não mostra o alerta', async () => {
    h.served = noCost(0)
    const { container } = setup()
    await ready()
    expect(screen.queryByRole('heading', { name: /sem custo/ })).toBeNull()
    expect(screen.queryByRole('button', { name: SWEEP })).toBeNull()
    expect(container.querySelector('.bg-ps-alert')).toBeNull()
  })

  it('status unknown vira sem dado do Replicate', async () => {
    h.served = costs({
      rows: [
        JOB_UNKNOWN,
        { ...JOB_OK, replicateId: 'r_failed', status: 'failed' },
        { ...JOB_OK, replicateId: 'r_canceled', status: 'canceled' },
        { ...JOB_OK, replicateId: 'r_processing', status: 'processing' },
        { ...JOB_OK, replicateId: 'r_starting', status: 'starting' },
      ],
      total: 5,
    })
    setup()
    await ready()
    expect(jobRow('r_9x8y7z').textContent).toContain('sem dado do Replicate')
    expect(jobRow('r_9x8y7z').textContent).not.toContain('unknown')
    expect(jobRow('r_failed').textContent).toContain('falhou')
    expect(jobRow('r_canceled').textContent).toContain('cancelado')
    expect(jobRow('r_processing').textContent).toContain('em andamento')
    expect(jobRow('r_starting').textContent).toContain('em andamento')
    expect(jobRow('r_failed').textContent).toContain('htdemucs, 4 faixas')
  })

  it('conta excluída aparece assim na lista por pessoa', async () => {
    const { onNavigate } = setup()
    await ready()
    const byUser = screen.getByRole('region', { name: 'Por pessoa' })
    expect(byUser.textContent).toContain('conta excluída')
    // Conta excluída não vira link pra ficha.
    expect(within(byUser).queryByRole('button', { name: 'conta excluída' })).toBeNull()
    fireEvent.click(within(byUser).getByRole('button', { name: 'ana@exemplo.com' }))
    expect(onNavigate).toHaveBeenCalledWith('subscribers', { userId: 'user-ana' })
    expect(jobRow('r_deleted').textContent).toContain('conta excluída')
  })

  it('por modelo e faixas mostra o modelo, as faixas, o custo e a média de tempo', async () => {
    setup()
    await ready()
    const byModel = screen.getByRole('region', { name: 'Por modelo e faixas' })
    const text = byModel.textContent ?? ''
    expect(text).toContain('htdemucs, 4 faixas')
    expect(text).toContain('htdemucs_6s, 6 faixas')
    expect(text).toContain('9,20')
    expect(text).toContain('1 min 2 s')
    expect(text).toContain('1 min 35 s')
  })

  it('Mês passado e Últimos 90 dias pedem os dias de Brasília', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    // 23:30 do dia 30/11 em Brasília, já dia 1º de dezembro em UTC.
    vi.setSystemTime(new Date('2026-12-01T02:30:00Z'))
    setup()
    await ready()
    expect(h.adminGet).toHaveBeenLastCalledWith('ai-costs', { from: '2026-11-01', to: '2026-11-30', page: 1 })
    fireEvent.click(screen.getByRole('radio', { name: 'Mês passado' }))
    await waitFor(() => expect(h.adminGet).toHaveBeenLastCalledWith('ai-costs', { from: '2026-10-01', to: '2026-10-31', page: 1 }))
    fireEvent.click(screen.getByRole('radio', { name: 'Últimos 90 dias' }))
    await waitFor(() => expect(h.adminGet).toHaveBeenLastCalledWith('ai-costs', { from: '2026-09-02', to: '2026-11-30', page: 1 }))
  })

  it('a lista de trabalhos anda de página e trocar o período volta pra primeira', async () => {
    h.served = costs({ total: 120 })
    setup()
    await ready()
    expect(screen.getByText('Página 1 de 3')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Anteriores' }))
    await waitFor(() => expect(h.adminGet).toHaveBeenLastCalledWith('ai-costs', { from: '2026-11-01', to: '2026-11-30', page: 2 }))
    fireEvent.click(screen.getByRole('radio', { name: 'Mês passado' }))
    await waitFor(() => expect(h.adminGet).toHaveBeenLastCalledWith('ai-costs', expect.objectContaining({ page: 1 })))
  })

  it('resposta fora do formato mostra a frase pronta e Tentar de novo', async () => {
    h.served = { rows: 'nada', totals: null }
    setup()
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toBe('Não deu pra carregar os custos de IA. Tente de novo.')
    // O período continua na tela pra trocar.
    expect(screen.getByRole('radio', { name: 'Este mês' })).toBeTruthy()
    h.served = costs()
    fireEvent.click(screen.getByRole('button', { name: 'Tentar de novo' }))
    await ready()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('erro do servidor ao carregar mostra a frase dele e Tentar de novo', async () => {
    h.adminGet.mockRejectedValueOnce(new AdminApiError('O servidor demorou demais pra responder. Tente de novo.', 0))
    setup()
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toBe('O servidor demorou demais pra responder. Tente de novo.')
    fireEvent.click(screen.getByRole('button', { name: 'Tentar de novo' }))
    await ready()
  })

  it('sem câmbio gravado no período diz isso', async () => {
    h.served = costs({ fx: { minDate: null, maxDate: null } })
    const { container } = setup()
    await ready()
    expect(container.textContent).toContain('Nenhum trabalho deste período tem câmbio gravado.')
    expect(container.textContent).toContain('sem IOF nem spread do cartão')
  })

  it('texto sem travessão, com o alerta, a frase da varredura e os valores vazios', async () => {
    h.adminPost.mockResolvedValue({ recorded: 1, unknown: 1, failed: 1, brlCompleted: 1, more: true })
    h.served = costs({
      totals: { ...costs().totals, avgBrlPerSucceeded: null },
      byModel: [{ model: null, stemCount: null, jobs: 1, costBrl: 0, avgSeconds: null }],
    })
    const { container } = setup()
    await ready()
    fireEvent.click(sweepButton())
    await screen.findByText(/^Varredura feita/)
    expect(container.textContent).toContain('sem dado')
    expect(container.textContent).not.toContain(TRAVESSAO)
    await waitFor(() => expect(sweepButton().disabled).toBe(false))
  })
})

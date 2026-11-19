// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { FunnelPanel } from './FunnelPanel'
import { AdminApiError } from '../lib/adminApi'
import { isFunnel, pctOf, type Funnel, type FunnelMonth } from '../lib/funnelTypes'

const h = vi.hoisted(() => ({ adminGet: vi.fn() }))

vi.mock('../lib/adminApi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/adminApi')>()),
  adminGet: h.adminGet,
}))
vi.mock('../../lib/supabase', () => ({ supabase: null, getAuthHeaders: async () => ({}) }))

// O caractere montado em tempo de execução: assim este arquivo nunca o contém.
const TRAVESSAO = String.fromCharCode(0x2014)
const MSG_BAD_SHAPE = 'Não deu pra carregar o funil. Tente de novo.'
const NOTE = 'Cadastros, primeira separação e pagantes contam pelo mês do cadastro; ofertas e anúncios, pelo mês em que aconteceram.'
const COLUMNS = ['Mês', 'Cadastros', '1ª separação', 'Pagantes', 'Dias até pagar', 'Ofertas vistas e usadas', 'Anúncios vistos e clicados']

// Um mês no formato do contrato de `?action=funnel` (T2).
function month(over: Partial<FunnelMonth> = {}): FunnelMonth {
  return {
    month: '2026-11',
    label: 'novembro de 2026',
    signups: 3,
    firstSeparation: 2,
    paying: 1,
    medianDaysToPay: 2.5,
    offersShown: 3,
    offersUsed: 1,
    adsShown: 12,
    adsClicked: 2,
    ...over,
  }
}

const QUIET_OCT = month({
  month: '2026-10',
  label: 'outubro de 2026',
  signups: 0,
  firstSeparation: 0,
  paying: 0,
  medianDaysToPay: null,
  offersShown: 0,
  offersUsed: 0,
  adsShown: 0,
  adsClicked: 0,
})

const funnel = (months: FunnelMonth[] = [month(), QUIET_OCT]): Funnel => ({ months })

const text = (el: Element | null): string => (el?.textContent ?? '').replace(/\u00a0/g, ' ')
const table = () => screen.getByRole('table', { name: 'Funil do Livre' })
// As linhas do corpo, sem a do cabeçalho.
const bodyRows = () => within(table()).getAllByRole('row').slice(1)
const rowOf = (name: string) => {
  const row = bodyRows().find((r) => text(within(r).getByRole('rowheader')) === name)
  expect(row, name).toBeTruthy()
  return row as HTMLElement
}
// As células de uma linha, na ordem das colunas (a primeira é o mês).
const cellsOf = (row: HTMLElement) => [within(row).getByRole('rowheader'), ...within(row).getAllByRole('cell')].map(text)

async function show(data: unknown) {
  h.adminGet.mockResolvedValue(data)
  const view = render(<FunnelPanel />)
  await screen.findByRole('table', { name: 'Funil do Livre' })
  return view
}

beforeEach(() => {
  h.adminGet.mockReset()
})
afterEach(cleanup)

describe('pctOf', () => {
  it('pctOf(2, 3) = 67% e pctOf(1, 0) = null', () => {
    expect(pctOf(2, 3)).toBe('67%')
    expect(pctOf(1, 0)).toBeNull()
  })

  it('inteiro arredondado, de 0% a 100%', () => {
    expect(pctOf(1, 3)).toBe('33%')
    expect(pctOf(0, 5)).toBe('0%')
    expect(pctOf(3, 3)).toBe('100%')
    expect(pctOf(1, 8)).toBe('13%')
  })

  it('sem base válida não inventa porcentagem', () => {
    expect(pctOf(0, 0)).toBeNull()
    expect(pctOf(1, -2)).toBeNull()
    expect(pctOf(Number.NaN, 3)).toBeNull()
    expect(pctOf(1, Number.POSITIVE_INFINITY)).toBeNull()
  })
})

describe('isFunnel', () => {
  it('aceita a resposta do contrato, com mediana nula ou número', () => {
    expect(isFunnel(funnel())).toBe(true)
    expect(isFunnel({ months: [] })).toBe(true)
    expect(isFunnel({ months: [month({ medianDaysToPay: 0 })] })).toBe(true)
  })

  it('recusa resposta fora do formato', () => {
    const bad: unknown[] = [
      null,
      [],
      'funil',
      { rows: [] },
      { months: {} },
      { months: [null] },
      { months: [{ ...month(), month: 202611 }] },
      { months: [{ ...month(), label: null }] },
      { months: [{ ...month(), signups: -1 }] },
      { months: [{ ...month(), firstSeparation: 1.5 }] },
      { months: [{ ...month(), paying: '1' }] },
      { months: [{ ...month(), medianDaysToPay: -1 }] },
      { months: [{ ...month(), medianDaysToPay: '2,5' }] },
      { months: [{ ...month(), medianDaysToPay: Number.NaN }] },
      { months: [{ ...month(), offersShown: null }] },
      { months: [{ ...month(), offersUsed: undefined }] },
      { months: [{ ...month(), adsShown: Number.POSITIVE_INFINITY }] },
      { months: [{ ...month(), adsClicked: -3 }] },
    ]
    for (const v of bad) expect(isFunnel(v), JSON.stringify(v)).toBe(false)
    // Campo que falta também recusa.
    const missing: Record<string, unknown> = { ...month() }
    delete missing.medianDaysToPay
    expect(isFunnel({ months: [missing] })).toBe(false)
  })
})

describe('FunnelPanel', () => {
  it('pede o funil dos últimos 6 meses e mostra o título, a nota e as colunas', async () => {
    h.adminGet.mockResolvedValue(funnel())
    render(<FunnelPanel />)
    expect(screen.getByText('Carregando...')).toBeTruthy()
    await screen.findByRole('table', { name: 'Funil do Livre' })
    expect(h.adminGet).toHaveBeenCalledWith('funnel', { months: 6 })
    const panel = screen.getByRole('group', { name: 'Funil do Livre' })
    expect(within(panel).getByRole('heading', { name: 'Funil do Livre' })).toBeTruthy()
    expect(text(panel)).toContain(NOTE)
    expect(within(table()).getAllByRole('columnheader').map(text)).toEqual(COLUMNS)
  })

  it('uma linha por mês com cadastros, primeira separação e pagantes com a porcentagem', async () => {
    await show(funnel())
    expect(bodyRows()).toHaveLength(2)
    const row = rowOf('Novembro de 2026')
    expect(row.textContent).toContain('2 (67%)')
    expect(cellsOf(row)).toEqual(['Novembro de 2026', '3', '2 (67%)', '1 (33%)', '2,5 dias', '3 vistas, 1 usada', '12 vistos, 2 clicados'])
    // na ordem do servidor: do mais novo pro mais antigo
    expect(bodyRows().map((r) => text(within(r).getByRole('rowheader')))).toEqual(['Novembro de 2026', 'Outubro de 2026'])
  })

  it('mês sem cadastro mostra sem dado na porcentagem', async () => {
    await show(funnel())
    const row = rowOf('Outubro de 2026')
    expect(row.textContent).toContain('sem dado')
    expect(cellsOf(row)).toEqual(['Outubro de 2026', '0', '0 (sem dado)', '0 (sem dado)', 'sem dado', '0 vistas, 0 usadas', '0 vistos, 0 clicados'])
    expect(row.textContent).not.toContain('%')
  })

  it('mediana nula mostra sem dado e 2.5 mostra 2,5 dias', async () => {
    await show(funnel([month({ medianDaysToPay: null }), month({ month: '2026-10', label: 'outubro de 2026', medianDaysToPay: 2.5 })]))
    expect(cellsOf(rowOf('Novembro de 2026'))[4]).toBe('sem dado')
    expect(cellsOf(rowOf('Outubro de 2026'))[4]).toBe('2,5 dias')
  })

  it('um dia no singular, zero e números inteiros sem vírgula', async () => {
    await show(
      funnel([
        month({ medianDaysToPay: 1 }),
        month({ month: '2026-10', label: 'outubro de 2026', medianDaysToPay: 0 }),
        month({ month: '2026-09', label: 'setembro de 2026', medianDaysToPay: 12 }),
      ]),
    )
    expect(cellsOf(rowOf('Novembro de 2026'))[4]).toBe('1 dia')
    expect(cellsOf(rowOf('Outubro de 2026'))[4]).toBe('0 dias')
    expect(cellsOf(rowOf('Setembro de 2026'))[4]).toBe('12 dias')
  })

  it('ofertas e anúncios no singular e no plural', async () => {
    await show(funnel([month({ offersShown: 1, offersUsed: 0, adsShown: 1, adsClicked: 1 })]))
    const cells = cellsOf(rowOf('Novembro de 2026'))
    expect(cells[5]).toBe('1 vista, 0 usadas')
    expect(cells[6]).toBe('1 visto, 1 clicado')
  })

  it('quantidades grandes com ponto de milhar e os números em ps-num', async () => {
    await show(funnel([month({ signups: 1234, firstSeparation: 617, paying: 12, adsShown: 18342, adsClicked: 1500 })]))
    const row = rowOf('Novembro de 2026')
    expect(cellsOf(row)).toEqual(['Novembro de 2026', '1.234', '617 (50%)', '12 (1%)', '2,5 dias', '3 vistas, 1 usada', '18.342 vistos, 1.500 clicados'])
    for (const cell of within(row).getAllByRole('cell')) expect(cell.querySelector('.ps-num'), text(cell)).not.toBeNull()
  })

  it('sem nenhum mês diz isso, sem tabela vazia', async () => {
    h.adminGet.mockResolvedValue(funnel([]))
    render(<FunnelPanel />)
    await screen.findByText('Nenhum mês pra mostrar.')
    expect(screen.queryByRole('table')).toBeNull()
  })

  it('erro do servidor mostra a frase e Tentar de novo', async () => {
    h.adminGet.mockRejectedValueOnce(new AdminApiError('Erro inesperado no servidor.', 500)).mockResolvedValueOnce(funnel())
    render(<FunnelPanel />)
    expect((await screen.findByRole('alert')).textContent).toBe('Erro inesperado no servidor.')
    expect(screen.queryByRole('table')).toBeNull()
    const retry = screen.getByRole('button', { name: 'Tentar de novo' })
    expect(retry.className).toContain('min-h-ps-touch')
    fireEvent.click(retry)
    await screen.findByRole('table', { name: 'Funil do Livre' })
    expect(h.adminGet).toHaveBeenCalledTimes(2)
    expect(h.adminGet).toHaveBeenLastCalledWith('funnel', { months: 6 })
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('resposta fora do formato mostra a frase pronta, nunca um número inventado', async () => {
    h.adminGet.mockResolvedValue({ months: [{ ...month(), signups: 'três' }] })
    render(<FunnelPanel />)
    expect((await screen.findByRole('alert')).textContent).toBe(MSG_BAD_SHAPE)
    expect(screen.getByRole('button', { name: 'Tentar de novo' })).toBeTruthy()
    expect(screen.queryByRole('table')).toBeNull()
  })

  it('a tabela fica dentro de uma caixa que rola de lado, pra a página nunca rolar', async () => {
    await show(funnel())
    const scroller = table().parentElement as HTMLElement
    expect(scroller.className).toMatch(/(^| )overflow-x-auto( |$)/)
    // O painel não estica a página: encolhe dentro da coluna.
    expect(screen.getByRole('group', { name: 'Funil do Livre' }).className).toContain('min-w-0')
  })

  it('nenhum travessão no painel e só tokens ps-*', async () => {
    const { container } = await show(funnel())
    expect(container.textContent).not.toContain(TRAVESSAO)
    expect(container.innerHTML).not.toContain('text-primary')
    expect(container.innerHTML).not.toMatch(/#[0-9a-fA-F]{3,6}\b/)
    cleanup()
    h.adminGet.mockReset()
    h.adminGet.mockRejectedValue(new AdminApiError('Erro inesperado no servidor.', 500))
    const failed = render(<FunnelPanel />)
    await screen.findByRole('alert')
    expect(failed.container.textContent).not.toContain(TRAVESSAO)
  })
})

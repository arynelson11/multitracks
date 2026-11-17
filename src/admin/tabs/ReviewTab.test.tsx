// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { ReviewTab } from './ReviewTab'
import { AdminApiError } from '../lib/adminApi'
import type { AdminQueryState } from '../hooks/useAdminQuery'
import type { ReviewAction, ReviewEvent, ReviewFlag, ReviewQueue } from '../lib/reviewTypes'

// O caractere montado em tempo de execução: assim este arquivo nunca o contém.
const TRAVESSAO = String.fromCharCode(0x2014)
// Frase do Registro: a resposta da ação não chegou e o servidor pode ter feito (Ruling ADM-T4-incerto).
const LOST = 'A resposta do servidor não chegou. Confira no Registro se a ação foi feita antes de tentar de novo.'

const h = vi.hoisted(() => ({ adminPost: vi.fn(), adminGet: vi.fn(), openExternalUrl: vi.fn() }))

vi.mock('../lib/adminApi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/adminApi')>()),
  adminPost: h.adminPost,
  adminGet: h.adminGet,
}))
vi.mock('../../lib/desktop', () => ({ isElectron: false, openExternalUrl: h.openExternalUrl }))
vi.mock('../../lib/supabase', () => ({ supabase: null, getAuthHeaders: async () => ({}) }))

const REFUND: ReviewAction = {
  id: 7,
  action: 'refund_payment',
  reason: 'estorno_recusado_pelo_asaas',
  autoRetry: false,
  attempts: 0,
  lastError: null,
  nextAttemptAt: '2026-11-16T12:00:00Z',
  createdAt: '2026-11-16T12:00:00Z',
  subscriptionRef: 'sub-ref-ana',
  asaasSubscriptionId: 'sub_ana',
  paymentId: 'pay_abc123',
  dueDate: '2026-11-10',
  amount: 29.9,
  userId: 'user-ana',
  email: 'ana@exemplo.com',
  planKey: 'essencial_mensal',
}

const INACTIVATE: ReviewAction = {
  ...REFUND,
  id: 8,
  action: 'inactivate_subscription',
  reason: 'vencida',
  autoRetry: true,
  attempts: 3,
  lastError: 'O Asaas não respondeu.',
  nextAttemptAt: '2026-11-16T21:30:00Z',
  subscriptionRef: 'sub-ref-bia',
  paymentId: null,
  amount: null,
  userId: 'user-bia',
  email: 'bia@exemplo.com',
}

const FUTURE: ReviewAction = { ...INACTIVATE, id: 10, action: 'delete_future_payments', reason: 'vencida' }

const CASE: ReviewAction = {
  ...REFUND,
  id: 9,
  action: 'admin_review',
  reason: 'conferencia: assinatura sub_9 ATIVA no Asaas sem registro no app (cliente cus_9)',
  subscriptionRef: 'asaas:sub_9',
  paymentId: null,
  dueDate: null,
  amount: null,
  userId: null,
  email: null,
  planKey: null,
}

const FLAG: ReviewFlag = {
  subscriptionRef: 'sub-ref-caio',
  userId: 'user-caio',
  email: 'caio@exemplo.com',
  planKey: 'pro_anual',
  kind: 'asaas',
  status: 'active',
  cancelSource: null,
  adminNote: 'Pagamento sem assinatura | Valor diferente do plano',
  updatedAt: '2026-11-16T14:00:00.123456+00:00',
}

const EXHAUSTED: ReviewEvent = {
  id: 'evt_1&1',
  event: 'PAYMENT_CONFIRMED',
  status: 'exhausted',
  attempts: 5,
  lastError: 'Erro inesperado no servidor.',
  receivedAt: '2026-11-15T10:00:00Z',
}

const FAILED: ReviewEvent = { ...EXHAUSTED, id: 'evt_2&1', event: 'PAYMENT_OVERDUE', status: 'failed', attempts: 2 }

function queue(parts: Partial<ReviewQueue> = {}): ReviewQueue {
  const actions = parts.actions ?? []
  const flags = parts.flags ?? []
  const events = parts.events ?? []
  const manual = actions.filter((a) => !a.autoRetry).length + flags.length + events.filter((e) => e.status === 'exhausted').length
  const auto = actions.filter((a) => a.autoRetry).length + events.filter((e) => e.status !== 'exhausted').length
  return { actions, flags, events, counts: { manual, auto, total: manual + auto }, generatedAt: '2026-11-16T15:05:00Z', ...parts }
}

type Review = AdminQueryState<ReviewQueue>

function setup(data: ReviewQueue | null, extra: Partial<Review> = {}) {
  const refetch = vi.fn(async () => {})
  const onNavigate = vi.fn()
  const review: Review = { data, loading: false, error: null, refetch, ...extra }
  const view = render(<ReviewTab onNavigate={onNavigate} focusUserId={null} review={review} />)
  // Entrar na aba com a lista já na mão recarrega (teste próprio abaixo); daqui pra frente só contam as ações.
  const mountRefetches = refetch.mock.calls.length
  refetch.mockClear()
  const rerender = (next: ReviewQueue | null, more: Partial<Review> = {}) =>
    view.rerender(<ReviewTab onNavigate={onNavigate} focusUserId={null} review={{ ...review, data: next, ...more }} />)
  return { ...view, refetch, onNavigate, review, mountRefetches, rerender }
}

const item = (name: string | RegExp) => screen.getByRole('article', { name })
const dialog = (name: string) => screen.getByRole('dialog', { name })
const typeNote = (d: HTMLElement, text: string) => fireEvent.change(within(d).getByLabelText('Nota'), { target: { value: text } })
const button = (scope: HTMLElement, name: string) => within(scope).getByRole('button', { name }) as HTMLButtonElement

// Promessa que o teste resolve quando quiser (pedido no ar).
function deferred<T>() {
  let resolve!: (v: T) => void
  const promise = new Promise<T>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

beforeEach(() => {
  h.adminPost.mockReset()
  h.adminGet.mockReset()
  h.openExternalUrl.mockReset()
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  Reflect.deleteProperty(navigator, 'clipboard')
})

describe('ReviewTab', () => {
  it('fila vazia mostra Nada pendente agora.', () => {
    const { container } = setup(queue())
    expect(screen.getByText('Nada pendente agora.')).toBeTruthy()
    expect(screen.queryByRole('region', { name: 'Precisa de você' })).toBeNull()
    expect(container.textContent).not.toContain('Tudo em dia')
    expect(container.textContent).not.toContain(TRAVESSAO)
  })

  it('mostra a hora da lista, a regra do estorno e Atualizar chama refetch', () => {
    const { refetch } = setup(queue())
    expect(screen.getByText('Atualizado às 12:05')).toBeTruthy()
    const rule = screen.getByText('Antes de estornar à mão, confira no Asaas se a cobrança já não está estornada.')
    expect(rule.className).toContain('text-ps-mut')
    fireEvent.click(screen.getByRole('button', { name: 'Atualizar' }))
    expect(refetch).toHaveBeenCalledTimes(1)
  })

  it('sem lista ainda mostra Carregando..., e com erro mostra a frase', () => {
    setup(null, { loading: true })
    expect(screen.getByText('Carregando...')).toBeTruthy()
    cleanup()
    setup(null, { error: 'Não deu pra falar com o servidor. Confira a internet e tente de novo.' })
    expect(screen.getByRole('alert').textContent).toBe('Não deu pra falar com o servidor. Confira a internet e tente de novo.')
    expect(screen.queryByText('Nada pendente agora.')).toBeNull()
  })

  it('erro ao atualizar mantém a lista e mostra a frase', () => {
    setup(queue({ actions: [REFUND] }), { error: 'O servidor demorou demais pra responder. Tente de novo.' })
    expect(screen.getByRole('alert').textContent).toContain('O servidor demorou demais pra responder.')
    expect(item('Estornar à mão')).toBeTruthy()
  })

  it('separa Precisa de você de Tentando sozinho', () => {
    setup(queue({ actions: [REFUND, INACTIVATE], flags: [FLAG] }))
    const mine = screen.getByRole('region', { name: 'Precisa de você' })
    const auto = screen.getByRole('region', { name: 'Tentando sozinho' })
    expect(within(mine).getByRole('article', { name: 'Estornar à mão' })).toBeTruthy()
    expect(within(mine).getByRole('article', { name: 'Assinatura marcada pra conferir' })).toBeTruthy()
    expect(within(mine).queryByRole('article', { name: 'Inativar assinatura no Asaas' })).toBeNull()
    expect(within(auto).getByRole('article', { name: 'Inativar assinatura no Asaas' })).toBeTruthy()
    expect(within(auto).queryByRole('article', { name: 'Estornar à mão' })).toBeNull()
    // O Led âmbar só no grupo que precisa de você.
    expect(mine.querySelector('.bg-ps-alert')).not.toBeNull()
    expect(auto.querySelector('.bg-ps-alert')).toBeNull()
  })

  it('avisos esgotados precisam de você e os que falharam tentam sozinhos', () => {
    setup(queue({ events: [EXHAUSTED, FAILED] }))
    const mine = screen.getByRole('region', { name: 'Precisa de você' })
    const auto = screen.getByRole('region', { name: 'Tentando sozinho' })
    expect(within(mine).getByRole('article', { name: 'Aviso do Asaas que falhou: PAYMENT_CONFIRMED' })).toBeTruthy()
    expect(within(auto).getByRole('article', { name: 'Aviso do Asaas que falhou: PAYMENT_OVERDUE' })).toBeTruthy()
  })

  it('um grupo vazio diz que não tem nada nele', () => {
    setup(queue({ actions: [INACTIVATE] }))
    const mine = screen.getByRole('region', { name: 'Precisa de você' })
    expect(mine.textContent).toContain('Nada precisa de você agora.')
    expect(mine.querySelector('.bg-ps-alert')).toBeNull()
  })

  it('o estorno mostra e-mail, plano, valor, vencimento, cobrança e motivo', () => {
    setup(queue({ actions: [REFUND] }))
    const card = item('Estornar à mão')
    const text = card.textContent ?? ''
    expect(text).toContain('ana@exemplo.com')
    expect(text).toContain('Pro Mensal')
    expect(text).toContain('R$')
    expect(text).toContain('29,90')
    expect(text).toContain('10/11/2026')
    expect(text).toContain('pay_abc123')
    expect(text).toContain('O Asaas recusou o estorno automático do arrependimento')
  })

  it('o que tenta sozinho mostra tentativas, último erro e próxima tentativa', () => {
    setup(queue({ actions: [INACTIVATE] }))
    const text = item('Inativar assinatura no Asaas').textContent ?? ''
    expect(text).toContain('Tentativas')
    expect(text).toContain('3')
    expect(text).toContain('O Asaas não respondeu.')
    // 21:30 em UTC = 18:30 em Brasília.
    expect(text).toContain('16/11/2026 18:30')
    expect(text).toContain('Renovação vencida')
  })

  it('a marcação mostra as linhas da nota', () => {
    setup(queue({ flags: [FLAG] }))
    const card = item('Assinatura marcada pra conferir')
    const lines = within(card)
      .getAllByRole('listitem')
      .map((li) => li.textContent)
    expect(lines).toEqual(['Pagamento sem assinatura', 'Valor diferente do plano'])
    expect(card.textContent).toContain('Studio Anual')
  })

  it('o e-mail abre a ficha do assinante', () => {
    const { onNavigate } = setup(queue({ actions: [REFUND] }))
    fireEvent.click(button(item('Estornar à mão'), 'ana@exemplo.com'))
    expect(onNavigate).toHaveBeenCalledWith('subscribers', { userId: 'user-ana' })
  })

  it('sem conta ligada o e-mail não é botão', () => {
    setup(queue({ actions: [CASE] }))
    const card = item('Caso pra olhar')
    expect(card.textContent).toContain('sem dado')
    expect(within(card).queryByRole('button', { name: 'sem dado' })).toBeNull()
  })

  it('botões de cada tipo', () => {
    setup(queue({ actions: [REFUND, CASE, FUTURE, INACTIVATE], flags: [FLAG], events: [FAILED] }))
    const names = (name: string) =>
      within(item(name))
        .getAllByRole('button')
        .map((b) => b.textContent)
        .filter((t) => !t?.includes('@'))
    expect(names('Estornar à mão')).toEqual(['Ver no Asaas', 'Copiar id', 'Já estornei no Asaas', 'Não vou estornar'])
    expect(names('Caso pra olhar')).toEqual(['Conferido'])
    expect(names('Remover cobrança futura')).toEqual(['Já removi no Asaas', 'Tentar agora'])
    expect(names('Inativar assinatura no Asaas')).toEqual(['Tentar agora'])
    expect(names('Assinatura marcada pra conferir')).toEqual(['Conferido'])
    expect(names('Aviso do Asaas que falhou: PAYMENT_OVERDUE')).toEqual(['Tentar de novo'])
  })

  it('Copiar id copia o id da cobrança do estorno', async () => {
    const writeText = vi.fn(async () => {})
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    setup(queue({ actions: [REFUND] }))
    fireEvent.click(button(item('Estornar à mão'), 'Copiar id'))
    expect(writeText).toHaveBeenCalledWith('pay_abc123')
    await waitFor(() => expect(item('Estornar à mão').textContent).toContain('Id copiado.'))
  })

  it('sem área de transferência, Copiar id mostra o id pra copiar à mão', async () => {
    setup(queue({ actions: [REFUND] }))
    fireEvent.click(button(item('Estornar à mão'), 'Copiar id'))
    await waitFor(() => expect(item('Estornar à mão').textContent).toContain('Não deu pra copiar. O id é pay_abc123.'))
  })

  it('Ver no Asaas pede payment-link e abre a fatura', async () => {
    h.adminGet.mockResolvedValue({ paymentId: 'pay_abc123', status: 'RECEIVED', invoiceUrl: 'https://www.asaas.com/i/abc123' })
    setup(queue({ actions: [REFUND] }))
    fireEvent.click(button(item('Estornar à mão'), 'Ver no Asaas'))
    expect(h.adminGet).toHaveBeenCalledWith('payment-link', { id: 'pay_abc123' })
    await waitFor(() => expect(h.openExternalUrl).toHaveBeenCalledWith('https://www.asaas.com/i/abc123'))
  })

  it('Ver no Asaas sem link da fatura avisa e não abre nada', async () => {
    h.adminGet.mockResolvedValue({ paymentId: 'pay_abc123', status: 'RECEIVED', invoiceUrl: null })
    setup(queue({ actions: [REFUND] }))
    fireEvent.click(button(item('Estornar à mão'), 'Ver no Asaas'))
    await waitFor(() => expect(item('Estornar à mão').textContent).toContain('O Asaas não mandou o link da fatura.'))
    expect(h.openExternalUrl).not.toHaveBeenCalled()
  })

  it('Ver no Asaas com o Asaas fora mostra a frase do servidor', async () => {
    h.adminGet.mockRejectedValue(new AdminApiError('O Asaas não respondeu agora.', 502))
    setup(queue({ actions: [REFUND] }))
    fireEvent.click(button(item('Estornar à mão'), 'Ver no Asaas'))
    await waitFor(() => expect(item('Estornar à mão').textContent).toContain('O Asaas não respondeu agora.'))
    expect(h.openExternalUrl).not.toHaveBeenCalled()
  })

  it('Já estornei no Asaas manda close-action com outcome done e a nota', async () => {
    h.adminPost.mockResolvedValue({ result: 'closed' })
    const { refetch } = setup(queue({ actions: [REFUND] }))
    fireEvent.click(button(item('Estornar à mão'), 'Já estornei no Asaas'))
    const d = dialog('Já estornei no Asaas')
    typeNote(d, 'estornei hoje')
    fireEvent.click(button(d, 'Marcar como feito'))
    expect(h.adminPost).toHaveBeenCalledWith('close-action', { actionId: 7, outcome: 'done', note: 'estornei hoje' })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(refetch).toHaveBeenCalledTimes(1)
  })

  it('Não vou estornar manda close-action com outcome canceled', async () => {
    h.adminPost.mockResolvedValue({ result: 'closed' })
    const { refetch } = setup(queue({ actions: [REFUND] }))
    fireEvent.click(button(item('Estornar à mão'), 'Não vou estornar'))
    const d = dialog('Não vou estornar')
    typeNote(d, 'cliente desistiu do estorno')
    fireEvent.click(button(d, 'Fechar sem estorno'))
    expect(h.adminPost).toHaveBeenCalledWith('close-action', { actionId: 7, outcome: 'canceled', note: 'cliente desistiu do estorno' })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(refetch).toHaveBeenCalledTimes(1)
  })

  it('Já removi no Asaas manda close-action com outcome done', async () => {
    h.adminPost.mockResolvedValue({ result: 'closed' })
    setup(queue({ actions: [FUTURE] }))
    fireEvent.click(button(item('Remover cobrança futura'), 'Já removi no Asaas'))
    const d = dialog('Já removi no Asaas')
    typeNote(d, 'removi as duas')
    fireEvent.click(button(d, 'Marcar como feito'))
    expect(h.adminPost).toHaveBeenCalledWith('close-action', { actionId: 10, outcome: 'done', note: 'removi as duas' })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('nota com menos de 3 caracteres não libera o Confirmar', () => {
    setup(queue({ actions: [REFUND] }))
    fireEvent.click(button(item('Estornar à mão'), 'Já estornei no Asaas'))
    const d = dialog('Já estornei no Asaas')
    expect(button(d, 'Marcar como feito').disabled).toBe(true)
    typeNote(d, 'ok')
    expect(button(d, 'Marcar como feito').disabled).toBe(true)
    typeNote(d, 'ok!')
    expect(button(d, 'Marcar como feito').disabled).toBe(false)
  })

  it('o 409 do servidor aparece dentro do diálogo e nada fecha', async () => {
    const msg = 'O Asaas mostra a cobrança pay_abc123 como recebida. Estorne no painel do Asaas antes de marcar como feito.'
    h.adminPost.mockRejectedValue(new AdminApiError(msg, 409))
    const { refetch } = setup(queue({ actions: [REFUND] }))
    fireEvent.click(button(item('Estornar à mão'), 'Já estornei no Asaas'))
    const d = dialog('Já estornei no Asaas')
    typeNote(d, 'estornei hoje')
    fireEvent.click(button(d, 'Marcar como feito'))
    await waitFor(() => expect(within(d).getByRole('alert').textContent).toBe(msg))
    expect(dialog('Já estornei no Asaas')).toBe(d)
    expect(refetch).not.toHaveBeenCalled()
    // Erro certo: a ação não foi feita, então pode tentar de novo.
    expect(button(d, 'Marcar como feito').disabled).toBe(false)
  })

  it('o 409 do caso asaas que o Asaas não confirma aparece no diálogo', async () => {
    const msg = 'Não deu pra confirmar no Asaas que esta assinatura parou de cobrar. Confira no painel do Asaas antes de fechar.'
    h.adminPost.mockRejectedValue(new AdminApiError(msg, 409))
    setup(queue({ actions: [CASE] }))
    fireEvent.click(button(item('Caso pra olhar'), 'Conferido'))
    const d = dialog('Conferir caso')
    typeNote(d, 'parei no painel')
    fireEvent.click(button(d, 'Conferido'))
    await waitFor(() => expect(within(d).getByRole('alert').textContent).toBe(msg))
  })

  it('o pedido no ar liga busy no diálogo', async () => {
    const pending = deferred<{ result: string }>()
    h.adminPost.mockReturnValue(pending.promise)
    setup(queue({ actions: [REFUND] }))
    fireEvent.click(button(item('Estornar à mão'), 'Já estornei no Asaas'))
    const d = dialog('Já estornei no Asaas')
    typeNote(d, 'estornei hoje')
    fireEvent.click(button(d, 'Marcar como feito'))
    await waitFor(() => expect(d.getAttribute('aria-busy')).toBe('true'))
    expect(button(d, 'Cancelar').disabled).toBe(true)
    fireEvent.click(button(d, 'Marcar como feito'))
    expect(h.adminPost).toHaveBeenCalledTimes(1)
    pending.resolve({ result: 'closed' })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('erro incerto no diálogo passa o AdminApiError e segura o Confirmar', async () => {
    h.adminPost.mockRejectedValue(new AdminApiError(LOST, 0, true))
    const { refetch } = setup(queue({ actions: [REFUND] }))
    fireEvent.click(button(item('Estornar à mão'), 'Já estornei no Asaas'))
    const d = dialog('Já estornei no Asaas')
    typeNote(d, 'estornei hoje')
    fireEvent.click(button(d, 'Marcar como feito'))
    await waitFor(() => expect(within(d).getByRole('alert').textContent).toBe(LOST))
    expect(button(d, 'Marcar como feito').disabled).toBe(true)
    expect(refetch).not.toHaveBeenCalled()
  })

  it('Conferido de caso pra olhar avisa que não volta', async () => {
    h.adminPost.mockResolvedValue({ result: 'closed' })
    const { refetch } = setup(queue({ actions: [CASE] }))
    fireEvent.click(button(item('Caso pra olhar'), 'Conferido'))
    const d = dialog('Conferir caso')
    expect(d.textContent).toContain('Este caso não volta a aparecer depois de fechado.')
    typeNote(d, 'conferi no painel')
    fireEvent.click(button(d, 'Conferido'))
    expect(h.adminPost).toHaveBeenCalledWith('close-action', { actionId: 9, outcome: 'done', note: 'conferi no painel' })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(refetch).toHaveBeenCalledTimes(1)
  })

  it('Conferido numa marcação manda resolve-flag com subscriptionRef', async () => {
    h.adminPost.mockResolvedValue({ result: 'resolved' })
    const { refetch } = setup(queue({ flags: [FLAG] }))
    fireEvent.click(button(item('Assinatura marcada pra conferir'), 'Conferido'))
    const d = dialog('Conferir marcação')
    expect(d.textContent).not.toContain('Este caso não volta a aparecer')
    typeNote(d, 'tudo certo no Asaas')
    fireEvent.click(button(d, 'Conferido'))
    expect(h.adminPost).toHaveBeenCalledWith('resolve-flag', {
      subscriptionRef: 'sub-ref-caio',
      note: 'tudo certo no Asaas',
      seenNote: 'Pagamento sem assinatura | Valor diferente do plano',
      seenAt: '2026-11-16T14:00:00.123456+00:00',
    })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(refetch).toHaveBeenCalledTimes(1)
  })

  it('Conferido numa marcação sem nota manda seenNote nulo', async () => {
    h.adminPost.mockResolvedValue({ result: 'resolved' })
    setup(queue({ flags: [{ ...FLAG, adminNote: null }] }))
    fireEvent.click(button(item('Assinatura marcada pra conferir'), 'Conferido'))
    const d = dialog('Conferir marcação')
    typeNote(d, 'conferi')
    fireEvent.click(button(d, 'Conferido'))
    expect(h.adminPost).toHaveBeenCalledWith('resolve-flag', {
      subscriptionRef: 'sub-ref-caio',
      note: 'conferi',
      seenNote: null,
      seenAt: '2026-11-16T14:00:00.123456+00:00',
    })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('marcação que mudou desde que abriu avisa e recarrega', async () => {
    h.adminPost.mockResolvedValue({ result: 'changed' })
    const { refetch } = setup(queue({ flags: [FLAG] }))
    fireEvent.click(button(item('Assinatura marcada pra conferir'), 'Conferido'))
    const d = dialog('Conferir marcação')
    typeNote(d, 'tudo certo no Asaas')
    fireEvent.click(button(d, 'Conferido'))
    await waitFor(() =>
      expect(item('Assinatura marcada pra conferir').textContent).toContain('A marcação mudou desde que você abriu. Atualize a lista.'),
    )
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(refetch).toHaveBeenCalledTimes(1)
  })

  it('Tentar agora manda retry-action, mostra o resultado e recarrega', async () => {
    h.adminPost.mockResolvedValue({ status: 'pending', attempts: 4, lastError: 'O Asaas recusou o pedido. Status do Asaas: 400.' })
    const { refetch } = setup(queue({ actions: [INACTIVATE] }))
    fireEvent.click(button(item('Inativar assinatura no Asaas'), 'Tentar agora'))
    expect(h.adminPost).toHaveBeenCalledWith('retry-action', { actionId: 8 })
    await waitFor(() =>
      expect(item('Inativar assinatura no Asaas').textContent).toContain(
        'O Asaas ainda não confirmou. O Asaas recusou o pedido. Status do Asaas: 400.',
      ),
    )
    expect(refetch).toHaveBeenCalledTimes(1)
  })

  it('Tentar agora que deu certo avisa mesmo depois de a pendência sair da lista', async () => {
    h.adminPost.mockResolvedValue({ status: 'done', attempts: 4, lastError: null })
    const { refetch, rerender } = setup(queue({ actions: [INACTIVATE] }))
    fireEvent.click(button(item('Inativar assinatura no Asaas'), 'Tentar agora'))
    await waitFor(() => expect(refetch).toHaveBeenCalledTimes(1))
    rerender(queue())
    expect(screen.getByText(/O Asaas confirmou\. A pendência foi fechada\./).textContent).toContain('bia@exemplo.com')
  })

  it('Tentar agora com o pedido no ar não sai duas vezes', async () => {
    const pending = deferred<{ status: string; attempts: number; lastError: string | null }>()
    h.adminPost.mockReturnValue(pending.promise)
    setup(queue({ actions: [INACTIVATE] }))
    const retry = button(item('Inativar assinatura no Asaas'), 'Tentar agora')
    fireEvent.click(retry)
    await waitFor(() => expect(button(item('Inativar assinatura no Asaas'), 'Tentar agora').disabled).toBe(true))
    fireEvent.click(button(item('Inativar assinatura no Asaas'), 'Tentar agora'))
    expect(h.adminPost).toHaveBeenCalledTimes(1)
    pending.resolve({ status: 'done', attempts: 1, lastError: null })
    await waitFor(() => expect(button(item('Inativar assinatura no Asaas'), 'Tentar agora').disabled).toBe(false))
  })

  it('Tentar agora com resposta incerta mostra a frase do Registro e segura o botão até a lista recarregar', async () => {
    // O adminPost de verdade, com o fetch falso caindo no meio: a ação pode ter saído.
    const real = await vi.importActual<typeof import('../lib/adminApi')>('../lib/adminApi')
    h.adminPost.mockImplementation(real.adminPost)
    const fetch = vi.fn(async () => {
      throw new TypeError('Failed to fetch')
    })
    vi.stubGlobal('fetch', fetch)
    const data = queue({ actions: [INACTIVATE] })
    const { refetch, rerender } = setup(data)
    fireEvent.click(button(item('Inativar assinatura no Asaas'), 'Tentar agora'))
    await waitFor(() => expect(item('Inativar assinatura no Asaas').textContent).toContain(LOST))
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(button(item('Inativar assinatura no Asaas'), 'Tentar agora').disabled).toBe(true)
    expect(refetch).not.toHaveBeenCalled()
    // A mesma lista (um render qualquer) não solta.
    rerender(data)
    expect(button(item('Inativar assinatura no Asaas'), 'Tentar agora').disabled).toBe(true)
    // Lista recarregada: solta.
    rerender(queue({ actions: [{ ...INACTIVATE, attempts: 4 }] }))
    expect(button(item('Inativar assinatura no Asaas'), 'Tentar agora').disabled).toBe(false)
  })

  it('Tentar agora com erro certo mostra a frase e deixa tentar de novo', async () => {
    h.adminPost.mockRejectedValue(new AdminApiError('Esta pendência já foi fechada.', 409))
    const { refetch } = setup(queue({ actions: [INACTIVATE] }))
    fireEvent.click(button(item('Inativar assinatura no Asaas'), 'Tentar agora'))
    await waitFor(() => expect(item('Inativar assinatura no Asaas').textContent).toContain('Esta pendência já foi fechada.'))
    expect(button(item('Inativar assinatura no Asaas'), 'Tentar agora').disabled).toBe(false)
    expect(refetch).not.toHaveBeenCalled()
  })

  it('Tentar de novo manda retry-event com o id do aviso e recarrega', async () => {
    h.adminPost.mockResolvedValue({ processed: false, result: null })
    const { refetch } = setup(queue({ events: [EXHAUSTED] }))
    fireEvent.click(button(item('Aviso do Asaas que falhou: PAYMENT_CONFIRMED'), 'Tentar de novo'))
    expect(h.adminPost).toHaveBeenCalledWith('retry-event', { eventId: 'evt_1&1' })
    await waitFor(() =>
      expect(item('Aviso do Asaas que falhou: PAYMENT_CONFIRMED').textContent).toContain('O aviso falhou de novo e continua na lista.'),
    )
    expect(refetch).toHaveBeenCalledTimes(1)
  })

  it('Tentar de novo com resposta incerta segura o botão até a lista recarregar', async () => {
    h.adminPost.mockRejectedValue(new AdminApiError(LOST, 504, true))
    const { refetch, rerender } = setup(queue({ events: [EXHAUSTED] }))
    const name = 'Aviso do Asaas que falhou: PAYMENT_CONFIRMED'
    fireEvent.click(button(item(name), 'Tentar de novo'))
    await waitFor(() => expect(item(name).textContent).toContain(LOST))
    expect(button(item(name), 'Tentar de novo').disabled).toBe(true)
    expect(refetch).not.toHaveBeenCalled()
    rerender(queue({ events: [{ ...EXHAUSTED }] }))
    expect(button(item(name), 'Tentar de novo').disabled).toBe(false)
  })

  it('com mais avisos do que a lista traz, mostra quantos de quantos', () => {
    const data = queue({ events: [EXHAUSTED, FAILED] })
    setup({ ...data, counts: { manual: 60, auto: 82, total: 142 } })
    expect(screen.getByText(/Mostrando os 2 avisos mais novos de 142\./)).toBeTruthy()
  })

  it('entrar na aba com a lista já na mão recarrega; sem lista, não pede de novo', () => {
    expect(setup(queue()).mountRefetches).toBe(1)
    cleanup()
    expect(setup(null, { loading: true }).mountRefetches).toBe(0)
  })

  it('texto sem travessão com todos os tipos na tela', () => {
    const { container } = setup(queue({ actions: [REFUND, CASE, FUTURE, INACTIVATE], flags: [FLAG], events: [EXHAUSTED, FAILED] }))
    expect(container.textContent).not.toContain(TRAVESSAO)
    fireEvent.click(button(item('Caso pra olhar'), 'Conferido'))
    expect(document.body.textContent).not.toContain(TRAVESSAO)
  })
})

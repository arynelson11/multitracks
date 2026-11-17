// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { SubscriberActions } from './SubscriberActions'
import { SubscribersTab } from '../tabs/SubscribersTab'
import { AdminApiError } from '../lib/adminApi'
import { BILLING_CONTINUES, LEGACY_BILLING_WARNING, LEGACY_COURTESY_WARNING, LEGACY_STOPPED_LABEL, cancelText, changePlanText, courtesyLastDay, courtesyText, noCourtesyText, onlyHigherText, quotaText } from '../lib/actionText'
import { brtTodayLocal, monthRange } from '../lib/period'
import type { SubscriberDetailData, SubscriptionRow } from '../lib/subscribersTypes'

const h = vi.hoisted(() => ({
  adminGet: vi.fn(),
  adminPost: vi.fn(),
  realPost: null as null | ((action: string, body: Record<string, unknown>) => Promise<unknown>),
  responses: {} as Record<string, unknown>,
}))

vi.mock('../lib/adminApi', async (importOriginal) => {
  const real = await importOriginal<typeof import('../lib/adminApi')>()
  h.realPost = real.adminPost
  return { ...real, adminGet: h.adminGet, adminPost: h.adminPost }
})
vi.mock('../../lib/supabase', () => ({ supabase: null, getAuthHeaders: async () => ({}) }))

const TRAVESSAO = String.fromCharCode(0x2014)
const USER = '33333333-3333-4333-8333-333333333333'
const norm = (s: string | null | undefined) => (s ?? '').replace(/\u00a0/g, ' ')
const MSG_UNCERTAIN = 'O Asaas não respondeu a tempo. A mudança pode ter sido feita. A ficha foi marcada pra conferir; confira em Pendências antes de repetir.'
const MSG_QUOTA_UNCONFIRMED = 'Não deu pra confirmar o ajuste da cota. Ele pode ter sido feito; confira no Registro antes de repetir.'

const PLANS: SubscriberDetailData['plans'] = [
  { key: 'essencial_mensal', label: 'Pro Mensal', value: 49.9, cycle: 'MONTHLY' },
  { key: 'essencial_anual', label: 'Pro Anual', value: 454.8, cycle: 'YEARLY' },
  { key: 'pro_mensal', label: 'Studio Mensal', value: 119.9, cycle: 'MONTHLY' },
  { key: 'pro_anual', label: 'Studio Anual', value: 1078.8, cycle: 'YEARLY' },
]

function paid(over: Partial<SubscriptionRow> = {}): SubscriptionRow {
  return {
    id: 'sub-1', kind: 'asaas', planKey: 'essencial_mensal', cycle: 'MONTHLY', status: 'active', startedAt: '2026-10-16T12:00:00Z',
    nextDueDate: '2026-12-16', paidUntil: '2099-12-17T03:00:00+00:00', accessUntil: null, cancelSource: null, canceledAt: null,
    asaasSubscriptionId: 'sub_abc', asaasStoppedAt: null, lastPaidDueDate: '2026-11-16', needsAdminReview: false, adminNote: null, ...over,
  }
}

function courtesy(over: Partial<SubscriptionRow> = {}): SubscriptionRow {
  return paid({
    id: 'cortesia:abc', kind: 'courtesy', planKey: 'pro_anual', cycle: null, nextDueDate: null, paidUntil: null, accessUntil: null,
    asaasSubscriptionId: null, lastPaidDueDate: null, ...over,
  })
}

function detail(over: Partial<SubscriberDetailData> = {}, profile: Partial<SubscriberDetailData['profile']> = {}): SubscriberDetailData {
  return {
    profile: {
      userId: USER, email: 'ana@igreja.com', name: 'Ana Souza', provider: 'google', plan: 'essencial_mensal', planExpiresAt: null, isAdmin: false,
      blockedAt: null, blockedReason: null, createdAt: '2026-10-01T12:00:00Z', lastSignInAt: null, lastSeenAt: null, ...profile,
    },
    quota: { used: 4, bonus: 0, periodStart: '2026-11-01T03:00:00+00:00', resetsAt: '2026-12-01T03:00:00+00:00', limit: 5 },
    subscriptions: [paid()],
    payments: [],
    legacyPayments: [],
    separations: { month: 4, total: 9 },
    aiCost: { monthBrl: 0, totalBrl: 0, jobsWithoutCost: 0 },
    openActions: [],
    plans: PLANS,
    asaasLive: [],
    mismatches: [],
    ...over,
  }
}

beforeEach(() => {
  h.adminPost.mockReset()
  h.adminGet.mockReset()
  h.adminPost.mockResolvedValue({ result: 'ok' })
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

function setup(d: SubscriberDetailData = detail()) {
  const reload = vi.fn()
  const view = render(<SubscriberActions detail={d} reload={reload} />)
  return { reload, ...view }
}

const panelButton = (name: string) => within(screen.getByRole('region', { name: 'Ações' })).queryByRole('button', { name })
const open = (name: string) => {
  const button = panelButton(name)
  if (!button) throw new Error(`sem o botão ${name}`)
  fireEvent.click(button)
  return screen.getByRole('dialog')
}
const confirmButton = (dialog: HTMLElement, name: string) => within(dialog).getByRole('button', { name }) as HTMLButtonElement

describe('SubscriberActions: quais botões aparecem', () => {
  it('Mudar plano não aparece sem paga ativa', () => {
    setup(detail({ subscriptions: [] }))
    expect(panelButton('Mudar plano')).toBeNull()
    expect(panelButton('Cancelar assinatura')).toBeNull()
    expect(panelButton('Dar cortesia')).toBeTruthy()
    cleanup()

    // Paga cancelada ainda no período também não é paga ativa.
    setup(detail({ subscriptions: [paid({ status: 'canceled', accessUntil: '2099-12-17T03:00:00+00:00' })] }))
    expect(panelButton('Mudar plano')).toBeNull()
    expect(panelButton('Cancelar assinatura')).toBeNull()
    cleanup()

    setup()
    expect(panelButton('Mudar plano')).toBeTruthy()
    expect(panelButton('Cancelar assinatura')).toBeTruthy()
  })

  it('Bloquear não aparece pra admin, nem Desbloquear', () => {
    setup(detail({}, { isAdmin: true }))
    expect(panelButton('Bloquear')).toBeNull()
    expect(panelButton('Desbloquear')).toBeNull()
    cleanup()

    setup(detail({}, { isAdmin: true, blockedAt: '2026-11-16T12:00:00Z' }))
    expect(panelButton('Bloquear')).toBeNull()
    expect(panelButton('Desbloquear')).toBeNull()
  })

  it('conta bloqueada mostra Desbloquear; conta livre mostra Bloquear', () => {
    setup(detail({}, { blockedAt: '2026-11-16T12:00:00Z', blockedReason: 'fraude' }))
    expect(panelButton('Desbloquear')).toBeTruthy()
    expect(panelButton('Bloquear')).toBeNull()
    cleanup()
    setup()
    expect(panelButton('Bloquear')).toBeTruthy()
    expect(panelButton('Desbloquear')).toBeNull()
  })

  it('Encerrar cortesia só com cortesia ativa', () => {
    setup()
    expect(panelButton('Encerrar cortesia')).toBeNull()
    cleanup()
    setup(detail({ subscriptions: [courtesy({ status: 'canceled', canceledAt: '2026-11-01T12:00:00Z' })] }))
    expect(panelButton('Encerrar cortesia')).toBeNull()
    cleanup()
    setup(detail({ subscriptions: [courtesy({ accessUntil: '2020-01-02T03:00:00+00:00' })] }))
    expect(panelButton('Encerrar cortesia')).toBeNull()
    cleanup()
    setup(detail({ subscriptions: [courtesy()] }))
    expect(panelButton('Encerrar cortesia')).toBeTruthy()
  })

  it('Ajustar cota não aparece pra conta sem limite (admin)', () => {
    setup(detail({ quota: { ...detail().quota, limit: null } }, { isAdmin: true }))
    expect(panelButton('Ajustar cota')).toBeNull()
    cleanup()
    setup()
    expect(panelButton('Ajustar cota')).toBeTruthy()
  })
})

describe('SubscriberActions: cada ação manda o pedido certo', () => {
  it('Mudar plano lista só os outros 3 planos e manda change-plan com o escolhido', async () => {
    const { reload } = setup()
    const dialog = open('Mudar plano')
    const select = within(dialog).getByLabelText('Plano novo') as HTMLSelectElement
    const choices = Array.from(select.options).filter((o) => o.value !== '').map((o) => o.value)
    expect(choices).toEqual(['essencial_anual', 'pro_mensal', 'pro_anual'])

    // Sem escolher, nada sai.
    fireEvent.click(confirmButton(dialog, 'Mudar plano'))
    expect(await within(dialog).findByText('Escolha o plano novo.')).toBeTruthy()
    expect(h.adminPost).not.toHaveBeenCalled()

    fireEvent.change(select, { target: { value: 'pro_mensal' } })
    const expected = changePlanText(PLANS[0], PLANS[2], '2026-12-16')
    expect(norm(dialog.textContent)).toContain(norm(expected))
    fireEvent.click(confirmButton(dialog, 'Mudar plano'))
    await waitFor(() => expect(h.adminPost).toHaveBeenCalledTimes(1))
    expect(h.adminPost).toHaveBeenCalledWith('change-plan', { userId: USER, planKey: 'pro_mensal' })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('confirmar cortesia de 30 dias manda grant-courtesy com days 30', async () => {
    setup()
    const dialog = open('Dar cortesia')
    fireEvent.change(within(dialog).getByLabelText('Plano da cortesia'), { target: { value: 'pro_anual' } })
    fireEvent.click(within(dialog).getByRole('radio', { name: '30 dias' }))
    expect(dialog.textContent).toContain(courtesyText('pro_anual', courtesyLastDay(30), 'essencial_mensal'))
    fireEvent.change(within(dialog).getByLabelText('Nota (opcional)'), { target: { value: '  Líder de louvor  ' } })
    fireEvent.click(confirmButton(dialog, 'Dar cortesia'))
    await waitFor(() => expect(h.adminPost).toHaveBeenCalledTimes(1))
    expect(h.adminPost).toHaveBeenCalledWith('grant-courtesy', { userId: USER, planKey: 'pro_anual', days: 30, note: 'Líder de louvor' })
  })

  it('Sem data manda days null (e sem nota não manda o campo)', async () => {
    setup(detail({ subscriptions: [] }, { plan: 'free' }))
    const dialog = open('Dar cortesia')
    fireEvent.change(within(dialog).getByLabelText('Plano da cortesia'), { target: { value: 'pro_anual' } })
    fireEvent.click(within(dialog).getByRole('radio', { name: 'Sem data' }))
    expect(dialog.textContent).toContain(courtesyText('pro_anual', null, null))
    fireEvent.click(confirmButton(dialog, 'Dar cortesia'))
    await waitFor(() => expect(h.adminPost).toHaveBeenCalledTimes(1))
    expect(h.adminPost).toHaveBeenCalledWith('grant-courtesy', { userId: USER, planKey: 'pro_anual', days: null })
  })

  it('Outro manda o número escrito; vazio ou fora de 1 a 365 não manda nada', async () => {
    setup(detail({ subscriptions: [] }, { plan: 'free' }))
    const dialog = open('Dar cortesia')
    fireEvent.change(within(dialog).getByLabelText('Plano da cortesia'), { target: { value: 'essencial_mensal' } })
    // Sem escolher a duração, nada sai.
    fireEvent.click(confirmButton(dialog, 'Dar cortesia'))
    expect(await within(dialog).findByText('Escolha por quantos dias vale a cortesia, ou Sem data.')).toBeTruthy()

    fireEvent.click(within(dialog).getByRole('radio', { name: 'Outro' }))
    const days = within(dialog).getByLabelText('Quantos dias (1 a 365)')
    fireEvent.click(confirmButton(dialog, 'Dar cortesia'))
    expect(await within(dialog).findByText('Escreva um número de dias de 1 a 365.')).toBeTruthy()
    fireEvent.change(days, { target: { value: '366' } })
    fireEvent.click(confirmButton(dialog, 'Dar cortesia'))
    await within(dialog).findByText('Escreva um número de dias de 1 a 365.')
    expect(h.adminPost).not.toHaveBeenCalled()

    fireEvent.change(days, { target: { value: '45' } })
    expect(dialog.textContent).toContain(courtesyText('essencial_mensal', courtesyLastDay(45), null))
    fireEvent.click(confirmButton(dialog, 'Dar cortesia'))
    await waitFor(() => expect(h.adminPost).toHaveBeenCalledTimes(1))
    expect(h.adminPost).toHaveBeenCalledWith('grant-courtesy', { userId: USER, planKey: 'essencial_mensal', days: 45 })
  })

  // Ruling ADM-FINAL-onda: a tela espelha o servidor e nem oferece cortesia de plano igual ou menor
  // que a paga ativa.
  it('paga ativa: Dar cortesia lista só os planos maiores que o pago e diz por quê', () => {
    setup()
    const dialog = open('Dar cortesia')
    const select = within(dialog).getByLabelText('Plano da cortesia') as HTMLSelectElement
    expect(Array.from(select.options).filter((o) => o.value !== '').map((o) => o.value)).toEqual(['pro_mensal', 'pro_anual'])
    expect(dialog.textContent).toContain(onlyHigherText('essencial_mensal'))
    cleanup()

    // Paga de Pro Anual: o mesmo nível (Pro Mensal) também fica de fora.
    setup(detail({ subscriptions: [paid({ planKey: 'essencial_anual', cycle: 'YEARLY' })] }, { plan: 'essencial_anual' }))
    const anual = open('Dar cortesia')
    const options = Array.from((within(anual).getByLabelText('Plano da cortesia') as HTMLSelectElement).options)
    expect(options.filter((o) => o.value !== '').map((o) => o.value)).toEqual(['pro_mensal', 'pro_anual'])
  })

  it('quem paga Studio não vê Dar cortesia, e o painel diz por quê', () => {
    setup(detail({ subscriptions: [paid({ planKey: 'pro_mensal' })] }, { plan: 'pro_mensal' }))
    expect(panelButton('Dar cortesia')).toBeNull()
    expect(screen.getByRole('region', { name: 'Ações' }).textContent).toContain(noCourtesyText('pro_mensal'))
    // As outras ações da paga seguem.
    expect(panelButton('Mudar plano')).toBeTruthy()
    expect(panelButton('Cancelar assinatura')).toBeTruthy()
  })

  it('sem paga ativa, Dar cortesia lista os 4 planos e não fala da paga', () => {
    setup(detail({ subscriptions: [] }, { plan: 'free' }))
    const dialog = open('Dar cortesia')
    const select = within(dialog).getByLabelText('Plano da cortesia') as HTMLSelectElement
    expect(Array.from(select.options).filter((o) => o.value !== '').map((o) => o.value)).toEqual(PLANS.map((p) => p.key))
    expect(dialog.textContent).not.toContain('Só planos maiores')
    expect(screen.getByRole('region', { name: 'Ações' }).textContent).not.toContain('Dar cortesia não aparece')
  })

  // T26 Minor 3: a frase do Encerrar cortesia segue a regra do billing_sync_profile.
  it('Encerrar cortesia sem paga ativa: a outra cortesia vale antes da paga cancelada no período', () => {
    const graced = paid({ id: 'sub-old', planKey: 'pro_mensal', status: 'canceled', accessUntil: '2099-12-17T03:00:00+00:00' })
    const other = courtesy({ id: 'cortesia:pro', planKey: 'essencial_mensal', startedAt: '2026-11-01T12:00:00Z' })
    setup(detail({ subscriptions: [courtesy(), other, graced] }, { plan: 'pro_anual' }))
    const dialog = open('Encerrar cortesia de Studio Anual')
    expect(dialog.textContent).toContain('A cortesia de Studio Anual acaba agora. Nada muda no Asaas. A conta fica com a outra cortesia, de Pro Mensal.')
  })

  it('Encerrar cortesia sem outra cortesia: vale a paga cancelada no período de início mais recente', () => {
    const olderStudio = paid({ id: 'sub-1', planKey: 'pro_mensal', status: 'canceled', startedAt: '2026-09-01T12:00:00Z', accessUntil: '2099-12-31T03:00:00+00:00' })
    const newerPro = paid({ id: 'sub-2', planKey: 'essencial_mensal', status: 'canceled', startedAt: '2026-10-01T12:00:00Z', accessUntil: '2099-12-17T03:00:00+00:00' })
    setup(detail({ subscriptions: [courtesy(), olderStudio, newerPro] }, { plan: 'pro_anual' }))
    const dialog = open('Encerrar cortesia')
    expect(dialog.textContent).toContain('A conta volta para o Pro Mensal pago até 16/12/2099 e depois para o Livre.')
  })

  it('Encerrar cortesia com paga ativa: a outra cortesia só vale se for de plano maior que a paga', () => {
    const studio = courtesy({ id: 'cortesia:studio', planKey: 'pro_mensal' })
    setup(detail({ subscriptions: [paid(), courtesy(), studio] }, { plan: 'pro_anual' }))
    expect(open('Encerrar cortesia de Studio Anual').textContent).toContain('A conta fica com a outra cortesia, de Studio Mensal.')
    cleanup()
    // A outra cortesia é do mesmo nível da paga (Pro): vale a paga.
    const pro = courtesy({ id: 'cortesia:pro', planKey: 'essencial_anual' })
    setup(detail({ subscriptions: [paid(), courtesy(), pro] }, { plan: 'pro_anual' }))
    expect(open('Encerrar cortesia de Studio Anual').textContent).toContain('A conta volta para o Pro Mensal pago.')
  })

  it('Encerrar cortesia manda end-courtesy com o id e diz pra onde a conta volta', async () => {
    setup(detail({ subscriptions: [paid(), courtesy()] }))
    const dialog = open('Encerrar cortesia')
    expect(dialog.textContent).toContain('A cortesia de Studio Anual acaba agora. Nada muda no Asaas. A conta volta para o Pro Mensal pago.')
    fireEvent.click(confirmButton(dialog, 'Encerrar cortesia'))
    await waitFor(() => expect(h.adminPost).toHaveBeenCalledTimes(1))
    expect(h.adminPost).toHaveBeenCalledWith('end-courtesy', { userId: USER, courtesyId: 'cortesia:abc' })
  })

  it('Cancelar agora manda when now e usa o tom de alerta', async () => {
    setup()
    const dialog = open('Cancelar assinatura')
    fireEvent.click(within(dialog).getByRole('radio', { name: 'Agora' }))
    expect(dialog.textContent).toContain(cancelText('now', 'essencial_mensal', null))
    const button = confirmButton(dialog, 'Cancelar assinatura agora')
    expect(button.className).toContain('bg-ps-alert-soft')
    fireEvent.click(button)
    await waitFor(() => expect(h.adminPost).toHaveBeenCalledTimes(1))
    expect(h.adminPost).toHaveBeenCalledWith('cancel-subscription', { userId: USER, when: 'now' })
  })

  it('Cancelar no fim do período manda period_end, mostra o último dia pago e usa o laranja', async () => {
    setup()
    const dialog = open('Cancelar assinatura')
    fireEvent.click(within(dialog).getByRole('radio', { name: 'No fim do período' }))
    // paidUntil 2099-12-17T03:00Z é o começo do dia seguinte: o último dia é 16/12/2099.
    expect(dialog.textContent).toContain(cancelText('period_end', 'essencial_mensal', '2099-12-16'))
    const button = confirmButton(dialog, 'Cancelar no fim do período')
    expect(button.className).toContain('bg-ps-or')
    expect(button.className).not.toContain('bg-ps-alert-soft')
    fireEvent.click(button)
    await waitFor(() => expect(h.adminPost).toHaveBeenCalledTimes(1))
    expect(h.adminPost).toHaveBeenCalledWith('cancel-subscription', { userId: USER, when: 'period_end' })
  })

  it('Cancelar sem escolher quando não manda nada', async () => {
    setup()
    const dialog = open('Cancelar assinatura')
    fireEvent.click(confirmButton(dialog, 'Cancelar assinatura'))
    expect(await within(dialog).findByText('Escolha quando cancelar.')).toBeTruthy()
    expect(h.adminPost).not.toHaveBeenCalled()
  })

  it('Bloquear pede o motivo, avisa antes que a cobrança continua e usa o tom de alerta', async () => {
    setup()
    const dialog = open('Bloquear')
    expect(dialog.textContent).toContain(BILLING_CONTINUES)
    const button = confirmButton(dialog, 'Bloquear')
    expect(button.className).toContain('bg-ps-alert-soft')
    expect(button.disabled).toBe(true)
    // O motivo fica legível pra própria pessoa: a linha sob o campo avisa quem escreve.
    const reason = within(dialog).getByLabelText('Motivo')
    expect(document.getElementById(reason.getAttribute('aria-describedby') ?? '')?.textContent).toContain('A pessoa pode ver este motivo.')
    fireEvent.change(within(dialog).getByLabelText('Motivo'), { target: { value: 'Estorno no cartão e segue usando' } })
    expect(button.disabled).toBe(false)
    fireEvent.click(button)
    await waitFor(() => expect(h.adminPost).toHaveBeenCalledTimes(1))
    expect(h.adminPost).toHaveBeenCalledWith('block', { userId: USER, reason: 'Estorno no cartão e segue usando' })
  })

  it('Bloquear numa conta Livre não fala de cobrança', () => {
    setup(detail({ subscriptions: [] }, { plan: 'free' }))
    const dialog = open('Bloquear')
    expect(dialog.textContent).not.toContain(BILLING_CONTINUES)
    expect(dialog.textContent).not.toContain(LEGACY_BILLING_WARNING)
    expect(dialog.textContent).toContain('A pessoa perde o acesso ao app agora')
  })

  it('assinante antigo: o Bloquear avisa da cobrança antiga em âmbar, e Mudar plano e Cancelar seguem escondidos', () => {
    setup(detail({ subscriptions: [] }, { plan: 'essencial_mensal' }))
    expect(panelButton('Mudar plano')).toBeNull()
    expect(panelButton('Cancelar assinatura')).toBeNull()
    const dialog = open('Bloquear')
    const warning = within(dialog).getByText(LEGACY_BILLING_WARNING)
    expect(warning.className).toContain('bg-ps-alert-soft')
    expect(dialog.textContent).not.toContain(BILLING_CONTINUES)
  })

  it('assinante antigo: Dar cortesia avisa em âmbar e só confirma com a caixa marcada, que vai no pedido', async () => {
    const LEGACY = { id: 'chk_old', planKey: 'essencial_mensal', value: 49.9, cycle: 'MONTHLY', paidAt: '2026-10-20T12:00:00Z' }
    setup(detail({ subscriptions: [], legacyPayments: [LEGACY] }, { plan: 'essencial_mensal' }))
    const dialog = open('Dar cortesia')
    expect(within(dialog).getByText(LEGACY_COURTESY_WARNING).className).toContain('bg-ps-alert-soft')
    const box = within(dialog).getByRole('checkbox', { name: LEGACY_STOPPED_LABEL }) as HTMLInputElement
    expect(box.checked).toBe(false)
    fireEvent.change(within(dialog).getByLabelText('Plano da cortesia'), { target: { value: 'pro_anual' } })
    fireEvent.click(within(dialog).getByRole('radio', { name: 'Sem data' }))
    // Caixa desmarcada: Confirmar desligado e nada sai.
    expect(confirmButton(dialog, 'Dar cortesia').disabled).toBe(true)
    fireEvent.click(confirmButton(dialog, 'Dar cortesia'))
    expect(h.adminPost).not.toHaveBeenCalled()
    fireEvent.click(box)
    expect(box.checked).toBe(true)
    expect(confirmButton(dialog, 'Dar cortesia').disabled).toBe(false)
    fireEvent.click(confirmButton(dialog, 'Dar cortesia'))
    await waitFor(() => expect(h.adminPost).toHaveBeenCalledTimes(1))
    expect(h.adminPost).toHaveBeenCalledWith('grant-courtesy', { userId: USER, planKey: 'pro_anual', days: null, legacyChargeStopped: true })
  })

  it('assinante antigo com cortesia ativa: Encerrar cortesia também pede a caixa', async () => {
    const LEGACY = { id: 'chk_old', planKey: 'essencial_mensal', value: 49.9, cycle: 'MONTHLY', paidAt: '2026-10-20T12:00:00Z' }
    setup(detail({ subscriptions: [courtesy()], legacyPayments: [LEGACY] }, { plan: 'pro_anual' }))
    let dialog = open('Encerrar cortesia')
    expect(dialog.textContent).toContain(LEGACY_COURTESY_WARNING)
    expect(confirmButton(dialog, 'Encerrar cortesia').disabled).toBe(true)
    // Reabrir começa com a caixa desmarcada.
    fireEvent.click(within(dialog).getByRole('checkbox', { name: LEGACY_STOPPED_LABEL }))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancelar' }))
    dialog = open('Encerrar cortesia')
    const box = within(dialog).getByRole('checkbox', { name: LEGACY_STOPPED_LABEL }) as HTMLInputElement
    expect(box.checked).toBe(false)
    fireEvent.click(box)
    fireEvent.click(confirmButton(dialog, 'Encerrar cortesia'))
    await waitFor(() => expect(h.adminPost).toHaveBeenCalledTimes(1))
    expect(h.adminPost).toHaveBeenCalledWith('end-courtesy', { userId: USER, courtesyId: 'cortesia:abc', legacyChargeStopped: true })
  })

  it('conta normal: a cortesia não tem caixa nem aviso e não manda o campo', () => {
    setup(detail({ subscriptions: [paid(), courtesy()] }))
    for (const name of ['Dar cortesia', 'Encerrar cortesia']) {
      const dialog = open(name)
      expect(within(dialog).queryByRole('checkbox')).toBeNull()
      expect(dialog.textContent).not.toContain(LEGACY_COURTESY_WARNING)
      fireEvent.click(within(dialog).getByRole('button', { name: 'Cancelar' }))
    }
  })

  it('a caixa do assinante antigo fica desligada com o pedido no ar, e tem alvo de 44 px', async () => {
    h.adminPost.mockImplementation(() => new Promise(() => {}))
    const LEGACY = { id: 'chk_old', planKey: 'essencial_mensal', value: 49.9, cycle: 'MONTHLY', paidAt: '2026-10-20T12:00:00Z' }
    setup(detail({ subscriptions: [courtesy()], legacyPayments: [LEGACY] }, { plan: 'pro_anual' }))
    const dialog = open('Encerrar cortesia')
    const box = within(dialog).getByRole('checkbox', { name: LEGACY_STOPPED_LABEL }) as HTMLInputElement
    expect(box.closest('label')?.className).toContain('min-h-ps-touch')
    fireEvent.click(box)
    fireEvent.click(confirmButton(dialog, 'Encerrar cortesia'))
    await waitFor(() => expect(box.disabled).toBe(true))
  })

  it('cortesia ativa ou plano vencido não é assinante antigo', () => {
    setup(detail({ subscriptions: [courtesy()] }, { plan: 'pro_anual' }))
    expect(open('Bloquear').textContent).not.toContain(LEGACY_BILLING_WARNING)
    cleanup()
    setup(detail({ subscriptions: [] }, { plan: 'essencial_mensal', planExpiresAt: '2020-01-02T03:00:00Z' }))
    expect(open('Bloquear').textContent).not.toContain(LEGACY_BILLING_WARNING)
  })

  it('Desbloquear manda unblock', async () => {
    setup(detail({}, { blockedAt: '2026-11-16T12:00:00Z' }))
    const dialog = open('Desbloquear')
    expect(dialog.textContent).toContain('O acesso volta agora. Nada muda no Asaas.')
    fireEvent.click(confirmButton(dialog, 'Desbloquear'))
    await waitFor(() => expect(h.adminPost).toHaveBeenCalledTimes(1))
    expect(h.adminPost).toHaveBeenCalledWith('unblock', { userId: USER })
  })

  it('Ajustar cota: Somar 10 manda add com a quantidade', async () => {
    setup()
    const dialog = open('Ajustar cota')
    fireEvent.click(within(dialog).getByRole('radio', { name: 'Somar' }))
    const amount = within(dialog).getByLabelText('Quantas separações (1 a 500)')
    fireEvent.click(confirmButton(dialog, 'Somar separações'))
    expect(await within(dialog).findByText('Escreva um número de separações de 1 a 500.')).toBeTruthy()
    fireEvent.change(amount, { target: { value: '501' } })
    fireEvent.click(confirmButton(dialog, 'Somar separações'))
    await within(dialog).findByText('Escreva um número de separações de 1 a 500.')
    expect(h.adminPost).not.toHaveBeenCalled()

    fireEvent.change(amount, { target: { value: '10' } })
    expect(dialog.textContent).toContain(quotaText('add', 4, 5, 0, 10, monthRange(brtTodayLocal(), 0).to))
    fireEvent.click(confirmButton(dialog, 'Somar separações'))
    await waitFor(() => expect(h.adminPost).toHaveBeenCalledTimes(1))
    expect(h.adminPost).toHaveBeenCalledWith('adjust-quota', { userId: USER, mode: 'add', amount: 10 })
  })

  it('Ajustar cota: Zerar manda reset sem quantidade', async () => {
    setup()
    const dialog = open('Ajustar cota')
    fireEvent.click(confirmButton(dialog, 'Ajustar cota'))
    expect(await within(dialog).findByText('Escolha entre Zerar e Somar.')).toBeTruthy()
    fireEvent.click(within(dialog).getByRole('radio', { name: 'Zerar' }))
    expect(dialog.textContent).toContain(quotaText('reset', 4, 5, 0, null, monthRange(brtTodayLocal(), 0).to))
    fireEvent.click(confirmButton(dialog, 'Zerar contador'))
    await waitFor(() => expect(h.adminPost).toHaveBeenCalledTimes(1))
    expect(h.adminPost).toHaveBeenCalledWith('adjust-quota', { userId: USER, mode: 'reset' })
  })
})

describe('SubscriberActions: resposta e trava', () => {
  it('sucesso fecha, mostra Feito. e recarrega a ficha', async () => {
    const { reload } = setup()
    const dialog = open('Bloquear')
    fireEvent.change(within(dialog).getByLabelText('Motivo'), { target: { value: 'fraude no cartão' } })
    fireEvent.click(confirmButton(dialog, 'Bloquear'))
    expect(await screen.findByText('Feito.')).toBeTruthy()
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('cancelamento com a parada no Asaas pendente diz isso no lugar do Feito.', async () => {
    h.adminPost.mockResolvedValue({ result: 'canceled', accessUntil: '2099-12-17T03:00:00Z', pendingStop: true })
    setup()
    const dialog = open('Cancelar assinatura')
    fireEvent.click(within(dialog).getByRole('radio', { name: 'No fim do período' }))
    fireEvent.click(confirmButton(dialog, 'Cancelar no fim do período'))
    expect(
      await screen.findByText('Feito. Parar a cobrança no Asaas ficou pendente e o app tenta de novo sozinho; acompanhe em Pendências.'),
    ).toBeTruthy()
  })

  it('erro do servidor fica no diálogo e Confirmar volta pra tentar de novo', async () => {
    h.adminPost.mockRejectedValueOnce(new AdminApiError('Esta conta já tem uma cortesia de Studio Anual ativa.', 409))
    const { reload } = setup()
    const dialog = open('Dar cortesia')
    fireEvent.change(within(dialog).getByLabelText('Plano da cortesia'), { target: { value: 'pro_anual' } })
    fireEvent.click(within(dialog).getByRole('radio', { name: 'Sem data' }))
    fireEvent.click(confirmButton(dialog, 'Dar cortesia'))
    const alert = await within(dialog).findByRole('alert')
    expect(alert.textContent).toBe('Esta conta já tem uma cortesia de Studio Anual ativa.')
    expect(screen.getByRole('dialog')).toBe(dialog)
    // A ficha chega de novo (a conta pode ter mudado), e o erro certo deixa tentar de novo.
    expect(reload).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(confirmButton(dialog, 'Dar cortesia').disabled).toBe(false))
    fireEvent.click(confirmButton(dialog, 'Dar cortesia'))
    await waitFor(() => expect(h.adminPost).toHaveBeenCalledTimes(2))
  })

  it('erro incerto segura Confirmar até fechar e abrir, e a frase fica na ficha', async () => {
    h.adminPost.mockRejectedValueOnce(new AdminApiError(MSG_UNCERTAIN, 502, true))
    setup()
    let dialog = open('Cancelar assinatura')
    fireEvent.click(within(dialog).getByRole('radio', { name: 'Agora' }))
    fireEvent.click(confirmButton(dialog, 'Cancelar assinatura agora'))
    expect((await within(dialog).findByRole('alert')).textContent).toBe(MSG_UNCERTAIN)
    await waitFor(() => expect(within(dialog).getByRole('button', { name: 'Cancelar' }).hasAttribute('disabled')).toBe(false))
    expect(confirmButton(dialog, 'Cancelar assinatura agora').disabled).toBe(true)
    fireEvent.click(confirmButton(dialog, 'Cancelar assinatura agora'))
    expect(h.adminPost).toHaveBeenCalledTimes(1)

    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancelar' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(within(screen.getByRole('region', { name: 'Ações' })).getByText(MSG_UNCERTAIN)).toBeTruthy()

    // Reabrir começa do zero: a pessoa conferiu e decide de novo.
    dialog = open('Cancelar assinatura')
    expect(within(dialog).queryByRole('alert')).toBeNull()
    fireEvent.click(within(dialog).getByRole('radio', { name: 'Agora' }))
    expect(confirmButton(dialog, 'Cancelar assinatura agora').disabled).toBe(false)
  })

  it('uncertain: true no corpo do servidor segura o Somar (pelo adminApi de verdade)', async () => {
    h.adminPost.mockImplementation((action: string, body: Record<string, unknown>) => h.realPost!(action, body))
    const f = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        new Response(JSON.stringify({ error: MSG_QUOTA_UNCONFIRMED, uncertain: true }), { status: 500, headers: { 'Content-Type': 'application/json' } }),
      )
    setup()
    const dialog = open('Ajustar cota')
    fireEvent.click(within(dialog).getByRole('radio', { name: 'Somar' }))
    fireEvent.change(within(dialog).getByLabelText('Quantas separações (1 a 500)'), { target: { value: '10' } })
    fireEvent.click(confirmButton(dialog, 'Somar separações'))
    expect((await within(dialog).findByRole('alert')).textContent).toBe(MSG_QUOTA_UNCONFIRMED)
    await waitFor(() => expect(within(dialog).getByRole('button', { name: 'Cancelar' }).hasAttribute('disabled')).toBe(false))
    expect(confirmButton(dialog, 'Somar separações').disabled).toBe(true)
    fireEvent.click(confirmButton(dialog, 'Somar separações'))
    expect(f).toHaveBeenCalledTimes(1)
  })

  it('dois cliques seguidos em Confirmar mandam uma vez, e o diálogo fica ocupado', async () => {
    let finish: (v: unknown) => void = () => {}
    h.adminPost.mockImplementation(() => new Promise((resolve) => (finish = resolve)))
    setup()
    const dialog = open('Ajustar cota')
    fireEvent.click(within(dialog).getByRole('radio', { name: 'Somar' }))
    fireEvent.change(within(dialog).getByLabelText('Quantas separações (1 a 500)'), { target: { value: '10' } })
    const button = confirmButton(dialog, 'Somar separações')
    fireEvent.click(button)
    fireEvent.click(button)
    expect(h.adminPost).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(button.disabled).toBe(true))
    expect(within(dialog).getByRole('button', { name: 'Cancelar' }).hasAttribute('disabled')).toBe(true)
    // Com o pedido no ar, a escolha não muda o que foi mandado.
    expect((within(dialog).getByLabelText('Quantas separações (1 a 500)') as HTMLInputElement).disabled).toBe(true)
    for (const radio of within(dialog).getAllByRole('radio')) expect((radio as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(button)
    expect(h.adminPost).toHaveBeenCalledTimes(1)
    finish({ used: 4, bonus: 10, periodStart: '2026-11-01T03:00:00Z' })
    expect(await screen.findByText('Feito.')).toBeTruthy()
    expect(h.adminPost).toHaveBeenCalledTimes(1)
  })
})

describe('SubscriberActions na aba Assinantes', () => {
  it('a ficha traz as ações, e o sucesso recarrega a ficha, o registro, a lista e a fila de Pendências', async () => {
    h.responses = {
      subscribers: { total: 1, page: 1, pageSize: 50, rows: [] },
      subscriber: detail(),
      audit: { total: 0, page: 1, pageSize: 50, rows: [] },
    }
    h.adminGet.mockImplementation(async (name: string) => h.responses[name])
    const onQueueChange = vi.fn()
    render(<SubscribersTab onNavigate={() => {}} focusUserId={USER} onQueueChange={onQueueChange} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Bloquear' }))
    const dialog = screen.getByRole('dialog', { name: 'Bloquear a conta' })
    fireEvent.change(within(dialog).getByLabelText('Motivo'), { target: { value: 'fraude no cartão' } })
    await waitFor(() => expect(h.adminGet.mock.calls.map((c) => c[0]).sort()).toEqual(['audit', 'subscriber', 'subscribers']))
    const before = h.adminGet.mock.calls.length
    fireEvent.click(confirmButton(dialog, 'Bloquear'))
    await waitFor(() => expect(h.adminGet.mock.calls.length).toBe(before + 3))
    expect(h.adminGet.mock.calls.slice(before).map((c) => c[0]).sort()).toEqual(['audit', 'subscriber', 'subscribers'])
    expect(onQueueChange).toHaveBeenCalledTimes(1)
    expect(await screen.findByText('Feito.')).toBeTruthy()
  })
})

describe('SubscriberActions: visual e texto', () => {
  it('alvos de 44 px e campos de 16 px (o Safari não amplia)', () => {
    setup(detail({ subscriptions: [paid(), courtesy()] }))
    const region = screen.getByRole('region', { name: 'Ações' })
    for (const button of within(region).getAllByRole('button')) expect(button.className).toContain('min-h-ps-touch')

    let dialog = open('Dar cortesia')
    const select = within(dialog).getByLabelText('Plano da cortesia')
    expect(select.className).toContain('min-h-ps-touch')
    expect(select.className).toContain('text-ps-md')
    fireEvent.click(within(dialog).getByRole('radio', { name: 'Outro' }))
    const days = within(dialog).getByLabelText('Quantos dias (1 a 365)')
    expect(days.className).toContain('min-h-ps-touch')
    expect(days.className).toContain('text-ps-md')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancelar' }))

    dialog = open('Mudar plano')
    expect(within(dialog).getByLabelText('Plano novo').className).toContain('min-h-ps-touch')
  })

  it('texto sem TRAVESSAO em nenhum diálogo', () => {
    setup(detail({ subscriptions: [paid(), courtesy()] }))
    const steps: Array<[string, string | null]> = [
      ['Mudar plano', null],
      ['Dar cortesia', 'Sem data'],
      ['Encerrar cortesia', null],
      ['Cancelar assinatura', 'Agora'],
      ['Bloquear', null],
      ['Ajustar cota', 'Somar'],
    ]
    for (const [name, radio] of steps) {
      const dialog = open(name)
      if (radio) fireEvent.click(within(dialog).getByRole('radio', { name: radio }))
      expect(document.body.textContent).not.toContain(TRAVESSAO)
      fireEvent.click(within(dialog).getByRole('button', { name: 'Cancelar' }))
    }
    expect(document.body.textContent).not.toContain(TRAVESSAO)
  })
})

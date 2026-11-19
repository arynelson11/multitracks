import { createHmac } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'
import { AsaasError } from '../_lib/asaas.js'
import { BillingError, changePlan, handleAsaasEvent, previewCancellation, runPendingActions, type BillingDeps } from '../_lib/billing.js'
import { checkOfferCpf, hashCpf } from '../_lib/offerCpf.js'
import type { FakeDb, Row } from './fakeSupabase.js'
import { USER_A, USER_B, asaasDown, asaasRejected, createBillingDb, createFakeAsaas, forbiddenInWebhook, payment, type FakeAsaas } from './billingHarness.js'

// Oferta do primeiro mês depois do pagamento (Parte 3, T13, D9 e D10). O CHECKOUT_PAID de um
// checkout com desconto marca a oferta como usada, confere o CPF por HMAC (nunca o número) e
// cria a pendência restore_full_price, tentada na hora e de novo até a assinatura do Asaas
// voltar pro preço cheio do plano atual. Asaas e banco falsos (billingHarness), nenhuma rede.

const NOW = new Date('2026-11-19T15:30:00.000Z') // 12:30 em Brasília
const PAID_AT = '2026-11-19T15:10:00.000Z' // dateCreated '2026-11-19 12:10:00' (Brasília)
const SECRET = 'segredo-falso-so-de-teste'
const CPF = '12345678909'
const CPF_SHOWN = '123.456.789-09'
const TRAVESSAO = String.fromCharCode(0x2014)
const NOTE_REUSED = 'oferta do primeiro mes: o mesmo CPF ja usou a oferta em outra conta'
const NOTE_UNCHECKED = 'oferta do primeiro mes: CPF nao conferido (Asaas fora ou servidor sem OFFER_CPF_SECRET)'
const FULL_PRO = { value: 49.9, cycle: 'MONTHLY', description: 'Playback Studio Pro (mensal)', updatePendingPayments: true }
const FULL_STUDIO = { value: 119.9, cycle: 'MONTHLY', description: 'Playback Studio Studio (mensal)', updatePendingPayments: true }

let clock: Date
let db: FakeDb
let asaas: FakeAsaas
let deps: BillingDeps
let putDown: boolean
let customerDown: boolean
// cpfCnpj de cada cliente no Asaas (ausente: o Asaas responde 404)
let cpfOf: Record<string, string | null | undefined>
// assinatura criada por cada checkout (null: o Asaas ainda não mostra a assinatura)
let subOf: Record<string, string | null>
let logs: MockInstance[]

function offerCheckout(id: string, over: Partial<Row> = {}): Row {
  return {
    id, user_id: USER_A, plan_key: 'essencial_mensal', switch_confirmed: false, created_at: '2026-11-19T15:00:00.000Z',
    offer_month: '2026-11', offer_value: 24.9, ...over,
  }
}

function offerRow(id: number, over: Partial<Row> = {}): Row {
  return {
    id, user_id: USER_A, month: '2026-11', trigger_kind: 'separations', shown_at: '2026-11-19T14:00:00.000Z',
    expires_at: '2026-11-21T14:00:00.000Z', used_at: null, checkout_id: null, cpf_hash: null, ...over,
  }
}

// A primeira cobrança da assinatura (com desconto e paga).
function firstCharge(sub: string, chk: string, value = 24.9) {
  return payment({ id: `pay_${sub}`, subscription: sub, checkoutSession: chk, value, dueDate: '2026-11-19', originalDueDate: '2026-11-19', confirmedDate: '2026-11-19', status: 'CONFIRMED' })
}

function makeAsaas(): FakeAsaas {
  return createFakeAsaas({
    get: (path, params) => {
      const q = (params ?? {}) as Record<string, unknown>
      if (path.endsWith('/notifications')) return { data: [] }
      const cus = /^\/customers\/([^/]+)$/.exec(path)
      if (cus) {
        if (customerDown) throw asaasDown()
        if (!Object.hasOwn(cpfOf, cus[1])) throw new AsaasError('not_found', 'não encontrado no Asaas', 404)
        return { id: cus[1], name: 'Fulano de Tal', email: 'fulano@exemplo.com', cpfCnpj: cpfOf[cus[1]] }
      }
      if (path === '/payments' && typeof q.checkoutSession === 'string') {
        const sub = subOf[q.checkoutSession]
        return { data: sub ? [firstCharge(sub, q.checkoutSession)] : [] }
      }
      if (path === '/payments' && typeof q.subscription === 'string') {
        const chk = Object.keys(subOf).find((k) => subOf[k] === q.subscription) ?? null
        return { data: chk ? [firstCharge(String(q.subscription), chk)] : [], hasMore: false }
      }
      return { data: [], hasMore: false }
    },
    put: (path) => {
      if (putDown && path.startsWith('/subscriptions/')) throw asaasDown()
      return {}
    },
  })
}

const paid = (checkoutId = 'chk_1', at = '2026-11-19 12:10:00', customer: string | null = 'cus_1') =>
  handleAsaasEvent(deps, {
    event: 'CHECKOUT_PAID', dateCreated: at,
    checkout: { id: checkoutId, status: 'PAID', customer, subscription: { cycle: 'MONTHLY', nextDueDate: '2026-11-19T03:00:00+0000' } },
  })

const later = (ms: number) => { clock = new Date(clock.getTime() + ms) }
const restores = () => db.tables.billing_pending_actions.filter((a) => a.action === 'restore_full_price')
const sub = (id: string) => db.tables.billing_subscriptions.find((r) => r.id === id)!
const profile = () => db.tables.profiles.find((p) => p.id === USER_A)!
// PUTs de preço (os de inativar levam só o status)
const priceCalls = () => (asaas.put.mock.calls as [string, Record<string, unknown>][]).filter(([path, body]) => path.startsWith('/subscriptions/') && body && 'value' in body)
const customerReads = () => (asaas.get.mock.calls as [string][]).filter(([path]) => /^\/customers\/[^/]+$/.test(path))
const rpcArgs = (name: string) => db.rpcCalls.filter((c) => c.name === name).map((c) => c.args)
const offerUsedEvents = () => db.tables.product_events.filter((e) => e.kind === 'offer_used')

beforeEach(() => {
  clock = NOW
  putDown = false
  customerDown = false
  cpfOf = { cus_1: CPF, cus_2: '98765432100' }
  subOf = { chk_1: 'sub_1', chk_a: 'sub_a', chk_b: 'sub_b' }
  vi.stubEnv('OFFER_CPF_SECRET', SECRET)
  logs = (['log', 'info', 'warn', 'error'] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => {}))
  db = createBillingDb({
    profiles: [{ id: USER_A, plan: 'free', plan_expires_at: null }, { id: USER_B, plan: 'free', plan_expires_at: null }],
    pending_checkouts: [offerCheckout('chk_1')],
    first_month_offers: [offerRow(1)],
  }, () => clock)
  asaas = makeAsaas()
  deps = { db: db as never, asaas, now: () => clock }
})

afterEach(() => {
  // O PUT de preço não é estorno nem cancelamento do usuário (COB-R8).
  expect(forbiddenInWebhook(db, asaas)).toEqual([])
  const notes = [
    ...db.tables.billing_subscriptions.map((r) => String(r.admin_note ?? '')),
    ...db.tables.billing_pending_actions.map((a) => `${String(a.done_note ?? '')} ${String(a.last_error ?? '')}`),
  ]
  expect(notes.filter((t) => t.includes(TRAVESSAO))).toEqual([])
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
})

describe('CHECKOUT_PAID com a oferta do primeiro mês', () => {
  it('CHECKOUT_PAID com oferta: marca a oferta, grava payments com 24.9 e troca no Asaas pra 49.9 com updatePendingPayments', async () => {
    expect(await paid()).toEqual({ result: 'activated' })

    expect(asaas.put).toHaveBeenCalledWith('/subscriptions/sub_1', FULL_PRO)
    expect(db.tables.payments.find((p) => p.id === 'chk_1')?.value).toBe(24.9)
    // o uso fica com a hora do pagamento (o funil conta pelo mês do evento)
    expect(rpcArgs('offer_mark_used')).toEqual([{ p_user_id: USER_A, p_month: '2026-11', p_checkout_id: 'chk_1', p_now: PAID_AT }])
    expect(db.tables.first_month_offers[0]).toMatchObject({ used_at: PAID_AT, checkout_id: 'chk_1', cpf_hash: hashCpf(CPF, SECRET) })
    expect(offerUsedEvents()).toHaveLength(1)
    expect(rpcArgs('billing_enqueue_action').filter((a) => a.p_action === 'restore_full_price')).toEqual([
      expect.objectContaining({ p_ref: 'chk_1', p_reason: 'oferta_primeiro_mes', p_amount: 49.9, p_user_id: USER_A }),
    ])
    expect(restores()).toEqual([expect.objectContaining({ subscription_ref: 'chk_1', status: 'done', done_note: 'preco cheio: R$ 49,90', amount: 49.9 })])
    // CPF novo: nada marcado pro admin
    expect(sub('chk_1').needs_admin_review).toBe(false)
  })

  it('Studio Mensal com oferta: grava 59.9 e volta pra 119.9', async () => {
    db.tables.pending_checkouts[0] = offerCheckout('chk_1', { plan_key: 'pro_mensal', offer_value: 59.9 })
    expect(await paid()).toEqual({ result: 'activated' })
    expect(db.tables.payments.find((p) => p.id === 'chk_1')?.value).toBe(59.9)
    expect(priceCalls()).toEqual([['/subscriptions/sub_1', FULL_STUDIO]])
    expect(restores()[0]).toMatchObject({ status: 'done', done_note: 'preco cheio: R$ 119,90', amount: 119.9 })
  })

  it('Asaas fora na troca: a pendência restore_full_price fica aberta e a próxima rodada troca e fecha', async () => {
    putDown = true
    expect(await paid()).toEqual({ result: 'activated' })
    expect(restores()).toEqual([expect.objectContaining({ subscription_ref: 'chk_1', status: 'pending', attempts: 1, auto_retry: true })])
    expect(String(restores()[0].last_error)).toContain('Asaas sem resposta')

    putDown = false
    later(11 * 60_000)
    await runPendingActions(deps) // como o job diário (sem lista de ids)
    expect(restores()[0]).toMatchObject({ status: 'done', done_note: 'preco cheio: R$ 49,90' })
    expect(priceCalls().at(-1)).toEqual(['/subscriptions/sub_1', FULL_PRO])
  })

  it('Asaas recusando a troca: a pendência fica aberta pra tentar de novo (não fecha calada)', async () => {
    asaas.put.mockImplementation(async () => { throw asaasRejected('valor invalido') })
    expect(await paid()).toEqual({ result: 'activated' })
    expect(restores()).toEqual([expect.objectContaining({ status: 'pending', attempts: 1 })])
  })

  it('o plano já vale mesmo com a troca pendente', async () => {
    putDown = true
    await paid()
    expect(profile().plan).toBe('essencial_mensal')
    expect(sub('chk_1').status).toBe('active')
    expect(restores()[0].status).toBe('pending')
  })

  it('assinatura ainda sem id no Asaas: a pendência fica aberta e tenta de novo', async () => {
    subOf.chk_1 = null
    expect(await paid()).toEqual({ result: 'activated' })
    expect(priceCalls()).toEqual([])
    expect(restores()).toEqual([expect.objectContaining({ status: 'pending', attempts: 1, last_error: 'assinatura nao achada no Asaas' })])

    subOf.chk_1 = 'sub_1'
    later(25 * 3600_000)
    await runPendingActions(deps)
    expect(priceCalls()).toEqual([['/subscriptions/sub_1', FULL_PRO]])
    expect(restores()[0]).toMatchObject({ status: 'done', done_note: 'preco cheio: R$ 49,90' })
  })

  it('assinatura encerrada antes da troca fecha a pendência sem chamar o Asaas', async () => {
    putDown = true
    await paid()
    expect(restores()[0].status).toBe('pending')
    // a assinatura foi removida no painel do Asaas antes da nova tentativa
    await handleAsaasEvent(deps, { event: 'SUBSCRIPTION_DELETED', subscription: { id: 'sub_1', checkoutSession: 'chk_1', customer: 'cus_1', deleted: true } })
    expect(sub('chk_1').status).toBe('canceled')
    // e uma pendência cuja assinatura nem existe no app
    db.tables.billing_pending_actions.push({
      id: 99, subscription_ref: 'chk_sumiu', user_id: USER_A, action: 'restore_full_price', reason: 'oferta_primeiro_mes', asaas_subscription_id: null,
      asaas_payment_id: null, due_date: null, amount: 49.9, auto_retry: true, status: 'pending', attempts: 0, last_error: null, next_attempt_at: clock.toISOString(),
    })

    asaas.get.mockClear()
    asaas.put.mockClear()
    putDown = false
    later(11 * 60_000)
    await runPendingActions(deps)
    expect(asaas.put).not.toHaveBeenCalled()
    expect(asaas.get).not.toHaveBeenCalled()
    expect(restores().map((a) => [a.subscription_ref, a.status, a.done_note])).toEqual([
      ['chk_1', 'done', 'assinatura encerrada, nada a trocar'],
      ['chk_sumiu', 'done', 'assinatura encerrada, nada a trocar'],
    ])
  })

  it('admin trocou pro Studio antes da troca: vai 119.9', async () => {
    putDown = true
    await paid()
    putDown = false
    // a troca do admin usa o mesmo PUT (R14)
    expect(await changePlan(deps, { userId: USER_A, newPlanKey: 'pro_mensal' })).toEqual({ result: 'changed', planKey: 'pro_mensal' })
    expect(priceCalls().at(-1)).toEqual(['/subscriptions/sub_1', FULL_STUDIO])

    asaas.put.mockClear()
    later(11 * 60_000)
    await runPendingActions(deps)
    expect(priceCalls()).toEqual([['/subscriptions/sub_1', FULL_STUDIO]])
    expect(restores()[0]).toMatchObject({ status: 'done', done_note: 'preco cheio: R$ 119,90' })
  })

  it('dois checkouts com desconto pagos: cada um ganha a sua pendência', async () => {
    db.tables.pending_checkouts = [offerCheckout('chk_a'), offerCheckout('chk_b', { created_at: '2026-11-19T15:01:00.000Z' })]
    putDown = true
    expect(await paid('chk_a', '2026-11-19 12:10:00')).toEqual({ result: 'activated' })
    expect(await paid('chk_b', '2026-11-19 12:12:00')).toEqual({ result: 'duplicate' })
    expect(restores().map((a) => a.subscription_ref)).toEqual(['chk_a', 'chk_b'])
    // a oferta conta uma vez só (a conta já usou)
    expect(offerUsedEvents()).toHaveLength(1)
    expect(db.tables.first_month_offers[0]).toMatchObject({ checkout_id: 'chk_a' })

    putDown = false
    asaas.put.mockClear()
    later(11 * 60_000)
    await runPendingActions(deps)
    // a que ficou volta pro cheio; a repetida (encerrada, renovação parada) fecha sem trocar
    expect(priceCalls()).toEqual([['/subscriptions/sub_a', FULL_PRO]])
    expect(restores().map((a) => [a.subscription_ref, a.status, a.done_note])).toEqual([
      ['chk_a', 'done', 'preco cheio: R$ 49,90'],
      ['chk_b', 'done', 'assinatura encerrada, nada a trocar'],
    ])
  })

  it('compra repetida com o Asaas no ar: a pendência dela fecha sem trocar o preço da assinatura parada', async () => {
    db.tables.pending_checkouts = [offerCheckout('chk_a'), offerCheckout('chk_b', { created_at: '2026-11-19T15:01:00.000Z' })]
    await paid('chk_a', '2026-11-19 12:10:00')
    expect(await paid('chk_b', '2026-11-19 12:12:00')).toEqual({ result: 'duplicate' })
    // a regra de uma assinatura por conta roda antes: a repetida já está encerrada
    expect(priceCalls().map(([path]) => path)).toEqual(['/subscriptions/sub_a'])
    expect(restores().find((a) => a.subscription_ref === 'chk_b')).toMatchObject({ status: 'done', done_note: 'assinatura encerrada, nada a trocar' })
  })

  it('CHECKOUT_PAID repetido: não grava outro offer_used nem duplica a pendência aberta', async () => {
    putDown = true
    await paid()
    await paid()
    expect(offerUsedEvents()).toHaveLength(1)
    expect(restores()).toHaveLength(1)
    expect(restores()[0].status).toBe('pending')
    // o CPF é conferido uma vez (só quando a oferta foi marcada agora)
    expect(customerReads()).toHaveLength(1)
  })

  it('checkout sem oferta: nenhuma pendência de preço', async () => {
    db.tables.pending_checkouts[0] = { id: 'chk_1', user_id: USER_A, plan_key: 'essencial_mensal', switch_confirmed: false, created_at: '2026-11-19T15:00:00.000Z', offer_month: null, offer_value: null }
    expect(await paid()).toEqual({ result: 'activated' })
    expect(restores()).toEqual([])
    expect(db.tables.payments.find((p) => p.id === 'chk_1')?.value).toBe(49.9)
    expect(rpcArgs('offer_mark_used')).toEqual([])
    expect(rpcArgs('offer_record_cpf')).toEqual([])
    expect(priceCalls()).toEqual([])
    expect(customerReads()).toEqual([])
  })

  it('sem as colunas da oferta (SQL ainda não rodou) o CHECKOUT_PAID ativa normal', async () => {
    for (const code of ['42703', 'PGRST204']) {
      db.tables.pending_checkouts = [{ id: 'chk_1', user_id: USER_A, plan_key: 'essencial_mensal', switch_confirmed: false, created_at: '2026-11-19T15:00:00.000Z' }]
      db.tables.billing_subscriptions = []
      db.tables.payments = []
      profile().plan = 'free'
      const selects = spyMissingOfferColumns(code)
      expect(await paid(), code).toEqual({ result: 'activated' })
      // leu com as colunas, recebeu o erro de coluna e leu de novo sem elas
      expect(selects.filter((s) => s.includes('offer_month')).length, code).toBeGreaterThan(0)
      expect(selects.some((s) => !s.includes('offer_month')), code).toBe(true)
      expect(profile().plan).toBe('essencial_mensal')
      expect(db.tables.payments.find((p) => p.id === 'chk_1')?.value).toBe(49.9)
      expect(restores()).toEqual([])
      vi.mocked(db.from).mockRestore()
    }
  })

  it('outro erro do banco ao ler o checkout lança (o aviso fica pra nova tentativa)', async () => {
    db.failTable('pending_checkouts', { message: 'connection reset', code: '08006' })
    await expect(paid()).rejects.toBeInstanceOf(BillingError)
    expect(restores()).toEqual([])
  })

  it('erro do banco ao marcar a oferta ou criar a pendência lança, e a nova tentativa cria a pendência', async () => {
    const mark = db.setRpc('offer_mark_used', () => { throw new Error('connection reset') })!
    await expect(paid()).rejects.toBeInstanceOf(BillingError)
    expect(restores()).toEqual([])
    db.setRpc('offer_mark_used', mark)

    const enqueue = db.setRpc('billing_enqueue_action', (a) => { if (a.p_action === 'restore_full_price') throw new Error('connection reset'); return null })!
    await expect(paid()).rejects.toBeInstanceOf(BillingError)
    db.setRpc('billing_enqueue_action', enqueue)

    // a terceira (o aviso reprocessado) cria a pendência e troca o preço
    expect(await paid()).toEqual({ result: 'activated' })
    expect(restores()).toEqual([expect.objectContaining({ subscription_ref: 'chk_1', status: 'done' })])
    expect(offerUsedEvents()).toHaveLength(1)
  })

  it('oferta sem registro daquela conta no mês (no_offer): a pendência de preço nasce mesmo assim e o CPF não é lido', async () => {
    db.tables.first_month_offers = []
    expect(await paid()).toEqual({ result: 'activated' })
    expect(restores()).toEqual([expect.objectContaining({ status: 'done', done_note: 'preco cheio: R$ 49,90' })])
    expect(customerReads()).toEqual([])
    expect(offerUsedEvents()).toEqual([])
  })

  it('arrependimento depois da oferta: a prévia mostra 24,90', async () => {
    await paid()
    const preview = await previewCancellation(deps, USER_A)
    expect(preview.outcome).toBe('refund_auto')
    expect(preview.amount).toBe(24.9)
  })
})

describe('CPF da oferta (HMAC, nunca o número)', () => {
  it('CPF já usado noutra conta marca a ficha', async () => {
    for (const other of [USER_B, null]) {
      db.tables.first_month_offers = [
        offerRow(1),
        offerRow(2, { user_id: other, month: '2026-10', used_at: '2026-10-05T12:00:00.000Z', checkout_id: 'chk_velho', cpf_hash: hashCpf(CPF, SECRET) }),
      ]
      db.tables.billing_subscriptions = []
      expect(await paid(), String(other)).toEqual({ result: 'activated' })
      expect(sub('chk_1').admin_note, String(other)).toContain(NOTE_REUSED)
      expect(sub('chk_1').needs_admin_review).toBe(true)
      // a cobrança segue: a volta pro preço cheio acontece do mesmo jeito
      expect(restores().at(-1)).toMatchObject({ status: 'done' })
    }
  })

  it('o mesmo CPF formatado no Asaas (pontos e traço) também é achado', async () => {
    cpfOf.cus_1 = CPF_SHOWN
    db.tables.first_month_offers.push(offerRow(2, { user_id: USER_B, month: '2026-10', used_at: '2026-10-05T12:00:00.000Z', cpf_hash: hashCpf(CPF, SECRET) }))
    await paid()
    expect(rpcArgs('offer_record_cpf')).toEqual([{ p_user_id: USER_A, p_month: '2026-11', p_cpf_hash: hashCpf(CPF, SECRET) }])
    expect(sub('chk_1').admin_note).toContain(NOTE_REUSED)
  })

  it('Asaas fora ao ler o CPF marca CPF não conferido e não derruba a ativação', async () => {
    customerDown = true
    expect(await paid()).toEqual({ result: 'activated' })
    expect(sub('chk_1').admin_note).toContain(NOTE_UNCHECKED)
    expect(rpcArgs('offer_record_cpf')).toEqual([])
    expect(profile().plan).toBe('essencial_mensal')
    expect(restores()[0]).toMatchObject({ status: 'done' })
  })

  it('sem OFFER_CPF_SECRET marca CPF não conferido', async () => {
    vi.stubEnv('OFFER_CPF_SECRET', '')
    expect(await paid()).toEqual({ result: 'activated' })
    expect(sub('chk_1').admin_note).toContain(NOTE_UNCHECKED)
    // sem o segredo nem pergunta o CPF ao Asaas
    expect(customerReads()).toEqual([])
    expect(rpcArgs('offer_record_cpf')).toEqual([])
  })

  it('cliente sem CPF no Asaas, cliente que o Asaas não acha ou checkout sem cliente: CPF não conferido', async () => {
    const input = { userId: USER_A, checkoutId: 'chk_1', month: '2026-11' }
    await paid() // cria a linha da assinatura pra receber a marcação
    for (const customerId of ['cus_sem_cpf', 'cus_que_sumiu', null]) {
      cpfOf = { cus_sem_cpf: null }
      sub('chk_1').admin_note = null
      expect(await checkOfferCpf(deps, { ...input, customerId }), String(customerId)).toBe('unchecked')
      expect(sub('chk_1').admin_note, String(customerId)).toContain(NOTE_UNCHECKED)
    }
  })

  it('registro do CPF recusado (sem registro no mês, P0002) ou banco fora: CPF não conferido, sem lançar', async () => {
    await paid()
    sub('chk_1').admin_note = null
    const input = { userId: USER_A, checkoutId: 'chk_1', customerId: 'cus_1', month: '2026-12' }
    expect(await checkOfferCpf(deps, input)).toBe('unchecked')
    expect(sub('chk_1').admin_note).toContain(NOTE_UNCHECKED)
    // nem a marcação pro admin falhando derruba
    db.setRpc('billing_flag_review', () => { throw new Error('connection reset') })
    db.setRpc('offer_record_cpf', () => { throw new Error('connection reset') })
    expect(await checkOfferCpf(deps, { ...input, month: '2026-11' })).toBe('unchecked')
  })

  it('checkOfferCpf devolve ok e reused e grava só o hash', async () => {
    await paid()
    const input = { userId: USER_A, checkoutId: 'chk_1', customerId: 'cus_1', month: '2026-11' }
    expect(await checkOfferCpf(deps, input)).toBe('ok')
    db.tables.first_month_offers.push(offerRow(3, { user_id: USER_B, month: '2026-09', used_at: '2026-09-01T12:00:00.000Z', cpf_hash: hashCpf(CPF, SECRET) }))
    expect(await checkOfferCpf(deps, input)).toBe('reused')
    expect(JSON.stringify(db.rpcCalls)).not.toContain(CPF)
  })

  it('hashCpf ignora pontos e traço, tem 64 caracteres e nunca contém o número', () => {
    expect(hashCpf('123.456.789-09', 's')).toBe(hashCpf('12345678909', 's'))
    expect(hashCpf(CPF, 's')).toMatch(/^[0-9a-f]{64}$/)
    expect(hashCpf(CPF, 's')).not.toContain(CPF)
    // HMAC-SHA256 dos dígitos com o segredo (D9): segredo diferente, hash diferente
    expect(hashCpf(CPF, 's')).toBe(createHmac('sha256', 's').update(CPF).digest('hex'))
    expect(hashCpf(CPF, 's')).not.toBe(hashCpf(CPF, 'outro'))
  })

  it('o CPF nunca vai pro log', async () => {
    cpfOf.cus_1 = CPF_SHOWN
    db.tables.first_month_offers.push(offerRow(2, { user_id: USER_B, month: '2026-10', used_at: '2026-10-05T12:00:00.000Z', cpf_hash: hashCpf(CPF, SECRET) }))
    putDown = true
    await paid() // CPF repetido, troca pendente (avisos no log)
    const input = { userId: USER_A, checkoutId: 'chk_1', customerId: 'cus_1', month: '2026-11' }
    db.setRpc('offer_record_cpf', () => { throw new Error('connection reset') })
    await checkOfferCpf(deps, input) // registro do CPF fora
    customerDown = true
    await checkOfferCpf(deps, input) // Asaas fora
    const logged = JSON.stringify(logs.map((s) => s.mock.calls))
    for (const shown of [CPF, CPF_SHOWN]) {
      expect(logged).not.toContain(shown)
      expect(JSON.stringify(db.rpcCalls)).not.toContain(shown)
      expect(JSON.stringify(db.tables)).not.toContain(shown)
    }
    // os avisos existem (o teste não passa por log vazio)
    expect(logs.some((s) => s.mock.calls.length > 0)).toBe(true)
  })
})

// Espião local (R6): o banco falso só falha a tabela inteira, e aqui só o select com as
// colunas novas de pending_checkouts falha, como o PostgREST sem a coluna.
function spyMissingOfferColumns(code: string): string[] {
  const selects: string[] = []
  const realFrom = db.from.bind(db)
  vi.spyOn(db, 'from').mockImplementation((table: string) => {
    const qb = realFrom(table)
    if (table !== 'pending_checkouts') return qb
    const realSelect = qb.select.bind(qb)
    qb.select = ((cols?: string) => {
      selects.push(String(cols))
      if (!String(cols).includes('offer_month')) return realSelect(cols)
      const failed = { data: null, error: { message: 'column pending_checkouts.offer_month does not exist', code } }
      const q = {
        eq: () => q,
        maybeSingle: () => q,
        then: (ok: (v: typeof failed) => unknown, bad?: (e: unknown) => unknown) => Promise.resolve(failed).then(ok, bad),
      }
      return q as unknown as ReturnType<typeof realSelect>
    }) as typeof qb.select
    return qb
  })
  return selects
}

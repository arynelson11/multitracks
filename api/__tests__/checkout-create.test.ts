import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRes, type FakeDb } from './fakeSupabase.js'
import { USER_A, createBillingDb, createFakeAsaas, payment, subRow } from './billingHarness.js'
import { handleAsaasEvent } from '../_lib/billing.js'

// Criar checkout: recusa (409) quando já existe assinatura ativa do mesmo
// plano (duas abas, app antigo) e nunca devolve detalhe do Asaas ao navegador.

const post = vi.fn()
let db: FakeDb
vi.mock('axios', () => ({ default: { create: () => ({ post }), isAxiosError: () => false } }))
vi.mock('@supabase/supabase-js', () => ({ createClient: () => db }))
vi.mock('../_lib/auth.js', () => ({
  verifyUser: vi.fn(async () => ({ ok: true, userId: USER_A, email: 'quem@igreja.com', isAdmin: false })),
}))

async function create(planKey: string, extra: Record<string, unknown> = {}) {
  const { default: handler } = await import('../checkout.js')
  const res = createRes()
  await handler({ method: 'POST', headers: { authorization: 'Bearer x' }, body: { planKey, ...extra } }, res)
  return res
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-11-16T15:00:00Z'))
  vi.stubEnv('ASAAS_API_KEY', 'fake-key')
  vi.stubEnv('VITE_SUPABASE_URL', 'https://fake.supabase.co')
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'fake-service-role')
  post.mockReset()
  post.mockResolvedValue({ data: { id: 'chk_9', link: 'https://asaas.test/c/chk_9' } })
  db = createBillingDb({ profiles: [{ id: USER_A, plan: 'free', plan_expires_at: null }] })
})
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs() })

describe('checkout: compra duplicada (I7)', () => {
  it('assinatura ativa do mesmo plano: 409 com mensagem clara e nenhum checkout no Asaas', async () => {
    db.tables.billing_subscriptions.push(subRow({ id: 'chk_1', user_id: USER_A, plan_key: 'essencial_mensal' }))
    const res = await create('essencial_mensal')
    expect(res.statusCode).toBe(409)
    expect((res.body as { error: string }).error).toContain('Você já tem o Pro Mensal ativo')
    expect(post).not.toHaveBeenCalled()
  })

  it('assinante de antes desta versão (só profiles.plan) também é barrado no mesmo plano', async () => {
    db.tables.profiles[0].plan = 'pro_anual'
    expect((await create('pro_anual')).statusCode).toBe(409)
    expect(post).not.toHaveBeenCalled()
  })

  it('outro plano (troca) segue normal', async () => {
    db.tables.billing_subscriptions.push(subRow({ id: 'chk_1', user_id: USER_A, plan_key: 'essencial_mensal' }))
    db.tables.profiles[0].plan = 'essencial_mensal'
    const res = await create('pro_mensal')
    expect(res.statusCode).toBe(200)
    expect(res.body).toEqual({ url: 'https://asaas.test/c/chk_9' })
  })

  it('assinatura cancelada ainda no período pago pode assinar de novo o mesmo plano', async () => {
    db.tables.billing_subscriptions.push(subRow({ id: 'chk_1', user_id: USER_A, status: 'canceled', access_until: '2026-12-17T03:00:00Z' }))
    Object.assign(db.tables.profiles[0], { plan: 'essencial_mensal', plan_expires_at: '2026-12-17T03:00:00Z' })
    expect((await create('essencial_mensal')).statusCode).toBe(200)
  })
})

describe('checkout: troca confirmada na tela (I7)', () => {
  it('grava se a pessoa confirmou o "Trocar de plano?"', async () => {
    await create('pro_mensal', { confirmedSwitch: true })
    expect(db.tables.pending_checkouts[0]).toMatchObject({ id: 'chk_9', plan_key: 'pro_mensal', switch_confirmed: true })
  })
  it('sem confirmação (Livre, app antigo) grava falso', async () => {
    await create('pro_mensal')
    expect(db.tables.pending_checkouts[0].switch_confirmed).toBe(false)
  })
})

describe('checkout: erro do Asaas', () => {
  it('não devolve detalhe do Asaas ao navegador', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    post.mockRejectedValue(Object.assign(new Error('Request failed'), { response: { data: { errors: [{ code: 'invalid_x', description: 'detalhe interno' }] } } }))
    const res = await create('pro_mensal')
    expect(res.statusCode).toBe(502)
    expect(JSON.stringify(res.body)).not.toContain('detalhe interno')
    expect(res.body).not.toHaveProperty('details')
  })
})

// Oferta do primeiro mês (Parte 3, T12): o desconto só vale no Pro Mensal e no Studio Mensal,
// na primeira assinatura da conta e com a janela de 48 horas aberta, tudo conferido aqui no
// servidor. Sem direito ou sem janela: 409 com offerEnded e nenhum checkout no Asaas (o app
// mostra o preço cheio e a pessoa decide). Nunca cobra o preço cheio por baixo.
describe('checkout com a oferta do primeiro mês', () => {
  const OFFER_NOW = '2026-11-19T15:00:00.000Z'
  const ACTIVE = { status: 'active', expiresAt: '2026-11-21T15:00:00.000Z', month: '2026-11' }
  const ENDED = 'A oferta do primeiro mês terminou. O preço agora é o cheio.'
  const FIRST_ONLY = 'A oferta do primeiro mês vale só na primeira assinatura da conta.'
  const DOWN = 'Não deu para abrir o pagamento agora. Tente de novo em alguns minutos.'
  const TRAVESSAO = String.fromCharCode(0x2014)
  const item = () => post.mock.calls[0][1].items[0] as { value: number; name: string; description: string }

  beforeEach(() => {
    vi.setSystemTime(new Date(OFFER_NOW))
    db.setRpc('offer_current', () => ACTIVE)
    db.setRpc('offer_open_window', () => { throw new Error('o checkout nunca abre janela') })
  })

  it('oferta ativa no Pro Mensal: item com value 24.9 e pending_checkouts com offer_value 24.9 e o mês', async () => {
    const res = await create('essencial_mensal', { offer: true })
    expect(res.statusCode).toBe(200)
    expect(res.body).toEqual({ url: 'https://asaas.test/c/chk_9' })
    expect(post).toHaveBeenCalledTimes(1)
    expect(item()).toEqual({
      name: 'Pro Mensal (1º mês)',
      description: 'Primeiro mês por R$ 24,90. A partir do segundo mês, R$ 49,90 por mês. Cancele quando quiser.',
      quantity: 1,
      value: 24.9,
    })
    expect(JSON.stringify(item())).not.toContain(TRAVESSAO)
    expect(post.mock.calls[0][1].subscription).toEqual({ cycle: 'MONTHLY', nextDueDate: '2026-11-19' })
    expect(db.tables.pending_checkouts[0]).toMatchObject({ id: 'chk_9', user_id: USER_A, plan_key: 'essencial_mensal', offer_value: 24.9, offer_month: '2026-11' })
    // só lê a janela (com a hora do servidor), nunca abre
    expect(db.rpcCalls).toEqual([{ name: 'offer_current', args: { p_user_id: USER_A, p_now: OFFER_NOW } }])
  })

  it('oferta no Studio Mensal: 59.9', async () => {
    const res = await create('pro_mensal', { offer: true })
    expect(res.statusCode).toBe(200)
    expect(item()).toEqual({
      name: 'Studio Mensal (1º mês)',
      description: 'Primeiro mês por R$ 59,90. A partir do segundo mês, R$ 119,90 por mês. Cancele quando quiser.',
      quantity: 1,
      value: 59.9,
    })
    expect(JSON.stringify(item())).not.toContain(TRAVESSAO)
    expect(post.mock.calls[0][1].subscription.cycle).toBe('MONTHLY')
    expect(db.tables.pending_checkouts[0]).toMatchObject({ plan_key: 'pro_mensal', offer_value: 59.9, offer_month: '2026-11' })
  })

  it('o mês gravado é o da janela, não o de hoje (janela de 30/11 usada em 01/12)', async () => {
    vi.setSystemTime(new Date('2026-12-01T12:00:00Z'))
    db.setRpc('offer_current', () => ({ status: 'active', expiresAt: '2026-12-02T00:00:00.000Z', month: '2026-11' }))
    await create('essencial_mensal', { offer: true })
    expect(db.tables.pending_checkouts[0]).toMatchObject({ offer_month: '2026-11', offer_value: 24.9 })
  })

  it('oferta no Pro Anual: 400 com a frase', async () => {
    for (const planKey of ['essencial_anual', 'pro_anual']) {
      const res = await create(planKey, { offer: true })
      expect(res.statusCode, planKey).toBe(400)
      expect(res.body).toEqual({ error: 'A oferta do primeiro mês vale só no Pro Mensal e no Studio Mensal.' })
    }
    expect(post).not.toHaveBeenCalled()
    expect(db.rpcCalls).toEqual([])
    expect(db.tables.pending_checkouts).toEqual([])
  })

  it('janela vencida: 409 com offerEnded e nenhum checkout no Asaas', async () => {
    db.setRpc('offer_current', () => ({ status: 'expired', expiresAt: null, month: '2026-11' }))
    const res = await create('essencial_mensal', { offer: true })
    expect(res.statusCode).toBe(409)
    expect(res.body).toEqual({ error: ENDED, offerEnded: true })
    expect(post).not.toHaveBeenCalled()
    expect(db.tables.pending_checkouts).toEqual([])
  })

  it('oferta já usada ou nunca aberta: 409 com offerEnded', async () => {
    for (const answer of [{ status: 'used', expiresAt: null, month: '2026-10' }, { status: 'none', expiresAt: null, month: null }]) {
      db.setRpc('offer_current', () => answer)
      const res = await create('pro_mensal', { offer: true })
      expect(res.statusCode, answer.status).toBe(409)
      expect(res.body).toEqual({ error: ENDED, offerEnded: true })
    }
    expect(post).not.toHaveBeenCalled()
  })

  it('active com o relógio já vencido (ou vencendo agora): 409, nunca cobra', async () => {
    for (const answer of [
      { status: 'active', expiresAt: '2026-11-19T14:59:59.000Z', month: '2026-11' },
      { status: 'active', expiresAt: OFFER_NOW, month: '2026-11' },
    ]) {
      db.setRpc('offer_current', () => answer)
      const res = await create('essencial_mensal', { offer: true })
      expect(res.statusCode, JSON.stringify(answer)).toBe(409)
      expect(res.body).toEqual({ error: ENDED, offerEnded: true })
    }
    expect(post).not.toHaveBeenCalled()
  })

  it('resposta do registro fora do formato (active sem o mês ou com data estragada): 500, nunca cobra', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    for (const answer of [
      { status: 'active', expiresAt: '2026-11-21T15:00:00.000Z', month: null },
      { status: 'active', expiresAt: 'amanhã', month: '2026-11' },
      { status: 'talvez' },
    ]) {
      db.setRpc('offer_current', () => answer)
      const res = await create('essencial_mensal', { offer: true })
      expect(res.statusCode, JSON.stringify(answer)).toBe(500)
      expect(res.body).toEqual({ error: DOWN })
    }
    expect(post).not.toHaveBeenCalled()
  })

  it('segunda assinatura da conta: 409 com offerEnded', async () => {
    db.tables.billing_subscriptions.push(subRow({ id: 'chk_1', user_id: USER_A, status: 'canceled', cancel_source: 'user', access_until: '2026-11-10T03:00:00Z' }))
    const res = await create('essencial_mensal', { offer: true })
    expect(res.statusCode).toBe(409)
    expect(res.body).toEqual({ error: FIRST_ONLY, offerEnded: true })
    expect(post).not.toHaveBeenCalled()
    expect(db.rpcCalls).toEqual([])
  })

  it('pagou antes pelo registro antigo (payments): 409 com offerEnded', async () => {
    db.tables.payments.push({ id: 'pay_1', user_id: USER_A, asaas_checkout_id: 'chk_antigo', value: 49.9 })
    const res = await create('pro_mensal', { offer: true })
    expect(res.statusCode).toBe(409)
    expect(res.body).toEqual({ error: FIRST_ONLY, offerEnded: true })
    expect(post).not.toHaveBeenCalled()
  })

  it('conta só com cortesia: a oferta vale', async () => {
    db.tables.billing_subscriptions.push(subRow({ id: 'crt_1', user_id: USER_A, kind: 'courtesy', plan_key: 'pro_mensal' }))
    const res = await create('essencial_mensal', { offer: true })
    expect(res.statusCode).toBe(200)
    expect(item().value).toBe(24.9)
  })

  it('registro da oferta fora do ar (SQL ainda não rodou ou erro do banco): 500, nunca o preço cheio nem a frase de oferta terminada', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    db.setRpc('offer_current', () => { throw new Error('function public.offer_current does not exist') })
    const res = await create('essencial_mensal', { offer: true })
    expect(res.statusCode).toBe(500)
    expect(res.body).toEqual({ error: DOWN })
    expect(JSON.stringify(res.body)).not.toContain('does not exist')
    expect(post).not.toHaveBeenCalled()
    expect(db.tables.pending_checkouts).toEqual([])
    expect(error).toHaveBeenCalled()
  })

  it('a contagem das assinaturas é lida uma vez só: uma falha numa segunda leitura não vira o 409 de oferta terminada', async () => {
    const from = db.from.bind(db)
    let paymentsReads = 0
    db.from = (table: string) => {
      if (table === 'payments' && ++paymentsReads > 1) db.failTable('payments', { message: 'connection reset', code: '08006' })
      return from(table)
    }
    const res = await create('essencial_mensal', { offer: true })
    expect(res.statusCode).toBe(200)
    expect(item().value).toBe(24.9)
    expect(paymentsReads).toBe(1)
  })

  it('erro ao ler as assinaturas da conta: 500 sem abrir pagamento', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    db.failTable('payments', { message: 'connection reset', code: '08006' })
    const res = await create('essencial_mensal', { offer: true })
    expect(res.statusCode).toBe(500)
    expect(res.body).toEqual({ error: 'Não deu para abrir o pagamento agora. Tente de novo em alguns minutos.' })
    expect(post).not.toHaveBeenCalled()
    expect(db.rpcCalls).toEqual([])
  })

  it('offer que não é booleano: 400 sem abrir pagamento', async () => {
    for (const offer of ['true', 1, 'sim', {}]) {
      const res = await create('essencial_mensal', { offer })
      expect(res.statusCode, JSON.stringify(offer)).toBe(400)
    }
    expect(post).not.toHaveBeenCalled()
    expect(db.rpcCalls).toEqual([])
  })

  it('sem offer no corpo: preço cheio 49.9 e pending_checkouts sem as colunas da oferta', async () => {
    for (const extra of [{}, { offer: false }, { offer: null }]) {
      post.mockClear()
      db.tables.pending_checkouts = []
      const res = await create('essencial_mensal', extra)
      expect(res.statusCode, JSON.stringify(extra)).toBe(200)
      expect(item()).toEqual({ name: 'Pro Mensal', description: 'Playback Studio Pro (mensal)', quantity: 1, value: 49.9 })
      const row = db.tables.pending_checkouts[0]
      expect(Object.keys(row)).not.toContain('offer_month')
      expect(Object.keys(row)).not.toContain('offer_value')
    }
    expect(db.rpcCalls).toEqual([])
  })

  // Duas abas: o checkout aberto e ainda não pago não conta como assinatura (barrar o segundo
  // deixaria sem pagar quem fecha a página do Asaas e clica de novo). Se os dois forem pagos,
  // a regra da compra repetida (enforceSinglePaid) deixa uma assinatura só, para a outra no
  // Asaas (sem renovação: nada de segundo mês com desconto) e manda o estorno pro admin; e a
  // conta perde o direito à oferta. (A oferta marcada como usada uma vez só é do webhook, T13.)
  it('duas abas: dois checkouts com oferta abrem; pagos os dois, fica um e o outro não ganha um segundo mês com desconto', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    post
      .mockResolvedValueOnce({ data: { id: 'chk_a', link: 'https://asaas.test/c/chk_a' } })
      .mockResolvedValueOnce({ data: { id: 'chk_b', link: 'https://asaas.test/c/chk_b' } })
    expect((await create('essencial_mensal', { offer: true })).statusCode).toBe(200)
    vi.setSystemTime(new Date('2026-11-19T15:00:30.000Z'))
    expect((await create('essencial_mensal', { offer: true })).statusCode).toBe(200)
    expect(post.mock.calls.map((c) => c[1].items[0].value)).toEqual([24.9, 24.9])
    expect(db.tables.pending_checkouts.map((r) => [r.id, r.offer_value])).toEqual([['chk_a', 24.9], ['chk_b', 24.9]])

    // os dois pagos, a da aba A primeiro (12:10 e 12:12 de Brasília)
    const charges = (x: string) => [payment({ id: `pay_${x}1`, subscription: `sub_${x}`, checkoutSession: `chk_${x}`, value: 24.9, dueDate: '2026-11-19', originalDueDate: '2026-11-19', confirmedDate: '2026-11-19', status: 'CONFIRMED' })]
    const asaas = createFakeAsaas({
      get: (path, params) => {
        const q = (params ?? {}) as Record<string, unknown>
        const sub = /^\/subscriptions\/sub_([ab])$/.exec(path)
        if (sub) return { id: `sub_${sub[1]}`, checkoutSession: `chk_${sub[1]}`, status: 'ACTIVE', value: 24.9 }
        if (path === '/payments' && typeof q.checkoutSession === 'string') return { data: charges(String(q.checkoutSession).slice(-1)) }
        if (path === '/payments' && typeof q.subscription === 'string') return { data: charges(String(q.subscription).slice(-1)), hasMore: false }
        return { data: [], hasMore: false }
      },
    })
    vi.setSystemTime(new Date('2026-11-19T15:30:00.000Z'))
    const deps = { db: db as never, asaas }
    for (const x of ['a', 'b']) {
      const minute = x === 'a' ? '10' : '12'
      await handleAsaasEvent(deps, { event: 'CHECKOUT_PAID', dateCreated: `2026-11-19 12:${minute}:00`, checkout: { id: `chk_${x}`, customer: 'cus_1' } })
      await handleAsaasEvent(deps, { event: 'PAYMENT_CONFIRMED', dateCreated: `2026-11-19 12:${minute}:01`, payment: charges(x)[0] })
    }

    const subs = db.tables.billing_subscriptions.filter((r) => r.kind === 'asaas')
    expect(subs.filter((r) => r.status === 'active').map((r) => r.id)).toEqual(['chk_a'])
    const other = subs.find((r) => r.id === 'chk_b')!
    expect(other).toMatchObject({ status: 'canceled', cancel_source: 'duplicate', needs_admin_review: true })
    expect(String(other.admin_note)).toContain('compra duplicada: estornar a mao (ficou a chk_a)')
    // a renovação da aba B para no Asaas (já parada ou com a pendência de parar aberta)
    const stopB = other.asaas_stopped_at != null
      || db.tables.billing_pending_actions.some((a) => a.subscription_ref === 'chk_b' && a.action === 'inactivate_subscription' && a.status === 'pending')
    expect(stopB).toBe(true)
    // e a conta não tem mais direito: um terceiro checkout com oferta (agora do Studio, pra não
    // cair no "já tem este plano") é recusado
    post.mockClear()
    const third = await create('pro_mensal', { offer: true })
    expect(third.statusCode).toBe(409)
    expect(third.body).toEqual({ error: FIRST_ONLY, offerEnded: true })
    expect(post).not.toHaveBeenCalled()
  })

  // Limites do Asaas pra itens do checkout (POST /v3/checkouts, CheckoutSessionItemsDTO):
  // name até 30 caracteres e description até 150. Vale pra todo item que o checkout manda.
  it('todo item que o checkout pode mandar cabe no limite do Asaas (nome até 30, descrição até 150)', async () => {
    const cases: [string, Record<string, unknown>][] = [
      ['essencial_mensal', {}], ['essencial_anual', {}], ['pro_mensal', {}], ['pro_anual', {}],
      ['essencial_mensal', { offer: true }], ['pro_mensal', { offer: true }],
    ]
    const sent: { name: string; description: string }[] = []
    for (const [planKey, extra] of cases) {
      post.mockClear()
      db.tables.pending_checkouts = []
      const res = await create(planKey, extra)
      expect(res.statusCode, `${planKey} ${JSON.stringify(extra)}`).toBe(200)
      sent.push(item())
    }
    expect(sent.map((i) => i.name)).toEqual(['Pro Mensal', 'Pro Anual', 'Studio Mensal', 'Studio Anual', 'Pro Mensal (1º mês)', 'Studio Mensal (1º mês)'])
    for (const i of sent) {
      expect(i.name.length, i.name).toBeLessThanOrEqual(30)
      expect(i.description.length, i.description).toBeLessThanOrEqual(150)
      expect(JSON.stringify(i)).not.toContain(TRAVESSAO)
    }
  })

  it('quem já tem o mesmo plano ativo continua recebendo o 409 de hoje, sem ler a oferta', async () => {
    db.tables.billing_subscriptions.push(subRow({ id: 'chk_1', user_id: USER_A, plan_key: 'essencial_mensal' }))
    const res = await create('essencial_mensal', { offer: true })
    expect(res.statusCode).toBe(409)
    expect((res.body as { error: string }).error).toContain('Você já tem o Pro Mensal ativo')
    expect(post).not.toHaveBeenCalled()
    expect(db.rpcCalls).toEqual([])
  })
})

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRes, type FakeDb } from './fakeSupabase.js'
import { USER_A, createBillingDb, subRow } from './billingHarness.js'

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
    expect(item().value).toBe(24.9)
    expect(item().name).toBe('Playback Studio Pro (mensal)')
    expect(post.mock.calls[0][1].subscription).toEqual({ cycle: 'MONTHLY', nextDueDate: '2026-11-19' })
    expect(db.tables.pending_checkouts[0]).toMatchObject({ id: 'chk_9', user_id: USER_A, plan_key: 'essencial_mensal', offer_value: 24.9, offer_month: '2026-11' })
    // só lê a janela (com a hora do servidor), nunca abre
    expect(db.rpcCalls).toEqual([{ name: 'offer_current', args: { p_user_id: USER_A, p_now: OFFER_NOW } }])
  })

  it('oferta no Studio Mensal: 59.9', async () => {
    const res = await create('pro_mensal', { offer: true })
    expect(res.statusCode).toBe(200)
    expect(item().value).toBe(59.9)
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

  it('active com o relógio já vencido ou sem o mês: 409, nunca cobra', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    for (const answer of [
      { status: 'active', expiresAt: '2026-11-19T14:59:59.000Z', month: '2026-11' },
      { status: 'active', expiresAt: OFFER_NOW, month: '2026-11' },
      { status: 'active', expiresAt: '2026-11-21T15:00:00.000Z', month: null },
      { status: 'active', expiresAt: 'amanhã', month: '2026-11' },
    ]) {
      db.setRpc('offer_current', () => answer)
      const res = await create('essencial_mensal', { offer: true })
      expect(res.statusCode, JSON.stringify(answer)).toBe(409)
      expect((res.body as { offerEnded: boolean }).offerEnded).toBe(true)
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

  it('registro da oferta fora do ar (SQL ainda não rodou ou erro do banco): 409 com offerEnded, nunca o preço cheio', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    db.setRpc('offer_current', () => { throw new Error('function public.offer_current does not exist') })
    const res = await create('essencial_mensal', { offer: true })
    expect(res.statusCode).toBe(409)
    expect(res.body).toEqual({ error: ENDED, offerEnded: true })
    expect(JSON.stringify(res.body)).not.toContain('does not exist')
    expect(post).not.toHaveBeenCalled()
    expect(db.tables.pending_checkouts).toEqual([])
    expect(warn).toHaveBeenCalled()
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
      expect(item().value).toBe(49.9)
      const row = db.tables.pending_checkouts[0]
      expect(Object.keys(row)).not.toContain('offer_month')
      expect(Object.keys(row)).not.toContain('offer_value')
    }
    expect(db.rpcCalls).toEqual([])
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

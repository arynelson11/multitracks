import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRes, type FakeDb, type FakeRes, type Row } from './fakeSupabase.js'
import { USER_A, USER_B, USER_C, asaasDown, asaasRejected, createBillingDb, createFakeAsaas, payment, subRow, type FakeAsaas } from './billingHarness.js'
import { AsaasError } from '../_lib/asaas.js'
import { cancelSubscriptionForUser, changePlan, grantCourtesy } from '../_lib/billing.js'
import { createAdminRouter, type AdminCtx } from '../_lib/admin/http.js'
import { UncertainAdminError, courtesyUntil, handlers, writeMayHaveLanded } from '../_lib/admin/subscriberActions.js'

// Servidor das ações do admin sobre um assinante (Task 16): mudar plano,
// cortesia, cancelar, bloquear e ajustar cota. O Asaas vem primeiro e o banco
// depois (ordem da Fase 3); falha no meio vira marcação em Pendências e repetir
// termina. As funções SQL da T21 (bloqueio e cota) entram pelo contrato, com
// setRpc; o registro (T5) por um modelo de admin_log_start e admin_log_finish.
// Asaas só por mock.

const ADMIN_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const USER_D = '44444444-4444-4444-8444-444444444444' // conta admin
const NOBODY = '55555555-5555-4555-8555-555555555555' // conta que não existe
const NOW = new Date('2026-11-16T15:00:00Z') // 12:00 em Brasília, dia 16/11/2026
const TRAVESSAO = String.fromCharCode(0x2014)
const PERIOD = '2026-11-01T03:00:00+00:00' // começo do mês de novembro em Brasília
const OLD_PERIOD = '2026-10-01T03:00:00+00:00'

const MSG = {
  noPaid: 'Esta conta não tem assinatura paga ativa. Para dar um plano sem cobrança, use Dar cortesia.',
  planNotChanged: 'O Asaas não trocou o plano. Nada mudou.',
  planSubNotFound: 'O Asaas não achou esta assinatura. Nada mudou.',
  noAsaasKey: 'O servidor está sem a chave do Asaas.',
  planHalf: 'O Asaas trocou o plano, mas o app não. A ficha ficou marcada em Pendências; use Mudar plano de novo para terminar.',
  planHalfUnmarked: 'O Asaas pode ter trocado o plano, mas o app não, e não deu pra marcar a ficha em Pendências. Use Mudar plano de novo para terminar.',
  cancelDown: 'O Asaas não respondeu. Nada foi cancelado.',
  cancelNone: 'Esta conta não tem assinatura ativa.',
  courtesyNotOurs: 'Esta cortesia não é desta conta.',
  daysRange: 'A duração da cortesia precisa ser um número de 1 a 365.',
  daysMissing: 'Escolha por quantos dias vale a cortesia, ou Sem data.',
  adminNotBlockable: 'Não dá pra bloquear uma conta admin.',
  alreadyBlocked: 'Esta conta já está bloqueada.',
  notBlocked: 'Esta conta não está bloqueada.',
  accountNotFound: 'Conta não encontrada.',
  quotaMax: 'A cota extra deste mês já está no máximo (1000).',
  amountRange: 'A quantidade precisa ser um número de 1 a 500.',
  resetNoAmount: 'Zerar não leva quantidade.',
  quotaUnconfirmed: 'Não deu pra confirmar o ajuste da cota. Confira no Registro antes de tentar de novo.',
  badAccount: 'A conta está em formato inválido.',
  unexpected: 'Erro inesperado no servidor.',
}
// Ruling ADM-T16-incerto: escrita no Asaas sem resposta que dê certeza.
const MSG_UNCERTAIN = 'O Asaas não respondeu a tempo. A mudança pode ter sido feita. A ficha foi marcada pra conferir; confira em Pendências antes de repetir.'
const NOTE_UNCERTAIN_PLAN = 'O Asaas não respondeu a tempo ao pedido de troca de plano para Studio Mensal em 16/11/2026 às 12:00; conferir se foi feito'
const NOTE_UNCERTAIN_CANCEL = 'O Asaas não respondeu a tempo ao pedido de cancelamento da assinatura (agora) em 16/11/2026 às 12:00; conferir se foi feito'
// O pedido saiu e a resposta não voltou (o axios chama o timeout de ECONNABORTED).
const asaasTimeout = () => new AsaasError('unavailable', 'Asaas sem resposta (ECONNABORTED)')
// A conexão nem abriu: o pedido não saiu.
const asaasRefused = () => new AsaasError('unavailable', 'Asaas sem resposta (ECONNREFUSED)')
const NOTE_PLAN = 'troca de plano pelo admin: o Asaas pode ter trocado para pro_mensal e o banco nao; usar Mudar plano de novo'
const NOTE_CANCEL = 'cancelamento pelo admin pela metade: o Asaas pode ter parado a cobranca e o app nao; usar Cancelar assinatura de novo'
const PUT_STUDIO = { value: 119.9, cycle: 'MONTHLY', description: 'Playback Studio Studio (mensal)', updatePendingPayments: true }

type LogEntry = { id: number; start: Record<string, unknown>; finish: Record<string, unknown> | null }

let db: FakeDb
let asaas: FakeAsaas | null
let fakes: FakeAsaas[]
let responses: FakeRes[]
let logs: LogEntry[]

vi.mock('../_lib/auth.js', () => ({
  verifyAdmin: vi.fn(async () => ({ ok: true, userId: ADMIN_ID, email: 'admin@igreja.com', isAdmin: true, blocked: false })),
}))
vi.mock('@supabase/supabase-js', () => ({ createClient: vi.fn(() => db) }))
vi.mock('../_lib/asaas.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('../_lib/asaas.js')>()
  return { ...real, asaasFromEnv: vi.fn(() => asaas) }
})
vi.mock('../_lib/billing.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('../_lib/billing.js')>()
  return {
    ...real,
    changePlan: vi.fn(real.changePlan),
    grantCourtesy: vi.fn(real.grantCourtesy),
    cancelSubscriptionForUser: vi.fn(real.cancelSubscriptionForUser),
  }
})

const router = createAdminRouter(handlers)

function setAsaas(routes: Parameters<typeof createFakeAsaas>[0] = {}): FakeAsaas {
  const fake = createFakeAsaas(routes)
  fakes.push(fake)
  asaas = fake
  return fake
}

async function post(action: string, body: unknown): Promise<FakeRes> {
  const res = createRes()
  await router({ method: 'POST', query: { action }, headers: { authorization: 'Bearer admin' }, body }, res)
  responses.push(res)
  return res
}

// Cobranças do Asaas por assinatura (GET /payments?subscription=...).
function paymentsBySub(map: Record<string, Record<string, unknown>[]>) {
  return (path: string, params?: unknown) => {
    const id = (params as { subscription?: string } | undefined)?.subscription
    if (path === '/payments' && id) return { data: map[id] ?? [], hasMore: false }
    return { data: [], hasMore: false }
  }
}
// A: assinou em 16/10 e renovou em 16/11 (paga até o fim do dia 16/12).
const PAYMENTS_A = paymentsBySub({
  sub_a: [
    payment({ id: 'pay_a1', subscription: 'sub_a', dueDate: '2026-10-16', confirmedDate: '2026-10-16', status: 'RECEIVED' }),
    payment({ id: 'pay_a2', subscription: 'sub_a', dueDate: '2026-11-16', confirmedDate: '2026-11-16', status: 'CONFIRMED' }),
  ],
})

function quotaProfile(over: Row & { id: string }): Row {
  return { plan: 'free', plan_expires_at: null, is_admin: false, blocked_at: null, blocked_reason: null, blocked_by: null,
    tokens_used: 0, tokens_period_start: PERIOD, quota_bonus: 0, quota_bonus_period: null, ...over }
}

// Modelo das funções SQL que a T16 chama e não são da Fase 3: o registro (T5)
// e o bloqueio e a cota (contrato da T21, que grava o registro na mesma transação).
function installAdminSql(target: FakeDb): void {
  target.setRpc('admin_log_start', (a) => {
    const id = 41 + logs.length
    logs.push({ id, start: a, finish: null })
    return id
  })
  target.setRpc('admin_log_finish', (a) => {
    const entry = logs.find((x) => x.id === a.p_id)
    if (entry) entry.finish = a
    return null
  })
  target.setRpc('admin_set_block', (a) => {
    if (a.p_admin !== ADMIN_ID) throw new Error('só admin faz ação de admin')
    const p = target.tables.profiles.find((x) => x.id === a.p_user)
    if (!p) return 'not_found'
    if (a.p_block && p.is_admin) return 'is_admin'
    if (!!p.blocked_at === !!a.p_block) return 'already'
    if (a.p_block) Object.assign(p, { blocked_at: NOW.toISOString(), blocked_reason: a.p_reason, blocked_by: a.p_admin })
    else Object.assign(p, { blocked_at: null, blocked_reason: null, blocked_by: null })
    return a.p_block ? 'blocked' : 'unblocked'
  })
  target.setRpc('admin_adjust_quota', (a) => {
    if (a.p_admin !== ADMIN_ID) throw new Error('só admin faz ação de admin')
    const p = target.tables.profiles.find((x) => x.id === a.p_user)
    if (!p) return { result: 'not_found', used: null, bonus: null, periodStart: null }
    const used = () => (p.tokens_period_start === PERIOD ? Number(p.tokens_used) : 0)
    const bonus = () => (p.quota_bonus_period === PERIOD ? Number(p.quota_bonus) : 0)
    if (a.p_mode === 'reset') {
      Object.assign(p, { tokens_used: 0, tokens_period_start: PERIOD })
    } else {
      if (bonus() + Number(a.p_amount) > 1000) return { result: 'over_limit', used: used(), bonus: bonus(), periodStart: PERIOD }
      Object.assign(p, { quota_bonus: bonus() + Number(a.p_amount), quota_bonus_period: PERIOD })
    }
    return { result: 'ok', used: used(), bonus: bonus(), periodStart: PERIOD }
  })
}

const rpcNames = () => db.rpcCalls.map((c) => c.name)
const rpcArgs = (name: string) => db.rpcCalls.filter((c) => c.name === name).map((c) => c.args)
const sub = (id: string) => db.tables.billing_subscriptions.find((r) => r.id === id)!
const profile = (id: string) => db.tables.profiles.find((p) => p.id === id)!
const asaasCalls = (fake: FakeAsaas | null = asaas) => (fake ? [...fake.get.mock.calls, ...fake.post.mock.calls, ...fake.put.mock.calls, ...fake.del.mock.calls] : [])
const snapshot = () => structuredClone({
  subs: db.tables.billing_subscriptions, profiles: db.tables.profiles, actions: db.tables.billing_pending_actions,
})

beforeEach(() => {
  vi.useFakeTimers({ now: NOW, toFake: ['Date'] })
  vi.stubEnv('VITE_SUPABASE_URL', 'https://fake.supabase.co')
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'fake-service-role')
  vi.clearAllMocks()
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  fakes = []
  responses = []
  logs = []
  db = createBillingDb({
    profiles: [
      quotaProfile({ id: USER_A, plan: 'essencial_mensal', tokens_used: 4 }),
      quotaProfile({ id: USER_B }),
      quotaProfile({ id: USER_C, plan: 'essencial_mensal', plan_expires_at: '2026-12-02T03:00:00.000Z' }),
      quotaProfile({ id: USER_D, is_admin: true }),
    ],
    billing_subscriptions: [
      // A: Pro Mensal pago e ativo
      subRow({ id: 'chk_a', user_id: USER_A, asaas_subscription_id: 'sub_a', last_paid_due_date: '2026-11-16',
        paid_until: '2026-12-17T03:00:00.000Z', next_due_date: '2026-12-16' }),
      // C: Pro Mensal pago e cancelado, com acesso até o fim do dia 01/12/2026
      subRow({ id: 'chk_c', user_id: USER_C, asaas_subscription_id: 'sub_c', status: 'canceled', cancel_source: 'user',
        access_until: '2026-12-02T03:00:00.000Z', paid_until: '2026-12-02T03:00:00.000Z',
        asaas_stopped_at: '2026-11-10T12:00:00.000Z', asaas_stop_kind: 'deleted' }),
    ],
  })
  installAdminSql(db)
  setAsaas({ get: PAYMENTS_A })
})

afterEach(() => {
  // Nenhuma ação estorna: nenhum caminho do Asaas com /refund, em nenhum teste.
  for (const fake of fakes) {
    for (const [path] of asaasCalls(fake) as [string][]) expect(String(path)).not.toMatch(/refund/i)
  }
  for (const res of responses) expect(JSON.stringify(res.body ?? null).includes(TRAVESSAO)).toBe(false)
  expect(JSON.stringify(logs).includes(TRAVESSAO)).toBe(false)
  vi.useRealTimers()
  vi.unstubAllEnvs()
})

describe('mudar plano', () => {
  it('mudar plano grava antes e depois no registro', async () => {
    const order: string[] = []
    const fake = setAsaas({ put: (path) => { order.push(`asaas PUT ${path}`); return {} } })
    const real = db.setRpc('billing_change_plan', (a) => { order.push('banco billing_change_plan'); return real!(a) })
    const res = await post('change-plan', { userId: USER_A, planKey: 'pro_mensal' })
    expect(res.statusCode).toBe(200)
    expect(res.body).toEqual({ result: 'changed', planKey: 'pro_mensal' })
    // Asaas primeiro, banco depois
    expect(order).toEqual(['asaas PUT /subscriptions/sub_a', 'banco billing_change_plan'])
    expect(fake.put).toHaveBeenCalledWith('/subscriptions/sub_a', PUT_STUDIO)
    expect(logs).toEqual([{
      id: 41,
      start: { p_admin: ADMIN_ID, p_action: 'change_plan', p_target_user: USER_A, p_target_ref: 'chk_a',
        p_before: { planKey: 'essencial_mensal', value: 49.9, cycle: 'MONTHLY' }, p_note: null },
      finish: { p_id: 41, p_result: 'ok', p_after: { result: 'changed', planKey: 'pro_mensal', value: 119.9, cycle: 'MONTHLY' }, p_message: null },
    }])
    expect(sub('chk_a')).toMatchObject({ plan_key: 'pro_mensal', needs_admin_review: false })
    expect(profile(USER_A).plan).toBe('pro_mensal')
    expect(rpcNames()).not.toContain('billing_flag_review')
  })

  it('troca: o Asaas trocou e o banco falhou, a ficha fica marcada e a nova tentativa conclui', async () => {
    const fake = setAsaas()
    const real = db.setRpc('billing_change_plan', () => ({ result: 'not_active' }))!
    const first = await post('change-plan', { userId: USER_A, planKey: 'pro_mensal' })
    expect(first.statusCode).toBe(500)
    expect(first.body).toEqual({ error: MSG.planHalf })
    expect(sub('chk_a')).toMatchObject({ plan_key: 'essencial_mensal', needs_admin_review: true, admin_note: NOTE_PLAN })
    expect(profile(USER_A).plan).toBe('essencial_mensal')

    db.setRpc('billing_change_plan', real)
    const second = await post('change-plan', { userId: USER_A, planKey: 'pro_mensal' })
    expect(second.statusCode).toBe(200)
    expect(second.body).toEqual({ result: 'changed', planKey: 'pro_mensal' })
    expect(profile(USER_A).plan).toBe('pro_mensal')
    expect(rpcArgs('billing_flag_review')).toEqual([{ p_id: 'chk_a', p_note: NOTE_PLAN }])
    // o PUT é o mesmo nas duas: repetir só termina o que faltou
    expect(fake.put).toHaveBeenCalledTimes(2)
    expect(fake.put.mock.calls[0]).toEqual(['/subscriptions/sub_a', PUT_STUDIO])
    expect(fake.put.mock.calls[1]).toEqual(fake.put.mock.calls[0])
    expect(logs.map((l) => l.finish?.p_result)).toEqual(['partial', 'ok'])
  })

  it('mudar plano de conta no Livre responde 404 com a dica da cortesia', async () => {
    // B no Livre e C só com a paga cancelada: nenhuma das duas tem paga ativa
    for (const userId of [USER_B, USER_C]) {
      const res = await post('change-plan', { userId, planKey: 'pro_mensal' })
      expect(res.statusCode).toBe(404)
      expect(res.body).toEqual({ error: MSG.noPaid })
    }
    expect(changePlan).not.toHaveBeenCalled()
    expect(asaasCalls()).toEqual([])
    expect(logs).toEqual([])
    expect(rpcNames()).toEqual([])
  })

  it('Asaas fora: 502 e o banco não muda', async () => {
    // Asaas fora com certeza de nada feito: a conexão foi recusada (o timeout é incerto, abaixo)
    setAsaas({ put: () => { throw asaasRefused() } })
    const before = snapshot()
    const res = await post('change-plan', { userId: USER_A, planKey: 'pro_mensal' })
    expect(res.statusCode).toBe(502)
    expect(res.body).toEqual({ error: MSG.planNotChanged })
    expect(snapshot()).toEqual(before)
    expect(rpcNames()).not.toContain('billing_change_plan')
    expect(rpcNames()).not.toContain('billing_flag_review')
    expect(logs[0].finish).toMatchObject({ p_result: 'failed', p_message: 'O Asaas não respondeu. Status do Asaas: sem dado.' })
  })

  it('recusa do Asaas: 502 com o status do Asaas e sem o texto dele', async () => {
    setAsaas({ put: () => { throw asaasRejected('O cartão final 4242 não aceita este valor.') } })
    const before = snapshot()
    const res = await post('change-plan', { userId: USER_A, planKey: 'pro_mensal' })
    expect(res.statusCode).toBe(502)
    expect(res.body).toEqual({ error: `${MSG.planNotChanged} Status do Asaas: 400.` })
    expect(snapshot()).toEqual(before)
    expect(logs[0].finish).toMatchObject({ p_result: 'failed', p_message: 'O Asaas recusou o pedido. Status do Asaas: 400.' })
    expect(JSON.stringify([res.body, logs])).not.toContain('4242')
  })

  it('erro de banco depois do PUT no Asaas também marca a ficha', async () => {
    const fake = setAsaas()
    db.setRpc('billing_change_plan', () => { throw new Error('deadlock detected') })
    const res = await post('change-plan', { userId: USER_A, planKey: 'pro_mensal' })
    expect(fake.put).toHaveBeenCalledTimes(1)
    expect(res.statusCode).toBe(500)
    expect(res.body).toEqual({ error: MSG.planHalf })
    expect(rpcArgs('billing_flag_review')).toEqual([{ p_id: 'chk_a', p_note: NOTE_PLAN }])
    expect(sub('chk_a')).toMatchObject({ plan_key: 'essencial_mensal', needs_admin_review: true })
    expect(logs[0].finish).toMatchObject({ p_result: 'partial', p_message: MSG.planHalf })
    expect(JSON.stringify([res.body, logs])).not.toContain('deadlock')
    // o detalhe cru vai pro log do servidor
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).toContain('deadlock')
  })

  it('troca pela metade fica partial no registro', async () => {
    db.setRpc('billing_change_plan', () => ({ result: 'not_active' }))
    await post('change-plan', { userId: USER_A, planKey: 'pro_mensal' })
    expect(logs).toHaveLength(1)
    expect(logs[0].finish).toEqual({ p_id: 41, p_result: 'partial', p_after: null, p_message: MSG.planHalf })
    expect(JSON.stringify(logs)).not.toContain('not_active')
  })

  it('assinatura não achada no Asaas responde 502 sem a dica da cortesia', async () => {
    // sem o id da assinatura e sem cobrança do checkout no Asaas
    sub('chk_a').asaas_subscription_id = null
    const fake = setAsaas()
    const res = await post('change-plan', { userId: USER_A, planKey: 'pro_mensal' })
    expect(res.statusCode).toBe(502)
    expect(res.body).toEqual({ error: MSG.planSubNotFound })
    expect(fake.put).not.toHaveBeenCalled()
    // o PUT que volta 404 também
    sub('chk_a').asaas_subscription_id = 'sub_a'
    setAsaas({ put: () => { throw new AsaasError('not_found', 'não encontrado no Asaas', 404) } })
    const again = await post('change-plan', { userId: USER_A, planKey: 'pro_mensal' })
    expect(again.statusCode).toBe(502)
    expect(again.body).toEqual({ error: MSG.planSubNotFound })
    for (const r of [res, again]) expect(JSON.stringify(r.body)).not.toContain('cortesia')
    expect(rpcNames()).not.toContain('billing_flag_review')
    expect(sub('chk_a')).toMatchObject({ plan_key: 'essencial_mensal', needs_admin_review: false })
  })

  it('pedir o plano que a conta já tem responde unchanged sem falar com o Asaas', async () => {
    const fake = setAsaas()
    const res = await post('change-plan', { userId: USER_A, planKey: 'essencial_mensal' })
    expect(res.statusCode).toBe(200)
    expect(res.body).toEqual({ result: 'unchanged', planKey: 'essencial_mensal' })
    expect(asaasCalls(fake)).toEqual([])
    expect(rpcNames()).not.toContain('billing_change_plan')
  })

  it('marcação que falha também avisa, na resposta e no registro', async () => {
    db.setRpc('billing_change_plan', () => ({ result: 'not_active' }))
    db.setRpc('billing_flag_review', () => { throw new Error('connection reset') })
    const res = await post('change-plan', { userId: USER_A, planKey: 'pro_mensal' })
    expect(res.statusCode).toBe(500)
    expect(res.body).toEqual({ error: MSG.planHalfUnmarked })
    expect(logs[0].finish).toMatchObject({ p_result: 'partial', p_message: MSG.planHalfUnmarked })
  })

  it('servidor sem a chave do Asaas responde 500 e não marca nada', async () => {
    asaas = null
    const res = await post('change-plan', { userId: USER_A, planKey: 'pro_mensal' })
    expect(res.statusCode).toBe(500)
    expect(res.body).toEqual({ error: MSG.noAsaasKey })
    expect(rpcNames()).not.toContain('billing_flag_review')
    expect(sub('chk_a').plan_key).toBe('essencial_mensal')
  })

  it('plano fora da tabela responde 400', async () => {
    for (const planKey of ['free', 'studio', 'constructor', 42]) {
      const res = await post('change-plan', { userId: USER_A, planKey })
      expect(res.statusCode).toBe(400)
      expect(res.body).toEqual({ error: 'O plano está em formato inválido.' })
    }
    expect(rpcNames()).toEqual([])
  })
})

describe('cortesia', () => {
  it('cortesia repetida do mesmo plano responde 409', async () => {
    db.tables.billing_subscriptions.push(
      subRow({ id: 'cortesia:velha', kind: 'courtesy', user_id: USER_B, plan_key: 'pro_anual', cycle: null }),
      // cortesia que já acabou não conta
      subRow({ id: 'cortesia:acabou', kind: 'courtesy', user_id: USER_B, plan_key: 'essencial_anual', cycle: null, access_until: '2026-11-10T03:00:00.000Z' }),
    )
    const res = await post('grant-courtesy', { userId: USER_B, planKey: 'pro_anual', days: 30 })
    expect(res.statusCode).toBe(409)
    expect(res.body).toEqual({ error: 'Esta conta já tem uma cortesia de Studio Anual ativa.' })
    expect(grantCourtesy).not.toHaveBeenCalled()
    expect(logs).toEqual([])
    // outro plano, ou o mesmo de uma cortesia que já acabou, passa
    for (const planKey of ['pro_mensal', 'essencial_anual']) {
      const ok = await post('grant-courtesy', { userId: USER_B, planKey, days: 30 })
      expect(ok.statusCode, planKey).toBe(200)
    }
  })

  it('cortesia menor, ou que acaba antes do fim da paga cancelada, responde 409', async () => {
    const proPaid = 'Esta conta ainda tem o Pro Mensal pago até 01/12/2026. Dê uma cortesia de plano maior que vá além dessa data.'
    for (const body of [
      { userId: USER_C, planKey: 'essencial_anual', days: null }, // mesmo nível do pago
      { userId: USER_C, planKey: 'pro_mensal', days: 7 },          // maior, mas acaba em 23/11
      { userId: USER_C, planKey: 'pro_mensal', days: 15 },         // maior, mas acaba junto (fim do dia 01/12)
    ]) {
      const res = await post('grant-courtesy', body)
      expect(res.statusCode, JSON.stringify(body)).toBe(409)
      expect(res.body).toEqual({ error: proPaid })
    }
    // paga cancelada de Studio e cortesia de Pro: menor
    sub('chk_c').plan_key = 'pro_mensal'
    const lower = await post('grant-courtesy', { userId: USER_C, planKey: 'essencial_mensal', days: null })
    expect(lower.statusCode).toBe(409)
    expect(lower.body).toEqual({ error: 'Esta conta ainda tem o Studio Mensal pago até 01/12/2026. Dê uma cortesia de plano maior que vá além dessa data.' })
    expect(grantCourtesy).not.toHaveBeenCalled()
    expect(rpcNames()).toEqual([])
  })

  it('cortesia maior sem data sobre paga cancelada passa', async () => {
    const res = await post('grant-courtesy', { userId: USER_C, planKey: 'pro_mensal', days: null, note: '  parceria com a igreja  ' })
    expect(res.statusCode).toBe(200)
    expect(res.body).toEqual({ courtesyId: 'cortesia:3', until: null })
    expect(profile(USER_C).plan).toBe('pro_mensal')
    expect(rpcArgs('billing_grant_courtesy')).toEqual([{ p_user_id: USER_C, p_plan_key: 'pro_mensal', p_until: null, p_note: 'parceria com a igreja' }])
    expect(logs).toEqual([{
      id: 41,
      start: { p_admin: ADMIN_ID, p_action: 'grant_courtesy', p_target_user: USER_C, p_target_ref: null, p_note: 'parceria com a igreja',
        p_before: { subscriptions: [{ id: 'chk_c', kind: 'asaas', planKey: 'essencial_mensal', status: 'canceled', accessUntil: '2026-12-02T03:00:00.000Z' }] } },
      finish: { p_id: 41, p_result: 'ok', p_after: { courtesyId: 'cortesia:3', planKey: 'pro_mensal', until: null }, p_message: null },
    }])
    // com data depois do fim da paga também passa
    const later = await post('grant-courtesy', { userId: USER_C, planKey: 'pro_anual', days: 30 })
    expect(later.statusCode).toBe(200)
    expect(later.body).toEqual({ courtesyId: 'cortesia:4', until: '2026-12-17T03:00:00.000Z' })
  })

  it('cortesia de 30 dias pedida às 22:00 de Brasília vale até o fim do dia 16/12', async () => {
    const at = new Date('2026-11-17T01:00:00Z') // 22:00 de 16/11 em Brasília (já é 17/11 em UTC)
    expect(courtesyUntil(at, 30)).toBe('2026-12-17T03:00:00.000Z')
    vi.setSystemTime(at)
    const res = await post('grant-courtesy', { userId: USER_B, planKey: 'pro_mensal', days: 30 })
    expect(res.statusCode).toBe(200)
    expect(res.body).toEqual({ courtesyId: 'cortesia:3', until: '2026-12-17T03:00:00.000Z' })
    expect(rpcArgs('billing_grant_courtesy')[0]).toMatchObject({ p_until: '2026-12-17T03:00:00.000Z' })
    expect(sub('cortesia:3').access_until).toBe('2026-12-17T03:00:00.000Z')
  })

  it('0 e 366 dias respondem 400', async () => {
    for (const days of [0, 366, -1, 2.5, '30 dias', '']) {
      const res = await post('grant-courtesy', { userId: USER_B, planKey: 'pro_mensal', days })
      expect(res.statusCode, String(days)).toBe(400)
      expect(res.body).toEqual({ error: MSG.daysRange })
    }
    // sem o campo: não vira cortesia sem data por engano
    const missing = await post('grant-courtesy', { userId: USER_B, planKey: 'pro_mensal' })
    expect(missing.statusCode).toBe(400)
    expect(missing.body).toEqual({ error: MSG.daysMissing })
    expect(rpcNames()).toEqual([])
  })

  it('sem data grava until nulo', async () => {
    const res = await post('grant-courtesy', { userId: USER_B, planKey: 'pro_anual', days: null })
    expect(res.statusCode).toBe(200)
    expect(res.body).toEqual({ courtesyId: 'cortesia:3', until: null })
    expect(grantCourtesy).toHaveBeenCalledWith(expect.anything(), { userId: USER_B, planKey: 'pro_anual', until: null, note: null })
    expect(sub('cortesia:3')).toMatchObject({ kind: 'courtesy', plan_key: 'pro_anual', access_until: null })
  })

  it('a cortesia com data vai pra Fase 3 como Date', async () => {
    await post('grant-courtesy', { userId: USER_B, planKey: 'pro_mensal', days: 1 })
    const input = vi.mocked(grantCourtesy).mock.calls[0][1]
    expect(input.until).toBeInstanceOf(Date)
    expect(input.until?.toISOString()).toBe('2026-11-18T03:00:00.000Z')
  })

  it('nota com mais de 300 caracteres responde 400', async () => {
    const res = await post('grant-courtesy', { userId: USER_B, planKey: 'pro_mensal', days: 7, note: 'x'.repeat(301) })
    expect(res.statusCode).toBe(400)
    expect(res.body).toEqual({ error: 'A nota pode ter no máximo 300 caracteres.' })
  })

  it('encerrar cortesia de outra conta responde 400', async () => {
    db.tables.billing_subscriptions.push(subRow({ id: 'cortesia:b', kind: 'courtesy', user_id: USER_B, plan_key: 'pro_anual', cycle: null }))
    for (const courtesyId of ['cortesia:b', 'chk_a', 'cortesia:nao-existe']) {
      const res = await post('end-courtesy', { userId: USER_A, courtesyId })
      expect(res.statusCode, courtesyId).toBe(400)
      expect(res.body).toEqual({ error: MSG.courtesyNotOurs })
    }
    expect(rpcNames()).toEqual([])
    expect(sub('cortesia:b').status).toBe('active')
  })

  it('encerrar cortesia acaba agora e grava antes e depois no registro', async () => {
    db.tables.billing_subscriptions.push(subRow({ id: 'cortesia:b', kind: 'courtesy', user_id: USER_B, plan_key: 'pro_anual', cycle: null }))
    profile(USER_B).plan = 'pro_anual'
    const res = await post('end-courtesy', { userId: USER_B, courtesyId: 'cortesia:b' })
    expect(res.statusCode).toBe(200)
    expect(res.body).toEqual({ result: 'canceled' })
    expect(sub('cortesia:b')).toMatchObject({ status: 'canceled', access_until: NOW.toISOString() })
    expect(profile(USER_B).plan).toBe('free')
    expect(logs[0].start).toMatchObject({ p_action: 'end_courtesy', p_target_user: USER_B, p_target_ref: 'cortesia:b',
      p_before: { id: 'cortesia:b', kind: 'courtesy', planKey: 'pro_anual', status: 'active', accessUntil: null } })
    expect(logs[0].finish).toMatchObject({ p_result: 'ok', p_after: { result: 'canceled' } })
    expect(asaasCalls()).toEqual([])
  })
})

describe('cancelar assinatura', () => {
  it('cancelar agora chama o cancelamento com immediate verdadeiro e source admin', async () => {
    const res = await post('cancel-subscription', { userId: USER_A, when: 'now' })
    expect(cancelSubscriptionForUser).toHaveBeenCalledWith(expect.anything(), { userId: USER_A, source: 'admin', immediate: true })
    expect(res.statusCode).toBe(200)
    expect(res.body).toEqual({ result: 'canceled', accessUntil: NOW.toISOString(), pendingStop: false })
    expect(asaas!.del).toHaveBeenCalledWith('/subscriptions/sub_a')
    expect(sub('chk_a')).toMatchObject({ status: 'canceled', cancel_source: 'admin', access_until: NOW.toISOString() })
    expect(profile(USER_A).plan).toBe('free')
    expect(logs).toEqual([{
      id: 41,
      start: { p_admin: ADMIN_ID, p_action: 'cancel_subscription', p_target_user: USER_A, p_target_ref: 'chk_a', p_note: null,
        p_before: { when: 'now', subscriptions: [{ id: 'chk_a', kind: 'asaas', planKey: 'essencial_mensal', status: 'active', accessUntil: null }] } },
      finish: { p_id: 41, p_result: 'ok', p_after: { result: 'canceled', accessUntil: NOW.toISOString(), pendingStop: false }, p_message: null },
    }])
  })

  it('no fim do período com immediate falso', async () => {
    const res = await post('cancel-subscription', { userId: USER_A, when: 'period_end' })
    expect(cancelSubscriptionForUser).toHaveBeenCalledWith(expect.anything(), { userId: USER_A, source: 'admin', immediate: false })
    expect(res.statusCode).toBe(200)
    expect(res.body).toEqual({ result: 'canceled', accessUntil: '2026-12-17T03:00:00.000Z', pendingStop: false })
    expect(sub('chk_a')).toMatchObject({ status: 'canceled', cancel_source: 'admin', access_until: '2026-12-17T03:00:00.000Z' })
    expect(profile(USER_A).plan).toBe('essencial_mensal')
  })

  it('cancelar de novo devolve already_canceled sem chamar o Asaas', async () => {
    const first = await post('cancel-subscription', { userId: USER_A, when: 'period_end' })
    expect(first.statusCode).toBe(200)
    const callsAfterFirst = asaasCalls().length
    const before = snapshot()
    const second = await post('cancel-subscription', { userId: USER_A, when: 'period_end' })
    expect(second.statusCode).toBe(200)
    expect(second.body).toEqual({ result: 'already_canceled', accessUntil: '2026-12-17T03:00:00.000Z', pendingStop: false })
    expect(asaasCalls().length).toBe(callsAfterFirst)
    expect(snapshot()).toEqual(before)
  })

  it('cancelar com o Asaas fora: 502 e nada muda', async () => {
    const fake = setAsaas({ get: () => { throw asaasDown() } })
    const before = snapshot()
    const res = await post('cancel-subscription', { userId: USER_A, when: 'now' })
    expect(res.statusCode).toBe(502)
    expect(res.body).toEqual({ error: MSG.cancelDown })
    expect(snapshot()).toEqual(before)
    expect(fake.del).not.toHaveBeenCalled()
    expect(logs[0].finish).toMatchObject({ p_result: 'failed', p_message: 'O Asaas não respondeu. Status do Asaas: sem dado.' })
  })

  it('cancelar conta sem assinatura responde 404', async () => {
    const res = await post('cancel-subscription', { userId: USER_B, when: 'now' })
    expect(res.statusCode).toBe(404)
    expect(res.body).toEqual({ error: MSG.cancelNone })
    expect(asaasCalls()).toEqual([])
  })

  it('cancelamento pela metade marca a ficha, avisa e a nova tentativa termina', async () => {
    const real = db.setRpc('billing_end_subscription', () => { throw new Error('connection reset by peer') })!
    const res = await post('cancel-subscription', { userId: USER_A, when: 'period_end' })
    expect(asaas!.del).toHaveBeenCalledWith('/subscriptions/sub_a')
    expect(res.statusCode).toBe(500)
    expect(res.body).toEqual({ error: 'Parte do cancelamento foi feita: Sua assinatura foi cancelada no sistema de pagamento e nada mais será cobrado, mas não conseguimos atualizar sua conta aqui. Tente de novo para ver a data certinha. A ficha ficou marcada em Pendências.' })
    expect(rpcArgs('billing_flag_review')).toEqual([{ p_id: 'chk_a', p_note: NOTE_CANCEL }])
    expect(sub('chk_a')).toMatchObject({ status: 'active', needs_admin_review: true })
    expect(logs[0].finish).toMatchObject({ p_result: 'partial' })
    expect(JSON.stringify([res.body, logs])).not.toContain('connection reset')

    db.setRpc('billing_end_subscription', real)
    const again = await post('cancel-subscription', { userId: USER_A, when: 'period_end' })
    expect(again.statusCode).toBe(200)
    expect(again.body).toEqual({ result: 'canceled', accessUntil: '2026-12-17T03:00:00.000Z', pendingStop: false })
    expect(sub('chk_a')).toMatchObject({ status: 'canceled', cancel_source: 'admin' })
  })

  it('assinatura antiga adotada no cancelamento pela metade também fica marcada', async () => {
    // B assinou antes da Fase 3: sem linha de assinatura, só o pagamento antigo
    db.tables.payments.push({ id: 'pay_old', user_id: USER_B, asaas_checkout_id: 'chk_old', plan_key: 'essencial_mensal', paid_at: '2026-10-20T12:00:00.000Z' })
    const fake = setAsaas({
      get: (path, params) => {
        const p = (params ?? {}) as { checkoutSession?: string; subscription?: string }
        if (path === '/payments' && p.checkoutSession === 'chk_old') return { data: [{ id: 'pay_o1', subscription: 'sub_old' }], hasMore: false }
        if (path === '/subscriptions/sub_old') return { id: 'sub_old', status: 'ACTIVE', customer: 'cus_old' }
        return { data: [], hasMore: false }
      },
    })
    db.setRpc('billing_end_subscription', () => { throw new Error('connection reset by peer') })
    const res = await post('cancel-subscription', { userId: USER_B, when: 'period_end' })
    expect(fake.del).toHaveBeenCalledWith('/subscriptions/sub_old')
    expect(res.statusCode).toBe(500)
    expect(String((res.body as { error: string }).error)).toMatch(/^Parte do cancelamento foi feita: .* A ficha ficou marcada em Pendências\.$/)
    expect(rpcArgs('billing_flag_review')).toEqual([{ p_id: 'chk_old', p_note: NOTE_CANCEL }])
    expect(sub('chk_old')).toMatchObject({ status: 'active', needs_admin_review: true })
  })

  it('quando cancelar fora das duas opções responde 400', async () => {
    for (const when of ['amanha', '', null]) {
      const res = await post('cancel-subscription', { userId: USER_A, when })
      expect(res.statusCode).toBe(400)
    }
    expect(cancelSubscriptionForUser).not.toHaveBeenCalled()
  })
})

describe('bloquear e desbloquear', () => {
  it('bloquear sem motivo responde 400', async () => {
    const cases: [unknown, string][] = [
      [undefined, 'Preencha o motivo.'],
      ['   ', 'Preencha o motivo.'],
      ['ab', 'O motivo precisa ter pelo menos 3 caracteres.'],
      ['x'.repeat(301), 'O motivo pode ter no máximo 300 caracteres.'],
    ]
    for (const [reason, error] of cases) {
      const res = await post('block', reason === undefined ? { userId: USER_A } : { userId: USER_A, reason })
      expect(res.statusCode).toBe(400)
      expect(res.body).toEqual({ error })
    }
    expect(rpcNames()).toEqual([])
    expect(profile(USER_A).blocked_at).toBeNull()
  })

  it('bloquear admin responde 400', async () => {
    const res = await post('block', { userId: USER_D, reason: 'teste de bloqueio' })
    expect(res.statusCode).toBe(400)
    expect(res.body).toEqual({ error: MSG.adminNotBlockable })
    expect(profile(USER_D).blocked_at).toBeNull()
  })

  it('bloquear e desbloquear vão direto pra função do banco, que grava o registro', async () => {
    const blocked = await post('block', { userId: USER_A, reason: ' chargeback no cartão ' })
    expect(blocked.statusCode).toBe(200)
    expect(blocked.body).toEqual({ result: 'blocked' })
    expect(profile(USER_A)).toMatchObject({ blocked_at: NOW.toISOString(), blocked_reason: 'chargeback no cartão', blocked_by: ADMIN_ID })
    const again = await post('block', { userId: USER_A, reason: 'chargeback no cartão' })
    expect(again.statusCode).toBe(409)
    expect(again.body).toEqual({ error: MSG.alreadyBlocked })

    const unblocked = await post('unblock', { userId: USER_A })
    expect(unblocked.statusCode).toBe(200)
    expect(unblocked.body).toEqual({ result: 'unblocked' })
    expect(profile(USER_A).blocked_at).toBeNull()
    const twice = await post('unblock', { userId: USER_A })
    expect(twice.statusCode).toBe(409)
    expect(twice.body).toEqual({ error: MSG.notBlocked })

    const nobody = await post('block', { userId: NOBODY, reason: 'conta sumida' })
    expect(nobody.statusCode).toBe(404)
    expect(nobody.body).toEqual({ error: MSG.accountNotFound })

    expect(rpcArgs('admin_set_block')).toEqual([
      { p_admin: ADMIN_ID, p_user: USER_A, p_block: true, p_reason: 'chargeback no cartão' },
      { p_admin: ADMIN_ID, p_user: USER_A, p_block: true, p_reason: 'chargeback no cartão' },
      { p_admin: ADMIN_ID, p_user: USER_A, p_block: false, p_reason: null },
      { p_admin: ADMIN_ID, p_user: USER_A, p_block: false, p_reason: null },
      { p_admin: ADMIN_ID, p_user: NOBODY, p_block: true, p_reason: 'conta sumida' },
    ])
    // o registro sai da função SQL, na mesma transação: sem withAudit
    expect(logs).toEqual([])
    expect(asaasCalls()).toEqual([])
  })

  it('desbloquear não aceita motivo', async () => {
    const res = await post('unblock', { userId: USER_A, reason: 'engano' })
    expect(res.statusCode).toBe(400)
    expect(res.body).toEqual({ error: 'Campo não esperado: reason.' })
  })
})

describe('ajustar cota', () => {
  it('somar além de 1000 responde 409', async () => {
    Object.assign(profile(USER_A), { quota_bonus: 600, quota_bonus_period: PERIOD })
    const res = await post('adjust-quota', { userId: USER_A, mode: 'add', amount: 500 })
    expect(res.statusCode).toBe(409)
    expect(res.body).toEqual({ error: MSG.quotaMax })
    expect(profile(USER_A).quota_bonus).toBe(600)
  })

  it('ajustar conta inexistente responde 404', async () => {
    for (const body of [{ userId: NOBODY, mode: 'reset' }, { userId: NOBODY, mode: 'add', amount: 5 }]) {
      const res = await post('adjust-quota', body)
      expect(res.statusCode).toBe(404)
      expect(res.body).toEqual({ error: MSG.accountNotFound })
    }
  })

  it('somar 0 ou 501 responde 400', async () => {
    for (const amount of [0, 501, -3, 1.5, 'dez', undefined]) {
      const body = amount === undefined ? { userId: USER_A, mode: 'add' } : { userId: USER_A, mode: 'add', amount }
      const res = await post('adjust-quota', body)
      expect(res.statusCode, String(amount)).toBe(400)
      expect(res.body).toEqual({ error: MSG.amountRange })
    }
    expect(rpcNames()).toEqual([])
  })

  it('zerar repassa o novo contador', async () => {
    Object.assign(profile(USER_A), { quota_bonus: 10, quota_bonus_period: PERIOD })
    const res = await post('adjust-quota', { userId: USER_A, mode: 'reset' })
    expect(res.statusCode).toBe(200)
    expect(res.body).toEqual({ used: 0, bonus: 10, periodStart: PERIOD })
    expect(rpcArgs('admin_adjust_quota')).toEqual([{ p_admin: ADMIN_ID, p_user: USER_A, p_mode: 'reset', p_amount: null }])
    expect(profile(USER_A).tokens_used).toBe(0)
    expect(logs).toEqual([])
  })

  it('somar soma no extra do mês, e somar de novo soma de novo', async () => {
    Object.assign(profile(USER_A), { quota_bonus: 300, quota_bonus_period: OLD_PERIOD })
    const first = await post('adjust-quota', { userId: USER_A, mode: 'add', amount: 10 })
    expect(first.body).toEqual({ used: 4, bonus: 10, periodStart: PERIOD })
    const second = await post('adjust-quota', { userId: USER_A, mode: 'add', amount: 10 })
    expect(second.body).toEqual({ used: 4, bonus: 20, periodStart: PERIOD })
    expect(rpcArgs('admin_adjust_quota')).toEqual([
      { p_admin: ADMIN_ID, p_user: USER_A, p_mode: 'add', p_amount: 10 },
      { p_admin: ADMIN_ID, p_user: USER_A, p_mode: 'add', p_amount: 10 },
    ])
  })

  it('zerar não leva quantidade', async () => {
    const res = await post('adjust-quota', { userId: USER_A, mode: 'reset', amount: 5 })
    expect(res.statusCode).toBe(400)
    expect(res.body).toEqual({ error: MSG.resetNoAmount })
    expect(rpcNames()).toEqual([])
  })

  it('erro do banco no ajuste pede pra conferir o Registro antes de repetir', async () => {
    db.setRpc('admin_adjust_quota', () => { throw new Error('canceling statement due to statement timeout') })
    const res = await post('adjust-quota', { userId: USER_A, mode: 'add', amount: 5 })
    expect(res.statusCode).toBe(500)
    expect(res.body).toEqual({ error: MSG.quotaUnconfirmed })
    // resultado que a função não conhece: também não diz que nada mudou
    db.setRpc('admin_adjust_quota', () => ({ result: 'talvez' }))
    const odd = await post('adjust-quota', { userId: USER_A, mode: 'add', amount: 5 })
    expect(odd.statusCode).toBe(500)
    expect(odd.body).toEqual({ error: MSG.quotaUnconfirmed })
    expect(JSON.stringify([res.body, odd.body])).not.toContain('statement')
  })
})

describe('entrada das ações', () => {
  const VALID: Record<string, Record<string, unknown>> = {
    'change-plan': { planKey: 'pro_mensal' },
    'grant-courtesy': { planKey: 'pro_mensal', days: 30 },
    'end-courtesy': { courtesyId: 'cortesia:1' },
    'cancel-subscription': { when: 'now' },
    block: { reason: 'motivo bom' },
    unblock: {},
    'adjust-quota': { mode: 'reset' },
  }

  it('as sete ações estão aqui e são POST', () => {
    expect(Object.keys(handlers).sort()).toEqual(Object.keys(VALID).sort())
    for (const h of Object.values(handlers)) expect(h.method).toBe('POST')
  })

  it('userId fora do formato responde 400', async () => {
    for (const [action, rest] of Object.entries(VALID)) {
      for (const userId of ['abc', `${USER_A}0`, 42, 'not-a-uuid-at-all-0000-000000000000']) {
        const res = await post(action, { ...rest, userId })
        expect(res.statusCode, `${action} ${String(userId)}`).toBe(400)
        expect(res.body).toEqual({ error: MSG.badAccount })
      }
      const missing = await post(action, rest)
      expect(missing.statusCode, action).toBe(400)
      expect(missing.body).toEqual({ error: 'Preencha a conta.' })
    }
    expect(db.rpcCalls).toEqual([])
    expect(db.reads).toEqual([])
    expect(asaasCalls()).toEqual([])
  })

  it('campo a mais no pedido é recusado', async () => {
    const res = await post('change-plan', { userId: USER_A, planKey: 'pro_mensal', value: 1 })
    expect(res.statusCode).toBe(400)
    expect(res.body).toEqual({ error: 'Campo não esperado: value.' })
    expect(asaasCalls()).toEqual([])
  })
})

// Ruling ADM-T16-incerto: timeout ou falta de resposta numa ESCRITA no Asaas
// não é "Nada mudou". Marca a ficha, responde incerto e fecha o registro partial.
describe('escrita no Asaas sem resposta (incerto)', () => {
  // Chama a ação direto (sem o roteador) pra ver o erro que ela lança.
  async function thrownBy(action: string, body: Record<string, unknown>): Promise<unknown> {
    const ctx: AdminCtx = { db: db as unknown as AdminCtx['db'], asaas, admin: { userId: ADMIN_ID, email: 'admin@igreja.com' }, now: new Date(), query: {}, body }
    try {
      await handlers[action].run(ctx)
    } catch (e) {
      return e
    }
    throw new Error(`${action} não lançou`)
  }

  it('timeout no PUT da troca: incerto, ficha marcada e registro partial', async () => {
    const fake = setAsaas({ put: () => { throw asaasTimeout() } })
    const before = structuredClone(sub('chk_a'))
    const res = await post('change-plan', { userId: USER_A, planKey: 'pro_mensal' })
    expect(fake.put).toHaveBeenCalledTimes(1)
    expect(res.statusCode).toBe(502)
    expect(res.body).toMatchObject({ error: MSG_UNCERTAIN })
    expect(rpcArgs('billing_flag_review')).toEqual([{ p_id: 'chk_a', p_note: NOTE_UNCERTAIN_PLAN }])
    expect(sub('chk_a')).toEqual({ ...before, needs_admin_review: true, admin_note: NOTE_UNCERTAIN_PLAN })
    expect(profile(USER_A).plan).toBe('essencial_mensal')
    expect(rpcNames()).not.toContain('billing_change_plan')
    expect(logs[0].finish).toEqual({ p_id: 41, p_result: 'partial', p_after: null, p_message: MSG_UNCERTAIN })
  })

  it('a ação incerta lança o erro com uncertain verdadeiro, pro corpo da resposta', async () => {
    setAsaas({ put: () => { throw asaasTimeout() } })
    const plan = await thrownBy('change-plan', { userId: USER_A, planKey: 'pro_mensal' })
    expect(plan).toBeInstanceOf(UncertainAdminError)
    expect(plan).toMatchObject({ status: 502, message: MSG_UNCERTAIN, uncertain: true })
    setAsaas({ get: PAYMENTS_A, del: () => { throw asaasTimeout() } })
    const cancel = await thrownBy('cancel-subscription', { userId: USER_A, when: 'now' })
    expect(cancel).toMatchObject({ status: 502, message: MSG_UNCERTAIN, uncertain: true })
    // o que é certeza continua sem a marca de incerto
    setAsaas({ put: () => { throw asaasRefused() } })
    const sure = await thrownBy('change-plan', { userId: USER_A, planKey: 'pro_anual' })
    expect(sure).not.toBeInstanceOf(UncertainAdminError)
    expect((sure as { uncertain?: unknown }).uncertain).toBeUndefined()
  })

  it('timeout no DELETE do cancelamento: incerto, ficha marcada e registro partial', async () => {
    const fake = setAsaas({ get: PAYMENTS_A, del: () => { throw asaasTimeout() } })
    const res = await post('cancel-subscription', { userId: USER_A, when: 'now' })
    expect(fake.del).toHaveBeenCalledWith('/subscriptions/sub_a')
    expect(res.statusCode).toBe(502)
    expect(res.body).toMatchObject({ error: MSG_UNCERTAIN })
    expect(rpcArgs('billing_flag_review')).toEqual([{ p_id: 'chk_a', p_note: NOTE_UNCERTAIN_CANCEL }])
    expect(sub('chk_a')).toMatchObject({ status: 'active', needs_admin_review: true, admin_note: NOTE_UNCERTAIN_CANCEL })
    expect(rpcNames()).not.toContain('billing_end_subscription')
    expect(logs[0].finish).toEqual({ p_id: 41, p_result: 'partial', p_after: null, p_message: MSG_UNCERTAIN })
  })

  it('conexão recusada na escrita continua Nada mudou, sem marcar', async () => {
    setAsaas({ put: () => { throw asaasRefused() } })
    const plan = await post('change-plan', { userId: USER_A, planKey: 'pro_mensal' })
    expect(plan.statusCode).toBe(502)
    expect(plan.body).toEqual({ error: MSG.planNotChanged })
    setAsaas({ get: PAYMENTS_A, del: () => { throw asaasRefused() } })
    const before = snapshot()
    const cancel = await post('cancel-subscription', { userId: USER_A, when: 'now' })
    expect(cancel.statusCode).toBe(502)
    expect(cancel.body).toEqual({ error: MSG.cancelDown })
    expect(snapshot()).toEqual(before)
    expect(rpcNames()).not.toContain('billing_flag_review')
    expect(logs.map((l) => l.finish?.p_result)).toEqual(['failed', 'failed'])
  })

  it('leitura do Asaas que falha antes da escrita continua Nada mudou', async () => {
    // sem o id da assinatura: a troca procura no Asaas (GET) antes do PUT
    sub('chk_a').asaas_subscription_id = null
    const fake = setAsaas({ get: () => { throw asaasTimeout() } })
    const res = await post('change-plan', { userId: USER_A, planKey: 'pro_mensal' })
    expect(fake.put).not.toHaveBeenCalled()
    expect(res.statusCode).toBe(502)
    expect(res.body).toEqual({ error: MSG.planNotChanged })
    expect(rpcNames()).not.toContain('billing_flag_review')
  })

  it('sem resposta, resposta cortada e 5xx numa escrita são incertos; recusa, 404, 429 e conexão que não abriu não', () => {
    const uncertain = [
      asaasTimeout(),
      new AsaasError('unavailable', 'Asaas sem resposta (ETIMEDOUT)'),
      new AsaasError('unavailable', 'Asaas sem resposta (ECONNRESET)'),
      new AsaasError('unavailable', 'Asaas sem resposta (EPIPE)'),
      new AsaasError('unavailable', 'Asaas sem resposta (ERR_NETWORK)'),
      new AsaasError('unavailable', 'Asaas sem resposta (rede)'),
      new AsaasError('unavailable', 'falha inesperada ao falar com o Asaas'),
      ...[500, 502, 503, 504].map((s) => new AsaasError('unavailable', `Asaas respondeu ${s}`, s)),
      new TypeError('fetch failed'),
    ]
    const sure = [
      asaasRefused(),
      new AsaasError('unavailable', 'Asaas sem resposta (ENOTFOUND)'),
      new AsaasError('unavailable', 'Asaas sem resposta (EAI_AGAIN)'),
      new AsaasError('unavailable', 'Asaas respondeu 429', 429),
      asaasRejected('valor inválido'),
      new AsaasError('not_found', 'não encontrado no Asaas', 404),
    ]
    for (const e of uncertain) expect(writeMayHaveLanded(e), e.message).toBe(true)
    for (const e of sure) expect(writeMayHaveLanded(e), e.message).toBe(false)
  })

  it('repetir a troca depois do timeout, com o Asaas já trocado, termina sem duplicar', async () => {
    // O Asaas aplicou o PUT, mas a resposta não voltou a tempo.
    const remote = { value: 49.9, cycle: 'MONTHLY', puts: 0 }
    const fake = setAsaas({
      put: (_path, body) => {
        Object.assign(remote, { value: (body as { value: number }).value, cycle: (body as { cycle: string }).cycle })
        remote.puts += 1
        if (remote.puts === 1) throw asaasTimeout()
        return {}
      },
    })
    const first = await post('change-plan', { userId: USER_A, planKey: 'pro_mensal' })
    expect(first.statusCode).toBe(502)
    expect(first.body).toMatchObject({ error: MSG_UNCERTAIN })
    const second = await post('change-plan', { userId: USER_A, planKey: 'pro_mensal' })
    expect(second.statusCode).toBe(200)
    expect(second.body).toEqual({ result: 'changed', planKey: 'pro_mensal' })
    // o PUT é absoluto (o valor do plano, não um acréscimo): repetir não soma nada
    expect(fake.put).toHaveBeenCalledTimes(2)
    expect(fake.put.mock.calls[1]).toEqual(fake.put.mock.calls[0])
    expect(remote).toEqual({ value: 119.9, cycle: 'MONTHLY', puts: 2 })
    expect(rpcArgs('billing_change_plan')).toHaveLength(1)
    expect(rpcArgs('billing_flag_review')).toEqual([{ p_id: 'chk_a', p_note: NOTE_UNCERTAIN_PLAN }])
    expect(db.tables.billing_subscriptions).toHaveLength(2)
    expect(profile(USER_A).plan).toBe('pro_mensal')
    expect(logs.map((l) => l.finish?.p_result)).toEqual(['partial', 'ok'])
  })

  it('repetir o cancelamento depois do timeout, com o Asaas já removido, termina sem duplicar', async () => {
    // O Asaas removeu a assinatura, mas a resposta não voltou a tempo.
    const remote = { deleted: false }
    const fake = setAsaas({
      get: PAYMENTS_A,
      del: () => {
        if (remote.deleted) throw new AsaasError('not_found', 'não encontrado no Asaas', 404)
        remote.deleted = true
        throw asaasTimeout()
      },
    })
    const first = await post('cancel-subscription', { userId: USER_A, when: 'now' })
    expect(first.statusCode).toBe(502)
    expect(first.body).toMatchObject({ error: MSG_UNCERTAIN })
    expect(sub('chk_a').status).toBe('active')
    const second = await post('cancel-subscription', { userId: USER_A, when: 'now' })
    expect(second.statusCode).toBe(200)
    expect(second.body).toEqual({ result: 'canceled', accessUntil: NOW.toISOString(), pendingStop: false })
    // a Fase 3 conta o 404 como já removida: um encerramento só, nada pendente
    expect(fake.del).toHaveBeenCalledTimes(2)
    expect(rpcArgs('billing_end_subscription')).toEqual([
      expect.objectContaining({ p_id: 'chk_a', p_source: 'admin', p_immediate: true, p_already_stopped: true }),
    ])
    expect(db.tables.billing_pending_actions).toEqual([])
    expect(sub('chk_a')).toMatchObject({ status: 'canceled', cancel_source: 'admin' })
    expect(rpcArgs('billing_flag_review')).toEqual([{ p_id: 'chk_a', p_note: NOTE_UNCERTAIN_CANCEL }])
    expect(logs.map((l) => l.finish?.p_result)).toEqual(['partial', 'ok'])
  })
})

describe('estorno', () => {
  it('nenhuma ação estorna', async () => {
    // A comprou hoje pela primeira vez (dentro dos 7 dias do arrependimento):
    // pelo botão do app seria estorno automático; pelo admin, nunca.
    const fake = setAsaas({ get: paymentsBySub({ sub_a: [payment({ id: 'pay_a2', subscription: 'sub_a', dueDate: '2026-11-16', confirmedDate: '2026-11-16' })] }) })
    const calls: [string, Record<string, unknown>][] = [
      ['change-plan', { userId: USER_A, planKey: 'pro_mensal' }],
      ['grant-courtesy', { userId: USER_B, planKey: 'pro_anual', days: 30 }],
      ['end-courtesy', { userId: USER_B, courtesyId: 'cortesia:3' }],
      ['cancel-subscription', { userId: USER_A, when: 'now' }],
      ['block', { userId: USER_B, reason: 'teste do estorno' }],
      ['unblock', { userId: USER_B }],
      ['adjust-quota', { userId: USER_B, mode: 'add', amount: 3 }],
    ]
    for (const [action, body] of calls) {
      const res = await post(action, body)
      expect(res.statusCode, action).toBe(200)
    }
    expect(fake.post.mock.calls.filter(([path]) => /refund/i.test(String(path)))).toEqual([])
    expect(rpcArgs('billing_enqueue_action').filter((a) => a.p_action === 'refund_payment')).toEqual([])
    expect(rpcArgs('billing_end_subscription').map((a) => a.p_source)).toEqual(['admin', 'admin'])
    expect(sub('chk_a')).toMatchObject({ status: 'canceled', cancel_source: 'admin' })
  })
})

import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRes, type FakeDb, type RpcHandler } from './fakeSupabase.js'
import { USER_A, USER_B, createBillingDb, subRow } from './billingHarness.js'
import { BLOCKED_MESSAGE } from '../_lib/auth.js'
import { accountSubscriptionCount } from '../_lib/billing.js'
import { PLAN_PRICING } from '../_lib/pricing.js'
import {
  AD_KINDS, AD_PLACEMENTS, OFFER_PRICING, OFFER_TRIGGERS, OFFER_WINDOW_HOURS, isOfferPlan,
} from '../_lib/offer.js'

// Oferta do primeiro mês e eventos de anúncio por ?action= no api/checkout.ts (Parte 3, T12).
// A janela de 48 horas e o registro ficam no SQL (db/supabase_oferta.sql); aqui um modelo
// pequeno das duas funções segue as mesmas regras (used, depois active de qualquer mês,
// depois expired do mês de Brasília, senão none). Nenhuma chamada de rede.

const h = vi.hoisted(() => ({ blocked: false }))
let db: FakeDb
vi.mock('@supabase/supabase-js', () => ({ createClient: () => db }))
vi.mock('../_lib/auth.js', async (orig) => ({
  ...(await orig<typeof import('../_lib/auth.js')>()),
  verifyUser: vi.fn(async () => ({ ok: true, userId: USER_A, email: 'quem@igreja.com', isAdmin: false, blocked: h.blocked })),
}))

const NOW = '2026-11-19T15:00:00.000Z'
const EXPIRES = '2026-11-21T15:00:00.000Z'
const PRICES = { essencial_mensal: 24.9, pro_mensal: 59.9 }

type Window = { month: string; expiresAt: string; used?: boolean }

// mês de Brasília (UTC-3, sem horário de verão) de um instante ISO
const brtMonth = (iso: string) => new Date(Date.parse(iso) - 3 * 3600_000).toISOString().slice(0, 7)
const brtDay = (iso: string) => new Date(Date.parse(iso) - 3 * 3600_000).toISOString().slice(0, 10)

// Modelo de offer_current e offer_open_window (db/supabase_oferta.sql) pra conta do login.
function offerModel(windows: Window[] = []): Window[] {
  const current: RpcHandler = (a) => {
    const nowIso = String(a.p_now)
    const now = Date.parse(nowIso)
    const used = windows.find((w) => w.used)
    if (used) return { status: 'used', expiresAt: null, month: used.month }
    const active = windows.filter((w) => now < Date.parse(w.expiresAt)).sort((x, y) => Date.parse(y.expiresAt) - Date.parse(x.expiresAt))[0]
    if (active) return { status: 'active', expiresAt: active.expiresAt, month: active.month }
    if (windows.some((w) => w.month === brtMonth(nowIso))) return { status: 'expired', expiresAt: null, month: brtMonth(nowIso) }
    return { status: 'none', expiresAt: null, month: null }
  }
  db.setRpc('offer_current', current)
  db.setRpc('offer_open_window', (a) => {
    const before = current(a) as { status: string }
    if (before.status !== 'none') return before
    const nowIso = String(a.p_now)
    windows.push({ month: brtMonth(nowIso), expiresAt: new Date(Date.parse(nowIso) + OFFER_WINDOW_HOURS * 3600_000).toISOString() })
    return current(a)
  })
  return windows
}

// Modelo de record_product_event (db/supabase_eventos.sql): anúncio um por conta, lugar e dia.
function eventsModel(): Set<string> {
  const seen = new Set<string>()
  db.setRpc('record_product_event', (a) => {
    const key = `${String(a.p_user_id)}|${String(a.p_kind)}|${String(a.p_placement)}|${brtDay(String(a.p_now))}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
  return seen
}

async function call(action: string, body: unknown = {}) {
  const { default: handler } = await import('../checkout.js')
  const res = createRes()
  await handler({ method: 'POST', headers: { authorization: 'Bearer x' }, query: { action }, body }, res)
  return res
}

const rpcNames = () => db.rpcCalls.map((c) => c.name)

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(NOW))
  vi.stubEnv('VITE_SUPABASE_URL', 'https://fake.supabase.co')
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'fake-service-role')
  h.blocked = false
  db = createBillingDb({ profiles: [{ id: USER_A, plan: 'free', plan_expires_at: null }] })
})
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs() })

describe('?action=offer', () => {
  it('Livre sem assinatura: open abre a janela e devolve active, expiresAt e os preços 24,9 e 59,9', async () => {
    const windows = offerModel()
    const res = await call('offer', { open: true, trigger: 'stage-songs' })
    expect(res.statusCode).toBe(200)
    expect(res.body).toEqual({ status: 'active', expiresAt: EXPIRES, prices: PRICES })
    expect(db.rpcCalls).toEqual([{ name: 'offer_open_window', args: { p_user_id: USER_A, p_trigger: 'stage-songs', p_now: NOW } }])
    expect(windows).toEqual([{ month: '2026-11', expiresAt: EXPIRES }])
  })

  it('abrir de novo dentro das 48 horas devolve a mesma janela', async () => {
    const windows = offerModel()
    await call('offer', { open: true, trigger: 'separations' })
    vi.setSystemTime(new Date('2026-11-20T10:00:00Z'))
    const res = await call('offer', { open: true, trigger: 'live' })
    expect(res.body).toEqual({ status: 'active', expiresAt: EXPIRES, prices: PRICES })
    expect(windows).toHaveLength(1)
  })

  it('quem já teve assinatura recebe ineligible e nada é gravado', async () => {
    const windows = offerModel()
    db.tables.billing_subscriptions.push(subRow({ id: 'chk_1', user_id: USER_A, status: 'canceled', cancel_source: 'user' }))
    const res = await call('offer', { open: true, trigger: 'stage-songs' })
    expect(res.statusCode).toBe(200)
    expect(res.body).toEqual({ status: 'ineligible', expiresAt: null, prices: PRICES })
    expect(rpcNames()).not.toContain('offer_open_window')
    expect(rpcNames()).not.toContain('offer_current')
    expect(windows).toEqual([])
  })

  it('quem pagou pelo registro antigo (payments) também recebe ineligible', async () => {
    offerModel()
    db.tables.payments.push({ id: 'pay_1', user_id: USER_A, asaas_checkout_id: 'chk_antigo', value: 49.9 })
    const res = await call('offer', { open: false })
    expect((res.body as { status: string }).status).toBe('ineligible')
    expect(db.rpcCalls).toEqual([])
  })

  it('open false só lê com offer_current e nunca abre', async () => {
    const windows = offerModel()
    const res = await call('offer', { open: false, trigger: 'stage-songs' })
    expect(res.body).toEqual({ status: 'none', expiresAt: null, prices: PRICES })
    expect(db.rpcCalls).toEqual([{ name: 'offer_current', args: { p_user_id: USER_A, p_now: NOW } }])
    expect(windows).toEqual([])
    // sem corpo também só lê
    expect((await call('offer')).body).toMatchObject({ status: 'none' })
    expect(rpcNames()).not.toContain('offer_open_window')
  })

  it('open false com janela aberta devolve active com o relógio', async () => {
    offerModel([{ month: '2026-11', expiresAt: EXPIRES }])
    expect((await call('offer', { open: false })).body).toEqual({ status: 'active', expiresAt: EXPIRES, prices: PRICES })
  })

  it('open que não é true (texto "true", 1) não abre janela', async () => {
    const windows = offerModel()
    await call('offer', { open: 'true', trigger: 'stage-songs' })
    await call('offer', { open: 1, trigger: 'stage-songs' })
    expect(rpcNames()).toEqual(['offer_current', 'offer_current'])
    expect(windows).toEqual([])
  })

  it('janela vencida no mês: expired sem relógio', async () => {
    offerModel([{ month: '2026-11', expiresAt: '2026-11-12T15:00:00.000Z' }])
    const res = await call('offer', { open: true, trigger: 'download' })
    expect(res.body).toEqual({ status: 'expired', expiresAt: null, prices: PRICES })
  })

  it('oferta já usada: used', async () => {
    offerModel([{ month: '2026-10', expiresAt: '2026-10-10T15:00:00.000Z', used: true }])
    expect((await call('offer', { open: true, trigger: 'download' })).body).toEqual({ status: 'used', expiresAt: null, prices: PRICES })
  })

  it('trigger fora da lista com open: 400', async () => {
    offerModel()
    for (const trigger of ['qualquer', '', undefined, 3, 'constructor']) {
      const res = await call('offer', { open: true, trigger })
      expect(res.statusCode, String(trigger)).toBe(400)
      expect(JSON.stringify(res.body)).not.toMatch(/trigger|LimitKind/)
    }
    expect(db.rpcCalls).toEqual([])
  })

  it('erro do banco na oferta: 200 com status none', async () => {
    offerModel()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    db.setRpc('offer_open_window', () => { throw new Error('connection reset') })
    const res = await call('offer', { open: true, trigger: 'stage-songs' })
    expect(res.statusCode).toBe(200)
    expect(res.body).toEqual({ status: 'none', expiresAt: null, prices: PRICES })
    expect(warn).toHaveBeenCalled()
  })

  it('SQL da oferta ainda não rodou (função não existe): 200 com status none', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const res = await call('offer', { open: true, trigger: 'stage-songs' })
    expect(res.statusCode).toBe(200)
    expect(res.body).toMatchObject({ status: 'none', expiresAt: null })
  })

  it('erro ao ler as assinaturas: 200 com status none, sem abrir janela', async () => {
    offerModel()
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    db.failTable('payments', { message: 'connection reset', code: '08006' })
    const res = await call('offer', { open: true, trigger: 'stage-songs' })
    expect(res.statusCode).toBe(200)
    expect(res.body).toMatchObject({ status: 'none' })
    expect(db.rpcCalls).toEqual([])
  })

  it('resposta do banco fora do formato vira none (active sem relógio ou sem mês)', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    for (const answer of [{ status: 'active', expiresAt: null, month: '2026-11' }, { status: 'active', expiresAt: EXPIRES, month: null }, { status: 'talvez' }, null]) {
      db.setRpc('offer_current', () => answer)
      expect((await call('offer', { open: false })).body, JSON.stringify(answer)).toMatchObject({ status: 'none', expiresAt: null })
    }
  })

  it('sem a chave do banco no servidor: 200 com status none', async () => {
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', '')
    const res = await call('offer', { open: true, trigger: 'stage-songs' })
    expect(res.statusCode).toBe(200)
    expect(res.body).toMatchObject({ status: 'none' })
  })

  it('conta só com cortesia ainda tem direito à oferta', async () => {
    offerModel()
    db.tables.billing_subscriptions.push(subRow({ id: 'crt_1', user_id: USER_A, kind: 'courtesy', plan_key: 'pro_mensal' }))
    expect((await call('offer', { open: true, trigger: 'separations' })).body).toMatchObject({ status: 'active' })
  })
})

describe('?action=track', () => {
  it('track grava ad_shown da tela inicial com a conta do login', async () => {
    eventsModel()
    const res = await call('track', { kind: 'ad_shown', placement: 'home' })
    expect(res.statusCode).toBe(200)
    expect(res.body).toEqual({ ok: true })
    const call0 = db.rpcCalls.find((c) => c.name === 'record_product_event')!
    expect(call0.args).toMatchObject({ p_user_id: USER_A, p_kind: 'ad_shown', p_placement: 'home', p_now: NOW })
  })

  it('repetido no mesmo dia: ok false; clique é outro evento', async () => {
    eventsModel()
    await call('track', { kind: 'ad_shown', placement: 'limit' })
    expect((await call('track', { kind: 'ad_shown', placement: 'limit' })).body).toEqual({ ok: false })
    expect((await call('track', { kind: 'ad_clicked', placement: 'limit' })).body).toEqual({ ok: true })
    expect((await call('track', { kind: 'ad_shown', placement: 'badge' })).body).toEqual({ ok: true })
  })

  it('track com kind ou placement fora da lista: 400 sem gravar', async () => {
    eventsModel()
    const bodies = [
      { kind: 'offer_shown', placement: 'home' },
      { kind: 'offer_used' },
      { kind: 'ad_shown', placement: 'rodape' },
      { kind: 'ad_shown' },
      { placement: 'home' },
      { kind: 'ad_shown', placement: null },
      { kind: ['ad_shown'], placement: 'home' },
      {},
    ]
    for (const body of bodies) expect((await call('track', body)).statusCode, JSON.stringify(body)).toBe(400)
    expect(db.rpcCalls).toEqual([])
  })

  it('track ignora user_id de outra conta no corpo', async () => {
    eventsModel()
    await call('track', { kind: 'ad_clicked', placement: 'badge', user_id: USER_B, p_user_id: USER_B, userId: USER_B })
    expect(db.rpcCalls).toHaveLength(1)
    expect(db.rpcCalls[0].args.p_user_id).toBe(USER_A)
    expect(JSON.stringify(db.rpcCalls)).not.toContain(USER_B)
  })

  it('erro do banco no track: 200 com ok false', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    db.setRpc('record_product_event', () => { throw new Error('connection reset') })
    const res = await call('track', { kind: 'ad_shown', placement: 'separation-done' })
    expect(res.statusCode).toBe(200)
    expect(res.body).toEqual({ ok: false })
  })
})

describe('conta bloqueada e ordem das ações', () => {
  it('conta bloqueada: offer e track respondem 403', async () => {
    offerModel()
    eventsModel()
    h.blocked = true
    for (const [action, body] of [['offer', { open: true, trigger: 'stage-songs' }], ['track', { kind: 'ad_shown', placement: 'home' }]] as const) {
      const res = await call(action, body)
      expect(res.statusCode, action).toBe(403)
      expect(res.body).toEqual({ error: BLOCKED_MESSAGE })
    }
    expect(db.rpcCalls).toEqual([])
  })

  it('ação desconhecida: 400; com a conta bloqueada o 403 vem antes', async () => {
    expect((await call('qualquer')).statusCode).toBe(400)
    h.blocked = true
    expect((await call('qualquer')).statusCode).toBe(403)
  })
})

describe('accountSubscriptionCount', () => {
  it('accountSubscriptionCount não conta compra repetida nem cortesia', async () => {
    db.tables.billing_subscriptions.push(
      subRow({ id: 'chk_1', user_id: USER_A }),
      subRow({ id: 'chk_2', user_id: USER_A, status: 'canceled', cancel_source: 'duplicate' }),
      subRow({ id: 'crt_1', user_id: USER_A, kind: 'courtesy', plan_key: 'pro_mensal' }),
      subRow({ id: 'chk_b', user_id: USER_B }),
    )
    db.tables.payments.push(
      { id: 'pay_1', user_id: USER_A, asaas_checkout_id: 'chk_1' },
      { id: 'pay_2', user_id: USER_A, asaas_checkout_id: 'chk_2' },
      { id: 'pay_3', user_id: USER_A, asaas_checkout_id: null },
    )
    expect(await accountSubscriptionCount(db as never, USER_A)).toBe(1)
  })

  it('conta nova dá 0; assinatura e pagamento antigo de checkouts diferentes dão 2', async () => {
    expect(await accountSubscriptionCount(db as never, USER_A)).toBe(0)
    db.tables.billing_subscriptions.push(subRow({ id: 'chk_1', user_id: USER_A, status: 'canceled', cancel_source: 'user' }))
    db.tables.payments.push({ id: 'pay_9', user_id: USER_A, asaas_checkout_id: 'chk_antigo' })
    expect(await accountSubscriptionCount(db as never, USER_A)).toBe(2)
  })

  it('erro do banco lança (quem chama decide, nunca vira 0)', async () => {
    db.failTable('billing_subscriptions', { message: 'connection reset' })
    await expect(accountSubscriptionCount(db as never, USER_A)).rejects.toThrow()
  })
})

describe('preços e listas da oferta', () => {
  it('OFFER_PRICING: Pro Mensal 24,9 e Studio Mensal 59,9, só planos mensais e abaixo do cheio', () => {
    expect(OFFER_PRICING).toEqual(PRICES)
    expect(OFFER_WINDOW_HOURS).toBe(48)
    for (const [key, value] of Object.entries(OFFER_PRICING)) {
      const full = PLAN_PRICING[key as keyof typeof PLAN_PRICING]
      expect(full.cycle, key).toBe('MONTHLY')
      expect(value, key).toBeLessThan(full.value)
    }
  })

  it('isOfferPlan só aceita Pro Mensal e Studio Mensal', () => {
    expect(isOfferPlan('essencial_mensal')).toBe(true)
    expect(isOfferPlan('pro_mensal')).toBe(true)
    for (const k of ['essencial_anual', 'pro_anual', 'free', 'constructor', '__proto__', 'toString', '', null, undefined, 24.9]) {
      expect(isOfferPlan(k), String(k)).toBe(false)
    }
  })

  // Ruling R15: a mesma lista vive no app, no servidor e no CHECK do SQL.
  const quoted = (s: string) => [...s.matchAll(/'([^']+)'/g)].map((m) => m[1])
  const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')

  it('OFFER_TRIGGERS é a mesma lista de LIMIT_KINDS do app e do CHECK do SQL da oferta', () => {
    const front = read('../../src/lib/livreRules.ts')
    const sql = read('../../db/supabase_oferta.sql')
    expect(quoted(front.match(/export type LimitKind\s*=([^\n]+)/)![1])).toEqual([...OFFER_TRIGGERS])
    expect(quoted(front.match(/export const LIMIT_KINDS[^=]*=\s*\[([^\]]*)\]/)![1])).toEqual([...OFFER_TRIGGERS])
    expect(quoted(sql.match(/check \(trigger_kind in \(([^)]*)\)\)/)![1])).toEqual([...OFFER_TRIGGERS])
  })

  it('AD_PLACEMENTS é a mesma lista de AdPlacement do app e do CHECK de product_events; AD_KINDS estão no CHECK', () => {
    const front = read('../../src/lib/livreRules.ts')
    const sql = read('../../db/supabase_eventos.sql')
    expect(quoted(front.match(/export type AdPlacement\s*=([^\n]+)/)![1])).toEqual([...AD_PLACEMENTS])
    expect(quoted(sql.match(/check \(placement in \(([^)]*)\)\)/)![1])).toEqual([...AD_PLACEMENTS])
    expect(quoted(sql.match(/check \(\(kind in \(([^)]*)\)\) = \(placement is not null\)\)/)![1])).toEqual([...AD_KINDS])
  })
})

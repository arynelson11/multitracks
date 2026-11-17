import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeDb, createRes, type FakeDb, type FakeRes, type Row } from './fakeSupabase.js'
import { createAdminRouter } from '../_lib/admin/http.js'
import { handlers } from '../_lib/admin/auditList.js'

// Registro (Task 7): a ação audit lista o registro das ações do admin, do mais
// novo pro mais antigo, em páginas de 50. O SQL de admin_audit_list é da T5;
// aqui o contrato vai por setRpc. Todo lastError do antes e do depois sai em
// frase pronta (Ruling ADM-T6-lastError): o admin_close_action grava o texto
// cru do banco no antes, e o retry_action e o retry_event (T6) já gravam a frase.

const ADMIN_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const USER_ID = '11111111-1111-4111-8111-111111111111'
const TRAVESSAO = String.fromCharCode(0x2014)

const MSG = {
  badAccount: 'A conta está em formato inválido.',
  badPage: 'A página precisa ser um número de 1 a 1000.',
  unexpected: 'Erro inesperado no servidor.',
  asaasSilent: 'O Asaas não respondeu.',
}

let db: FakeDb
let responses: FakeRes[]
let listed: Row

vi.mock('../_lib/auth.js', () => ({
  verifyAdmin: vi.fn(async () => ({ ok: true, userId: ADMIN_ID, email: 'admin@igreja.com', isAdmin: true, blocked: false })),
}))
vi.mock('@supabase/supabase-js', () => ({ createClient: vi.fn(() => db) }))

const router = createAdminRouter(handlers)

async function get(query: Record<string, unknown> = {}): Promise<FakeRes> {
  const res = createRes()
  await router({ method: 'GET', query: { action: 'audit', ...query }, headers: { authorization: 'Bearer admin' } }, res)
  responses.push(res)
  return res
}

function entry(over: Row = {}): Row {
  return {
    id: 7, createdAt: '2026-11-16T15:00:00.123456+00:00', finishedAt: '2026-11-16T15:00:01.5+00:00', adminEmail: 'admin@igreja.com',
    action: 'resolve_flag', targetUserId: USER_ID, targetEmail: 'quem@igreja.com', targetRef: 'chk_1', result: 'ok',
    message: null, note: 'conferido no painel', before: { needsAdminReview: true }, after: { needsAdminReview: false }, ...over,
  }
}

const listArgs = () => db.rpcCalls.filter((c) => c.name === 'admin_audit_list').map((c) => c.args)

beforeEach(() => {
  vi.stubEnv('VITE_SUPABASE_URL', 'https://fake.supabase.co')
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'fake-service-role')
  vi.spyOn(console, 'error').mockImplementation(() => {})
  responses = []
  listed = { total: 1, rows: [entry()] }
  db = createFakeDb({ rpc: { admin_audit_list: () => listed } })
})

afterEach(() => {
  for (const res of responses) {
    expect(JSON.stringify(res.body ?? null).includes(TRAVESSAO)).toBe(false)
    expect(res.headers['Cache-Control']).toBe('no-store')
  }
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
})

describe('lista do registro', () => {
  it('sem página pede a primeira, de 50, sem filtro de conta', async () => {
    const res = await get()
    expect(res.statusCode).toBe(200)
    expect(listArgs()).toEqual([{ p_limit: 50, p_offset: 0, p_target: null }])
    expect(res.body).toEqual({ total: 1, page: 1, pageSize: 50, rows: [entry()] })
  })

  it('página 2 pede p_offset 50', async () => {
    listed = { total: 51, rows: [entry({ id: 1 })] }
    const res = await get({ page: '2' })
    expect(res.statusCode).toBe(200)
    expect(listArgs()).toEqual([{ p_limit: 50, p_offset: 50, p_target: null }])
    expect(res.body).toMatchObject({ total: 51, page: 2, pageSize: 50 })
  })

  it('a página 1000 é a última aceita', async () => {
    const res = await get({ page: '1000' })
    expect(res.statusCode).toBe(200)
    expect(listArgs()).toEqual([{ p_limit: 50, p_offset: 49950, p_target: null }])
  })

  it('página fora de 1 a 1000 ou que não é número responde 400 sem ler o banco', async () => {
    for (const page of ['0', '1001', '-1', 'abc', '1.5']) {
      const res = await get({ page })
      expect(res.statusCode, page).toBe(400)
      expect(res.body, page).toEqual({ error: MSG.badPage })
    }
    expect(db.rpcCalls).toEqual([])
  })

  it('userId filtra pela conta, em minúsculas como o Postgres devolve', async () => {
    const res = await get({ userId: USER_ID.toUpperCase(), page: '3' })
    expect(res.statusCode).toBe(200)
    expect(listArgs()).toEqual([{ p_limit: 50, p_offset: 100, p_target: USER_ID }])
  })

  it('userId vazio vale como sem filtro', async () => {
    const res = await get({ userId: '' })
    expect(res.statusCode).toBe(200)
    expect(listArgs()).toEqual([{ p_limit: 50, p_offset: 0, p_target: null }])
  })

  it('userId inválido responde 400', async () => {
    for (const userId of ['abc', `${USER_ID}x`, "1' or '1'='1"]) {
      const res = await get({ userId })
      expect(res.statusCode, userId).toBe(400)
      expect(res.body, userId).toEqual({ error: MSG.badAccount })
    }
    expect(db.rpcCalls).toEqual([])
  })

  it('campo que a ação não declarou responde 400', async () => {
    const res = await get({ pageSize: '500' })
    expect(res.statusCode).toBe(400)
    expect(res.body).toEqual({ error: 'Campo não esperado: pageSize.' })
    expect(db.rpcCalls).toEqual([])
  })

  it('erro do banco responde a frase genérica, sem o texto do banco', async () => {
    db.setRpc('admin_audit_list', () => { throw new Error('relation "admin_audit_log" does not exist') })
    const res = await get()
    expect(res.statusCode).toBe(500)
    expect(res.body).toEqual({ error: MSG.unexpected })
    expect(JSON.stringify(res.body)).not.toContain('admin_audit_log')
  })

  it('resposta do banco fora do formato responde a frase genérica', async () => {
    for (const bad of [null, [], { total: 1 }, { total: 'x', rows: [] }, { total: 1, rows: {} }]) {
      listed = bad as Row
      const res = await get()
      expect(res.statusCode).toBe(500)
      expect(res.body).toEqual({ error: MSG.unexpected })
    }
  })

  it('total que o jsonb devolve como texto (bigint grande) vira número', async () => {
    listed = { total: '120', rows: [] }
    const res = await get()
    expect(res.statusCode).toBe(200)
    expect(res.body).toEqual({ total: 120, page: 1, pageSize: 50, rows: [] })
  })
})

describe('último erro em frase pronta no antes e no depois (Ruling ADM-T6-lastError)', () => {
  it('o antes do close_action, gravado cru pelo SQL, sai em frase pronta', async () => {
    listed = {
      total: 3,
      rows: [
        entry({ id: 3, action: 'close_action', targetRef: '12',
          before: { action: 'refund_payment', status: 'pending', attempts: 3, lastError: 'Asaas recusou (400): invalid_action: a cobrança pay_9 não pode ser estornada' },
          after: { status: 'done', doneAt: '2026-11-16T15:00:00+00:00', doneNote: 'admin: estornado no painel' } }),
        entry({ id: 2, action: 'close_action', targetRef: '11', before: { action: 'refund_payment', lastError: 'Asaas sem resposta (ECONNRESET)' } }),
        entry({ id: 1, action: 'close_action', targetRef: '10', before: { action: 'admin_review', lastError: 'duplicate key value violates unique constraint "billing_payments_pkey"' } }),
        entry({ id: 0, action: 'close_action', targetRef: '9', before: { action: 'delete_future_payments', lastError: 'Asaas recusou remover pay_1, pay_2' } }),
      ],
    }
    const res = await get()
    expect(res.statusCode).toBe(200)
    const rows = (res.body as { rows: Row[] }).rows
    expect(rows[0].before).toEqual({ action: 'refund_payment', status: 'pending', attempts: 3, lastError: 'O Asaas recusou o pedido. Status do Asaas: 400.' })
    expect(rows[0].after).toEqual({ status: 'done', doneAt: '2026-11-16T15:00:00+00:00', doneNote: 'admin: estornado no painel' })
    expect(rows[1].before).toEqual({ action: 'refund_payment', lastError: MSG.asaasSilent })
    expect(rows[2].before).toEqual({ action: 'admin_review', lastError: MSG.unexpected })
    expect(rows[3].before).toEqual({ action: 'delete_future_payments', lastError: 'O Asaas recusou remover as cobranças futuras: pay_1, pay_2.' })
    const text = JSON.stringify(res.body)
    for (const raw of ['invalid_action', 'ECONNRESET', 'duplicate key', 'billing_payments_pkey']) expect(text).not.toContain(raw)
  })

  it('a frase pronta que a T6 já gravou passa como está, e nulo continua nulo', async () => {
    const refused = 'O Asaas recusou o pedido. Status do Asaas: 422.'
    const down = 'O Asaas não respondeu. Status do Asaas: 503.'
    const removal = 'O Asaas recusou remover as cobranças futuras: pay_7.'
    listed = {
      total: 3,
      rows: [
        entry({ id: 3, action: 'retry_action', targetRef: '7',
          before: { action: 'inactivate_subscription', status: 'pending', attempts: 1, lastError: MSG.asaasSilent },
          after: { status: 'pending', attempts: 2, lastError: refused } }),
        entry({ id: 2, action: 'retry_action', targetRef: '8',
          before: { action: 'delete_future_payments', status: 'pending', attempts: 4, lastError: down },
          after: { status: 'pending', attempts: 5, lastError: removal } }),
        entry({ id: 1, action: 'retry_event', targetRef: 'evt_1',
          before: { event: 'PAYMENT_CONFIRMED', status: 'failed', attempts: 0, lastError: MSG.unexpected },
          after: { processed: true, result: 'paid' } }),
      ],
    }
    const res = await get()
    const rows = (res.body as { rows: Row[] }).rows
    expect(rows[0].before).toEqual({ action: 'inactivate_subscription', status: 'pending', attempts: 1, lastError: MSG.asaasSilent })
    expect(rows[0].after).toEqual({ status: 'pending', attempts: 2, lastError: refused })
    expect(rows[1].before).toEqual({ action: 'delete_future_payments', status: 'pending', attempts: 4, lastError: down })
    expect(rows[1].after).toEqual({ status: 'pending', attempts: 5, lastError: removal })
    expect(rows[2].before).toEqual({ event: 'PAYMENT_CONFIRMED', status: 'failed', attempts: 0, lastError: MSG.unexpected })

    listed = { total: 1, rows: [entry({ before: { status: 'pending', lastError: null }, after: null })] }
    const again = await get()
    const row = (again.body as { rows: Row[] }).rows[0]
    expect(row.before).toEqual({ status: 'pending', lastError: null })
    expect(row.after).toBeNull()
  })

  it('lastError dentro de lista ou objeto aninhado também sai em frase pronta', async () => {
    listed = {
      total: 1,
      rows: [entry({ action: 'cancel_subscription',
        before: { attempts: [{ lastError: 'Asaas recusou (409): conflito' }] },
        after: { pending: { lastError: 'Asaas sem resposta em 9000 ms', note: 'segue' } } })],
    }
    const res = await get()
    const row = (res.body as { rows: Row[] }).rows[0]
    expect(row.before).toEqual({ attempts: [{ lastError: 'O Asaas recusou o pedido. Status do Asaas: 409.' }] })
    expect(row.after).toEqual({ pending: { lastError: MSG.asaasSilent, note: 'segue' } })
  })

  it('linha sem lastError e campos fora do antes e do depois passam como vieram', async () => {
    const row = entry({ result: 'failed', message: 'O Asaas não respondeu. Status do Asaas: sem dado.', before: { planKey: 'pro_mensal' }, after: null })
    listed = { total: 1, rows: [row] }
    const res = await get()
    expect((res.body as { rows: Row[] }).rows).toEqual([row])
  })
})

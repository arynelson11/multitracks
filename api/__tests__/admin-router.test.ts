import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { createFakeDb, createRes, type FakeDb, type FakeRes } from './fakeSupabase.js'
import { BillingError } from '../_lib/billing.js'
import { legacyStats } from '../_lib/admin/legacyStats.js'
import {
  AdminError,
  createAdminRouter,
  day,
  int,
  mergeHandlers,
  oneOf,
  onlyKeys,
  str,
  toHttpError,
  uuid,
  type AdminCtx,
  type AdminHandlers,
} from '../_lib/admin/http.js'

// Roteador do admin (/api/admin-stats?action=<nome>): o papel é conferido no
// servidor antes de qualquer ação, nenhuma resposta fica em cache e todo erro
// vira frase pronta em português, sem detalhe do banco.

const ADMIN_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const TRAVESSAO = String.fromCharCode(0x2014)

let db: FakeDb

// verifyAdmin de mentira com o mesmo contrato do de verdade (T2): sem token
// 401, token de usuário comum 403, token de admin ok com id e e-mail.
vi.mock('../_lib/auth.js', () => ({
  verifyAdmin: vi.fn(async (req: { headers?: Record<string, string> }) => {
    const header = req.headers?.authorization
    if (!header) return { ok: false, status: 401, error: 'Missing Bearer token' }
    if (header === 'Bearer comum') return { ok: false, status: 403, error: 'Forbidden: admin required' }
    if (header === 'Bearer admin') return { ok: true, userId: ADMIN_ID, email: 'admin@igreja.com', isAdmin: true, blocked: false }
    // ok sem papel de admin: o que viria se alguém trocasse verifyAdmin por verifyUser
    if (header === 'Bearer quase') return { ok: true, userId: ADMIN_ID, email: 'quem@igreja.com', isAdmin: false, blocked: false }
    if (header === 'Bearer explode') throw new Error('getaddrinfo ENOTFOUND fake.supabase.co')
    if (header === 'Bearer semconfig') return { ok: false, status: 500, error: 'Auth backend misconfigured' }
    return { ok: false, status: 401, error: 'Invalid or expired token' }
  }),
}))
vi.mock('@supabase/supabase-js', () => ({ createClient: vi.fn(() => db) }))
vi.mock('../_lib/admin/legacyStats.js', () => ({
  legacyStats: vi.fn(async (_req: unknown, res: FakeRes) => { res.status(200).json({ painel: 'antigo' }) }),
}))

type Req = { method: string; query?: Record<string, unknown>; token?: string | null; body?: unknown }

async function call(handler: (req: unknown, res: unknown) => Promise<void>, { method, query = {}, token = 'admin', body }: Req): Promise<FakeRes> {
  const res = createRes()
  await handler({ method, query, headers: token ? { authorization: `Bearer ${token}` } : {}, body }, res)
  return res
}

type Run = (ctx: AdminCtx) => Promise<unknown>
let ping: Mock<Run>
let echo: Mock<Run>
let router: (req: unknown, res: unknown) => Promise<void>

// Roteador com uma só ação que lança o erro dado.
const failing = (err: unknown) => createAdminRouter({ quebra: { method: 'GET', fields: [], run: async () => { throw err } } })

beforeEach(() => {
  vi.stubEnv('VITE_SUPABASE_URL', 'https://fake.supabase.co')
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'fake-service-role')
  db = createFakeDb()
  ping = vi.fn(async (ctx: AdminCtx) => ({ pong: true, admin: ctx.admin, query: ctx.query }))
  echo = vi.fn(async (ctx: AdminCtx) => ({ body: ctx.body }))
  router = createAdminRouter({ ping: { method: 'GET', fields: ['page'], run: ping }, echo: { method: 'POST', fields: ['note'], run: echo } })
  vi.mocked(legacyStats).mockClear()
})
afterEach(() => {
  vi.unstubAllEnvs()
})

describe('roteador do admin', () => {
  it('sem token responde 401', async () => {
    const res = await call(router, { method: 'GET', query: { action: 'ping' }, token: null })
    expect(res.statusCode).toBe(401)
    expect(ping).not.toHaveBeenCalled()
  })

  it('usuário comum responde 403 e não roda a ação', async () => {
    const get = await call(router, { method: 'GET', query: { action: 'ping' }, token: 'comum' })
    const post = await call(router, { method: 'POST', query: { action: 'echo' }, token: 'comum', body: { userId: ADMIN_ID } })
    expect(get.statusCode).toBe(403)
    expect(post.statusCode).toBe(403)
    expect(ping).not.toHaveBeenCalled()
    expect(echo).not.toHaveBeenCalled()
    expect(db.rpcCalls).toEqual([])
  })

  it('usuário comum pedindo ação que não existe também responde 403 (não descobre os nomes)', async () => {
    const res = await call(router, { method: 'GET', query: { action: 'nada' }, token: 'comum' })
    expect(res.statusCode).toBe(403)
  })

  it('ação desconhecida responde 400 com o nome', async () => {
    const res = await call(router, { method: 'GET', query: { action: 'nada' } })
    expect(res.statusCode).toBe(400)
    expect(res.body).toEqual({ error: 'Ação desconhecida: nada' })
  })

  it('sem ?action= responde 400', async () => {
    const res = await call(router, { method: 'GET' })
    expect(res.statusCode).toBe(400)
    expect(res.body).toEqual({ error: 'Ação desconhecida: sem dado' })
  })

  it('nome que todo objeto tem (constructor, __proto__, toString) não vira ação', async () => {
    for (const action of ['constructor', '__proto__', 'toString', 'hasOwnProperty']) {
      const res = await call(router, { method: 'GET', query: { action } })
      expect(res.statusCode, action).toBe(400)
      expect(res.body, action).toEqual({ error: `Ação desconhecida: ${action}` })
    }
  })

  it('GET numa ação POST responde 405', async () => {
    const res = await call(router, { method: 'GET', query: { action: 'echo' } })
    expect(res.statusCode).toBe(405)
    expect(res.body).toEqual({ error: 'Esta ação usa POST.' })
    expect(echo).not.toHaveBeenCalled()
    const back = await call(router, { method: 'POST', query: { action: 'ping' } })
    expect(back.statusCode).toBe(405)
    expect(back.body).toEqual({ error: 'Esta ação usa GET.' })
  })

  it('OPTIONS responde 200', async () => {
    const res = await call(router, { method: 'OPTIONS', token: null })
    expect(res.statusCode).toBe(200)
    expect(res.headers['Access-Control-Allow-Methods']).toBe('GET,POST,OPTIONS')
    expect(ping).not.toHaveBeenCalled()
  })

  it('toda resposta tem Cache-Control no-store', async () => {
    const cases: Req[] = [
      { method: 'OPTIONS', token: null },
      { method: 'GET', query: { action: 'ping' }, token: null },
      { method: 'GET', query: { action: 'ping' }, token: 'comum' },
      { method: 'GET', query: { action: 'nada' } },
      { method: 'GET', query: { action: 'echo' } },
      { method: 'GET', query: { action: 'ping' } },
      { method: 'POST', query: { action: 'echo' }, body: {} },
    ]
    for (const c of cases) {
      const res = await call(router, c)
      expect(res.headers['Cache-Control'], JSON.stringify(c)).toBe('no-store')
    }
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const broken = await call(failing(new Error('x')), { method: 'GET', query: { action: 'quebra' } })
    expect(broken.headers['Cache-Control']).toBe('no-store')
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', '')
    const noDb = await call(router, { method: 'GET', query: { action: 'ping' } })
    expect(noDb.headers['Cache-Control']).toBe('no-store')
  })

  it('admin chega na ação com o próprio id e e-mail, query só com texto e corpo só objeto', async () => {
    const get = await call(router, { method: 'GET', query: { action: 'ping', page: '2' } })
    expect(get.statusCode).toBe(200)
    // o nome da ação é do roteador e não chega na query da ação
    expect(get.body).toEqual({ pong: true, admin: { userId: ADMIN_ID, email: 'admin@igreja.com' }, query: { page: '2' } })
    const ctx = ping.mock.calls[0][0] as AdminCtx
    expect(ctx.db).toBe(db)
    expect(ctx.now).toBeInstanceOf(Date)

    const obj = await call(router, { method: 'POST', query: { action: 'echo' }, body: { note: 'conferido' } })
    expect(obj.body).toEqual({ body: { note: 'conferido' } })
    const text = await call(router, { method: 'POST', query: { action: 'echo' }, body: '{"note":"em texto"}' })
    expect(text.body).toEqual({ body: { note: 'em texto' } })
    for (const body of [[1, 2], 'nao e json', null, undefined, 42, '[1]']) {
      const res = await call(router, { method: 'POST', query: { action: 'echo' }, body })
      expect(res.body, JSON.stringify(body)).toEqual({ body: {} })
    }
  })

  it('mensagens de acesso saem em português', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const cases: [string | null, number, string][] = [
      [null, 401, 'Sessão inválida ou expirada. Entre de novo.'],
      ['vencido', 401, 'Sessão inválida ou expirada. Entre de novo.'],
      ['comum', 403, 'Esta conta não é admin.'],
      ['quase', 403, 'Esta conta não é admin.'],
      ['semconfig', 500, 'Configuração do servidor incompleta. Avise o suporte.'],
    ]
    for (const [token, status, error] of cases) {
      const res = await call(router, { method: 'GET', query: { action: 'ping' }, token })
      expect(res.statusCode, String(token)).toBe(status)
      expect(res.body, String(token)).toEqual({ error })
      expect(JSON.stringify(res.body)).not.toMatch(/Forbidden|Bearer|token|misconfigured/i)
      expect(JSON.stringify(res.body).includes(TRAVESSAO)).toBe(false)
    }
  })

  it('resposta ok do auth sem papel de admin não passa', async () => {
    const res = await call(router, { method: 'GET', query: { action: 'ping' }, token: 'quase' })
    expect(res.statusCode).toBe(403)
    expect(ping).not.toHaveBeenCalled()
  })

  it('verifyAdmin que lança vira 500 genérico e não roda a ação', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = await call(router, { method: 'GET', query: { action: 'ping' }, token: 'explode' })
    expect(res.statusCode).toBe(500)
    expect(res.body).toEqual({ error: 'Erro inesperado no servidor.' })
    expect(ping).not.toHaveBeenCalled()
    expect(log.mock.calls.flat().join(' ')).toContain('ENOTFOUND')
  })

  it('PUT e DELETE numa ação respondem 405', async () => {
    for (const method of ['PUT', 'DELETE', 'PATCH']) {
      const res = await call(router, { method, query: { action: 'ping' } })
      expect(res.statusCode, method).toBe(405)
      expect(res.body, method).toEqual({ error: 'Esta ação usa GET.' })
    }
    expect(ping).not.toHaveBeenCalled()
  })

  it('sem env do Supabase responde 500 com a frase e não roda a ação', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', '')
    const res = await call(router, { method: 'GET', query: { action: 'ping' } })
    expect(res.statusCode).toBe(500)
    expect(res.body).toEqual({ error: 'Servidor sem configuração do banco.' })
    expect(ping).not.toHaveBeenCalled()
  })
})

describe('erros viram resposta em português', () => {
  it('BillingError vira o status e a mensagem dela', async () => {
    // só passa a frase dos códigos marcados como seguros (Ruling ADM-T3-permitidas)
    const msg = 'Sua conta não foi excluída: ainda estamos terminando de cancelar sua assinatura no sistema de pagamento. Tente de novo em alguns minutos.'
    const res = await call(failing(new BillingError('pending_stop', msg, 409)), { method: 'GET', query: { action: 'quebra' } })
    expect(res.statusCode).toBe(409)
    expect(res.body).toEqual({ error: msg })
  })

  it('BillingError do Asaas vira o status dela e a frase genérica com o status do Asaas', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = await call(failing(new BillingError('asaas_unavailable', 'O Asaas não respondeu.', 502)), { method: 'GET', query: { action: 'quebra' } })
    expect(res.statusCode).toBe(502)
    expect(res.body).toEqual({ error: 'O Asaas não respondeu. Status do Asaas: sem dado.' })
  })

  it('frase técnica desconhecida sai mascarada na resposta e chega crua ao log', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    const strange = new BillingError('asaas_unavailable', 'Asaas sem resposta em 4000 ms (borda pbs-7, fila 12)', 502)
    const res = await call(failing(strange), { method: 'GET', query: { action: 'quebra' } })
    expect(res.statusCode).toBe(502)
    expect(res.body).toEqual({ error: 'O Asaas não respondeu. Status do Asaas: sem dado.' })
    expect(JSON.stringify(res.body)).not.toContain('pbs-7')
    expect(log.mock.calls.flat().join(' ')).toContain('Asaas sem resposta em 4000 ms (borda pbs-7, fila 12)')
    // código que a lista não conhece também não passa a frase
    const unknown = new BillingError('codigo_novo' as never, 'TypeError at Object.<anonymous> (billing.ts:999)', 418)
    const other = await call(failing(unknown), { method: 'GET', query: { action: 'quebra' } })
    expect(other.statusCode).toBe(500)
    expect(other.body).toEqual({ error: 'Erro inesperado no servidor.' })
  })

  it('AdminError(409) vira 409', async () => {
    const res = await call(failing(new AdminError(409, 'Esta pendência já foi fechada.')), { method: 'GET', query: { action: 'quebra' } })
    expect(res.statusCode).toBe(409)
    expect(res.body).toEqual({ error: 'Esta pendência já foi fechada.' })
  })

  it('erro qualquer vira 500 sem vazar a mensagem', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = await call(failing(new Error('connect ECONNREFUSED 10.0.0.7:5432')), { method: 'GET', query: { action: 'quebra' } })
    expect(res.statusCode).toBe(500)
    expect(res.body).toEqual({ error: 'Erro inesperado no servidor.' })
    // a mensagem original só vai pro log
    expect(log.mock.calls.flat().join(' ')).toContain('ECONNREFUSED')
  })

  it('BillingError db_error vira 500 sem a mensagem do banco', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = await call(failing(new BillingError('db_error', 'Falha no banco (x): y', 500)), { method: 'GET', query: { action: 'quebra' } })
    expect(res.statusCode).toBe(500)
    expect(res.body).toEqual({ error: 'Erro inesperado no servidor.' })
  })

  it('BillingError misconfigured vira a frase genérica sem nome de variável', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = await call(failing(new BillingError('misconfigured', 'Troca de plano indisponível (servidor sem ASAAS_API_KEY).', 500)), { method: 'GET', query: { action: 'quebra' } })
    expect(res.statusCode).toBe(500)
    expect(res.body).toEqual({ error: 'Configuração do servidor incompleta. Avise o suporte.' })
    expect(JSON.stringify(res.body)).not.toContain('ASAAS_API_KEY')
    // o detalhe técnico vai só pro log
    expect(log.mock.calls.flat().join(' ')).toContain('ASAAS_API_KEY')
  })

  it('texto técnico do cliente do Asaas não sai na resposta', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const cases: [BillingError, string][] = [
      [new BillingError('asaas_rejected', 'O Asaas não trocou o plano: Asaas recusou (400): O valor informado é inválido. Nada mudou.', 502), 'O Asaas recusou o pedido. Status do Asaas: 400.'],
      [new BillingError('asaas_unavailable', 'O Asaas não trocou o plano: Asaas respondeu 503. Nada mudou.', 502), 'O Asaas não respondeu. Status do Asaas: 503.'],
      [new BillingError('asaas_unavailable', 'O Asaas não trocou o plano: Asaas sem resposta (ECONNABORTED). Nada mudou.', 502), 'O Asaas não respondeu. Status do Asaas: sem dado.'],
      [new BillingError('asaas_unavailable', 'O Asaas não trocou o plano: não encontrado no Asaas. Nada mudou.', 502), 'O Asaas não achou o que foi pedido. Status do Asaas: 404.'],
    ]
    for (const [err, phrase] of cases) {
      const res = await call(failing(err), { method: 'GET', query: { action: 'quebra' } })
      expect(res.statusCode, err.message).toBe(502)
      expect(res.body, err.message).toEqual({ error: phrase })
    }
  })

  it('toHttpError: AdminError usa status, BillingError usa httpStatus, o resto vira 500', () => {
    expect(toHttpError(new AdminError(404, 'Conta não encontrada.'))).toEqual({ status: 404, error: 'Conta não encontrada.' })
    expect(toHttpError(new BillingError('partial', 'Parte foi feita.', 207))).toEqual({ status: 207, error: 'Parte foi feita.' })
    expect(toHttpError(new BillingError('db_error', 'Falha no banco (x): y', 500))).toEqual({ status: 500, error: 'Erro inesperado no servidor.' })
    expect(toHttpError(new BillingError('misconfigured', 'O cancelamento está indisponível agora.', 500))).toEqual({ status: 500, error: 'Configuração do servidor incompleta. Avise o suporte.' })
    expect(toHttpError('texto solto')).toEqual({ status: 500, error: 'Erro inesperado no servidor.' })
  })
})

describe('painel antigo (?source=) até a T28', () => {
  async function adminStats(req: Req) {
    const { default: handler } = await import('../admin-stats.js')
    return call(handler, req)
  }

  it('?source=asaas continua chamando o painel antigo', async () => {
    const res = await adminStats({ method: 'GET', query: { source: 'asaas' } })
    expect(res.statusCode).toBe(200)
    expect(res.body).toEqual({ painel: 'antigo' })
    expect(res.headers['Cache-Control']).toBe('no-store')
    expect(legacyStats).toHaveBeenCalledTimes(1)
    const [req] = vi.mocked(legacyStats).mock.calls[0] as [{ query: Record<string, unknown> }, unknown]
    expect(req.query.source).toBe('asaas')
  })

  it('usuário comum com ?source=asaas responde 403 sem abrir o painel antigo', async () => {
    const res = await adminStats({ method: 'GET', query: { source: 'asaas' }, token: 'comum' })
    expect(res.statusCode).toBe(403)
    expect(res.body).toEqual({ error: 'Esta conta não é admin.' })
    expect(legacyStats).not.toHaveBeenCalled()
  })

  it('o painel antigo só vale em GET', async () => {
    const res = await adminStats({ method: 'POST', query: { source: 'asaas' } })
    expect(res.statusCode).toBe(400)
    expect(legacyStats).not.toHaveBeenCalled()
  })

  it('roteador montado sem o painel antigo trata ?source= como ação desconhecida', async () => {
    const res = await call(router, { method: 'GET', query: { source: 'asaas' } })
    expect(res.statusCode).toBe(400)
    expect(legacyStats).not.toHaveBeenCalled()
  })
})

describe('campo a mais é recusado (ADM-T3-estrito)', () => {
  it('a validação recusa um campo extra', () => {
    expect(() => onlyKeys({ userId: ADMIN_ID, planKey: 'pro_mensal' }, ['userId', 'planKey'])).not.toThrow()
    let err: unknown
    try { onlyKeys({ userId: ADMIN_ID, planKey: 'pro_mensal', p_admin: ADMIN_ID }, ['userId', 'planKey']) } catch (e) { err = e }
    expect(err).toBeInstanceOf(AdminError)
    expect(err).toMatchObject({ status: 400, message: 'Campo não esperado: p_admin.' })
    expect(() => onlyKeys({ a: 1, b: 2 }, [])).toThrow('Campos não esperados: a, b.')
  })

  it('POST com campo a mais no corpo responde 400 e não roda a ação', async () => {
    const res = await call(router, { method: 'POST', query: { action: 'echo' }, body: { note: 'conferido', p_admin: ADMIN_ID } })
    expect(res.statusCode).toBe(400)
    expect(res.body).toEqual({ error: 'Campo não esperado: p_admin.' })
    expect(echo).not.toHaveBeenCalled()
  })

  it('POST com campo na query também responde 400', async () => {
    const res = await call(router, { method: 'POST', query: { action: 'echo', note: 'pela query' }, body: { note: 'conferido' } })
    expect(res.statusCode).toBe(400)
    expect(res.body).toEqual({ error: 'Campo não esperado: note.' })
    expect(echo).not.toHaveBeenCalled()
  })

  it('GET com campo a mais na query, ou com corpo, responde 400', async () => {
    const extra = await call(router, { method: 'GET', query: { action: 'ping', page: '1', userId: ADMIN_ID } })
    expect(extra.statusCode).toBe(400)
    expect(extra.body).toEqual({ error: 'Campo não esperado: userId.' })
    const withBody = await call(router, { method: 'GET', query: { action: 'ping' }, body: { page: '1' } })
    expect(withBody.statusCode).toBe(400)
    expect(withBody.body).toEqual({ error: 'Campo não esperado: page.' })
    expect(ping).not.toHaveBeenCalled()
  })

  it('campo repetido na query responde 400', async () => {
    const res = await call(router, { method: 'GET', query: { action: 'ping', page: ['1', '2'] } })
    expect(res.statusCode).toBe(400)
    expect(res.body).toEqual({ error: 'Campo repetido: page.' })
    expect(ping).not.toHaveBeenCalled()
  })

  it('nenhum módulo do admin espalha ctx.body ou ctx.query', () => {
    const dir = fileURLToPath(new URL('../_lib/admin/', import.meta.url))
    const spread = /\.\.\.\s*ctx\.(body|query)\b|Object\.assign\([^)]*ctx\.(body|query)/
    for (const file of readdirSync(dir).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))) {
      expect(spread.test(readFileSync(join(dir, file), 'utf8')), file).toBe(false)
    }
  })
})

describe('validadores', () => {
  const fails = (fn: () => unknown) => {
    try { fn() } catch (e) { return e }
    throw new Error('não lançou')
  }

  it('str recusa nota curta com a mensagem certa', () => {
    const err = fails(() => str({ note: 'ok' }, 'note', { label: 'a nota', min: 3 }))
    expect(err).toBeInstanceOf(AdminError)
    expect(err).toMatchObject({ status: 400, message: 'A nota precisa ter pelo menos 3 caracteres.' })
  })

  it('day recusa 2026-02-30', () => {
    expect(fails(() => day({ d: '2026-02-30' }, 'd', { label: 'a data' }))).toMatchObject({ status: 400, message: 'A data está em formato inválido.' })
  })

  it('str: vazio pede pra preencher, longo e fora do formato recusam, opcional ausente vira null', () => {
    expect(str({ note: '  conferido  ' }, 'note', { label: 'a nota', min: 3 })).toBe('conferido')
    expect(fails(() => str({}, 'note', { label: 'a nota' }))).toMatchObject({ status: 400, message: 'Preencha a nota.' })
    expect(fails(() => str({ note: '   ' }, 'note', { label: 'a nota' }))).toMatchObject({ message: 'Preencha a nota.' })
    expect(fails(() => str({ note: 'abcdef' }, 'note', { label: 'a nota', max: 5 }))).toMatchObject({ message: 'A nota pode ter no máximo 5 caracteres.' })
    expect(fails(() => str({ id: 'sub_1' }, 'id', { label: 'o id da cobrança', pattern: /^pay_[A-Za-z0-9]+$/ }))).toMatchObject({ message: 'O id da cobrança está em formato inválido.' })
    expect(fails(() => str({ note: 12 }, 'note', { label: 'a nota' }))).toMatchObject({ message: 'A nota está em formato inválido.' })
    expect(str({}, 'note', { label: 'a nota', optional: true })).toBeNull()
    // conta caractere, não unidade de código (emoji conta 1)
    expect(str({ note: 'oi🙂' }, 'note', { label: 'a nota', max: 3 })).toBe('oi🙂')
  })

  it('int aceita número do corpo e texto da query, e recusa fora da faixa ou quebrado', () => {
    const range = 'A quantidade precisa ser um número de 1 a 500.'
    expect(int({ amount: 10 }, 'amount', { label: 'a quantidade', min: 1, max: 500 })).toBe(10)
    expect(int({ page: '3' }, 'page', { label: 'a página', min: 1, max: 1000 })).toBe(3)
    for (const amount of [0, 501, 1.5, '1.5', 'dez', true, '']) {
      expect(fails(() => int({ amount }, 'amount', { label: 'a quantidade', min: 1, max: 500 })), String(amount)).toMatchObject({ status: 400, message: range })
    }
    expect(int({}, 'page', { label: 'a página', min: 1, max: 1000, fallback: 1 })).toBe(1)
    expect(int({ days: null }, 'days', { label: 'os dias', min: 1, max: 365, optional: true })).toBeNull()
  })

  it('uuid e oneOf', () => {
    expect(uuid({ userId: ADMIN_ID.toUpperCase() }, 'userId', 'a conta')).toBe(ADMIN_ID)
    expect(fails(() => uuid({ userId: 'nao-e-uuid' }, 'userId', 'a conta'))).toMatchObject({ status: 400, message: 'A conta está em formato inválido.' })
    expect(fails(() => uuid({}, 'userId', 'a conta'))).toMatchObject({ message: 'Preencha a conta.' })
    expect(oneOf({ when: 'now' }, 'when', ['now', 'period_end'] as const, { label: 'quando' })).toBe('now')
    expect(oneOf({}, 'mode', ['reset', 'add'] as const, { label: 'o modo', fallback: 'reset' })).toBe('reset')
    expect(fails(() => oneOf({ when: 'ontem' }, 'when', ['now', 'period_end'] as const, { label: 'quando' }))).toMatchObject({ status: 400, message: 'Quando está em formato inválido.' })
    expect(fails(() => oneOf({}, 'when', ['now', 'period_end'] as const, { label: 'quando' }))).toMatchObject({ message: 'Preencha quando.' })
  })

  it('day aceita data real e opcional ausente', () => {
    expect(day({ from: '2026-02-28' }, 'from', { label: 'o início' })).toBe('2026-02-28')
    expect(day({ from: '2028-02-29' }, 'from', { label: 'o início' })).toBe('2028-02-29')
    expect(day({}, 'from', { label: 'o início', optional: true })).toBeNull()
    for (const from of ['2026-13-01', '2026-11-31', '26-11-16', '2026-11-16T00:00:00Z', 20261116]) {
      expect(fails(() => day({ from }, 'from', { label: 'o início' })), String(from)).toMatchObject({ status: 400, message: 'O início está em formato inválido.' })
    }
    expect(fails(() => day({}, 'from', { label: 'o início' }))).toMatchObject({ message: 'Preencha o início.' })
  })

  it('validador não lê o que vem do protótipo do objeto', () => {
    expect(str({}, 'constructor', { label: 'o campo', optional: true })).toBeNull()
  })
})

describe('mergeHandlers', () => {
  const run = async () => null

  it('mergeHandlers recusa ação repetida', () => {
    const a: AdminHandlers = { review: { method: 'GET', fields: [], run } }
    const b: AdminHandlers = { review: { method: 'POST', fields: [], run } }
    expect(() => mergeHandlers(a, b)).toThrow('Ação repetida no admin: review')
  })

  it('mergeHandlers junta os módulos', () => {
    const merged = mergeHandlers({ review: { method: 'GET', fields: [], run } }, {}, { block: { method: 'POST', fields: ['userId', 'reason'], run } })
    expect(Object.keys(merged).sort()).toEqual(['block', 'review'])
  })
})

describe('arquivos do roteador', () => {
  it('os códigos marcados como seguros só levam frase escrita no servidor', () => {
    // A lista do que pode passar (not_found, pending_stop, partial) vale porque
    // a Fase 3 escreve essas frases à mão. Se alguém passar a montar uma delas
    // com a mensagem de um erro (do Asaas, do banco), este teste avisa.
    const src = readFileSync(new URL('../_lib/billing.ts', import.meta.url), 'utf8')
    const found: Record<string, number> = {}
    for (const m of src.matchAll(/new BillingError\('(not_found|pending_stop|partial)',([\s\S]*?),\s*\d{3}\)/g)) {
      found[m[1]] = (found[m[1]] ?? 0) + 1
      expect(m[2], m[0]).not.toMatch(/\.message|\$\{\s*(e|err|error)\b/)
    }
    expect(Object.keys(found).sort()).toEqual(['not_found', 'partial', 'pending_stop'])
  })

  it('nenhum arquivo do roteador tem travessão', () => {
    const root = fileURLToPath(new URL('..', import.meta.url))
    const dir = join(root, '_lib', 'admin')
    const files = [join(root, 'admin-stats.ts'), ...readdirSync(dir).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts')).map((f) => join(dir, f))]
    expect(files.length).toBeGreaterThanOrEqual(12)
    for (const file of files) expect(readFileSync(file, 'utf8').includes(TRAVESSAO), file).toBe(false)
  })
})

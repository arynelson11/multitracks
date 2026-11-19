import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createFakeDb, createRes, type DbError, type DbResult, type FakeDb, type Row } from './fakeSupabase.js'
import { DEMUCS_VERSION } from '../_lib/aiCost.js'

// Cota mensal: o contador volta a zero no dia 1º (horário de Brasília) e a
// virada acontece dentro do próprio RPC de consumo, num UPDATE só. Aqui o
// Supabase é falso: o RPC falso segue a mesma regra do SQL
// (db/supabase_cota_mensal.sql) e cada chamada é atômica, como a linha travada
// no Postgres. O que o teste garante é que o endpoint NÃO faz ler-somar-gravar
// por conta própria (isso perderia uma separação quando duas chegam juntas).

const USER = '11111111-1111-4111-8111-111111111111'
const TRAVESSAO = String.fromCharCode(0x2014)
let db: FakeDb
const createPrediction = vi.fn()

vi.mock('@supabase/supabase-js', () => ({ createClient: () => db }))
// O endpoint usa verifyActiveUser (conta bloqueada não separa); a trava em si
// é testada com a auth de verdade em blocked-access.test.ts.
vi.mock('../_lib/auth.js', () => {
  const ok = async () => ({ ok: true, userId: USER, email: 'musico@igreja.com', isAdmin: false, blocked: false })
  return { verifyUser: vi.fn(ok), verifyActiveUser: vi.fn(ok) }
})
vi.mock('replicate', () => ({
  default: class { predictions = { create: createPrediction } },
}))

// Início do mês civil em Brasília (UTC-3, sem horário de verão desde 2019).
function periodStart(at: Date): string {
  const brt = new Date(at.getTime() - 3 * 3600_000)
  return new Date(Date.UTC(brt.getUTCFullYear(), brt.getUTCMonth(), 1, 3)).toISOString()
}

// Espelho da regra do SQL: zera se o período venceu, senão soma se couber.
function consume(row: Row, limit: number): boolean {
  const current = periodStart(new Date())
  const stored = row.tokens_period_start as string | null
  const expired = !stored || stored < current
  const used = Number(row.tokens_used ?? 0)
  if (limit <= 0 || (!expired && used >= limit)) return false
  row.tokens_used = expired ? 1 : used + 1
  row.tokens_period_start = expired ? current : stored
  return true
}

function setup(profile: Row) {
  db = createFakeDb({
    tables: { profiles: [profile], predictions: [] },
    // a chave de predictions é o id do Replicate (db/supabase_predictions.sql)
    primaryKeys: { predictions: 'replicate_id' },
    rpc: {
      consume_separation_token: async (args) => {
        // devolve o controle ao event loop antes de aplicar: as duas
        // requisições chegam "ao mesmo tempo" no banco
        await Promise.resolve()
        const row = db.tables.profiles.find((r) => r.id === args.p_user_id)
        return row ? consume(row, Number(args.p_limit)) : false
      },
      refund_separation_token: (args) => {
        const row = db.tables.profiles.find((r) => r.id === args.p_user_id)
        if (row) row.tokens_used = Math.max(Number(row.tokens_used ?? 0) - 1, 0)
        return null
      },
    },
  })
}

const AUDIO = 'https://r2.exemplo.com/temp/musica.mp3'

async function post(body: Record<string, unknown>) {
  const { default: handler } = await import('../separate-audio.js')
  const res = createRes()
  const req = { method: 'POST', headers: { authorization: 'Bearer x' }, body }
  await handler(req as unknown as VercelRequest, res as unknown as VercelResponse)
  return res
}

async function separate(stemCount: unknown = 2) {
  return post({ audioUrl: AUDIO, stemCount })
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.stubEnv('VITE_SUPABASE_URL', 'https://fake.supabase.co')
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'fake-service-role')
  vi.stubEnv('REPLICATE_API_TOKEN', 'fake-replicate')
  vi.stubEnv('VITE_R2_PUBLIC_URL', 'https://r2.exemplo.com')
  createPrediction.mockReset()
  let n = 0
  createPrediction.mockImplementation(async () => ({ id: `pred_${++n}`, status: 'starting' }))
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
})

describe('separate-audio: cota mensal', () => {
  it('duas separações ao mesmo tempo na virada do mês: as duas passam e o contador fica em 2', async () => {
    // Livre que gastou as 3 de outubro; 1º de novembro, 00:00:05 em Brasília
    vi.setSystemTime(new Date('2026-11-01T03:00:05Z'))
    setup({ id: USER, plan: 'free', tokens_used: 3, tokens_period_start: '2026-10-01T03:00:00.000Z' })

    const [a, b] = await Promise.all([separate(), separate()])

    expect([a.statusCode, b.statusCode]).toEqual([200, 200])
    const row = db.tables.profiles[0]
    expect(row.tokens_used).toBe(2)
    expect(row.tokens_period_start).toBe('2026-11-01T03:00:00.000Z')
    // o contador só muda pelo RPC atômico, nunca por update direto do endpoint
    expect(db.writes.filter((w) => w.table === 'profiles')).toEqual([])
    expect(db.rpcCalls.filter((c) => c.name === 'consume_separation_token')).toHaveLength(2)
  })

  it('no mesmo mês, com 2 de 3 usadas e duas ao mesmo tempo, só uma passa', async () => {
    vi.setSystemTime(new Date('2026-11-20T15:00:00Z'))
    setup({ id: USER, plan: 'free', tokens_used: 2, tokens_period_start: '2026-11-01T03:00:00.000Z' })

    const results = await Promise.all([separate(), separate()])
    const codes = results.map((r) => r.statusCode).sort()

    expect(codes).toEqual([200, 402])
    expect(db.tables.profiles[0].tokens_used).toBe(3)
    const blocked = results.find((r) => r.statusCode === 402)!
    const msg = (blocked.body as { error: string }).error
    expect(msg).toContain('3 separações')
    expect(msg).toContain('dia 1º')
    expect(msg).not.toContain(TRAVESSAO)
  })

  it('plano cancelado que já passou da data conta como Livre (limite 3)', async () => {
    vi.setSystemTime(new Date('2026-12-20T15:00:00Z'))
    setup({ id: USER, plan: 'essencial_mensal', plan_expires_at: '2026-12-17T03:00:00Z', tokens_used: 3, tokens_period_start: '2026-12-01T03:00:00.000Z' })

    const res = await separate()

    expect(res.statusCode).toBe(402)
    expect(db.rpcCalls[0]).toMatchObject({ name: 'consume_separation_token', args: { p_limit: 3 } })
  })

  it('plano cancelado ainda dentro da data mantém o limite pago (50)', async () => {
    vi.setSystemTime(new Date('2026-12-10T15:00:00Z'))
    setup({ id: USER, plan: 'essencial_mensal', plan_expires_at: '2026-12-17T03:00:00Z', tokens_used: 5, tokens_period_start: '2026-12-01T03:00:00.000Z' })

    const res = await separate()

    expect(res.statusCode).toBe(200)
    expect(db.rpcCalls[0]).toMatchObject({ name: 'consume_separation_token', args: { p_limit: 50 } })
  })

  it('o serviço de separação fora do ar devolve a separação gasta', async () => {
    vi.setSystemTime(new Date('2026-11-20T15:00:00Z'))
    setup({ id: USER, plan: 'free', tokens_used: 1, tokens_period_start: '2026-11-01T03:00:00.000Z' })
    createPrediction.mockRejectedValueOnce(new Error('replicate down'))

    const res = await separate()

    expect(res.statusCode).toBe(502)
    expect(db.tables.profiles[0].tokens_used).toBe(1)
    expect(db.rpcCalls.map((c) => c.name)).toEqual(['consume_separation_token', 'refund_separation_token'])
  })
})

// Cota extra do mês (admin "Somar N"): fica no perfil (quota_bonus e
// quota_bonus_period) e só vale no mês de Brasília em que foi dada.
describe('separate-audio: cota extra do mês', () => {
  const NOV = '2026-11-01T03:00:00Z'

  it('cota extra do mês soma no limite: Livre com 10 extras separa até 13', async () => {
    vi.setSystemTime(new Date('2026-11-16T15:00:00Z'))
    setup({ id: USER, plan: 'free', tokens_used: 12, tokens_period_start: '2026-11-01T03:00:00.000Z', quota_bonus: 10, quota_bonus_period: NOV })

    const ok = await separate()
    const over = await separate()

    expect(ok.statusCode).toBe(200)
    expect(db.rpcCalls[0]).toMatchObject({ name: 'consume_separation_token', args: { p_limit: 13 } })
    expect(over.statusCode).toBe(402)
    expect(over.body).toMatchObject({ plan: 'free', limit: 13 })
    const msg = (over.body as { error: string }).error
    expect(msg).toContain('13 separações')
    expect(msg).not.toContain(TRAVESSAO)
    expect(db.tables.profiles[0].tokens_used).toBe(13)
  })

  it('cota extra dada em outubro não vale em novembro: limite 3', async () => {
    vi.setSystemTime(new Date('2026-11-16T15:00:00Z'))
    setup({ id: USER, plan: 'free', tokens_used: 3, tokens_period_start: '2026-11-01T03:00:00.000Z', quota_bonus: 10, quota_bonus_period: '2026-10-01T03:00:00Z' })

    const res = await separate()

    expect(res.statusCode).toBe(402)
    expect(db.rpcCalls[0]).toMatchObject({ name: 'consume_separation_token', args: { p_limit: 3 } })
    expect((res.body as { error: string }).error).toContain('3 separações')
  })

  it('cota extra soma também no plano pago (50 + 20)', async () => {
    vi.setSystemTime(new Date('2026-11-16T15:00:00Z'))
    setup({ id: USER, plan: 'essencial_mensal', plan_expires_at: null, tokens_used: 3, tokens_period_start: '2026-11-01T03:00:00.000Z', quota_bonus: 20, quota_bonus_period: NOV })

    expect((await separate()).statusCode).toBe(200)
    expect(db.rpcCalls[0]).toMatchObject({ name: 'consume_separation_token', args: { p_limit: 70 } })
  })

  it('leitura da cota extra falhou: separa normalmente com o limite do plano e avisa no log', async () => {
    vi.setSystemTime(new Date('2026-11-16T15:00:00Z'))
    setup({ id: USER, plan: 'free', tokens_used: 1, tokens_period_start: '2026-11-01T03:00:00.000Z', quota_bonus: 10, quota_bonus_period: NOV })
    // só a leitura da cota extra falha; o plano continua lendo
    const from = db.from.bind(db)
    db.from = (table: string) => {
      const q = from(table)
      const select = q.select.bind(q)
      q.select = ((cols?: string) => (cols?.includes('quota_bonus')
        ? { eq: () => ({ maybeSingle: async () => ({ data: null, error: { message: 'canceling statement due to statement timeout', code: '57014' } }) }) }
        : select(cols))) as typeof q.select
      return q
    }
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const res = await separate()

    expect(res.statusCode).toBe(200)
    expect(db.rpcCalls[0]).toMatchObject({ name: 'consume_separation_token', args: { p_limit: 3 } })
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls.flat().map(String).join(' ')).not.toContain(USER)
    warn.mockRestore()
  })
})

// Livre como amostra (Parte 3, D2): 3 separações por mês, em 4 ou 6 faixas no
// app novo. O servidor não força mais 2 faixas e ainda aceita 2, pra o app de
// computador antigo seguir separando com a cota nova.
describe('separate-audio: Livre em 4 ou 6 faixas', () => {
  const NOV = '2026-11-01T03:00:00.000Z'
  const input = (call = 0) => (createPrediction.mock.calls[call][0] as { input: Record<string, unknown> }).input

  it('Livre separa em 4 faixas com htdemucs e conta 1', async () => {
    vi.setSystemTime(new Date('2026-11-16T15:00:00Z'))
    setup({ id: USER, plan: 'free', tokens_used: 0, tokens_period_start: NOV })

    const res = await separate(4)

    expect(res.statusCode).toBe(200)
    expect(input().model_name).toBe('htdemucs')
    expect(input()).not.toHaveProperty('two_stems')
    expect(db.tables.profiles[0].tokens_used).toBe(1)
    expect(db.rpcCalls[0]).toMatchObject({ name: 'consume_separation_token', args: { p_limit: 3 } })
    expect(db.tables.predictions[0]).toMatchObject({ user_id: USER, model: 'htdemucs', stem_count: 4 })
  })

  it('Livre separa em 6 faixas com htdemucs_6s', async () => {
    vi.setSystemTime(new Date('2026-11-16T15:00:00Z'))
    setup({ id: USER, plan: 'free', tokens_used: 0, tokens_period_start: NOV })

    const res = await separate(6)

    expect(res.statusCode).toBe(200)
    expect(res.body).toMatchObject({ success: true, model_name: 'htdemucs_6s' })
    expect(input().model_name).toBe('htdemucs_6s')
    expect(input()).not.toHaveProperty('two_stems')
    expect(db.tables.profiles[0].tokens_used).toBe(1)
    expect(db.tables.predictions[0]).toMatchObject({ model: 'htdemucs_6s', stem_count: 6 })
  })

  it('Livre no app antigo pedindo 2 faixas ainda separa', async () => {
    vi.setSystemTime(new Date('2026-11-16T15:00:00Z'))
    setup({ id: USER, plan: 'free', tokens_used: 0, tokens_period_start: NOV })

    const res = await separate(2)

    expect(res.statusCode).toBe(200)
    expect(input().model_name).toBe('htdemucs')
    expect(input().two_stems).toBe('vocals')
    // a cota é a nova, mesmo no app antigo
    expect(db.rpcCalls[0]).toMatchObject({ name: 'consume_separation_token', args: { p_limit: 3 } })
    expect(db.tables.profiles[0].tokens_used).toBe(1)
  })

  it('a 4ª separação do Livre no mês recebe 402 com limit 3', async () => {
    vi.setSystemTime(new Date('2026-11-16T15:00:00Z'))
    setup({ id: USER, plan: 'free', tokens_used: 0, tokens_period_start: NOV })

    const first = [await separate(4), await separate(6), await separate(4)]
    const res = await separate(4)

    expect(first.map((r) => r.statusCode)).toEqual([200, 200, 200])
    expect(res.statusCode).toBe(402)
    expect(res.body).toMatchObject({ plan: 'free', limit: 3 })
    const msg = (res.body as { error: string }).error
    expect(msg).toContain('3 separações')
    expect(msg).not.toContain(TRAVESSAO)
    // a recusada não chega no serviço de separação nem gasta
    expect(createPrediction).toHaveBeenCalledTimes(3)
    expect(db.tables.profiles[0].tokens_used).toBe(3)
  })

  it('Livre com cota extra 2 do admin vai até 5', async () => {
    vi.setSystemTime(new Date('2026-11-16T15:00:00Z'))
    setup({ id: USER, plan: 'free', tokens_used: 3, tokens_period_start: NOV, quota_bonus: 2, quota_bonus_period: NOV })

    const extra = [await separate(4), await separate(6)]
    const over = await separate(4)

    expect(extra.map((r) => r.statusCode)).toEqual([200, 200])
    expect(db.rpcCalls[0]).toMatchObject({ name: 'consume_separation_token', args: { p_limit: 5 } })
    expect(over.statusCode).toBe(402)
    expect(over.body).toMatchObject({ plan: 'free', limit: 5 })
    expect((over.body as { error: string }).error).toContain('5 separações')
    expect(db.tables.profiles[0].tokens_used).toBe(5)
  })

  // Sem a trava antiga do Livre, a lista 2, 4 e 6 é a única guarda das faixas:
  // fora dela a resposta é 400 antes da cota (não gasta nem chega no Replicate).
  it.each([3, 8, 1, 0, '4', null, { n: 4 }] as const)('stemCount %j fora de 2, 4 e 6 dá 400 sem gastar a cota', async (stems) => {
    vi.setSystemTime(new Date('2026-11-16T15:00:00Z'))
    setup({ id: USER, plan: 'free', tokens_used: 0, tokens_period_start: NOV })

    const res = await separate(stems)

    expect(res.statusCode).toBe(400)
    expect(db.rpcCalls).toEqual([])
    expect(createPrediction).not.toHaveBeenCalled()
    expect(db.tables.profiles[0].tokens_used).toBe(0)
    expect(db.tables.predictions).toEqual([])
  })

  it('sem stemCount no pedido separa em 4 faixas, como antes', async () => {
    vi.setSystemTime(new Date('2026-11-16T15:00:00Z'))
    setup({ id: USER, plan: 'free', tokens_used: 0, tokens_period_start: NOV })

    const res = await post({ audioUrl: AUDIO })

    expect(res.statusCode).toBe(200)
    expect(input().model_name).toBe('htdemucs')
    expect(input()).not.toHaveProperty('two_stems')
    expect(db.tables.profiles[0].tokens_used).toBe(1)
  })

  // Plano gravado com nome de chave do protótipo cai no limite do Livre
  // (como a ficha do admin em api/_lib/admin/subscribers.ts), em vez de
  // mandar um limite que não é número pro banco e responder 500.
  it.each(['constructor', '__proto__', 'toString', 'plano_que_nao_existe'])('plano gravado como %s usa o limite do Livre', async (plan) => {
    vi.setSystemTime(new Date('2026-11-16T15:00:00Z'))
    setup({ id: USER, plan, plan_expires_at: null, tokens_used: 0, tokens_period_start: NOV })

    const res = await separate(4)

    expect(res.statusCode).toBe(200)
    expect(db.rpcCalls[0]).toEqual({ name: 'consume_separation_token', args: { p_user_id: USER, p_limit: 3 } })
  })
})

// Trabalho gravado ao começar (T23): modelo do demucs, versão, faixas e status,
// pro custo de IA. A gravação nunca muda a resposta da separação.
describe('separate-audio: grava o trabalho ao começar', () => {
  // Conta os inserts em predictions e, se `fail` disser, devolve erro no lugar do insert.
  function watchInserts(fail: (payload: Row) => DbError | null) {
    const inserts: Row[] = []
    const from = db.from.bind(db)
    db.from = (table: string) => {
      const q = from(table)
      if (table !== 'predictions') return q
      const insert = q.insert.bind(q)
      q.insert = ((payload: Row) => {
        inserts.push({ ...payload })
        const error = fail(payload)
        if (error) return { then: (ok: (v: DbResult) => unknown, bad: (e: unknown) => unknown) => Promise.resolve<DbResult>({ data: null, error }).then(ok, bad) }
        return insert(payload)
      }) as typeof q.insert
      return q
    }
    return inserts
  }

  it.each([
    [2, 'htdemucs'],
    [4, 'htdemucs'],
    [6, 'htdemucs_6s'],
  ] as const)('separar grava modelo, versão, faixas e status (%i faixas)', async (stems, model) => {
    vi.setSystemTime(new Date('2026-11-16T15:00:00Z'))
    setup({ id: USER, plan: 'pro_mensal', plan_expires_at: null, tokens_used: 0, tokens_period_start: '2026-11-01T03:00:00.000Z' })

    const res = await separate(stems)

    expect(res.statusCode).toBe(200)
    expect(res.body).toEqual({ success: true, prediction: { id: 'pred_1', status: 'starting' }, model_name: model })
    expect(createPrediction).toHaveBeenCalledWith(expect.objectContaining({ version: DEMUCS_VERSION }))
    expect(db.tables.predictions).toEqual([
      { replicate_id: 'pred_1', user_id: USER, model, version: DEMUCS_VERSION, stem_count: stems, status: 'starting' },
    ])
  })

  it.each(['42703', 'PGRST204'])('com a coluna ausente grava só o dono (%s)', async (code) => {
    vi.setSystemTime(new Date('2026-11-16T15:00:00Z'))
    setup({ id: USER, plan: 'free', tokens_used: 0, tokens_period_start: '2026-11-01T03:00:00.000Z' })
    // SQL do Corte B ainda não rodado: as colunas do custo de IA não existem
    const inserts = watchInserts((payload) => ('model' in payload ? { message: 'column "model" of relation "predictions" does not exist', code } : null))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})

    const res = await separate()

    expect(res.statusCode).toBe(200)
    expect(res.body).toEqual({ success: true, prediction: { id: 'pred_1', status: 'starting' }, model_name: 'htdemucs' })
    expect(inserts).toHaveLength(2)
    expect(db.tables.predictions).toEqual([{ replicate_id: 'pred_1', user_id: USER }])
    expect(error).not.toHaveBeenCalled()
    expect(warn.mock.calls.flat().map(String).join(' ')).not.toContain(USER)
    warn.mockRestore()
    error.mockRestore()
  })

  it('banco que falha na gravação não muda a resposta e não repete com outro erro', async () => {
    vi.setSystemTime(new Date('2026-11-16T15:00:00Z'))
    setup({ id: USER, plan: 'free', tokens_used: 0, tokens_period_start: '2026-11-01T03:00:00.000Z' })
    const inserts = watchInserts(() => ({ message: 'connection reset', code: '08006' }))
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})

    const res = await separate()

    expect(res.statusCode).toBe(200)
    expect(res.body).toEqual({ success: true, prediction: { id: 'pred_1', status: 'starting' }, model_name: 'htdemucs' })
    expect(inserts).toHaveLength(1)
    // a separação gasta continua gasta: o trabalho foi criado no Replicate
    expect(db.tables.profiles[0].tokens_used).toBe(1)
    expect(db.rpcCalls.map((c) => c.name)).toEqual(['consume_separation_token'])
    expect(error).toHaveBeenCalledTimes(1)
    expect(error.mock.calls.flat().map(String).join(' ')).not.toContain(USER)
    error.mockRestore()
  })
})

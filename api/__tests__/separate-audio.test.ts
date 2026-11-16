import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createFakeDb, createRes, type FakeDb, type Row } from './fakeSupabase.js'

// Cota mensal: o contador volta a zero no dia 1º (horário de Brasília) e a
// virada acontece dentro do próprio RPC de consumo, num UPDATE só. Aqui o
// Supabase é falso: o RPC falso segue a mesma regra do SQL
// (db/supabase_cota_mensal.sql) e cada chamada é atômica, como a linha travada
// no Postgres. O que o teste garante é que o endpoint NÃO faz ler-somar-gravar
// por conta própria (isso perderia uma separação quando duas chegam juntas).

const USER = '11111111-1111-4111-8111-111111111111'
let db: FakeDb
const createPrediction = vi.fn()

vi.mock('@supabase/supabase-js', () => ({ createClient: () => db }))
vi.mock('../_lib/auth.js', () => ({
  verifyUser: vi.fn(async () => ({ ok: true, userId: USER, email: 'musico@igreja.com', isAdmin: false })),
}))
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

async function separate() {
  const { default: handler } = await import('../separate-audio.js')
  const res = createRes()
  const req = {
    method: 'POST',
    headers: { authorization: 'Bearer x' },
    body: { audioUrl: 'https://r2.exemplo.com/temp/musica.mp3', stemCount: 2 },
  }
  await handler(req as unknown as VercelRequest, res as unknown as VercelResponse)
  return res
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
    // Livre que gastou as 5 de outubro; 1º de novembro, 00:00:05 em Brasília
    vi.setSystemTime(new Date('2026-11-01T03:00:05Z'))
    setup({ id: USER, plan: 'free', tokens_used: 5, tokens_period_start: '2026-10-01T03:00:00.000Z' })

    const [a, b] = await Promise.all([separate(), separate()])

    expect([a.statusCode, b.statusCode]).toEqual([200, 200])
    const row = db.tables.profiles[0]
    expect(row.tokens_used).toBe(2)
    expect(row.tokens_period_start).toBe('2026-11-01T03:00:00.000Z')
    // o contador só muda pelo RPC atômico, nunca por update direto do endpoint
    expect(db.writes.filter((w) => w.table === 'profiles')).toEqual([])
    expect(db.rpcCalls.filter((c) => c.name === 'consume_separation_token')).toHaveLength(2)
  })

  it('no mesmo mês, com 4 de 5 usadas e duas ao mesmo tempo, só uma passa', async () => {
    vi.setSystemTime(new Date('2026-11-20T15:00:00Z'))
    setup({ id: USER, plan: 'free', tokens_used: 4, tokens_period_start: '2026-11-01T03:00:00.000Z' })

    const results = await Promise.all([separate(), separate()])
    const codes = results.map((r) => r.statusCode).sort()

    expect(codes).toEqual([200, 402])
    expect(db.tables.profiles[0].tokens_used).toBe(5)
    const blocked = results.find((r) => r.statusCode === 402)!
    const msg = (blocked.body as { error: string }).error
    expect(msg).toContain('5 separações')
    expect(msg).toContain('dia 1º')
    expect(msg).not.toContain('—')
  })

  it('plano cancelado que já passou da data conta como Livre (limite 5)', async () => {
    vi.setSystemTime(new Date('2026-12-20T15:00:00Z'))
    setup({ id: USER, plan: 'essencial_mensal', plan_expires_at: '2026-12-17T03:00:00Z', tokens_used: 5, tokens_period_start: '2026-12-01T03:00:00.000Z' })

    const res = await separate()

    expect(res.statusCode).toBe(402)
    expect(db.rpcCalls[0]).toMatchObject({ name: 'consume_separation_token', args: { p_limit: 5 } })
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

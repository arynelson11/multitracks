import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeDb, createRes, type FakeDb, type FakeRes } from './fakeSupabase.js'
import { USER_A } from './billingHarness.js'
import { ADMIN_HANDLERS } from '../_lib/admin/registry.js'
import adminStats from '../admin-stats.js'

// Prova do antiobjetivo 2 do spec no registro real (Ruling ADM-ordem): toda
// ação de /api/admin-stats?action= responde 403 pra quem não é admin, sem rodar
// nada. Percorre o registro inteiro com o verifyAdmin de verdade: o login vem do
// token e o papel do perfil, lido com a chave de serviço. A lista abaixo é a
// exata do contrato (seção A do plano): ação nova no registro sem entrar aqui
// derruba o teste, e o mesmo vale pra uma que sair.

const OWNER = ['arynelson11', 'gmail.com'].join('@')
const OTHER = 'quem@igreja.com'
const ANON = 'fake-anon-key'
const SERVICE = 'fake-service-role'
const TOKEN = 'token-de-usuario-comum'
const ADMIN = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const ADMIN_TOKEN = 'token-de-admin'

// As 21 ações de /api/admin-stats?action=, com o método de cada uma (seção A;
// funnel entrou na Parte 3, T2).
const ACTIONS: Record<string, 'GET' | 'POST'> = {
  review: 'GET',
  'payment-link': 'GET',
  'resolve-flag': 'POST',
  'close-action': 'POST',
  'retry-action': 'POST',
  'retry-event': 'POST',
  audit: 'GET',
  finance: 'GET',
  overview: 'GET',
  'change-plan': 'POST',
  'grant-courtesy': 'POST',
  'end-courtesy': 'POST',
  'cancel-subscription': 'POST',
  block: 'POST',
  unblock: 'POST',
  'adjust-quota': 'POST',
  'ai-costs': 'GET',
  'ai-costs-sweep': 'POST',
  subscribers: 'GET',
  subscriber: 'GET',
  funnel: 'GET',
}

let db: FakeDb
let loginUser: { id: string; email: string }

vi.mock('@supabase/supabase-js', () => ({
  createClient: (_url: string, key: string) => {
    if (key === SERVICE) return db
    return {
      auth: {
        getUser: async (token: string) => (token === TOKEN
          ? { data: { user: loginUser }, error: null }
          : token === ADMIN_TOKEN
            ? { data: { user: { id: ADMIN, email: 'admin@igreja.com' } }, error: null }
            : { data: { user: null }, error: { message: 'invalid JWT' } }),
      },
    }
  },
}))

async function request(method: string, query: Record<string, string>, token: string | null): Promise<FakeRes> {
  const res = createRes()
  const body = method === 'POST' ? {} : undefined
  await adminStats({ method, query, headers: token ? { authorization: `Bearer ${token}` } : {}, body }, res)
  return res
}
const call = (method: string, action: string, token: string | null) => request(method, { action }, token)

const names = Object.keys(ADMIN_HANDLERS)

beforeEach(() => {
  vi.stubEnv('VITE_SUPABASE_URL', 'https://fake.supabase.co')
  vi.stubEnv('VITE_SUPABASE_ANON_KEY', ANON)
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', SERVICE)
  // sem chave do Asaas nem do Replicate: nem uma regressão que deixasse a ação rodar chegaria à rede
  vi.stubEnv('ASAAS_API_KEY', '')
  vi.stubEnv('REPLICATE_API_TOKEN', '')
  loginUser = { id: USER_A, email: OTHER }
  db = createFakeDb({
    tables: {
      profiles: [
        { id: USER_A, plan: 'free', is_admin: false, blocked_at: null },
        { id: ADMIN, plan: 'free', is_admin: true, blocked_at: null },
      ],
    },
  })
})
afterEach(() => {
  vi.unstubAllEnvs()
})

describe('registro das ações do admin', () => {
  it('o registro tem exatamente as 21 ações do contrato, cada uma com o método dela', () => {
    expect([...names].sort()).toEqual(Object.keys(ACTIONS).sort())
    expect(names).toHaveLength(21)
    for (const name of names) expect(ADMIN_HANDLERS[name].method, name).toBe(ACTIONS[name])
  })

  it('todas as ações registradas respondem 403 pra usuário comum', async () => {
    expect(names).toHaveLength(21)
    const runs = names.map((name) => vi.spyOn(ADMIN_HANDLERS[name], 'run'))
    // usuário comum, e a conta com o e-mail do dono mas is_admin falso no banco
    for (const email of [OTHER, OWNER]) {
      loginUser = { id: USER_A, email }
      for (const name of names) {
        const res = await call(ADMIN_HANDLERS[name].method, name, TOKEN)
        expect(res.statusCode, `${name} (${email === OWNER ? 'e-mail do dono' : 'comum'})`).toBe(403)
        expect(res.body, name).toEqual({ error: 'Esta conta não é admin.' })
        expect(res.headers['Cache-Control'], name).toBe('no-store')
      }
    }
    for (const run of runs) expect(run).not.toHaveBeenCalled()
    // só leu o próprio perfil: nenhuma função do banco, nenhuma escrita
    expect(db.rpcCalls).toEqual([])
    expect(db.writes).toEqual([])
    expect(db.reads.length).toBe(names.length * 2)
    for (const read of db.reads) expect(read).toEqual({ table: 'profiles', filters: [{ col: 'id', op: 'eq', value: USER_A }] })
  })

  it('todas as ações registradas respondem 401 sem login', async () => {
    const runs = names.map((name) => vi.spyOn(ADMIN_HANDLERS[name], 'run'))
    for (const name of names) {
      for (const token of [null, 'token-vencido']) {
        const res = await call(ADMIN_HANDLERS[name].method, name, token)
        expect(res.statusCode, `${name} ${String(token)}`).toBe(401)
      }
    }
    for (const run of runs) expect(run).not.toHaveBeenCalled()
    expect(db.reads).toEqual([])
  })
})

describe('painel antigo fora', () => {
  it('?source=asaas agora responde 400 (ação desconhecida), mesmo pro admin', async () => {
    const runs = names.map((name) => vi.spyOn(ADMIN_HANDLERS[name], 'run'))
    for (const source of ['asaas', 'replicate']) {
      const res = await request('GET', { source }, ADMIN_TOKEN)
      expect(res.statusCode, source).toBe(400)
      expect(res.body, source).toEqual({ error: 'Ação desconhecida: sem dado' })
      expect(res.headers['Cache-Control'], source).toBe('no-store')
    }
    for (const run of runs) expect(run).not.toHaveBeenCalled()
    // só leu o papel do admin: nenhuma função do banco, nenhuma escrita
    expect(db.rpcCalls).toEqual([])
    expect(db.writes).toEqual([])
  })

  it('usuário comum com ?source=asaas continua recebendo 403', async () => {
    const res = await request('GET', { source: 'asaas' }, TOKEN)
    expect(res.statusCode).toBe(403)
    expect(res.body).toEqual({ error: 'Esta conta não é admin.' })
  })
})

describe('e-mail do dono fora do código', () => {
  const ROOT = process.cwd()
  const IS_TEST = /\.test\.tsx?$/
  const IS_TEXT = /\.(ts|tsx|js|jsx|mjs|cjs|json|css|html|md|svg)$/
  const listFiles = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const path = join(dir, entry.name)
      return entry.isDirectory() ? listFiles(path) : [path]
    })

  it('nada em api/ e src/ contém o e-mail do dono', () => {
    const files = ['api', 'src'].flatMap((dir) => listFiles(join(ROOT, dir))).filter((f) => IS_TEXT.test(f) && !IS_TEST.test(f))
    const rel = files.map((f) => relative(ROOT, f))
    // a varredura pegou as duas pastas de verdade
    expect(rel).toEqual(expect.arrayContaining(['api/admin-stats.ts', 'api/_lib/auth.ts', 'api/__tests__/fakeSupabase.ts', 'src/App.tsx']))
    expect(files.length).toBeGreaterThan(100)
    const withOwner = files.filter((f) => readFileSync(f, 'utf8').includes(OWNER)).map((f) => relative(ROOT, f))
    expect(withOwner).toEqual([])
  })
})

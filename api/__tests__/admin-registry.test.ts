import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeDb, createRes, type FakeDb, type FakeRes } from './fakeSupabase.js'
import { USER_A } from './billingHarness.js'
import { ADMIN_HANDLERS } from '../_lib/admin/registry.js'
import adminStats from '../admin-stats.js'

// Prova do antiobjetivo 2 do spec no registro real (Ruling ADM-ordem): toda
// ação de /api/admin-stats?action= responde 403 pra quem não é admin, sem rodar
// nada. Percorre o registro inteiro (nenhuma lista escrita à mão) com o
// verifyAdmin de verdade: o login vem do token e o papel do perfil, lido com a
// chave de serviço. Aqui só se confere que as ações das pendências (T6) estão
// no registro; a T7 acrescenta audit e a T28 fixa a lista exata das 20.

const OWNER = ['arynelson11', 'gmail.com'].join('@')
const OTHER = 'quem@igreja.com'
const ANON = 'fake-anon-key'
const SERVICE = 'fake-service-role'
const TOKEN = 'token-de-usuario-comum'
const T6_ACTIONS = ['review', 'payment-link', 'resolve-flag', 'close-action', 'retry-action', 'retry-event']

let db: FakeDb
let loginUser: { id: string; email: string }

vi.mock('@supabase/supabase-js', () => ({
  createClient: (_url: string, key: string) => {
    if (key === SERVICE) return db
    return {
      auth: {
        getUser: async (token: string) => (token === TOKEN
          ? { data: { user: loginUser }, error: null }
          : { data: { user: null }, error: { message: 'invalid JWT' } }),
      },
    }
  },
}))

async function call(method: string, action: string, token: string | null): Promise<FakeRes> {
  const res = createRes()
  const body = method === 'POST' ? {} : undefined
  await adminStats({ method, query: { action }, headers: token ? { authorization: `Bearer ${token}` } : {}, body }, res)
  return res
}

const names = Object.keys(ADMIN_HANDLERS)

beforeEach(() => {
  vi.stubEnv('VITE_SUPABASE_URL', 'https://fake.supabase.co')
  vi.stubEnv('VITE_SUPABASE_ANON_KEY', ANON)
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', SERVICE)
  // sem chave do Asaas: nem uma regressão que deixasse a ação rodar chegaria à rede
  vi.stubEnv('ASAAS_API_KEY', '')
  loginUser = { id: USER_A, email: OTHER }
  db = createFakeDb({ tables: { profiles: [{ id: USER_A, plan: 'free', is_admin: false, blocked_at: null }] } })
})
afterEach(() => {
  vi.unstubAllEnvs()
})

describe('registro das ações do admin', () => {
  it('as ações das pendências estão no registro', () => {
    expect(names).toEqual(expect.arrayContaining(T6_ACTIONS))
    for (const name of names) expect(['GET', 'POST'], name).toContain(ADMIN_HANDLERS[name].method)
  })

  it('todas as ações registradas respondem 403 pra usuário comum', async () => {
    expect(names.length).toBeGreaterThanOrEqual(T6_ACTIONS.length)
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

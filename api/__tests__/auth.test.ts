import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'
import type { FakeDb } from './fakeSupabase.js'
import { USER_A, createBillingDb } from './billingHarness.js'
import { BLOCKED_MESSAGE, readProfileFlags, verifyActiveUser, verifyAdmin, verifyUser } from '../_lib/auth.js'

// api/_lib/auth.ts: o papel de admin e o bloqueio vêm de profiles.is_admin e
// profiles.blocked_at, lidos com a chave de serviço (decisão D4). Qualquer
// falha na leitura fecha: a pessoa não é admin e não fica bloqueada.
// Supabase falso: a chave anônima devolve o cliente de login, a de serviço
// devolve o banco falso da cobrança.

// Montados em tempo de execução pra varredura de arquivo não achar o próprio teste.
const OWNER = ['arynelson11', 'gmail.com'].join('@')
const TRAVESSAO = String.fromCharCode(0x2014)
const ANON = 'fake-anon-key'
const SERVICE = 'fake-service-role'
const TOKEN = 'token-valido-do-teste'
const OTHER = 'quem@igreja.com'

let db: FakeDb
let loginUser: { id: string; email: string } | null
let keysUsed: string[]
let warn: MockInstance<typeof console.warn>

vi.mock('@supabase/supabase-js', () => ({
  createClient: (_url: string, key: string) => {
    keysUsed.push(key)
    if (key === SERVICE) return db
    return {
      auth: {
        getUser: async (token: string) => (token === TOKEN && loginUser
          ? { data: { user: loginUser }, error: null }
          : { data: { user: null }, error: { message: 'invalid JWT' } }),
      },
    }
  },
}))

const req = (token: string | null = TOKEN) => ({ headers: token == null ? {} : { authorization: `Bearer ${token}` } })
const profile = (over: Record<string, unknown> = {}) => ({ id: USER_A, plan: 'free', is_admin: false, blocked_at: null, ...over })
const warnText = () => warn.mock.calls.map((c: unknown[]) => c.map(String).join(' ')).join('\n')

beforeEach(() => {
  vi.stubEnv('VITE_SUPABASE_URL', 'https://fake.supabase.co')
  vi.stubEnv('VITE_SUPABASE_ANON_KEY', ANON)
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', SERVICE)
  keysUsed = []
  loginUser = { id: USER_A, email: OTHER }
  db = createBillingDb({ profiles: [profile()] })
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
})
afterEach(() => {
  vi.unstubAllEnvs()
})

describe('papel de admin lido do banco', () => {
  it('o e-mail do dono com is_admin falso não é admin', async () => {
    loginUser = { id: USER_A, email: OWNER }
    db = createBillingDb({ profiles: [profile({ is_admin: false })] })
    expect(await verifyAdmin(req())).toEqual({ ok: false, status: 403, error: 'Forbidden: admin required' })
    expect(await verifyUser(req())).toMatchObject({ ok: true, email: OWNER, isAdmin: false })
  })

  it('is_admin verdadeiro no banco é admin, qualquer que seja o e-mail', async () => {
    db = createBillingDb({ profiles: [profile({ is_admin: true })] })
    expect(await verifyAdmin(req())).toEqual({ ok: true, userId: USER_A, email: OTHER, isAdmin: true, blocked: false })
    // leu só o próprio perfil, com a chave de serviço
    expect(db.reads).toEqual([{ table: 'profiles', filters: [{ col: 'id', op: 'eq', value: USER_A }] }])
    expect(keysUsed).toEqual([ANON, SERVICE])
  })

  it('usuário comum: verifyUser passa com isAdmin e blocked falsos', async () => {
    expect(await verifyUser(req())).toEqual({ ok: true, userId: USER_A, email: OTHER, isAdmin: false, blocked: false })
    expect(warn).not.toHaveBeenCalled()
  })
})

describe('falha fechada', () => {
  it('sem chave de serviço não é admin nem bloqueado', async () => {
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', '')
    db = createBillingDb({ profiles: [profile({ is_admin: true, blocked_at: '2026-11-10T12:00:00Z' })] })
    expect(await verifyUser(req())).toEqual({ ok: true, userId: USER_A, email: OTHER, isAdmin: false, blocked: false })
    expect(await verifyAdmin(req())).toMatchObject({ ok: false, status: 403 })
    expect(await verifyActiveUser(req())).toMatchObject({ ok: true, blocked: false })
    expect(keysUsed).not.toContain(SERVICE)
    expect(db.reads).toHaveLength(0)
    expect(warn).toHaveBeenCalled()
  })

  it('coluna ausente (42703) não é admin', async () => {
    db = createBillingDb({ profiles: [profile({ is_admin: true })] })
    db.failTable('profiles', { message: 'column profiles.is_admin does not exist', code: '42703' })
    expect(await verifyAdmin(req())).toEqual({ ok: false, status: 403, error: 'Forbidden: admin required' })
    expect(await verifyUser(req())).toMatchObject({ ok: true, isAdmin: false, blocked: false })
    expect(warn).toHaveBeenCalled()
  })

  it('erro de banco não é admin e não bloqueia', async () => {
    db = createBillingDb({ profiles: [profile({ is_admin: true, blocked_at: '2026-11-10T12:00:00Z' })] })
    db.failTable('profiles', { message: 'canceling statement due to statement timeout', code: '57014' })
    expect(await verifyUser(req())).toEqual({ ok: true, userId: USER_A, email: OTHER, isAdmin: false, blocked: false })
    expect(await verifyAdmin(req())).toMatchObject({ ok: false, status: 403 })
    expect(await verifyActiveUser(req())).toMatchObject({ ok: true, blocked: false })
  })

  it('exceção na leitura (rede caiu) não é admin e não bloqueia', async () => {
    db = createBillingDb({ profiles: [profile({ is_admin: true, blocked_at: '2026-11-10T12:00:00Z' })] })
    db.from = (() => { throw new Error('fetch failed') }) as FakeDb['from']
    expect(await readProfileFlags(USER_A)).toEqual({ isAdmin: false, blocked: false })
    expect(await verifyAdmin(req())).toMatchObject({ ok: false, status: 403 })
    expect(await verifyActiveUser(req())).toMatchObject({ ok: true, blocked: false })
  })

  it('sem linha no perfil não é admin nem bloqueado', async () => {
    db = createBillingDb({ profiles: [] })
    expect(await readProfileFlags(USER_A)).toEqual({ isAdmin: false, blocked: false })
    expect(await verifyAdmin(req())).toMatchObject({ ok: false, status: 403 })
    expect(warn).toHaveBeenCalled()
  })

  it('o aviso no log não leva token nem e-mail', async () => {
    loginUser = { id: USER_A, email: OWNER }
    db.failTable('profiles', { message: 'column profiles.is_admin does not exist', code: '42703' })
    await verifyUser(req())
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', '')
    await verifyUser(req())
    expect(warn).toHaveBeenCalledTimes(2)
    expect(warnText()).not.toContain(TOKEN)
    expect(warnText()).not.toContain(OWNER)
    expect(warnText()).not.toContain(SERVICE)
  })

  it('token inválido responde 401 sem ler o perfil', async () => {
    db = createBillingDb({ profiles: [profile({ is_admin: true })] })
    expect(await verifyUser(req('token-falso'))).toEqual({ ok: false, status: 401, error: 'Invalid or expired token' })
    expect(await verifyAdmin(req('token-falso'))).toMatchObject({ ok: false, status: 401 })
    expect(await verifyActiveUser(req(null))).toMatchObject({ ok: false, status: 401 })
    expect(db.reads).toHaveLength(0)
    expect(keysUsed).not.toContain(SERVICE)
  })
})

describe('bloqueio', () => {
  it('verifyActiveUser com blocked_at preenchido responde 403 com BLOCKED_MESSAGE', async () => {
    db = createBillingDb({ profiles: [profile({ blocked_at: '2026-11-10T12:00:00Z' })] })
    expect(BLOCKED_MESSAGE).toBe('Sua conta está bloqueada. Fale com a gente pelo WhatsApp.')
    expect(await verifyActiveUser(req())).toEqual({ ok: false, status: 403, error: BLOCKED_MESSAGE })
    // verifyUser continua passando (o bloqueado ainda cancela a assinatura e exclui a conta)
    expect(await verifyUser(req())).toEqual({ ok: true, userId: USER_A, email: OTHER, isAdmin: false, blocked: true })
  })

  it('verifyActiveUser sem bloqueio passa', async () => {
    expect(await verifyActiveUser(req())).toEqual({ ok: true, userId: USER_A, email: OTHER, isAdmin: false, blocked: false })
  })
})

describe('arquivo', () => {
  it('o arquivo não cita o e-mail do dono', () => {
    const src = readFileSync('api/_lib/auth.ts', 'utf8')
    expect(src).not.toContain(OWNER)
    expect(src).not.toContain(['ADMIN', 'EMAILS'].join('_'))
    expect(src).not.toContain(TRAVESSAO)
  })
})

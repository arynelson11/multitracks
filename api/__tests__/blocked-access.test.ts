import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'
import { createRes, type DbError, type FakeDb, type Row } from './fakeSupabase.js'
import { USER_A, createBillingDb, createFakeAsaas, payment, subRow, type FakeAsaas } from './billingHarness.js'
import { BLOCKED_MESSAGE } from '../_lib/auth.js'

// Conta bloqueada pelo admin (D10): não separa, não consulta separação, não
// envia arquivo, não salva na nuvem e não assina; ainda cancela a assinatura
// (e exclui a conta, em delete-account, que segue com verifyUser).
// A auth aqui é a DE VERDADE (api/_lib/auth.ts): o bloqueio sai de
// profiles.blocked_at no banco falso, lido com a chave de serviço. Replicate,
// R2, Asaas e fetch são falsos; nenhuma chamada de rede.

const ANON = 'fake-anon-key'
const SERVICE = 'fake-service-role'
const TOKEN = 'token-valido-do-teste'
const SONG = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const PREDICTION = 'abcdefghij0123456789zz'
const BLOCKED_AT = '2026-11-15T12:00:00Z'

const h = vi.hoisted(() => ({
  createPrediction: vi.fn(),
  getPrediction: vi.fn(),
  presign: vi.fn(),
  s3Send: vi.fn(),
  post: vi.fn(),
}))

let db: FakeDb
let asaas: FakeAsaas | null

vi.mock('@supabase/supabase-js', () => ({
  createClient: (_url: string, key: string) => (key === SERVICE ? db : {
    auth: {
      getUser: async (token: string) => (token === TOKEN
        ? { data: { user: { id: USER_A, email: 'quem@igreja.com' } }, error: null }
        : { data: { user: null }, error: { message: 'invalid JWT' } }),
    },
  }),
}))
vi.mock('replicate', () => ({
  default: class { predictions = { create: h.createPrediction, get: h.getPrediction } },
}))
vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: class { send = h.s3Send },
  PutObjectCommand: class { constructor(readonly input: unknown) {} },
}))
vi.mock('@aws-sdk/s3-request-presigner', () => ({ getSignedUrl: h.presign }))
vi.mock('axios', () => ({ default: { create: () => ({ post: h.post }), isAxiosError: () => false } }))
vi.mock('../_lib/asaas.js', async (orig) => ({
  ...(await orig<typeof import('../_lib/asaas.js')>()),
  asaasFromEnv: () => asaas,
}))

type Handler = (req: unknown, res: unknown) => Promise<unknown>
type Endpoint = { file: string; req: () => Record<string, unknown> }

const auth = { authorization: `Bearer ${TOKEN}` }

// Um pedido válido por endpoint: pra quem não está bloqueado, todos dão 200.
const ENDPOINTS: Endpoint[] = [
  { file: 'separate-audio', req: () => ({ method: 'POST', headers: auth, body: { audioUrl: 'https://r2.exemplo.com/temp/musica.mp3', stemCount: 2 } }) },
  { file: 'check-separation', req: () => ({ method: 'GET', headers: auth, query: { predictionId: PREDICTION } }) },
  { file: 'get-upload-url', req: () => ({ method: 'GET', headers: auth, query: { filename: 'musica.mp3', contentType: 'audio/mpeg', bucketFolder: 'temp' } }) },
  { file: 'insert-song', req: () => ({ method: 'POST', headers: auth, body: { name: 'Bondade de Deus', artist: 'Ministério' } }) },
  { file: 'insert-stems', req: () => ({ method: 'POST', headers: auth, body: { stems: [{ song_id: SONG, name: 'Bateria', file_url: 'https://r2.exemplo.com/stems/bateria.wav', order: 1 }] } }) },
  { file: 'upload-stem-from-url', req: () => ({ method: 'POST', headers: auth, body: { sourceUrl: 'https://replicate.delivery/pbxt/abc/vocals.wav', key: `stems/${USER_A}/${SONG}/vocals.wav`, contentType: 'audio/wav' } }) },
  { file: 'checkout', req: () => ({ method: 'POST', headers: auth, body: { planKey: 'pro_mensal' } }) },
]

// Import com caminho fixo: o Vite não resolve import com caminho montado.
const HANDLERS: Record<string, () => Promise<unknown>> = {
  'separate-audio': () => import('../separate-audio.js'),
  'check-separation': () => import('../check-separation.js'),
  'get-upload-url': () => import('../get-upload-url.js'),
  'insert-song': () => import('../insert-song.js'),
  'insert-stems': () => import('../insert-stems.js'),
  'upload-stem-from-url': () => import('../upload-stem-from-url.js'),
  checkout: () => import('../checkout.js'),
}

async function call(file: string, req: Record<string, unknown>) {
  const { default: handler } = (await HANDLERS[file]()) as { default: Handler }
  const res = createRes()
  await handler(req, res)
  return res
}

const fetchSpy = vi.fn()
let warn: MockInstance<typeof console.warn>

function profile(over: Row = {}): Row {
  return { id: USER_A, plan: 'essencial_mensal', plan_expires_at: null, is_admin: false, blocked_at: null, tokens_used: 0, tokens_period_start: '2026-11-01T03:00:00.000Z', ...over }
}

function setup(over: Row = {}) {
  db = createBillingDb({
    profiles: [profile(over)],
    predictions: [{ id: 1, replicate_id: PREDICTION, user_id: USER_A }],
    songs: [{ id: SONG, user_id: USER_A, name: 'Bondade de Deus' }],
    stems: [],
  })
  db.setRpc('consume_separation_token', () => true)
  db.setRpc('refund_separation_token', () => null)
}

// Assinatura paga ativa: assinou em 16/10 e renovou em 16/11 (passou dos 7 dias
// do arrependimento), então cancelar vale até o fim do período.
function withActiveSubscription() {
  db.tables.billing_subscriptions.push(subRow({ id: 'chk_a', user_id: USER_A, asaas_subscription_id: 'sub_a', paid_until: '2026-11-17T03:00:00.000Z' }))
  asaas!.get.mockImplementation(async (path: string) => (path === '/payments'
    ? { data: [
      payment({ id: 'pay_a1', subscription: 'sub_a', dueDate: '2026-10-16', confirmedDate: '2026-10-16', status: 'RECEIVED' }),
      payment({ id: 'pay_a2', subscription: 'sub_a', dueDate: '2026-11-16', confirmedDate: '2026-11-16', status: 'CONFIRMED' }),
    ], hasMore: false }
    : { data: [], hasMore: false }))
}

// Só a leitura do papel e do bloqueio (auth.ts) falha; as outras leituras do perfil seguem.
function failProfileFlagsRead(error: DbError) {
  const from = db.from.bind(db)
  db.from = (table: string) => {
    const q = from(table)
    const select = q.select.bind(q)
    q.select = ((cols?: string) => (cols?.includes('blocked_at')
      ? { eq: () => ({ maybeSingle: async () => ({ data: null, error }) }) }
      : select(cols))) as typeof q.select
    return q
  }
}

// Nada saiu do servidor: nenhuma separação, consulta, assinatura de upload,
// download, gravação no R2, checkout no Asaas, RPC ou escrita no banco.
function expectNothingDone() {
  expect(h.createPrediction).not.toHaveBeenCalled()
  expect(h.getPrediction).not.toHaveBeenCalled()
  expect(h.presign).not.toHaveBeenCalled()
  expect(h.s3Send).not.toHaveBeenCalled()
  expect(h.post).not.toHaveBeenCalled()
  expect(fetchSpy).not.toHaveBeenCalled()
  expect(db.rpcCalls).toEqual([])
  expect(db.writes).toEqual([])
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-11-16T15:00:00Z'))
  vi.stubEnv('VITE_SUPABASE_URL', 'https://fake.supabase.co')
  vi.stubEnv('VITE_SUPABASE_ANON_KEY', ANON)
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', SERVICE)
  vi.stubEnv('REPLICATE_API_TOKEN', 'fake-replicate')
  vi.stubEnv('VITE_R2_PUBLIC_URL', 'https://r2.exemplo.com')
  vi.stubEnv('R2_ACCOUNT_ID', 'fake-account')
  vi.stubEnv('R2_ACCESS_KEY_ID', 'fake-key-id')
  vi.stubEnv('R2_SECRET_ACCESS_KEY', 'fake-secret')
  vi.stubEnv('ASAAS_API_KEY', 'fake-key')
  for (const fn of Object.values(h)) fn.mockReset()
  h.createPrediction.mockResolvedValue({ id: 'pred_1', status: 'starting' })
  h.getPrediction.mockResolvedValue({ id: PREDICTION, status: 'processing' })
  h.presign.mockResolvedValue('https://r2.upload.test/assinado')
  h.s3Send.mockResolvedValue({})
  h.post.mockResolvedValue({ data: { id: 'chk_9', link: 'https://asaas.test/c/chk_9' } })
  fetchSpy.mockReset()
  fetchSpy.mockImplementation(async () => new Response(new Uint8Array([1, 2, 3])))
  vi.stubGlobal('fetch', fetchSpy)
  asaas = createFakeAsaas()
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  setup()
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  warn.mockRestore()
})

describe('conta bloqueada', () => {
  it('separar bloqueado responde 403 com a frase e não consome cota', async () => {
    setup({ plan: 'free', blocked_at: BLOCKED_AT, tokens_used: 2 })
    const res = await call('separate-audio', ENDPOINTS[0].req())
    expect(res.statusCode).toBe(403)
    expect(res.body).toEqual({ error: BLOCKED_MESSAGE })
    expect(db.rpcCalls.some((c) => c.name === 'consume_separation_token')).toBe(false)
    expect(db.tables.profiles[0].tokens_used).toBe(2)
    expect(h.createPrediction).not.toHaveBeenCalled()
  })

  it.each(ENDPOINTS.map((e) => [e.file, e] as const))('%s: bloqueado responde 403 com a frase e nada é feito', async (_name, endpoint) => {
    setup({ blocked_at: BLOCKED_AT })
    const res = await call(endpoint.file, endpoint.req())
    expect(res.statusCode).toBe(403)
    expect(res.body).toEqual({ error: BLOCKED_MESSAGE })
    expectNothingDone()
  })

  it.each(ENDPOINTS.map((e) => [e.file, e] as const))('%s: quem não está bloqueado segue igual (200)', async (_name, endpoint) => {
    const res = await call(endpoint.file, endpoint.req())
    expect(res.statusCode).toBe(200)
    expect(warn).not.toHaveBeenCalled()
  })

  it('bloqueado não cria checkout', async () => {
    setup({ plan: 'free', blocked_at: BLOCKED_AT })
    const res = await call('checkout', { method: 'POST', headers: auth, body: { planKey: 'essencial_mensal' } })
    expect(res.statusCode).toBe(403)
    expect(res.body).toEqual({ error: BLOCKED_MESSAGE })
    expect(h.post).not.toHaveBeenCalled()
    expect(db.tables.pending_checkouts ?? []).toEqual([])
  })

  it('bloqueado ainda cancela a assinatura', async () => {
    setup({ blocked_at: BLOCKED_AT })
    withActiveSubscription()

    const res = await call('checkout', { method: 'POST', headers: auth, query: { action: 'cancel' }, body: {} })

    expect(res.statusCode).toBe(200)
    expect(asaas!.del).toHaveBeenCalledWith('/subscriptions/sub_a')
    expect(db.rpcCalls.find((c) => c.name === 'billing_end_subscription')!.args).toMatchObject({ p_id: 'chk_a', p_source: 'user' })
  })

  it('bloqueado ainda vê a prévia do cancelamento e o login ainda sincroniza as pendências', async () => {
    setup({ blocked_at: BLOCKED_AT })
    withActiveSubscription()
    const preview = await call('checkout', { method: 'POST', headers: auth, query: { action: 'cancel-preview' }, body: {} })
    const sync = await call('checkout', { method: 'POST', headers: auth, query: { action: 'sync' }, body: {} })
    expect(preview.statusCode).toBe(200)
    expect(preview.body).toMatchObject({ outcome: 'until_period_end', plan: 'essencial_mensal' })
    expect(sync.statusCode).toBe(200)
    expect(sync.body).toMatchObject({ ok: true })
    expect(h.post).not.toHaveBeenCalled()
  })

  it('os seis endpoints usam verifyActiveUser', () => {
    for (const file of ['separate-audio', 'check-separation', 'get-upload-url', 'insert-song', 'insert-stems', 'upload-stem-from-url']) {
      const src = readFileSync(new URL(`../${file}.ts`, import.meta.url), 'utf8')
      expect(src, file).toMatch(/import \{[^}]*\bverifyActiveUser\b[^}]*\} from '\.\/_lib\/auth\.js'/)
      expect(src, file).toContain('await verifyActiveUser(req)')
      expect(src, file).not.toContain('verifyUser(')
    }
  })
})

describe('leitura do bloqueio falhou (erro de banco ou teto de 3 s da T2)', () => {
  it('quem não está bloqueado não percebe nada: separa, envia e assina normalmente', async () => {
    failProfileFlagsRead({ message: 'connection reset', code: '08006' })
    for (const file of ['separate-audio', 'get-upload-url', 'checkout']) {
      const endpoint = ENDPOINTS.find((e) => e.file === file)!
      expect((await call(file, endpoint.req())).statusCode, file).toBe(200)
    }
  })

  it('o bloqueado passa só naquele pedido (falha aberta pro bloqueio, decisão ADM-T2-timeout)', async () => {
    setup({ blocked_at: BLOCKED_AT })
    failProfileFlagsRead({ message: 'connection reset', code: '08006' })
    const res = await call('get-upload-url', ENDPOINTS[2].req())
    expect(res.statusCode).toBe(200)
    expect(warn).toHaveBeenCalled()
  })
})

describe('insert-song: música do catálogo da plataforma', () => {
  const globalSong = () => ({ method: 'POST', headers: auth, body: { name: 'Bondade de Deus', artist: 'Ministério', is_global: true } })

  it('admin lido certo publica no catálogo', async () => {
    setup({ plan: 'free', is_admin: true })
    const res = await call('insert-song', globalSong())
    expect(res.statusCode).toBe(200)
    expect(db.tables.songs.at(-1)).toMatchObject({ name: 'Bondade de Deus', user_id: USER_A, is_global: true })
  })

  it('papel de admin não lido: pedido de música global é recusado e nada é salvo como privada', async () => {
    setup({ plan: 'free', is_admin: true })
    failProfileFlagsRead({ message: 'connection reset', code: '08006' })
    const res = await call('insert-song', globalSong())
    expect(res.statusCode).toBe(403)
    const msg = (res.body as { error: string }).error
    expect(msg).toContain('Nada foi salvo')
    expect(msg).not.toContain(String.fromCharCode(0x2014))
    expect(db.writes.filter((w) => w.table === 'songs')).toEqual([])
  })

  it('usuário comum (o app manda is_global falso) salva a música privada como antes', async () => {
    const res = await call('insert-song', { method: 'POST', headers: auth, body: { name: 'Bondade de Deus', is_global: false } })
    expect(res.statusCode).toBe(200)
    expect(db.tables.songs.at(-1)).toMatchObject({ user_id: USER_A, is_global: false })
  })
})

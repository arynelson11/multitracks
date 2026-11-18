import { afterEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import {
  INVALID_BPM_MESSAGE,
  TIME_SIGNATURES,
  bpmColumns,
  bpmFromText,
  editedBpmColumns,
  isMissingMeterColumn,
  preciseBpm,
  sanitizeTimeSignature,
  withoutMeterColumns,
} from './cloudBpm'
// Cópia do servidor (o api/ não importa de src/): tem que dar o mesmo resultado.
import * as serverMeter from '../../api/_lib/meter'

// Cliente do Supabase falso: guarda cada update/insert e responde com o que o
// teste pôr na fila (o primeiro da fila vale pra próxima chamada).
const fakeDb = vi.hoisted(() => {
  type Reply = { data?: unknown; error: { code?: string; message: string } | null }
  const state = {
    calls: [] as { op: 'update' | 'insert'; payload: Record<string, unknown> }[],
    replies: [] as Reply[],
  }
  const next = (): Reply => state.replies.shift() ?? { data: { id: 'nova' }, error: null }
  const client = {
    // O supabase.ts liga a escuta da recuperação de senha ao criar o cliente (v1.4.17).
    auth: { onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }) },
    from: () => ({
      update: (payload: Record<string, unknown>) => {
        state.calls.push({ op: 'update', payload })
        return { eq: async () => next() }
      },
      insert: (payload: Record<string, unknown>) => {
        state.calls.push({ op: 'insert', payload })
        return { select: () => ({ single: async () => next() }) }
      },
    }),
  }
  return { state, client }
})

vi.mock('@supabase/supabase-js', () => ({ createClient: () => fakeDb.client }))

// Cache offline em memória no lugar do IndexedDB.
const fakeIdb = vi.hoisted(() => ({ store: new Map<string, unknown>() }))
vi.mock('idb-keyval', () => ({
  get: async (k: string) => fakeIdb.store.get(k),
  set: async (k: string, v: unknown) => { fakeIdb.store.set(k, v) },
  del: async (k: string) => { fakeIdb.store.delete(k) },
  keys: async () => [...fakeIdb.store.keys()],
}))

// Usuário já autenticado (admin, pra não depender do lookup do plano). Desde a v1.4.18 o
// insert-song confere a conta com o verifyActiveUser (conta bloqueada não salva na nuvem).
vi.mock('../../api/_lib/auth.js', () => {
  const adminOk = async () => ({ ok: true, userId: 'u-admin', email: 'admin@exemplo.com', isAdmin: true, blocked: false })
  return { verifyUser: adminOk, verifyActiveUser: adminOk }
})

const COLUNA_FALTANDO = {
  code: 'PGRST204',
  message: "Could not find the 'bpm_exact' column of 'songs' in the schema cache",
}

describe('preciseBpm', () => {
  it('prefere o BPM exato quando ele bate com o inteiro', () => {
    expect(preciseBpm({ bpm: 73, bpm_exact: 72.5 })).toBe(72.5)
    expect(preciseBpm({ bpm: 120, bpm_exact: 120 })).toBe(120)
  })

  it('cai no inteiro quando não há exato (música antiga ou banco sem a coluna)', () => {
    expect(preciseBpm({ bpm: 72 })).toBe(72)
    expect(preciseBpm({ bpm: 72, bpm_exact: null })).toBe(72)
  })

  it('sem inteiro nenhum, vale o exato', () => {
    expect(preciseBpm({ bpm_exact: 72.5 })).toBe(72.5)
    expect(preciseBpm({ bpm: null, bpm_exact: 72.5 })).toBe(72.5)
  })

  it('ignora 0, vazio e valores inválidos', () => {
    expect(preciseBpm({ bpm: 0 })).toBeUndefined()
    expect(preciseBpm({ bpm: 0, bpm_exact: 0 })).toBeUndefined()
    expect(preciseBpm({ bpm: 72, bpm_exact: 0 })).toBe(72)
    expect(preciseBpm({ bpm: null, bpm_exact: null })).toBeUndefined()
    expect(preciseBpm({})).toBeUndefined()
    expect(preciseBpm({ bpm: Number.NaN })).toBeUndefined()
  })

  it('ignora o exato velho quando um app antigo mudou só o inteiro', () => {
    // App antigo editou o BPM pra 74 e não conhece bpm_exact: vale o 74.
    expect(preciseBpm({ bpm: 74, bpm_exact: 72.5 })).toBe(74)
    // App antigo apagou o BPM (0): a música fica sem BPM.
    expect(preciseBpm({ bpm: 0, bpm_exact: 72.5 })).toBeUndefined()
  })

  it('aceita o numeric vindo como texto', () => {
    expect(preciseBpm({ bpm: 73, bpm_exact: '72.50' as unknown as number })).toBe(72.5)
  })
})

describe('bpmColumns', () => {
  it('guarda o inteiro arredondado e o exato com 2 casas', () => {
    expect(bpmColumns(72.5)).toEqual({ bpm: 73, bpm_exact: 72.5 })
    expect(bpmColumns(120)).toEqual({ bpm: 120, bpm_exact: 120 })
    expect(bpmColumns(72.456)).toEqual({ bpm: 72, bpm_exact: 72.46 })
  })

  it('o inteiro sai do exato já arredondado, pra os dois sempre baterem', () => {
    // 72,499 vira 72,5 com 2 casas; o inteiro é o de 72,5 (73), não o de 72,499 (72).
    expect(bpmColumns(72.499)).toEqual({ bpm: 73, bpm_exact: 72.5 })
    const cols = bpmColumns(72.499)
    expect(cols && preciseBpm(cols)).toBe(72.5)
  })

  it('fora de (0, 400) devolve null', () => {
    expect(bpmColumns(0)).toBeNull()
    expect(bpmColumns(Number.NaN)).toBeNull()
    expect(bpmColumns(-90)).toBeNull()
    expect(bpmColumns(400)).toBeNull()
    expect(bpmColumns(399.999)).toBeNull()
    expect(bpmColumns(0.001)).toBeNull()
    expect(bpmColumns(Number.POSITIVE_INFINITY)).toBeNull()
  })
})

describe('bpmFromText (campo de BPM do envio do admin)', () => {
  it('aceita vírgula ou ponto e devolve o BPM com 2 casas', () => {
    expect(bpmFromText('72,5')).toBe(72.5)
    expect(bpmFromText('72.5')).toBe(72.5)
    expect(bpmFromText(' 120 ')).toBe(120)
    expect(bpmFromText('72,456')).toBe(72.46)
  })

  it('vazio ou 0 é sem BPM (0)', () => {
    expect(bpmFromText('')).toBe(0)
    expect(bpmFromText('  ')).toBe(0)
    expect(bpmFromText('0')).toBe(0)
    expect(bpmFromText('0,00')).toBe(0)
  })

  it('valor inválido ou fora de (0, 400) dá null (a tela avisa e não envia)', () => {
    for (const t of ['abc', '72,5,1', '1e3', '-72', '+72', '72bpm', ',', '450', '400', '399,999']) {
      expect(bpmFromText(t), t).toBeNull()
    }
  })

  it('aviso em português, com exemplo de vírgula, sem travessão', () => {
    expect(INVALID_BPM_MESSAGE).toBe('BPM inválido. Use um número maior que 0 e menor que 400 (ex.: 72,5), ou deixe o campo vazio.')
    expect(INVALID_BPM_MESSAGE).not.toContain(String.fromCharCode(0x2014))
  })
})

describe('editedBpmColumns (campo de BPM da biblioteca)', () => {
  const song = { bpm: 73, bpm_exact: 72.5 }

  it('aceita vírgula ou ponto, como o teclado do iPad em pt-BR manda', () => {
    expect(editedBpmColumns(song, '72,5')).toEqual({ bpm: 73, bpm_exact: 72.5 })
    expect(editedBpmColumns(song, '72.5')).toEqual({ bpm: 73, bpm_exact: 72.5 })
    expect(editedBpmColumns(song, ' 120 ')).toEqual({ bpm: 120, bpm_exact: 120 })
    expect(editedBpmColumns(song, '72,456')).toEqual({ bpm: 72, bpm_exact: 72.46 })
    expect(editedBpmColumns(song, '72,')).toEqual({ bpm: 72, bpm_exact: 72 })
    expect(editedBpmColumns(song, ',5')).toEqual({ bpm: 1, bpm_exact: 0.5 })
  })

  it('campo vazio ou 0 grava sem BPM, de propósito', () => {
    expect(editedBpmColumns(song, '')).toEqual({ bpm: 0, bpm_exact: null })
    expect(editedBpmColumns(song, '   ')).toEqual({ bpm: 0, bpm_exact: null })
    expect(editedBpmColumns(song, '0')).toEqual({ bpm: 0, bpm_exact: null })
    expect(editedBpmColumns(song, '0,0')).toEqual({ bpm: 0, bpm_exact: null })
  })

  it('valor inválido dá null (a tela avisa) em vez de apagar o BPM', () => {
    for (const t of ['abc', '72,5,1', '72.5.1', '1.000,5', '1e3', '-72', '+72', 'Infinity', '0x10', '72 5', '72bpm', ',', '.', '450', '400', '399,999']) {
      expect(editedBpmColumns(song, t), t).toBeNull()
    }
  })

  it('não mexeu no campo: regrava o BPM que vale hoje', () => {
    expect(editedBpmColumns({ bpm: 73, bpm_exact: 72.5 }, undefined)).toEqual({ bpm: 73, bpm_exact: 72.5 })
    expect(editedBpmColumns({ bpm: 120 }, undefined)).toEqual({ bpm: 120, bpm_exact: 120 })
    expect(editedBpmColumns({ bpm: 0 }, undefined)).toEqual({ bpm: 0, bpm_exact: null })
    expect(editedBpmColumns({}, undefined)).toEqual({ bpm: 0, bpm_exact: null })
  })

  it('não mexeu e o par estava velho (app antigo mudou só o inteiro): conserta', () => {
    expect(editedBpmColumns({ bpm: 74, bpm_exact: 72.5 }, undefined)).toEqual({ bpm: 74, bpm_exact: 74 })
    expect(editedBpmColumns({ bpm: 0, bpm_exact: 72.5 }, undefined)).toEqual({ bpm: 0, bpm_exact: null })
  })

  it('não mexeu e o BPM antigo está fora da faixa: mantém o inteiro, sem exato', () => {
    expect(editedBpmColumns({ bpm: 450 }, undefined)).toEqual({ bpm: 450, bpm_exact: null })
  })

  it('o resultado é o que o repertório recebe pelo preciseBpm', () => {
    const cols = editedBpmColumns(song, '72,5')
    expect(cols && preciseBpm(cols)).toBe(72.5)
  })
})

describe('sanitizeTimeSignature', () => {
  it('aceita só os compassos do banco', () => {
    for (const ts of ['3/4', '4/4', '5/4', '6/8', '7/8', '12/8']) {
      expect(sanitizeTimeSignature(ts)).toBe(ts)
    }
    expect(sanitizeTimeSignature(' 6/8 ')).toBe('6/8')
  })

  it('recusa o resto', () => {
    expect(sanitizeTimeSignature('9/8')).toBeNull()
    expect(sanitizeTimeSignature('2/4')).toBeNull()
    expect(sanitizeTimeSignature('')).toBeNull()
    expect(sanitizeTimeSignature(null)).toBeNull()
    expect(sanitizeTimeSignature(undefined)).toBeNull()
    expect(sanitizeTimeSignature(4)).toBeNull()
    expect(sanitizeTimeSignature({ ts: '4/4' })).toBeNull()
  })
})

describe('banco ainda sem as colunas novas', () => {
  it('reconhece o erro de coluna faltando só pras colunas novas', () => {
    expect(isMissingMeterColumn(COLUNA_FALTANDO)).toBe(true)
    expect(isMissingMeterColumn({
      code: '42703',
      message: 'column "time_signature" of relation "songs" does not exist',
    })).toBe(true)
    expect(isMissingMeterColumn({
      code: 'PGRST204',
      message: "Could not find the 'lyrics' column of 'songs' in the schema cache",
    })).toBe(false)
    expect(isMissingMeterColumn({ code: '23514', message: 'violates check constraint on bpm_exact' })).toBe(false)
    expect(isMissingMeterColumn(null)).toBe(false)
    expect(isMissingMeterColumn('bpm_exact')).toBe(false)
  })

  it('tira só as colunas novas, sem mexer no original', () => {
    const row = { name: 'Grande és Tu', bpm: 73, bpm_exact: 72.5, time_signature: '6/8' }
    expect(withoutMeterColumns(row)).toEqual({ name: 'Grande és Tu', bpm: 73 })
    expect(row.bpm_exact).toBe(72.5)
    expect(row.time_signature).toBe('6/8')
  })
})

describe('migration (db/supabase-bpm-exact-migration.sql)', () => {
  const sql = readFileSync(fileURLToPath(new URL('../../db/supabase-bpm-exact-migration.sql', import.meta.url)), 'utf8')
  // Comandos sem os comentários de linha, um por ";".
  const statements = sql
    .split('\n').map(l => l.replace(/--.*$/, '')).join('\n')
    .split(';').map(st => st.replace(/\s+/g, ' ').trim().toLowerCase()).filter(Boolean)

  it('começa limitando a espera pelo lock da tabela', () => {
    expect(statements[0]).toBe("set lock_timeout = '5s'")
  })

  it('pede ao PostgREST que releia o esquema logo antes do select de verificação', () => {
    // O SQL Editor do Supabase só mostra o resultado do último comando: o select
    // de conferência fica por último e o notify vem logo antes dele.
    expect(statements[statements.length - 2]).toBe("notify pgrst, 'reload schema'")
    expect(statements[statements.length - 1]).toMatch(/^select column_name, data_type, .* from information_schema\.columns /)
    const lastDdl = Math.max(
      ...statements.map((st, i) => (st.startsWith('alter table') || st.startsWith('comment on')) ? i : -1),
    )
    expect(lastDdl).toBeLessThan(statements.length - 2)
  })

  it('a check do compasso no banco tem a mesma lista do app', () => {
    const check = sql.match(/time_signature in \(([^)]*)\)/)
    expect(check).not.toBeNull()
    const inDb = (check?.[1] ?? '').split(',').map(t => t.trim().replace(/^'|'$/g, ''))
    expect(inDb).toEqual([...TIME_SIGNATURES])
  })

  it('é aditiva e idempotente: só cria coluna se não existe, nunca apaga nem regrava linha', () => {
    const alters = statements.filter(st => st.startsWith('alter table'))
    expect(alters).toHaveLength(2)
    for (const st of alters) expect(st).toMatch(/^alter table public\.songs add column if not exists /)
    expect(alters[0]).toContain("bpm_exact numeric(6,2) null check (bpm_exact is null or (bpm_exact > 0 and bpm_exact < 400))")
    expect(alters[1]).toContain("time_signature text null check (time_signature is null or time_signature in ('3/4','4/4','5/4','6/8','7/8','12/8'))")
    for (const st of statements) expect(st).not.toMatch(/^(drop|delete|update|truncate|insert)\b/)
  })
})

describe('paridade com a cópia do servidor (api/_lib/meter.ts)', () => {
  const bpms = [
    72.5, 72.499, 72.456, 72.455, 120, 1, 0.5, 0.01, 0.005, 0.004, 0.001, 0, -0, -1, -72.5,
    399.99, 399.994, 399.995, 399.999, 400, 400.01, 1000, Number.NaN,
    Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, 1e-9, 1e9,
  ]
  it.each(bpms)('bpmColumns(%s) igual nos dois lados', (v) => {
    expect(serverMeter.bpmColumns(v)).toEqual(bpmColumns(v))
  })

  const compassos: unknown[] = [
    '3/4', '4/4', '5/4', '6/8', '7/8', '12/8', ' 6/8 ', '6/8\n', '9/8', '2/4', '4/4 extra',
    '', ' ', 'undefined', null, undefined, 4, 0.75, true, ['4/4'], { ts: '4/4' },
  ]
  it.each(compassos)('sanitizeTimeSignature(%j) igual nos dois lados', (raw) => {
    expect(serverMeter.sanitizeTimeSignature(raw)).toBe(sanitizeTimeSignature(raw))
  })

  const erros: unknown[] = [
    COLUNA_FALTANDO,
    { code: 'PGRST204', message: "Could not find the 'time_signature' column of 'songs' in the schema cache" },
    { code: '42703', message: 'column "bpm_exact" of relation "songs" does not exist' },
    { code: 'PGRST204', message: "Could not find the 'lyrics' column of 'songs' in the schema cache" },
    { code: '23514', message: 'violates check constraint on bpm_exact' },
    { code: 'PGRST204' },
    { code: 'PGRST204', message: 42 },
    { message: 'bpm_exact' },
    null, undefined, 'bpm_exact', 0,
  ]
  it.each(erros)('isMissingMeterColumn(%j) igual nos dois lados', (e) => {
    expect(serverMeter.isMissingMeterColumn(e)).toBe(isMissingMeterColumn(e))
  })

  it('as listas fechadas são as mesmas', () => {
    expect([...serverMeter.TIME_SIGNATURES]).toEqual([...TIME_SIGNATURES])
    expect(TIME_SIGNATURES).toEqual(['3/4', '4/4', '5/4', '6/8', '7/8', '12/8'])
    expect([...serverMeter.SONG_METER_COLUMNS]).toEqual(['bpm_exact', 'time_signature'])
    const row = { name: 'X', bpm: 73, bpm_exact: 72.5, time_signature: '6/8' }
    expect(serverMeter.withoutMeterColumns(row)).toEqual(withoutMeterColumns(row))
  })
})

describe('gravação na nuvem tolerante (supabase.ts)', () => {
  afterEach(() => {
    fakeDb.state.calls.length = 0
    fakeDb.state.replies.length = 0
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  async function loadSupabase() {
    vi.stubEnv('VITE_SUPABASE_URL', 'https://exemplo.supabase.co')
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'chave-de-teste')
    vi.resetModules()
    return await import('./supabase')
  }

  it('updateSong grava bpm, bpm_exact e time_signature de uma vez', async () => {
    const { updateSong } = await loadSupabase()
    const ok = await updateSong('s1', { name: 'X', bpm: 73, bpm_exact: 72.5, time_signature: '6/8' })
    expect(ok).toBe(true)
    expect(fakeDb.state.calls).toHaveLength(1)
    expect(fakeDb.state.calls[0].payload).toEqual({ name: 'X', bpm: 73, bpm_exact: 72.5, time_signature: '6/8' })
  })

  it('updateSong repete sem as colunas novas se o banco ainda não as tem', async () => {
    const { updateSong } = await loadSupabase()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    fakeDb.state.replies.push({ error: COLUNA_FALTANDO })
    const ok = await updateSong('s1', { name: 'X', bpm: 73, bpm_exact: 72.5 })
    expect(ok).toBe(true)
    expect(fakeDb.state.calls.map(c => c.payload)).toEqual([
      { name: 'X', bpm: 73, bpm_exact: 72.5 },
      { name: 'X', bpm: 73 },
    ])
    expect(warn).toHaveBeenCalledTimes(1)
  })

  it('updateSong não finge sucesso quando só havia coluna nova pra gravar', async () => {
    const { updateSong } = await loadSupabase()
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    fakeDb.state.replies.push({ error: COLUNA_FALTANDO })
    expect(await updateSong('s1', { time_signature: '6/8' })).toBe(false)
    expect(fakeDb.state.calls).toHaveLength(1)
  })

  it('updateSong não repete em outro erro', async () => {
    const { updateSong } = await loadSupabase()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    fakeDb.state.replies.push({ error: { code: '42501', message: 'permission denied' } })
    expect(await updateSong('s1', { bpm: 73, bpm_exact: 72.5 })).toBe(false)
    expect(fakeDb.state.calls).toHaveLength(1)
  })

  it('insertSong repete sem as colunas novas se o banco ainda não as tem', async () => {
    const { insertSong } = await loadSupabase()
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    fakeDb.state.replies.push({ error: COLUNA_FALTANDO }, { data: { id: 'id-novo' }, error: null })
    const id = await insertSong({
      name: 'X', artist: '', key: 'G', bpm: 73, bpm_exact: 72.5, time_signature: '6/8', cover_url: null,
    })
    expect(id).toBe('id-novo')
    expect(fakeDb.state.calls.map(c => c.payload)).toEqual([
      { name: 'X', artist: '', key: 'G', bpm: 73, bpm_exact: 72.5, time_signature: '6/8', cover_url: null },
      { name: 'X', artist: '', key: 'G', bpm: 73, cover_url: null },
    ])
  })
})

describe('handler do /api/insert-song', () => {
  type FakeRes = {
    statusCode: number
    body: unknown
    setHeader: () => void
    status: (c: number) => FakeRes
    json: (b: unknown) => FakeRes
    end: () => FakeRes
  }

  afterEach(() => {
    fakeDb.state.calls.length = 0
    fakeDb.state.replies.length = 0
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  async function post(body: Record<string, unknown>): Promise<FakeRes> {
    vi.stubEnv('VITE_SUPABASE_URL', 'https://exemplo.supabase.co')
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'chave-de-servico-de-teste')
    vi.resetModules()
    const { default: handler } = await import('../../api/insert-song')
    const res: FakeRes = {
      statusCode: 0,
      body: undefined,
      setHeader: () => {},
      status(c) { this.statusCode = c; return this },
      json(b) { this.body = b; return this },
      end() { return this },
    }
    await handler({ method: 'POST', headers: { authorization: 'Bearer token-de-teste' }, body }, res)
    return res
  }

  const inserted = () => fakeDb.state.calls.filter(c => c.op === 'insert').map(c => c.payload)

  it('arredonda o inteiro a partir do exato e grava os dois', async () => {
    const res = await post({ name: 'X', bpm: 72.5, time_signature: '6/8', is_global: true, user_id: 'outro' })
    expect(res.statusCode).toBe(200)
    expect(res.body).toEqual({ id: 'nova' })
    expect(inserted()).toEqual([{
      name: 'X', artist: '', key: '', bpm: 73, bpm_exact: 72.5, time_signature: '6/8',
      cover_url: null, user_id: 'u-admin', is_global: true,
    }])
  })

  it.each([
    [72.499, 73, 72.5],
    [72.456, 72, 72.46],
    ['120', 120, 120],
    [0.5, 1, 0.5],
    [399.99, 400, 399.99],
  ])('bpm %j vira inteiro %d e exato %d', async (bpm, whole, exact) => {
    await post({ name: 'X', bpm })
    expect(inserted()[0]).toMatchObject({ bpm: whole, bpm_exact: exact })
  })

  it.each([
    [450, 450],
    [1500, 999],
    [399.995, 400],
    [0, 0],
    [-5, 0],
    [undefined, 0],
    ['abc', 0],
  ])('bpm %j fora de (0, 400) grava só o inteiro %d, sem exato', async (bpm, whole) => {
    await post({ name: 'X', bpm })
    const row = inserted()[0]
    expect(row.bpm).toBe(whole)
    expect(row).not.toHaveProperty('bpm_exact')
  })

  it.each(['9/8', '2/4', '', 7, null, ['4/4']])('compasso inválido %j fica de fora', async (ts) => {
    await post({ name: 'X', bpm: 72, time_signature: ts })
    expect(inserted()[0]).not.toHaveProperty('time_signature')
  })

  it('compasso com espaço em volta é aceito limpo', async () => {
    await post({ name: 'X', time_signature: ' 12/8 ' })
    expect(inserted()[0]).toMatchObject({ time_signature: '12/8' })
  })

  it('banco sem as colunas novas: regrava uma vez sem elas e salva a música', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    fakeDb.state.replies.push({ error: COLUNA_FALTANDO }, { data: { id: 'id-novo' }, error: null })
    const res = await post({ name: 'X', bpm: 72.5, time_signature: '6/8' })
    expect(res.statusCode).toBe(200)
    expect(res.body).toEqual({ id: 'id-novo' })
    const rows = inserted()
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({ bpm: 73, bpm_exact: 72.5, time_signature: '6/8' })
    expect(rows[1]).toMatchObject({ name: 'X', bpm: 73, user_id: 'u-admin' })
    expect(rows[1]).not.toHaveProperty('bpm_exact')
    expect(rows[1]).not.toHaveProperty('time_signature')
    expect(warn).toHaveBeenCalledTimes(1)
  })

  it('se a regravação também falha, não tenta uma terceira vez', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    fakeDb.state.replies.push({ error: COLUNA_FALTANDO }, { error: COLUNA_FALTANDO })
    const res = await post({ name: 'X', bpm: 72.5 })
    expect(res.statusCode).toBe(500)
    expect(res.body).toEqual({ error: 'Failed to insert song' })
    expect(inserted()).toHaveLength(2)
    expect(error).toHaveBeenCalledTimes(1)
  })

  it('outro erro do banco não regrava', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    fakeDb.state.replies.push({ error: { code: '23514', message: 'violates check constraint on bpm_exact' } })
    const res = await post({ name: 'X', bpm: 72.5 })
    expect(res.statusCode).toBe(500)
    expect(inserted()).toHaveLength(1)
  })
})

describe('cache offline (getCachedSong)', () => {
  afterEach(() => { fakeIdb.store.clear() })

  function putCached(song: Record<string, unknown>) {
    fakeIdb.store.set('playback-studio:song:s1', {
      songId: 's1',
      song: { id: 's1', name: 'X', artist: 'A', key: 'G', cover_url: null, markers: null, created_at: '', ...song },
      stemNames: ['Click.wav'],
      coverBlob: null,
    })
    fakeIdb.store.set('playback-studio:song:s1:stem:0', new Blob([new Uint8Array([1, 2, 3])]))
  }

  it('devolve o BPM exato e o compasso salvos', async () => {
    const { getCachedSong } = await import('./offlineCache')
    putCached({ bpm: 73, bpm_exact: 72.5, time_signature: '6/8' })
    const r = await getCachedSong('s1')
    expect(r?.bpm).toBe(72.5)
    expect(r?.timeSignature).toBe('6/8')
  })

  it('música baixada antes da coluna nova: inteiro e sem compasso', async () => {
    const { getCachedSong } = await import('./offlineCache')
    putCached({ bpm: 73 })
    const r = await getCachedSong('s1')
    expect(r?.bpm).toBe(73)
    expect(r?.timeSignature).toBeNull()
  })

  it('updateCachedSongMeta leva bpm e bpm_exact pro índice', async () => {
    const { getCachedSong, updateCachedSongMeta } = await import('./offlineCache')
    vi.spyOn(console, 'log').mockImplementation(() => {})
    putCached({ bpm: 73 })
    await updateCachedSongMeta('s1', { bpm: 71, bpm_exact: 70.75 })
    expect((await getCachedSong('s1'))?.bpm).toBe(70.75)
  })
})

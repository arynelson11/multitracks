import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { getStoredUsdBrl, getUsdBrl, ptaxPeriodUrl } from '../_lib/fx.js'
import { createFakeDb, type FakeDb, type Row } from './fakeSupabase.js'

// T11: câmbio do dia (PTAX de venda do Banco Central). O Banco Central só por
// fetch falso (vi.fn): nenhuma chamada de rede. O banco é o falso em memória,
// com a tabela fx_rates no contrato da T10 (rate_date é a chave).

const NOW = new Date('2026-11-16T15:00:00Z') // 12:00 de Brasília
const HOURS = 3600_000

function fxDb(rows: Row[] = []): FakeDb {
  return createFakeDb({ tables: { fx_rates: rows }, primaryKeys: { fx_rates: 'rate_date' } })
}
const client = (db: FakeDb) => db as unknown as SupabaseClient

function stored(date: string, rate: number, fetchedAt: string): Row {
  return { rate_date: date, usd_brl: rate, source: 'bcb_ptax_venda', fetched_at: fetchedAt }
}

function bcbReplies(body: unknown, status = 200) {
  return vi.fn<typeof fetch>(async () => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }))
}

const FRIDAY_AND_MONDAY = {
  value: [
    { cotacaoVenda: 5.3712, dataHoraCotacao: '2026-11-13 13:09:27.531' },
    { cotacaoVenda: 5.3655, dataHoraCotacao: '2026-11-16 13:04:11.002' },
  ],
}

let warn: ReturnType<typeof vi.spyOn>
beforeEach(() => {
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
})
afterEach(() => {
  warn.mockRestore()
  vi.unstubAllGlobals()
})

describe('ptaxPeriodUrl', () => {
  it('monta o endereço da API Olinda com as datas em MM-DD-AAAA', () => {
    expect(ptaxPeriodUrl('2026-11-09', '2026-11-16')).toBe(
      "https://olinda.bcb.gov.br/olinda/servico/PTAX/versao/v1/odata/CotacaoDolarPeriodo(dataInicial=@dataInicial,dataFinalCotacao=@dataFinalCotacao)?@dataInicial='11-09-2026'&@dataFinalCotacao='11-16-2026'&$format=json&$select=cotacaoVenda,dataHoraCotacao",
    )
  })
})

describe('getUsdBrl', () => {
  it('linha de hoje buscada há 2 horas não consulta o Banco Central', async () => {
    const db = fxDb([stored('2026-11-16', 5.3655, new Date(NOW.getTime() - 2 * HOURS).toISOString())])
    const fetchFn = vi.fn<typeof fetch>()
    const fx = await getUsdBrl(client(db), { now: NOW, fetchFn })
    expect(fx).toEqual({ rate: 5.3655, date: '2026-11-16', stale: false })
    expect(fetchFn).not.toHaveBeenCalled()
    expect(db.writes).toEqual([])
  })

  it('linha de hoje buscada há 7 horas consulta de novo', async () => {
    const db = fxDb([stored('2026-11-16', 5.3, new Date(NOW.getTime() - 7 * HOURS).toISOString())])
    const fetchFn = bcbReplies(FRIDAY_AND_MONDAY)
    const fx = await getUsdBrl(client(db), { now: NOW, fetchFn })
    expect(fetchFn).toHaveBeenCalledTimes(1)
    expect(fx).toEqual({ rate: 5.3655, date: '2026-11-16', stale: false })
    expect(db.tables.fx_rates.find((r) => r.rate_date === '2026-11-16')).toMatchObject({ usd_brl: 5.3655, fetched_at: NOW.toISOString() })
  })

  it('sem linha consulta o período certo e grava', async () => {
    const db = fxDb()
    const fetchFn = bcbReplies(FRIDAY_AND_MONDAY)
    const fx = await getUsdBrl(client(db), { now: NOW, fetchFn })

    expect(fetchFn).toHaveBeenCalledTimes(1)
    const [url, init] = fetchFn.mock.calls[0]
    expect(url).toBe(ptaxPeriodUrl('2026-11-09', '2026-11-16'))
    expect(String(url)).toContain("'11-09-2026'")
    expect(String(url)).toContain("'11-16-2026'")
    expect(init?.signal).toBeInstanceOf(AbortSignal)

    expect(fx).toEqual({ rate: 5.3655, date: '2026-11-16', stale: false })
    const rows = [...db.tables.fx_rates].sort((a, b) => String(a.rate_date).localeCompare(String(b.rate_date)))
    expect(rows).toEqual([
      { rate_date: '2026-11-13', usd_brl: 5.3712, source: 'bcb_ptax_venda', fetched_at: NOW.toISOString() },
      { rate_date: '2026-11-16', usd_brl: 5.3655, source: 'bcb_ptax_venda', fetched_at: NOW.toISOString() },
    ])
    expect(db.writes.map((w) => `${w.table}:${w.op}`)).toEqual(['fx_rates:upsert'])
  })

  it('à 01:00 de Brasília usa o dia de Brasília', async () => {
    const fetchFn = bcbReplies({ value: [] })
    await getUsdBrl(client(fxDb()), { now: new Date('2026-11-17T04:00:00Z'), fetchFn })
    expect(fetchFn.mock.calls[0][0]).toBe(ptaxPeriodUrl('2026-11-10', '2026-11-17'))
    expect(String(fetchFn.mock.calls[0][0])).toContain("@dataFinalCotacao='11-17-2026'")
  })

  it('às 23:30 de Brasília ainda é o dia anterior, mesmo já sendo o dia seguinte em UTC', async () => {
    const late = new Date('2026-11-17T02:30:00Z')
    const db = fxDb([stored('2026-11-17', 9.99, late.toISOString()), stored('2026-11-16', 5.3655, late.toISOString())])
    const fetchFn = vi.fn<typeof fetch>()
    expect(await getUsdBrl(client(db), { now: late, fetchFn })).toEqual({ rate: 5.3655, date: '2026-11-16', stale: false })
    expect(fetchFn).not.toHaveBeenCalled()

    const empty = bcbReplies({ value: [] })
    await getUsdBrl(client(fxDb()), { now: late, fetchFn: empty })
    expect(empty.mock.calls[0][0]).toBe(ptaxPeriodUrl('2026-11-09', '2026-11-16'))
  })

  it('consulta com tempo esgotado devolve a última guardada como stale', async () => {
    const db = fxDb([stored('2026-11-10', 5.3, '2026-11-10T16:00:00.000Z')])
    let signal: AbortSignal | undefined
    // nunca responde e ignora o aviso de cancelar: o teto vale mesmo assim
    const fetchFn = vi.fn<typeof fetch>((_url, init) => {
      signal = init?.signal ?? undefined
      return new Promise<Response>(() => {})
    })
    const fx = await getUsdBrl(client(db), { now: NOW, fetchFn, timeoutMs: 20 })
    expect(fx).toEqual({ rate: 5.3, date: '2026-11-10', stale: true })
    expect(signal?.aborted).toBe(true)
    expect(db.writes).toEqual([])
  })

  it('Banco Central com erro HTTP devolve a última guardada como stale', async () => {
    const db = fxDb([stored('2026-11-13', 5.3712, '2026-11-13T18:00:00.000Z')])
    const fx = await getUsdBrl(client(db), { now: NOW, fetchFn: bcbReplies({ erro: 'fora' }, 503) })
    expect(fx).toEqual({ rate: 5.3712, date: '2026-11-13', stale: true })
    expect(db.writes).toEqual([])
  })

  it('resposta vazia no fim de semana devolve a última guardada', async () => {
    const sunday = new Date('2026-11-15T15:00:00Z')
    const db = fxDb([stored('2026-11-13', 5.3712, '2026-11-14T01:00:00.000Z')])
    const fx = await getUsdBrl(client(db), { now: sunday, fetchFn: bcbReplies({ value: [] }) })
    expect(fx).toEqual({ rate: 5.3712, date: '2026-11-13', stale: true })
    expect(db.writes).toEqual([])
  })

  it('cotação zero ou negativa é ignorada', async () => {
    const db = fxDb()
    const fetchFn = bcbReplies({
      value: [
        { cotacaoVenda: 5.3712, dataHoraCotacao: '2026-11-13 13:09:27.531' },
        { cotacaoVenda: -1, dataHoraCotacao: '2026-11-14 13:00:00.000' },
        { cotacaoVenda: 0, dataHoraCotacao: '2026-11-16 13:04:11.002' },
      ],
    })
    expect(await getUsdBrl(client(db), { now: NOW, fetchFn })).toEqual({ rate: 5.3712, date: '2026-11-13', stale: false })
    expect(db.tables.fx_rates.map((r) => r.rate_date)).toEqual(['2026-11-13'])

    // só cotação inválida conta como resposta vazia
    const old = fxDb([stored('2026-11-10', 5.3, '2026-11-10T16:00:00.000Z')])
    const onlyZero = bcbReplies({ value: [{ cotacaoVenda: 0, dataHoraCotacao: '2026-11-16 13:04:11.002' }] })
    expect(await getUsdBrl(client(old), { now: NOW, fetchFn: onlyZero })).toEqual({ rate: 5.3, date: '2026-11-10', stale: true })
    expect(old.writes).toEqual([])
  })

  it('dois valores do mesmo dia gravam uma linha só, a mais tarde', async () => {
    const db = fxDb()
    const fetchFn = bcbReplies({
      value: [
        { cotacaoVenda: 5.37, dataHoraCotacao: '2026-11-16 13:04:11.002' },
        { cotacaoVenda: 5.36, dataHoraCotacao: '2026-11-16 10:00:00.000' },
      ],
    })
    expect(await getUsdBrl(client(db), { now: NOW, fetchFn })).toEqual({ rate: 5.37, date: '2026-11-16', stale: false })
    expect(db.writes[0].payload).toEqual([{ rate_date: '2026-11-16', usd_brl: 5.37, source: 'bcb_ptax_venda', fetched_at: NOW.toISOString() }])
  })

  it('sem nada guardado e sem consulta devolve null', async () => {
    const fetchFn = vi.fn<typeof fetch>(async () => { throw new TypeError('fetch failed') })
    await expect(getUsdBrl(client(fxDb()), { now: NOW, fetchFn })).resolves.toBeNull()
    expect(fetchFn).toHaveBeenCalledTimes(1)
  })

  it('erro do banco não lança: sem leitura e sem consulta devolve null, com consulta devolve a nova', async () => {
    const broken = fxDb()
    broken.failTable('fx_rates', { message: 'relation "fx_rates" does not exist' })
    const down = vi.fn<typeof fetch>(async () => { throw new TypeError('fetch failed') })
    await expect(getUsdBrl(client(broken), { now: NOW, fetchFn: down })).resolves.toBeNull()
    await expect(getUsdBrl(client(broken), { now: NOW, fetchFn: bcbReplies(FRIDAY_AND_MONDAY) })).resolves.toEqual({ rate: 5.3655, date: '2026-11-16', stale: false })
  })
})

describe('getStoredUsdBrl', () => {
  it('getStoredUsdBrl nunca consulta o Banco Central', async () => {
    const globalFetch = vi.fn<typeof fetch>()
    vi.stubGlobal('fetch', globalFetch)
    const fresh = fxDb([stored('2026-11-16', 5.3655, new Date(NOW.getTime() - 2 * HOURS).toISOString())])
    expect(await getStoredUsdBrl(client(fresh), NOW)).toEqual({ rate: 5.3655, date: '2026-11-16', stale: false })

    const old = fxDb([stored('2026-11-13', 5.3712, '2026-11-13T18:00:00.000Z'), stored('2026-11-12', 5.4, '2026-11-12T18:00:00.000Z')])
    expect(await getStoredUsdBrl(client(old), NOW)).toEqual({ rate: 5.3712, date: '2026-11-13', stale: true })
    expect(globalFetch).not.toHaveBeenCalled()
    expect(old.writes).toEqual([])
  })

  it('usa o dia de Brasília pra escolher a linha', async () => {
    const late = new Date('2026-11-17T02:30:00Z') // 23:30 do dia 16 em Brasília
    const db = fxDb([stored('2026-11-17', 9.99, late.toISOString()), stored('2026-11-16', 5.3655, late.toISOString())])
    expect(await getStoredUsdBrl(client(db), late)).toEqual({ rate: 5.3655, date: '2026-11-16', stale: false })
  })

  it('devolve null sem nada guardado', async () => {
    expect(await getStoredUsdBrl(client(fxDb()), NOW)).toBeNull()
  })

  it('erro do banco devolve null', async () => {
    const db = fxDb([stored('2026-11-16', 5.3655, NOW.toISOString())])
    db.failTable('fx_rates', { message: 'permission denied for table fx_rates' })
    await expect(getStoredUsdBrl(client(db), NOW)).resolves.toBeNull()
  })
})

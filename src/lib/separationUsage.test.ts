import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const rpc = vi.fn()
const getSession = vi.fn()
const profileRead = vi.fn()
const reads: { table: string; cols: string; col: string; value: string }[] = []
vi.mock('./supabase', () => ({
  supabase: {
    rpc: (...a: unknown[]) => rpc(...a),
    auth: { getSession: () => getSession() },
    from: (table: string) => ({
      select: (cols: string) => ({
        eq: (col: string, value: string) => ({
          maybeSingle: () => {
            reads.push({ table, cols, col, value })
            return profileRead()
          },
        }),
      }),
    }),
  },
}))

import { brtMonth, fetchMonthlyQuota, fetchQuotaBonus, fetchSeparationUsage, formatDateBR, monthlyLimit, QUOTA_BONUS_TIMEOUT_MS } from './separationUsage'

const TRAVESSAO = String.fromCharCode(0x2014)

beforeEach(() => {
  rpc.mockReset()
  getSession.mockReset()
  getSession.mockResolvedValue({ data: { session: { user: { id: 'u1' } } }, error: null })
  profileRead.mockReset()
  profileRead.mockResolvedValue({ data: null, error: null })
  reads.length = 0
})

describe('fetchSeparationUsage', () => {
  it('lê o contador do mês no banco pelo RPC get_my_separation_usage', async () => {
    rpc.mockResolvedValue({
      data: [{ used: 2, period_start: '2026-11-01T03:00:00+00:00', resets_at: '2026-12-01T03:00:00+00:00' }],
      error: null,
    })
    await expect(fetchSeparationUsage()).resolves.toEqual({
      used: 2,
      periodStart: '2026-11-01T03:00:00+00:00',
      resetsAt: '2026-12-01T03:00:00+00:00',
    })
    expect(rpc).toHaveBeenCalledWith('get_my_separation_usage')
  })

  it('devolve null quando o banco falha (a tela mostra que não deu pra carregar)', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'boom' } })
    await expect(fetchSeparationUsage()).resolves.toBeNull()
  })

  it('devolve null com resposta fora do formato', async () => {
    rpc.mockResolvedValue({ data: [{ used: 'dois' }], error: null })
    await expect(fetchSeparationUsage()).resolves.toBeNull()
  })
})

describe('formatDateBR', () => {
  it('mostra a data no horário de Brasília', () => {
    // 1º de dezembro 00:00 em Brasília = 03:00 UTC
    expect(formatDateBR('2026-12-01T03:00:00Z')).toBe('01/12/2026')
    // 02:59 UTC ainda é 30/11 em Brasília
    expect(formatDateBR('2026-12-01T02:59:00Z')).toBe('30/11/2026')
  })
})

describe('brtMonth', () => {
  it('usa o mês de Brasília, não o de UTC', () => {
    // 23:30 de 30/11 em Brasília já é 01/12 em UTC
    expect(brtMonth('2026-12-01T02:30:00Z')).toBe('2026-11')
    expect(brtMonth(new Date('2026-12-01T03:00:00Z'))).toBe('2026-12')
    expect(brtMonth('2026-11-01T03:00:00+00:00')).toBe('2026-11')
  })
})

describe('monthlyLimit', () => {
  it("monthlyLimit('free', 10) dá 15", () => {
    expect(monthlyLimit('free', 10)).toBe(15)
  })

  it('sem extra é o limite do plano de hoje', () => {
    expect(monthlyLimit('free', 0)).toBe(5)
    expect(monthlyLimit('essencial_mensal', 0)).toBe(50)
    expect(monthlyLimit('pro_anual', 0)).toBe(150)
  })

  it('extra estranho nunca deixa o limite menor que o do plano', () => {
    expect(monthlyLimit('free', -3)).toBe(5)
    expect(monthlyLimit('free', Number.NaN)).toBe(5)
  })

  it('o Separador barra pelo limite com o bônus', () => {
    // Complemento do teste de fetchMonthlyQuota (abaixo): a checagem antes de subir o arquivo
    // usa o total com o extra do mês, pela mesma função.
    const studio = readFileSync(join(process.cwd(), 'src/components/SeparatorStudio.tsx'), 'utf8')
    expect(studio).toMatch(/const \{ usage, limit: maxLimit \} = await fetchMonthlyQuota\(userPlan\)/)
    expect(studio).toMatch(/if \(usage && usage\.used >= maxLimit\)/)
    expect(studio).toContain('Você já usou as ${maxLimit} separações deste mês.')
    expect(studio).not.toMatch(/maxSeparationsPerMonth\(userPlan\)/)
  })
})

describe('fetchQuotaBonus', () => {
  const NOV = '2026-11-01T03:00:00+00:00'
  const OUT = '2026-10-01T03:00:00+00:00'

  it('lê a cota extra da própria linha, pelo id da sessão', async () => {
    profileRead.mockResolvedValue({ data: { quota_bonus: 10, quota_bonus_period: NOV }, error: null })
    await expect(fetchQuotaBonus(new Date('2026-11-17T15:00:00Z'))).resolves.toBe(10)
    expect(reads).toEqual([{ table: 'profiles', cols: 'quota_bonus, quota_bonus_period', col: 'id', value: 'u1' }])
  })

  it('bônus de outubro não vale em novembro', async () => {
    profileRead.mockResolvedValue({ data: { quota_bonus: 10, quota_bonus_period: OUT }, error: null })
    await expect(fetchQuotaBonus(new Date('2026-11-17T15:00:00Z'))).resolves.toBe(0)
  })

  it('bônus de novembro vale às 23:30 do dia 30', async () => {
    profileRead.mockResolvedValue({ data: { quota_bonus: 10, quota_bonus_period: NOV }, error: null })
    // 23:30 de 30/11 em Brasília = 02:30 de 01/12 em UTC
    await expect(fetchQuotaBonus(new Date('2026-12-01T02:30:00Z'))).resolves.toBe(10)
    // meia-noite de 01/12 em Brasília: o extra de novembro some sozinho
    await expect(fetchQuotaBonus(new Date('2026-12-01T03:00:00Z'))).resolves.toBe(0)
  })

  it('coluna ausente (SQL ainda não rodou) ou erro do banco dá 0', async () => {
    profileRead.mockResolvedValue({ data: null, error: { code: '42703', message: 'column profiles.quota_bonus does not exist' } })
    await expect(fetchQuotaBonus()).resolves.toBe(0)
    profileRead.mockResolvedValue({ data: { quota_bonus: 10, quota_bonus_period: NOV }, error: { message: 'permission denied' } })
    await expect(fetchQuotaBonus(new Date('2026-11-17T15:00:00Z'))).resolves.toBe(0)
    profileRead.mockRejectedValue(new Error('rede caiu'))
    await expect(fetchQuotaBonus()).resolves.toBe(0)
  })

  it('sem sessão, sem linha ou com valor fora do formato dá 0', async () => {
    getSession.mockResolvedValue({ data: { session: null }, error: null })
    await expect(fetchQuotaBonus()).resolves.toBe(0)
    expect(reads).toEqual([])

    getSession.mockResolvedValue({ data: { session: { user: { id: 'u1' } } }, error: null })
    profileRead.mockResolvedValue({ data: null, error: null })
    await expect(fetchQuotaBonus()).resolves.toBe(0)
    for (const row of [
      { quota_bonus: 0, quota_bonus_period: NOV },
      { quota_bonus: -5, quota_bonus_period: NOV },
      { quota_bonus: 'dez', quota_bonus_period: NOV },
      { quota_bonus: 10, quota_bonus_period: null },
      { quota_bonus: 10, quota_bonus_period: 'ontem' },
    ]) {
      profileRead.mockResolvedValue({ data: row, error: null })
      await expect(fetchQuotaBonus(new Date('2026-11-17T15:00:00Z'))).resolves.toBe(0)
    }
    getSession.mockRejectedValue(new Error('sessão quebrada'))
    await expect(fetchQuotaBonus()).resolves.toBe(0)
  })

  it('o texto deste módulo não tem travessão', () => {
    const src = readFileSync(join(process.cwd(), 'src/lib/separationUsage.ts'), 'utf8')
    expect(src).not.toContain(TRAVESSAO)
  })
})

describe('teto da cota extra (Ruling ADM-T27-bonus)', () => {
  const NOV = '2026-11-01T03:00:00+00:00'
  const USAGE_ROW = { used: 5, period_start: NOV, resets_at: '2026-12-01T03:00:00+00:00' }
  // Leitura da cota extra pendurada até o teste soltar.
  const hangBonus = (row: unknown) => {
    let release = () => {}
    const held = new Promise<void>((r) => { release = r })
    profileRead.mockImplementation(async () => { await held; return { data: row, error: null } })
    return () => release()
  }

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-11-17T15:00:00Z'))
    rpc.mockResolvedValue({ data: [USAGE_ROW], error: null })
  })
  afterEach(() => { vi.useRealTimers() })

  it('o teto é de 4 s', () => {
    expect(QUOTA_BONUS_TIMEOUT_MS).toBe(4000)
  })

  it('leitura pendurada: 0 aos 4 s, e a resposta atrasada não muda o resultado', async () => {
    const release = hangBonus({ quota_bonus: 10, quota_bonus_period: NOV })
    let result: unknown = 'pendente'
    void fetchQuotaBonus().then((r) => { result = r })
    await vi.advanceTimersByTimeAsync(QUOTA_BONUS_TIMEOUT_MS - 1)
    expect(result).toBe('pendente')
    await vi.advanceTimersByTimeAsync(1)
    expect(result).toBe(0)
    release()
    await vi.advanceTimersByTimeAsync(0)
    expect(result).toBe(0)
  })

  it('leitura rápida devolve o extra e não deixa relógio ligado', async () => {
    profileRead.mockResolvedValue({ data: { quota_bonus: 10, quota_bonus_period: NOV }, error: null })
    await expect(fetchQuotaBonus()).resolves.toBe(10)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('com a cota extra pendurada, o Separador fica pronto aos 4 s com o limite do plano', async () => {
    hangBonus({ quota_bonus: 10, quota_bonus_period: NOV })
    let ready: unknown = 'pendente'
    void fetchMonthlyQuota('free').then((r) => { ready = r })
    await vi.advanceTimersByTimeAsync(QUOTA_BONUS_TIMEOUT_MS - 1)
    expect(ready).toBe('pendente')
    await vi.advanceTimersByTimeAsync(1)
    expect(ready).toEqual({
      usage: { used: 5, periodStart: NOV, resetsAt: '2026-12-01T03:00:00+00:00' },
      limit: 5,
    })
  })

  it('com a cota extra lida a tempo, o limite do Separador soma o extra', async () => {
    profileRead.mockResolvedValue({ data: { quota_bonus: 10, quota_bonus_period: NOV }, error: null })
    await expect(fetchMonthlyQuota('free')).resolves.toEqual({
      usage: { used: 5, periodStart: NOV, resetsAt: '2026-12-01T03:00:00+00:00' },
      limit: 15,
    })
  })

  it('leitura da cota extra que falha: o Separador segue com o limite do plano', async () => {
    profileRead.mockRejectedValue(new Error('rede caiu'))
    await expect(fetchMonthlyQuota('pro_mensal')).resolves.toMatchObject({ limit: 150 })
  })
})

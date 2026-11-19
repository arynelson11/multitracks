import { maxSeparationsPerMonth } from './plans'
import { supabase } from './supabase'

// Contador de separações do mês, lido do banco (a fonte de verdade).
// A cota é por mês civil no horário de Brasília e volta a zero todo dia 1º
// (regra em db/supabase_cota_mensal.sql). Antes a aba Assinatura lia um
// contador do navegador, que não batia entre aparelhos e nunca zerava.

export type SeparationUsage = {
  used: number
  periodStart: string
  resetsAt: string
}

type UsageRow = { used?: unknown; period_start?: unknown; resets_at?: unknown }

export async function fetchSeparationUsage(): Promise<SeparationUsage | null> {
  if (!supabase) return null
  try {
    const { data, error } = await supabase.rpc('get_my_separation_usage')
    if (error || !data) return null
    const row: UsageRow | undefined = Array.isArray(data) ? data[0] : data
    if (!row || typeof row.used !== 'number' || typeof row.resets_at !== 'string' || typeof row.period_start !== 'string') return null
    return { used: row.used, periodStart: row.period_start, resetsAt: row.resets_at }
  } catch {
    return null
  }
}

const BR_DATE = new Intl.DateTimeFormat('pt-BR', {
  timeZone: 'America/Sao_Paulo',
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
})

// Data no formato dd/mm/aaaa, sempre no horário de Brasília.
export function formatDateBR(value: string | Date): string {
  return BR_DATE.format(typeof value === 'string' ? new Date(value) : value)
}

// ── Cota extra do mês (o admin "Somar N") ──
// Mesma regra do servidor (brtMonth e quotaBonusFor em api/_lib/plan.ts): o extra só vale
// no mês de Brasília em que o admin deu e some sozinho no dia 1º. O front não importa de
// api/, por isso a cópia.

const BRT_DAY = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Sao_Paulo',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

function brtParts(at: Date | string): { year: string; month: string; day: string } {
  const parts = BRT_DAY.formatToParts(new Date(at))
  const get = (type: string) => parts.find((x) => x.type === type)?.value ?? ''
  return { year: get('year'), month: get('month'), day: get('day') }
}

// "AAAA-MM" do mês de Brasília (23:30 de 30/11 em Brasília já é 01/12 em UTC).
export function brtMonth(at: Date | string): string {
  const p = brtParts(at)
  return `${p.year}-${p.month}`
}

// "AAAA-MM-DD" do dia de Brasília, com o mesmo formatador: o dia vira à meia-noite de
// Brasília (03:00 UTC). Usado pelos minutos do Ao Vivo e pelo anúncio do Livre.
export function brtDay(at: Date | string): string {
  const p = brtParts(at)
  return `${p.year}-${p.month}-${p.day}`
}

type QuotaBonusRow = { quota_bonus?: unknown; quota_bonus_period?: unknown }

function bonusFor(row: QuotaBonusRow, now: Date): number {
  const bonus = typeof row.quota_bonus === 'number' ? row.quota_bonus : Number.NaN
  const period = row.quota_bonus_period
  if (!Number.isFinite(bonus) || bonus <= 0 || typeof period !== 'string' || Number.isNaN(Date.parse(period))) return 0
  return brtMonth(period) === brtMonth(now) ? Math.trunc(bonus) : 0
}

// Teto da leitura da cota extra (Ruling ADM-T27-bonus): a separação nunca espera por ela.
export const QUOTA_BONUS_TIMEOUT_MS = 4000

// Separações extras do mês dadas pelo admin, lidas da própria linha do perfil (a RLS só
// deixa ler a própria). Sem sessão, erro, coluna ausente (SQL do admin ainda não rodou),
// extra de outro mês ou leitura que passou de 4 s: 0, e vale o limite do plano, como antes
// do admin. A resposta que chega depois do teto é descartada.
export function fetchQuotaBonus(now: Date = new Date()): Promise<number> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(0), QUOTA_BONUS_TIMEOUT_MS)
    const done = (bonus: number) => {
      clearTimeout(timer)
      resolve(bonus)
    }
    readQuotaBonus(now).then(done, () => done(0))
  })
}

async function readQuotaBonus(now: Date): Promise<number> {
  if (!supabase) return 0
  try {
    const { data } = await supabase.auth.getSession()
    const userId = data.session?.user?.id
    if (!userId) return 0
    const res: { data: QuotaBonusRow | null; error: unknown } = await supabase
      .from('profiles')
      .select('quota_bonus, quota_bonus_period')
      .eq('id', userId)
      .maybeSingle()
    if (res.error || !res.data) return 0
    return bonusFor(res.data, now)
  } catch {
    return 0
  }
}

// Limite do mês: o do plano mais o extra do mês. Extra estranho (negativo, NaN) conta como 0,
// então o limite nunca fica menor que o do plano.
export function monthlyLimit(plan: string, bonus: number): number {
  return maxSeparationsPerMonth(plan) + (bonus > 0 ? Math.trunc(bonus) : 0)
}

// O que o Separador confere antes de subir o arquivo: o contador do mês e o limite com o
// extra, lidos juntos. O extra tem teto de 4 s; sem ele, o limite é o do plano.
export async function fetchMonthlyQuota(plan: string): Promise<{ usage: SeparationUsage | null; limit: number }> {
  const [usage, bonus] = await Promise.all([fetchSeparationUsage(), fetchQuotaBonus()])
  return { usage, limit: monthlyLimit(plan, bonus) }
}

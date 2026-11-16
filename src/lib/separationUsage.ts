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

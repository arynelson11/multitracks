import { apiUrl } from './api'
import { getAuthHeaders, supabase } from './supabase'
import { formatDateBR } from './separationUsage'

// Assinatura do próprio usuário (tabela billing_subscriptions; a RLS só deixa
// ler as próprias linhas e só estas colunas) e o cancelamento pelo app.

export type MySubscription = {
  id: string
  kind: 'asaas' | 'courtesy'
  plan_key: string
  cycle: 'MONTHLY' | 'YEARLY' | null
  status: 'active' | 'canceled'
  started_at: string
  next_due_date: string | null
  paid_until: string | null
  access_until: string | null
  cancel_source: string | null
  canceled_at: string | null
  created_at: string
}

const COLS = 'id, kind, plan_key, cycle, status, started_at, next_due_date, paid_until, access_until, cancel_source, canceled_at, created_at'

// A assinatura que vale: a ativa mais recente; senão, a mais recente.
export async function fetchMySubscription(): Promise<MySubscription | null> {
  if (!supabase) return null
  try {
    const { data, error } = await supabase.from('billing_subscriptions').select(COLS)
    if (error || !Array.isArray(data) || data.length === 0) return null
    const rows = (data as MySubscription[]).slice().sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
    return rows.find((r) => r.status === 'active') ?? rows[0]
  } catch {
    return null
  }
}

export type CancelOutcome = {
  result: 'canceled' | 'already_canceled'
  accessUntil: string | null
  refunded: boolean
  plan: string
}

export async function cancelMySubscription(): Promise<{ ok: true; data: CancelOutcome } | { ok: false; error: string }> {
  try {
    const res = await fetch(apiUrl('/api/checkout?action=cancel'), { method: 'POST', headers: await getAuthHeaders(), body: '{}' })
    const body = await res.json().catch(() => ({}))
    if (!res.ok) {
      return { ok: false, error: typeof body?.error === 'string' ? body.error : 'Não deu para cancelar agora. Tente de novo em alguns minutos.' }
    }
    return { ok: true, data: body as CancelOutcome }
  } catch {
    return { ok: false, error: 'Sem conexão com o servidor. Sua assinatura não foi cancelada e nada mudou. Confira a internet e tente de novo.' }
  }
}

// O fim guardado é o começo do dia seguinte ao último dia com acesso.
export function accessDateLabel(accessUntil: string): string {
  return formatDateBR(new Date(Date.parse(accessUntil) - 1000))
}

function brtToday(now: Date): string {
  return new Date(now.getTime() - 3 * 3600_000).toISOString().slice(0, 10)
}

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400_000)
}

export const RENEWAL_NOTICE_DAYS = 3

// Aviso dentro do app pro plano MENSAL: de 3 dias antes até o dia do vencimento.
export function renewalNotice(sub: MySubscription | null, now: Date = new Date()): { daysLeft: number; dueDate: string } | null {
  if (!sub || sub.kind !== 'asaas' || sub.status !== 'active' || sub.cycle !== 'MONTHLY' || !sub.next_due_date) return null
  const daysLeft = daysBetween(brtToday(now), sub.next_due_date)
  if (daysLeft < 0 || daysLeft > RENEWAL_NOTICE_DAYS) return null
  return { daysLeft, dueDate: sub.next_due_date }
}

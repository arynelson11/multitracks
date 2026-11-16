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

// A assinatura que vale pra tela: a PAGA ativa mais recente (uma cortesia não
// esconde uma assinatura que segue cobrando); senão a cortesia ativa; senão a
// mais recente.
export async function fetchMySubscription(): Promise<MySubscription | null> {
  if (!supabase) return null
  try {
    const { data, error } = await supabase.from('billing_subscriptions').select(COLS)
    if (error || !Array.isArray(data) || data.length === 0) return null
    const rows = (data as MySubscription[]).slice().sort((a, b) => (a.started_at < b.started_at ? 1 : -1))
    return rows.find((r) => r.status === 'active' && r.kind === 'asaas')
      ?? rows.find((r) => r.status === 'active')
      ?? rows[0]
  } catch {
    return null
  }
}

// Todas as assinaturas da pessoa (a aba decide por elas, não pelo perfil).
export async function fetchMySubscriptions(): Promise<MySubscription[] | null> {
  if (!supabase) return null
  try {
    const { data, error } = await supabase.from('billing_subscriptions').select(COLS)
    if (error || !Array.isArray(data)) return null
    return (data as MySubscription[]).slice().sort((a, b) => (a.started_at < b.started_at ? 1 : -1))
  } catch {
    return null
  }
}

export type CancelOutcome = {
  result: 'canceled' | 'already_canceled'
  accessUntil: string | null
  refunded: boolean          // estorno automático feito
  refundRequested?: boolean  // pedido de estorno foi pra equipe (não é a 1ª assinatura)
  refundFailed?: boolean     // estorno recusado: a equipe faz à mão
  pendingStop?: boolean      // confirmação com o sistema de pagamento ficou pendente
  plan: string
}

// O que o cancelamento faria pra esta pessoa (servidor, sem mudar nada).
export type CancelPreview = {
  outcome: 'none' | 'refund_auto' | 'refund_request' | 'until_period_end'
  plan: string | null
  accessUntil: string | null
  amount: number | null
}

export async function fetchCancelPreview(): Promise<CancelPreview | null> {
  try {
    const res = await fetch(apiUrl('/api/checkout?action=cancel-preview'), { method: 'POST', headers: await getAuthHeaders(), body: '{}' })
    if (!res.ok) return null
    const body = await res.json().catch(() => null)
    return body && typeof body.outcome === 'string' ? (body as CancelPreview) : null
  } catch {
    return null
  }
}

const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })
export function formatBRL(value: number): string {
  return BRL.format(value).replace(/\u00a0/g, ' ')
}

// Linha da confirmação com o desfecho certo pra esta pessoa.
export function cancelOutcomeLine(p: CancelPreview, planName: string): string {
  const amount = p.amount != null ? ` ${formatBRL(p.amount)}` : ' o valor'
  if (p.outcome === 'refund_auto') {
    return `Como esta é sua primeira assinatura e faz até 7 dias da compra, devolvemos${amount} no cartão e a conta volta para o Livre na hora.`
  }
  if (p.outcome === 'refund_request') {
    const until = p.accessUntil ? ` até ${accessDateLabel(p.accessUntil)}` : ' até o fim do período pago'
    return `Você assinou há até 7 dias, mas esta não é sua primeira assinatura, então o estorno não é automático: o pedido vai para a nossa equipe, que te responde pelo e-mail da conta. Enquanto isso você continua com o ${planName}${until}.`
  }
  const until = p.accessUntil ? `até ${accessDateLabel(p.accessUntil)}` : 'até o fim do período que já pagou'
  return `Você continua com o ${planName} ${until}. Depois disso a conta volta para o Livre (5 separações por mês, em 2 faixas).`
}

// Aviso de "Excluir minha conta" pra quem tem plano pago.
export function deleteAccountNotice(p: CancelPreview | null, plan: string): string {
  const base = 'Sua assinatura é cancelada na hora e nada mais é cobrado.'
  if (p?.outcome === 'refund_auto') {
    return `${base} Como é sua primeira assinatura e faz até 7 dias da compra, devolvemos ${p.amount != null ? formatBRL(p.amount) : 'o valor'} no cartão.`
  }
  if (p?.outcome === 'refund_request') {
    return `${base} Você assinou há até 7 dias, mas não é sua primeira assinatura: o pedido de estorno vai para a nossa equipe aprovar.`
  }
  if (p?.outcome === 'until_period_end') {
    const until = p.accessUntil ? `, que ia até ${accessDateLabel(p.accessUntil)}` : ''
    const value = p.amount != null ? ` (${formatBRL(p.amount)})` : ''
    return `${base} O período já pago${until}${value} é perdido, sem devolução.`
  }
  void plan
  return `${base} Fora do prazo de 7 dias da primeira compra, o tempo que você já pagou e ainda não usou é perdido, sem devolução (no anual, o resto do ano).`
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

const BRT_DAY = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' })

// Dia (AAAA-MM-DD) no fuso America/Sao_Paulo, nunca o de UTC.
export function brtTodayKey(now: Date = new Date()): string {
  const parts = BRT_DAY.formatToParts(now)
  const get = (type: string) => parts.find((x) => x.type === type)?.value ?? ''
  return `${get('year')}-${get('month')}-${get('day')}`
}

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400_000)
}

export const RENEWAL_NOTICE_DAYS = 3

// Aviso dentro do app pro plano MENSAL: de 3 dias antes até o dia do vencimento.
export function renewalNotice(sub: MySubscription | null, now: Date = new Date()): { daysLeft: number; dueDate: string } | null {
  if (!sub || sub.kind !== 'asaas' || sub.status !== 'active' || sub.cycle !== 'MONTHLY' || !sub.next_due_date) return null
  const daysLeft = daysBetween(brtTodayKey(now), sub.next_due_date)
  if (daysLeft < 0 || daysLeft > RENEWAL_NOTICE_DAYS) return null
  return { daysLeft, dueDate: sub.next_due_date }
}

// No login: pede pro servidor tentar de novo as pendências deste usuário com o
// Asaas (ex.: parar uma assinatura antiga). Uma vez por usuário por abertura do
// app; erro é ignorado (o job diário também tenta).
const synced = new Set<string>()
export async function syncBillingOnLogin(userId: string): Promise<void> {
  if (synced.has(userId)) return
  synced.add(userId)
  try {
    await fetch(apiUrl('/api/checkout?action=sync'), { method: 'POST', headers: await getAuthHeaders(), body: '{}' })
  } catch { /* o job diário tenta de novo */ }
}

// Frases das confirmações da ficha do assinante (T26): cada uma diz o efeito no Asaas e no app
// antes do Confirmar. Preço sempre da tabela que a ficha traz (detail.plans), datas por fmtDay e o
// último dia da cortesia contado em Brasília (hoje + N, como o servidor).
import { fmtBRL, fmtDay, planLabel } from './fmt'
import { addDaysLocal, brtTodayLocal } from './period'

/** Preço de um plano como a ficha traz (value null quando a tabela não tem o plano). */
export type PlanPrice = { label: string; value: number | null; cycle: string | null }

const CYCLE_WORD: Record<string, string> = { MONTHLY: 'por mês', YEARLY: 'por ano' }

function priced(p: PlanPrice): string {
  if (p.value === null || !Number.isFinite(p.value)) return p.label
  const per = p.cycle ? CYCLE_WORD[p.cycle] : undefined
  return `${p.label} (${fmtBRL(p.value)}${per ? ` ${per}` : ''})`
}

// Mesmo nível do servidor (billing_plan_rank): Studio 2, Pro 1, o resto 0.
export function planRank(plan: string | null): number {
  if (plan === 'pro_mensal' || plan === 'pro_anual') return 2
  if (plan === 'essencial_mensal' || plan === 'essencial_anual') return 1
  return 0
}

/** `nextDueDate` é o vencimento da próxima cobrança (AAAA-MM-DD). */
export function changePlanText(cur: PlanPrice, next: PlanPrice, nextDueDate: string | null): string {
  const when = nextDueDate ? `a partir da próxima cobrança, em ${fmtDay(nextDueDate)}.` : 'a partir da próxima cobrança.'
  return `A assinatura no Asaas passa de ${priced(cur)} para ${priced(next)} ${when} O acesso muda agora. Não há cobrança nem desconto proporcional.`
}

/** Último dia da cortesia de N dias: hoje mais N em Brasília (AAAA-MM-DD). */
export function courtesyLastDay(days: number, now: Date = new Date()): string {
  return addDaysLocal(brtTodayLocal(now), days)
}

/**
 * Dar cortesia. `lastDay` é o último dia (AAAA-MM-DD) ou null sem data; `paidPlan` é o plano da
 * assinatura paga ativa, que continua sendo cobrada.
 */
export function courtesyText(plan: string, lastDay: string | null, paidPlan: string | null): string {
  const name = planLabel(plan)
  let text = lastDay
    ? `${name} sem cobrança até ${fmtDay(lastDay)} (fim do dia). Nada muda no Asaas. ` +
      (paidPlan
        ? `No fim, a conta volta para o ${planLabel(paidPlan)}, que continua sendo cobrado normalmente.`
        : 'No fim, a conta volta sozinha para o Livre.')
    : `${name} sem cobrança e sem data para acabar. Nada muda no Asaas. Para encerrar, use Encerrar cortesia.`
  if (paidPlan && planRank(plan) <= planRank(paidPlan)) {
    text += ' A cortesia de um plano igual ou menor que o pago não muda nada para esta conta.'
  }
  return text
}

/** O que a conta tem quando a cortesia acaba: o plano que vale depois dela. */
export type AfterCourtesy =
  | { kind: 'free' }
  | { kind: 'paid'; planKey: string }
  | { kind: 'paid_until'; planKey: string; lastDay: string }
  | { kind: 'courtesy'; planKey: string }

export function endCourtesyText(plan: string, after: AfterCourtesy): string {
  const start = `A cortesia de ${planLabel(plan)} acaba agora. Nada muda no Asaas.`
  switch (after.kind) {
    case 'paid':
      return `${start} A conta volta para o ${planLabel(after.planKey)} pago.`
    case 'paid_until':
      return `${start} A conta volta para o ${planLabel(after.planKey)} pago até ${fmtDay(after.lastDay)} e depois para o Livre.`
    case 'courtesy':
      return `${start} A conta fica com a outra cortesia, de ${planLabel(after.planKey)}.`
    default:
      return `${start} A conta volta para o Livre.`
  }
}

/**
 * Cancelar a assinatura paga. `lastPaidDay` é o último dia já pago (AAAA-MM-DD) ou null sem
 * período pago pela frente (aí o servidor fecha o acesso na hora, mesmo no fim do período).
 */
export function cancelText(when: 'now' | 'period_end', plan: string, lastPaidDay: string | null): string {
  if (when === 'now') {
    return 'A assinatura é removida no Asaas agora e a conta volta para o Livre na hora. Nenhum estorno é feito; se precisar devolver dinheiro, estorne no painel do Asaas.'
  }
  const stays = lastPaidDay
    ? `A conta continua no ${planLabel(plan)} até ${fmtDay(lastPaidDay)} e depois volta para o Livre.`
    : 'Não há período pago pela frente, então a conta volta para o Livre agora.'
  return `A renovação para agora no Asaas e nada mais é cobrado. ${stays} Nenhum estorno é feito.`
}

/** O instante ainda não chegou (fim de acesso, de período pago ou de cortesia). */
export function isFuture(at: string | null, now: Date = new Date()): boolean {
  if (!at) return false
  const t = Date.parse(at)
  return !Number.isNaN(t) && t > now.getTime()
}

/** Último dia (AAAA-MM-DD, Brasília) de um fim guardado como o começo do dia seguinte. */
export function lastDayOf(end: string | null): string | null {
  if (!end) return null
  const t = Date.parse(end)
  return Number.isNaN(t) ? null : brtTodayLocal(new Date(t - 1000))
}

/** O bloqueio só avisa: a cobrança continua (D10). */
export const BILLING_CONTINUES = 'A cobrança no Asaas continua. Para parar de cobrar, cancele a assinatura também.'

/**
 * Assinante antigo (D18, Ruling ADM-T26-legado): pode haver uma cobrança de antes da Fase 3 no
 * Asaas, sem linha no app, que o bloqueio também não para.
 */
export const LEGACY_BILLING_WARNING =
  'Esta conta pode ter uma cobrança antiga no Asaas que o app não controla. Bloquear não para essa cobrança; confira no painel do Asaas.'

/**
 * A mesma regra do "antigo" da lista (T21): plano pago valendo no perfil, nenhuma linha de
 * assinatura no Asaas (de qualquer status) e nenhuma cortesia ativa.
 */
export function isLegacyPaid(
  profile: { plan: string; planExpiresAt: string | null },
  subscriptions: { kind: string; status: string; accessUntil: string | null }[],
  now: Date = new Date(),
): boolean {
  const plan = profile.planExpiresAt !== null && !isFuture(profile.planExpiresAt, now) ? 'free' : profile.plan
  if (planRank(plan) === 0) return false
  if (subscriptions.some((s) => s.kind === 'asaas')) return false
  return !subscriptions.some((s) => s.kind === 'courtesy' && s.status === 'active' && (s.accessUntil === null || isFuture(s.accessUntil, now)))
}

const BLOCK_EFFECT = 'A pessoa perde o acesso ao app agora: separar, biblioteca em nuvem, enviar arquivos e assinar.'

export function blockText(hasActivePaid: boolean): string {
  return hasActivePaid ? `${BLOCK_EFFECT} ${BILLING_CONTINUES}` : BLOCK_EFFECT
}

export function unblockText(): string {
  return 'O acesso volta agora. Nada muda no Asaas.'
}

/**
 * Ajustar a cota do mês. `limit` é o do plano (sem o extra) e `bonus` o extra que já vale neste
 * mês: o limite de agora é a soma dos dois. `lastDay` é o último dia do mês (AAAA-MM-DD).
 */
export function quotaText(mode: 'reset' | 'add', used: number, limit: number, bonus: number, amount: number | null, lastDay: string): string {
  const now = limit + bonus
  if (mode === 'reset') return `O contador deste mês volta de ${used} para 0 (limite ${now}). Nada muda no Asaas.`
  const n = amount ?? 0
  const what = n === 1 ? '1 separação' : `${n} separações`
  return `Mais ${what} só neste mês: o limite vai de ${now} para ${now + n} até ${fmtDay(lastDay)}. Nada muda no Asaas.`
}

const field = (out: unknown, key: string): unknown =>
  out && typeof out === 'object' ? (out as Record<string, unknown>)[key] : undefined

/** Frase depois de a ação dar certo: "Feito.", ou o que a resposta diz que não mudou ou ficou pendente. */
export function doneText(action: string, out: unknown): string {
  const result = field(out, 'result')
  if (action === 'change-plan' && result === 'unchanged') return 'Feito. A conta já estava neste plano; nada mudou.'
  if (action === 'cancel-subscription') {
    if (result === 'already_canceled') return 'Feito. A assinatura já estava cancelada; nada mudou.'
    if (field(out, 'pendingStop') === true) {
      return 'Feito. Parar a cobrança no Asaas ficou pendente e o app tenta de novo sozinho; acompanhe em Pendências.'
    }
  }
  if (action === 'end-courtesy' && result === 'already_canceled') return 'Feito. A cortesia já estava encerrada; nada mudou.'
  return 'Feito.'
}

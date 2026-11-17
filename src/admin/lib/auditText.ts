// Textos da aba Registro. Valor que falta aparece como `sem dado`, nunca travessão.
import { EMPTY } from './fmt'
import type { AuditEntry } from './auditTypes'

const ACTION_LABELS: Record<string, string> = {
  resolve_flag: 'conferiu marcação',
  close_action: 'fechou pendência',
  retry_action: 'tentou pendência de novo',
  retry_event: 'reprocessou aviso do Asaas',
  change_plan: 'mudou o plano',
  grant_courtesy: 'deu cortesia',
  end_courtesy: 'encerrou cortesia',
  cancel_subscription: 'cancelou a assinatura',
  block: 'bloqueou',
  unblock: 'desbloqueou',
  adjust_quota: 'ajustou a cota',
}

const RESULT_LABELS: Record<string, string> = {
  ok: 'feito',
  failed: 'falhou',
  partial: 'em parte',
  pending: 'sem confirmação',
}

const FAILED_AGAIN = 'falhou de novo'

// Chave desconhecida aparece como veio, pra não esconder uma ação nova.
function labelOf(map: Record<string, string>, key: string): string {
  if (!key) return EMPTY
  return Object.hasOwn(map, key) ? map[key] : key
}

/** O que o admin fez, como se lê na lista: `change_plan` vira `mudou o plano`. */
export function actionLabel(action: string): string {
  return labelOf(ACTION_LABELS, action)
}

/** Resultado gravado: `pending` é o registro que não fechou (`sem confirmação`). */
export function resultLabel(result: string): string {
  return labelOf(RESULT_LABELS, result)
}

const objectOf = (v: unknown): Record<string, unknown> | null =>
  typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null

/**
 * O "Tentar agora" de uma pendência e o reprocessar de um aviso fecham o registro como `ok` mesmo
 * quando a nova tentativa falhou (o erro do Asaas fica na pendência, não lança). O depois conta a
 * verdade: a pendência continua `pending`, ou o aviso volta com `processed` falso.
 */
function failedAgain(e: AuditEntry): boolean {
  if (e.result !== 'ok') return false
  const after = objectOf(e.after)
  if (!after) return false
  if (e.action === 'retry_action') return after.status === 'pending'
  if (e.action === 'retry_event') return after.processed === false
  return false
}

export type ResultTone = 'on' | 'alert' | 'neutral'

/** Resultado mostrado na lista: laranja só em feito, âmbar no que falhou, neutro sem confirmação. */
export function displayResult(e: AuditEntry): { label: string; tone: ResultTone } {
  if (failedAgain(e)) return { label: FAILED_AGAIN, tone: 'alert' }
  const tone: ResultTone = e.result === 'ok' ? 'on' : e.result === 'failed' || e.result === 'partial' ? 'alert' : 'neutral'
  return { label: resultLabel(e.result), tone }
}

/** A mensagem gravada; no "falhou de novo" sem mensagem, o último erro que ficou na pendência. */
export function entryMessage(e: AuditEntry): string | null {
  if (e.message) return e.message
  if (!failedAgain(e)) return null
  const lastError = objectOf(e.after)?.lastError
  return typeof lastError === 'string' && lastError ? lastError : null
}

/** A conta alvo: o e-mail copiado no registro ou, sem ele, a referência (pendência, aviso). */
export function accountLabel(e: AuditEntry): string {
  return e.targetEmail || e.targetRef || EMPTY
}

/** Antes ou depois como JSON com recuo; vazio vira `sem dado`. */
export function jsonText(v: unknown): string {
  if (v === null || v === undefined) return EMPTY
  return JSON.stringify(v, null, 2) ?? EMPTY
}

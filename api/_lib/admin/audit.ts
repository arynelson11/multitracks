import { BillingError } from '../billing.js'
import { AdminError, asaasFailure, toHttpError, type AdminCtx } from './http.js'

// Registro de cada ação do admin (tabela admin_audit_log, SQL da T5): quem,
// quando, o quê (ação e alvo), antes, depois e resultado. Decisão D7:
// * Ação que só mexe no banco: a própria função SQL admin_* grava o registro
//   na mesma transação. Essas não usam withAudit.
// * Ação que fala com o Asaas: withAudit grava "pendente" antes de qualquer
//   chamada e o resultado depois. Sem conseguir gravar o pendente, a ação não
//   roda. Se só o fechamento falhar, a ação já feita segue e o registro fica
//   pendente, visível como "sem confirmação".
// * O registro nunca guarda texto técnico: na falha, a frase que pode passar
//   (a mesma da resposta) e, se a falha foi do Asaas, a frase genérica com o
//   status do Asaas (Rulings ADM-T3-registro e ADM-T3-permitidas). O erro cru vai pro log aqui mesmo, porque quem chama
//   pode responder sozinho sem deixar o erro chegar ao roteador.

export type AuditAction =
  | 'resolve_flag' | 'close_action' | 'retry_action' | 'retry_event'
  | 'change_plan' | 'grant_courtesy' | 'end_courtesy' | 'cancel_subscription'
  | 'block' | 'unblock' | 'adjust_quota'

export type AuditStartInput = {
  action: AuditAction
  targetUserId?: string | null
  targetRef?: string | null
  before?: unknown
  note?: string | null
}

export type AuditResult = 'ok' | 'failed' | 'partial'

const MSG_NOT_LOGGED = 'Não deu pra registrar a ação no histórico, então nada foi feito.'

// admin_log_start devolve bigint: número no JSON, ou texto se passar do
// inteiro seguro do JavaScript (aí não serve como id aqui).
function toLogId(data: unknown): number | null {
  const n = typeof data === 'number' ? data : typeof data === 'string' && /^\d+$/.test(data) ? Number(data) : Number.NaN
  return Number.isSafeInteger(n) && n > 0 ? n : null
}

function errorText(e: unknown): string {
  if (e instanceof Error) {
    const code = (e as { code?: unknown }).code
    return `${e.name}${typeof code === 'string' ? ` ${code}` : ''}: ${e.message}`.slice(0, 300)
  }
  if (e && typeof e === 'object' && 'message' in e) {
    const { code, message } = e as { code?: unknown; message?: unknown }
    return `${typeof code === 'string' ? `${code} ` : ''}${String(message)}`.slice(0, 300)
  }
  return 'erro sem mensagem'
}

// Frase gravada no registro quando a ação falha: a mesma da resposta; pro
// AsaasError cru (que na resposta vira erro inesperado) a frase do Asaas com o
// status.
function failureMessage(err: unknown): string {
  return asaasFailure(err)?.message ?? toHttpError(err).error
}

export async function auditStart(ctx: AdminCtx, e: AuditStartInput): Promise<number> {
  let id: number | null = null
  try {
    const { data, error } = await ctx.db.rpc('admin_log_start', {
      p_admin: ctx.admin.userId,
      p_action: e.action,
      p_target_user: e.targetUserId ?? null,
      p_target_ref: e.targetRef ?? null,
      p_before: e.before ?? null,
      p_note: e.note ?? null,
    })
    if (error) console.error(`[admin] registro de ${e.action} nao comecou:`, errorText(error))
    else {
      id = toLogId(data)
      if (id === null) console.error(`[admin] registro de ${e.action} nao devolveu id`)
    }
  } catch (err) {
    console.error(`[admin] registro de ${e.action} nao comecou:`, errorText(err))
  }
  if (id === null) throw new AdminError(500, MSG_NOT_LOGGED)
  return id
}

// Nunca lança: a ação já aconteceu e a resposta dela não pode se perder.
export async function auditFinish(ctx: AdminCtx, id: number, result: AuditResult, after?: unknown, message?: string | null): Promise<void> {
  try {
    const { error } = await ctx.db.rpc('admin_log_finish', {
      p_id: id,
      p_result: result,
      p_after: after ?? null,
      p_message: message ?? null,
    })
    if (error) console.error(`[admin] registro ${id} ficou sem fechar (${result}):`, errorText(error))
  } catch (err) {
    console.error(`[admin] registro ${id} ficou sem fechar (${result}):`, errorText(err))
  }
}

// Envolve uma ação que fala com o Asaas. Erro fecha 'partial' quando a Fase 3
// diz que parte foi feita (BillingError 'partial'), senão 'failed', com a
// frase de failureMessage; o erro cru vai pro log. O erro original é relançado
// pra quem chamou traduzir a resposta.
export async function withAudit<T>(ctx: AdminCtx, e: AuditStartInput, fn: () => Promise<T>, after?: (r: T) => unknown): Promise<T> {
  const id = await auditStart(ctx, e)
  let value: T
  try {
    value = await fn()
  } catch (err) {
    const partial = err instanceof BillingError && err.code === 'partial'
    console.error(`[admin] ${e.action} falhou (registro ${id}):`, errorText(err))
    await auditFinish(ctx, id, partial ? 'partial' : 'failed', null, failureMessage(err))
    throw err
  }
  let afterValue: unknown = null
  if (after) {
    try {
      afterValue = after(value)
    } catch (err) {
      console.error(`[admin] registro ${id}: nao deu pra montar o depois:`, errorText(err))
    }
  }
  await auditFinish(ctx, id, 'ok', afterValue, null)
  return value
}

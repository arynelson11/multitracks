import { lastErrorLabel } from './review.js'
import { int, str, uuid, type AdminCtx, type AdminHandlers } from './http.js'

// Registro (Task 7): a lista das ações do admin (admin_audit_list, T5), do mais
// novo pro mais antigo, em páginas de 50. userId filtra pela conta alvo (a
// ficha do assinante usa, T17).
// O texto cru do último erro fica só no banco (Ruling ADM-T6-lastError): todo
// lastError do antes e do depois sai daqui em frase pronta. O SQL do
// admin_close_action grava no antes o last_error cru da pendência; o
// retry_action e o retry_event (T6) já gravam a frase.

const PAGE_SIZE = 50
const MAX_PAGE = 1000

type AuditPage = { total: number; page: number; pageSize: number; rows: unknown[] }

// lastErrorLabel não devolve a própria frase (a frase pronta passada de novo
// vira a genérica). A frase que já é dela passa como está; as frases saem da
// própria função, pra não ter uma cópia delas aqui.
function isLabel(text: string): boolean {
  const status = /(\d{3})\.$/.exec(text)?.[1]
  const labels = [lastErrorLabel('Asaas sem resposta'), lastErrorLabel('qualquer outro texto')]
  if (status) labels.push(lastErrorLabel(`Asaas recusou (${status})`))
  return labels.includes(text)
}

const safeLastError = (v: unknown): string | null => (typeof v === 'string' && isLabel(v) ? v : lastErrorLabel(v))

// Todo lastError do valor, em qualquer nível (objeto ou lista); o resto passa como veio.
function withErrorLabels(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(withErrorLabels)
  if (typeof v !== 'object' || v === null) return v
  return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, k === 'lastError' ? safeLastError(x) : withErrorLabels(x)]))
}

function labeledRow(row: unknown): unknown {
  if (typeof row !== 'object' || row === null || Array.isArray(row)) return row
  const r = row as Record<string, unknown>
  return { ...r, before: withErrorLabels(r.before), after: withErrorLabels(r.after) }
}

// Vazio vale como sem filtro; preenchido precisa ser um id de conta.
function targetOf(query: Record<string, string>): string | null {
  if (str(query, 'userId', { label: 'a conta', optional: true }) === null) return null
  return uuid(query, 'userId', 'a conta')
}

async function listAudit(ctx: AdminCtx): Promise<AuditPage> {
  const page = int(ctx.query, 'page', { label: 'a página', min: 1, max: MAX_PAGE, fallback: 1 })
  const target = targetOf(ctx.query)
  const { data, error } = await ctx.db.rpc('admin_audit_list', { p_limit: PAGE_SIZE, p_offset: (page - 1) * PAGE_SIZE, p_target: target })
  if (error) throw new Error(`Falha no banco (admin_audit_list): ${error.message}`)
  const d = data as { total?: unknown; rows?: unknown } | null
  // total é bigint: número no JSON, ou texto se passar do inteiro seguro.
  const total = typeof d?.total === 'number' ? d.total : typeof d?.total === 'string' && /^\d+$/.test(d.total) ? Number(d.total) : Number.NaN
  if (!Number.isSafeInteger(total) || !Array.isArray(d?.rows)) throw new Error('admin_audit_list devolveu fora do formato')
  return { total, page, pageSize: PAGE_SIZE, rows: d.rows.map(labeledRow) }
}

export const handlers: AdminHandlers = {
  audit: {
    method: 'GET',
    fields: ['page', 'userId'],
    run: listAudit,
  },
}

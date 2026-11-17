// Registro das ações do admin (`?action=audit`), cópia do front do contrato da seção Arquitetura B
// do plano. O backend não importa de src/, então os dois lados mantêm o mesmo formato.

export type AuditResult = 'pending' | 'ok' | 'failed' | 'partial'

export type AuditEntry = {
  id: number
  createdAt: string
  finishedAt: string | null
  adminEmail: string
  action: string
  targetUserId: string | null
  targetEmail: string | null
  targetRef: string | null
  result: AuditResult
  message: string | null
  note: string | null
  before: unknown
  after: unknown
}

// page e pageSize vêm do servidor.
export type AuditPage = { total: number; page: number; pageSize: number; rows: AuditEntry[] }

const isCount = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0

/**
 * A resposta tem a forma que a tela usa (Ruling ADM-T7-forma): números onde a tela conta páginas
 * e linhas que são objetos. Fora disso a aba mostra a frase pronta, em vez de quebrar no render.
 */
export function isAuditPage(v: unknown): v is AuditPage {
  if (typeof v !== 'object' || v === null) return false
  const p = v as Record<string, unknown>
  return isCount(p.total) && isCount(p.page) && isCount(p.pageSize) && (p.pageSize as number) > 0
    && Array.isArray(p.rows) && p.rows.every((r) => typeof r === 'object' && r !== null && !Array.isArray(r))
}

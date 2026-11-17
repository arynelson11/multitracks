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

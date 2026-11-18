// Fila de Pendências (`?action=review`), cópia do front do contrato da seção Arquitetura B do plano.
// O backend não importa de src/, então os dois lados mantêm o mesmo formato.

export type ReviewAction = {
  id: number
  action: 'delete_subscription' | 'inactivate_subscription' | 'delete_future_payments' | 'refund_payment' | 'admin_review'
  reason: string
  autoRetry: boolean
  attempts: number
  lastError: string | null
  nextAttemptAt: string
  createdAt: string
  subscriptionRef: string
  asaasSubscriptionId: string | null
  paymentId: string | null
  dueDate: string | null
  amount: number | null
  userId: string | null
  email: string | null
  planKey: string | null
}

export type ReviewFlag = {
  subscriptionRef: string
  userId: string | null
  email: string | null
  planKey: string
  kind: 'asaas' | 'courtesy'
  status: 'active' | 'canceled'
  cancelSource: string | null
  adminNote: string | null
  updatedAt: string
}

export type ReviewEvent = {
  id: string
  event: string
  status: 'pending' | 'failed' | 'exhausted'
  attempts: number
  lastError: string | null
  receivedAt: string
}

export type ReviewQueue = {
  actions: ReviewAction[]
  flags: ReviewFlag[]
  events: ReviewEvent[]
  // manual = ações com autoRetry falso + marcações + avisos 'exhausted';
  // auto = ações com autoRetry + avisos 'pending' ou 'failed'.
  counts: { manual: number; auto: number; total: number }
  generatedAt: string
}

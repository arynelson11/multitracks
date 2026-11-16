// Abas do admin e o contrato que cada aba recebe da casca.

export type AdminTabId = 'review' | 'overview' | 'subscribers' | 'finance' | 'aicost' | 'audit' | 'usage'

/** Troca de aba; `focus.userId` pede pra aba abrir a ficha dessa conta. */
export type Navigate = (id: AdminTabId, focus?: { userId?: string }) => void

export type TabProps = { onNavigate: Navigate; focusUserId: string | null }

export const TAB_LABELS: Record<AdminTabId, string> = {
  review: 'Pendências',
  overview: 'Visão geral',
  subscribers: 'Assinantes',
  finance: 'Financeiro',
  aicost: 'Custos de IA',
  audit: 'Registro',
  usage: 'Uso',
}

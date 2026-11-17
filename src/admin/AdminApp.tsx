// Admin central. Abre na web em /admin e, dentro do app (também no de computador, que roda
// de file://), como tela interna com onClose. A guarda decide quem entra; o servidor confere
// de novo em cada ação.
import { useState, type ComponentType } from 'react'
import { Loader2 } from 'lucide-react'
import { Button } from '../components/ui'
import { useAdminGuard } from './hooks/useAdminGuard'
import { useAdminQuery } from './hooks/useAdminQuery'
import { AdminLogin } from './AdminLogin'
import { AdminShell } from './AdminShell'
import { AdminErrorBoundary } from './components/AdminErrorBoundary'
import { TAB_LABELS, type AdminTabId, type Navigate, type TabProps } from './lib/tabs'
import type { ReviewQueue } from './lib/reviewTypes'
import { ReviewTab } from './tabs/ReviewTab'
import { OverviewTab } from './tabs/OverviewTab'
import { SubscribersTab } from './tabs/SubscribersTab'
import { FinanceTab } from './tabs/FinanceTab'
import { AiCostTab } from './tabs/AiCostTab'
import { AuditTab } from './tabs/AuditTab'
import { UsageTab } from './tabs/UsageTab'

// Abas que recebem só TabProps. As antigas (sem props) entram como estão; quem reescreve
// cada uma passa a declarar TabProps sem mexer aqui. Pendências e Assinantes recebem mais (abaixo).
const OTHER_TABS: { id: AdminTabId; Component: ComponentType<TabProps> }[] = [
  { id: 'overview', Component: OverviewTab },
  { id: 'finance', Component: FinanceTab },
  { id: 'aicost', Component: AiCostTab },
  { id: 'audit', Component: AuditTab },
  { id: 'usage', Component: UsageTab },
]

// Ordem do Corte A: Pendências abre primeiro.
const TAB_ORDER: AdminTabId[] = ['review', 'overview', 'subscribers', 'finance', 'aicost', 'audit', 'usage']
const SHELL_TABS = TAB_ORDER.map((id) => ({ id, label: TAB_LABELS[id] }))

const SCREEN = 'min-h-screen bg-ps-ink text-ps-bone font-ps-sans flex flex-col items-center justify-center gap-3 px-ps-gutter text-center'

export default function AdminApp({ onClose }: { onClose?: () => void }) {
  const { status, email, signOut } = useAdminGuard()

  if (status === 'loading') {
    return (
      <div className={SCREEN} role="status">
        <Loader2 size={32} aria-hidden="true" className="text-ps-mut animate-spin motion-reduce:animate-none" />
        <p className="text-ps-base text-ps-mut">Carregando...</p>
      </div>
    )
  }
  if (status === 'anon') return <AdminLogin />
  if (status === 'denied') {
    return (
      <div className={SCREEN}>
        <h1 className="text-ps-lg font-bold text-ps-alert">Acesso negado</h1>
        <p className="text-ps-base text-ps-mut">Esta conta não tem permissão de administrador.</p>
        {onClose ? (
          <Button onClick={onClose}>Voltar ao app</Button>
        ) : (
          <Button onClick={signOut}>Trocar de conta</Button>
        )}
      </div>
    )
  }

  return <AdminPanel email={email} onClose={onClose} onSignOut={signOut} />
}

// Só monta com a guarda liberada: quem não é admin nem chega a pedir a fila.
function AdminPanel({ email, onClose, onSignOut }: { email: string | null; onClose?: () => void; onSignOut: () => void }) {
  const [active, setActive] = useState<AdminTabId>('review')
  const [focusUserId, setFocusUserId] = useState<string | null>(null)
  const review = useAdminQuery<ReviewQueue>('review')

  const onNavigate: Navigate = (id, focus) => {
    setActive(id)
    setFocusUserId(focus?.userId ?? null)
  }
  const tabProps: TabProps = { onNavigate, focusUserId }
  const Current = OTHER_TABS.find((t) => t.id === active)?.Component

  return (
    <AdminShell
      email={email}
      tabs={SHELL_TABS}
      active={active}
      onSelect={(id) => onNavigate(id)}
      onClose={onClose}
      onSignOut={onSignOut}
      reviewCount={review.data?.counts ?? null}
    >
      {/* Erro de render numa aba fica só nela (Ruling ADM-T7-forma); trocar de aba recomeça limpo. */}
      <AdminErrorBoundary key={active} onClose={onClose} onSignOut={onSignOut}>
        {/* As ações da ficha do assinante mudam a fila: ela e o número de Pendências chegam de novo
            depois de cada uma (Ruling ADM-T26-fila). */}
        {active === 'review' ? (
          <ReviewTab {...tabProps} review={review} />
        ) : active === 'subscribers' ? (
          <SubscribersTab {...tabProps} onQueueChange={review.refetch} />
        ) : (
          Current && <Current {...tabProps} />
        )}
      </AdminErrorBoundary>
    </AdminShell>
  )
}

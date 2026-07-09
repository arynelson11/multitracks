import { Loader2, LayoutDashboard, Users, DollarSign, Cpu, Activity } from 'lucide-react';
import { useAdminGuard } from './hooks/useAdminGuard';
import { AdminLogin } from './AdminLogin';
import { AdminShell } from './AdminShell';
import { OverviewTab } from './tabs/OverviewTab';
import { UsersTab } from './tabs/UsersTab';
import { FinanceTab } from './tabs/FinanceTab';
import { AiCostTab } from './tabs/AiCostTab';
import { UsageTab } from './tabs/UsageTab';

export default function AdminApp() {
  const { status, email, signOut } = useAdminGuard();

  if (status === 'loading') {
    return <div className="min-h-screen bg-[#0e0e10] flex items-center justify-center"><Loader2 size={40} className="text-primary animate-spin" /></div>;
  }
  if (status === 'anon') return <AdminLogin />;
  if (status === 'denied') {
    return (
      <div className="min-h-screen bg-[#0e0e10] flex flex-col items-center justify-center text-white px-6 gap-3">
        <h1 className="text-2xl font-black text-accent-red">Acesso negado</h1>
        <p className="text-text-muted text-sm">Esta conta não tem permissão de administrador.</p>
        <button onClick={signOut} className="text-primary text-sm underline">Trocar de conta</button>
      </div>
    );
  }

  return (
    <AdminShell email={email} onSignOut={signOut} tabs={[
      { id: 'overview', label: 'Visão Geral', icon: LayoutDashboard, content: <OverviewTab /> },
      { id: 'users',    label: 'Usuários',    icon: Users,           content: <UsersTab /> },
      { id: 'finance',  label: 'Financeiro',  icon: DollarSign,      content: <FinanceTab /> },
      { id: 'aicost',   label: 'Custos IA',   icon: Cpu,             content: <AiCostTab /> },
      { id: 'usage',    label: 'Uso & Sinais',icon: Activity,        content: <UsageTab /> },
    ]} />
  );
}

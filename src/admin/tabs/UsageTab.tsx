import { useMemo } from 'react';
import { Activity, Zap, UserX } from 'lucide-react';
import { useAdminUsers } from '../hooks/useAdminUsers';
import { useAiCostStats } from '../hooks/useAiCostStats';
import { StatCard } from '../components/StatCard';
import { DataTable, type Column } from '../components/DataTable';
import { BarChart } from '../components/BarChart';
import { planDisplayName } from '../../lib/plans';
import { fmtDate } from '../lib/format';
import type { AdminUser } from '../hooks/useAdminUsers';

function monthLabel(ym: string): string {
  const [y, m] = ym.split('-');
  return new Date(Number(y), Number(m) - 1, 1).toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' });
}

export function UsageTab() {
  const { stats } = useAdminUsers();
  const { stats: ai } = useAiCostStats();

  const users = useMemo(() => stats?.users ?? [], [stats]);
  const powerUsers = useMemo(() => [...users].sort((a, b) => b.separations_count - a.separations_count).slice(0, 10), [users]);
  const churned = useMemo(() => users.filter(u => !u.is_active && u.plan !== 'free'), [users]);

  const puCols: Column<AdminUser>[] = [
    { key: 'name', header: 'Usuário', className: 'flex-1 text-xs text-white truncate', render: u => u.display_name || u.email },
    { key: 'plan', header: 'Plano', className: 'w-20 text-center text-[10px] text-primary', render: u => planDisplayName(u.plan) },
    { key: 'sep', header: 'Separações', className: 'w-24 text-right text-[10px] text-text-muted font-mono', render: u => u.separations_count },
  ];
  const chCols: Column<AdminUser>[] = [
    { key: 'name', header: 'Usuário', className: 'flex-1 text-xs text-white truncate', render: u => u.display_name || u.email },
    { key: 'plan', header: 'Plano', className: 'w-20 text-center text-[10px] text-primary', render: u => planDisplayName(u.plan) },
    { key: 'last', header: 'Último acesso', className: 'w-28 text-right text-[10px] text-accent-red font-mono', render: u => fmtDate(u.last_sign_in_at) },
  ];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <StatCard icon={Activity} label="Separações totais" value={stats?.totalSeparations ?? '—'} color="#FF6B35" iconBg="#FF6B3510" />
        <StatCard icon={Zap}      label="Taxa de sucesso"   value={ai && ai.total > 0 ? `${Math.round((ai.succeeded / ai.total) * 100)}%` : '—'} subtext={ai ? `${ai.failed} erros` : ''} color="#10b981" iconBg="#10b98110" />
        <StatCard icon={UserX}    label="Pagantes sumidos"  value={churned.length} subtext="risco de churn" color="#ef4444" iconBg="#ef444410" />
      </div>

      {ai && ai.monthlyCounts.length > 0 && (
        <div className="daw-panel rounded-lg p-4 space-y-3">
          <span className="text-[9px] font-bold text-text-muted uppercase tracking-widest font-mono">Separações por mês</span>
          <BarChart data={ai.monthlyCounts.map(c => ({ label: monthLabel(c.month), value: c.count }))} />
        </div>
      )}

      <div className="space-y-2">
        <span className="text-[9px] font-bold text-text-muted uppercase tracking-widest font-mono flex items-center gap-1.5"><Zap size={11} className="text-primary" /> Power users</span>
        <DataTable columns={puCols} rows={powerUsers} empty="Sem dados" />
      </div>
      <div className="space-y-2">
        <span className="text-[9px] font-bold text-text-muted uppercase tracking-widest font-mono flex items-center gap-1.5"><UserX size={11} className="text-accent-red" /> Pagantes que sumiram (mais de 30 dias sem entrar)</span>
        <DataTable columns={chCols} rows={churned} empty="Nenhum pagante sumido" />
      </div>
    </div>
  );
}

import { TrendingUp, Activity, DollarSign, RefreshCw } from 'lucide-react';
import { useFinanceStats } from '../hooks/useFinanceStats';
import { StatCard } from '../components/StatCard';
import { DataTable, type Column } from '../components/DataTable';
import { planDisplayName } from '../../lib/plans';
import { fmtBRL, fmtShortDate } from '../lib/format';

const STATUS_STYLE: Record<string, string> = {
  RECEIVED: 'text-accent-green', CONFIRMED: 'text-accent-green', ACTIVE: 'text-accent-green',
  PENDING: 'text-yellow-400', EXPIRED: 'text-text-muted', CANCELLED: 'text-accent-red',
};

export function FinanceTab() {
  const { stats, loading, error, refetch } = useFinanceStats();

  const planCols: Column<{ planKey: string; count: number; monthlyBRL: number }>[] = [
    { key: 'plan', header: 'Plano', className: 'flex-1', render: r => <span className="text-xs text-white">{planDisplayName(r.planKey)}</span> },
    { key: 'count', header: 'Assinantes', className: 'w-24 text-center text-[10px] text-text-muted font-mono', render: r => r.count },
    { key: 'mrr', header: 'MRR', className: 'w-24 text-right text-[10px] text-accent-green font-mono font-bold', render: r => fmtBRL(r.monthlyBRL) },
  ];

  const payCols: Column<{ id: string; status: string; amount: number; createdAt: string | null }>[] = [
    { key: 'id', header: 'ID', className: 'flex-1 text-[10px] text-text-muted font-mono truncate', render: r => r.id },
    { key: 'status', header: 'Status', className: `w-24 text-center text-[9px] font-bold`, render: r => <span className={STATUS_STYLE[r.status] ?? 'text-text-muted'}>{r.status}</span> },
    { key: 'amount', header: 'Valor', className: 'w-24 text-right text-[10px] text-accent-green font-mono', render: r => fmtBRL(r.amount) },
    { key: 'date', header: 'Data', className: 'w-20 text-right text-[10px] text-text-muted font-mono hidden sm:block', render: r => fmtShortDate(r.createdAt) },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-white font-black text-xs uppercase tracking-wider flex items-center gap-2"><DollarSign size={14} className="text-accent-green" /> Financeiro (Asaas)</h3>
        <button onClick={refetch} disabled={loading} className="p-1.5 text-text-muted hover:text-white rounded-lg disabled:opacity-30"><RefreshCw size={13} className={loading ? 'animate-spin' : ''} /></button>
      </div>
      {error && <div className="p-3 bg-accent-red/10 border border-accent-red/20 rounded-lg text-accent-red text-xs font-mono">{error}</div>}

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard icon={TrendingUp} label="Receita total" value={stats ? fmtBRL(stats.totalRevenueBRL) : '—'} subtext={stats ? `${stats.paidCount} pagos` : ''} color="#10b981" iconBg="#10b98110" />
        <StatCard icon={DollarSign} label="MRR"           value={stats ? fmtBRL(stats.mrrBRL) : '—'} color="#FF6B35" iconBg="#FF6B3510" />
        <StatCard icon={Activity}   label="Assinaturas"   value={stats?.activeSubscriptions ?? '—'} subtext={stats ? `${stats.totalSubscriptions} total` : ''} color="#8b5cf6" iconBg="#8b5cf610" />
        <StatCard icon={TrendingUp} label="Checkouts"     value={stats?.totalCheckouts ?? '—'} color="#06b6d4" iconBg="#06b6d410" />
      </div>

      <div className="space-y-2">
        <span className="text-[9px] font-bold text-text-muted uppercase tracking-widest font-mono">Receita por plano</span>
        <DataTable columns={planCols} rows={stats?.revenueByPlan ?? []} empty="Sem assinaturas ativas" />
      </div>
      <div className="space-y-2">
        <span className="text-[9px] font-bold text-text-muted uppercase tracking-widest font-mono">Últimos pagamentos</span>
        <DataTable columns={payCols} rows={stats?.recent ?? []} empty="Sem pagamentos" />
      </div>
    </div>
  );
}

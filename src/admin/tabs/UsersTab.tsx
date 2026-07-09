import { useMemo, useState } from 'react';
import { Users, UserCheck, UserX, Search, RefreshCw } from 'lucide-react';
import { useAdminUsers } from '../hooks/useAdminUsers';
import { useAiCostStats } from '../hooks/useAiCostStats';
import { StatCard } from '../components/StatCard';
import { DataTable, type Column } from '../components/DataTable';
import { planDisplayName } from '../../lib/plans';
import { fmtBRL, fmtUSD, fmtDate } from '../lib/format';
import { planMonthlyBRL, userMarginBRL } from '../lib/metrics';

interface Row {
  id: string; name: string; email: string; plan: string; created_at: string;
  last_sign_in_at: string | null; is_active: boolean; separations: number;
  revenueBRL: number; revenueExact: boolean; totalPaid: number; costUSD: number; marginBRL: number;
}

export function UsersTab() {
  const { stats, loading, error, refetch } = useAdminUsers();
  const { stats: ai } = useAiCostStats();
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<'all' | 'paid' | 'inactive' | 'negative'>('all');

  const costByUser = useMemo(() => {
    const m = new Map<string, number>();
    for (const u of ai?.perUser ?? []) m.set(u.userId, u.costUSD);
    return m;
  }, [ai]);

  const rows: Row[] = useMemo(() => {
    return (stats?.users ?? []).map(u => {
      const costUSD = costByUser.get(u.id) ?? 0;
      const exact = u.exact_monthly_brl ?? undefined;
      const revenueBRL = exact ?? planMonthlyBRL(u.plan);
      return {
        id: u.id, name: u.display_name || u.email, email: u.email, plan: u.plan,
        created_at: u.created_at, last_sign_in_at: u.last_sign_in_at, is_active: u.is_active,
        separations: u.separations_count, revenueBRL, revenueExact: exact != null,
        totalPaid: u.total_paid ?? 0, costUSD,
        marginBRL: userMarginBRL({ plan: u.plan, costUSD, exactMonthlyBRL: exact }),
      };
    });
  }, [stats, costByUser]);

  const filtered = rows.filter(r => {
    const matchQ = !q || r.email.toLowerCase().includes(q.toLowerCase()) || r.name.toLowerCase().includes(q.toLowerCase());
    const matchF = filter === 'all' ? true
      : filter === 'paid' ? r.plan !== 'free'
      : filter === 'inactive' ? !r.is_active
      : r.marginBRL < 0;
    return matchQ && matchF;
  }).sort((a, b) => a.marginBRL - b.marginBRL); // pior margem primeiro

  const columns: Column<Row>[] = [
    { key: 'name', header: 'Usuário', className: 'flex-1 min-w-0', render: r => (
      <div className="min-w-0">
        <span className="text-xs text-white font-medium truncate block">{r.name}</span>
        <span className="text-[10px] text-text-muted/50 font-mono truncate block">{r.email}</span>
      </div>) },
    { key: 'plan', header: 'Plano', className: 'w-20 text-center', render: r => (
      <span className={`text-[10px] font-bold ${r.plan === 'free' ? 'text-text-muted' : 'text-primary'}`}>{planDisplayName(r.plan)}</span>) },
    { key: 'sep', header: 'Sep.', className: 'w-12 text-center text-[10px] text-text-muted font-mono', render: r => r.separations },
    { key: 'rev', header: 'Paga/mês', className: 'w-20 text-right text-[10px] text-accent-green font-mono', render: r => (
      <span title={r.revenueExact ? 'Valor exato (pagamento registrado)' : 'Aproximado pelo plano atual'}>
        {fmtBRL(r.revenueBRL)}{r.revenueExact ? '' : ' ~'}
      </span>) },
    { key: 'ltv', header: 'Total pago', className: 'w-20 text-right text-[10px] text-accent-green/70 font-mono hidden sm:block', render: r => r.totalPaid > 0 ? fmtBRL(r.totalPaid) : '—' },
    { key: 'cost', header: 'Custa IA', className: 'w-20 text-right text-[10px] text-cyan-400 font-mono', render: r => fmtUSD(r.costUSD) },
    { key: 'margin', header: 'Margem/mês', className: 'w-24 text-right text-[10px] font-mono font-bold', render: r => (
      <span className={r.marginBRL < 0 ? 'text-accent-red' : 'text-accent-green'}>{fmtBRL(r.marginBRL)}</span>) },
    { key: 'signup', header: 'Cadastro', className: 'w-24 text-right text-[10px] text-text-muted font-mono hidden sm:block', render: r => fmtDate(r.created_at) },
  ];

  return (
    <div className="space-y-4">
      {error && <div className="p-3 bg-accent-red/10 border border-accent-red/20 rounded-lg text-accent-red text-xs font-mono">{error}</div>}

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard icon={Users}     label="Total"       value={stats?.totalUsers ?? '—'} color="#FF6B35" iconBg="#FF6B3510" />
        <StatCard icon={UserCheck} label="Ativos 30d"  value={stats?.activeUsers ?? '—'} color="#10b981" iconBg="#10b98110" />
        <StatCard icon={UserX}     label="Inativos"    value={stats?.inactiveUsers ?? '—'} color="#ef4444" iconBg="#ef444410" />
        <StatCard icon={Users}     label="Pagantes"    value={stats?.paidSubscribers ?? '—'} subtext={`${stats?.newUsers30d ?? 0} novos 30d`} color="#8b5cf6" iconBg="#8b5cf610" />
      </div>

      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Buscar por email ou nome..."
            className="w-full daw-input text-white text-xs pl-9 pr-3 py-2.5 rounded-lg font-mono" />
        </div>
        <div className="flex lcd-display rounded-lg overflow-hidden border border-border shrink-0">
          {(['all','paid','inactive','negative'] as const).map(f => (
            <button key={f} onClick={() => setFilter(f)}
              className={`px-3 py-2 text-[9px] font-bold uppercase tracking-wider transition-all font-mono ${filter === f ? 'bg-white/10 text-white' : 'text-text-muted hover:text-white'}`}>
              {f === 'all' ? 'Todos' : f === 'paid' ? 'Pagantes' : f === 'inactive' ? 'Inativos' : 'No vermelho'}
            </button>
          ))}
        </div>
        <button onClick={refetch} disabled={loading} className="p-2 text-text-muted hover:text-white rounded-lg disabled:opacity-30">
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      <p className="text-[10px] text-text-muted/50 font-mono">Paga/mês = valor exato do último pagamento quando registrado, senão plano × preço (marcado com ~). Total pago = tudo que o usuário já pagou. Custo IA = real (Replicate). Margem em BRL, câmbio estimado.</p>
      <DataTable columns={columns} rows={filtered} empty="Nenhum usuário encontrado" />
    </div>
  );
}

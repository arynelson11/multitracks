import { Cpu, Clock, TrendingUp, Activity, RefreshCw } from 'lucide-react';
import { useAiCostStats } from '../hooks/useAiCostStats';
import { StatCard } from '../components/StatCard';
import { DataTable, type Column } from '../components/DataTable';
import { BarChart } from '../components/BarChart';
import { fmtUSD, fmtTime, fmtShortDate } from '../lib/format';

function monthLabel(ym: string): string {
  const [y, m] = ym.split('-');
  return new Date(Number(y), Number(m) - 1, 1).toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' });
}

type AiModelRow = { model: string; total: number; succeeded: number; totalTime: number; totalCost: number };

export function AiCostTab() {
  const { stats, loading, error, refetch } = useAiCostStats();
  const avgPerRun = stats && stats.succeeded > 0 ? stats.totalCostUSD / stats.succeeded : 0;

  const modelCols: Column<AiModelRow>[] = [
    { key: 'model', header: 'Modelo', className: 'flex-1 text-xs text-white font-mono truncate', render: r => r.model.split('/').pop() },
    { key: 'runs', header: 'Runs', className: 'w-12 text-center text-[10px] text-text-muted font-mono', render: r => r.total },
    { key: 'time', header: 'Tempo', className: 'w-16 text-right text-[10px] text-text-muted font-mono hidden sm:block', render: r => fmtTime(r.totalTime) },
    { key: 'cost', header: 'Custo', className: 'w-20 text-right text-[10px] text-cyan-400 font-mono font-bold', render: r => fmtUSD(r.totalCost) },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-white font-black text-xs uppercase tracking-wider flex items-center gap-2"><Cpu size={14} className="text-cyan-400" /> Custos de IA (Replicate)</h3>
        <button onClick={refetch} disabled={loading} className="p-1.5 text-text-muted hover:text-white rounded-lg disabled:opacity-30"><RefreshCw size={13} className={loading ? 'animate-spin' : ''} /></button>
      </div>
      {error && <div className="p-3 bg-accent-red/10 border border-accent-red/20 rounded-lg text-accent-red text-xs font-mono">{error}</div>}

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard icon={TrendingUp} label="Gasto 30d"   value={stats ? fmtUSD(stats.recentCostUSD) : '—'} subtext={stats ? `${stats.recentTotal} runs` : ''} color="#ef4444" iconBg="#ef444410" />
        <StatCard icon={Clock}      label="Gasto total" value={stats ? fmtUSD(stats.totalCostUSD) : '—'} subtext={stats ? `${stats.total} runs` : ''} color="#f59e0b" iconBg="#f59e0b10" />
        <StatCard icon={Activity}   label="Sucesso"      value={stats && stats.total > 0 ? `${Math.round((stats.succeeded / stats.total) * 100)}%` : '—'} subtext={stats ? `${stats.failed} erros` : ''} color="#10b981" iconBg="#10b98110" />
        <StatCard icon={Cpu}        label="Custo/sep."   value={fmtUSD(avgPerRun)} color="#06b6d4" iconBg="#06b6d410" />
      </div>

      {stats && stats.monthlyCosts.length > 0 && (
        <div className="daw-panel rounded-lg p-4 space-y-3">
          <span className="text-[9px] font-bold text-text-muted uppercase tracking-widest font-mono">Gasto mensal</span>
          <BarChart data={stats.monthlyCosts.map(c => ({ label: monthLabel(c.month), value: c.cost }))} format={fmtUSD} />
        </div>
      )}

      <div className="space-y-2">
        <span className="text-[9px] font-bold text-text-muted uppercase tracking-widest font-mono">Últimas separações</span>
        <DataTable
          columns={[
            { key: 'id', header: 'ID', className: 'flex-1 text-[10px] text-text-muted font-mono truncate', render: r => r.id },
            { key: 'status', header: 'Status', className: 'w-16 text-center text-[9px] font-bold', render: r => <span className={r.status === 'succeeded' ? 'text-accent-green' : r.status === 'failed' ? 'text-accent-red' : 'text-text-muted'}>{r.status === 'succeeded' ? 'ok' : r.status === 'failed' ? 'erro' : r.status}</span> },
            { key: 'time', header: 'Tempo', className: 'w-16 text-right text-[10px] text-text-muted font-mono hidden sm:block', render: r => r.predict_time != null ? fmtTime(r.predict_time) : '—' },
            { key: 'cost', header: 'Custo', className: 'w-20 text-right text-[10px] text-cyan-400 font-mono hidden sm:block', render: r => r.estimated_cost > 0 ? fmtUSD(r.estimated_cost) : '—' },
            { key: 'date', header: 'Data', className: 'w-16 text-right text-[10px] text-text-muted font-mono hidden md:block', render: r => fmtShortDate(r.created_at) },
          ]}
          rows={stats?.recentList ?? []} empty="Sem separações" />
      </div>

      <div className="space-y-2">
        <span className="text-[9px] font-bold text-text-muted uppercase tracking-widest font-mono">Modelos</span>
        <DataTable columns={modelCols} rows={stats?.topModels ?? []} empty="Sem dados" />
      </div>
    </div>
  );
}

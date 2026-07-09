import { useMemo } from 'react';
import { TrendingUp, Cpu, DollarSign, Users, LayoutDashboard } from 'lucide-react';
import { useAdminUsers } from '../hooks/useAdminUsers';
import { useFinanceStats } from '../hooks/useFinanceStats';
import { useAiCostStats } from '../hooks/useAiCostStats';
import { StatCard } from '../components/StatCard';
import { fmtBRL, fmtUSD } from '../lib/format';
import { usdToBRL } from '../lib/metrics';

export function OverviewTab() {
  const { stats: users } = useAdminUsers();
  const { stats: fin } = useFinanceStats();
  const { stats: ai } = useAiCostStats();

  const profit = useMemo(() => {
    if (!fin || !ai) return null;
    return fin.totalRevenueBRL - usdToBRL(ai.totalCostUSD);
  }, [fin, ai]);

  return (
    <div className="space-y-4">
      <h3 className="text-white font-black text-xs uppercase tracking-wider flex items-center gap-2"><LayoutDashboard size={14} className="text-primary" /> Visão Geral</h3>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard icon={TrendingUp} label="Entra (receita)" value={fin ? fmtBRL(fin.totalRevenueBRL) : '—'} subtext={fin ? `MRR ${fmtBRL(fin.mrrBRL)}` : ''} color="#10b981" iconBg="#10b98110" />
        <StatCard icon={Cpu}        label="Sai (IA)"        value={ai ? fmtUSD(ai.totalCostUSD) : '—'} subtext={ai ? fmtBRL(usdToBRL(ai.totalCostUSD)) : ''} color="#ef4444" iconBg="#ef444410" />
        <StatCard icon={DollarSign} label="Lucro estimado"  value={profit != null ? fmtBRL(profit) : '—'} subtext="câmbio estimado" color="#FF6B35" iconBg="#FF6B3510" />
        <StatCard icon={Users}      label="Usuários"        value={users?.totalUsers ?? '—'} subtext={users ? `${users.paidSubscribers} pagantes` : ''} color="#8b5cf6" iconBg="#8b5cf610" />
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard icon={Users}      label="Novos 7d"    value={users?.newUsers7d ?? '—'} color="#06b6d4" iconBg="#06b6d410" />
        <StatCard icon={Users}      label="Novos 30d"   value={users?.newUsers30d ?? '—'} color="#06b6d4" iconBg="#06b6d410" />
        <StatCard icon={DollarSign} label="Assinaturas" value={fin?.activeSubscriptions ?? '—'} color="#8b5cf6" iconBg="#8b5cf610" />
        <StatCard icon={Cpu}        label="Gasto IA 30d" value={ai ? fmtUSD(ai.recentCostUSD) : '—'} color="#f59e0b" iconBg="#f59e0b10" />
      </div>

      <p className="text-[10px] text-text-muted/50 font-mono">Lucro = receita total (Asaas) menos custo de IA (Replicate) convertido a câmbio estimado. Para margem por cliente, ver a aba Usuários.</p>
    </div>
  );
}

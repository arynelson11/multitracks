import { useState } from 'react';
import {
    X, Users, Music, TrendingUp, UserCheck, UserX,
    RefreshCw, BarChart3, Search, ChevronDown, ChevronUp,
    Shield, Cpu, Clock, DollarSign, AlertCircle, Activity,
} from 'lucide-react';
import { useAdminDashboard, type AdminUser } from '../hooks/useAdminDashboard';
import { useReplicateStats, type ReplicatePredictionRow, type ReplicateMonthlyCost } from '../hooks/useReplicateStats';
import { useAbacatePayStats } from '../hooks/useAbacatePayStats';

interface AdminDashboardProps {
    isOpen: boolean;
    onClose: () => void;
}

function StatCard({ icon: Icon, label, value, subtext, color, iconBg }: {
    icon: any; label: string; value: string | number; subtext?: string; color: string; iconBg: string;
}) {
    return (
        <div className="daw-panel rounded-xl p-4 flex flex-col gap-3 relative overflow-hidden group hover:border-white/10 transition-all">
            <div className="absolute top-0 right-0 w-24 h-24 rounded-full blur-[60px] opacity-10 group-hover:opacity-20 transition-opacity" style={{ backgroundColor: color }} />
            <div className="flex items-center justify-between">
                <div className="p-2 rounded-lg border" style={{ backgroundColor: iconBg, borderColor: `${color}30` }}>
                    <Icon size={18} style={{ color }} />
                </div>
                <span className="text-[9px] font-bold text-text-muted uppercase tracking-widest font-mono">{label}</span>
            </div>
            <div className="flex items-end gap-2">
                <span className="text-2xl sm:text-3xl font-black text-white tracking-tight">{value}</span>
                {subtext && <span className="text-[10px] text-text-muted font-mono mb-1">{subtext}</span>}
            </div>
        </div>
    );
}

function UserRow({ user, index }: { user: AdminUser; index: number }) {
    const [expanded, setExpanded] = useState(false);

    const formatDate = (iso: string | null) => {
        if (!iso) return '—';
        return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' });
    };

    return (
        <div className="border-b border-border last:border-b-0">
            <button
                onClick={() => setExpanded(!expanded)}
                className="w-full flex items-center gap-3 px-4 py-3 hover:bg-white/3 transition-colors cursor-pointer"
            >
                <span className="text-[10px] text-text-muted/40 font-mono w-6 text-right shrink-0">{index + 1}</span>
                <div className={`w-2 h-2 rounded-full shrink-0 ${user.is_active ? 'bg-accent-green shadow-[0_0_6px_rgba(16,185,129,0.5)]' : 'bg-white/15'}`} />
                <div className="flex-1 min-w-0 text-left">
                    <span className="text-xs text-white font-medium truncate block">{user.display_name || user.email}</span>
                    {user.display_name && <span className="text-[10px] text-text-muted/50 font-mono truncate block">{user.email}</span>}
                </div>
                <span className="text-[10px] text-text-muted font-mono hidden sm:block shrink-0">{formatDate(user.created_at)}</span>
                {expanded ? <ChevronUp size={12} className="text-text-muted shrink-0" /> : <ChevronDown size={12} className="text-text-muted shrink-0" />}
            </button>
            {expanded && (
                <div className="px-4 pb-3 pt-1 grid grid-cols-2 sm:grid-cols-3 gap-3 bg-black/20 border-t border-white/5">
                    <div>
                        <div className="text-[9px] text-text-muted/50 font-mono uppercase tracking-wider mb-0.5">Cadastro</div>
                        <div className="text-[11px] text-white font-mono">{formatDate(user.created_at)}</div>
                    </div>
                    <div>
                        <div className="text-[9px] text-text-muted/50 font-mono uppercase tracking-wider mb-0.5">Último acesso</div>
                        <div className="text-[11px] text-white font-mono">{formatDate(user.last_sign_in_at)}</div>
                    </div>
                    <div>
                        <div className="text-[9px] text-text-muted/50 font-mono uppercase tracking-wider mb-0.5">Provider</div>
                        <div className="text-[11px] text-white font-mono">
                            {user.provider === 'google' ? '🔵 Google' : user.provider === 'email' ? '📧 Email' : user.provider || '—'}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

// ─── helpers ──────────────────────────────────────────────────────────────────

function fmtTime(seconds: number) {
    if (seconds < 60) return `${seconds}s`;
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return s > 0 ? `${m}m ${s}s` : `${m}m`;
}

function fmtUSD(usd: number) {
    if (usd < 0.01) return `$${usd.toFixed(4)}`;
    return `$${usd.toFixed(2)}`;
}

function shortModelName(model: string) {
    const parts = model.split('/');
    return parts[parts.length - 1] || model;
}

const STATUS_STYLE: Record<string, string> = {
    succeeded: 'text-accent-green bg-accent-green/10 border-accent-green/20',
    failed:    'text-accent-red bg-accent-red/10 border-accent-red/20',
    canceled:  'text-text-muted bg-white/5 border-white/10',
    processing:'text-primary bg-primary/10 border-primary/20',
    starting:  'text-yellow-400 bg-yellow-400/10 border-yellow-400/20',
};

function statusLabel(s: ReplicatePredictionRow['status']) {
    return s === 'succeeded' ? 'ok' : s === 'failed' ? 'erro' : s;
}

// ─── Replicate section ────────────────────────────────────────────────────────

function ReplicateSection() {
    const { stats, loading, error, refetch } = useReplicateStats();

    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between">
                <h3 className="text-white font-black text-xs uppercase tracking-wider flex items-center gap-2">
                    <Cpu size={14} className="text-cyan-400" />
                    Replicate — Uso de IA
                </h3>
                <button
                    onClick={refetch}
                    disabled={loading}
                    className="p-1.5 text-text-muted hover:text-white hover:bg-white/5 rounded-lg transition-all active:scale-90 cursor-pointer disabled:opacity-30"
                >
                    <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
                </button>
            </div>

            {error && (
                <div className="p-3 bg-accent-red/10 border border-accent-red/20 rounded-lg text-accent-red text-xs font-mono">{error}</div>
            )}

            {loading && !stats && (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    {[...Array(4)].map((_, i) => <div key={i} className="daw-panel rounded-xl p-4 h-24 animate-pulse bg-white/3" />)}
                </div>
            )}

            {stats && (
                <>
                    {/* KPIs */}
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                        <StatCard icon={Cpu}        label="Total Predictions"  value={stats.total}         color="#06b6d4" iconBg="#06b6d410" />
                        <StatCard icon={TrendingUp} label="Últimos 30d"         value={stats.recentTotal}   subtext="predictions" color="#8b5cf6" iconBg="#8b5cf610" />
                        <StatCard icon={Activity}   label="Sucesso"             value={stats.total > 0 ? `${Math.round((stats.succeeded / stats.total) * 100)}%` : '—'} subtext={`${stats.succeeded} ok`} color="#10b981" iconBg="#10b98110" />
                        <StatCard icon={Clock}      label="Tempo de Compute"    value={fmtTime(stats.totalPredictTime)} color="#f59e0b" iconBg="#f59e0b10" />
                    </div>

                    {/* Top Models */}
                    {stats.topModels.length > 0 && (
                        <div className="daw-panel rounded-lg overflow-hidden">
                            <div className="flex items-center gap-2 px-4 py-2.5 bg-[#141416] border-b border-border text-[9px] font-bold text-text-muted/50 uppercase tracking-widest font-mono">
                                <BarChart3 size={11} className="text-cyan-400" />
                                <span className="flex-1">Modelo</span>
                                <span className="w-10 text-center">Runs</span>
                                <span className="w-16 text-right hidden sm:block">Tempo</span>
                                <span className="w-20 text-right">Custo est.</span>
                            </div>
                            <div className="divide-y divide-border">
                                {stats.topModels.map((m, i) => (
                                    <div key={m.model} className="flex items-center gap-3 px-4 py-2.5">
                                        <span className="text-[10px] text-text-muted/40 font-mono w-4">{i + 1}</span>
                                        <span className="flex-1 text-xs text-white font-mono truncate" title={m.model}>{shortModelName(m.model)}</span>
                                        <span className="w-10 text-center text-[10px] text-text-muted font-mono">{m.total}</span>
                                        <span className="w-16 text-right text-[10px] text-text-muted font-mono hidden sm:block">{fmtTime(m.totalTime)}</span>
                                        <span className="w-20 text-right text-[10px] text-cyan-400 font-mono font-bold">{fmtUSD(m.totalCost)}</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Recent Predictions */}
                    {stats.recentList.length > 0 && (
                        <div className="daw-panel rounded-lg overflow-hidden">
                            <div className="flex items-center gap-3 px-4 py-2.5 bg-[#141416] border-b border-border text-[9px] font-bold text-text-muted/50 uppercase tracking-widest font-mono">
                                <span className="flex-1">ID</span>
                                <span className="w-20 text-center">Modelo</span>
                                <span className="w-16 text-center">Status</span>
                                <span className="w-14 text-right hidden sm:block">Tempo</span>
                                <span className="w-20 text-right hidden sm:block">Custo est.</span>
                                <span className="w-20 text-right hidden md:block">Data</span>
                            </div>
                            <div className="divide-y divide-border max-h-64 overflow-y-auto">
                                {stats.recentList.map(p => (
                                    <div key={p.id} className="flex items-center gap-3 px-4 py-2 hover:bg-white/3 transition-colors">
                                        <span className="flex-1 text-[10px] text-text-muted font-mono truncate">{p.id}</span>
                                        <span className="w-20 text-[10px] text-white font-mono truncate text-center" title={p.model}>{shortModelName(p.model)}</span>
                                        <span className={`w-16 text-center text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full border ${STATUS_STYLE[p.status] ?? STATUS_STYLE.canceled}`}>
                                            {statusLabel(p.status)}
                                        </span>
                                        <span className="w-14 text-right text-[10px] text-text-muted font-mono hidden sm:block">
                                            {p.predict_time != null ? fmtTime(Math.round(p.predict_time)) : '—'}
                                        </span>
                                        <span className="w-20 text-right text-[10px] text-cyan-400 font-mono hidden sm:block">
                                            {p.estimated_cost > 0 ? fmtUSD(p.estimated_cost) : '—'}
                                        </span>
                                        <span className="w-20 text-right text-[10px] text-text-muted font-mono hidden md:block">
                                            {new Date(p.created_at).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })}
                                        </span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </>
            )}
        </div>
    );
}

// ─── Financial section ────────────────────────────────────────────────────────

const STATUS_PAY_STYLE: Record<string, string> = {
    PAID:      'text-accent-green bg-accent-green/10 border-accent-green/20',
    ACTIVE:    'text-accent-green bg-accent-green/10 border-accent-green/20',
    PENDING:   'text-yellow-400 bg-yellow-400/10 border-yellow-400/20',
    EXPIRED:   'text-text-muted bg-white/5 border-white/10',
    CANCELLED: 'text-accent-red bg-accent-red/10 border-accent-red/20',
};

function fmtBRL(val: number) {
    return val.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function FinancialSection() {
    const { stats: repl, loading: replLoading } = useReplicateStats();
    const { stats: pay, loading: payLoading, error: payError, refetch: payRefetch } = useAbacatePayStats();

    const formatMonth = (ym: string) => {
        const [y, m] = ym.split('-');
        const date = new Date(Number(y), Number(m) - 1, 1);
        return date.toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' });
    };

    const maxCost = repl ? Math.max(...repl.monthlyCosts.map(c => c.cost), 0.001) : 1;

    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between">
                <h3 className="text-white font-black text-xs uppercase tracking-wider flex items-center gap-2">
                    <DollarSign size={14} className="text-accent-green" />
                    Financeiro
                </h3>
                <button onClick={payRefetch} disabled={payLoading}
                    className="p-1.5 text-text-muted hover:text-white hover:bg-white/5 rounded-lg transition-all active:scale-90 cursor-pointer disabled:opacity-30">
                    <RefreshCw size={13} className={payLoading ? 'animate-spin' : ''} />
                </button>
            </div>

            {/* AbacatePay KPIs */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {/* Receita total */}
                <div className="daw-panel rounded-xl p-4 flex flex-col gap-2 relative overflow-hidden">
                    <div className="absolute top-0 right-0 w-24 h-24 rounded-full blur-[60px] opacity-10" style={{ backgroundColor: '#10b981' }} />
                    <div className="flex items-center justify-between">
                        <div className="p-2 rounded-lg border border-accent-green/20 bg-accent-green/10">
                            <TrendingUp size={16} className="text-accent-green" />
                        </div>
                        <span className="text-[9px] font-bold text-text-muted uppercase tracking-widest font-mono">Receita</span>
                    </div>
                    {payLoading ? <div className="h-8 w-24 animate-pulse bg-white/5 rounded" /> : (
                        <span className="text-xl sm:text-2xl font-black text-white tracking-tight">
                            {pay ? fmtBRL(pay.totalRevenueBRL) : '—'}
                        </span>
                    )}
                    <span className="text-[9px] text-text-muted font-mono">
                        {pay ? `${pay.paidCount} pagos de ${pay.totalCheckouts} cobranças` : payError ? '⚠ erro ao carregar' : ''}
                    </span>
                </div>

                {/* Assinaturas ativas */}
                <div className="daw-panel rounded-xl p-4 flex flex-col gap-2 relative overflow-hidden">
                    <div className="absolute top-0 right-0 w-24 h-24 rounded-full blur-[60px] opacity-10" style={{ backgroundColor: '#8b5cf6' }} />
                    <div className="flex items-center justify-between">
                        <div className="p-2 rounded-lg border border-purple-500/20 bg-purple-500/10">
                            <Activity size={16} className="text-purple-400" />
                        </div>
                        <span className="text-[9px] font-bold text-text-muted uppercase tracking-widest font-mono">Assinaturas</span>
                    </div>
                    {payLoading ? <div className="h-8 w-16 animate-pulse bg-white/5 rounded" /> : (
                        <span className="text-2xl sm:text-3xl font-black text-white tracking-tight">
                            {pay ? pay.activeSubscriptions : '—'}
                        </span>
                    )}
                    <span className="text-[9px] text-text-muted font-mono">
                        {pay ? `${pay.totalSubscriptions} total` : ''}
                    </span>
                </div>

                {/* Replicate 30d */}
                <div className="daw-panel rounded-xl p-4 flex flex-col gap-2 relative overflow-hidden">
                    <div className="absolute top-0 right-0 w-24 h-24 rounded-full blur-[60px] opacity-10" style={{ backgroundColor: '#ef4444' }} />
                    <div className="flex items-center justify-between">
                        <div className="p-2 rounded-lg border border-accent-red/20 bg-accent-red/10">
                            <Cpu size={16} className="text-accent-red" />
                        </div>
                        <span className="text-[9px] font-bold text-text-muted uppercase tracking-widest font-mono">Replicate 30d</span>
                    </div>
                    {replLoading ? <div className="h-8 w-24 animate-pulse bg-white/5 rounded" /> : (
                        <span className="text-2xl sm:text-3xl font-black text-white tracking-tight">
                            {repl ? fmtUSD(repl.recentCostUSD) : '—'}
                        </span>
                    )}
                    <span className="text-[9px] text-text-muted font-mono">
                        {repl ? `${repl.recentTotal} runs · ${fmtTime(repl.recentPredictTime)} compute` : ''}
                    </span>
                </div>

                {/* Replicate total */}
                <div className="daw-panel rounded-xl p-4 flex flex-col gap-2 relative overflow-hidden">
                    <div className="absolute top-0 right-0 w-24 h-24 rounded-full blur-[60px] opacity-10" style={{ backgroundColor: '#f59e0b' }} />
                    <div className="flex items-center justify-between">
                        <div className="p-2 rounded-lg border border-yellow-500/20 bg-yellow-500/10">
                            <Clock size={16} className="text-yellow-500" />
                        </div>
                        <span className="text-[9px] font-bold text-text-muted uppercase tracking-widest font-mono">Replicate Total</span>
                    </div>
                    {replLoading ? <div className="h-8 w-24 animate-pulse bg-white/5 rounded" /> : (
                        <span className="text-2xl sm:text-3xl font-black text-white tracking-tight">
                            {repl ? fmtUSD(repl.totalCostUSD) : '—'}
                        </span>
                    )}
                    <span className="text-[9px] text-text-muted font-mono">
                        {repl ? `${repl.total} runs acumulados` : ''}
                    </span>
                </div>
            </div>

            {/* Últimos pagamentos */}
            {pay && pay.recent.length > 0 && (
                <div className="daw-panel rounded-lg overflow-hidden">
                    <div className="flex items-center gap-2 px-4 py-2.5 bg-[#141416] border-b border-border text-[9px] font-bold text-text-muted/50 uppercase tracking-widest font-mono">
                        <DollarSign size={11} className="text-accent-green" />
                        <span className="flex-1">Últimos pagamentos (AbacatePay)</span>
                    </div>
                    <div className="divide-y divide-border max-h-48 overflow-y-auto">
                        {pay.recent.map(p => (
                            <div key={p.id} className="flex items-center gap-3 px-4 py-2 hover:bg-white/3 transition-colors">
                                <span className="flex-1 text-[10px] text-text-muted font-mono truncate">{p.id}</span>
                                <span className={`text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full border ${STATUS_PAY_STYLE[p.status] ?? STATUS_PAY_STYLE.EXPIRED}`}>
                                    {p.status}
                                </span>
                                <span className="text-[10px] text-accent-green font-mono font-bold w-20 text-right">
                                    {p.amount > 0 ? fmtBRL(p.amount / 100) : '—'}
                                </span>
                                <span className="text-[10px] text-text-muted font-mono w-16 text-right hidden sm:block">
                                    {p.createdAt ? new Date(p.createdAt).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' }) : '—'}
                                </span>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* Monthly Replicate cost chart */}
            {repl && repl.monthlyCosts.length > 0 && (
                <div className="daw-panel rounded-lg p-4 space-y-3">
                    <div className="flex items-center gap-2">
                        <BarChart3 size={12} className="text-accent-green" />
                        <span className="text-[9px] font-bold text-text-muted uppercase tracking-widest font-mono">Gasto mensal (Replicate)</span>
                        <span className="text-[9px] text-text-muted/40 font-mono ml-1">— custo estimado por mês</span>
                    </div>
                    <div className="flex items-end gap-2 h-20">
                        {repl.monthlyCosts.map((mc: ReplicateMonthlyCost) => {
                            const heightPct = (mc.cost / maxCost) * 100;
                            return (
                                <div key={mc.month} className="flex-1 flex flex-col items-center gap-1 group">
                                    <span className="text-[8px] text-cyan-400 font-mono opacity-0 group-hover:opacity-100 transition-opacity">
                                        {fmtUSD(mc.cost)}
                                    </span>
                                    <div className="w-full rounded-t-sm bg-cyan-400/20 border-t border-cyan-400/50 transition-all"
                                        style={{ height: `${Math.max(heightPct, 4)}%`, minHeight: '3px' }} />
                                    <span className="text-[8px] text-text-muted/60 font-mono">{formatMonth(mc.month)}</span>
                                </div>
                            );
                        })}
                    </div>
                    <div className="flex items-center gap-1.5 pt-1 border-t border-border">
                        <AlertCircle size={10} className="text-text-muted/40 shrink-0" />
                        <span className="text-[9px] text-text-muted/40 font-mono">
                            Estimativa baseada em tempo de compute × hardware (CPU: $0.0001/s, T4: $0.000225/s, A40: $0.000575/s)
                        </span>
                    </div>
                </div>
            )}
        </div>
    );
}

// ─── Main dashboard ───────────────────────────────────────────────────────────

export function AdminDashboard({ isOpen, onClose }: AdminDashboardProps) {
    const { stats, loading, error, refetch } = useAdminDashboard();
    const [searchQuery, setSearchQuery] = useState('');
    const [filterStatus, setFilterStatus] = useState<'all' | 'active' | 'inactive'>('all');

    if (!isOpen) return null;

    const filteredUsers = stats?.users.filter(u => {
        const matchesSearch = !searchQuery || u.email.toLowerCase().includes(searchQuery.toLowerCase()) ||
            (u.display_name ?? '').toLowerCase().includes(searchQuery.toLowerCase());
        const matchesStatus =
            filterStatus === 'all' ? true :
            filterStatus === 'active' ? u.is_active :
            !u.is_active;
        return matchesSearch && matchesStatus;
    }) || [];

    return (
        <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/80 backdrop-blur-lg p-3 sm:p-6 overflow-y-auto">
            <div className="daw-panel w-full max-w-5xl rounded-xl flex flex-col my-auto max-h-[95vh] overflow-hidden">

                {/* Header */}
                <div className="flex items-center justify-between p-4 border-b border-border shrink-0 bg-[#141416]">
                    <div className="flex items-center gap-3">
                        <div className="p-2 bg-primary/10 rounded-lg border border-primary/20">
                            <Shield size={20} className="text-primary" />
                        </div>
                        <div>
                            <h2 className="text-white font-black text-sm uppercase tracking-wider">Painel Administrativo</h2>
                            <p className="text-[10px] text-text-muted font-mono">Playback Studio — dados reais</p>
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        <button
                            onClick={refetch}
                            disabled={loading}
                            className="p-2 text-text-muted hover:text-white hover:bg-white/5 rounded-lg transition-all active:scale-90 cursor-pointer disabled:opacity-30"
                            title="Atualizar usuários"
                        >
                            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
                        </button>
                        <button
                            onClick={onClose}
                            className="p-2 text-text-muted hover:text-white hover:bg-white/5 rounded-lg transition-all active:scale-90 cursor-pointer"
                        >
                            <X size={18} />
                        </button>
                    </div>
                </div>

                {/* Content */}
                <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-8 bg-[#0e0e10]">

                    {error && (
                        <div className="p-3 bg-accent-red/10 border border-accent-red/20 rounded-lg text-accent-red text-xs font-mono">{error}</div>
                    )}

                    {loading && !stats && (
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                            {[...Array(4)].map((_, i) => <div key={i} className="daw-panel rounded-xl p-4 h-28 animate-pulse bg-white/3" />)}
                        </div>
                    )}

                    {stats && (
                        <>
                            {/* Usuários KPIs — apenas dados reais */}
                            <div>
                                <h3 className="text-white font-black text-xs uppercase tracking-wider flex items-center gap-2 mb-3">
                                    <Users size={14} className="text-primary" />
                                    Usuários
                                </h3>
                                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                                    <StatCard icon={Users}     label="Total Usuários"  value={stats.totalUsers}   color="#d4a843" iconBg="#d4a84310" />
                                    <StatCard icon={UserCheck} label="Ativos"           value={stats.activeUsers}  subtext="últimos 30d" color="#10b981" iconBg="#10b98110" />
                                    <StatCard icon={UserX}     label="Inativos"         value={stats.inactiveUsers} color="#ef4444" iconBg="#ef444410" />
                                    <StatCard icon={Music}     label="Músicas na Lib."  value={stats.totalSongs}   color="#8b5cf6" iconBg="#8b5cf610" />
                                </div>
                            </div>

                            {/* Users Table */}
                            <div className="space-y-3">
                                <div className="flex items-center gap-2">
                                    <div className="relative flex-1">
                                        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
                                        <input
                                            type="text"
                                            value={searchQuery}
                                            onChange={e => setSearchQuery(e.target.value)}
                                            placeholder="Buscar por email ou nome..."
                                            className="w-full daw-input text-white text-xs pl-9 pr-3 py-2.5 rounded-lg font-mono"
                                        />
                                    </div>
                                    <div className="flex lcd-display rounded-lg overflow-hidden border border-border shrink-0">
                                        {(['all', 'active', 'inactive'] as const).map(f => (
                                            <button
                                                key={f}
                                                onClick={() => setFilterStatus(f)}
                                                className={`px-3 py-2 text-[9px] font-bold uppercase tracking-wider transition-all cursor-pointer font-mono ${filterStatus === f ? 'bg-white/10 text-white' : 'text-text-muted hover:text-white hover:bg-white/5'}`}
                                            >
                                                {f === 'all' ? 'Todos' : f === 'active' ? 'Ativos' : 'Inativos'}
                                            </button>
                                        ))}
                                    </div>
                                </div>

                                <div className="daw-panel rounded-lg overflow-hidden">
                                    <div className="flex items-center gap-3 px-4 py-2.5 bg-[#141416] border-b border-border text-[9px] font-bold text-text-muted/50 uppercase tracking-widest font-mono">
                                        <span className="w-6 text-right">#</span>
                                        <span className="w-2" />
                                        <span className="flex-1">Usuário</span>
                                        <span className="hidden sm:block text-right">Cadastro</span>
                                        <span className="w-4" />
                                    </div>
                                    {filteredUsers.length === 0 ? (
                                        <div className="py-12 text-center text-text-muted/30 text-xs font-mono">
                                            Nenhum usuário encontrado
                                        </div>
                                    ) : (
                                        filteredUsers.map((user, i) => <UserRow key={user.id} user={user} index={i} />)
                                    )}
                                </div>
                            </div>
                        </>
                    )}

                    {/* Financeiro */}
                    <div className="border-t border-border pt-6">
                        <FinancialSection />
                    </div>

                    {/* Replicate */}
                    <div className="border-t border-border pt-6">
                        <ReplicateSection />
                    </div>
                </div>
            </div>
        </div>
    );
}

import { useState } from 'react';
import { X, Users, Music, Coins, TrendingUp, Activity, UserCheck, UserX, CreditCard, RefreshCw, BarChart3, Search, ChevronDown, ChevronUp, Shield, Cpu, Clock } from 'lucide-react';
import { useAdminDashboard, type AdminUser } from '../hooks/useAdminDashboard';
import { useReplicateStats, type ReplicatePredictionRow } from '../hooks/useReplicateStats';

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
    const planColors: Record<string, string> = {
        free: 'text-text-muted bg-white/5 border-white/10',
        pro: 'text-secondary bg-secondary/10 border-secondary/20',
        premium: 'text-primary bg-primary/10 border-primary/20'
    };
    const planBadge = planColors[user.plan] || planColors.free;

    const formatDate = (iso: string | null) => {
        if (!iso) return '—';
        const d = new Date(iso);
        return d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' });
    };

    return (
        <div className="border-b border-border last:border-b-0">
            <button
                onClick={() => setExpanded(!expanded)}
                className="w-full flex items-center gap-3 px-4 py-3 hover:bg-white/3 transition-colors cursor-pointer group"
            >
                <span className="text-[10px] text-text-muted/40 font-mono w-6 text-right shrink-0">{index + 1}</span>
                <div className={`w-2 h-2 rounded-full shrink-0 ${user.is_active ? 'bg-accent-green shadow-[0_0_6px_rgba(16,185,129,0.5)]' : 'bg-white/15'}`} />
                <div className="flex-1 min-w-0 text-left">
                    <span className="text-xs text-white font-medium truncate block">{user.display_name || user.email}</span>
                    {user.display_name && <span className="text-[10px] text-text-muted/50 font-mono truncate block">{user.email}</span>}
                </div>
                <span className={`text-[9px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full border ${planBadge}`}>
                    {user.plan}
                </span>
                <span className="text-[10px] text-text-muted font-mono hidden sm:block w-20 text-right">{user.tokens_used} tok</span>
                <span className="text-[10px] text-text-muted font-mono hidden sm:block w-20 text-right">{user.songs_count} mus</span>
                {expanded ? <ChevronUp size={12} className="text-text-muted shrink-0" /> : <ChevronDown size={12} className="text-text-muted shrink-0" />}
            </button>
            {expanded && (
                <div className="px-4 pb-3 pt-1 grid grid-cols-2 sm:grid-cols-5 gap-3 bg-black/20 border-t border-white/5">
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
                        <div className="text-[11px] text-white font-mono flex items-center gap-1">
                            {user.provider === 'google' ? '🔵 Google' : user.provider === 'email' ? '📧 Email' : user.provider || '—'}
                        </div>
                    </div>
                    <div>
                        <div className="text-[9px] text-text-muted/50 font-mono uppercase tracking-wider mb-0.5">Tokens usados</div>
                        <div className="text-[11px] text-white font-mono">{user.tokens_used.toLocaleString('pt-BR')}</div>
                    </div>
                    <div>
                        <div className="text-[9px] text-text-muted/50 font-mono uppercase tracking-wider mb-0.5">Músicas criadas</div>
                        <div className="text-[11px] text-white font-mono">{user.songs_count}</div>
                    </div>
                </div>
            )}
        </div>
    );
}

function ReplicateSection() {
    const { stats, loading, error, refetch } = useReplicateStats();

    const formatTime = (seconds: number) => {
        if (seconds < 60) return `${seconds}s`;
        const m = Math.floor(seconds / 60);
        const s = seconds % 60;
        return `${m}m ${s}s`;
    };

    const formatModelName = (model: string) => {
        const parts = model.split('/');
        return parts[parts.length - 1] || model;
    };

    const statusBadge = (status: ReplicatePredictionRow['status']) => {
        const map: Record<string, string> = {
            succeeded: 'text-accent-green bg-accent-green/10 border-accent-green/20',
            failed: 'text-accent-red bg-accent-red/10 border-accent-red/20',
            canceled: 'text-text-muted bg-white/5 border-white/10',
            processing: 'text-primary bg-primary/10 border-primary/20',
            starting: 'text-yellow-400 bg-yellow-400/10 border-yellow-400/20',
        };
        return map[status] || map.canceled;
    };

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
                <div className="p-3 bg-accent-red/10 border border-accent-red/20 rounded-lg text-accent-red text-xs font-mono">
                    {error}
                </div>
            )}

            {loading && !stats && (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    {[...Array(4)].map((_, i) => (
                        <div key={i} className="daw-panel rounded-xl p-4 h-24 animate-pulse bg-white/3" />
                    ))}
                </div>
            )}

            {stats && (
                <>
                    {/* KPIs */}
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                        <StatCard icon={Cpu} label="Total Predictions" value={stats.total} color="#06b6d4" iconBg="#06b6d410" />
                        <StatCard icon={TrendingUp} label="Últimos 30d" value={stats.recentTotal} subtext="predictions" color="#8b5cf6" iconBg="#8b5cf610" />
                        <StatCard icon={Activity} label="Sucesso" value={`${stats.total > 0 ? Math.round((stats.succeeded / stats.total) * 100) : 0}%`} subtext={`${stats.succeeded} ok`} color="#10b981" iconBg="#10b98110" />
                        <StatCard icon={Clock} label="Tempo Total" value={formatTime(stats.totalPredictTime)} subtext="processamento" color="#f59e0b" iconBg="#f59e0b10" />
                    </div>

                    {/* Top Models */}
                    {stats.topModels.length > 0 && (
                        <div className="daw-panel rounded-lg overflow-hidden">
                            <div className="flex items-center gap-2 px-4 py-2.5 bg-[#141416] border-b border-border">
                                <BarChart3 size={12} className="text-cyan-400" />
                                <span className="text-[9px] font-bold text-text-muted uppercase tracking-widest font-mono">Modelos mais usados</span>
                            </div>
                            <div className="divide-y divide-border">
                                {stats.topModels.map((m, i) => (
                                    <div key={m.model} className="flex items-center gap-3 px-4 py-2.5">
                                        <span className="text-[10px] text-text-muted/40 font-mono w-4">{i + 1}</span>
                                        <span className="flex-1 text-xs text-white font-mono truncate" title={m.model}>{formatModelName(m.model)}</span>
                                        <span className="text-[10px] text-text-muted font-mono">{m.total}x</span>
                                        <span className="text-[10px] text-accent-green font-mono w-16 text-right">{formatTime(Math.round(m.totalTime))}</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Recent Predictions Table */}
                    {stats.recentList.length > 0 && (
                        <div className="daw-panel rounded-lg overflow-hidden">
                            <div className="flex items-center gap-2 px-4 py-2.5 bg-[#141416] border-b border-border text-[9px] font-bold text-text-muted/50 uppercase tracking-widest font-mono">
                                <span className="flex-1">Prediction</span>
                                <span className="w-20 text-center">Modelo</span>
                                <span className="w-20 text-center">Status</span>
                                <span className="w-16 text-right hidden sm:block">Tempo</span>
                                <span className="w-24 text-right hidden sm:block">Data</span>
                            </div>
                            <div className="divide-y divide-border max-h-64 overflow-y-auto">
                                {stats.recentList.map(p => (
                                    <div key={p.id} className="flex items-center gap-3 px-4 py-2 hover:bg-white/3 transition-colors">
                                        <span className="flex-1 text-[10px] text-text-muted font-mono truncate">{p.id}</span>
                                        <span className="w-20 text-[10px] text-white font-mono truncate text-center" title={p.model}>{formatModelName(p.model)}</span>
                                        <span className={`w-20 text-center text-[9px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full border ${statusBadge(p.status)}`}>
                                            {p.status === 'succeeded' ? 'ok' : p.status === 'failed' ? 'erro' : p.status}
                                        </span>
                                        <span className="w-16 text-right text-[10px] text-text-muted font-mono hidden sm:block">
                                            {p.predict_time != null ? formatTime(Math.round(p.predict_time)) : '—'}
                                        </span>
                                        <span className="w-24 text-right text-[10px] text-text-muted font-mono hidden sm:block">
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

export function AdminDashboard({ isOpen, onClose }: AdminDashboardProps) {
    const { stats, loading, error, refetch } = useAdminDashboard();
    const [searchQuery, setSearchQuery] = useState('');
    const [filterStatus, setFilterStatus] = useState<'all' | 'active' | 'inactive'>('all');

    if (!isOpen) return null;

    const filteredUsers = stats?.users.filter(u => {
        const matchesSearch = !searchQuery || u.email.toLowerCase().includes(searchQuery.toLowerCase());
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
                            <p className="text-[10px] text-text-muted font-mono">Visão geral da plataforma Playback Studio</p>
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        <button
                            onClick={refetch}
                            disabled={loading}
                            className="p-2 text-text-muted hover:text-white hover:bg-white/5 rounded-lg transition-all active:scale-90 cursor-pointer disabled:opacity-30"
                            title="Atualizar dados"
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
                <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-6 bg-[#0e0e10]">

                    {/* Error */}
                    {error && (
                        <div className="p-3 bg-accent-red/10 border border-accent-red/20 rounded-lg text-accent-red text-xs font-mono">
                            {error}
                        </div>
                    )}

                    {/* Loading Skeleton */}
                    {loading && !stats && (
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                            {[...Array(8)].map((_, i) => (
                                <div key={i} className="daw-panel rounded-xl p-4 h-28 animate-pulse bg-white/3" />
                            ))}
                        </div>
                    )}

                    {stats && (
                        <>
                            {/* KPI Grid */}
                            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                                <StatCard
                                    icon={Users}
                                    label="Total Usuários"
                                    value={stats.totalUsers}
                                    color="#d4a843"
                                    iconBg="#d4a84310"
                                />
                                <StatCard
                                    icon={UserCheck}
                                    label="Ativos"
                                    value={stats.activeUsers}
                                    subtext="últimos 30d"
                                    color="#10b981"
                                    iconBg="#10b98110"
                                />
                                <StatCard
                                    icon={UserX}
                                    label="Inativos"
                                    value={stats.inactiveUsers}
                                    color="#ef4444"
                                    iconBg="#ef444410"
                                />
                                <StatCard
                                    icon={Music}
                                    label="Músicas Criadas"
                                    value={stats.totalSongs}
                                    color="#8b5cf6"
                                    iconBg="#8b5cf610"
                                />
                                <StatCard
                                    icon={Coins}
                                    label="Tokens Usados"
                                    value={stats.totalTokensUsed.toLocaleString('pt-BR')}
                                    color="#06b6d4"
                                    iconBg="#06b6d410"
                                />
                                <StatCard
                                    icon={CreditCard}
                                    label="Assinantes"
                                    value={stats.totalSubscribers}
                                    color="#f59e0b"
                                    iconBg="#f59e0b10"
                                />
                                <StatCard
                                    icon={TrendingUp}
                                    label="Faturamento"
                                    value={`R$${stats.monthlyRevenue.toFixed(2).replace('.', ',')}`}
                                    subtext="/mês"
                                    color="#10b981"
                                    iconBg="#10b98110"
                                />
                                <StatCard
                                    icon={Activity}
                                    label="Taxa Ativação"
                                    value={stats.totalUsers > 0 ? `${Math.round((stats.activeUsers / stats.totalUsers) * 100)}%` : '0%'}
                                    color="#ec4899"
                                    iconBg="#ec489910"
                                />
                            </div>

                            {/* Quick Stats Bar */}
                            <div className="flex items-center gap-4 px-4 py-3 lcd-display rounded-lg border border-border overflow-x-auto">
                                <div className="flex items-center gap-2 shrink-0">
                                    <BarChart3 size={14} className="text-primary" />
                                    <span className="text-[10px] font-bold text-text-muted uppercase tracking-wider font-mono">Resumo</span>
                                </div>
                                <div className="h-4 w-px bg-border shrink-0" />
                                <div className="flex items-center gap-1.5 shrink-0">
                                    <div className="w-2 h-2 rounded-full bg-accent-green" />
                                    <span className="text-[10px] font-mono text-text-muted">{stats.activeUsers} ativos</span>
                                </div>
                                <div className="flex items-center gap-1.5 shrink-0">
                                    <div className="w-2 h-2 rounded-full bg-accent-red" />
                                    <span className="text-[10px] font-mono text-text-muted">{stats.inactiveUsers} inativos</span>
                                </div>
                                <div className="flex items-center gap-1.5 shrink-0">
                                    <div className="w-2 h-2 rounded-full bg-primary" />
                                    <span className="text-[10px] font-mono text-text-muted">{stats.totalSubscribers} pagantes</span>
                                </div>
                                <div className="flex items-center gap-1.5 shrink-0">
                                    <div className="w-2 h-2 rounded-full bg-purple-500" />
                                    <span className="text-[10px] font-mono text-text-muted">{stats.totalSongs} músicas</span>
                                </div>
                            </div>

                            {/* Users Table */}
                            <div className="space-y-3">
                                <div className="flex items-center justify-between">
                                    <h3 className="text-white font-black text-xs uppercase tracking-wider flex items-center gap-2">
                                        <Users size={14} className="text-primary" />
                                        Usuários ({filteredUsers.length})
                                    </h3>
                                </div>

                                {/* Search + Filter */}
                                <div className="flex items-center gap-2">
                                    <div className="relative flex-1">
                                        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
                                        <input
                                            type="text"
                                            value={searchQuery}
                                            onChange={(e) => setSearchQuery(e.target.value)}
                                            placeholder="Buscar por email..."
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

                                {/* User List */}
                                <div className="daw-panel rounded-lg overflow-hidden">
                                    {/* Table Header */}
                                    <div className="flex items-center gap-3 px-4 py-2.5 bg-[#141416] border-b border-border text-[9px] font-bold text-text-muted/50 uppercase tracking-widest font-mono">
                                        <span className="w-6 text-right">#</span>
                                        <span className="w-2" />
                                        <span className="flex-1">Email</span>
                                        <span className="w-16 text-center">Plano</span>
                                        <span className="w-20 text-right hidden sm:block">Tokens</span>
                                        <span className="w-20 text-right hidden sm:block">Músicas</span>
                                        <span className="w-4" />
                                    </div>

                                    {filteredUsers.length === 0 ? (
                                        <div className="py-12 text-center text-text-muted/30 text-xs font-mono">
                                            Nenhum usuário encontrado
                                        </div>
                                    ) : (
                                        filteredUsers.map((user, i) => (
                                            <UserRow key={user.id} user={user} index={i} />
                                        ))
                                    )}
                                </div>
                            </div>
                        </>
                    )}

                    {/* Replicate Section */}
                    <div className="border-t border-border pt-6">
                        <ReplicateSection />
                    </div>
                </div>
            </div>
        </div>
    );
}

import type { LucideIcon } from 'lucide-react';

export function StatCard({ icon: Icon, label, value, subtext, color, iconBg }: {
  icon: LucideIcon; label: string; value: string | number; subtext?: string; color: string; iconBg: string;
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

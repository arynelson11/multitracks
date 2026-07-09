import { useState, type ReactNode } from 'react';
import { Shield, LogOut } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

export interface AdminTab { id: string; label: string; icon: LucideIcon; content: ReactNode; }

export function AdminShell({ email, onSignOut, tabs }: {
  email: string | null; onSignOut: () => void; tabs: AdminTab[];
}) {
  const [active, setActive] = useState(tabs[0]?.id);
  const current = tabs.find(t => t.id === active) ?? tabs[0];

  return (
    <div className="min-h-screen bg-[#0e0e10] text-white">
      <header className="flex items-center justify-between px-4 sm:px-6 py-3 border-b border-border bg-[#141416] sticky top-0 z-10">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-primary/10 rounded-lg border border-primary/20"><Shield size={18} className="text-primary" /></div>
          <div>
            <h1 className="font-black text-xs uppercase tracking-wider">Painel Administrativo</h1>
            <p className="text-[10px] text-text-muted font-mono">{email}</p>
          </div>
        </div>
        <button onClick={onSignOut} className="flex items-center gap-1.5 text-text-muted hover:text-white text-xs px-3 py-1.5 rounded-lg hover:bg-white/5 transition-all">
          <LogOut size={14} /> Sair
        </button>
      </header>
      <nav className="flex gap-1 px-4 sm:px-6 pt-4 overflow-x-auto border-b border-border">
        {tabs.map(t => {
          const Icon = t.icon;
          return (
            <button key={t.id} onClick={() => setActive(t.id)}
              className={`flex items-center gap-2 px-4 py-2.5 text-xs font-bold rounded-t-lg whitespace-nowrap transition-all ${active === t.id ? 'bg-[#141416] text-white border-b-2 border-primary' : 'text-text-muted hover:text-white'}`}>
              <Icon size={14} /> {t.label}
            </button>
          );
        })}
      </nav>
      <main className="p-4 sm:p-6 max-w-6xl mx-auto">{current?.content}</main>
    </div>
  );
}

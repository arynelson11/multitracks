import type { ReactNode } from 'react';

export interface Column<T> {
  key: string;
  header: string;
  render: (row: T) => ReactNode;
  className?: string;
}

export function DataTable<T>({ columns, rows, empty = 'Sem dados' }: {
  columns: Column<T>[]; rows: T[]; empty?: string;
}) {
  return (
    <div className="daw-panel rounded-lg overflow-hidden">
      <div className="flex items-center gap-3 px-4 py-2.5 bg-[#141416] border-b border-border text-[9px] font-bold text-text-muted/50 uppercase tracking-widest font-mono">
        {columns.map(c => <span key={c.key} className={c.className ?? 'flex-1'}>{c.header}</span>)}
      </div>
      {rows.length === 0 ? (
        <div className="py-12 text-center text-text-muted/30 text-xs font-mono">{empty}</div>
      ) : (
        <div className="divide-y divide-border max-h-[28rem] overflow-y-auto">
          {rows.map((row, i) => (
            <div key={i} className="flex items-center gap-3 px-4 py-2.5 hover:bg-white/3 transition-colors">
              {columns.map(c => <span key={c.key} className={c.className ?? 'flex-1'}>{c.render(row)}</span>)}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function BarChart({ data, format }: {
  data: { label: string; value: number }[]; format?: (v: number) => string;
}) {
  const max = Math.max(...data.map(d => d.value), 0.0001);
  return (
    <div className="flex items-end gap-2 h-24">
      {data.map(d => (
        <div key={d.label} className="flex-1 flex flex-col items-center gap-1 group">
          <span className="text-[8px] text-primary font-mono opacity-0 group-hover:opacity-100 transition-opacity">
            {format ? format(d.value) : d.value}
          </span>
          <div className="w-full rounded-t-sm bg-primary/20 border-t border-primary/50 transition-all"
            style={{ height: `${Math.max((d.value / max) * 100, 4)}%`, minHeight: '3px' }} />
          <span className="text-[8px] text-text-muted/60 font-mono">{d.label}</span>
        </div>
      ))}
    </div>
  );
}

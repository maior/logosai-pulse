'use client';

interface Trace {
  id: string;
  agent_id: string;
  agent_name: string;
  query: string;
  success: boolean;
  duration_ms: number;
  token_count: number;
  cost_usd: number;
  created_at: string;
  error_message?: string;
  trace_id?: string;
}

interface Props {
  traces: Trace[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}

export function TraceTable({ traces, selectedId, onSelect }: Props) {
  const formatTime = (iso: string) => {
    if (!iso) return '';
    const d = new Date(iso);
    return d.toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  };

  const formatDuration = (ms: number) => {
    if (ms >= 1000) return `${(ms / 1000).toFixed(1)}s`;
    return `${ms.toFixed(0)}ms`;
  };

  return (
    <div className="border border-slate-800 bg-slate-900/30 rounded-lg overflow-hidden">
      <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between">
        <h3 className="text-[10px] uppercase tracking-wider text-slate-500 font-medium">Recent Traces</h3>
        <span className="text-[10px] text-slate-600 tabular-nums">{traces.length}</span>
      </div>
      <div className="overflow-auto max-h-[440px]">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-slate-950/95 backdrop-blur">
            <tr className="text-slate-500">
              <th className="text-left px-4 py-2 font-medium text-[10px] uppercase tracking-wider">Time</th>
              <th className="text-left px-2 py-2 font-medium text-[10px] uppercase tracking-wider">Agent</th>
              <th className="text-left px-2 py-2 font-medium text-[10px] uppercase tracking-wider">Query</th>
              <th className="text-right px-2 py-2 font-medium text-[10px] uppercase tracking-wider">Dur</th>
              <th className="text-right px-4 py-2 font-medium text-[10px] uppercase tracking-wider">Cost</th>
            </tr>
          </thead>
          <tbody>
            {traces.length === 0 ? (
              <tr><td colSpan={5} className="text-center py-12 text-slate-600 text-xs">No traces yet</td></tr>
            ) : traces.map(t => (
              <tr
                key={t.id}
                onClick={() => onSelect(selectedId === t.id ? null : t.id)}
                className={`border-t border-slate-800/40 cursor-pointer transition-colors ${
                  selectedId === t.id ? 'bg-indigo-500/[0.08]' : 'hover:bg-slate-800/30'
                }`}
              >
                <td className="px-4 py-2 text-slate-500 tabular-nums font-mono text-[11px]">{formatTime(t.created_at)}</td>
                <td className="px-2 py-2">
                  <span className={`inline-block w-1.5 h-1.5 rounded-full mr-2 ${t.success ? 'bg-emerald-400' : 'bg-rose-400'}`} />
                  <span className="text-slate-200 font-medium">{t.agent_id.replace(/_agent$/, '')}</span>
                </td>
                <td className="px-2 py-2 text-slate-400 max-w-[240px] truncate">{t.query}</td>
                <td className="px-2 py-2 text-right text-slate-300 tabular-nums">{formatDuration(t.duration_ms)}</td>
                <td className="px-4 py-2 text-right text-slate-500 tabular-nums">${t.cost_usd.toFixed(4)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

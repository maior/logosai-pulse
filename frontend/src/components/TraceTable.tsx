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
    <div className="bg-slate-900/50 border border-slate-800 rounded-xl p-4">
      <h3 className="text-sm font-medium text-slate-300 mb-4">Recent Traces</h3>
      <div className="overflow-auto max-h-96">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-slate-500 border-b border-slate-800">
              <th className="text-left py-2 font-medium">Time</th>
              <th className="text-left py-2 font-medium">Agent</th>
              <th className="text-left py-2 font-medium">Query</th>
              <th className="text-right py-2 font-medium">Duration</th>
              <th className="text-right py-2 font-medium">Cost</th>
            </tr>
          </thead>
          <tbody>
            {traces.length === 0 ? (
              <tr><td colSpan={5} className="text-center py-8 text-slate-600">No traces yet</td></tr>
            ) : traces.map(t => (
              <tr
                key={t.id}
                onClick={() => onSelect(selectedId === t.id ? null : t.id)}
                className={`border-b border-slate-800/50 cursor-pointer transition-colors ${
                  selectedId === t.id ? 'bg-purple-500/10' : 'hover:bg-slate-800/30'
                }`}
              >
                <td className="py-2 text-slate-400">{formatTime(t.created_at)}</td>
                <td className="py-2">
                  <span className={`inline-block w-1.5 h-1.5 rounded-full mr-1.5 ${t.success ? 'bg-green-400' : 'bg-red-400'}`} />
                  <span className="text-slate-300">{t.agent_id.replace(/_agent$/, '')}</span>
                </td>
                <td className="py-2 text-slate-400 max-w-32 truncate">{t.query}</td>
                <td className="py-2 text-right text-slate-300">{formatDuration(t.duration_ms)}</td>
                <td className="py-2 text-right text-slate-400">${t.cost_usd.toFixed(4)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

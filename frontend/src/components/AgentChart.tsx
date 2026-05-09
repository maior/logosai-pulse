'use client';

import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';

interface Agent {
  agent_id: string;
  agent_name: string;
  total_calls: number;
  success_rate: number;
  avg_duration_ms: number;
}

export function AgentChart({ agents }: { agents: Agent[] }) {
  const data = agents.slice(0, 10).map(a => ({
    name: a.agent_id.replace(/_agent$/, '').replace(/_/g, ' '),
    rate: Math.round(a.success_rate * 100),
    calls: a.total_calls,
  }));

  const getColor = (rate: number) => {
    if (rate >= 95) return '#34d399'; // emerald-400
    if (rate >= 80) return '#fbbf24'; // amber-400
    if (rate >= 60) return '#fb923c'; // orange-400
    return '#fb7185';                 // rose-400
  };

  return (
    <div className="border border-slate-800 bg-slate-900/30 rounded-lg overflow-hidden">
      <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between">
        <h3 className="text-[10px] uppercase tracking-wider text-slate-500 font-medium">Agent Success Rate</h3>
        <span className="text-[10px] text-slate-600 tabular-nums">top {data.length}</span>
      </div>
      <div className="p-4">
        {data.length === 0 ? (
          <div className="h-48 flex items-center justify-center text-slate-600 text-xs">No data</div>
        ) : (
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={data} layout="vertical" margin={{ left: 80, right: 20 }}>
              <XAxis type="number" domain={[0, 100]} tick={{ fill: '#64748b', fontSize: 10 }} />
              <YAxis type="category" dataKey="name" tick={{ fill: '#94a3b8', fontSize: 11 }} width={80} />
              <Tooltip
                cursor={{ fill: 'rgba(99,102,241,0.06)' }}
                contentStyle={{ background: '#0f172a', border: '1px solid #1e293b', borderRadius: 6, fontSize: 11, padding: '6px 10px' }}
                labelStyle={{ color: '#cbd5e1', fontSize: 11 }}
                formatter={(value: any) => [`${value}%`, 'Success Rate']}
              />
              <Bar dataKey="rate" radius={[0, 3, 3, 0]}>
                {data.map((entry, i) => (
                  <Cell key={i} fill={getColor(entry.rate)} fillOpacity={0.85} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}

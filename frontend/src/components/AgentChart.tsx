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
    if (rate >= 95) return '#22c55e';
    if (rate >= 80) return '#eab308';
    if (rate >= 60) return '#f97316';
    return '#ef4444';
  };

  return (
    <div className="bg-slate-900/50 border border-slate-800 rounded-xl p-4">
      <h3 className="text-sm font-medium text-slate-300 mb-4">Agent Success Rate</h3>
      {data.length === 0 ? (
        <div className="h-48 flex items-center justify-center text-slate-600 text-sm">No data</div>
      ) : (
        <ResponsiveContainer width="100%" height={280}>
          <BarChart data={data} layout="vertical" margin={{ left: 80, right: 20 }}>
            <XAxis type="number" domain={[0, 100]} tick={{ fill: '#64748b', fontSize: 11 }} />
            <YAxis type="category" dataKey="name" tick={{ fill: '#94a3b8', fontSize: 11 }} width={80} />
            <Tooltip
              contentStyle={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 8, fontSize: 12 }}
              formatter={(value: any) => [`${value}%`, 'Success Rate']}
            />
            <Bar dataKey="rate" radius={[0, 4, 4, 0]}>
              {data.map((entry, i) => (
                <Cell key={i} fill={getColor(entry.rate)} fillOpacity={0.7} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}

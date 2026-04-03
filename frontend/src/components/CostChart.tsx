'use client';

import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts';

interface CostData {
  total_cost_usd?: number;
  by_model?: Array<{ model: string; cost_usd: number; calls: number }>;
}

const COLORS = ['#a78bfa', '#38bdf8', '#34d399', '#fbbf24', '#f87171', '#fb923c'];

export function CostChart({ costs }: { costs: CostData }) {
  const models = (costs.by_model || []).filter(m => m.cost_usd > 0);
  const data = models.map(m => ({
    name: m.model.replace('gemini-2.5-', 'g-').replace('gpt-4o', 'gpt4o'),
    value: m.cost_usd,
    calls: m.calls,
    fullName: m.model,
  }));

  return (
    <div className="bg-slate-900/50 border border-slate-800 rounded-xl p-4">
      <h3 className="text-sm font-medium text-slate-300 mb-2">Cost by Model</h3>
      <div className="text-xl font-bold text-purple-300 mb-3">
        ${(costs.total_cost_usd ?? 0).toFixed(4)}
      </div>
      {data.length === 0 ? (
        <div className="h-40 flex items-center justify-center text-slate-600 text-sm">No cost data</div>
      ) : (
        <>
          <ResponsiveContainer width="100%" height={160}>
            <PieChart>
              <Pie data={data} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={60} strokeWidth={0}>
                {data.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} fillOpacity={0.7} />)}
              </Pie>
              <Tooltip
                contentStyle={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 8, fontSize: 12 }}
                formatter={(value: any) => [`$${Number(value).toFixed(4)}`, 'Cost']}
              />
            </PieChart>
          </ResponsiveContainer>
          <div className="space-y-1 mt-2">
            {data.map((m, i) => (
              <div key={m.fullName} className="flex items-center justify-between text-xs">
                <div className="flex items-center gap-1.5">
                  <div className="w-2 h-2 rounded-full" style={{ background: COLORS[i % COLORS.length] }} />
                  <span className="text-slate-400">{m.fullName}</span>
                </div>
                <span className="text-slate-300">${m.value.toFixed(4)}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

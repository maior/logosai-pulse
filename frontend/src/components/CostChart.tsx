'use client';

import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts';

interface CostData {
  total_cost_usd?: number;
  by_model?: Array<{ model: string; cost_usd: number; calls: number }>;
}

// Indigo-anchored palette, semantic for model families
const COLORS = ['#818cf8', '#22d3ee', '#34d399', '#fbbf24', '#fb7185', '#fb923c'];

export function CostChart({ costs }: { costs: CostData }) {
  const models = (costs.by_model || []).filter(m => m.cost_usd > 0);
  const data = models.map(m => ({
    name: m.model.replace('gemini-2.5-', 'g-').replace('gpt-4o', 'gpt4o'),
    value: m.cost_usd,
    calls: m.calls,
    fullName: m.model,
  }));

  return (
    <div className="border border-slate-800 bg-slate-900/30 rounded-lg overflow-hidden">
      <div className="px-4 py-3 border-b border-slate-800">
        <div className="text-[10px] uppercase tracking-wider text-slate-500 font-medium mb-1">Cost by Model</div>
        <div className="text-2xl font-semibold tabular-nums tracking-tight text-slate-100">
          ${(costs.total_cost_usd ?? 0).toFixed(4)}
        </div>
      </div>
      <div className="p-4">
        {data.length === 0 ? (
          <div className="h-40 flex items-center justify-center text-slate-600 text-xs">No cost data</div>
        ) : (
          <>
            <ResponsiveContainer width="100%" height={140}>
              <PieChart>
                <Pie data={data} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={36} outerRadius={60} strokeWidth={0}>
                  {data.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} fillOpacity={0.85} />)}
                </Pie>
                <Tooltip
                  contentStyle={{ background: '#0f172a', border: '1px solid #1e293b', borderRadius: 6, fontSize: 11, padding: '6px 10px' }}
                  labelStyle={{ color: '#cbd5e1', fontSize: 11 }}
                  formatter={(value: any) => [`$${Number(value).toFixed(4)}`, 'Cost']}
                />
              </PieChart>
            </ResponsiveContainer>
            <div className="space-y-1.5 mt-3 pt-3 border-t border-slate-800">
              {data.map((m, i) => (
                <div key={m.fullName} className="flex items-center justify-between text-xs">
                  <div className="flex items-center gap-2 min-w-0">
                    <div className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: COLORS[i % COLORS.length] }} />
                    <span className="text-slate-400 truncate font-mono text-[11px]">{m.fullName}</span>
                  </div>
                  <span className="text-slate-200 tabular-nums shrink-0">${m.value.toFixed(4)}</span>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

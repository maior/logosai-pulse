'use client';

import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';

interface TrendPoint {
  hour: string;
  calls: number;
  avg_duration_ms: number;
  cost_usd: number;
}

export function TrendChart({ trend }: { trend: TrendPoint[] }) {
  const data = trend.map(t => ({
    time: t.hour ? new Date(t.hour).toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit' }) : '',
    calls: t.calls,
    duration: Math.round(t.avg_duration_ms),
  }));

  return (
    <div className="border border-slate-800 bg-slate-900/30 rounded-lg overflow-hidden">
      <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between">
        <h3 className="text-[10px] uppercase tracking-wider text-slate-500 font-medium">Response Time & Volume</h3>
        <div className="flex items-center gap-3 text-[10px]">
          <span className="flex items-center gap-1.5"><span className="w-2 h-px bg-indigo-400" /><span className="text-slate-400">Duration</span></span>
          <span className="flex items-center gap-1.5"><span className="w-2 h-px bg-cyan-400" /><span className="text-slate-400">Calls</span></span>
        </div>
      </div>
      <div className="p-4">
        {data.length === 0 ? (
          <div className="h-48 flex items-center justify-center text-slate-600 text-xs">No data</div>
        ) : (
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={data} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
              <XAxis dataKey="time" tick={{ fill: '#64748b', fontSize: 10 }} axisLine={{ stroke: '#1e293b' }} tickLine={false} />
              <YAxis tick={{ fill: '#64748b', fontSize: 10 }} axisLine={{ stroke: '#1e293b' }} tickLine={false} />
              <Tooltip
                cursor={{ stroke: '#334155', strokeDasharray: '3 3' }}
                contentStyle={{ background: '#0f172a', border: '1px solid #1e293b', borderRadius: 6, fontSize: 11, padding: '6px 10px' }}
                labelStyle={{ color: '#cbd5e1', fontSize: 11 }}
              />
              <Line type="monotone" dataKey="duration" stroke="#818cf8" strokeWidth={1.5} dot={false} name="Duration (ms)" />
              <Line type="monotone" dataKey="calls" stroke="#22d3ee" strokeWidth={1.5} dot={false} name="Calls" />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}

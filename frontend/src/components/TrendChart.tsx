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
    <div className="bg-slate-900/50 border border-slate-800 rounded-xl p-4">
      <h3 className="text-sm font-medium text-slate-300 mb-4">Response Time Trend</h3>
      {data.length === 0 ? (
        <div className="h-48 flex items-center justify-center text-slate-600 text-sm">No data</div>
      ) : (
        <ResponsiveContainer width="100%" height={200}>
          <LineChart data={data}>
            <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
            <XAxis dataKey="time" tick={{ fill: '#64748b', fontSize: 10 }} />
            <YAxis tick={{ fill: '#64748b', fontSize: 10 }} />
            <Tooltip contentStyle={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 8, fontSize: 12 }} />
            <Line type="monotone" dataKey="duration" stroke="#a78bfa" strokeWidth={2} dot={false} name="Avg Duration (ms)" />
            <Line type="monotone" dataKey="calls" stroke="#38bdf8" strokeWidth={2} dot={false} name="Calls" />
          </LineChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}

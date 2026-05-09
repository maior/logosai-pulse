'use client';

import { useState, useEffect } from 'react';

const API = process.env.NEXT_PUBLIC_PULSE_API || 'http://localhost:8095';

export function FeedbackTab({ period }: { period: string }) {
  const [stats, setStats] = useState<any[]>([]);
  const [recent, setRecent] = useState<any[]>([]);

  useEffect(() => {
    Promise.all([
      fetch(`${API}/api/v1/feedback/stats?period=${period}`).then(r => r.json()),
      fetch(`${API}/api/v1/feedback?period=${period}&limit=20`).then(r => r.json()),
    ]).then(([s, r]) => { setStats(s); setRecent(r); });
  }, [period]);

  const totalPositive = stats.reduce((s, a) => s + a.positive, 0);
  const totalNegative = stats.reduce((s, a) => s + a.negative, 0);
  const total = totalPositive + totalNegative;
  const satisfaction = total > 0 ? Math.round((totalPositive / total) * 100) : null;

  return (
    <div className="space-y-5">
      {/* KPI */}
      <div className="grid grid-cols-3 gap-4">
        <KpiCard label="Positive" value={totalPositive.toLocaleString()} sub="thumbs up" accent="good" />
        <KpiCard label="Negative" value={totalNegative.toLocaleString()} sub="thumbs down" accent={totalNegative > 0 ? 'warn' : 'neutral'} />
        <KpiCard
          label="Satisfaction"
          value={satisfaction != null ? `${satisfaction}%` : '—'}
          sub={total > 0 ? `${total} ratings` : 'no ratings yet'}
          accent={satisfaction == null ? 'neutral' : satisfaction >= 80 ? 'good' : satisfaction >= 50 ? 'neutral' : 'warn'}
        />
      </div>

      {/* Agent satisfaction */}
      <div className="border border-slate-800 bg-slate-900/30 rounded-lg overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-800">
          <h3 className="text-[10px] uppercase tracking-wider text-slate-500 font-medium">Agent Satisfaction</h3>
        </div>
        <div className="p-4">
          {stats.length === 0 ? (
            <div className="text-xs text-slate-600 text-center py-8">No feedback yet</div>
          ) : (
            <div className="space-y-2">
              {stats.map(s => {
                const pct = Math.round(s.satisfaction * 100);
                const barCls = s.satisfaction >= 0.8
                  ? 'bg-emerald-400/70'
                  : s.satisfaction >= 0.5
                    ? 'bg-amber-400/70'
                    : 'bg-rose-400/70';
                return (
                  <div key={s.agent_id} className="flex items-center gap-3 text-xs">
                    <span className="text-slate-300 w-32 truncate font-medium">{s.agent_id.replace(/_agent$/, '')}</span>
                    <div className="flex-1 bg-slate-800/60 rounded h-1.5 overflow-hidden">
                      <div className={`h-full rounded ${barCls} transition-all`} style={{ width: `${pct}%` }} />
                    </div>
                    <span className="text-slate-400 tabular-nums w-10 text-right">{pct}%</span>
                    <span className="text-slate-500 tabular-nums w-20 text-right text-[11px]">
                      <span className="text-emerald-400">+{s.positive}</span> <span className="text-rose-400">−{s.negative}</span>
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Recent feedback */}
      <div className="border border-slate-800 bg-slate-900/30 rounded-lg overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between">
          <h3 className="text-[10px] uppercase tracking-wider text-slate-500 font-medium">Recent Feedback</h3>
          <span className="text-[10px] text-slate-600 tabular-nums">{recent.length}</span>
        </div>
        <div className="max-h-80 overflow-auto">
          {recent.length === 0 ? (
            <div className="text-xs text-slate-600 text-center py-12">No feedback yet</div>
          ) : recent.map(f => (
            <div key={f.id} className="flex items-start gap-3 text-xs px-4 py-2.5 border-t border-slate-800/40">
              <span className={`text-base leading-none mt-0.5 ${f.rating > 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                {f.rating > 0 ? '↑' : '↓'}
              </span>
              <div className="flex-1 min-w-0">
                <div className="flex items-baseline gap-2">
                  <span className="text-slate-200 font-medium">{f.agent_id.replace(/_agent$/, '')}</span>
                  <span className="text-slate-500 truncate">{f.query}</span>
                </div>
                {f.comment && <div className="text-slate-500 mt-0.5">{f.comment}</div>}
              </div>
              <span className="text-slate-600 tabular-nums shrink-0 font-mono text-[11px]">
                {f.created_at ? new Date(f.created_at).toLocaleTimeString('en-US', { hour12: false }) : ''}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function KpiCard({ label, value, sub, accent = 'neutral' }: { label: string; value: string; sub: string; accent?: 'good' | 'warn' | 'neutral' }) {
  const accentCls =
    accent === 'good' ? 'text-emerald-300' :
    accent === 'warn' ? 'text-amber-300' : 'text-slate-100';
  return (
    <div className="border border-slate-800 bg-slate-900/30 rounded-lg px-4 py-3.5 hover:border-slate-700 transition-colors">
      <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-1.5 font-medium">{label}</div>
      <div className={`text-2xl font-semibold tabular-nums tracking-tight ${accentCls}`}>{value}</div>
      <div className="text-[11px] text-slate-500 mt-1">{sub}</div>
    </div>
  );
}

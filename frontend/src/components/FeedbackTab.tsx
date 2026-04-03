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
  const satisfaction = total > 0 ? (totalPositive / total * 100).toFixed(0) : '—';

  return (
    <div className="space-y-6">
      {/* KPI */}
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-gradient-to-br from-green-500/20 to-green-600/10 border border-green-500/30 rounded-xl p-4">
          <div className="text-xs text-slate-400 mb-1">Positive</div>
          <div className="text-2xl font-bold text-green-300">👍 {totalPositive}</div>
        </div>
        <div className="bg-gradient-to-br from-red-500/20 to-red-600/10 border border-red-500/30 rounded-xl p-4">
          <div className="text-xs text-slate-400 mb-1">Negative</div>
          <div className="text-2xl font-bold text-red-300">👎 {totalNegative}</div>
        </div>
        <div className="bg-gradient-to-br from-purple-500/20 to-purple-600/10 border border-purple-500/30 rounded-xl p-4">
          <div className="text-xs text-slate-400 mb-1">Satisfaction</div>
          <div className="text-2xl font-bold text-purple-300">{satisfaction}%</div>
        </div>
      </div>

      {/* Agent satisfaction */}
      <div className="bg-slate-900/50 border border-slate-800 rounded-xl p-4">
        <h3 className="text-sm font-medium text-slate-300 mb-4">Agent Satisfaction</h3>
        {stats.length === 0 ? (
          <div className="text-sm text-slate-600 text-center py-8">No feedback yet</div>
        ) : (
          <div className="space-y-2">
            {stats.map(s => (
              <div key={s.agent_id} className="flex items-center gap-3">
                <span className="text-xs text-slate-400 w-32 truncate">{s.agent_id.replace(/_agent$/, '')}</span>
                <div className="flex-1 bg-slate-800 rounded-full h-3 overflow-hidden">
                  <div
                    className={`h-full rounded-full ${s.satisfaction >= 0.8 ? 'bg-green-500/60' : s.satisfaction >= 0.5 ? 'bg-amber-500/60' : 'bg-red-500/60'}`}
                    style={{ width: `${s.satisfaction * 100}%` }}
                  />
                </div>
                <span className="text-xs text-slate-500 w-16 text-right">
                  👍{s.positive} 👎{s.negative}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Recent feedback */}
      <div className="bg-slate-900/50 border border-slate-800 rounded-xl p-4">
        <h3 className="text-sm font-medium text-slate-300 mb-4">Recent Feedback</h3>
        <div className="space-y-2 max-h-64 overflow-auto">
          {recent.length === 0 ? (
            <div className="text-sm text-slate-600 text-center py-8">No feedback yet</div>
          ) : recent.map(f => (
            <div key={f.id} className="flex items-start gap-2 text-xs border-b border-slate-800/50 pb-2">
              <span className="text-base">{f.rating > 0 ? '👍' : '👎'}</span>
              <div className="flex-1">
                <span className="text-slate-400">{f.agent_id.replace(/_agent$/, '')}</span>
                <span className="text-slate-600 mx-1">·</span>
                <span className="text-slate-500">{f.query}</span>
                {f.comment && <div className="text-slate-600 mt-0.5">{f.comment}</div>}
              </div>
              <span className="text-slate-600">{f.created_at ? new Date(f.created_at).toLocaleTimeString() : ''}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

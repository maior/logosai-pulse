'use client';

import { useState, useEffect } from 'react';

const API = process.env.NEXT_PUBLIC_PULSE_API || 'http://localhost:8095';

export function LearningTab() {
  const [status, setStatus] = useState<any>(null);
  const [summary, setSummary] = useState<any>(null);
  const [healthReport, setHealthReport] = useState<any[]>([]);
  const [history, setHistory] = useState<any[]>([]);

  useEffect(() => {
    Promise.all([
      fetch(`${API}/api/v1/learning/status`).then(r => r.json()),
      fetch(`${API}/api/v1/learning/summary`).then(r => r.json()),
      fetch(`${API}/api/v1/learning/health-report?period=24h`).then(r => r.json()),
      fetch(`${API}/api/v1/learning/history`).then(r => r.json()),
    ]).then(([s, sum, hr, h]) => {
      setStatus(s);
      setSummary(sum);
      setHealthReport(hr);
      setHistory(h);
    });
  }, []);

  const healthColors: Record<string, string> = {
    healthy: 'bg-green-400',
    warning: 'bg-amber-400',
    degraded: 'bg-orange-400',
    critical: 'bg-red-400',
  };

  return (
    <div className="space-y-6">
      {/* Status */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-gradient-to-br from-emerald-500/20 to-emerald-600/10 border border-emerald-500/30 rounded-xl p-4">
          <div className="text-xs text-slate-400 mb-1">Loop Status</div>
          <div className="text-lg font-bold text-emerald-300">
            {status?.running ? '🟢 Running' : '🔴 Stopped'}
          </div>
          <div className="text-xs text-slate-500 mt-1">{status?.cycles_completed || 0} cycles</div>
        </div>
        <div className="bg-gradient-to-br from-blue-500/20 to-blue-600/10 border border-blue-500/30 rounded-xl p-4">
          <div className="text-xs text-slate-400 mb-1">Improvements</div>
          <div className="text-lg font-bold text-blue-300">{summary?.improvements_applied || 0}</div>
        </div>
        <div className="bg-gradient-to-br from-purple-500/20 to-purple-600/10 border border-purple-500/30 rounded-xl p-4">
          <div className="text-xs text-slate-400 mb-1">Monitored</div>
          <div className="text-lg font-bold text-purple-300">{summary?.agents_monitored || 0} agents</div>
        </div>
        <div className="bg-gradient-to-br from-amber-500/20 to-amber-600/10 border border-amber-500/30 rounded-xl p-4">
          <div className="text-xs text-slate-400 mb-1">Satisfaction</div>
          <div className="text-lg font-bold text-amber-300">
            {summary?.feedback?.satisfaction != null ? `${(summary.feedback.satisfaction * 100).toFixed(0)}%` : '—'}
          </div>
        </div>
      </div>

      {/* Agent Health */}
      <div className="bg-slate-900/50 border border-slate-800 rounded-xl p-4">
        <h3 className="text-sm font-medium text-slate-300 mb-4">Agent Health</h3>
        {/* Health distribution */}
        {summary?.agent_health && (
          <div className="flex gap-3 mb-4">
            {Object.entries(summary.agent_health).map(([k, v]) => (
              <div key={k} className="flex items-center gap-1.5 text-xs">
                <span className={`w-2 h-2 rounded-full ${healthColors[k] || 'bg-slate-400'}`} />
                <span className="text-slate-400">{k}: {v as number}</span>
              </div>
            ))}
          </div>
        )}

        {/* Per-agent health */}
        <div className="space-y-2">
          {healthReport.map(a => (
            <div key={a.agent_id} className="flex items-center gap-3 text-xs">
              <span className={`w-2 h-2 rounded-full ${healthColors[a.health] || 'bg-slate-400'}`} />
              <span className="text-slate-300 w-36 truncate">{a.agent_id.replace(/_agent$/, '')}</span>
              <div className="flex-1 bg-slate-800 rounded-full h-2 overflow-hidden">
                <div
                  className={`h-full rounded-full ${
                    a.current_success_rate >= 0.9 ? 'bg-green-500/60'
                    : a.current_success_rate >= 0.7 ? 'bg-amber-500/60'
                    : 'bg-red-500/60'
                  }`}
                  style={{ width: `${a.current_success_rate * 100}%` }}
                />
              </div>
              <span className="text-slate-500 w-12 text-right">{(a.current_success_rate * 100).toFixed(0)}%</span>
              <span className={`text-[10px] px-1.5 py-0.5 rounded ${
                a.trend === 'improving' ? 'bg-green-500/10 text-green-300'
                : a.trend === 'degrading' ? 'bg-red-500/10 text-red-300'
                : 'bg-slate-800 text-slate-500'
              }`}>
                {a.trend === 'improving' ? '↑' : a.trend === 'degrading' ? '↓' : '→'}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Improvement History */}
      <div className="bg-slate-900/50 border border-slate-800 rounded-xl p-4">
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-sm font-medium text-slate-300">Improvement History</h3>
          <button
            onClick={async () => {
              const res = await fetch(`${API}/api/v1/learning/trigger`, { method: 'POST' });
              const data = await res.json();
              alert(JSON.stringify(data.result, null, 2));
            }}
            className="text-xs bg-purple-500/20 text-purple-300 border border-purple-500/30 px-3 py-1 rounded-lg hover:bg-purple-500/30"
          >
            Trigger Cycle
          </button>
        </div>
        {history.length === 0 ? (
          <div className="text-sm text-slate-600 text-center py-8">No improvements yet</div>
        ) : (
          <div className="space-y-2">
            {history.map((h, i) => (
              <div key={i} className="flex items-center gap-2 text-xs border-b border-slate-800/50 pb-2">
                <span className="text-green-400">✅</span>
                <span className="text-slate-300">{h.agent_id}</span>
                <span className="text-slate-500 flex-1 truncate">{h.query}</span>
                <span className="text-slate-600">{h.created_at ? new Date(h.created_at).toLocaleDateString() : ''}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

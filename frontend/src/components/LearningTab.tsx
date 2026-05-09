'use client';

import { useState, useEffect } from 'react';

const API = process.env.NEXT_PUBLIC_PULSE_API || 'http://localhost:8095';

const HEALTH_COLOR: Record<string, string> = {
  healthy: 'bg-emerald-400',
  warning: 'bg-amber-400',
  degraded: 'bg-orange-400',
  critical: 'bg-rose-400',
};

export function LearningTab() {
  const [status, setStatus] = useState<any>(null);
  const [summary, setSummary] = useState<any>(null);
  const [healthReport, setHealthReport] = useState<any[]>([]);
  const [history, setHistory] = useState<any[]>([]);
  const [triggering, setTriggering] = useState(false);

  const refresh = () => {
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
  };

  useEffect(() => { refresh(); }, []);

  const handleTrigger = async () => {
    setTriggering(true);
    try {
      const res = await fetch(`${API}/api/v1/learning/trigger`, { method: 'POST' });
      await res.json();
      refresh();
    } finally {
      setTriggering(false);
    }
  };

  const satisfactionPct = summary?.feedback?.satisfaction != null
    ? Math.round(summary.feedback.satisfaction * 100)
    : null;

  return (
    <div className="space-y-5">
      {/* Status KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard
          label="Loop Status"
          value={status?.running ? 'Running' : 'Stopped'}
          sub={`${status?.cycles_completed || 0} cycles`}
          accent={status?.running ? 'good' : 'warn'}
        />
        <KpiCard label="Improvements" value={String(summary?.improvements_applied || 0)} sub="applied" />
        <KpiCard label="Monitored" value={String(summary?.agents_monitored || 0)} sub="agents" />
        <KpiCard
          label="Satisfaction"
          value={satisfactionPct != null ? `${satisfactionPct}%` : '—'}
          sub="user rating"
          accent={satisfactionPct == null ? 'neutral' : satisfactionPct >= 80 ? 'good' : 'warn'}
        />
      </div>

      {/* Agent Health */}
      <div className="border border-slate-800 bg-slate-900/30 rounded-lg overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between">
          <h3 className="text-[10px] uppercase tracking-wider text-slate-500 font-medium">Agent Health</h3>
          {summary?.agent_health && (
            <div className="flex gap-3 text-[10px]">
              {Object.entries(summary.agent_health).map(([k, v]) => (
                <span key={k} className="flex items-center gap-1.5 text-slate-400">
                  <span className={`w-1.5 h-1.5 rounded-full ${HEALTH_COLOR[k] || 'bg-slate-500'}`} />
                  {k} <span className="text-slate-200 tabular-nums">{v as number}</span>
                </span>
              ))}
            </div>
          )}
        </div>
        <div className="p-4">
          {healthReport.length === 0 ? (
            <div className="text-xs text-slate-600 text-center py-8">No agent health data</div>
          ) : (
            <div className="space-y-2">
              {healthReport.map(a => {
                const pct = Math.round(a.current_success_rate * 100);
                const barCls = a.current_success_rate >= 0.9
                  ? 'bg-emerald-400/70'
                  : a.current_success_rate >= 0.7
                    ? 'bg-amber-400/70'
                    : 'bg-rose-400/70';
                const trendCls = a.trend === 'improving'
                  ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30'
                  : a.trend === 'degrading'
                    ? 'bg-rose-500/10 text-rose-300 border-rose-500/30'
                    : 'bg-slate-800/50 text-slate-500 border-slate-700';
                return (
                  <div key={a.agent_id} className="flex items-center gap-3 text-xs">
                    <span className={`w-1.5 h-1.5 rounded-full ${HEALTH_COLOR[a.health] || 'bg-slate-500'}`} />
                    <span className="text-slate-300 w-36 truncate font-medium">{a.agent_id.replace(/_agent$/, '')}</span>
                    <div className="flex-1 bg-slate-800/60 rounded h-1.5 overflow-hidden">
                      <div className={`h-full rounded ${barCls} transition-all`} style={{ width: `${pct}%` }} />
                    </div>
                    <span className="text-slate-400 tabular-nums w-12 text-right">{pct}%</span>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded border ${trendCls}`}>
                      {a.trend === 'improving' ? '↑ improving' : a.trend === 'degrading' ? '↓ degrading' : '→ stable'}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Improvement History */}
      <div className="border border-slate-800 bg-slate-900/30 rounded-lg overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between">
          <h3 className="text-[10px] uppercase tracking-wider text-slate-500 font-medium">Improvement History</h3>
          <button
            onClick={handleTrigger}
            disabled={triggering}
            className="text-[10px] uppercase tracking-wider font-medium bg-indigo-500/10 text-indigo-300 border border-indigo-500/30 px-2.5 py-1 rounded hover:bg-indigo-500/20 disabled:opacity-50 transition-colors"
          >
            {triggering ? 'Running…' : 'Trigger Cycle'}
          </button>
        </div>
        <div className="max-h-80 overflow-auto">
          {history.length === 0 ? (
            <div className="text-xs text-slate-600 text-center py-12">No improvements yet</div>
          ) : history.map((h, i) => (
            <div key={i} className="flex items-center gap-3 text-xs px-4 py-2.5 border-t border-slate-800/40">
              <span className="text-emerald-400">✓</span>
              <span className="text-slate-200 font-medium font-mono text-[11px]">{h.agent_id}</span>
              <span className="text-slate-500 flex-1 truncate">{h.query}</span>
              <span className="text-slate-600 tabular-nums shrink-0 font-mono text-[11px]">
                {h.created_at ? new Date(h.created_at).toLocaleString('en-US', { hour12: false }) : ''}
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

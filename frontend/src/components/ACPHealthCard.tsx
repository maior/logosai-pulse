'use client';

import { useEffect, useState } from 'react';

const LOGOS_API = process.env.NEXT_PUBLIC_LOGOS_API || 'http://localhost:8090';

type BreakerStatus = {
  server_id: string;
  state: 'closed' | 'open' | 'half-open';
  consecutive_failures: number;
  total_successes: number;
  total_failures: number;
  opened_at: number | null;
  cooldown_seconds: number;
  failure_threshold: number;
};

type HealthData = {
  summary: { total: number; closed: number; open: number; half_open: number };
  breakers: BreakerStatus[];
};

const STATE_TONE: Record<BreakerStatus['state'], { label: string; cls: string; dot: string }> = {
  closed:      { label: 'Healthy',  cls: 'text-emerald-300 bg-emerald-500/10 border-emerald-500/30', dot: 'bg-emerald-400' },
  'half-open': { label: 'Probing',  cls: 'text-amber-300 bg-amber-500/10 border-amber-500/30',       dot: 'bg-amber-400 animate-pulse' },
  open:        { label: 'Tripped',  cls: 'text-rose-300 bg-rose-500/10 border-rose-500/30',          dot: 'bg-rose-400' },
};

function fmtSecsAgo(opened_at: number | null): string {
  if (!opened_at) return '—';
  const elapsed = Date.now() / 1000 - opened_at;
  if (elapsed < 60) return `${elapsed.toFixed(0)}s ago`;
  if (elapsed < 3600) return `${(elapsed / 60).toFixed(1)}m ago`;
  return `${(elapsed / 3600).toFixed(1)}h ago`;
}

export function ACPHealthCard() {
  const [data, setData] = useState<HealthData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchHealth = async () => {
      try {
        const r = await fetch(`${LOGOS_API}/api/v1/acp/health`, { cache: 'no-store' });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const d = await r.json();
        setData(d);
        setError(null);
      } catch (e: any) {
        setError(e?.message || 'fetch failed');
      }
    };
    fetchHealth();
    const t = setInterval(fetchHealth, 5000);
    return () => clearInterval(t);
  }, []);

  return (
    <div className="border border-slate-800 bg-slate-900/30 rounded-lg overflow-hidden">
      <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h3 className="text-[10px] uppercase tracking-wider text-slate-500 font-medium">ACP Servers</h3>
          {data && (
            <div className="flex items-center gap-2 text-[10px] text-slate-500">
              <span>{data.summary.total} total</span>
              {data.summary.closed > 0 && (
                <span className="flex items-center gap-1 text-emerald-400">
                  <span className="w-1 h-1 rounded-full bg-emerald-400" /> {data.summary.closed}
                </span>
              )}
              {data.summary.half_open > 0 && (
                <span className="flex items-center gap-1 text-amber-400">
                  <span className="w-1 h-1 rounded-full bg-amber-400" /> {data.summary.half_open}
                </span>
              )}
              {data.summary.open > 0 && (
                <span className="flex items-center gap-1 text-rose-400">
                  <span className="w-1 h-1 rounded-full bg-rose-400" /> {data.summary.open}
                </span>
              )}
            </div>
          )}
        </div>
        <span className="text-[9px] text-slate-600 font-mono">5s poll</span>
      </div>
      <div className="p-4">
        {error && (
          <div className="text-[11px] text-rose-300 bg-rose-500/5 border border-rose-500/20 rounded px-2 py-1.5 font-mono">
            logos_api unreachable: {error}
          </div>
        )}
        {!error && (!data || data.breakers.length === 0) && (
          <div className="text-[11px] text-slate-600 text-center py-6">
            No ACP traffic yet — circuit breakers idle.<br />
            <span className="text-[10px] text-slate-700">First call to a fallback path will register a breaker.</span>
          </div>
        )}
        {data && data.breakers.length > 0 && (
          <div className="space-y-2">
            {data.breakers.map((b) => {
              const tone = STATE_TONE[b.state] || STATE_TONE.open;
              const total = b.total_successes + b.total_failures;
              const successRate = total > 0 ? (b.total_successes / total) * 100 : 0;
              return (
                <div key={b.server_id} className="border border-slate-800/60 rounded p-3 hover:border-slate-700 transition-colors">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className={`w-1.5 h-1.5 rounded-full ${tone.dot}`} />
                      <span className="text-slate-200 font-medium truncate">{b.server_id}</span>
                      <span className={`px-1.5 py-0.5 text-[10px] font-mono rounded border ${tone.cls}`}>
                        {tone.label}
                      </span>
                    </div>
                    <div className="text-[10px] text-slate-500 tabular-nums shrink-0">
                      {b.state === 'open' && fmtSecsAgo(b.opened_at)}
                    </div>
                  </div>
                  <div className="grid grid-cols-4 gap-2 text-[10px]">
                    <div>
                      <div className="text-slate-600 uppercase tracking-wider">Successes</div>
                      <div className="text-emerald-400 tabular-nums font-mono">{b.total_successes}</div>
                    </div>
                    <div>
                      <div className="text-slate-600 uppercase tracking-wider">Failures</div>
                      <div className="text-rose-400 tabular-nums font-mono">{b.total_failures}</div>
                    </div>
                    <div>
                      <div className="text-slate-600 uppercase tracking-wider">Streak</div>
                      <div className={`tabular-nums font-mono ${b.consecutive_failures > 0 ? 'text-amber-400' : 'text-slate-300'}`}>
                        {b.consecutive_failures > 0 ? `−${b.consecutive_failures}` : '—'}
                      </div>
                    </div>
                    <div>
                      <div className="text-slate-600 uppercase tracking-wider">Rate</div>
                      <div className={`tabular-nums font-mono ${successRate >= 99 ? 'text-emerald-300' : successRate >= 90 ? 'text-slate-300' : 'text-amber-400'}`}>
                        {total > 0 ? `${successRate.toFixed(1)}%` : '—'}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

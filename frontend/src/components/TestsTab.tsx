'use client';

import { useEffect, useState, useCallback } from 'react';

const API = process.env.NEXT_PUBLIC_PULSE_API || 'http://localhost:8095';

type TestRun = {
  id: string;
  created_at: string;
  suite: string;
  scenario: string;
  query: string;
  expected_pattern: string;
  actual_pattern: string | null;
  actual_agents: string[];
  passed: boolean;
  latency_ms: number | null;
  trace_id: string | null;
  issues: string[];
  notes: string | null;
};

type Summary = {
  suite: string | null;
  total: number;
  passed: number;
  failed: number;
  pass_rate: number;
  by_scenario: Record<string, { total: number; passed: number; failed: number; pass_rate: number }>;
};

const PATTERN_TONE: Record<string, string> = {
  single:        'text-slate-300 bg-slate-800/60 border-slate-700',
  sequential:    'text-cyan-300 bg-cyan-500/10 border-cyan-500/30',
  parallel:      'text-emerald-300 bg-emerald-500/10 border-emerald-500/30',
  hybrid:        'text-indigo-300 bg-indigo-500/10 border-indigo-500/30',
  forge_generation: 'text-amber-300 bg-amber-500/10 border-amber-500/30',
};

function fmtDuration(ms: number | null): string {
  if (ms == null) return '—';
  if (ms < 1000) return `${ms.toFixed(0)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

function fmtTime(iso: string): string {
  const d = new Date(iso);
  const today = new Date().toDateString() === d.toDateString();
  if (today) return d.toLocaleTimeString('en-US', { hour12: false });
  return `${d.toLocaleDateString()} ${d.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit' })}`;
}

export function TestsTab() {
  const [runs, setRuns] = useState<TestRun[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [selectedSuite, setSelectedSuite] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchAll = useCallback(async () => {
    try {
      const params = selectedSuite ? `?suite=${encodeURIComponent(selectedSuite)}&limit=200` : '?limit=200';
      const [r, s] = await Promise.all([
        fetch(`${API}/api/v1/test_runs${params}`).then(r => r.json()),
        fetch(`${API}/api/v1/test_runs/summary${selectedSuite ? `?suite=${encodeURIComponent(selectedSuite)}` : ''}`).then(r => r.json()),
      ]);
      setRuns(Array.isArray(r) ? r : []);
      setSummary(s);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [selectedSuite]);

  useEffect(() => { fetchAll(); }, [fetchAll]);
  // poll every 5s while tab open
  useEffect(() => {
    const t = setInterval(fetchAll, 5000);
    return () => clearInterval(t);
  }, [fetchAll]);

  if (loading) return <div className="py-12 text-center text-slate-500 text-sm">Loading test runs…</div>;

  if (runs.length === 0) {
    return (
      <div className="space-y-5">
        <SummaryCards summary={null} />
        <div className="border border-slate-800 rounded-lg bg-slate-900/30 px-6 py-12 text-center">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-emerald-500/10 border border-emerald-500/30 mb-4">
            <span className="text-emerald-300 text-xl">✓</span>
          </div>
          <div className="text-slate-100 font-semibold mb-1.5">No test runs yet</div>
          <div className="text-slate-400 text-sm max-w-lg mx-auto leading-relaxed">
            Run the E2E harness to record scenario outcomes here:
          </div>
          <div className="mt-4 inline-block bg-slate-950/60 border border-slate-800 rounded px-4 py-2 font-mono text-[11px] text-slate-300">
            python3 acp_server/test_e2e_workflow.py
          </div>
          <div className="mt-3 text-[11px] text-slate-600">
            Pass / fail, workflow pattern, latency, and trace links will appear here.
          </div>
        </div>
      </div>
    );
  }

  // unique suites for filter
  const allSuites = Array.from(new Set(runs.map(r => r.suite))).sort();

  return (
    <div className="space-y-5">
      <SummaryCards summary={summary} />

      {/* Suite filter */}
      {allSuites.length > 1 && (
        <div className="flex items-center gap-2 text-[11px]">
          <span className="text-slate-500 uppercase tracking-wider">Suite:</span>
          <button
            onClick={() => setSelectedSuite(null)}
            className={`px-2 py-1 rounded font-mono ${selectedSuite == null ? 'bg-indigo-500/15 border border-indigo-500/30 text-indigo-300' : 'bg-slate-800/40 border border-slate-700 text-slate-400 hover:text-slate-200'}`}
          >
            all
          </button>
          {allSuites.map(s => (
            <button
              key={s}
              onClick={() => setSelectedSuite(s)}
              className={`px-2 py-1 rounded font-mono ${selectedSuite === s ? 'bg-indigo-500/15 border border-indigo-500/30 text-indigo-300' : 'bg-slate-800/40 border border-slate-700 text-slate-400 hover:text-slate-200'}`}
            >
              {s}
            </button>
          ))}
        </div>
      )}

      {/* Per-scenario breakdown */}
      {summary && Object.keys(summary.by_scenario).length > 0 && (
        <ScenarioBreakdown summary={summary} />
      )}

      {/* Recent runs */}
      <div className="border border-slate-800 bg-slate-900/30 rounded-lg overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between">
          <h3 className="text-[10px] uppercase tracking-wider text-slate-500 font-medium">Recent Runs</h3>
          <span className="text-[10px] text-slate-600 tabular-nums">{runs.length}</span>
        </div>
        <div className="max-h-[600px] overflow-auto">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-slate-950/95 backdrop-blur">
              <tr className="text-slate-500">
                <th className="text-left px-4 py-2 font-medium text-[10px] uppercase tracking-wider">Time</th>
                <th className="text-left px-2 py-2 font-medium text-[10px] uppercase tracking-wider">Scenario</th>
                <th className="text-left px-2 py-2 font-medium text-[10px] uppercase tracking-wider">Query</th>
                <th className="text-left px-2 py-2 font-medium text-[10px] uppercase tracking-wider">Pattern</th>
                <th className="text-right px-2 py-2 font-medium text-[10px] uppercase tracking-wider">Latency</th>
                <th className="text-center px-2 py-2 font-medium text-[10px] uppercase tracking-wider">Result</th>
                <th className="text-right px-4 py-2 font-medium text-[10px] uppercase tracking-wider">Trace</th>
              </tr>
            </thead>
            <tbody>
              {runs.map(r => (
                <RunRow key={r.id} run={r} />
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function SummaryCards({ summary }: { summary: Summary | null }) {
  const total = summary?.total ?? 0;
  const passed = summary?.passed ?? 0;
  const failed = summary?.failed ?? 0;
  const passRate = summary?.pass_rate ?? 0;
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
      <KpiCard label="Total Runs" value={total.toLocaleString()} sub={summary?.suite ? `suite: ${summary.suite}` : 'all suites'} />
      <KpiCard label="Passed" value={passed.toLocaleString()} sub="green" accent={passed > 0 ? 'good' : 'neutral'} />
      <KpiCard label="Failed" value={failed.toLocaleString()} sub={failed > 0 ? 'needs attention' : 'clean'} accent={failed > 0 ? 'warn' : 'neutral'} />
      <KpiCard
        label="Pass Rate"
        value={total > 0 ? `${(passRate * 100).toFixed(1)}%` : '—'}
        sub={total > 0 ? (passRate >= 0.95 ? 'excellent' : passRate >= 0.8 ? 'healthy' : 'degraded') : 'no data'}
        accent={passRate >= 0.95 ? 'good' : passRate >= 0.8 ? 'neutral' : 'warn'}
      />
    </div>
  );
}

function KpiCard({ label, value, sub, accent = 'neutral' }: { label: string; value: string; sub: string; accent?: 'good' | 'warn' | 'neutral' }) {
  const cls = accent === 'good' ? 'text-emerald-300' : accent === 'warn' ? 'text-amber-300' : 'text-slate-100';
  return (
    <div className="border border-slate-800 bg-slate-900/30 rounded-lg px-4 py-3.5 hover:border-slate-700 transition-colors">
      <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-1.5 font-medium">{label}</div>
      <div className={`text-2xl font-semibold tabular-nums tracking-tight ${cls}`}>{value}</div>
      <div className="text-[11px] text-slate-500 mt-1">{sub}</div>
    </div>
  );
}

function ScenarioBreakdown({ summary }: { summary: Summary }) {
  const entries = Object.entries(summary.by_scenario).sort((a, b) => b[1].total - a[1].total);
  return (
    <div className="border border-slate-800 bg-slate-900/30 rounded-lg overflow-hidden">
      <div className="px-4 py-3 border-b border-slate-800">
        <h3 className="text-[10px] uppercase tracking-wider text-slate-500 font-medium">Scenarios</h3>
      </div>
      <div className="p-4 space-y-2">
        {entries.map(([sc, d]) => {
          const pct = Math.round(d.pass_rate * 100);
          const barCls = d.pass_rate >= 0.95 ? 'bg-emerald-400/70'
            : d.pass_rate >= 0.7 ? 'bg-amber-400/70'
            : 'bg-rose-400/70';
          return (
            <div key={sc} className="flex items-center gap-3 text-xs">
              <span className="text-slate-200 w-32 truncate font-medium">{sc}</span>
              <div className="flex-1 bg-slate-800/60 rounded h-1.5 overflow-hidden">
                <div className={`h-full rounded ${barCls} transition-all`} style={{ width: `${pct}%` }} />
              </div>
              <span className="text-slate-400 tabular-nums w-12 text-right">{pct}%</span>
              <span className="text-slate-500 tabular-nums w-20 text-right text-[11px]">
                <span className="text-emerald-400">+{d.passed}</span> <span className="text-rose-400">−{d.failed}</span>
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function RunRow({ run }: { run: TestRun }) {
  const [expanded, setExpanded] = useState(false);
  const patternCls = run.actual_pattern ? (PATTERN_TONE[run.actual_pattern] || 'text-slate-300 border-slate-700 bg-slate-800/40') : 'text-slate-500 border-slate-800 bg-slate-900/30';

  return (
    <>
      <tr
        onClick={() => setExpanded(e => !e)}
        className={`border-t border-slate-800/40 cursor-pointer transition-colors ${expanded ? 'bg-indigo-500/[0.06]' : 'hover:bg-slate-800/30'}`}
      >
        <td className="px-4 py-2 text-slate-500 font-mono tabular-nums text-[11px] whitespace-nowrap">{fmtTime(run.created_at)}</td>
        <td className="px-2 py-2 text-slate-200 font-medium">{run.scenario}</td>
        <td className="px-2 py-2 text-slate-400 max-w-[280px] truncate">{run.query}</td>
        <td className="px-2 py-2">
          <span className={`inline-block px-1.5 py-0.5 text-[10px] font-mono rounded border ${patternCls}`}>
            {run.actual_pattern || '—'}
          </span>
          {run.actual_pattern && run.actual_pattern !== run.expected_pattern && (
            <span className="ml-1 text-[9px] text-amber-400 font-mono">≠ {run.expected_pattern}</span>
          )}
        </td>
        <td className="px-2 py-2 text-right text-slate-400 tabular-nums">{fmtDuration(run.latency_ms)}</td>
        <td className="px-2 py-2 text-center">
          {run.passed ? (
            <span className="inline-flex items-center px-2 py-0.5 text-[10px] font-medium rounded border border-emerald-500/30 bg-emerald-500/10 text-emerald-300">PASS</span>
          ) : (
            <span className="inline-flex items-center px-2 py-0.5 text-[10px] font-medium rounded border border-rose-500/30 bg-rose-500/10 text-rose-300">FAIL</span>
          )}
        </td>
        <td className="px-4 py-2 text-right">
          {run.trace_id ? (
            <span className="text-indigo-400 hover:text-indigo-300 font-mono text-[10px]">{run.trace_id.slice(0, 8)}</span>
          ) : <span className="text-slate-700">—</span>}
        </td>
      </tr>
      {expanded && (
        <tr className="border-t border-slate-800/40 bg-slate-950/50">
          <td colSpan={7} className="px-4 py-3">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-[11px]">
              <div>
                <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-1">Query (full)</div>
                <div className="text-slate-200 font-mono leading-relaxed">{run.query}</div>
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-1">Agents Called</div>
                <div className="flex flex-wrap gap-1">
                  {run.actual_agents.length === 0 ? (
                    <span className="text-slate-600 italic">none</span>
                  ) : run.actual_agents.map((a, i) => (
                    <span key={`${a}-${i}`} className="px-1.5 py-0.5 font-mono rounded bg-slate-800/60 border border-slate-700 text-slate-300">{a}</span>
                  ))}
                </div>
              </div>
              {run.issues.length > 0 && (
                <div className="md:col-span-2">
                  <div className="text-[10px] uppercase tracking-wider text-rose-400 mb-1">Issues</div>
                  <div className="space-y-1">
                    {run.issues.map((iss, i) => (
                      <div key={i} className="text-rose-300 bg-rose-500/5 border border-rose-500/20 rounded px-2 py-1.5 font-mono leading-relaxed">{iss}</div>
                    ))}
                  </div>
                </div>
              )}
              {run.notes && (
                <div className="md:col-span-2">
                  <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-1">Notes</div>
                  <div className="text-slate-300 leading-relaxed">{run.notes}</div>
                </div>
              )}
              {run.trace_id && (
                <div className="md:col-span-2 text-[10px] text-slate-500">
                  trace_id: <span className="font-mono text-slate-300">{run.trace_id}</span>
                  <span className="ml-2 text-slate-600">(switch to Traces tab to drill down)</span>
                </div>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

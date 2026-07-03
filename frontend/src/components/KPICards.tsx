'use client';

interface Props {
  summary: {
    total_calls?: number;
    success_rate?: number;
    avg_duration_ms?: number;
    total_cost_usd?: number;
    active_agents?: number;
  };
}

export function KPICards({ summary }: Props) {
  const successPct = (summary.success_rate ?? 1) * 100;
  const cards = [
    {
      label: 'Total Calls',
      value: (summary.total_calls ?? 0).toLocaleString(),
      sub: `${summary.active_agents ?? 0} active agents`,
    },
    {
      label: 'Success Rate',
      value: `${successPct.toFixed(1)}%`,
      sub: successPct >= 99 ? 'Excellent' : successPct >= 95 ? 'Healthy' : 'Degraded',
      accent: successPct >= 99 ? 'good' : successPct >= 95 ? 'neutral' : 'warn',
    },
    {
      label: 'Avg Response',
      value: fmtDuration(summary.avg_duration_ms ?? 0),
      sub: 'mean latency',  // 실제 집계는 평균 — p50으로 오표기하지 않는다
    },
    {
      label: 'Total Cost',
      value: `$${(summary.total_cost_usd ?? 0).toFixed(4)}`,
      sub: 'period total',
    },
  ];

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
      {cards.map(card => {
        const accentCls =
          card.accent === 'good' ? 'text-emerald-300' :
          card.accent === 'warn' ? 'text-amber-300' : 'text-slate-100';
        return (
          <div key={card.label} className="border border-slate-800 bg-slate-900/30 rounded-lg px-4 py-3.5 hover:border-slate-700 transition-colors">
            <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-1.5 font-medium">{card.label}</div>
            <div className={`text-2xl font-semibold tabular-nums tracking-tight ${accentCls}`}>{card.value}</div>
            <div className="text-[11px] text-slate-500 mt-1">{card.sub}</div>
          </div>
        );
      })}
    </div>
  );
}

function fmtDuration(ms: number): string {
  if (ms >= 1000) return `${(ms / 1000).toFixed(2)}s`;
  return `${ms.toFixed(0)}ms`;
}

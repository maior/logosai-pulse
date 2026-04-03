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
  const cards = [
    { label: 'Total Calls', value: summary.total_calls ?? 0, format: 'number', icon: '📊', color: 'from-blue-500/20 to-blue-600/10 border-blue-500/30' },
    { label: 'Success Rate', value: summary.success_rate ?? 1, format: 'percent', icon: '✅', color: 'from-green-500/20 to-green-600/10 border-green-500/30' },
    { label: 'Avg Response', value: summary.avg_duration_ms ?? 0, format: 'duration', icon: '⚡', color: 'from-amber-500/20 to-amber-600/10 border-amber-500/30' },
    { label: 'Total Cost', value: summary.total_cost_usd ?? 0, format: 'cost', icon: '💰', color: 'from-purple-500/20 to-purple-600/10 border-purple-500/30' },
  ];

  const formatValue = (value: number, format: string) => {
    switch (format) {
      case 'percent': return `${(value * 100).toFixed(1)}%`;
      case 'duration': return value >= 1000 ? `${(value / 1000).toFixed(1)}s` : `${value.toFixed(0)}ms`;
      case 'cost': return `$${value.toFixed(4)}`;
      default: return value.toLocaleString();
    }
  };

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
      {cards.map(card => (
        <div key={card.label} className={`bg-gradient-to-br ${card.color} border rounded-xl p-4`}>
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs text-slate-400">{card.label}</span>
            <span className="text-lg">{card.icon}</span>
          </div>
          <div className="text-2xl font-bold text-slate-100">
            {formatValue(card.value, card.format)}
          </div>
          {card.label === 'Total Calls' && (
            <div className="text-xs text-slate-500 mt-1">{summary.active_agents ?? 0} agents</div>
          )}
        </div>
      ))}
    </div>
  );
}

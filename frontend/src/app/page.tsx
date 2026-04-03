'use client';

import { useState, useEffect, useCallback } from 'react';
import { KPICards } from '@/components/KPICards';
import { AgentChart } from '@/components/AgentChart';
import { TrendChart } from '@/components/TrendChart';
import { CostChart } from '@/components/CostChart';
import { TraceTable } from '@/components/TraceTable';
import { TraceDetail } from '@/components/TraceDetail';

const API = process.env.NEXT_PUBLIC_PULSE_API || 'http://localhost:8095';

export default function Dashboard() {
  const [period, setPeriod] = useState('24h');
  const [data, setData] = useState<any>(null);
  const [traces, setTraces] = useState<any[]>([]);
  const [selectedTrace, setSelectedTrace] = useState<string | null>(null);
  const [traceDetail, setTraceDetail] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    try {
      const [dash, tr] = await Promise.all([
        fetch(`${API}/api/v1/dashboard?period=${period}`).then(r => r.json()),
        fetch(`${API}/api/v1/traces?period=${period}&limit=50`).then(r => r.json()),
      ]);
      setData(dash);
      setTraces(tr);
    } catch (e) {
      console.error('Failed to fetch:', e);
    } finally {
      setLoading(false);
    }
  }, [period]);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 30000);
    return () => clearInterval(interval);
  }, [fetchData]);

  useEffect(() => {
    if (!selectedTrace) { setTraceDetail(null); return; }
    fetch(`${API}/api/v1/traces/${selectedTrace}`)
      .then(r => r.json())
      .then(setTraceDetail)
      .catch(() => setTraceDetail(null));
  }, [selectedTrace]);

  if (loading) return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center">
      <div className="text-slate-400 text-lg">Loading LogosPulse...</div>
    </div>
  );

  const summary = data?.summary || {};
  const agents = data?.agents || [];
  const costs = data?.costs || {};
  const trend = data?.trend || [];

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <header className="border-b border-slate-800 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-2xl">💓</span>
          <h1 className="text-xl font-semibold bg-gradient-to-r from-rose-400 to-purple-400 bg-clip-text text-transparent">
            LogosPulse
          </h1>
          <span className="text-xs text-slate-500 ml-2">Agent Observability</span>
        </div>
        <div className="flex items-center gap-2">
          {['1h', '6h', '24h', '7d', '30d'].map(p => (
            <button
              key={p}
              onClick={() => { setPeriod(p); setLoading(true); }}
              className={`px-3 py-1 text-xs rounded-lg transition-colors ${
                period === p
                  ? 'bg-purple-500/20 text-purple-300 border border-purple-500/30'
                  : 'text-slate-500 hover:text-slate-300'
              }`}
            >
              {p}
            </button>
          ))}
        </div>
      </header>

      <main className="p-6 max-w-7xl mx-auto space-y-6">
        <KPICards summary={summary} />
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2"><AgentChart agents={agents} /></div>
          <CostChart costs={costs} />
        </div>
        <TrendChart trend={trend} />
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <TraceTable traces={traces} selectedId={selectedTrace} onSelect={setSelectedTrace} />
          <TraceDetail detail={traceDetail} />
        </div>
      </main>
    </div>
  );
}

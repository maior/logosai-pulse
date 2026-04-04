'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { KPICards } from '@/components/KPICards';
import { AgentChart } from '@/components/AgentChart';
import { TrendChart } from '@/components/TrendChart';
import { CostChart } from '@/components/CostChart';
import { TraceTable } from '@/components/TraceTable';
import { WaterfallView } from '@/components/WaterfallView';
import { SpanTreeView } from '@/components/SpanTreeView';
import { FeedbackTab } from '@/components/FeedbackTab';
import { LearningTab } from '@/components/LearningTab';

const API = process.env.NEXT_PUBLIC_PULSE_API || 'http://localhost:8095';

type Tab = 'dashboard' | 'traces' | 'feedback' | 'learning';

export default function Dashboard() {
  const [tab, setTab] = useState<Tab>('dashboard');
  const [period, setPeriod] = useState('24h');
  const [data, setData] = useState<any>(null);
  const [traces, setTraces] = useState<any[]>([]);
  const [selectedTrace, setSelectedTrace] = useState<string | null>(null);
  const [selectedTraceId, setSelectedTraceId] = useState<string | null>(null);
  const [traceDetail, setTraceDetail] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [liveCount, setLiveCount] = useState(0);
  const eventSourceRef = useRef<EventSource | null>(null);

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

  // SSE 실시간 연결
  useEffect(() => {
    const es = new EventSource(`${API}/api/v1/stream`);
    eventSourceRef.current = es;

    es.addEventListener('new_execution', (e) => {
      const data = JSON.parse(e.data);
      setTraces(prev => [{
        id: data.execution_id,
        agent_id: data.agent_id,
        agent_name: data.agent_name || data.agent_id,
        query: data.query,
        success: data.success,
        duration_ms: data.duration_ms,
        token_count: 0,
        cost_usd: 0,
        created_at: new Date().toISOString(),
        trace_id: data.metadata?.trace_id || '',
      }, ...prev].slice(0, 50));
      setLiveCount(c => c + 1);
      // Refresh dashboard data
      fetchData();
    });

    es.addEventListener('new_llm_call', () => {
      // Just trigger a refresh for cost/token updates
      fetchData();
    });

    es.onerror = () => {
      // Reconnect after 5s
      setTimeout(() => {
        if (eventSourceRef.current) eventSourceRef.current.close();
        // Will reconnect on next render
      }, 5000);
    };

    return () => es.close();
  }, [fetchData]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleTraceSelect = useCallback((id: string | null) => {
    setSelectedTrace(id);
    if (id) {
      const trace = traces.find((t: any) => t.id === id);
      setSelectedTraceId(trace?.trace_id || null);
    } else {
      setSelectedTraceId(null);
    }
  }, [traces]);

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

  const tabs: { id: Tab; label: string; icon: string }[] = [
    { id: 'dashboard', label: 'Dashboard', icon: '📊' },
    { id: 'traces', label: 'Traces', icon: '🔍' },
    { id: 'feedback', label: 'Feedback', icon: '👍' },
    { id: 'learning', label: 'Learning', icon: '🧠' },
  ];

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      {/* Header */}
      <header className="border-b border-slate-800 px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-2xl">💓</span>
          <h1 className="text-xl font-semibold bg-gradient-to-r from-rose-400 to-purple-400 bg-clip-text text-transparent">
            LogosPulse
          </h1>
          {liveCount > 0 && (
            <span className="flex items-center gap-1 text-xs text-green-400">
              <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
              Live
            </span>
          )}
        </div>
        <div className="flex items-center gap-4">
          {/* Tabs */}
          <div className="flex gap-1 bg-slate-900/50 rounded-lg p-0.5">
            {tabs.map(t => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`px-3 py-1.5 text-xs rounded-md transition-colors ${
                  tab === t.id
                    ? 'bg-slate-800 text-slate-100'
                    : 'text-slate-500 hover:text-slate-300'
                }`}
              >
                {t.icon} {t.label}
              </button>
            ))}
          </div>
          {/* Period */}
          <div className="flex gap-1">
            {['1h', '6h', '24h', '7d', '30d'].map(p => (
              <button
                key={p}
                onClick={() => { setPeriod(p); setLoading(true); }}
                className={`px-2 py-1 text-[10px] rounded transition-colors ${
                  period === p
                    ? 'bg-purple-500/20 text-purple-300 border border-purple-500/30'
                    : 'text-slate-600 hover:text-slate-400'
                }`}
              >
                {p}
              </button>
            ))}
          </div>
        </div>
      </header>

      <main className="p-6 max-w-7xl mx-auto space-y-6">
        {/* Dashboard Tab */}
        {tab === 'dashboard' && (
          <>
            <KPICards summary={summary} />
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              <div className="lg:col-span-2"><AgentChart agents={agents} /></div>
              <CostChart costs={costs} />
            </div>
            <TrendChart trend={trend} />
          </>
        )}

        {/* Traces Tab */}
        {tab === 'traces' && (
          <div className="space-y-6">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <TraceTable traces={traces} selectedId={selectedTrace} onSelect={handleTraceSelect} />
              <SpanTreeView executionId={selectedTraceId} />
            </div>
            {selectedTrace && <WaterfallView detail={traceDetail} />}
          </div>
        )}

        {/* Feedback Tab */}
        {tab === 'feedback' && <FeedbackTab period={period} />}

        {/* Learning Tab */}
        {tab === 'learning' && <LearningTab />}
      </main>
    </div>
  );
}

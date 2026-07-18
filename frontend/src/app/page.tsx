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
import { ForgeTab } from '@/components/ForgeTab';
import { JourneyTab } from '@/components/JourneyTab';
import { DecisionsTab } from '@/components/DecisionsTab';
import { SatisfactionCard, TopErrorAgentsCard, ConversationsCard } from '@/components/InsightCards';
import { FederationMonitor } from '@/components/FederationMonitor';
import { FederationTab } from '@/components/FederationTab';
import { TestsTab } from '@/components/TestsTab';
import { ACPHealthCard } from '@/components/ACPHealthCard';

const API = process.env.NEXT_PUBLIC_PULSE_API || 'http://localhost:8095';

type Tab = 'dashboard' | 'federation' | 'journey' | 'decisions' | 'forge' | 'traces' | 'tests' | 'feedback' | 'learning';

const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'dashboard',  label: 'Dashboard'  },
  { id: 'federation', label: 'Federation' },
  { id: 'journey',    label: 'Journey'    },
  { id: 'decisions', label: 'Decisions' },
  { id: 'forge',     label: 'Forge'     },
  { id: 'traces',    label: 'Traces'    },
  { id: 'tests',     label: 'Tests'     },
  { id: 'feedback',  label: 'Feedback'  },
  { id: 'learning',  label: 'Learning'  },
];

const PERIODS = ['1h', '6h', '24h', '7d', '30d'] as const;

export default function Dashboard() {
  const [tab, setTab] = useState<Tab>('dashboard');
  const [period, setPeriod] = useState<typeof PERIODS[number]>('24h');
  const [data, setData] = useState<any>(null);
  const [traces, setTraces] = useState<any[]>([]);
  const [selectedTrace, setSelectedTrace] = useState<string | null>(null);
  const [selectedTraceId, setSelectedTraceId] = useState<string | null>(null);
  const [traceDetail, setTraceDetail] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [liveCount, setLiveCount] = useState(0);
  const [connected, setConnected] = useState(false);
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

    es.onopen = () => setConnected(true);

    es.addEventListener('new_execution', (e) => {
      const d = JSON.parse(e.data);
      setTraces(prev => [{
        id: d.execution_id,
        agent_id: d.agent_id,
        agent_name: d.agent_name || d.agent_id,
        query: d.query,
        success: d.success,
        duration_ms: d.duration_ms,
        token_count: 0,
        cost_usd: 0,
        created_at: new Date().toISOString(),
        trace_id: d.metadata?.trace_id || '',
      }, ...prev].slice(0, 50));
      setLiveCount(c => c + 1);
      fetchData();
    });

    es.addEventListener('new_llm_call', () => fetchData());

    es.onerror = () => {
      setConnected(false);
      setTimeout(() => {
        if (eventSourceRef.current) eventSourceRef.current.close();
      }, 5000);
    };

    return () => es.close();
  }, [fetchData]);

  useEffect(() => { fetchData(); }, [fetchData]);

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
      <div className="flex items-center gap-3 text-slate-500 text-sm">
        <div className="w-4 h-4 border-2 border-slate-700 border-t-indigo-400 rounded-full animate-spin" />
        Loading observability data…
      </div>
    </div>
  );

  const summary = data?.summary || {};
  const agents = data?.agents || [];
  const costs = data?.costs || {};
  const trend = data?.trend || [];

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 antialiased" style={{ fontFeatureSettings: '"cv11", "ss01", "ss03"' }}>
      {/* Header */}
      <header className="sticky top-0 z-30 border-b border-slate-800/80 bg-slate-950/80 backdrop-blur supports-[backdrop-filter]:bg-slate-950/60">
        <div className="px-6 py-3 flex items-center justify-between gap-6">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-indigo-400 shadow-[0_0_12px_rgba(129,140,248,0.6)]" />
              <h1 className="text-sm font-semibold tracking-tight text-slate-100">LogosPulse</h1>
              <span className="text-[10px] text-slate-500 font-mono uppercase">Observability</span>
            </div>
            {connected && (
              <span className="flex items-center gap-1.5 text-[10px] text-emerald-400 font-medium pl-3 border-l border-slate-800">
                <span className="relative flex h-1.5 w-1.5">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                  <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-400" />
                </span>
                LIVE {liveCount > 0 && <span className="text-slate-500">· {liveCount}</span>}
              </span>
            )}
          </div>

          <nav className="flex gap-0">
            {TABS.map(t => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`relative px-3.5 py-1.5 text-xs font-medium transition-colors ${
                  tab === t.id
                    ? 'text-slate-100'
                    : 'text-slate-500 hover:text-slate-300'
                }`}
              >
                {t.label}
                {tab === t.id && (
                  <span className="absolute -bottom-3 left-3 right-3 h-px bg-indigo-400" />
                )}
              </button>
            ))}
          </nav>

          <div className="flex items-center gap-1 bg-slate-900/50 border border-slate-800 rounded-md p-0.5">
            {PERIODS.map(p => (
              <button
                key={p}
                onClick={() => { setPeriod(p); setLoading(true); }}
                className={`px-2.5 py-1 text-[10px] font-medium tabular-nums rounded transition-colors ${
                  period === p
                    ? 'bg-slate-800 text-slate-100'
                    : 'text-slate-500 hover:text-slate-300'
                }`}
              >
                {p}
              </button>
            ))}
          </div>
        </div>
      </header>

      <main className="px-6 py-6 max-w-[1600px] mx-auto space-y-5">
        {tab === 'dashboard' && (
          <>
            <KPICards summary={summary} />
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
              <div className="lg:col-span-2"><AgentChart agents={agents} /></div>
              <CostChart costs={costs} />
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
              <SatisfactionCard period={period} />
              <TopErrorAgentsCard agents={agents} />
              <ConversationsCard />
            </div>
            <ACPHealthCard />
            <FederationMonitor />

            <TrendChart trend={trend} />
          </>
        )}

        {tab === 'federation' && <FederationTab />}
        {tab === 'journey' && <JourneyTab period={period} />}
        {tab === 'decisions' && <DecisionsTab />}
        {tab === 'forge' && <ForgeTab period={period} />}

        {tab === 'traces' && (
          <div className="space-y-5">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
              <TraceTable traces={traces} selectedId={selectedTrace} onSelect={handleTraceSelect} />
              <SpanTreeView executionId={selectedTraceId} />
            </div>
            {selectedTrace && <WaterfallView detail={traceDetail} />}
          </div>
        )}

        {tab === 'tests' && <TestsTab />}
        {tab === 'feedback' && <FeedbackTab />}
        {tab === 'learning' && <LearningTab />}
      </main>

      {/* Subtle footer */}
      <footer className="px-6 py-4 mt-8 border-t border-slate-800/50 text-[10px] text-slate-600 font-mono flex items-center justify-between max-w-[1600px] mx-auto">
        <span>logos_pulse · v0.1.0</span>
        <span>{new Date().toLocaleString('en-US', { hour12: false })}</span>
      </footer>
    </div>
  );
}

'use client';

/**
 * InsightCards — 대시보드 보강 3종 (다른 탭의 핵심 데이터를 첫 화면에):
 *  1) 사용자 만족도 (Feedback) — 👍/👎 도넛
 *  2) 오류 다발 에이전트 Top 5 (Agent stats) — 수평 바
 *  3) 에이전트 간 대화 활동 (Journey/대화 로그) — 최근 피드 + 상태 분포
 */

import { useState, useEffect, useCallback } from 'react';
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, BarChart, Bar, XAxis, YAxis } from 'recharts';

const API = process.env.NEXT_PUBLIC_PULSE_API || 'http://localhost:8095';

const TOOLTIP_STYLE = {
  contentStyle: { background: '#0f172a', border: '1px solid #1e293b', borderRadius: 6, fontSize: 11, padding: '6px 10px' },
  labelStyle: { color: '#cbd5e1', fontSize: 11 },
};

function Card({ title, sub, children }: { title: string; sub?: string; children: React.ReactNode }) {
  return (
    <div className="border border-slate-800 bg-slate-900/30 rounded-lg overflow-hidden">
      <div className="px-4 py-3 border-b border-slate-800">
        <div className="text-[10px] uppercase tracking-wider text-slate-500 font-medium">{title}</div>
        {sub && <div className="text-2xl font-semibold tabular-nums tracking-tight text-slate-100 mt-1">{sub}</div>}
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}

// ── 1) 사용자 만족도 ─────────────────────────────────────────
export function SatisfactionCard({ period }: { period: string }) {
  const [stats, setStats] = useState<Array<{ agent_id: string; positive: number; negative: number }>>([]);

  const load = useCallback(async () => {
    try {
      const r = await fetch(`${API}/api/v1/feedback/stats?period=${period}`);
      const d = await r.json();
      setStats(Array.isArray(d) ? d : d.stats || []);
    } catch { /* noop */ }
  }, [period]);
  useEffect(() => { load(); const t = setInterval(load, 15000); return () => clearInterval(t); }, [load]);

  const pos = stats.reduce((a, s) => a + (s.positive || 0), 0);
  const neg = stats.reduce((a, s) => a + (s.negative || 0), 0);
  const total = pos + neg;
  const rate = total ? Math.round((pos / total) * 100) : null;
  const data = [
    { name: '👍 긍정', value: pos },
    { name: '👎 부정', value: neg },
  ];

  return (
    <Card title="User Satisfaction" sub={rate === null ? '—' : `${rate}%`}>
      {total === 0 ? (
        <div className="h-36 flex items-center justify-center text-slate-600 text-xs">피드백 없음 (채팅의 👍/👎)</div>
      ) : (
        <>
          <ResponsiveContainer width="100%" height={120}>
            <PieChart>
              <Pie data={data} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={32} outerRadius={54} strokeWidth={0}>
                <Cell fill="#34d399" fillOpacity={0.85} />
                <Cell fill="#fb7185" fillOpacity={0.85} />
              </Pie>
              <Tooltip {...TOOLTIP_STYLE} />
            </PieChart>
          </ResponsiveContainer>
          <div className="mt-2 flex justify-center gap-4 text-[11px] text-slate-400 tabular-nums">
            <span><span className="text-emerald-400">●</span> 긍정 {pos}</span>
            <span><span className="text-rose-400">●</span> 부정 {neg}</span>
          </div>
        </>
      )}
    </Card>
  );
}

// ── 2) 오류 다발 에이전트 Top 5 ──────────────────────────────
export function TopErrorAgentsCard({ agents }: { agents: any[] }) {
  const top = [...(agents || [])]
    .filter(a => (a.error_count || 0) > 0)
    .sort((a, b) => (b.error_count || 0) - (a.error_count || 0))
    .slice(0, 5)
    .map(a => ({ name: (a.agent_id || '').slice(0, 18), errors: a.error_count }));

  return (
    <Card title="Top Error Agents" sub={top.length ? String(top.reduce((s, a) => s + a.errors, 0)) : '0'}>
      {top.length === 0 ? (
        <div className="h-36 flex items-center justify-center text-slate-600 text-xs">기간 내 오류 없음</div>
      ) : (
        <ResponsiveContainer width="100%" height={150}>
          <BarChart data={top} layout="vertical" margin={{ left: 8, right: 12 }}>
            <XAxis type="number" hide />
            <YAxis type="category" dataKey="name" width={130}
                   tick={{ fill: '#94a3b8', fontSize: 10, fontFamily: 'monospace' }}
                   axisLine={false} tickLine={false} />
            <Tooltip {...TOOLTIP_STYLE} cursor={{ fill: '#1e293b', fillOpacity: 0.4 }} />
            <Bar dataKey="errors" fill="#fb7185" fillOpacity={0.8} radius={[0, 3, 3, 0]} barSize={14} />
          </BarChart>
        </ResponsiveContainer>
      )}
    </Card>
  );
}

// ── 3) 에이전트 간 대화 활동 ─────────────────────────────────
const CONV_STATUS: Record<string, string> = {
  success: 'text-emerald-400', error: 'text-rose-400', cancelled: 'text-amber-400',
};

export function ConversationsCard() {
  const [data, setData] = useState<{ conversations: any[]; status_counts: Record<string, number> }>({ conversations: [], status_counts: {} });

  const load = useCallback(async () => {
    try {
      const r = await fetch(`${API}/api/v1/conversations/recent?limit=8`);
      setData(await r.json());
    } catch { /* noop */ }
  }, []);
  useEffect(() => { load(); const t = setInterval(load, 10000); return () => clearInterval(t); }, [load]);

  const total = Object.values(data.status_counts).reduce((a, b) => a + b, 0);

  return (
    <Card title="Agent ↔ Agent Conversations" sub={String(total)}>
      <div className="flex gap-3 text-[10px] text-slate-500 mb-3 tabular-nums">
        {Object.entries(data.status_counts).map(([s, n]) => (
          <span key={s} className={CONV_STATUS[s] || 'text-slate-400'}>{s} {n}</span>
        ))}
      </div>
      {data.conversations.length === 0 ? (
        <div className="h-28 flex items-center justify-center text-slate-600 text-xs">아직 에이전트 간 대화 기록이 없습니다</div>
      ) : (
        <div className="space-y-1.5 max-h-40 overflow-y-auto pr-1">
          {data.conversations.map((c, i) => (
            <div key={i} className="text-[11px] font-mono flex items-center gap-1.5 border-b border-slate-800/50 pb-1.5">
              <span className="text-indigo-300 truncate max-w-[38%]">{c.caller}</span>
              <span className="text-slate-600">→</span>
              <span className="text-amber-300 truncate max-w-[38%]">{c.callee}</span>
              <span className={`ml-auto ${CONV_STATUS[c.status] || 'text-slate-400'}`}>{c.status}</span>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

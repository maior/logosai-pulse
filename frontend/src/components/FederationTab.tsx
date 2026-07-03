'use client';

/**
 * FederationTab — 기관 간 연합 전략 모니터링 대시보드.
 *
 * 규제 기관 담당자 관점의 뷰:
 *   1) KPI 밴드 — 연결 기관 / 총 위임 / 성공률 / 평균 지연
 *   2) 기관 토폴로지 (SVG 방사형) — 본 기관 + 연합 피어, 활성/트래픽 표현
 *   3) 위임 트래픽 추이 (시간대별 성공/실패 스택 바)
 *   4) 기관별 상세 — 성공률·평균지연·호출 에이전트 분해
 *   5) 트랜잭션 로그 (실시간 감사 피드)
 *
 * 데이터: GET /api/v1/federation/live (stage=federation span 집계, 8초 폴링)
 */

import { useState, useEffect, useCallback } from 'react';

const API = process.env.NEXT_PUBLIC_PULSE_API || 'http://localhost:8095';
const PEER_COLORS = ['#818cf8', '#2dd4bf', '#f59e0b', '#f472b6', '#a3e635', '#60a5fa'];

interface AgentBreak { agent_id: string; calls: number; }
interface Institution {
  peer_id: string; calls: number; success_rate: number; error_count: number;
  avg_ms: number; last_seen: string; agents: AgentBreak[];
}
interface Tx {
  ts: string; peer_id: string; agent_id: string; status: string;
  duration_ms: number; preview: string;
}
interface TimelineBucket { hour: string; success: number; error: number; }
interface LiveData {
  institutions: Institution[];
  transactions: Tx[];
  timeline: TimelineBucket[];
  totals: { institutions: number; transactions: number; success: number };
}

function fmtMs(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`;
}
function fmtTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString('ko', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  } catch { return iso.slice(11, 19); }
}
function fmtHour(iso: string): string {
  try { return new Date(iso + ':00:00').toLocaleTimeString('ko', { hour: '2-digit', minute: '2-digit' }); }
  catch { return iso.slice(11, 13) + '시'; }
}
function isRecent(iso: string, seconds = 120): boolean {
  try { return Date.now() - new Date(iso).getTime() < seconds * 1000; } catch { return false; }
}
function peerColor(institutions: Institution[], peer: string): string {
  const i = institutions.findIndex(p => p.peer_id === peer);
  return PEER_COLORS[(i < 0 ? 0 : i) % PEER_COLORS.length];
}

// ── KPI 타일 ──
function Kpi({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: string }) {
  return (
    <div className="border border-slate-800 bg-slate-900/30 rounded-lg px-4 py-3.5">
      <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-1.5 font-medium">{label}</div>
      <div className={`text-2xl font-semibold tabular-nums tracking-tight ${accent || 'text-slate-100'}`}>{value}</div>
      {sub && <div className="text-[11px] text-slate-500 mt-1">{sub}</div>}
    </div>
  );
}

// ── SVG 방사형 토폴로지 ──
function Topology({ institutions }: { institutions: Institution[] }) {
  const W = 400, H = 300, cx = W / 2, cy = H / 2, R = 100;
  const peers = institutions.slice(0, 6);
  const maxCalls = Math.max(...peers.map(p => p.calls), 1);

  return (
    <svg width="100%" viewBox={`0 0 ${W} ${H}`} className="max-h-80">
      {peers.map((p, i) => {
        const angle = (Math.PI * 2 * i) / Math.max(peers.length, 1) - Math.PI / 2;
        const x = cx + R * Math.cos(angle);
        const y = cy + R * Math.sin(angle);
        const color = PEER_COLORS[i % PEER_COLORS.length];
        const live = isRecent(p.last_seen);
        const nodeR = 22 + Math.round((p.calls / maxCalls) * 8); // 호출량 → 반경
        return (
          <g key={p.peer_id}>
            <line x1={cx} y1={cy} x2={x} y2={y} stroke={color} strokeWidth={1.5 + (p.calls / maxCalls) * 2}
                  strokeOpacity={live ? 0.85 : 0.28} strokeDasharray={live ? '0' : '4 3'} />
            {live && (
              <circle r="3.2" fill={color}>
                <animateMotion dur="1.7s" repeatCount="indefinite" path={`M ${x} ${y} L ${cx} ${cy}`} />
              </circle>
            )}
            <circle cx={x} cy={y} r={nodeR} fill="#0f172a" stroke={color} strokeWidth="1.6" />
            <text x={x} y={y - 4} textAnchor="middle" fontSize="10.5" fontWeight="700" fill="#e2e8f0">{p.peer_id}</text>
            <text x={x} y={y + 8} textAnchor="middle" fontSize="8.5" fill="#94a3b8">{p.calls}건 · {fmtMs(p.avg_ms)}</text>
            <circle cx={x + nodeR - 6} cy={y - nodeR + 6} r="4" fill={p.error_count > 0 ? '#fb7185' : '#34d399'} />
          </g>
        );
      })}
      <circle cx={cx} cy={cy} r="30" fill="#1e293b" stroke="#64748b" strokeWidth="1.6" />
      <text x={cx} y={cy - 3} textAnchor="middle" fontSize="11" fontWeight="800" fill="#f1f5f9">본 기관</text>
      <text x={cx} y={cy + 11} textAnchor="middle" fontSize="8.5" fill="#94a3b8">logos_api</text>
    </svg>
  );
}

// ── 시간대별 트래픽 스택 바 (성공/실패) ──
function TrafficTrend({ timeline }: { timeline: TimelineBucket[] }) {
  const data = timeline.slice(-24);
  const max = Math.max(...data.map(b => b.success + b.error), 1);
  if (data.length === 0) return <div className="h-28 flex items-center justify-center text-slate-600 text-xs">트래픽 없음</div>;
  return (
    <div className="flex items-end gap-[3px] h-28 pt-2">
      {data.map((b, i) => {
        const total = b.success + b.error;
        const h = (total / max) * 100;
        const errFrac = total ? b.error / total : 0;
        return (
          <div key={i} className="flex-1 flex flex-col justify-end group relative" title={`${fmtHour(b.hour)} · 성공 ${b.success} 실패 ${b.error}`}>
            <div className="w-full rounded-t-[2px] overflow-hidden flex flex-col" style={{ height: `${h}%` }}>
              {b.error > 0 && <div className="bg-rose-400/80" style={{ height: `${errFrac * 100}%` }} />}
              <div className="bg-cyan-400/80 flex-1" />
            </div>
          </div>
        );
      })}
    </div>
  );
}

const TX_STATUS: Record<string, string> = {
  success: 'text-emerald-400', error: 'text-rose-400', cancelled: 'text-amber-400',
};

export function FederationTab() {
  const [data, setData] = useState<LiveData>({
    institutions: [], transactions: [], timeline: [],
    totals: { institutions: 0, transactions: 0, success: 0 },
  });
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await fetch(`${API}/api/v1/federation/live?hours=168`);
      setData(await r.json());
    } catch { /* noop */ } finally { setLoaded(true); }
  }, []);
  useEffect(() => { load(); const t = setInterval(load, 8000); return () => clearInterval(t); }, [load]);

  const { institutions, transactions, timeline, totals } = data;
  const successPct = totals.transactions ? Math.round((totals.success / totals.transactions) * 100) : 0;
  const avgMs = institutions.length
    ? Math.round(institutions.reduce((s, i) => s + i.avg_ms * i.calls, 0) / Math.max(totals.transactions, 1))
    : 0;

  if (loaded && totals.transactions === 0) {
    return (
      <div className="border border-slate-800 bg-slate-900/30 rounded-lg p-10 text-center">
        <div className="text-slate-400 text-sm mb-2">연합 트랜잭션이 아직 없습니다</div>
        <div className="text-slate-600 text-xs leading-relaxed">
          기관 간 위임(stage=federation)이 발생하면 여기에 연결 기관 토폴로지와 트랜잭션이 표시됩니다.<br />
          <code className="text-slate-500">LOGOS_FEDERATION=true</code> 로 연합을 활성화하고 피어를 등록하세요.
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* KPI */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Kpi label="연결 기관" value={String(totals.institutions)} sub="활성 연합 피어" />
        <Kpi label="총 위임" value={totals.transactions.toLocaleString()} sub="기관 경계 통과 호출" />
        <Kpi label="위임 성공률" value={`${successPct}%`}
             sub={successPct >= 99 ? 'Excellent' : successPct >= 95 ? 'Healthy' : 'Degraded'}
             accent={successPct >= 99 ? 'text-emerald-300' : successPct >= 95 ? 'text-slate-100' : 'text-amber-300'} />
        <Kpi label="평균 위임 지연" value={fmtMs(avgMs)} sub="경계 왕복 포함" />
      </div>

      {/* 토폴로지 + 트래픽 추이 */}
      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-4">
        <div className="border border-slate-800 bg-slate-900/30 rounded-lg overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-800">
            <h3 className="text-[10px] uppercase tracking-wider text-slate-500 font-medium">연합 토폴로지</h3>
          </div>
          <div className="p-3">
            <Topology institutions={institutions} />
            <div className="flex justify-center gap-4 text-[9px] text-slate-600 mt-1">
              <span><span className="text-emerald-400">●</span> 정상</span>
              <span><span className="text-rose-400">●</span> 오류 발생</span>
              <span>─ 굵기/실선: 트래픽량·최근 활성</span>
            </div>
          </div>
        </div>
        <div className="border border-slate-800 bg-slate-900/30 rounded-lg overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between">
            <h3 className="text-[10px] uppercase tracking-wider text-slate-500 font-medium">위임 트래픽 추이 (시간별)</h3>
            <span className="text-[10px] text-slate-600">
              <span className="text-cyan-400">■</span> 성공 <span className="text-rose-400 ml-2">■</span> 실패
            </span>
          </div>
          <div className="p-4">
            <TrafficTrend timeline={timeline} />
          </div>
        </div>
      </div>

      {/* 기관별 상세 */}
      <div className="border border-slate-800 bg-slate-900/30 rounded-lg overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-800">
          <h3 className="text-[10px] uppercase tracking-wider text-slate-500 font-medium">기관별 상세 (호출량 순)</h3>
        </div>
        <div className="divide-y divide-slate-800/40">
          {institutions.map((inst, i) => {
            const color = PEER_COLORS[i % PEER_COLORS.length];
            const ratePct = Math.round(inst.success_rate * 100);
            const rateTone = ratePct >= 95 ? 'text-emerald-300' : ratePct >= 80 ? 'text-amber-300' : 'text-rose-300';
            return (
              <div key={inst.peer_id} className="px-4 py-3">
                <div className="flex items-center gap-3 mb-2">
                  <span className="w-2.5 h-2.5 rounded-[3px] shrink-0" style={{ background: color }} />
                  <span className="font-mono text-sm font-semibold text-slate-200">{inst.peer_id}</span>
                  <span className="ml-auto flex items-center gap-4 text-[11px] tabular-nums">
                    <span className="text-slate-400">{inst.calls}건</span>
                    <span className={rateTone}>{ratePct}% 성공</span>
                    {inst.error_count > 0 && <span className="text-rose-400">오류 {inst.error_count}</span>}
                    <span className="text-slate-500">평균 {fmtMs(inst.avg_ms)}</span>
                  </span>
                </div>
                <div className="flex flex-wrap gap-1.5 pl-5.5">
                  {inst.agents.map(a => (
                    <span key={a.agent_id}
                          className="text-[10px] font-mono px-2 py-0.5 rounded bg-slate-800/60 text-slate-400 border border-slate-700/50">
                      {a.agent_id} <span className="text-slate-500">×{a.calls}</span>
                    </span>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* 트랜잭션 로그 */}
      <div className="border border-slate-800 bg-slate-900/30 rounded-lg overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between">
          <h3 className="text-[10px] uppercase tracking-wider text-slate-500 font-medium">트랜잭션 로그 (실시간 · 8초 갱신)</h3>
          <span className="text-[10px] text-slate-600">최근 {Math.min(transactions.length, 50)}건</span>
        </div>
        <div className="px-4 pt-2 grid grid-cols-[72px_minmax(0,0.7fr)_minmax(0,1.3fr)_60px_60px] gap-2
                        text-[9px] uppercase tracking-wider text-slate-600">
          <span>Time</span><span>기관</span><span>Agent</span>
          <span className="text-right">소요</span><span className="text-right">상태</span>
        </div>
        <div className="px-4 pb-3 pt-1 divide-y divide-slate-800/40 max-h-96 overflow-y-auto">
          {transactions.map((t, i) => {
            const color = peerColor(institutions, t.peer_id);
            return (
              <div key={i} title={t.preview}
                   className="grid grid-cols-[72px_minmax(0,0.7fr)_minmax(0,1.3fr)_60px_60px] gap-2
                              items-center py-[7px] text-[11px] hover:bg-slate-800/30 -mx-1 px-1 rounded-sm">
                <span className="tabular-nums text-slate-500">{fmtTime(t.ts)}</span>
                <span className="flex items-center gap-1.5 min-w-0">
                  <span className="w-2 h-2 rounded-[2px] shrink-0" style={{ background: color }} />
                  <span className="font-mono text-slate-300 truncate">{t.peer_id}</span>
                </span>
                <span className="font-mono text-slate-400 truncate">{t.agent_id}</span>
                <span className="tabular-nums text-right text-slate-500">{fmtMs(t.duration_ms)}</span>
                <span className={`text-right ${TX_STATUS[t.status] || 'text-slate-400'}`}>{t.status}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

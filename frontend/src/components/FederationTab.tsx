'use client';

/**
 * FederationTab — 기관 간 연합 전략 모니터링 대시보드.
 *
 * 규제 기관(은행·관공서) 담당자 관점:
 *   1) KPI 밴드 — 연결 기관 / 총 위임 / 성공률 / 평균 지연 / 최근 활동
 *   2) 연합 토폴로지 (SVG 방사형) + 위임 트래픽 추이 (연속 24h 스택 컬럼)
 *   3) 기관별 SLA 카드 — 성공률 게이지 · 지연 · 호출 에이전트
 *   4) 트랜잭션 로그 (실시간 감사 피드)
 *
 * 데이터: GET /api/v1/federation/live (stage=federation span, 8초 폴링)
 * 색 규칙(dataviz): 성공/실패=status 토큰(emerald/rose, 숫자 동반),
 *   기관=categorical(항상 peer_id 라벨 동반 — identity 색-단독 금지), 단일 x축.
 */

import { useState, useEffect, useCallback } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
} from 'recharts';

const API = process.env.NEXT_PUBLIC_PULSE_API || 'http://localhost:8095';
const PEER_COLORS = ['#818cf8', '#2dd4bf', '#f59e0b', '#f472b6', '#a3e635', '#60a5fa'];
const OK = '#34d399';   // status good
const BAD = '#fb7185';  // status critical

interface AgentBreak { agent_id: string; calls: number; }
interface Institution {
  peer_id: string; calls: number; success_rate: number; error_count: number;
  avg_ms: number; last_seen: string; agents: AgentBreak[];
}
interface Tx { ts: string; peer_id: string; agent_id: string; status: string; duration_ms: number; preview: string; }
interface TimelineBucket { hour: string; success: number; error: number; }
interface LiveData {
  institutions: Institution[]; transactions: Tx[]; timeline: TimelineBucket[];
  totals: { institutions: number; transactions: number; success: number };
}

function fmtMs(ms: number): string { return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.round(ms)}ms`; }
function fmtTime(iso: string): string {
  try { return new Date(iso).toLocaleTimeString('ko', { hour: '2-digit', minute: '2-digit', second: '2-digit' }); }
  catch { return iso.slice(11, 19); }
}
function fmtHourKST(hourUtc: string): string {
  // 백엔드는 UTC 시각 키('YYYY-MM-DDTHH') — KST 로 변환해 표시
  try { return new Date(hourUtc + ':00:00Z').toLocaleTimeString('ko', { hour: '2-digit', minute: '2-digit' }); }
  catch { return hourUtc.slice(11, 13) + '시'; }
}
function fmtAgo(iso: string): string {
  try {
    const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
    if (s < 60) return `${s}초 전`;
    if (s < 3600) return `${Math.floor(s / 60)}분 전`;
    if (s < 86400) return `${Math.floor(s / 3600)}시간 전`;
    return `${Math.floor(s / 86400)}일 전`;
  } catch { return '—'; }
}
function isRecent(iso: string, seconds = 120): boolean {
  try { return Date.now() - new Date(iso).getTime() < seconds * 1000; } catch { return false; }
}
function peerIdx(institutions: Institution[], peer: string): number {
  const i = institutions.findIndex(p => p.peer_id === peer);
  return i < 0 ? 0 : i;
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
    <svg width="100%" viewBox={`0 0 ${W} ${H}`} className="max-h-72">
      {peers.map((p, i) => {
        const angle = (Math.PI * 2 * i) / Math.max(peers.length, 1) - Math.PI / 2;
        const x = cx + R * Math.cos(angle), y = cy + R * Math.sin(angle);
        const color = PEER_COLORS[i % PEER_COLORS.length];
        const live = isRecent(p.last_seen);
        const nodeR = 22 + Math.round((p.calls / maxCalls) * 8);
        return (
          <g key={p.peer_id}>
            <line x1={cx} y1={cy} x2={x} y2={y} stroke={color} strokeWidth={1.5 + (p.calls / maxCalls) * 2}
                  strokeOpacity={live ? 0.85 : 0.28} strokeDasharray={live ? '0' : '4 3'} />
            {live && <circle r="3.2" fill={color}><animateMotion dur="1.7s" repeatCount="indefinite" path={`M ${x} ${y} L ${cx} ${cy}`} /></circle>}
            <circle cx={x} cy={y} r={nodeR} fill="#0f172a" stroke={color} strokeWidth="1.6" />
            <text x={x} y={y - 4} textAnchor="middle" fontSize="10.5" fontWeight="700" fill="#e2e8f0">{p.peer_id}</text>
            <text x={x} y={y + 8} textAnchor="middle" fontSize="8.5" fill="#94a3b8">{p.calls}건 · {fmtMs(p.avg_ms)}</text>
            <circle cx={x + nodeR - 6} cy={y - nodeR + 6} r="4" fill={p.error_count > 0 ? BAD : OK} />
          </g>
        );
      })}
      <circle cx={cx} cy={cy} r="30" fill="#1e293b" stroke="#64748b" strokeWidth="1.6" />
      <text x={cx} y={cy - 3} textAnchor="middle" fontSize="11" fontWeight="800" fill="#f1f5f9">본 기관</text>
      <text x={cx} y={cy + 11} textAnchor="middle" fontSize="8.5" fill="#94a3b8">logos_api</text>
    </svg>
  );
}

// ── 위임 트래픽 추이 (연속 24h 스택 컬럼) ──
function TrafficTrend({ timeline }: { timeline: TimelineBucket[] }) {
  const data = timeline.map(b => ({
    label: fmtHourKST(b.hour), success: b.success, error: b.error, total: b.success + b.error,
  }));
  const hasData = data.some(d => d.total > 0);
  return (
    <div className="p-4">
      <ResponsiveContainer width="100%" height={168}>
        <BarChart data={data} margin={{ top: 4, right: 6, left: -18, bottom: 0 }} barCategoryGap="18%">
          <XAxis dataKey="label" tick={{ fill: '#64748b', fontSize: 9 }} axisLine={{ stroke: '#1e293b' }}
                 tickLine={false} interval={Math.max(Math.floor(data.length / 8) - 1, 0)} minTickGap={8} />
          <YAxis tick={{ fill: '#64748b', fontSize: 9 }} axisLine={false} tickLine={false}
                 allowDecimals={false} width={30} />
          <Tooltip
            contentStyle={{ background: '#0f172a', border: '1px solid #1e293b', borderRadius: 6, fontSize: 11, padding: '6px 10px' }}
            labelStyle={{ color: '#cbd5e1', fontSize: 11, marginBottom: 2 }} cursor={{ fill: '#1e293b', fillOpacity: 0.4 }}
            formatter={(v: any, name: any) => [`${v}건`, name === 'success' ? '성공' : '실패']} />
          <Bar dataKey="success" stackId="a" fill={OK} fillOpacity={0.85} radius={[0, 0, 0, 0]} />
          <Bar dataKey="error" stackId="a" fill={BAD} fillOpacity={0.85} radius={[2, 2, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
      {!hasData && (
        <div className="text-center text-[11px] text-slate-600 -mt-24 mb-16 relative pointer-events-none">
          최근 24시간 위임 없음
        </div>
      )}
      <div className="flex justify-end gap-4 text-[10px] text-slate-500 mt-1">
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-[2px]" style={{ background: OK }} />성공</span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-[2px]" style={{ background: BAD }} />실패</span>
      </div>
    </div>
  );
}

// ── 성공률 미니 링 게이지 ──
function RateRing({ pct }: { pct: number }) {
  const r = 15, c = 2 * Math.PI * r;
  const tone = pct >= 95 ? OK : pct >= 80 ? '#f59e0b' : BAD;
  return (
    <svg width="40" height="40" viewBox="0 0 40 40" className="shrink-0">
      <circle cx="20" cy="20" r={r} fill="none" stroke="#1e293b" strokeWidth="4" />
      <circle cx="20" cy="20" r={r} fill="none" stroke={tone} strokeWidth="4" strokeLinecap="round"
              strokeDasharray={c} strokeDashoffset={c * (1 - pct / 100)} transform="rotate(-90 20 20)" />
      <text x="20" y="23" textAnchor="middle" fontSize="10" fontWeight="700" fill="#e2e8f0">{pct}</text>
    </svg>
  );
}

const TX_STATUS: Record<string, string> = { success: 'text-emerald-400', error: 'text-rose-400', cancelled: 'text-amber-400' };

export function FederationTab() {
  const [data, setData] = useState<LiveData>({
    institutions: [], transactions: [], timeline: [], totals: { institutions: 0, transactions: 0, success: 0 },
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
  const avgMs = totals.transactions
    ? Math.round(institutions.reduce((s, i) => s + i.avg_ms * i.calls, 0) / totals.transactions) : 0;
  const errTotal = institutions.reduce((s, i) => s + i.error_count, 0);
  const lastSeen = institutions.reduce((m, i) => (i.last_seen > m ? i.last_seen : m), '');

  if (loaded && totals.transactions === 0) {
    return (
      <div className="border border-slate-800 bg-slate-900/30 rounded-lg p-12 text-center">
        <div className="text-4xl mb-3 opacity-40">🔗</div>
        <div className="text-slate-300 text-sm mb-2 font-medium">연합 트랜잭션이 아직 없습니다</div>
        <div className="text-slate-500 text-xs leading-relaxed max-w-md mx-auto">
          기관 간 위임(stage=federation)이 발생하면 연결 기관 토폴로지·트래픽 추이·SLA·트랜잭션이 여기에 표시됩니다.<br />
          <code className="text-slate-400 bg-slate-800/60 px-1.5 py-0.5 rounded mt-2 inline-block">LOGOS_FEDERATION=true</code>
          로 연합을 활성화하고 피어를 등록하세요.
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* KPI */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <Kpi label="연결 기관" value={String(totals.institutions)} sub="활성 연합 피어" />
        <Kpi label="총 위임" value={totals.transactions.toLocaleString()} sub="기관 경계 통과" />
        <Kpi label="위임 성공률" value={`${successPct}%`}
             sub={successPct >= 99 ? 'Excellent' : successPct >= 95 ? 'Healthy' : 'Degraded'}
             accent={successPct >= 99 ? 'text-emerald-300' : successPct >= 95 ? 'text-slate-100' : 'text-amber-300'} />
        <Kpi label="평균 위임 지연" value={fmtMs(avgMs)} sub={errTotal > 0 ? `오류 ${errTotal}건` : '오류 없음'}
             accent={errTotal > 0 ? 'text-amber-300' : 'text-slate-100'} />
        <Kpi label="최근 활동" value={lastSeen ? fmtAgo(lastSeen) : '—'} sub="마지막 위임" />
      </div>

      {/* 토폴로지 + 트래픽 추이 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="border border-slate-800 bg-slate-900/30 rounded-lg overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-800">
            <h3 className="text-[10px] uppercase tracking-wider text-slate-500 font-medium">연합 토폴로지</h3>
          </div>
          <div className="p-3">
            <Topology institutions={institutions} />
            <div className="flex justify-center gap-4 text-[9px] text-slate-600 mt-1">
              <span><span className="text-emerald-400">●</span> 정상</span>
              <span><span className="text-rose-400">●</span> 오류</span>
              <span>─ 굵기·실선: 트래픽량·최근 활성</span>
            </div>
          </div>
        </div>
        <div className="border border-slate-800 bg-slate-900/30 rounded-lg overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-800">
            <h3 className="text-[10px] uppercase tracking-wider text-slate-500 font-medium">위임 트래픽 추이 (최근 24시간 · KST)</h3>
          </div>
          <TrafficTrend timeline={timeline} />
        </div>
      </div>

      {/* 기관별 SLA 카드 */}
      <div>
        <div className="text-[10px] uppercase tracking-wider text-slate-500 font-medium mb-2 px-1">기관별 SLA</div>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {institutions.map((inst, i) => {
            const color = PEER_COLORS[i % PEER_COLORS.length];
            const ratePct = Math.round(inst.success_rate * 100);
            return (
              <div key={inst.peer_id} className="border border-slate-800 bg-slate-900/30 rounded-lg p-4">
                <div className="flex items-center gap-3">
                  <RateRing pct={ratePct} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="w-2.5 h-2.5 rounded-[3px] shrink-0" style={{ background: color }} />
                      <span className="font-mono text-sm font-semibold text-slate-200 truncate">{inst.peer_id}</span>
                    </div>
                    <div className="text-[11px] text-slate-500 mt-1 tabular-nums">
                      {inst.calls}건 · 평균 {fmtMs(inst.avg_ms)}
                      {inst.error_count > 0 && <span className="text-rose-400"> · 오류 {inst.error_count}</span>}
                    </div>
                    <div className="text-[10px] text-slate-600 mt-0.5">{fmtAgo(inst.last_seen)}</div>
                  </div>
                </div>
                <div className="flex flex-wrap gap-1.5 mt-3">
                  {inst.agents.map(a => (
                    <span key={a.agent_id} className="text-[10px] font-mono px-2 py-0.5 rounded bg-slate-800/60 text-slate-400 border border-slate-700/50">
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
        <div className="px-4 pt-2 grid grid-cols-[72px_minmax(0,0.7fr)_minmax(0,1.3fr)_60px_60px] gap-2 text-[9px] uppercase tracking-wider text-slate-600">
          <span>Time</span><span>기관</span><span>Agent</span>
          <span className="text-right">소요</span><span className="text-right">상태</span>
        </div>
        <div className="px-4 pb-3 pt-1 divide-y divide-slate-800/40 max-h-96 overflow-y-auto">
          {transactions.map((t, i) => {
            const color = PEER_COLORS[peerIdx(institutions, t.peer_id) % PEER_COLORS.length];
            return (
              <div key={i} title={t.preview}
                   className="grid grid-cols-[72px_minmax(0,0.7fr)_minmax(0,1.3fr)_60px_60px] gap-2 items-center py-[7px] text-[11px] hover:bg-slate-800/30 -mx-1 px-1 rounded-sm">
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

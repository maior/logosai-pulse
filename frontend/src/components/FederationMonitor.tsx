'use client';

/**
 * Federation Monitor — 연합된 기관들과 기관 간 트랜잭션 실시간 표시.
 *
 * 좌측: 기관 토폴로지 (중앙 = 본 기관, 주변 = 연합 피어 노드 — 호출량·상태·평균지연)
 * 우측: 트랜잭션 피드 (시각 · 피어 · 에이전트 · 소요 · 상태)
 * 데이터: GET /api/v1/federation/live (stage=federation span 집계, 8초 폴링)
 */

import { useState, useEffect, useCallback } from 'react';

const API = process.env.NEXT_PUBLIC_PULSE_API || 'http://localhost:8095';

interface Institution {
  peer_id: string;
  calls: number;
  success_rate: number;
  error_count: number;
  avg_ms: number;
  last_seen: string;
}

interface Tx {
  ts: string;
  peer_id: string;
  agent_id: string;
  status: string;
  duration_ms: number;
  preview: string;
}

interface LiveData {
  institutions: Institution[];
  transactions: Tx[];
  totals: { institutions: number; transactions: number; success: number };
}

const PEER_COLORS = ['#818cf8', '#2dd4bf', '#f59e0b', '#f472b6', '#a3e635'];

function fmtMs(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`;
}

function fmtTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString('ko', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  } catch { return iso.slice(11, 19); }
}

function isRecent(iso: string, seconds = 60): boolean {
  try { return Date.now() - new Date(iso).getTime() < seconds * 1000; } catch { return false; }
}

// ── SVG 토폴로지: 중앙 허브(본 기관) + 피어 노드 방사 배치 ──
function Topology({ institutions }: { institutions: Institution[] }) {
  const W = 340, H = 240, cx = W / 2, cy = H / 2, R = 82;
  const peers = institutions.slice(0, 5);

  return (
    <svg width="100%" viewBox={`0 0 ${W} ${H}`} className="max-h-64">
      {peers.map((p, i) => {
        const angle = (Math.PI * 2 * i) / Math.max(peers.length, 1) - Math.PI / 2;
        const x = cx + R * Math.cos(angle);
        const y = cy + R * Math.sin(angle);
        const color = PEER_COLORS[i % PEER_COLORS.length];
        const live = isRecent(p.last_seen, 120);
        return (
          <g key={p.peer_id}>
            <line x1={cx} y1={cy} x2={x} y2={y} stroke={color} strokeWidth={1.5}
                  strokeOpacity={live ? 0.9 : 0.3} strokeDasharray={live ? '0' : '4 3'} />
            {live && (
              <circle r="3" fill={color}>
                <animateMotion dur="1.6s" repeatCount="indefinite"
                               path={`M ${x} ${y} L ${cx} ${cy}`} />
              </circle>
            )}
            <circle cx={x} cy={y} r="24" fill="#0f172a" stroke={color} strokeWidth="1.5" />
            <text x={x} y={y - 3} textAnchor="middle" fontSize="9.5" fontWeight="700" fill="#e2e8f0">
              {p.peer_id}
            </text>
            <text x={x} y={y + 9} textAnchor="middle" fontSize="8" fill="#94a3b8">
              {p.calls}건 · {fmtMs(p.avg_ms)}
            </text>
            <circle cx={x + 17} cy={y - 17} r="3.5"
                    fill={p.error_count > 0 ? '#fb7185' : '#34d399'} />
          </g>
        );
      })}
      {/* 본 기관 (중앙) */}
      <circle cx={cx} cy={cy} r="28" fill="#1e293b" stroke="#64748b" strokeWidth="1.5" />
      <text x={cx} y={cy - 2} textAnchor="middle" fontSize="10" fontWeight="800" fill="#f1f5f9">본 기관</text>
      <text x={cx} y={cy + 11} textAnchor="middle" fontSize="8" fill="#94a3b8">logos_api</text>
      {peers.length === 0 && (
        <text x={cx} y={cy + 55} textAnchor="middle" fontSize="10" fill="#64748b">
          연결된 연합 기관 없음
        </text>
      )}
    </svg>
  );
}

const TX_STATUS: Record<string, string> = {
  success: 'text-emerald-400', error: 'text-rose-400', cancelled: 'text-amber-400',
};

export function FederationMonitor() {
  const [data, setData] = useState<LiveData>({
    institutions: [], transactions: [], totals: { institutions: 0, transactions: 0, success: 0 },
  });

  const load = useCallback(async () => {
    try {
      const r = await fetch(`${API}/api/v1/federation/live?hours=24`);
      setData(await r.json());
    } catch { /* noop */ }
  }, []);
  useEffect(() => { load(); const t = setInterval(load, 8000); return () => clearInterval(t); }, [load]);

  const { institutions, transactions, totals } = data;
  if (totals.transactions === 0) return null;  // 연합 미사용 시 대시보드에서 숨김

  return (
    <div className="border border-slate-800 bg-slate-900/30 rounded-lg overflow-hidden">
      <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between">
        <h3 className="text-[10px] uppercase tracking-wider text-slate-500 font-medium">
          Federation — 기관 간 연합
        </h3>
        <span className="text-[10px] text-slate-600 tabular-nums">
          기관 {totals.institutions} · 트랜잭션 {totals.transactions} · 성공 {totals.success}
        </span>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[340px_1fr] gap-0">
        {/* 좌: 토폴로지 */}
        <div className="p-3 border-b lg:border-b-0 lg:border-r border-slate-800/60">
          <Topology institutions={institutions} />
          <div className="flex justify-center gap-4 text-[9px] text-slate-600 mt-1">
            <span><span className="text-emerald-400">●</span> 정상</span>
            <span><span className="text-rose-400">●</span> 오류 발생</span>
            <span>─ 실선: 최근 2분 내 활성</span>
          </div>
        </div>

        {/* 우: 트랜잭션 피드 */}
        <div className="p-3">
          <div className="grid grid-cols-[64px_minmax(0,0.7fr)_minmax(0,1.2fr)_56px_56px] gap-2
                          text-[9px] uppercase tracking-wider text-slate-600 pb-1.5">
            <span>Time</span><span>기관</span><span>Agent</span>
            <span className="text-right">소요</span><span className="text-right">상태</span>
          </div>
          <div className="divide-y divide-slate-800/40 max-h-52 overflow-y-auto pr-1">
            {transactions.slice(0, 20).map((t, i) => {
              const color = PEER_COLORS[institutions.findIndex(p => p.peer_id === t.peer_id) % PEER_COLORS.length] || '#94a3b8';
              return (
                <div key={i} title={t.preview}
                     className="grid grid-cols-[64px_minmax(0,0.7fr)_minmax(0,1.2fr)_56px_56px] gap-2
                                items-center py-[6px] text-[11px] hover:bg-slate-800/30 -mx-1 px-1 rounded-sm">
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
    </div>
  );
}

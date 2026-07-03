'use client';

/**
 * FeedbackTab — 사용자 피드백(👍/👎) 모니터링.
 *
 * 데이터: /api/v1/feedback/stats (에이전트별) + /api/v1/feedback (최근 목록).
 * 피드백은 드문 이벤트라 짧은 기간엔 비어 보이기 쉬움 → 자체 기간 토글(기본 전체)로
 * 데이터에 항상 접근 가능하게 하고, 빈 기간이면 그 사실을 명시한다.
 */

import { useState, useEffect, useCallback } from 'react';

const API = process.env.NEXT_PUBLIC_PULSE_API || 'http://localhost:8095';

const RANGES: Array<{ id: string; label: string }> = [
  { id: '24h', label: '24시간' },
  { id: '7d', label: '7일' },
  { id: '30d', label: '30일' },
  { id: 'all', label: '전체' },
];

interface Stat { agent_id: string; total: number; positive: number; negative: number; satisfaction: number; }
interface Fb { id: string; agent_id: string; rating: number; comment?: string; query?: string; created_at?: string; }

function fmtDate(iso?: string): string {
  if (!iso) return '';
  try { return new Date(iso).toLocaleString('ko', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }); }
  catch { return iso.slice(0, 16); }
}

function Kpi({ label, value, sub, accent }: { label: string; value: string; sub: string; accent?: string }) {
  return (
    <div className="border border-slate-800 bg-slate-900/30 rounded-lg px-4 py-3.5">
      <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-1.5 font-medium">{label}</div>
      <div className={`text-2xl font-semibold tabular-nums tracking-tight ${accent || 'text-slate-100'}`}>{value}</div>
      <div className="text-[11px] text-slate-500 mt-1">{sub}</div>
    </div>
  );
}

export function FeedbackTab() {
  const [range, setRange] = useState<string>('all');
  const [stats, setStats] = useState<Stat[]>([]);
  const [recent, setRecent] = useState<Fb[]>([]);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(() => {
    Promise.all([
      fetch(`${API}/api/v1/feedback/stats?period=${range}`).then(r => r.json()).catch(() => []),
      fetch(`${API}/api/v1/feedback?period=${range}&limit=30`).then(r => r.json()).catch(() => []),
    ]).then(([s, r]) => {
      setStats(Array.isArray(s) ? s : []);
      setRecent(Array.isArray(r) ? r : []);
    }).finally(() => setLoaded(true));
  }, [range]);
  useEffect(() => { setLoaded(false); load(); }, [load]);

  const pos = stats.reduce((s, a) => s + a.positive, 0);
  const neg = stats.reduce((s, a) => s + a.negative, 0);
  const total = pos + neg;
  const satPct = total > 0 ? Math.round((pos / total) * 100) : null;
  const posFrac = total > 0 ? pos / total : 0;

  return (
    <div className="space-y-4">
      {/* 헤더 + 기간 토글 */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-sm font-semibold text-slate-100">사용자 피드백</h2>
          <p className="text-[12px] text-slate-500 mt-0.5">채팅 응답에 대한 👍/👎 평가 — 자율 학습 루프의 신호로 사용됩니다.</p>
        </div>
        <div className="flex gap-1 border border-slate-800 rounded-lg p-0.5 bg-slate-900/40">
          {RANGES.map(r => (
            <button key={r.id} onClick={() => setRange(r.id)}
                    className={`text-[11px] px-2.5 py-1 rounded transition-colors ${
                      range === r.id ? 'bg-indigo-500/20 text-indigo-200' : 'text-slate-500 hover:text-slate-300'}`}>
              {r.label}
            </button>
          ))}
        </div>
      </div>

      {/* 만족도 게이지 + KPI */}
      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)] gap-3">
        <div className="border border-slate-800 bg-slate-900/30 rounded-lg px-4 py-3.5">
          <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-1.5 font-medium">전체 만족도</div>
          {total > 0 ? (
            <>
              <div className={`text-3xl font-semibold tabular-nums tracking-tight ${
                satPct! >= 80 ? 'text-emerald-300' : satPct! >= 50 ? 'text-amber-300' : 'text-rose-300'}`}>{satPct}%</div>
              <div className="mt-2 h-2 rounded-full overflow-hidden flex bg-slate-800">
                <div className="bg-emerald-400/80 h-full" style={{ width: `${posFrac * 100}%` }} />
                <div className="bg-rose-400/80 h-full" style={{ width: `${(1 - posFrac) * 100}%` }} />
              </div>
              <div className="flex justify-between text-[11px] text-slate-500 mt-1 tabular-nums">
                <span className="text-emerald-400">👍 {pos}</span>
                <span>{total}건 평가</span>
                <span className="text-rose-400">👎 {neg}</span>
              </div>
            </>
          ) : (
            <div className="text-2xl font-semibold text-slate-600 mt-1">—</div>
          )}
        </div>
        <Kpi label="긍정" value={pos.toLocaleString()} sub="👍 좋아요" accent="text-emerald-300" />
        <Kpi label="부정" value={neg.toLocaleString()} sub="👎 개선 필요" accent={neg > 0 ? 'text-rose-300' : 'text-slate-100'} />
      </div>

      {/* 에이전트별 만족도 */}
      <div className="border border-slate-800 bg-slate-900/30 rounded-lg overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-800">
          <h3 className="text-[10px] uppercase tracking-wider text-slate-500 font-medium">에이전트별 만족도</h3>
        </div>
        <div className="p-4">
          {stats.length === 0 ? (
            <EmptyState loaded={loaded} range={range} onShowAll={() => setRange('all')} />
          ) : (
            <div className="space-y-2">
              {[...stats].sort((a, b) => b.total - a.total).map(s => {
                const pct = Math.round(s.satisfaction * 100);
                const bar = s.satisfaction >= 0.8 ? 'bg-emerald-400/70' : s.satisfaction >= 0.5 ? 'bg-amber-400/70' : 'bg-rose-400/70';
                return (
                  <div key={s.agent_id} className="grid grid-cols-[minmax(0,1.3fr)_minmax(0,1.5fr)_44px_70px] gap-3 items-center text-[11px]">
                    <span className="text-slate-300 truncate font-mono">{s.agent_id.replace(/_agent$/, '')}</span>
                    <span className="bg-slate-800/60 rounded h-1.5 overflow-hidden">
                      <span className={`block h-full rounded ${bar}`} style={{ width: `${pct}%` }} />
                    </span>
                    <span className="text-slate-400 tabular-nums text-right">{pct}%</span>
                    <span className="tabular-nums text-right">
                      <span className="text-emerald-400">+{s.positive}</span> <span className="text-rose-400">−{s.negative}</span>
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* 최근 피드백 */}
      <div className="border border-slate-800 bg-slate-900/30 rounded-lg overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between">
          <h3 className="text-[10px] uppercase tracking-wider text-slate-500 font-medium">최근 피드백</h3>
          <span className="text-[10px] text-slate-600 tabular-nums">{recent.length}건</span>
        </div>
        <div className="max-h-96 overflow-auto">
          {recent.length === 0 ? (
            <div className="py-2"><EmptyState loaded={loaded} range={range} onShowAll={() => setRange('all')} /></div>
          ) : recent.map(f => (
            <div key={f.id} className="flex items-start gap-3 text-xs px-4 py-2.5 border-t border-slate-800/40">
              <span className="text-base leading-none mt-0.5">{f.rating > 0 ? '👍' : '👎'}</span>
              <div className="flex-1 min-w-0">
                <div className="flex items-baseline gap-2">
                  <span className="text-slate-200 font-medium font-mono text-[11px]">{f.agent_id.replace(/_agent$/, '')}</span>
                  {f.query && <span className="text-slate-500 truncate">{f.query}</span>}
                </div>
                {f.comment && <div className="text-slate-500 mt-0.5">"{f.comment}"</div>}
              </div>
              <span className="text-slate-600 tabular-nums shrink-0 font-mono text-[11px]">{fmtDate(f.created_at)}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// 빈 상태 — 왜 비었는지 명시하고 전체 기간으로 유도
function EmptyState({ loaded, range, onShowAll }: { loaded: boolean; range: string; onShowAll: () => void }) {
  if (!loaded) return <div className="text-xs text-slate-600 text-center py-8">불러오는 중…</div>;
  const rangeLabel = RANGES.find(r => r.id === range)?.label || range;
  return (
    <div className="text-center py-8 px-4">
      <div className="text-xs text-slate-500 mb-1">
        {range === 'all' ? '아직 피드백이 없습니다' : `최근 ${rangeLabel}에 피드백이 없습니다`}
      </div>
      <div className="text-[11px] text-slate-600 leading-relaxed max-w-md mx-auto">
        {range === 'all'
          ? '채팅 응답의 👍/👎 버튼을 누르면 여기에 집계됩니다.'
          : '피드백은 드물게 발생하므로 짧은 기간엔 비어 보일 수 있습니다. '}
        {range !== 'all' && (
          <button onClick={onShowAll} className="text-indigo-300 hover:text-indigo-200 underline underline-offset-2">
            전체 기간 보기
          </button>
        )}
      </div>
    </div>
  );
}

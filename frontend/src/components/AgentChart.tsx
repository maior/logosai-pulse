'use client';

/**
 * Agent Activity & Reliability — 랭킹 리스트 (막대 = 호출량, 상태점+숫자 = 성공률).
 *
 * 이전 버전은 성공률(대부분 95~100%)을 0-100 막대로 그려 모든 막대가 풀렝스였다 —
 * 길이가 정보를 못 준다. 막대는 실제로 크기 비교가 되는 호출량에 쓰고,
 * 성공률은 임계 기반 상태(●)와 숫자로 표기한다. 상태색은 항상 숫자 라벨 동반.
 */

interface Agent {
  agent_id: string;
  agent_name: string;
  total_calls: number;
  success_rate: number;
  avg_duration_ms: number;
  error_count?: number;
}

function rateStatus(pct: number): { dot: string; text: string; label: string } {
  if (pct >= 95) return { dot: 'bg-emerald-400', text: 'text-slate-200', label: '정상' };
  if (pct >= 80) return { dot: 'bg-amber-400', text: 'text-amber-300', label: '주의' };
  return { dot: 'bg-rose-400', text: 'text-rose-300', label: '위험' };
}

function fmtMs(ms: number): string {
  if (!ms) return '—';
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.round(ms)}ms`;
}

export function AgentChart({ agents }: { agents: Agent[] }) {
  const rows = [...(agents || [])]
    .sort((a, b) => (b.total_calls || 0) - (a.total_calls || 0))
    .slice(0, 10)
    .map(a => ({
      id: a.agent_id,
      name: a.agent_id.replace(/_agent$/, ''),
      calls: a.total_calls || 0,
      rate: Math.round((a.success_rate || 0) * 100),
      errors: a.error_count || 0,
      avgMs: a.avg_duration_ms || 0,
    }));
  const maxCalls = Math.max(...rows.map(r => r.calls), 1);

  return (
    <div className="border border-slate-800 bg-slate-900/30 rounded-lg overflow-hidden">
      <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between">
        <h3 className="text-[10px] uppercase tracking-wider text-slate-500 font-medium">
          Agent Activity &amp; Reliability
        </h3>
        <span className="text-[10px] text-slate-600">호출량 순 · top {rows.length}</span>
      </div>

      {/* 컬럼 헤더 */}
      <div className="px-4 pt-3 grid grid-cols-[minmax(0,1.1fr)_minmax(0,1.6fr)_72px_52px_56px] gap-3
                      text-[9px] uppercase tracking-wider text-slate-600">
        <span>Agent</span><span>Calls</span>
        <span className="text-right">Success</span>
        <span className="text-right">Err</span>
        <span className="text-right">Avg</span>
      </div>

      <div className="px-4 pb-4 pt-1">
        {rows.length === 0 ? (
          <div className="h-48 flex items-center justify-center text-slate-600 text-xs">No data</div>
        ) : (
          <div className="divide-y divide-slate-800/40">
            {rows.map(r => {
              const st = rateStatus(r.rate);
              return (
                <div key={r.id}
                     title={`${r.id} — ${r.calls} calls · ${r.rate}% (${st.label}) · errors ${r.errors} · avg ${fmtMs(r.avgMs)}`}
                     className="grid grid-cols-[minmax(0,1.1fr)_minmax(0,1.6fr)_72px_52px_56px] gap-3
                                items-center py-[7px] hover:bg-slate-800/30 rounded-sm -mx-1 px-1">
                  {/* 이름 — 잉크 토큰 (시리즈색 미사용) */}
                  <span className="text-[11px] font-mono text-slate-300 truncate">{r.name}</span>

                  {/* 호출량 막대 — 단일 hue, thin, rounded data-end, 값 직접 라벨 */}
                  <div className="flex items-center gap-2 min-w-0">
                    <div className="h-[6px] rounded-r-[3px] bg-indigo-400/85"
                         style={{ width: `${Math.max((r.calls / maxCalls) * 100, 2)}%` }} />
                    <span className="text-[10px] tabular-nums text-slate-500 shrink-0">{r.calls}</span>
                  </div>

                  {/* 성공률 — 상태점 + 숫자 (색만으로 전달 금지) */}
                  <span className="flex items-center justify-end gap-1.5">
                    <span className={`inline-block w-1.5 h-1.5 rounded-full ${st.dot}`} />
                    <span className={`text-[11px] tabular-nums ${st.text}`}>{r.rate}%</span>
                  </span>

                  {/* 오류 수 */}
                  <span className={`text-[11px] tabular-nums text-right ${r.errors > 0 ? 'text-rose-300' : 'text-slate-600'}`}>
                    {r.errors || '·'}
                  </span>

                  {/* 평균 응답 */}
                  <span className="text-[11px] tabular-nums text-right text-slate-500">{fmtMs(r.avgMs)}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* 상태 범례 — 색+라벨 동반 */}
      <div className="px-4 pb-3 flex gap-4 text-[9px] text-slate-600">
        <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-emerald-400 inline-block" />≥95% 정상</span>
        <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-amber-400 inline-block" />80–95% 주의</span>
        <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-rose-400 inline-block" />&lt;80% 위험</span>
      </div>
    </div>
  );
}

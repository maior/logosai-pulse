'use client';

/**
 * DecisionsTab — 온톨로지 에이전트 선택 근거.
 *
 * Pulse 의 다른 탭이 "무엇이 실행됐나"라면 여기는 "왜 그 에이전트가 선택됐나"다.
 * 데이터 원천: 온톨로지 HybridAgentSelector 가 남기는 selector_stats.json
 *   (GET /api/v1/decisions, /stats, /export)
 *
 * 구성:
 *   1) KPI — 선택 방식 분포 / GNN+RL 채택률 / 라벨 비율 / 성공률
 *   2) 결정 목록 — 클릭 시 근거 체인(그래프 엔티티 · 과거 패턴 점수 · 자연어 reasoning)
 *   3) 학습 데이터 — (features, action, reward) 추출 현황
 *
 * 색 규칙(dataviz): 성공/실패는 status 토큰(emerald/rose) + 숫자 동반,
 *   선택 방식은 categorical 이되 항상 라벨 동반.
 */

import { Fragment, useEffect, useState, useCallback } from 'react';

const API = process.env.NEXT_PUBLIC_PULSE_API || 'http://localhost:8095';

const OK = '#34d399';
const BAD = '#fb7185';
const WARN = '#f59e0b';

interface Evidence {
  agent: string; pattern: string; success_rate: number;
  usage_count: number; match_score: number; final_score: number; last_used: string;
}
interface Decision {
  timestamp: string; query: string; selected_agent: string; method: string;
  confidence: number; elapsed_ms: number; reasoning: string;
  entities: string[]; related_concepts: string[];
  recommended_agents: unknown[]; kg_confidence: number;
  evidence: Evidence[];
  outcome: { success: boolean | null; semantics: Record<string, unknown> };
}
interface Stats {
  total: number; by_method: Record<string, number>;
  labeled: number; labeled_ratio: number; success_rate: number | null;
  avg_confidence: number; avg_elapsed_ms: number;
  gnn_rl: { selections: number; fallback: number; adoption_rate: number };
  totals: { total_selections: number; graph_assisted: number; llm_only: number };
}

function Metric({ label, value, hint, tone }: {
  label: string; value: string; hint?: string; tone?: string;
}) {
  return (
    <div className="rounded-lg border border-neutral-800 bg-neutral-900/40 px-3 py-2.5">
      <div className="text-[10px] uppercase tracking-wide text-neutral-500">{label}</div>
      <div className="mt-1 text-lg font-semibold tabular-nums" style={tone ? { color: tone } : undefined}>
        {value}
      </div>
      {hint && <div className="mt-0.5 text-[10px] text-neutral-500">{hint}</div>}
    </div>
  );
}

export function DecisionsTab() {
  const [decisions, setDecisions] = useState<Decision[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [exportInfo, setExportInfo] = useState<{ labeled: number; unlabeled: number } | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [methodFilter, setMethodFilter] = useState('');
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    try {
      const q = methodFilter ? `&method=${encodeURIComponent(methodFilter)}` : '';
      const [d, s, e] = await Promise.all([
        fetch(`${API}/api/v1/decisions?limit=50${q}`).then((r) => r.json()),
        fetch(`${API}/api/v1/decisions/stats`).then((r) => r.json()),
        fetch(`${API}/api/v1/decisions/export?limit=1`).then((r) => r.json()),
      ]);
      setDecisions(d.decisions || []);
      setStats(s);
      setExportInfo({ labeled: e.labeled || 0, unlabeled: e.unlabeled || 0 });
    } catch {
      setDecisions([]);
    } finally {
      setLoading(false);
    }
  }, [methodFilter]);

  useEffect(() => { fetchData(); }, [fetchData]);

  if (loading) return <div className="py-16 text-center text-sm text-neutral-500">불러오는 중…</div>;

  if (!stats || stats.total === 0) {
    return (
      <div className="py-16 text-center text-sm text-neutral-500">
        선택 이력이 없습니다.
        <div className="mt-1 text-[11px] text-neutral-600">
          온톨로지 selector_stats.json 을 찾을 수 없거나 비어 있습니다.
        </div>
      </div>
    );
  }

  const adoption = stats.gnn_rl.adoption_rate;

  return (
    <div className="space-y-5">
      {/* 1) KPI */}
      <div className="grid grid-cols-2 gap-2.5 md:grid-cols-5">
        <Metric label="누적 선택" value={String(stats.totals.total_selections)}
                hint={`최근 ${stats.total}건 분석`} />
        <Metric label="GNN+RL 채택률" value={`${(adoption * 100).toFixed(1)}%`}
                hint={`fallback ${stats.gnn_rl.fallback}회`}
                tone={adoption === 0 ? BAD : adoption < 0.3 ? WARN : OK} />
        <Metric label="성공률" value={stats.success_rate === null ? '—' : `${(stats.success_rate * 100).toFixed(0)}%`}
                hint={`라벨 ${stats.labeled}건 기준`} tone={OK} />
        <Metric label="라벨 비율" value={`${(stats.labeled_ratio * 100).toFixed(0)}%`}
                hint="학습 가능 비중" />
        <Metric label="평균 선택 시간" value={`${(stats.avg_elapsed_ms / 1000).toFixed(1)}s`} />
      </div>

      {/* GNN+RL 미채택 경고 — 학습은 도는데 실제 선택엔 안 쓰이는 상태 */}
      {adoption === 0 && stats.gnn_rl.fallback > 0 && (
        <div className="rounded-lg border px-3 py-2.5 text-xs"
             style={{ borderColor: '#7f1d1d', background: 'rgba(127,29,29,0.15)' }}>
          <span className="font-medium" style={{ color: BAD }}>GNN+RL 이 한 번도 채택되지 않았습니다</span>
          <span className="ml-2 text-neutral-400">
            학습된 가중치가 있지만 신뢰도 임계값을 넘지 못해 {stats.gnn_rl.fallback}회 모두 fallback 했습니다.
          </span>
        </div>
      )}

      {/* 선택 방식 분포 */}
      <div className="flex flex-wrap items-center gap-2">
        <button onClick={() => setMethodFilter('')}
                className={`rounded px-2.5 py-1 text-[11px] transition-colors ${
                  methodFilter === '' ? 'bg-neutral-700 text-neutral-100' : 'bg-neutral-900 text-neutral-400'}`}>
          전체 {stats.total}
        </button>
        {Object.entries(stats.by_method).map(([m, n]) => (
          <button key={m} onClick={() => setMethodFilter(m)}
                  className={`rounded px-2.5 py-1 text-[11px] transition-colors ${
                    methodFilter === m ? 'bg-neutral-700 text-neutral-100' : 'bg-neutral-900 text-neutral-400'}`}>
            {m} {n}
          </button>
        ))}
      </div>

      {/* 2) 결정 목록 + 근거 체인 */}
      <div className="overflow-x-auto rounded-lg border border-neutral-800">
        <table className="w-full text-xs">
          <thead className="bg-neutral-900/60 text-neutral-500">
            <tr>
              <th className="px-3 py-2 text-left font-medium">시각</th>
              <th className="px-3 py-2 text-left font-medium">쿼리</th>
              <th className="px-3 py-2 text-left font-medium">선택된 에이전트</th>
              <th className="px-3 py-2 text-left font-medium">방식</th>
              <th className="px-3 py-2 text-right font-medium">KG 신뢰도</th>
              <th className="px-3 py-2 text-right font-medium">결과</th>
            </tr>
          </thead>
          <tbody>
            {decisions.map((d, i) => (
              <Fragment key={i}>
                <tr onClick={() => setSelected(selected === i ? null : i)}
                    className="cursor-pointer border-t border-neutral-800/60 hover:bg-neutral-900/40">
                  <td className="px-3 py-2 text-neutral-500 tabular-nums">
                    {d.timestamp.slice(5, 16).replace('T', ' ')}
                  </td>
                  <td className="max-w-xs truncate px-3 py-2 text-neutral-300">{d.query}</td>
                  <td className="px-3 py-2 font-medium text-neutral-200">{d.selected_agent}</td>
                  <td className="px-3 py-2 text-neutral-400">{d.method}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-neutral-300">
                    {d.kg_confidence.toFixed(2)}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {d.outcome.success === null
                      ? <span className="text-neutral-600">라벨 없음</span>
                      : <span style={{ color: d.outcome.success ? OK : BAD }}>
                          {d.outcome.success ? '성공' : '실패'}
                        </span>}
                  </td>
                </tr>
                {selected === i && (
                  <tr className="border-t border-neutral-800/60 bg-neutral-950/60">
                    <td colSpan={6} className="px-4 py-3">
                      <div className="space-y-3">
                        <div>
                          <div className="text-[10px] uppercase tracking-wide text-neutral-500">추출된 개념</div>
                          <div className="mt-1 flex flex-wrap gap-1.5">
                            {d.entities.length === 0 && <span className="text-[11px] text-neutral-600">없음</span>}
                            {d.entities.map((e) => (
                              <span key={e} className="rounded bg-neutral-800 px-1.5 py-0.5 text-[11px] text-neutral-300">{e}</span>
                            ))}
                          </div>
                        </div>

                        <div>
                          <div className="text-[10px] uppercase tracking-wide text-neutral-500">
                            과거 패턴 근거 ({d.evidence.length})
                          </div>
                          {d.evidence.length === 0 ? (
                            <div className="mt-1 text-[11px] text-neutral-600">일치하는 과거 패턴 없음</div>
                          ) : (
                            <table className="mt-1 w-full text-[11px]">
                              <thead className="text-neutral-600">
                                <tr>
                                  <th className="py-1 text-left font-normal">패턴</th>
                                  <th className="py-1 text-left font-normal">에이전트</th>
                                  <th className="py-1 text-right font-normal">성공률</th>
                                  <th className="py-1 text-right font-normal">사용</th>
                                  <th className="py-1 text-right font-normal">점수</th>
                                </tr>
                              </thead>
                              <tbody>
                                {d.evidence.map((ev, j) => (
                                  <tr key={j} className="text-neutral-400">
                                    <td className="py-0.5">{ev.pattern || '—'}</td>
                                    <td className="py-0.5">{ev.agent}</td>
                                    <td className="py-0.5 text-right tabular-nums"
                                        style={{ color: ev.success_rate >= 0.8 ? OK : WARN }}>
                                      {(ev.success_rate * 100).toFixed(0)}%
                                    </td>
                                    <td className="py-0.5 text-right tabular-nums">{ev.usage_count}</td>
                                    <td className="py-0.5 text-right tabular-nums text-neutral-300">
                                      {ev.final_score.toFixed(2)}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          )}
                        </div>

                        <div>
                          <div className="text-[10px] uppercase tracking-wide text-neutral-500">선택 이유</div>
                          <p className="mt-1 whitespace-pre-wrap text-[11px] leading-relaxed text-neutral-400">
                            {d.reasoning || '기록 없음'}
                          </p>
                        </div>

                        <div className="text-[10px] text-neutral-600">
                          선택 소요 {(d.elapsed_ms / 1000).toFixed(1)}s · confidence {d.confidence.toFixed(3)}
                        </div>
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>

      {/* 3) 학습 데이터 추출 현황 */}
      {exportInfo && (
        <div className="rounded-lg border border-neutral-800 bg-neutral-900/40 px-3 py-2.5 text-[11px]">
          <span className="text-neutral-300">학습 데이터</span>
          <span className="ml-2 text-neutral-500">
            라벨 {exportInfo.labeled}건 · 미라벨 {exportInfo.unlabeled}건 —
            <code className="ml-1 text-neutral-400">GET /api/v1/decisions/export</code>
            <span className="ml-1">(features, action, reward)</span>
          </span>
        </div>
      )}
    </div>
  );
}

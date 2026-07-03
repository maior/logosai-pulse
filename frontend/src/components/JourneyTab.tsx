'use client';

/**
 * JourneyTab — 쿼리 여정 시각화.
 *
 * 좌측: 최근 실행 목록(선택). 우측: 선택한 trace의 여정 —
 *   1) 단계 진행바 (유입→분석·판단→실행→하네스→대화→통합)
 *   2) 에이전트 스윔레인 타임라인 (실측 offset 기반)
 *   3) 에이전트 간 대화 (caller→callee 말풍선)
 * 데이터: GET /api/v1/traces/{trace_id}/journey
 */

import { useState, useEffect, useCallback } from 'react';

const API = process.env.NEXT_PUBLIC_PULSE_API || 'http://localhost:8095';

const STAGE_TONE: Record<string, string> = {
  ingress: 'bg-sky-500/80',
  plan: 'bg-violet-500/80',
  route: 'bg-slate-500/80',
  agent: 'bg-indigo-500/80',
  harness_react: 'bg-fuchsia-500/80',
  harness_tool: 'bg-teal-500/80',
  harness_plan: 'bg-fuchsia-400/80',
  a2a_call: 'bg-amber-500/80',
  llm: 'bg-cyan-500/80',
  external: 'bg-orange-500/80',
  integrate: 'bg-emerald-500/80',
};

const STAGE_TEXT: Record<string, string> = {
  ingress: 'text-sky-400', plan: 'text-violet-400', route: 'text-slate-400',
  agent: 'text-indigo-400', harness_react: 'text-fuchsia-400',
  harness_tool: 'text-teal-400', harness_plan: 'text-fuchsia-300',
  a2a_call: 'text-amber-400', llm: 'text-cyan-400',
  external: 'text-orange-400', integrate: 'text-emerald-400',
};

interface JourneySpan {
  id: string; name: string; stage: string; status: string;
  offset_ms: number; duration_ms: number; input: string; output: string;
  metadata: Record<string, unknown>;
}
interface Journey {
  trace_id: string; query: string; total_duration_ms: number; started_at: string | null;
  stages: Array<{ stage: string; label: string; count: number; duration_ms: number; status: string }>;
  lanes: Array<{ agent_id: string; spans: JourneySpan[]; total_ms: number }>;
  conversations: Array<{ seq: number; caller: string; callee: string; query: string;
    answer: string; status: string; offset_ms: number; duration_ms: number }>;
  counts: Record<string, number>;
  error?: string;
}

export function JourneyTab({ period }: { period: string }) {
  const [traces, setTraces] = useState<any[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [journey, setJourney] = useState<Journey | null>(null);
  const [detail, setDetail] = useState<JourneySpan | null>(null);
  const [loading, setLoading] = useState(false);

  const loadTraces = useCallback(async () => {
    try {
      const res = await fetch(`${API}/api/v1/traces?period=${period}&limit=30`);
      const data = await res.json();
      setTraces(data.traces || data || []);
    } catch { /* noop */ }
  }, [period]);

  useEffect(() => { loadTraces(); const t = setInterval(loadTraces, 10000); return () => clearInterval(t); }, [loadTraces]);

  const loadJourney = useCallback(async (traceId: string) => {
    setLoading(true); setDetail(null);
    try {
      const res = await fetch(`${API}/api/v1/traces/${traceId}/journey`);
      setJourney(await res.json());
    } catch { setJourney(null); }
    setLoading(false);
  }, []);

  useEffect(() => { if (selected) loadJourney(selected); }, [selected, loadJourney]);

  const total = journey?.total_duration_ms || 1;

  return (
    <div className="grid grid-cols-12 gap-4">
      {/* 좌: 실행 목록 */}
      <div className="col-span-3 bg-slate-900/30 border border-slate-800 rounded-lg overflow-hidden">
        <div className="px-3 py-2 text-[10px] uppercase tracking-wider text-slate-500 border-b border-slate-800">
          Recent Executions
        </div>
        <div className="max-h-[70vh] overflow-y-auto divide-y divide-slate-800/60">
          {traces.map((t: any) => {
            const tid = t.metadata?.trace_id || t.id;
            return (
              <button key={t.id} onClick={() => setSelected(tid)}
                className={`w-full text-left px-3 py-2 hover:bg-slate-800/40 ${selected === tid ? 'bg-slate-800/60' : ''}`}>
                <div className="text-xs text-slate-300 truncate">{t.query || t.agent_id}</div>
                <div className="text-[10px] text-slate-500 font-mono tabular-nums">
                  {t.agent_id} · {Math.round(t.duration_ms || 0)}ms
                  {t.success === false && <span className="text-rose-400"> · error</span>}
                </div>
              </button>
            );
          })}
          {traces.length === 0 && (
            <div className="px-3 py-6 text-xs text-slate-600">실행 기록이 없습니다</div>
          )}
        </div>
      </div>

      {/* 우: 여정 */}
      <div className="col-span-9 space-y-4">
        {!journey && (
          <div className="bg-slate-900/30 border border-slate-800 rounded-lg p-10 text-center text-sm text-slate-500">
            {loading ? '불러오는 중…' : '좌측에서 실행을 선택하면 쿼리 여정이 표시됩니다'}
          </div>
        )}

        {journey && journey.stages.length === 0 && (
          <div className="bg-slate-900/30 border border-slate-800 rounded-lg p-10 text-center text-sm text-slate-500">
            이 실행에는 span이 없습니다 (계측 이전 기록이거나 trace_id 미연결)
          </div>
        )}

        {journey && journey.stages.length > 0 && (
          <>
            {/* 헤더: 쿼리 + 집계 */}
            <div className="bg-slate-900/30 border border-slate-800 rounded-lg p-4">
              <div className="text-sm text-slate-200">{journey.query || '(쿼리 미기록)'}</div>
              <div className="mt-1 text-[11px] text-slate-500 font-mono tabular-nums">
                {Math.round(journey.total_duration_ms)}ms 총 소요
                · 에이전트 {journey.counts.agents} · 대화 {journey.counts.a2a_calls}
                · LLM {journey.counts.llm_calls} · 도구 {journey.counts.tool_calls}
                {journey.counts.errors > 0 && <span className="text-rose-400"> · 오류 {journey.counts.errors}</span>}
              </div>

              {/* 단계 진행바 */}
              <div className="mt-3 flex flex-wrap gap-1.5">
                {journey.stages.map(st => (
                  <div key={st.stage}
                    className={`px-2.5 py-1 rounded text-[11px] border border-slate-700/60
                      ${st.status === 'error' ? 'bg-rose-950/50 text-rose-300' : 'bg-slate-800/50'}`}>
                    <span className={STAGE_TEXT[st.stage] || 'text-slate-300'}>{st.label}</span>
                    <span className="ml-1.5 text-slate-500 font-mono tabular-nums">
                      {st.count > 1 ? `×${st.count} ` : ''}{Math.round(st.duration_ms)}ms
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* 스윔레인 타임라인 */}
            <div className="bg-slate-900/30 border border-slate-800 rounded-lg p-4">
              <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-3">
                Agent Timeline <span className="normal-case">— 실측 시각 기반, 막대 클릭 시 상세</span>
              </div>
              <div className="space-y-2">
                {journey.lanes.map(lane => (
                  <div key={lane.agent_id} className="flex items-center gap-2">
                    <div className="w-44 shrink-0 text-xs text-slate-400 truncate text-right pr-1 font-mono">
                      {lane.agent_id}
                    </div>
                    <div className="relative flex-1 h-6 bg-slate-950/60 rounded border border-slate-800/60">
                      {lane.spans.map(sp => (
                        <button key={sp.id} onClick={() => setDetail(sp)}
                          title={`${sp.name} (${Math.round(sp.duration_ms)}ms)`}
                          className={`absolute top-0.5 h-5 rounded-sm ${sp.status === 'error' ? 'bg-rose-500/90' : (STAGE_TONE[sp.stage] || 'bg-slate-600/80')} hover:ring-1 hover:ring-white/50`}
                          style={{
                            left: `${(sp.offset_ms / total) * 100}%`,
                            width: `${Math.max((sp.duration_ms / total) * 100, 0.6)}%`,
                          }} />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
              {/* 범례 */}
              <div className="mt-3 flex flex-wrap gap-3 text-[10px] text-slate-500">
                {Object.entries(STAGE_TONE).map(([k, v]) => (
                  <span key={k} className="flex items-center gap-1">
                    <span className={`inline-block w-2.5 h-2.5 rounded-sm ${v}`} />{k}
                  </span>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              {/* 에이전트 간 대화 */}
              <div className="bg-slate-900/30 border border-slate-800 rounded-lg p-4">
                <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-3">
                  Agent ↔ Agent Conversations
                </div>
                {journey.conversations.length === 0 && (
                  <div className="text-xs text-slate-600 py-4">
                    이 실행에는 에이전트 간 직접 대화가 없습니다 (단일 에이전트 처리)
                  </div>
                )}
                <div className="space-y-3 max-h-96 overflow-y-auto pr-1">
                  {journey.conversations.map(c => (
                    <div key={c.seq} className="border border-slate-800/70 rounded-md p-2.5 bg-slate-950/40">
                      <div className="flex items-center gap-2 text-[11px] font-mono">
                        <span className="text-indigo-300">{c.caller}</span>
                        <span className="text-slate-600">→</span>
                        <span className="text-amber-300">{c.callee}</span>
                        <span className="ml-auto text-slate-500 tabular-nums">
                          +{Math.round(c.offset_ms)}ms · {Math.round(c.duration_ms)}ms
                        </span>
                      </div>
                      <div className="mt-2 space-y-1.5">
                        <div className="text-xs bg-indigo-950/40 border border-indigo-900/40 rounded px-2 py-1.5 text-slate-300">
                          {c.query || '(요청 미기록)'}
                        </div>
                        <div className={`text-xs rounded px-2 py-1.5 border ${c.status === 'error'
                          ? 'bg-rose-950/40 border-rose-900/40 text-rose-200'
                          : 'bg-amber-950/30 border-amber-900/30 text-slate-300'}`}>
                          {c.answer || '(응답 미기록)'}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* span 상세 */}
              <div className="bg-slate-900/30 border border-slate-800 rounded-lg p-4">
                <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-3">Span Detail</div>
                {!detail && <div className="text-xs text-slate-600 py-4">타임라인에서 막대를 클릭하세요</div>}
                {detail && (
                  <div className="space-y-2 text-xs">
                    <div className="font-mono text-slate-200">{detail.name}</div>
                    <div className="text-slate-500 font-mono tabular-nums">
                      stage=<span className={STAGE_TEXT[detail.stage]}>{detail.stage}</span>
                      · +{Math.round(detail.offset_ms)}ms · {Math.round(detail.duration_ms)}ms
                      · {detail.status}
                    </div>
                    {detail.input && (
                      <div>
                        <div className="text-slate-500 mb-0.5">input</div>
                        <div className="bg-slate-950/60 border border-slate-800 rounded p-2 text-slate-300 break-all">{detail.input}</div>
                      </div>
                    )}
                    {detail.output && (
                      <div>
                        <div className="text-slate-500 mb-0.5">output</div>
                        <div className="bg-slate-950/60 border border-slate-800 rounded p-2 text-slate-300 break-all">{detail.output}</div>
                      </div>
                    )}
                    {detail.metadata && Object.keys(detail.metadata).length > 0 && (
                      <div>
                        <div className="text-slate-500 mb-0.5">metadata</div>
                        <pre className="bg-slate-950/60 border border-slate-800 rounded p-2 text-slate-400 overflow-x-auto text-[10px]">
                          {JSON.stringify(detail.metadata, null, 2)}
                        </pre>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

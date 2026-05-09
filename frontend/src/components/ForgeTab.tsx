'use client';

import { useEffect, useState, useCallback } from 'react';

const API = process.env.NEXT_PUBLIC_PULSE_API || 'http://localhost:8095';

type Conversation = {
  id: string;
  trace_id: string;
  started_at: string | null;
  ended_at: string | null;
  duration_ms: number | null;
  status: 'running' | 'completed' | 'failed' | 'timeout';
  trigger_query: string;
  session_id: string | null;
  missing_capabilities: string[];
  ws_endpoint: string | null;
  result: {
    generated_agent_id: string | null;
    code_chars: number | null;
    phases_count: number;
    stages_count: number;
  };
  self_evolution: {
    eval_score: number | null;
    admission: string | { decision?: string; message?: string } | null;
    healing_applied: boolean | null;
    growing_patterns_added: number | null;
    quality_score: number | null;
    requires_approval: boolean | null;
    registered: boolean | null;
  };
};

function admissionLabel(a: Conversation['self_evolution']['admission']): string {
  if (a == null) return '—';
  if (typeof a === 'string') return a;
  if (typeof a === 'object') return a.decision || a.message || JSON.stringify(a).slice(0, 30);
  return '—';
}

function admissionAccent(a: Conversation['self_evolution']['admission']): 'good' | 'warn' | 'neutral' {
  const label = admissionLabel(a).toLowerCase();
  if (label === 'passed' || label === 'approved' || label === 'production_admitted') return 'good';
  if (a == null || label === '—') return 'neutral';
  return 'warn';
}

type NegotiationMessage = {
  direction: 'acp_to_forge' | 'forge_to_acp';
  type: string;
  timestamp: number;
  payload: Record<string, unknown> | null;
};

type WorkflowContext = {
  original_query?: string;
  subtask_description?: string;
  missing_capabilities?: string[];
  business_rules?: string[];
  agent_chain?: string[];
  preferred_tools?: string[];
  intent?: string;
  user_email?: string;
  session_id?: string;
};

type Detail = {
  summary: Conversation;
  spans: Array<{
    id: string;
    name: string;
    agent_id: string | null;
    status: string;
    input: string | null;
    output: string | null;
    duration_ms: number | null;
    metadata: Record<string, unknown>;
    started_at: string | null;
    ended_at: string | null;
  }>;
  stages_timeline: Array<{ stage: string; timestamp: number }>;
  phases: string[];
  negotiation_messages?: NegotiationMessage[];
  workflow_context?: WorkflowContext;
  generated_code_preview?: string;
  generated_code_full_chars?: number;
};

const STATUS_TONE: Record<Conversation['status'], { label: string; cls: string; dot: string }> = {
  running:   { label: 'Running',   cls: 'text-amber-300 bg-amber-500/10 border-amber-500/30',    dot: 'bg-amber-400 animate-pulse' },
  completed: { label: 'Completed', cls: 'text-emerald-300 bg-emerald-500/10 border-emerald-500/30', dot: 'bg-emerald-400' },
  failed:    { label: 'Failed',    cls: 'text-rose-300 bg-rose-500/10 border-rose-500/30',          dot: 'bg-rose-400' },
  timeout:   { label: 'Timeout',   cls: 'text-orange-300 bg-orange-500/10 border-orange-500/30',    dot: 'bg-orange-400' },
};

function fmtDuration(ms: number | null): string {
  if (ms == null) return '—';
  if (ms < 1000) return `${ms.toFixed(0)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function fmtTime(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleTimeString('en-US', { hour12: false }) + '.' + String(d.getMilliseconds()).padStart(3, '0');
}

function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  return sameDay ? d.toLocaleTimeString('en-US', { hour12: false }) : d.toLocaleDateString();
}

export function ForgeTab({ period }: { period: string }) {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchList = useCallback(async () => {
    try {
      const r = await fetch(`${API}/api/v1/forge/conversations?period=${period}&limit=50`);
      const data = await r.json();
      setConversations(Array.isArray(data) ? data : []);
    } catch (e) {
      console.error('Failed to fetch forge conversations:', e);
      setConversations([]);
    } finally {
      setLoading(false);
    }
  }, [period]);

  useEffect(() => { fetchList(); }, [fetchList]);

  // Poll every 5s for live updates
  useEffect(() => {
    const t = setInterval(fetchList, 5000);
    return () => clearInterval(t);
  }, [fetchList]);

  useEffect(() => {
    if (!selectedId) { setDetail(null); return; }
    fetch(`${API}/api/v1/forge/conversations/${selectedId}`)
      .then(r => r.json())
      .then(d => setDetail(d.error ? null : d))
      .catch(() => setDetail(null));
  }, [selectedId]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24 text-slate-500 text-sm">
        Loading FORGE conversations…
      </div>
    );
  }

  if (conversations.length === 0) {
    return <ForgeEmptyState />;
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
      {/* Conversation list */}
      <aside className="lg:col-span-5 xl:col-span-4 space-y-2">
        <div className="flex items-center justify-between px-1 mb-1">
          <h3 className="text-xs font-medium text-slate-400 uppercase tracking-wider">
            Conversations <span className="text-slate-600 font-normal normal-case">· {conversations.length}</span>
          </h3>
        </div>
        <div className="space-y-1.5 max-h-[calc(100vh-240px)] overflow-y-auto pr-1">
          {conversations.map((c) => {
            const tone = STATUS_TONE[c.status] || STATUS_TONE.failed;
            const isSelected = selectedId === c.id;
            return (
              <button
                key={c.id}
                onClick={() => setSelectedId(c.id)}
                className={`w-full text-left rounded-md border transition-all p-3 ${
                  isSelected
                    ? 'border-indigo-500/50 bg-indigo-500/[0.07]'
                    : 'border-slate-800 bg-slate-900/30 hover:border-slate-700 hover:bg-slate-900/60'
                }`}
              >
                <div className="flex items-start justify-between gap-3 mb-1.5">
                  <div className={`inline-flex items-center gap-1.5 px-2 py-0.5 text-[10px] font-medium rounded border ${tone.cls}`}>
                    <span className={`w-1 h-1 rounded-full ${tone.dot}`} />
                    {tone.label}
                  </div>
                  <div className="text-[10px] text-slate-500 tabular-nums shrink-0">
                    {fmtDate(c.started_at)} · {fmtDuration(c.duration_ms)}
                  </div>
                </div>
                <div className="text-sm text-slate-200 line-clamp-1 font-medium">
                  {c.result.generated_agent_id || c.missing_capabilities[0] || '—'}
                </div>
                <div className="text-xs text-slate-500 line-clamp-1 mt-0.5">
                  {c.trigger_query || '<no query>'}
                </div>
                {c.missing_capabilities.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-2">
                    {c.missing_capabilities.slice(0, 3).map((cap) => (
                      <span key={cap} className="px-1.5 py-0.5 text-[10px] font-mono rounded bg-slate-800 text-slate-400">
                        {cap}
                      </span>
                    ))}
                    {c.missing_capabilities.length > 3 && (
                      <span className="text-[10px] text-slate-600 px-1">+{c.missing_capabilities.length - 3}</span>
                    )}
                  </div>
                )}
              </button>
            );
          })}
        </div>
      </aside>

      {/* Detail panel */}
      <section className="lg:col-span-7 xl:col-span-8">
        {detail ? (
          <ConversationDetail detail={detail} />
        ) : (
          <div className="border border-slate-800 rounded-lg bg-slate-900/30 py-24 text-center text-slate-500 text-sm">
            Select a conversation on the left to view negotiation timeline.
          </div>
        )}
      </section>
    </div>
  );
}

function ConversationDetail({ detail }: { detail: Detail }) {
  const { summary, spans, stages_timeline, phases } = detail;
  const tone = STATUS_TONE[summary.status] || STATUS_TONE.failed;
  const ev = summary.self_evolution;
  const messages = detail.negotiation_messages || [];
  const wc = detail.workflow_context || {};
  const codePreview = detail.generated_code_preview || '';
  const codeFullChars = detail.generated_code_full_chars || 0;
  const hasBusinessContext = !!(wc.original_query || wc.subtask_description ||
    (wc.business_rules && wc.business_rules.length) ||
    (wc.agent_chain && wc.agent_chain.length));

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="border border-slate-800 rounded-lg bg-slate-900/30 p-4">
        <div className="flex items-start justify-between gap-4 mb-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 mb-1">
              <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 text-[10px] font-medium rounded border ${tone.cls}`}>
                <span className={`w-1 h-1 rounded-full ${tone.dot}`} />
                {tone.label}
              </span>
              <span className="text-[10px] text-slate-500 font-mono truncate">{summary.session_id}</span>
            </div>
            <div className="text-base font-semibold text-slate-100 truncate">
              {summary.result.generated_agent_id || 'Negotiation pending'}
            </div>
          </div>
          <div className="text-right text-xs text-slate-500 tabular-nums shrink-0">
            <div>{fmtTime(summary.started_at)}</div>
            <div className="text-slate-600">{fmtDuration(summary.duration_ms)}</div>
          </div>
        </div>

        <div className="text-xs text-slate-400 leading-relaxed">
          <span className="text-slate-500 mr-2">Trigger:</span>
          <span className="text-slate-300">{summary.trigger_query}</span>
        </div>

        {summary.missing_capabilities.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1">
            <span className="text-[10px] uppercase tracking-wider text-slate-500 mr-2 self-center">Missing</span>
            {summary.missing_capabilities.map((cap) => (
              <span key={cap} className="px-2 py-0.5 text-[11px] font-mono rounded border border-indigo-500/30 bg-indigo-500/10 text-indigo-200">
                {cap}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Self-evolution metrics */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
        <Metric label="Eval Score" value={ev.eval_score != null ? ev.eval_score.toFixed(2) : '—'} accent={ev.eval_score != null && ev.eval_score >= 0.7 ? 'good' : 'neutral'} />
        <Metric label="Quality Score" value={ev.quality_score != null ? ev.quality_score.toFixed(2) : '—'} accent={ev.quality_score != null && ev.quality_score >= 0.7 ? 'good' : 'neutral'} />
        <Metric label="Admission" value={admissionLabel(ev.admission)} accent={admissionAccent(ev.admission)} />
        <Metric label="Healing" value={ev.healing_applied ? 'Applied' : ev.healing_applied === false ? 'No' : '—'} accent={ev.healing_applied ? 'warn' : 'neutral'} />
        <Metric label="Code Size" value={summary.result.code_chars != null ? `${summary.result.code_chars} ch` : '—'} />
        <Metric label="Stages" value={`${summary.result.stages_count} / 9`} accent={summary.result.stages_count >= 9 ? 'good' : 'neutral'} />
        <Metric label="Patterns +" value={ev.growing_patterns_added != null ? String(ev.growing_patterns_added) : '—'} />
        <Metric label="Registered" value={ev.registered === true ? 'Yes' : ev.registered === false ? 'No' : '—'} accent={ev.registered === true ? 'good' : 'neutral'} />
      </div>

      {/* Stages timeline */}
      {stages_timeline.length > 0 && (
        <div className="border border-slate-800 rounded-lg bg-slate-900/30 p-4">
          <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-3">FORGE V6 Stages Timeline</div>
          <div className="space-y-1">
            {stages_timeline.map((s, i) => {
              const prev = i > 0 ? stages_timeline[i - 1].timestamp : s.timestamp;
              const delta = (s.timestamp - prev) * 1000;
              return (
                <div key={i} className="flex items-center gap-3 text-xs font-mono">
                  <span className="text-slate-600 w-6 text-right">{i + 1}</span>
                  <span className="text-slate-200 flex-1 truncate">{s.stage}</span>
                  <span className="text-slate-500 tabular-nums">+{fmtDuration(delta)}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Stage Progress Bar (visual progress 1→9) */}
      {messages.length > 0 && <StageProgressBar messages={messages} />}

      {/* Business Context */}
      {hasBusinessContext && <BusinessContextPanel wc={wc} />}

      {/* Negotiation Conversation */}
      {messages.length > 0 ? (
        <NegotiationConversation messages={messages} />
      ) : phases.length > 0 ? (
        // 역호환: 새 metadata 없는 옛 conversation 은 phases 만 표시
        <div className="border border-slate-800 rounded-lg bg-slate-900/30 p-4">
          <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-2">Negotiation Phases <span className="text-slate-600 normal-case font-normal">(legacy data)</span></div>
          <div className="flex flex-wrap gap-1.5">
            {phases.map((p, i) => (
              <span key={`${p}-${i}`} className="px-2 py-1 text-[11px] font-mono rounded border border-slate-700 bg-slate-800/60 text-slate-300">
                {i + 1}. {p}
              </span>
            ))}
          </div>
          <div className="text-[10px] text-slate-600 mt-2">Full message payload not captured for this conversation.</div>
        </div>
      ) : null}

      {/* Generated Code Preview (NEW) */}
      {codeFullChars > 0 && <GeneratedCodePanel preview={codePreview} fullChars={codeFullChars} />}

      {/* Raw spans (collapsible) */}
      <details className="border border-slate-800 rounded-lg bg-slate-900/30">
        <summary className="cursor-pointer px-4 py-3 text-[10px] uppercase tracking-wider text-slate-500 hover:text-slate-300">
          Raw Spans · {spans.length}
        </summary>
        <div className="border-t border-slate-800 p-4 space-y-2">
          {spans.map((s) => (
            <div key={s.id} className="text-xs font-mono">
              <div className="flex items-center gap-2">
                <span className={`px-1.5 py-0.5 rounded text-[10px] ${s.status === 'success' ? 'bg-emerald-500/10 text-emerald-300' : s.status === 'running' ? 'bg-amber-500/10 text-amber-300' : 'bg-rose-500/10 text-rose-300'}`}>
                  {s.status}
                </span>
                <span className="text-slate-300">{s.name}</span>
                <span className="text-slate-600">{fmtDuration(s.duration_ms)}</span>
              </div>
              {s.output && <div className="text-slate-500 ml-4 mt-0.5 line-clamp-2">{s.output}</div>}
            </div>
          ))}
        </div>
      </details>
    </div>
  );
}

function Metric({ label, value, accent = 'neutral' }: { label: string; value: string; accent?: 'good' | 'warn' | 'neutral' }) {
  const accentCls =
    accent === 'good' ? 'text-emerald-300' :
    accent === 'warn' ? 'text-amber-300' : 'text-slate-200';
  return (
    <div className="border border-slate-800 rounded-md bg-slate-900/30 px-3 py-2.5">
      <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-1">{label}</div>
      <div className={`text-sm font-medium tabular-nums ${accentCls}`}>{value}</div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// NEW (2026-05-09) — FORGE 대화 + 비즈니스 로직 가시화
// ─────────────────────────────────────────────────────────────────

function BusinessContextPanel({ wc }: { wc: WorkflowContext }) {
  const rules = wc.business_rules || [];
  const chain = wc.agent_chain || [];
  const tools = wc.preferred_tools || [];
  return (
    <div className="border border-slate-800 rounded-lg bg-slate-900/30 overflow-hidden">
      <div className="px-4 py-2.5 border-b border-slate-800">
        <div className="text-[10px] uppercase tracking-wider text-slate-500 font-medium">Business Context · logos_api → ACP</div>
      </div>
      <div className="p-4 space-y-3 text-xs">
        {wc.original_query && (
          <ContextRow label="Original Query" value={wc.original_query} mono />
        )}
        {wc.subtask_description && wc.subtask_description !== wc.original_query && (
          <ContextRow label="Subtask" value={wc.subtask_description} />
        )}
        {wc.intent && <ContextRow label="Intent" value={wc.intent} />}
        {chain.length > 0 && (
          <div>
            <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-1.5">Agent Chain (already executed)</div>
            <div className="flex flex-wrap items-center gap-1">
              {chain.map((a, i) => (
                <span key={`${a}-${i}`} className="inline-flex items-center gap-1.5 text-[11px]">
                  <span className="px-1.5 py-0.5 font-mono rounded bg-slate-800/60 border border-slate-700 text-slate-300">{a}</span>
                  {i < chain.length - 1 && <span className="text-slate-600">→</span>}
                </span>
              ))}
            </div>
          </div>
        )}
        {rules.length > 0 && (
          <div>
            <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-1.5">Business Rules <span className="text-slate-600 normal-case font-normal">(injected into FORGE prompt)</span></div>
            <div className="space-y-1">
              {rules.map((r, i) => (
                <div key={i} className="text-[11px] text-slate-300 bg-slate-950/50 border border-slate-800 rounded px-2 py-1.5 font-mono leading-relaxed line-clamp-3">
                  {r}
                </div>
              ))}
            </div>
          </div>
        )}
        {tools.length > 0 && (
          <div>
            <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-1.5">Preferred Tools</div>
            <div className="flex flex-wrap gap-1">
              {tools.map((t) => (
                <span key={t} className="px-1.5 py-0.5 text-[11px] font-mono rounded border border-cyan-500/30 bg-cyan-500/10 text-cyan-200">{t}</span>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function ContextRow({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-0.5">{label}</div>
      <div className={`text-slate-200 ${mono ? 'font-mono text-[11px]' : ''} leading-relaxed`}>{value}</div>
    </div>
  );
}

const MESSAGE_TYPE_TONE: Record<string, { label: string; cls: string }> = {
  gap_announced:           { label: 'gap_announced',           cls: 'text-indigo-300 border-indigo-500/30 bg-indigo-500/10' },
  clarification_needed:    { label: 'clarification_needed',    cls: 'text-amber-300 border-amber-500/30 bg-amber-500/10' },
  clarification_response:  { label: 'clarification_response',  cls: 'text-emerald-300 border-emerald-500/30 bg-emerald-500/10' },
  spec_proposal:           { label: 'spec_proposal',           cls: 'text-cyan-300 border-cyan-500/30 bg-cyan-500/10' },
  spec_accepted:           { label: 'spec_accepted',           cls: 'text-emerald-300 border-emerald-500/30 bg-emerald-500/10' },
  stage_update:            { label: 'stage_update',            cls: 'text-slate-400 border-slate-700 bg-slate-800/40' },
  code_streaming:          { label: 'code_streaming',          cls: 'text-slate-400 border-slate-700 bg-slate-800/40' },
  generation_complete:     { label: 'generation_complete',     cls: 'text-emerald-300 border-emerald-500/30 bg-emerald-500/10' },
  error:                   { label: 'error',                   cls: 'text-rose-300 border-rose-500/30 bg-rose-500/10' },
};

// FORGE V6 9-Stage pipeline (forge/docs 참조)
const FORGE_STAGES = [
  { id: 'stage_1', label: 'Spec' },
  { id: 'stage_2', label: 'Validate' },
  { id: 'stage_3', label: 'Block Query' },
  { id: 'stage_4', label: 'Compose' },
  { id: 'stage_5', label: 'Synthesize' },
  { id: 'stage_6', label: 'Test' },
  { id: 'stage_7', label: 'Healing' },
  { id: 'stage_8', label: 'Eval' },
  { id: 'stage_9', label: 'Admit' },
];

function StageProgressBar({ messages }: { messages: NegotiationMessage[] }) {
  // stage_update 메시지로부터 진행된 stage 추출
  const stagesSeen = new Set<string>();
  for (const m of messages) {
    if (m.type === 'stage_update') {
      const stage = (m.payload as any)?.stage as string | undefined;
      if (stage) {
        // "stage_3_block_query" 같은 형식에서 prefix 추출
        const match = stage.match(/^(stage_\d+)/);
        if (match) stagesSeen.add(match[1]);
      }
    }
  }
  const completedCount = stagesSeen.size;
  const isComplete = messages.some(m => m.type === 'generation_complete');

  return (
    <div className="border border-slate-800 rounded-lg bg-slate-900/30 px-4 py-3.5">
      <div className="flex items-center justify-between mb-3">
        <div className="text-[10px] uppercase tracking-wider text-slate-500 font-medium">FORGE V6 Pipeline</div>
        <div className="text-[10px] tabular-nums text-slate-500">{completedCount} / 9 stages</div>
      </div>
      <div className="flex items-center gap-1">
        {FORGE_STAGES.map((s, i) => {
          const seen = stagesSeen.has(s.id);
          const cls = seen
            ? (isComplete ? 'bg-emerald-400 text-slate-950' : 'bg-indigo-400 text-slate-950')
            : 'bg-slate-800 text-slate-600';
          return (
            <div key={s.id} className="flex-1 group relative">
              <div className={`h-1.5 rounded-sm transition-colors ${cls}`} />
              <div className="mt-1.5 flex items-center justify-between">
                <span className="text-[9px] text-slate-600 font-mono tabular-nums">{i + 1}</span>
                <span className={`text-[9px] truncate ${seen ? 'text-slate-300' : 'text-slate-600'}`}>{s.label}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function NegotiationConversation({ messages }: { messages: NegotiationMessage[] }) {
  // stage_update / code_streaming / heartbeat 는 노이즈가 많으므로 default 접힘
  const [showNoise, setShowNoise] = useState(false);
  const noiseTypes = new Set(['stage_update', 'code_streaming', 'heartbeat']);
  const visible = showNoise ? messages : messages.filter(m => !noiseTypes.has(m.type));
  const hidden = messages.length - visible.length;
  const t0 = messages[0]?.timestamp || 0;

  return (
    <div className="border border-slate-800 rounded-lg bg-slate-900/30 overflow-hidden">
      <div className="px-4 py-2.5 border-b border-slate-800 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="text-[10px] uppercase tracking-wider text-slate-500 font-medium shrink-0">
            Negotiation
          </div>
          <div className="text-[10px] text-slate-600 tabular-nums shrink-0">
            {visible.length} shown {hidden > 0 && <span className="text-slate-700">/ {messages.length} total</span>}
          </div>
        </div>
        <div className="flex items-center gap-3 text-[10px] shrink-0">
          <span className="flex items-center gap-1.5">
            <ParticipantBadge kind="acp" small />
            <span className="text-slate-500">→</span>
            <ParticipantBadge kind="forge" small />
          </span>
          {hidden > 0 && (
            <button
              onClick={() => setShowNoise(s => !s)}
              className="text-[10px] uppercase tracking-wider font-medium bg-slate-800/60 text-slate-300 border border-slate-700 px-2 py-0.5 rounded hover:bg-slate-800"
            >
              {showNoise ? `Compact view` : `Show ${hidden} system events`}
            </button>
          )}
        </div>
      </div>
      <div className="max-h-[600px] overflow-auto">
        {visible.map((m, i) => (
          <MessageBubble key={i} msg={m} t0={t0} />
        ))}
      </div>
    </div>
  );
}

function ParticipantBadge({ kind, small = false }: { kind: 'acp' | 'forge'; small?: boolean }) {
  const isAcp = kind === 'acp';
  const cls = isAcp
    ? 'bg-indigo-500/15 text-indigo-200 border-indigo-500/30'
    : 'bg-amber-500/15 text-amber-200 border-amber-500/30';
  const label = isAcp ? 'ACP' : 'FORGE';
  if (small) {
    return <span className={`px-1.5 py-0.5 text-[9px] font-mono rounded border ${cls}`}>{label}</span>;
  }
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-mono rounded border ${cls}`}>
      <span className={`w-1 h-1 rounded-full ${isAcp ? 'bg-indigo-400' : 'bg-amber-400'}`} />
      {label}
    </span>
  );
}

function MessageBubble({ msg, t0 }: { msg: NegotiationMessage; t0: number }) {
  const isAcp = msg.direction === 'acp_to_forge';
  const tone = MESSAGE_TYPE_TONE[msg.type] || { label: msg.type, cls: 'text-slate-400 border-slate-700 bg-slate-800/40' };
  const elapsed = msg.timestamp - t0;

  return (
    <div className={`relative px-4 py-3 border-t border-slate-800/40 ${isAcp ? '' : 'bg-slate-950/30'}`}>
      {/* Side accent bar */}
      <div className={`absolute left-0 top-0 bottom-0 w-0.5 ${isAcp ? 'bg-indigo-400/60' : 'bg-amber-400/60'}`} />

      <div className="flex items-start gap-3">
        {/* Timestamp column */}
        <div className="shrink-0 w-14 pt-0.5">
          <div className="text-[10px] text-slate-500 font-mono tabular-nums">+{elapsed.toFixed(2)}s</div>
        </div>

        {/* Avatar column */}
        <div className="shrink-0">
          <ParticipantBadge kind={isAcp ? 'acp' : 'forge'} />
        </div>

        {/* Direction arrow */}
        <div className="shrink-0 pt-0.5 text-slate-600 text-[10px] font-mono">
          {isAcp ? '→ FORGE' : '→ ACP'}
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1.5">
            <span className={`px-1.5 py-0.5 text-[10px] font-mono rounded border ${tone.cls}`}>{tone.label}</span>
          </div>
          <PayloadView msg={msg} />
        </div>
      </div>
    </div>
  );
}

function ForgeEmptyState() {
  return (
    <div className="space-y-5">
      <div className="border border-slate-800 rounded-lg bg-slate-900/30 px-6 py-10 text-center">
        <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-indigo-500/10 border border-indigo-500/30 mb-4">
          <span className="text-indigo-300 text-xl">⚒</span>
        </div>
        <div className="text-slate-100 font-semibold mb-1.5">No FORGE conversations yet</div>
        <div className="text-slate-400 text-sm max-w-lg mx-auto leading-relaxed">
          When the classifier detects a <span className="text-indigo-300 font-mono text-xs">capability_gap</span>, ACP opens a
          WebSocket negotiation with FORGE V6 to synthesize a new agent.
          The full 6-phase dialog and 9-stage pipeline will appear here.
        </div>
      </div>

      {/* Mock preview — what a real conversation looks like */}
      <div className="border border-slate-800 rounded-lg bg-slate-900/30 overflow-hidden opacity-70">
        <div className="px-4 py-2.5 border-b border-slate-800 flex items-center justify-between">
          <div className="text-[10px] uppercase tracking-wider text-slate-500 font-medium">Sample Negotiation Flow</div>
          <span className="text-[10px] font-mono text-slate-600">demo</span>
        </div>
        <div className="divide-y divide-slate-800/40">
          <MockMessage t="+0.0s" kind="acp" type="gap_announced"
            content={<>Send a notification to a Discord channel <span className="ml-2 text-indigo-300 font-mono text-[10px]">discord_webhook_post</span></>} />
          <MockMessage t="+0.3s" kind="forge" type="clarification_needed"
            content={<><span className="text-slate-500 font-mono mr-2">Q1.</span>Should the agent support embeds or plain text only?</>} />
          <MockMessage t="+0.5s" kind="acp" type="clarification_response"
            content={<><span className="text-emerald-400 mr-2">A1:</span><span className="font-mono">embeds</span><span className="text-slate-500 ml-2 italic">— for richer formatting</span></>} />
          <MockMessage t="+1.2s" kind="forge" type="spec_proposal"
            content={<span className="text-slate-400">{`{ name: "discord_messenger", tools: ["webhook_post"], input: "channel + text" }`}</span>} />
          <MockMessage t="+8.3s" kind="forge" type="generation_complete"
            content={<>Quality score: <span className="text-emerald-300 font-mono">0.85</span> · 8401 chars · admitted</>} />
        </div>
      </div>
    </div>
  );
}

function MockMessage({ t, kind, type, content }: { t: string; kind: 'acp' | 'forge'; type: string; content: React.ReactNode }) {
  const isAcp = kind === 'acp';
  const tone = MESSAGE_TYPE_TONE[type] || { label: type, cls: 'text-slate-400 border-slate-700 bg-slate-800/40' };
  return (
    <div className={`relative px-4 py-3 ${isAcp ? '' : 'bg-slate-950/30'}`}>
      <div className={`absolute left-0 top-0 bottom-0 w-0.5 ${isAcp ? 'bg-indigo-400/60' : 'bg-amber-400/60'}`} />
      <div className="flex items-start gap-3">
        <div className="shrink-0 w-14 pt-0.5 text-[10px] text-slate-500 font-mono tabular-nums">{t}</div>
        <ParticipantBadge kind={kind} />
        <div className="shrink-0 pt-0.5 text-slate-600 text-[10px] font-mono">{isAcp ? '→ FORGE' : '→ ACP'}</div>
        <div className="flex-1 min-w-0">
          <span className={`px-1.5 py-0.5 text-[10px] font-mono rounded border ${tone.cls}`}>{tone.label}</span>
          <div className="text-[11px] text-slate-300 mt-1.5 leading-relaxed">{content}</div>
        </div>
      </div>
    </div>
  );
}

function PayloadView({ msg }: { msg: NegotiationMessage }) {
  const p = msg.payload || {};

  // truncated payload (큰 chunk)
  if ((p as any)._truncated) {
    return (
      <div className="text-[11px] text-slate-500 italic">
        Payload truncated ({(p as any)._original_chars ?? '?'} chars). Preview: <span className="font-mono text-slate-400">{((p as any)._preview || '').slice(0, 120)}…</span>
      </div>
    );
  }

  // 구조 별 특화 렌더링
  if (msg.type === 'gap_announced') {
    const query = (p as any).query || (p as any).gap_description;
    const missing = (p as any).missing_capabilities || [];
    return (
      <div className="space-y-1.5 text-[11px]">
        {query && <div className="text-slate-300 leading-relaxed">{query}</div>}
        {missing.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {missing.map((c: string, i: number) => (
              <span key={i} className="px-1.5 py-0.5 font-mono rounded bg-indigo-500/10 border border-indigo-500/30 text-indigo-200">{c}</span>
            ))}
          </div>
        )}
      </div>
    );
  }

  if (msg.type === 'clarification_needed') {
    const questions = (p as any).questions || [];
    return (
      <div className="space-y-1.5 text-[11px]">
        {questions.map((q: any, i: number) => (
          <div key={i} className="text-slate-300">
            <span className="text-slate-500 font-mono mr-2">Q{i + 1}.</span>
            {q.question || JSON.stringify(q)}
            {q.options && Array.isArray(q.options) && q.options.length > 0 && (
              <div className="ml-5 mt-1 flex flex-wrap gap-1">
                {q.options.map((o: any, j: number) => (
                  <span key={j} className="px-1.5 py-0.5 font-mono text-[10px] rounded bg-slate-800 text-slate-400">{String(o).slice(0, 40)}</span>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    );
  }

  if (msg.type === 'clarification_response') {
    const answers = (p as any).answers || [];
    return (
      <div className="space-y-1.5 text-[11px]">
        {answers.map((a: any, i: number) => (
          <div key={i} className="text-slate-300">
            <span className="text-emerald-400 mr-2">A{i + 1}:</span>
            <span className="font-mono text-slate-200">{String(a.answer ?? '').slice(0, 80)}</span>
            {a.reasoning && <span className="text-slate-500 ml-2 italic">— {String(a.reasoning).slice(0, 100)}</span>}
          </div>
        ))}
      </div>
    );
  }

  if (msg.type === 'spec_proposal') {
    const spec = (p as any).spec || p;
    return (
      <details className="text-[11px]">
        <summary className="cursor-pointer text-slate-400 hover:text-slate-200">View spec ({Object.keys(spec).length} keys)</summary>
        <pre className="mt-2 text-[10px] font-mono text-slate-400 bg-slate-950/60 border border-slate-800 rounded p-2 overflow-auto max-h-40">{JSON.stringify(spec, null, 2)}</pre>
      </details>
    );
  }

  if (msg.type === 'stage_update') {
    return <div className="text-[11px] text-slate-500 font-mono">{(p as any).stage || '—'}</div>;
  }

  if (msg.type === 'code_streaming') {
    return <div className="text-[11px] text-slate-600 italic">+{(((p as any).chunk || '').length)} chars</div>;
  }

  if (msg.type === 'generation_complete') {
    const quality = (p as any).quality_score;
    return (
      <div className="text-[11px] text-slate-300 space-y-1">
        {quality != null && <div>Quality score: <span className="text-emerald-300 tabular-nums">{Number(quality).toFixed(2)}</span></div>}
        <details>
          <summary className="cursor-pointer text-slate-500 hover:text-slate-300">View full payload</summary>
          <pre className="mt-2 text-[10px] font-mono text-slate-400 bg-slate-950/60 border border-slate-800 rounded p-2 overflow-auto max-h-40">{JSON.stringify(p, null, 2)}</pre>
        </details>
      </div>
    );
  }

  // generic fallback
  return (
    <details className="text-[11px]">
      <summary className="cursor-pointer text-slate-500 hover:text-slate-300">View payload</summary>
      <pre className="mt-1 text-[10px] font-mono text-slate-400 bg-slate-950/60 border border-slate-800 rounded p-2 overflow-auto max-h-32">{JSON.stringify(p, null, 2)}</pre>
    </details>
  );
}

// 단순 Python 토큰 색상화 (Prism 의존성 회피)
function highlightPythonLine(line: string): React.ReactNode {
  const tokens: React.ReactNode[] = [];
  const regex = /(#.*$|"""[\s\S]*?"""|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\b(?:async|await|def|class|return|if|elif|else|for|while|try|except|finally|raise|import|from|as|with|in|not|and|or|is|None|True|False|self|yield|lambda|pass|break|continue|global|nonlocal)\b|\b\d+(?:\.\d+)?\b)/g;
  let lastIdx = 0;
  let match;
  while ((match = regex.exec(line)) !== null) {
    if (match.index > lastIdx) tokens.push(line.slice(lastIdx, match.index));
    const tok = match[0];
    let cls = 'text-slate-300';
    if (tok.startsWith('#')) cls = 'text-slate-600 italic';
    else if (tok.startsWith('"""') || tok.startsWith('"') || tok.startsWith("'")) cls = 'text-emerald-300/80';
    else if (/^\d/.test(tok)) cls = 'text-cyan-300/80';
    else cls = 'text-indigo-300';
    tokens.push(<span key={match.index} className={cls}>{tok}</span>);
    lastIdx = match.index + tok.length;
  }
  if (lastIdx < line.length) tokens.push(line.slice(lastIdx));
  return tokens.length > 0 ? <>{tokens}</> : line;
}

function GeneratedCodePanel({ preview, fullChars }: { preview: string; fullChars: number }) {
  const [open, setOpen] = useState(false);
  const lines = preview.split('\n');
  const hasMore = fullChars > preview.length;

  return (
    <div className="border border-slate-800 rounded-lg bg-slate-900/30 overflow-hidden">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full px-4 py-2.5 border-b border-slate-800 flex items-center justify-between hover:bg-slate-900/50 transition-colors"
      >
        <div className="flex items-center gap-3">
          <div className="text-[10px] uppercase tracking-wider text-slate-500 font-medium">Generated Code</div>
          <div className="flex items-center gap-3 text-[10px] text-slate-500 font-mono tabular-nums">
            <span>{fullChars.toLocaleString()} chars</span>
            <span className="text-slate-700">·</span>
            <span>{lines.length} lines</span>
            {hasMore && (
              <>
                <span className="text-slate-700">·</span>
                <span className="text-amber-400/80">truncated</span>
              </>
            )}
          </div>
        </div>
        <span className="text-[10px] text-slate-500 font-mono">{open ? '▾ Collapse' : '▸ Expand'}</span>
      </button>
      {open && (
        <div className="bg-slate-950/80 max-h-[500px] overflow-auto">
          <div className="text-[11px] font-mono leading-relaxed">
            {lines.map((line, i) => (
              <div key={i} className="flex hover:bg-slate-900/40">
                <span className="shrink-0 w-12 px-3 text-right text-slate-700 select-none border-r border-slate-800/60 tabular-nums">{i + 1}</span>
                <span className="px-3 py-px whitespace-pre overflow-x-auto flex-1">
                  {highlightPythonLine(line)}
                </span>
              </div>
            ))}
            {hasMore && (
              <div className="flex border-t border-slate-800/60">
                <span className="shrink-0 w-12 px-3 text-right text-slate-700 select-none border-r border-slate-800/60">…</span>
                <span className="px-3 py-1.5 text-slate-600 italic">{(fullChars - preview.length).toLocaleString()} more chars truncated for preview</span>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

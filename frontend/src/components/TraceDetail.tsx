'use client';

interface LLMCallInfo {
  id: string;
  model: string;
  provider: string;
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  cost_usd: number;
  duration_ms: number;
  success: boolean;
  prompt_preview?: string;
  created_at: string;
}

interface TraceDetailData {
  execution: {
    id: string;
    agent_id: string;
    agent_name: string;
    query: string;
    success: boolean;
    duration_ms: number;
    token_count: number;
    cost_usd: number;
    created_at: string;
    user_email?: string;
    error_message?: string;
  };
  llm_calls: LLMCallInfo[];
  summary: {
    total_llm_calls: number;
    total_tokens: number;
    total_cost_usd: number;
    models_used: string[];
  };
}

export function TraceDetail({ detail }: { detail: TraceDetailData | null }) {
  if (!detail) {
    return (
      <div className="bg-slate-900/50 border border-slate-800 rounded-xl p-4">
        <h3 className="text-sm font-medium text-slate-300 mb-4">Trace Detail</h3>
        <div className="h-48 flex items-center justify-center text-slate-600 text-sm">
          Select a trace to view details
        </div>
      </div>
    );
  }

  const { execution: exec, llm_calls, summary } = detail;

  return (
    <div className="bg-slate-900/50 border border-slate-800 rounded-xl p-4">
      <h3 className="text-sm font-medium text-slate-300 mb-4">Trace Detail</h3>

      {/* Execution Header */}
      <div className="bg-slate-800/50 rounded-lg p-3 mb-4">
        <div className="flex items-center gap-2 mb-2">
          <span className={`w-2 h-2 rounded-full ${exec.success ? 'bg-green-400' : 'bg-red-400'}`} />
          <span className="text-sm font-medium text-slate-200">{exec.agent_name || exec.agent_id}</span>
          <span className="text-xs text-slate-500 ml-auto">
            {exec.duration_ms >= 1000 ? `${(exec.duration_ms / 1000).toFixed(1)}s` : `${exec.duration_ms?.toFixed(0)}ms`}
          </span>
        </div>
        <div className="text-xs text-slate-400 truncate">{exec.query}</div>
        {exec.error_message && (
          <div className="text-xs text-red-400 mt-1 truncate">{exec.error_message}</div>
        )}
        <div className="flex gap-4 mt-2 text-xs text-slate-500">
          <span>{summary.total_llm_calls} LLM calls</span>
          <span>{summary.total_tokens} tokens</span>
          <span>${summary.total_cost_usd.toFixed(6)}</span>
        </div>
      </div>

      {/* LLM Call Tree */}
      <div className="space-y-2 max-h-64 overflow-auto">
        {llm_calls.length === 0 ? (
          <div className="text-xs text-slate-600 text-center py-4">No LLM calls recorded</div>
        ) : llm_calls.map((call, i) => (
          <div key={call.id} className="flex items-start gap-2 text-xs">
            <div className="flex flex-col items-center mt-1">
              <div className={`w-2 h-2 rounded-full ${call.success ? 'bg-purple-400' : 'bg-red-400'}`} />
              {i < llm_calls.length - 1 && <div className="w-px h-8 bg-slate-700 mt-0.5" />}
            </div>
            <div className="flex-1 bg-slate-800/30 rounded-lg p-2 border border-slate-800/50">
              <div className="flex justify-between items-center">
                <span className="text-slate-300 font-medium">{call.model}</span>
                <span className="text-slate-500">{call.duration_ms?.toFixed(0)}ms</span>
              </div>
              <div className="flex gap-3 mt-1 text-slate-500">
                <span>in: {call.input_tokens}</span>
                <span>out: {call.output_tokens}</span>
                <span>${call.cost_usd.toFixed(6)}</span>
              </div>
              {call.prompt_preview && (
                <div className="text-slate-600 mt-1 truncate">{call.prompt_preview}</div>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Models Used */}
      {summary.models_used.length > 0 && (
        <div className="flex gap-1 mt-3 flex-wrap">
          {summary.models_used.map(m => (
            <span key={m} className="text-[10px] bg-purple-500/10 text-purple-300 border border-purple-500/20 px-1.5 py-0.5 rounded">
              {m}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

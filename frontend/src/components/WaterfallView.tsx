'use client';

import { useState } from 'react';

interface LLMCall {
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

interface TraceData {
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
    error_message?: string;
  };
  llm_calls: LLMCall[];
  summary: {
    total_llm_calls: number;
    total_tokens: number;
    total_cost_usd: number;
    models_used: string[];
  };
}

export function WaterfallView({ detail }: { detail: TraceData | null }) {
  const [selectedCall, setSelectedCall] = useState<LLMCall | null>(null);

  if (!detail) {
    return (
      <div className="border border-slate-800 bg-slate-900/30 rounded-lg p-4">
        <div className="text-[10px] uppercase tracking-wider text-slate-500 font-medium mb-3">Trace Detail</div>
        <div className="h-32 flex items-center justify-center text-slate-600 text-xs">
          Select a trace to view the waterfall
        </div>
      </div>
    );
  }

  const { execution: exec, llm_calls, summary } = detail;
  const totalMs = exec.duration_ms || 1;

  return (
    <div className="border border-slate-800 bg-slate-900/30 rounded-lg overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className={`w-1.5 h-1.5 rounded-full ${exec.success ? 'bg-emerald-400' : 'bg-rose-400'}`} />
          <h3 className="text-sm font-semibold text-slate-100">{exec.agent_name || exec.agent_id}</h3>
        </div>
        <div className="flex items-center gap-3 text-[10px] text-slate-500 font-mono tabular-nums">
          <span>{(exec.duration_ms / 1000).toFixed(2)}s</span>
          <span className="text-slate-600">·</span>
          <span>{summary.total_llm_calls} LLM</span>
          <span className="text-slate-600">·</span>
          <span>{summary.total_tokens} tok</span>
          <span className="text-slate-600">·</span>
          <span>${summary.total_cost_usd.toFixed(4)}</span>
        </div>
      </div>

      <div className="p-4 space-y-4">
      {/* Query */}
      <div className="text-xs text-slate-400 bg-slate-950/50 border border-slate-800 rounded px-3 py-2 truncate">
        {exec.query}
      </div>

      {/* Waterfall Timeline */}
      <div className="relative">
        {/* Time axis */}
        <div className="flex justify-between text-[10px] text-slate-600 mb-1 px-1">
          <span>0s</span>
          <span>{(totalMs / 4000).toFixed(1)}s</span>
          <span>{(totalMs / 2000).toFixed(1)}s</span>
          <span>{(totalMs * 3 / 4000).toFixed(1)}s</span>
          <span>{(totalMs / 1000).toFixed(1)}s</span>
        </div>

        {/* Background grid */}
        <div className="absolute inset-0 mt-4 flex">
          {[0, 1, 2, 3].map(i => (
            <div key={i} className="flex-1 border-l border-slate-800/50" />
          ))}
          <div className="border-l border-slate-800/50" />
        </div>

        {/* LLM Call bars */}
        <div className="relative space-y-1.5 mt-1">
          {llm_calls.length === 0 ? (
            <div className="text-xs text-slate-600 text-center py-8">No LLM calls recorded</div>
          ) : llm_calls.map((call, i) => {
            // Calculate position (rough — based on creation time offset)
            const callStart = new Date(call.created_at).getTime();
            const execStart = new Date(exec.created_at).getTime();
            const offset = Math.max(0, callStart - execStart);
            const leftPct = (offset / totalMs) * 100;
            const widthPct = Math.max(2, (call.duration_ms / totalMs) * 100);

            return (
              <div
                key={call.id}
                className="relative h-8 cursor-pointer group"
                onClick={() => setSelectedCall(selectedCall?.id === call.id ? null : call)}
              >
                {/* Bar */}
                <div
                  className={`absolute h-full rounded transition-all ${
                    selectedCall?.id === call.id
                      ? 'bg-indigo-500/40 border border-indigo-400/60'
                      : call.success
                        ? 'bg-indigo-500/20 hover:bg-indigo-500/30 border border-indigo-500/30'
                        : 'bg-rose-500/20 hover:bg-rose-500/30 border border-rose-500/30'
                  }`}
                  style={{ left: `${Math.min(leftPct, 90)}%`, width: `${Math.min(widthPct, 100 - leftPct)}%`, minWidth: '60px' }}
                >
                  <div className="flex items-center h-full px-2 gap-2 overflow-hidden">
                    <span className="text-[10px] text-slate-300 font-medium truncate">
                      {call.model.replace('gemini-2.5-', 'g-')}
                    </span>
                    <span className="text-[10px] text-slate-500">
                      {call.duration_ms >= 1000 ? `${(call.duration_ms / 1000).toFixed(1)}s` : `${call.duration_ms.toFixed(0)}ms`}
                    </span>
                    <span className="text-[10px] text-slate-600">
                      {call.total_tokens} tok
                    </span>
                  </div>
                </div>

                {/* Index */}
                <div className="absolute -left-5 top-1/2 -translate-y-1/2 text-[10px] text-slate-600 w-4 text-right">
                  {i + 1}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Selected LLM Call Detail */}
      {selectedCall && (
        <div className="bg-slate-800/60 border border-slate-700/50 rounded-lg p-3 space-y-2 animate-in slide-in-from-top-2">
          <div className="flex justify-between items-center">
            <span className="text-xs font-medium text-slate-200">{selectedCall.model}</span>
            <button onClick={() => setSelectedCall(null)} className="text-slate-500 hover:text-slate-300 text-xs">Close</button>
          </div>

          <div className="grid grid-cols-4 gap-2 text-[10px]">
            <div>
              <span className="text-slate-500 block">Duration</span>
              <span className="text-slate-300">{selectedCall.duration_ms.toFixed(0)}ms</span>
            </div>
            <div>
              <span className="text-slate-500 block">Input</span>
              <span className="text-slate-300">{selectedCall.input_tokens} tok</span>
            </div>
            <div>
              <span className="text-slate-500 block">Output</span>
              <span className="text-slate-300">{selectedCall.output_tokens} tok</span>
            </div>
            <div>
              <span className="text-slate-500 block">Cost</span>
              <span className="text-slate-300">${selectedCall.cost_usd.toFixed(6)}</span>
            </div>
          </div>

          {selectedCall.prompt_preview && (
            <div>
              <span className="text-[10px] text-slate-500 block mb-1">Prompt Preview</span>
              <div className="text-[11px] text-slate-400 bg-slate-900/50 rounded px-2 py-1.5 font-mono max-h-20 overflow-auto">
                {selectedCall.prompt_preview}
              </div>
            </div>
          )}

          {/* Models badge */}
          <div className="flex gap-1">
            <span className={`text-[9px] px-1.5 py-0.5 rounded ${selectedCall.success ? 'bg-green-500/10 text-green-300 border border-green-500/20' : 'bg-red-500/10 text-red-300 border border-red-500/20'}`}>
              {selectedCall.success ? 'SUCCESS' : 'FAILED'}
            </span>
            <span className="text-[9px] bg-indigo-500/10 text-indigo-300 border border-indigo-500/30 px-1.5 py-0.5 rounded">
              {selectedCall.provider}
            </span>
          </div>
        </div>
      )}

      {/* Error */}
      {exec.error_message && (
        <div className="text-xs text-rose-300 bg-rose-500/5 border border-rose-500/20 rounded px-3 py-2 font-mono">
          {exec.error_message}
        </div>
      )}

      {/* Summary bar */}
      <div className="flex items-center justify-between text-[10px] text-slate-500 pt-2 border-t border-slate-800/50">
        <div className="flex gap-1.5">
          {summary.models_used.map(m => (
            <span key={m} className="bg-slate-800/60 border border-slate-700 px-1.5 py-0.5 rounded font-mono">{m}</span>
          ))}
        </div>
        <span className="font-mono tabular-nums">{new Date(exec.created_at).toLocaleTimeString('en-US', { hour12: false })}</span>
      </div>
      </div>
    </div>
  );
}

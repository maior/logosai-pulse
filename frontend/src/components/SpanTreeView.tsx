'use client';

import { useState, useEffect } from 'react';

const API = process.env.NEXT_PUBLIC_PULSE_API || 'http://localhost:8095';

interface Span {
  id: string;
  trace_id: string;
  parent_id: string | null;
  name: string;
  agent_id: string | null;
  status: string;
  input: string | null;
  output: string | null;
  duration_ms: number;
  metadata: Record<string, any> | null;
  created_at: string | null;
  children: Span[];
}

interface TreeData {
  trace_id: string;
  total_spans: number;
  tree: Span[];
  flat: Span[];
}

interface Props {
  executionId: string | null;
}

function SpanNode({ span, totalMs, depth = 0 }: { span: Span; totalMs: number; depth?: number }) {
  const [expanded, setExpanded] = useState(true);
  const [showDetail, setShowDetail] = useState(false);
  const hasChildren = span.children && span.children.length > 0;
  const widthPct = totalMs > 0 ? Math.max(3, (span.duration_ms / totalMs) * 100) : 100;

  const isLLM = span.name.startsWith('llm.');
  const isAgent = span.name.includes('.process');

  const isForge = span.name.startsWith('forge.');
  const barColor = span.status === 'error'
    ? 'bg-rose-500/25 border-rose-500/40'
    : isForge
      ? 'bg-amber-500/20 border-amber-500/40'
      : isLLM
        ? 'bg-cyan-500/20 border-cyan-500/35'
        : 'bg-indigo-500/20 border-indigo-500/35';

  const formatDuration = (ms: number) => {
    if (!ms) return '0ms';
    if (ms >= 1000) return `${(ms / 1000).toFixed(1)}s`;
    return `${ms.toFixed(0)}ms`;
  };

  return (
    <div className="relative">
      <div className="flex items-center gap-1 group">
        {/* Indent + expand toggle */}
        <div style={{ width: `${depth * 20}px` }} className="flex-shrink-0" />
        {hasChildren ? (
          <button
            onClick={() => setExpanded(!expanded)}
            className="w-4 h-4 flex items-center justify-center text-[10px] text-slate-500 hover:text-slate-300 flex-shrink-0"
          >
            {expanded ? '\u25BC' : '\u25B6'}
          </button>
        ) : (
          <div className="w-4 flex-shrink-0" />
        )}

        {/* Span bar */}
        <div
          className="flex-1 min-w-0 cursor-pointer"
          onClick={() => setShowDetail(!showDetail)}
        >
          <div className="flex items-center gap-2 h-7">
            {/* Name */}
            <span className={`text-[11px] font-medium truncate flex-shrink-0 max-w-[180px] font-mono ${
              isForge ? 'text-amber-300' : isAgent ? 'text-indigo-300' : isLLM ? 'text-cyan-300' : 'text-slate-300'
            }`}>
              {span.name}
            </span>

            {/* Duration bar */}
            <div className="flex-1 h-5 relative">
              <div
                className={`absolute left-0 top-0 h-full rounded border ${barColor} flex items-center px-2 overflow-hidden`}
                style={{ width: `${Math.min(widthPct, 100)}%`, minWidth: '40px' }}
              >
                <span className="text-[10px] text-slate-300 whitespace-nowrap">
                  {formatDuration(span.duration_ms)}
                </span>
                {span.metadata?.model && (
                  <span className="text-[9px] text-slate-500 ml-2 whitespace-nowrap">
                    {span.metadata.model.replace('gemini-2.5-', 'g-')}
                  </span>
                )}
                {span.metadata?.input_tokens != null && (
                  <span className="text-[9px] text-slate-500 ml-2 whitespace-nowrap">
                    {span.metadata.input_tokens + span.metadata.output_tokens} tok
                  </span>
                )}
              </div>
            </div>

            {/* Status badge */}
            <span className={`text-[9px] px-1.5 py-0.5 rounded flex-shrink-0 font-medium ${
              span.status === 'success'
                ? 'bg-emerald-500/10 text-emerald-300'
                : span.status === 'error'
                  ? 'bg-rose-500/10 text-rose-300'
                  : 'bg-amber-500/10 text-amber-300'
            }`}>
              {span.status}
            </span>
          </div>
        </div>
      </div>

      {/* Detail panel */}
      {showDetail && (
        <div className="ml-5 mr-2 my-1 bg-slate-800/60 border border-slate-700/50 rounded-lg p-3 space-y-2">
          {span.input && (
            <div>
              <span className="text-[10px] text-slate-500 block mb-0.5">Input</span>
              <div className="text-[11px] text-slate-400 bg-slate-900/50 rounded px-2 py-1.5 font-mono max-h-16 overflow-auto whitespace-pre-wrap break-all">
                {span.input}
              </div>
            </div>
          )}
          {span.output && (
            <div>
              <span className="text-[10px] text-slate-500 block mb-0.5">Output</span>
              <div className="text-[11px] text-slate-400 bg-slate-900/50 rounded px-2 py-1.5 font-mono max-h-16 overflow-auto whitespace-pre-wrap break-all">
                {span.output}
              </div>
            </div>
          )}
          {span.metadata && Object.keys(span.metadata).length > 0 && (
            <div className="grid grid-cols-4 gap-2 text-[10px]">
              {Object.entries(span.metadata).map(([k, v]) => (
                <div key={k}>
                  <span className="text-slate-500 block">{k}</span>
                  <span className="text-slate-300">{String(v)}</span>
                </div>
              ))}
            </div>
          )}
          <div className="text-[9px] text-slate-600">
            ID: {span.id.slice(0, 8)}... | Trace: {span.trace_id.slice(0, 8)}...
            {span.created_at && ` | ${new Date(span.created_at).toLocaleTimeString()}`}
          </div>
        </div>
      )}

      {/* Children */}
      {expanded && hasChildren && (
        <div className="mt-0.5">
          {span.children.map(child => (
            <SpanNode key={child.id} span={child} totalMs={totalMs} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  );
}

export function SpanTreeView({ executionId }: Props) {
  const [treeData, setTreeData] = useState<TreeData | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!executionId || executionId.length < 8) {
      setTreeData(null);
      return;
    }

    setLoading(true);
    fetch(`${API}/api/v1/traces/${executionId}/tree`)
      .then(r => r.json())
      .then(data => {
        setTreeData(data);
        setLoading(false);
      })
      .catch(() => {
        setTreeData(null);
        setLoading(false);
      });
  }, [executionId]);

  if (!executionId) {
    return (
      <div className="border border-slate-800 bg-slate-900/30 rounded-lg p-4">
        <div className="text-[10px] uppercase tracking-wider text-slate-500 font-medium mb-3">Span Tree</div>
        <div className="h-64 flex items-center justify-center text-slate-600 text-sm">
          Select a trace to view the span tree
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="border border-slate-800 bg-slate-900/30 rounded-lg p-4">
        <div className="text-[10px] uppercase tracking-wider text-slate-500 font-medium mb-3">Span Tree</div>
        <div className="h-32 flex items-center justify-center text-slate-500 text-sm">
          Loading spans...
        </div>
      </div>
    );
  }

  if (!treeData || treeData.total_spans === 0) {
    return (
      <div className="border border-slate-800 bg-slate-900/30 rounded-lg p-4">
        <div className="text-[10px] uppercase tracking-wider text-slate-500 font-medium mb-3">Span Tree</div>
        <div className="h-32 flex items-center justify-center text-slate-600 text-sm">
          No span data for this trace
        </div>
      </div>
    );
  }

  const rootDuration = treeData.tree[0]?.duration_ms || 1;

  return (
    <div className="border border-slate-800 bg-slate-900/30 rounded-lg overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between">
        <h3 className="text-[10px] uppercase tracking-wider text-slate-500 font-medium">Span Tree</h3>
        <div className="flex items-center gap-3 text-[10px] text-slate-500 font-mono tabular-nums">
          <span>{treeData.total_spans} spans</span>
          <span className="text-slate-600">·</span>
          <span>{(rootDuration / 1000).toFixed(2)}s</span>
          <span className="text-slate-600">·</span>
          <span className="text-slate-600">{treeData.trace_id.slice(0, 8)}</span>
        </div>
      </div>

      {/* Legend */}
      <div className="px-4 py-2 border-b border-slate-800 flex gap-4 text-[9px] text-slate-500">
        <span className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-sm bg-indigo-500/30 border border-indigo-500/40" /> Agent
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-sm bg-cyan-500/30 border border-cyan-500/40" /> LLM
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-sm bg-amber-500/30 border border-amber-500/40" /> FORGE
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-sm bg-rose-500/30 border border-rose-500/40" /> Error
        </span>
      </div>

      {/* Tree */}
      <div className="space-y-0.5 overflow-auto max-h-[500px] p-3">
        {treeData.tree.map(span => (
          <SpanNode key={span.id} span={span} totalMs={rootDuration} />
        ))}
      </div>
    </div>
  );
}

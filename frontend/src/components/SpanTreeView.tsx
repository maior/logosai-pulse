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

  const barColor = span.status === 'error'
    ? 'bg-red-500/30 border-red-500/40'
    : isLLM
      ? 'bg-blue-500/25 border-blue-500/35'
      : 'bg-purple-500/25 border-purple-500/35';

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
            <span className={`text-[11px] font-medium truncate flex-shrink-0 max-w-[180px] ${
              isAgent ? 'text-purple-300' : isLLM ? 'text-blue-300' : 'text-slate-300'
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
            <span className={`text-[9px] px-1 py-0.5 rounded flex-shrink-0 ${
              span.status === 'success'
                ? 'bg-green-500/10 text-green-400'
                : span.status === 'error'
                  ? 'bg-red-500/10 text-red-400'
                  : 'bg-yellow-500/10 text-yellow-400'
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
    if (!executionId) {
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
      <div className="bg-slate-900/50 border border-slate-800 rounded-xl p-6">
        <h3 className="text-sm font-medium text-slate-300 mb-4">Span Tree</h3>
        <div className="h-64 flex items-center justify-center text-slate-600 text-sm">
          Select a trace to view the span tree
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="bg-slate-900/50 border border-slate-800 rounded-xl p-6">
        <h3 className="text-sm font-medium text-slate-300 mb-4">Span Tree</h3>
        <div className="h-32 flex items-center justify-center text-slate-500 text-sm">
          Loading spans...
        </div>
      </div>
    );
  }

  if (!treeData || treeData.total_spans === 0) {
    return (
      <div className="bg-slate-900/50 border border-slate-800 rounded-xl p-6">
        <h3 className="text-sm font-medium text-slate-300 mb-4">Span Tree</h3>
        <div className="h-32 flex items-center justify-center text-slate-600 text-sm">
          No span data for this trace
        </div>
      </div>
    );
  }

  const rootDuration = treeData.tree[0]?.duration_ms || 1;

  return (
    <div className="bg-slate-900/50 border border-slate-800 rounded-xl p-4 space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-slate-300">Span Tree</h3>
        <div className="flex items-center gap-3 text-[10px] text-slate-500">
          <span>{treeData.total_spans} spans</span>
          <span>{(rootDuration / 1000).toFixed(1)}s total</span>
          <span className="text-slate-600">trace: {treeData.trace_id.slice(0, 8)}</span>
        </div>
      </div>

      {/* Legend */}
      <div className="flex gap-3 text-[9px] text-slate-500">
        <span className="flex items-center gap-1">
          <span className="w-2.5 h-2.5 rounded bg-purple-500/30 border border-purple-500/40" /> Agent
        </span>
        <span className="flex items-center gap-1">
          <span className="w-2.5 h-2.5 rounded bg-blue-500/30 border border-blue-500/40" /> LLM Call
        </span>
        <span className="flex items-center gap-1">
          <span className="w-2.5 h-2.5 rounded bg-red-500/30 border border-red-500/40" /> Error
        </span>
      </div>

      {/* Tree */}
      <div className="space-y-0.5 overflow-auto max-h-[500px]">
        {treeData.tree.map(span => (
          <SpanNode key={span.id} span={span} totalMs={rootDuration} />
        ))}
      </div>
    </div>
  );
}

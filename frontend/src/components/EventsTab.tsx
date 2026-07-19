'use client';

/**
 * EventsTab — 런타임 이벤트 타임라인.
 *
 * 회로 차단 / 자동 롤백 / 사용자 인터랙션은 2026-07-19 이전까지 인메모리로만
 * 존재해 프로세스 재시작과 함께 사라졌다. 장애를 가장 직접적으로 알려주는
 * 신호인데 사후 추적이 불가능했다 — 이제 여기서 시간순으로 되짚어 본다.
 *
 * 데이터: GET /api/v1/events, /api/v1/events/stats
 * 집계·요약 로직은 lib/runtimeEvents.mjs (순수 함수, node 로 테스트됨).
 *
 * 색 규칙(dataviz): severity 는 status 토큰(rose/amber/emerald) + 항상 숫자·라벨 동반.
 */

import { useCallback, useEffect, useState } from 'react';
import { summarizeEvents, formatPayload } from '@/lib/runtimeEvents.mjs';

const API = process.env.NEXT_PUBLIC_PULSE_API || 'http://localhost:8095';

const SEV_COLOR: Record<string, string> = {
  critical: '#fb7185',
  warning: '#f59e0b',
  info: '#34d399',
};

interface RuntimeEvent {
  id: string;
  event_type: string;
  source: string | null;
  agent_id: string | null;
  severity: string;
  payload: Record<string, unknown>;
  created_at: string;
}

interface Summary {
  total: number;
  bySeverity: { critical: number; warning: number; info: number };
  byType: Array<{ event_type: string; count: number; lastSeen: string; severity: string }>;
}

function Metric({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="rounded-lg border border-neutral-800 bg-neutral-900/40 px-3 py-2.5">
      <div className="text-[10px] uppercase tracking-wide text-neutral-500">{label}</div>
      <div className="mt-1 text-lg font-semibold tabular-nums" style={tone ? { color: tone } : undefined}>
        {value}
      </div>
    </div>
  );
}

export function EventsTab({ period = '24h' }: { period?: string }) {
  const [events, setEvents] = useState<RuntimeEvent[]>([]);
  const [typeFilter, setTypeFilter] = useState('');
  const [loading, setLoading] = useState(true);

  const [allEvents, setAllEvents] = useState<RuntimeEvent[]>([]);

  const fetchData = useCallback(async () => {
    try {
      const q = typeFilter ? `&event_type=${encodeURIComponent(typeFilter)}` : '';
      // 상단 요약/칩은 항상 전체 기준이어야 한다 — 필터된 목록으로 집계하면
      // 4건 중 2건만 보이는 상태에서 "전체 2" 로 표시돼 사용자를 오도한다.
      const [filtered, all] = await Promise.all([
        fetch(`${API}/api/v1/events?period=${period}&limit=200${q}`).then((r) => r.json()),
        fetch(`${API}/api/v1/events?period=${period}&limit=500`).then((r) => r.json()),
      ]);
      setEvents(filtered.events || []);
      setAllEvents(all.events || []);
    } catch {
      setEvents([]);
      setAllEvents([]);
    } finally {
      setLoading(false);
    }
  }, [period, typeFilter]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const summary = summarizeEvents(allEvents) as Summary;

  if (loading) {
    return <div className="py-16 text-center text-sm text-neutral-500">불러오는 중…</div>;
  }

  if (summary.total === 0 && !typeFilter) {
    return (
      <div className="py-16 text-center text-sm text-neutral-500">
        기간 내 런타임 이벤트가 없습니다.
        <div className="mx-auto mt-2 max-w-md text-[11px] leading-relaxed text-neutral-600">
          회로 차단·자동 롤백·인터랙션이 발생하면 여기 기록됩니다.
          이벤트가 없다는 건 그 기간에 장애 신호가 없었다는 뜻입니다.
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* 심각도 요약 */}
      <div className="grid grid-cols-2 gap-2.5 md:grid-cols-4">
        <Metric label="전체 이벤트" value={String(summary.total)} />
        <Metric label="critical" value={String(summary.bySeverity.critical)}
                tone={summary.bySeverity.critical > 0 ? SEV_COLOR.critical : undefined} />
        <Metric label="warning" value={String(summary.bySeverity.warning)}
                tone={summary.bySeverity.warning > 0 ? SEV_COLOR.warning : undefined} />
        <Metric label="info" value={String(summary.bySeverity.info)} />
      </div>

      {/* 종류 필터 */}
      <div className="flex flex-wrap items-center gap-2">
        <button onClick={() => setTypeFilter('')}
                className={`rounded px-2.5 py-1 text-[11px] transition-colors ${
                  typeFilter === '' ? 'bg-neutral-700 text-neutral-100' : 'bg-neutral-900 text-neutral-400'}`}>
          전체 {summary.total}
        </button>
        {summary.byType.map((b) => (
          <button key={b.event_type} onClick={() => setTypeFilter(b.event_type)}
                  className={`rounded px-2.5 py-1 text-[11px] transition-colors ${
                    typeFilter === b.event_type ? 'bg-neutral-700 text-neutral-100' : 'bg-neutral-900 text-neutral-400'}`}>
            {b.event_type} {b.count}
          </button>
        ))}
      </div>

      {/* 타임라인 */}
      <div className="overflow-x-auto rounded-lg border border-neutral-800">
        <table className="w-full text-xs">
          <thead className="bg-neutral-900/60 text-neutral-500">
            <tr>
              <th className="px-3 py-2 text-left font-medium">시각</th>
              <th className="px-3 py-2 text-left font-medium">이벤트</th>
              <th className="px-3 py-2 text-left font-medium">대상</th>
              <th className="px-3 py-2 text-left font-medium">출처</th>
              <th className="px-3 py-2 text-left font-medium">상세</th>
            </tr>
          </thead>
          <tbody>
            {events.length === 0 && (
              <tr><td colSpan={5} className="px-3 py-6 text-center text-neutral-600">
                해당 종류의 이벤트가 없습니다.
              </td></tr>
            )}
            {events.map((e) => (
              <tr key={e.id} className="border-t border-neutral-800/60 hover:bg-neutral-900/40">
                <td className="whitespace-nowrap px-3 py-2 tabular-nums text-neutral-500">
                  {e.created_at ? e.created_at.slice(5, 19).replace('T', ' ') : '—'}
                </td>
                <td className="px-3 py-2">
                  <span className="font-medium" style={{ color: SEV_COLOR[e.severity] || '#a3a3a3' }}>
                    {e.event_type}
                  </span>
                  <span className="ml-1.5 text-[10px] text-neutral-600">{e.severity}</span>
                </td>
                <td className="px-3 py-2 text-neutral-300">{e.agent_id || '—'}</td>
                <td className="px-3 py-2 text-neutral-500">{e.source || '—'}</td>
                <td className="max-w-md truncate px-3 py-2 text-neutral-400">
                  {formatPayload(e.payload) || '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

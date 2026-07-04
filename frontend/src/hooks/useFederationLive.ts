'use client';

/**
 * useFederationLive — /federation/live 집계를 SSE 실시간 구독으로 갱신.
 *
 * 주 경로: Pulse `/api/v1/stream` SSE 구독 → federation span(new_span) 수신 시
 *          400ms debounce 후 집계 API refetch (page.tsx 와 동일 철학 — SSE 는
 *          "지금 갱신" 신호, 데이터는 백엔드 build_federation_live 재사용).
 * 안전망: 45초 저빈도 폴링 — SSE 끊김/멀티워커 환경에서도 갱신 보장.
 *
 * FederationTab(hours=168) · FederationMonitor(hours=24) 공용.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { isFederationSpan } from '@/lib/federationLive.mjs';

const API = process.env.NEXT_PUBLIC_PULSE_API || 'http://localhost:8095';
const POLL_MS = 45000;      // 안전망 폴링 (SSE 보조)
const DEBOUNCE_MS = 400;    // 연속 span 버스트를 1회 refetch 로 합침

export function useFederationLive<T>(hours: number, initial: T): { data: T; loaded: boolean } {
  const [data, setData] = useState<T>(initial);
  const [loaded, setLoaded] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch(`${API}/api/v1/federation/live?hours=${hours}`);
      setData(await r.json());
    } catch { /* noop — 다음 주기/이벤트에 재시도 */ } finally { setLoaded(true); }
  }, [hours]);

  useEffect(() => {
    load();
    const poll = setInterval(load, POLL_MS);
    const es = new EventSource(`${API}/api/v1/stream`);
    const onSpan = (e: MessageEvent) => {
      let payload: unknown;
      try { payload = JSON.parse(e.data); } catch { return; }
      if (!isFederationSpan(payload)) return;
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(load, DEBOUNCE_MS);
    };
    es.addEventListener('new_span', onSpan as EventListener);

    return () => {
      clearInterval(poll);
      es.removeEventListener('new_span', onSpan as EventListener);
      es.close();
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [load]);

  return { data, loaded };
}

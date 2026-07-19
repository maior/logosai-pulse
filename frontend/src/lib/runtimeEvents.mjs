/**
 * runtimeEvents — 런타임 이벤트 집계/표시 순수 함수 (2026-07-19).
 *
 * 회로 차단·자동 롤백·인터랙션은 원래 인메모리로만 존재해 재시작과 함께
 * 사라지던 신호다. 이제 수집되므로 화면에서 읽을 수 있게 가공한다.
 *
 * 컴포넌트가 아니라 여기 두는 이유: 프론트 테스트 러너가 없어
 * 순수 함수 + node 직접 실행이 유일하게 검증 가능한 경로다.
 */

const SEVERITIES = ['critical', 'warning', 'info'];
const MAX_PAYLOAD_CHARS = 160;

/** 이벤트 목록 → 심각도별/종류별 집계 */
export function summarizeEvents(events) {
  const list = Array.isArray(events) ? events : [];
  const bySeverity = { critical: 0, warning: 0, info: 0 };
  const typeMap = new Map();

  for (const e of list) {
    if (!e) continue;
    // severity 누락은 info 로 —  집계에서 누락되면 총계가 안 맞는다
    const sev = SEVERITIES.includes(e.severity) ? e.severity : 'info';
    bySeverity[sev] += 1;

    const key = e.event_type || 'unknown';
    const prev = typeMap.get(key);
    const ts = e.created_at || '';
    if (prev) {
      prev.count += 1;
      if (ts > prev.lastSeen) prev.lastSeen = ts;
    } else {
      typeMap.set(key, { event_type: key, count: 1, lastSeen: ts, severity: sev });
    }
  }

  return {
    total: list.length,
    bySeverity,
    byType: [...typeMap.values()].sort((a, b) => b.count - a.count),
  };
}

/** payload → 표 한 줄에 들어갈 요약 문자열 */
export function formatPayload(payload) {
  if (!payload || typeof payload !== 'object') return '';

  const parts = [];
  for (const [k, v] of Object.entries(payload)) {
    let shown;
    if (v === null || v === undefined) continue;
    else if (typeof v === 'number') shown = Number.isInteger(v) ? String(v) : v.toFixed(2);
    else if (typeof v === 'object') shown = JSON.stringify(v);
    else shown = String(v);
    parts.push(`${k} ${shown}`);
  }

  const out = parts.join(' · ');
  // 표 레이아웃이 깨지지 않도록 상한을 둔다
  return out.length > MAX_PAYLOAD_CHARS ? out.slice(0, MAX_PAYLOAD_CHARS - 1) + '…' : out;
}

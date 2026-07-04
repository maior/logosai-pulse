/**
 * Federation 실시간 갱신 판정 — Pulse SSE `new_span` payload 가
 * 기관 간 연합 위임 span 인지 판별한다.
 *
 * federation 위임은 hook.py 가 항상 name="federation.delegate fed.<peer>.<agent>",
 * agent_id="fed.<peer>.<agent>" 로 기록하므로 두 필드 접두로 판정한다.
 * (broadcast payload = SpanRecord.model_dump() 에는 stage 필드가 없음)
 *
 * @param {unknown} payload - SSE `new_span` 이벤트 data (JSON.parse 결과)
 * @returns {boolean} federation span 이면 true (→ /federation/live refetch 트리거)
 */
export function isFederationSpan(payload) {
  if (!payload || typeof payload !== 'object') return false;
  const agentId = String(payload.agent_id || '');
  const name = String(payload.name || '');
  return agentId.startsWith('fed.') || name.startsWith('federation.');
}

/**
 * runtimeEvents 순수 함수 테스트 — 프론트 테스트 러너 부재로 node 직접 실행.
 * 실행: node src/lib/runtimeEvents.test.mjs
 *
 * 대상: 회로 차단 / 자동 롤백 / 인터랙션 이벤트의 집계와 payload 한 줄 요약.
 */
import assert from 'node:assert';
import { summarizeEvents, formatPayload } from './runtimeEvents.mjs';

let pass = 0;
const fail = [];
function t(name, fn) { try { fn(); pass++; } catch (e) { fail.push(`${name}: ${e.message}`); } }

const EVENTS = [
  { event_type: 'circuit_breaker.opened', severity: 'warning', created_at: '2026-07-19T10:00:00' },
  { event_type: 'circuit_breaker.opened', severity: 'warning', created_at: '2026-07-19T12:00:00' },
  { event_type: 'circuit_breaker.closed', severity: 'info', created_at: '2026-07-19T12:05:00' },
  { event_type: 'evolution.rollback', severity: 'critical', created_at: '2026-07-19T09:00:00' },
];

// ── summarizeEvents ──────────────────────────────────────
t('총계', () => assert.strictEqual(summarizeEvents(EVENTS).total, 4));

t('심각도별 집계', () => {
  const s = summarizeEvents(EVENTS).bySeverity;
  assert.strictEqual(s.critical, 1);
  assert.strictEqual(s.warning, 2);
  assert.strictEqual(s.info, 1);
});

t('종류별 집계는 건수 내림차순', () => {
  const byType = summarizeEvents(EVENTS).byType;
  assert.strictEqual(byType[0].event_type, 'circuit_breaker.opened');
  assert.strictEqual(byType[0].count, 2);
});

t('종류별 lastSeen 은 최신 시각', () => {
  const opened = summarizeEvents(EVENTS).byType.find(b => b.event_type === 'circuit_breaker.opened');
  assert.strictEqual(opened.lastSeen, '2026-07-19T12:00:00');
});

t('빈 입력 → 0 (화면이 깨지면 안 됨)', () => {
  const s = summarizeEvents([]);
  assert.strictEqual(s.total, 0);
  assert.deepStrictEqual(s.byType, []);
  assert.strictEqual(s.bySeverity.critical, 0);
});

t('null/undefined 안전', () => {
  assert.strictEqual(summarizeEvents(null).total, 0);
  assert.strictEqual(summarizeEvents(undefined).total, 0);
});

t('severity 누락 → info 로 집계', () => {
  const s = summarizeEvents([{ event_type: 'x', created_at: '2026-07-19T10:00:00' }]);
  assert.strictEqual(s.bySeverity.info, 1);
});

// ── formatPayload ────────────────────────────────────────
t('키-값 한 줄 요약', () =>
  assert.strictEqual(formatPayload({ failures: 2, threshold: 2 }), 'failures 2 · threshold 2'));

t('불리언/문자열 보존', () =>
  assert.strictEqual(formatPayload({ ok: true, name: 'weather' }), 'ok true · name weather'));

t('소수는 반올림해 읽기 쉽게', () =>
  assert.strictEqual(formatPayload({ failure_rate: 0.83333 }), 'failure_rate 0.83'));

t('빈 payload → 빈 문자열', () => {
  assert.strictEqual(formatPayload({}), '');
  assert.strictEqual(formatPayload(null), '');
  assert.strictEqual(formatPayload(undefined), '');
});

t('중첩 객체는 JSON 으로 압축', () => {
  const out = formatPayload({ meta: { a: 1 } });
  assert.ok(out.includes('meta'), `중첩 키 누락: ${out}`);
});

t('과도하게 길면 잘라낸다 (표 레이아웃 보호)', () => {
  const long = {};
  for (let i = 0; i < 40; i++) long[`key${i}`] = `value${i}`;
  assert.ok(formatPayload(long).length <= 160, '길이 상한 초과');
});

// ── 결과 ─────────────────────────────────────────────────
if (fail.length) {
  console.error(`FAIL ${fail.length}`);
  fail.forEach(f => console.error('  - ' + f));
  process.exit(1);
}
console.log(`PASS ${pass} / ${pass}`);

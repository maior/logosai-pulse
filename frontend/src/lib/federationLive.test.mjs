/**
 * isFederationSpan 순수 판정 테스트 — 프론트 테스트 러너 부재로 node 직접 실행.
 * 실행: node src/lib/federationLive.test.mjs
 */
import assert from 'node:assert';
import { isFederationSpan } from './federationLive.mjs';

let pass = 0;
const fail = [];
function t(name, fn) { try { fn(); pass++; } catch (e) { fail.push(`${name}: ${e.message}`); } }

// 정상: federation span 은 refetch 트리거
t('fed. agent_id → true', () =>
  assert.strictEqual(isFederationSpan({ agent_id: 'fed.instB.weather_agent' }), true));
t('federation. name → true', () =>
  assert.strictEqual(isFederationSpan({ name: 'federation.delegate fed.instB.weather_agent' }), true));

// 정상: 비-federation span 은 무시
t('일반 agent_id → false', () =>
  assert.strictEqual(isFederationSpan({ agent_id: 'weather_agent' }), false));
t('llm span name → false', () =>
  assert.strictEqual(isFederationSpan({ name: 'llm.gemini-2.5-flash-lite' }), false));

// 엣지: 빈/누락/타입 오류
t('null → false', () => assert.strictEqual(isFederationSpan(null), false));
t('undefined → false', () => assert.strictEqual(isFederationSpan(undefined), false));
t('빈 객체 → false', () => assert.strictEqual(isFederationSpan({}), false));
t('빈 agent_id → false', () => assert.strictEqual(isFederationSpan({ agent_id: '' }), false));
t('문자열 입력 → false', () => assert.strictEqual(isFederationSpan('fed.x.y'), false));

// 엣지: 'fed.' 는 점 포함 — 유사 접두는 걸러야 함 (오탐 방지)
t('federated_agent(점 없음) → false', () =>
  assert.strictEqual(isFederationSpan({ agent_id: 'federated_agent' }), false));
t('federationX name(점 없음) → false', () =>
  assert.strictEqual(isFederationSpan({ name: 'federationXyz' }), false));

console.log(`PASS ${pass} / ${pass + fail.length}`);
if (fail.length) { fail.forEach(f => console.log('FAIL', f)); process.exit(1); }

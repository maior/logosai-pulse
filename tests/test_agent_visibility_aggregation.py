"""멀티 에이전트 가시성 집계 테스트 (2026-07-19).

배경: 멀티 에이전트 실행이 agent_id="multi" 한 줄로만 기록돼, 실제로 동작한
      weather_agent/scheduler_agent 등이 Pulse Agents 탭에서 사라졌다.
      (7월 weather_agent: spans 80건 vs executions 24건)

지표 분리 규약:
  - summary.total_calls = '사용자 요청 수' → 자식(하위 에이전트) 행 제외
  - agents 탭        = '에이전트별 호출' → 자식 포함, multi 래퍼 제외

실행 중인 LogosPulse(:8095) 를 상대로 검증한다.
직접 실행: python tests/test_agent_visibility_aggregation.py
"""

import asyncio
import json
import os
import sys
import urllib.error
import urllib.request
from uuid import uuid4

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from app.config import settings

BASE = os.getenv("PULSE_TEST_URL", "http://localhost:8095")
PARENT_AGENT = "multi"
CHILD_AGENT = "__vis_test_child__"
PLAIN_AGENT = "__vis_test_plain__"


def _req(path: str, payload: dict | None = None):
    if payload is None:
        req = urllib.request.Request(f"{BASE}{path}")
    else:
        req = urllib.request.Request(
            f"{BASE}{path}", data=json.dumps(payload).encode(),
            headers={"Content-Type": "application/json"}, method="POST",
        )
    with urllib.request.urlopen(req, timeout=10) as resp:
        return json.loads(resp.read() or b"{}")


def _summary_total() -> int:
    return _req("/api/v1/dashboard?period=1h")["summary"]["total_calls"]


def _summary_active_agents() -> int:
    return _req("/api/v1/dashboard?period=1h")["summary"]["active_agents"]


def _agent_ids() -> set:
    return {a["agent_id"] for a in _req("/api/v1/agents?period=1h")}


def _send_execution(agent_id: str, metadata: dict | None = None, **kw):
    return _req("/api/v1/ingest/execution", {
        "execution_id": str(uuid4()), "agent_id": agent_id,
        "agent_name": kw.get("agent_name", agent_id),
        "success": True, "duration_ms": 100.0, "metadata": metadata,
    })


async def _exec_sql(sql: str, *args):
    import asyncpg
    dsn = settings.database_url.replace("postgresql+asyncpg://", "postgresql://")
    conn = await asyncpg.connect(dsn)
    try:
        return await conn.execute(sql, *args)
    finally:
        await conn.close()


# ── 테스트 ────────────────────────────────────────────────
def test_plain_execution_counted_in_summary():
    """metadata 가 NULL 인 일반 실행은 반드시 요약에 잡혀야 한다.

    jsonb 의 `NULL ? 'key'` 는 NULL 이라 필터를 잘못 쓰면 과거 데이터 전체가
    요약에서 사라진다 — 이 회귀를 막는 것이 이 테스트의 목적.
    """
    before = _summary_total()
    _send_execution(PLAIN_AGENT, metadata=None)
    after = _summary_total()
    assert after == before + 1, f"일반 실행 미집계: {before} → {after}"
    print("PASS plain_execution_counted_in_summary")


def test_child_execution_excluded_from_summary():
    """하위 에이전트 행은 '요청 수'가 아니므로 요약에서 빠진다."""
    before = _summary_total()
    _send_execution(CHILD_AGENT, metadata={"parent_trace_id": str(uuid4()),
                                           "endpoint": "/stream/multi"})
    after = _summary_total()
    assert after == before, f"자식 행이 요약을 부풀림: {before} → {after}"
    print("PASS child_execution_excluded_from_summary")


def test_child_execution_visible_in_agent_stats():
    """사용자가 실제로 쓴 에이전트는 Agents 탭에 이름으로 보여야 한다."""
    _send_execution(CHILD_AGENT, metadata={"parent_trace_id": str(uuid4()),
                                           "endpoint": "/stream/multi"})
    assert CHILD_AGENT in _agent_ids(), "하위 에이전트가 Agents 탭에 없음"
    print("PASS child_execution_visible_in_agent_stats")


def test_multi_wrapper_excluded_from_agent_stats():
    """multi 는 오케스트레이션 껍데기 — 에이전트로 표시하지 않는다."""
    _send_execution(PARENT_AGENT, metadata={"endpoint": "/stream/multi"},
                    agent_name="multi-agent orchestration")
    assert PARENT_AGENT not in _agent_ids(), "multi 래퍼가 Agents 탭에 노출됨"
    print("PASS multi_wrapper_excluded_from_agent_stats")


def test_active_agents_counts_child_only_agent():
    """멀티로만 쓴 에이전트도 '활성 에이전트'로 세야 한다.

    요약의 다른 값은 요청 수 기준이지만 active_agents 만은 Agents 탭과
    같은 모집단이어야 한다 — 아니면 두 숫자가 서로 다른 값을 가리킨다.
    """
    # distinct 카운트라 이번 실행에서 처음 등장하는 이름이어야 증가를 관측할 수 있다
    fresh_agent = f"__vis_test_child_{uuid4().hex[:8]}__"
    before = _summary_active_agents()
    _send_execution(fresh_agent, metadata={"parent_trace_id": str(uuid4()),
                                           "endpoint": "/stream/multi"})
    after = _summary_active_agents()
    assert after == before + 1, f"자식 전용 에이전트 미집계: {before} → {after}"
    print("PASS active_agents_counts_child_only_agent")


def test_active_agents_excludes_multi_wrapper():
    """multi 래퍼는 에이전트가 아니므로 활성 수에 들어가면 안 된다."""
    before = _summary_active_agents()
    _send_execution(PARENT_AGENT, metadata={"endpoint": "/stream/multi"},
                    agent_name="multi-agent orchestration")
    after = _summary_active_agents()
    assert after == before, f"multi 가 활성 에이전트로 집계됨: {before} → {after}"
    print("PASS active_agents_excludes_multi_wrapper")


def test_summary_still_returns_all_fields():
    """active_agents 전용 조회가 실패해도 요약 전체가 무너지면 안 된다."""
    summary = _req("/api/v1/dashboard?period=1h")["summary"]
    for key in ("total_calls", "success_rate", "avg_duration_ms",
                "total_tokens", "total_cost_usd", "active_agents"):
        assert key in summary, f"요약 필드 누락: {key}"
    print("PASS summary_still_returns_all_fields")


def _cleanup():
    # LIKE 의 '_' 는 와일드카드라 left() 로 접두사를 비교한다
    for table in ("agent_executions", "daily_stats"):
        asyncio.run(_exec_sql(
            f"DELETE FROM logosus.{table} WHERE left(agent_id, 10) = '__vis_test'"))
    # 테스트가 만든 multi 행만 삭제 (실제 운영 multi 행은 보존)
    asyncio.run(_exec_sql(
        "DELETE FROM logosus.agent_executions"
        " WHERE agent_id = 'multi' AND agent_name = 'multi-agent orchestration'"
        "   AND created_at > now() - interval '10 minutes'"))


if __name__ == "__main__":
    try:
        test_plain_execution_counted_in_summary()
        test_child_execution_excluded_from_summary()
        test_child_execution_visible_in_agent_stats()
        test_multi_wrapper_excluded_from_agent_stats()
        test_active_agents_counts_child_only_agent()
        test_active_agents_excludes_multi_wrapper()
        test_summary_still_returns_all_fields()
        print("\n✅ 가시성 집계 테스트 7/7 통과")
    finally:
        _cleanup()
        print("🧹 테스트 데이터 정리 완료")

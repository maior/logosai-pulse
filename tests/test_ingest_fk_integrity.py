"""ingest FK 정합성 통합 테스트 (2026-07-18).

배경: llm_calls 는 에이전트 실행 '도중' 전송되는데 부모 execution 레코드는
      실행이 '끝난 뒤' 기록된다 (sse_handlers.py:574). 자식이 항상 먼저 도착해
      FK 위반으로 100% 유실됐고, 서버는 200 OK 를 반환해 이를 숨겼다.
      → 대시보드 토큰/비용이 항상 0 이던 근본 원인.

실행 중인 LogosPulse(:8095) 와 실제 DB 를 상대로 검증한다.
직접 실행: python tests/test_ingest_fk_integrity.py
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
TEST_AGENT = "__pulse_fk_test__"   # 정리 기준 — 실제 데이터와 절대 겹치지 않음
_created_exec_ids: list[str] = []


def _post(path: str, payload: dict) -> tuple[int, dict]:
    """(status, body) 반환. 4xx/5xx 도 예외 없이 돌려준다."""
    req = urllib.request.Request(
        f"{BASE}{path}",
        data=json.dumps(payload).encode(),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            return resp.status, json.loads(resp.read() or b"{}")
    except urllib.error.HTTPError as e:
        return e.code, {"body": e.read().decode()[:300]}


async def _query(sql: str, *args):
    import asyncpg
    dsn = settings.database_url.replace("postgresql+asyncpg://", "postgresql://")
    conn = await asyncpg.connect(dsn)
    try:
        return await conn.fetch(sql, *args)
    finally:
        await conn.close()


def _fetch(sql: str, *args):
    return asyncio.run(_query(sql, *args))


def _new_exec_id() -> str:
    eid = str(uuid4())
    _created_exec_ids.append(eid)
    return eid


# ── 테스트 ────────────────────────────────────────────────
def test_llm_call_before_execution_is_persisted():
    """자식이 부모보다 먼저 도착해도 저장돼야 한다 (실제 운영 순서)."""
    eid = _new_exec_id()
    status, _ = _post("/api/v1/ingest/llm-call", {
        "execution_id": eid, "agent_id": TEST_AGENT,
        "model": "gemini-2.5-flash-lite", "provider": "google",
        "input_tokens": 100, "output_tokens": 50, "duration_ms": 123.0,
    })
    assert status == 200, f"HTTP {status}"

    rows = _fetch("SELECT total_tokens FROM logosus.llm_calls WHERE execution_id = $1", eid)
    assert len(rows) == 1, f"llm_call 유실 (FK 위반 추정): {len(rows)}건"
    assert rows[0]["total_tokens"] == 150
    print("PASS llm_call_before_execution_is_persisted")


def test_execution_upsert_preserves_accumulated_cost():
    """뒤늦게 도착한 execution 이 llm_call 이 쌓아둔 토큰/비용을 지우면 안 된다."""
    eid = _new_exec_id()
    _post("/api/v1/ingest/llm-call", {
        "execution_id": eid, "agent_id": TEST_AGENT, "model": "gemini-2.5-flash-lite",
        "input_tokens": 200, "output_tokens": 100,
    })
    # ACP 는 최종 execution 에 token_count=0 을 보낸다 — 덮어쓰기 금지 지점
    status, _ = _post("/api/v1/ingest/execution", {
        "execution_id": eid, "agent_id": TEST_AGENT, "agent_name": "FK 테스트",
        "query": "테스트 쿼리", "success": True, "duration_ms": 900.0, "token_count": 0,
    })
    assert status == 200, f"HTTP {status}"

    rows = _fetch(
        "SELECT agent_name, query, duration_ms, token_count, cost_usd, metadata_json"
        " FROM logosus.agent_executions WHERE id = $1", eid)
    assert len(rows) == 1, f"execution 행 {len(rows)}건 (1건이어야 함)"
    r = rows[0]
    assert r["agent_name"] == "FK 테스트", f"설명 필드 미반영: {r['agent_name']}"
    assert r["duration_ms"] == 900.0, "duration 미반영"
    assert r["token_count"] == 300, f"누적 토큰 유실: {r['token_count']} (300 이어야 함)"
    assert r["cost_usd"] > 0, "누적 비용 유실"
    meta = r["metadata_json"] or {}
    if isinstance(meta, str):
        meta = json.loads(meta)
    assert not meta.get("placeholder"), "placeholder 플래그가 남아 있음"
    print("PASS execution_upsert_preserves_accumulated_cost")


def test_duplicate_execution_does_not_lose_record():
    """같은 id 재전송 시 PK 충돌로 유실되지 않고 갱신돼야 한다."""
    eid = _new_exec_id()
    _post("/api/v1/ingest/execution", {
        "execution_id": eid, "agent_id": TEST_AGENT, "agent_name": "first",
        "success": True, "duration_ms": 100.0,
    })
    status, _ = _post("/api/v1/ingest/execution", {
        "execution_id": eid, "agent_id": TEST_AGENT, "agent_name": "second",
        "success": False, "duration_ms": 200.0, "error_message": "재전송",
    })
    assert status == 200, f"HTTP {status}"

    rows = _fetch(
        "SELECT agent_name, success, duration_ms FROM logosus.agent_executions WHERE id = $1", eid)
    assert len(rows) == 1, f"중복 행 {len(rows)}건"
    assert rows[0]["agent_name"] == "second", "재전송분이 반영되지 않음"
    assert rows[0]["success"] is False
    print("PASS duplicate_execution_does_not_lose_record")


def test_llm_call_without_execution_id_accepted():
    """trace_id 가 없으면 execution_id=None 이 전송된다 — 422 로 거부하면 안 된다."""
    status, _ = _post("/api/v1/ingest/llm-call", {
        "execution_id": None, "agent_id": TEST_AGENT,
        "model": "gemini-2.5-flash-lite", "input_tokens": 10, "output_tokens": 5,
    })
    assert status == 200, f"HTTP {status} — None 을 거부함 (422 회귀)"

    rows = _fetch(
        "SELECT count(*) c FROM logosus.llm_calls"
        " WHERE agent_id = $1 AND execution_id IS NULL", TEST_AGENT)
    assert rows[0]["c"] >= 1, "execution_id 없는 llm_call 미저장"
    print("PASS llm_call_without_execution_id_accepted")


def _cleanup():
    """테스트가 만든 행만 삭제 — 실제 운영 데이터는 건드리지 않는다."""
    asyncio.run(_query("DELETE FROM logosus.llm_calls WHERE agent_id = $1", TEST_AGENT))
    asyncio.run(_query("DELETE FROM logosus.agent_executions WHERE agent_id = $1", TEST_AGENT))
    asyncio.run(_query("DELETE FROM logosus.daily_stats WHERE agent_id = $1", TEST_AGENT))


if __name__ == "__main__":
    try:
        test_llm_call_before_execution_is_persisted()
        test_execution_upsert_preserves_accumulated_cost()
        test_duplicate_execution_does_not_lose_record()
        test_llm_call_without_execution_id_accepted()
        print("\n✅ ingest FK 정합성 테스트 4/4 통과")
    finally:
        _cleanup()
        print("🧹 테스트 데이터 정리 완료")

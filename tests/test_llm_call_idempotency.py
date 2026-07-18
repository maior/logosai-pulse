"""llm_call 재전송 멱등성 테스트 (2026-07-19).

배경: 버퍼링/재전송(Phase 3)의 전제 조건. llm_call 은 서버가 UUID 를 생성해
      재전송할 때마다 새 행이 생기고, 부모 execution 의 토큰/비용 누적까지
      다시 돌아 '비용 2배' 가 된다. 클라이언트 발급 call_id 로 멱등화한다.

직접 실행: python tests/test_llm_call_idempotency.py
"""

import asyncio
import json
import os
import sys
import urllib.request
from uuid import uuid4

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from app.config import settings

BASE = os.getenv("PULSE_TEST_URL", "http://localhost:8095")
TEST_AGENT = "__idem_test__"


def _post(path: str, payload: dict):
    req = urllib.request.Request(
        f"{BASE}{path}", data=json.dumps(payload).encode(),
        headers={"Content-Type": "application/json"}, method="POST",
    )
    with urllib.request.urlopen(req, timeout=10) as resp:
        return json.loads(resp.read() or b"{}")


async def _q(sql: str, *args):
    import asyncpg
    dsn = settings.database_url.replace("postgresql+asyncpg://", "postgresql://")
    conn = await asyncpg.connect(dsn)
    try:
        return await conn.fetch(sql, *args)
    finally:
        await conn.close()


def _fetch(sql: str, *args):
    return asyncio.run(_q(sql, *args))


def test_same_call_id_inserted_once():
    """같은 call_id 를 두 번 보내도 행은 하나여야 한다."""
    call_id, exec_id = str(uuid4()), str(uuid4())
    payload = {
        "call_id": call_id, "execution_id": exec_id, "agent_id": TEST_AGENT,
        "model": "gemini-2.5-flash-lite", "input_tokens": 100, "output_tokens": 50,
    }
    _post("/api/v1/ingest/llm-call", payload)
    _post("/api/v1/ingest/llm-call", payload)  # 재전송

    rows = _fetch("SELECT count(*) c FROM logosus.llm_calls WHERE id = $1", call_id)
    assert rows[0]["c"] == 1, f"재전송으로 중복 생성: {rows[0]['c']}건"
    print("PASS same_call_id_inserted_once")


def test_resend_does_not_double_count_cost():
    """재전송이 부모 execution 의 토큰/비용을 두 번 누적하면 안 된다."""
    call_id, exec_id = str(uuid4()), str(uuid4())
    payload = {
        "call_id": call_id, "execution_id": exec_id, "agent_id": TEST_AGENT,
        "model": "gemini-2.5-flash-lite", "input_tokens": 200, "output_tokens": 100,
    }
    _post("/api/v1/ingest/llm-call", payload)
    first = _fetch("SELECT token_count, cost_usd FROM logosus.agent_executions WHERE id = $1", exec_id)[0]
    _post("/api/v1/ingest/llm-call", payload)  # 재전송
    second = _fetch("SELECT token_count, cost_usd FROM logosus.agent_executions WHERE id = $1", exec_id)[0]

    assert first["token_count"] == 300, f"최초 누적 오류: {first['token_count']}"
    assert second["token_count"] == first["token_count"], (
        f"재전송으로 토큰 이중 계상: {first['token_count']} → {second['token_count']}")
    assert second["cost_usd"] == first["cost_usd"], "재전송으로 비용 이중 계상"
    print("PASS resend_does_not_double_count_cost")


def test_call_id_omitted_still_works():
    """call_id 미지정(기존 발신자) 은 서버가 발급해 그대로 동작해야 한다."""
    exec_id = str(uuid4())
    _post("/api/v1/ingest/llm-call", {
        "execution_id": exec_id, "agent_id": TEST_AGENT,
        "model": "gemini-2.5-flash-lite", "input_tokens": 10, "output_tokens": 5,
    })
    rows = _fetch("SELECT count(*) c FROM logosus.llm_calls WHERE execution_id = $1", exec_id)
    assert rows[0]["c"] == 1, "call_id 없는 legacy 경로가 깨짐"
    print("PASS call_id_omitted_still_works")


def _cleanup():
    asyncio.run(_q("DELETE FROM logosus.llm_calls WHERE agent_id = $1", TEST_AGENT))
    asyncio.run(_q("DELETE FROM logosus.agent_executions WHERE agent_id = $1", TEST_AGENT))
    asyncio.run(_q("DELETE FROM logosus.daily_stats WHERE agent_id = $1", TEST_AGENT))


if __name__ == "__main__":
    try:
        test_same_call_id_inserted_once()
        test_resend_does_not_double_count_cost()
        test_call_id_omitted_still_works()
        print("\n✅ llm_call 멱등성 테스트 3/3 통과")
    finally:
        _cleanup()
        print("🧹 테스트 데이터 정리 완료")

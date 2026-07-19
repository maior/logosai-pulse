"""runtime_events 수집 테스트 (2026-07-19).

배경: 장애를 가장 직접적으로 알려주는 신호들이 전부 휘발하고 있었다.
  - CircuitBreaker 상태 전이 → 인메모리, logger.warning 한 줄이 유일한 흔적
  - EvolutionMonitor 배포 후 헬스/자동 롤백 → 인메모리, 재시작 시 소멸
  - 인터랙션(confirm/select/form) → 응답 직후 pop, 값이 로그에도 안 남음

성공 데이터는 넘치는데 실패 신호만 버려지고 있었다.

직접 실행: python tests/test_runtime_events.py
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
TEST_SOURCE = "__event_test__"


def _post(path: str, payload: dict) -> tuple[int, dict]:
    req = urllib.request.Request(
        f"{BASE}{path}", data=json.dumps(payload).encode(),
        headers={"Content-Type": "application/json"}, method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            return resp.status, json.loads(resp.read() or b"{}")
    except urllib.error.HTTPError as e:
        return e.code, {"body": e.read().decode()[:300]}


def _get(path: str):
    with urllib.request.urlopen(f"{BASE}{path}", timeout=10) as resp:
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


# ── 테스트 ────────────────────────────────────────────────
def test_event_is_persisted():
    """휘발하던 이벤트가 DB 에 남아야 한다."""
    eid = str(uuid4())
    status, _ = _post("/api/v1/ingest/event", {
        "event_id": eid, "event_type": "circuit_breaker.opened",
        "source": TEST_SOURCE, "agent_id": "weather_agent", "severity": "warning",
        "payload": {"name": "acp.weather_agent", "failures": 5, "threshold": 5},
    })
    assert status == 200, f"HTTP {status}"

    rows = _fetch("SELECT event_type, agent_id, severity, payload"
                  " FROM logosus.runtime_events WHERE id = $1", eid)
    assert len(rows) == 1, f"이벤트 미저장: {len(rows)}건"
    r = rows[0]
    assert r["event_type"] == "circuit_breaker.opened"
    assert r["agent_id"] == "weather_agent"
    payload = r["payload"] if isinstance(r["payload"], dict) else json.loads(r["payload"])
    assert payload["failures"] == 5, "payload 유실"
    print("PASS event_is_persisted")


def test_duplicate_event_id_stored_once():
    """스풀 재전송이 중복 이벤트를 만들면 안 된다 (멱등)."""
    eid = str(uuid4())
    body = {
        "event_id": eid, "event_type": "evolution.rollback",
        "source": TEST_SOURCE, "agent_id": "file_agent",
        "payload": {"failure_rate": 0.8},
    }
    _post("/api/v1/ingest/event", body)
    _post("/api/v1/ingest/event", body)   # 재전송

    rows = _fetch("SELECT count(*) c FROM logosus.runtime_events WHERE id = $1", eid)
    assert rows[0]["c"] == 1, f"재전송으로 중복 생성: {rows[0]['c']}건"
    print("PASS duplicate_event_id_stored_once")


def test_event_id_optional():
    """event_id 미지정이어도 서버가 발급해 저장돼야 한다."""
    status, body = _post("/api/v1/ingest/event", {
        "event_type": "interaction.timeout", "source": TEST_SOURCE,
        "payload": {"type": "confirm"},
    })
    assert status == 200, f"HTTP {status}"
    assert body.get("event_id"), "event_id 미반환"
    print("PASS event_id_optional")


def test_events_api_filters_by_type():
    """이벤트 조회 API 가 종류별로 걸러줘야 한다."""
    marker = f"circuit_breaker.opened"
    _post("/api/v1/ingest/event", {
        "event_id": str(uuid4()), "event_type": marker,
        "source": TEST_SOURCE, "agent_id": "filter_probe",
        "payload": {},
    })
    out = _get(f"/api/v1/events?event_type={marker}&limit=50")
    events = out.get("events", [])
    assert events, "필터 결과 없음"
    assert all(e["event_type"] == marker for e in events), "다른 종류가 섞임"
    print("PASS events_api_filters_by_type")


def test_events_api_returns_newest_first():
    """최근 장애 신호를 먼저 봐야 한다."""
    out = _get("/api/v1/events?limit=10")
    events = out.get("events", [])
    if len(events) >= 2:
        assert events[0]["created_at"] >= events[1]["created_at"], "최신순 아님"
    print("PASS events_api_returns_newest_first")


def _cleanup():
    asyncio.run(_q("DELETE FROM logosus.runtime_events WHERE source = $1", TEST_SOURCE))


if __name__ == "__main__":
    try:
        test_event_is_persisted()
        test_duplicate_event_id_stored_once()
        test_event_id_optional()
        test_events_api_filters_by_type()
        test_events_api_returns_newest_first()
        print("\n✅ runtime_events 테스트 5/5 통과")
    finally:
        _cleanup()
        print("🧹 테스트 데이터 정리 완료")

"""TDD: /api/v1/test_runs endpoints.

JSONL 파일 기반 (~/.logosai/test_runs.jsonl) 으로 가벼운 test run 기록.
"""
import os
import sys
import json
import urllib.request
import urllib.error
import tempfile

BASE = "http://localhost:8095"


def _get(path: str):
    req = urllib.request.Request(f"{BASE}{path}")
    with urllib.request.urlopen(req, timeout=5) as resp:
        return resp.status, json.loads(resp.read().decode())


def _post(path: str, body: dict):
    req = urllib.request.Request(
        f"{BASE}{path}",
        data=json.dumps(body).encode(),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=5) as resp:
        return resp.status, json.loads(resp.read().decode())


def test_list_returns_array():
    status, data = _get("/api/v1/test_runs?limit=5")
    assert status == 200
    assert isinstance(data, list)
    print(f"  OK list: {len(data)} items")


def test_ingest_then_list_roundtrip():
    """POST 한 record → GET 으로 보임."""
    record = {
        "suite": "test_smoke",
        "scenario": "single_agent",
        "query": "현재 시간 알려줘",
        "expected_pattern": "single",
        "actual_pattern": "single",
        "actual_agents": ["scheduler_agent"],
        "passed": True,
        "latency_ms": 1234,
        "trace_id": "00000000-0000-0000-0000-000000000abc",
        "issues": [],
    }
    status, resp = _post("/api/v1/ingest/test_run", record)
    assert status == 200
    assert resp.get("ok") is True
    print(f"  OK ingest: id={resp.get('id', '?')}")

    # 즉시 list 조회 — 방금 넣은 record 가 보임
    _, items = _get("/api/v1/test_runs?suite=test_smoke&limit=10")
    matching = [i for i in items if i.get("query") == "현재 시간 알려줘"]
    assert len(matching) >= 1, f"ingested record not found in {len(items)} items"
    print(f"  OK roundtrip: {len(matching)} matching records")


def test_summary_endpoint():
    """suite 별 pass rate 요약."""
    status, data = _get("/api/v1/test_runs/summary?suite=test_smoke")
    assert status == 200
    required = {"suite", "total", "passed", "failed", "pass_rate"}
    missing = required - set(data.keys())
    assert not missing, f"missing keys: {missing}"
    print(f"  OK summary: {data['total']} runs, pass_rate={data['pass_rate']}")


def test_invalid_record_rejected():
    """필수 필드 빠진 record 는 422."""
    try:
        _post("/api/v1/ingest/test_run", {"foo": "bar"})
        assert False, "should reject incomplete record"
    except urllib.error.HTTPError as e:
        assert e.code == 422, f"expected 422, got {e.code}"
        print(f"  OK validation: {e.code}")


if __name__ == "__main__":
    tests = [
        test_list_returns_array,
        test_ingest_then_list_roundtrip,
        test_summary_endpoint,
        test_invalid_record_rejected,
    ]
    failed = 0
    for t in tests:
        try:
            print(f"▶ {t.__name__}")
            t()
        except AssertionError as e:
            print(f"  ❌ FAIL: {e}")
            failed += 1
        except Exception as e:
            print(f"  💥 ERROR: {type(e).__name__}: {e}")
            failed += 1
    if failed:
        print(f"\n{failed}/{len(tests)} failed")
        sys.exit(1)
    print(f"\n✅ {len(tests)}/{len(tests)} passed")

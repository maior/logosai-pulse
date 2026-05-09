"""Smoke test: /api/v1/forge/conversations endpoints.

전제: LogosPulse 가 8095 에서 기동 중.
"""
import sys
import json
import urllib.request
import urllib.error

BASE = "http://localhost:8095"


def _get(path: str):
    req = urllib.request.Request(f"{BASE}{path}")
    with urllib.request.urlopen(req, timeout=5) as resp:
        return resp.status, json.loads(resp.read().decode())


def test_list_conversations_returns_list():
    status, data = _get("/api/v1/forge/conversations?period=24h&limit=10")
    assert status == 200, f"HTTP {status}"
    assert isinstance(data, list), f"expected list, got {type(data)}"
    print(f"  OK list_conversations: {len(data)} items")


def test_list_conversations_period_validation():
    # invalid period 은 422 (FastAPI Query regex)
    try:
        _get("/api/v1/forge/conversations?period=invalid")
        assert False, "should reject invalid period"
    except urllib.error.HTTPError as e:
        assert e.code == 422, f"expected 422, got {e.code}"
        print(f"  OK period validation: {e.code}")


def test_list_conversations_limit_validation():
    try:
        _get("/api/v1/forge/conversations?limit=999")
        assert False, "should reject limit > 200"
    except urllib.error.HTTPError as e:
        assert e.code == 422, f"expected 422, got {e.code}"
        print(f"  OK limit validation: {e.code}")


def test_get_conversation_not_found():
    # 임의 UUID — 존재하지 않으면 {"error": "not_found"}
    status, data = _get("/api/v1/forge/conversations/00000000-0000-0000-0000-000000000000")
    assert status == 200, f"HTTP {status}"
    assert data.get("error") == "not_found", f"expected not_found, got {data}"
    print(f"  OK not_found handling")


def test_summary_shape_when_data_exists():
    """데이터가 있으면 summary 형태가 올바른지."""
    _, items = _get("/api/v1/forge/conversations?period=30d&limit=1")
    if not items:
        print("  SKIP: no forge conversations in DB (expected for fresh setup)")
        return
    item = items[0]
    required = {"id", "trace_id", "started_at", "status", "trigger_query",
                "missing_capabilities", "result", "self_evolution"}
    missing = required - set(item.keys())
    assert not missing, f"missing keys: {missing}"
    print(f"  OK summary shape: all required keys present")


def test_detail_returns_new_v2_fields():
    """v2 신규 필드가 detail 응답에 포함되어야 함 (legacy data 면 빈 값이라도 키는 존재)."""
    _, items = _get("/api/v1/forge/conversations?period=30d&limit=1")
    if not items:
        print("  SKIP: no forge conversations in DB")
        return
    span_id = items[0]["id"]
    _, detail = _get(f"/api/v1/forge/conversations/{span_id}")
    required_v2 = {"negotiation_messages", "workflow_context",
                   "generated_code_preview", "generated_code_full_chars"}
    missing = required_v2 - set(detail.keys())
    assert not missing, f"missing v2 keys: {missing}"
    # 타입 검증
    assert isinstance(detail["negotiation_messages"], list)
    assert isinstance(detail["workflow_context"], dict)
    assert isinstance(detail["generated_code_preview"], str)
    assert isinstance(detail["generated_code_full_chars"], int)
    print(f"  OK v2 keys present: messages={len(detail['negotiation_messages'])}, "
          f"wc_keys={len(detail['workflow_context'])}, "
          f"code_chars={detail['generated_code_full_chars']}")


if __name__ == "__main__":
    tests = [
        test_list_conversations_returns_list,
        test_list_conversations_period_validation,
        test_list_conversations_limit_validation,
        test_get_conversation_not_found,
        test_summary_shape_when_data_exists,
        test_detail_returns_new_v2_fields,
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

"""federation_monitor 순수 집계 테스트 (2026-07-03).

직접 실행: python tests/test_federation_monitor.py
"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from app.services.federation_monitor import build_federation_live, parse_fed_agent

SPANS = [
    {"agent_id": "fed.instB.weather_agent", "status": "success", "duration_ms": 11887,
     "start_time": "2026-07-03T19:49:16", "output_preview": "# seoul 현재 날씨"},
    {"agent_id": "fed.instC.currency_exchange_agent", "status": "success", "duration_ms": 2624,
     "start_time": "2026-07-03T19:49:48", "output_preview": "# 환율 변환 결과"},
    {"agent_id": "fed.instA.math_agent", "status": "success", "duration_ms": 5716,
     "start_time": "2026-07-03T19:50:00", "output_preview": "# 곱셈 계산"},
    {"agent_id": "fed.instB.weather_agent", "status": "error", "duration_ms": 900,
     "start_time": "2026-07-03T19:51:00", "output_preview": "peer down"},
    {"agent_id": "weather_agent", "status": "success", "duration_ms": 100,
     "start_time": "2026-07-03T19:52:00"},  # 비연합 — 무시돼야 함
]


def test_parse_fed_agent():
    assert parse_fed_agent("fed.instB.weather_agent") == ("instB", "weather_agent")
    assert parse_fed_agent("weather_agent") is None
    assert parse_fed_agent("fed.broken") is None
    print("PASS parse")


def test_institutions_aggregated():
    out = build_federation_live(SPANS)
    assert out["totals"]["institutions"] == 3
    assert out["totals"]["transactions"] == 4  # 비연합 span 제외
    by_id = {i["peer_id"]: i for i in out["institutions"]}
    b = by_id["instB"]
    assert b["calls"] == 2 and b["error_count"] == 1 and b["success_rate"] == 0.5
    assert b["avg_ms"] == (11887 + 900) // 2
    assert by_id["instC"]["success_rate"] == 1.0
    # 호출량 내림차순
    assert out["institutions"][0]["peer_id"] == "instB"
    print("PASS institutions")


def test_transactions_latest_first():
    out = build_federation_live(SPANS)
    tx = out["transactions"]
    assert tx[0]["peer_id"] == "instB" and tx[0]["status"] == "error"  # 19:51 최신
    assert tx[-1]["agent_id"] == "weather_agent" and tx[-1]["peer_id"] == "instB"  # 19:49:16
    assert all("fed." not in t["agent_id"] for t in tx)  # 네임스페이스 제거된 원격 id
    print("PASS transactions")


def test_empty_input():
    out = build_federation_live([])
    assert out["totals"] == {"institutions": 0, "transactions": 0, "success": 0}
    print("PASS empty")


if __name__ == "__main__":
    fails = []
    for fn in [test_parse_fed_agent, test_institutions_aggregated,
               test_transactions_latest_first, test_empty_input]:
        try:
            fn()
        except Exception as e:
            fails.append(fn.__name__)
            print(f"FAIL {fn.__name__}: {e}")
    print("RESULT:", "GREEN" if not fails else f"RED ({fails})")
    sys.exit(1 if fails else 0)

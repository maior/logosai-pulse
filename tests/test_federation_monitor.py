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


def test_institution_agent_breakdown():
    """전략 탭: 각 기관이 호출한 에이전트별 분해가 있어야 한다."""
    out = build_federation_live(SPANS)
    by_id = {i["peer_id"]: i for i in out["institutions"]}
    # instB 는 weather_agent 를 2회 (성공1 + 실패1)
    agents_b = by_id["instB"]["agents"]
    assert agents_b == [{"agent_id": "weather_agent", "calls": 2}], agents_b
    assert by_id["instA"]["agents"] == [{"agent_id": "math_agent", "calls": 1}]
    print("PASS agent-breakdown")


def test_timeline_buckets():
    """전략 탭: 시간대별 위임 트래픽 버킷 (성공/실패 분리)."""
    out = build_federation_live(SPANS)
    tl = out["timeline"]
    assert isinstance(tl, list) and tl, "timeline 비어있음"
    # 각 버킷: hour, success, error
    total_s = sum(b["success"] for b in tl)
    total_e = sum(b["error"] for b in tl)
    assert total_s == 3 and total_e == 1  # SPANS 중 연합 4건 (성공3 실패1)
    assert all("hour" in b for b in tl)
    print("PASS timeline")


def test_transaction_has_request_and_detail():
    """트랜잭션에 요청(input)과 결과/원인(detail) — 성공은 결과, 실패는 에러 원인."""
    spans = [
        {"agent_id": "fed.instB.weather_agent", "status": "success", "duration_ms": 100,
         "start_time": "2026-07-03T12:00:00", "input_preview": "서울 날씨 알려줘",
         "output_preview": "서울 25도 맑음"},
        {"agent_id": "fed.instC.x_agent", "status": "error", "duration_ms": 50,
         "start_time": "2026-07-03T12:01:00", "input_preview": "환율 계산",
         "output_preview": "peer 'instC' circuit open"},
    ]
    out = build_federation_live(spans)
    tx = {t["agent_id"]: t for t in out["transactions"]}
    assert tx["weather_agent"]["input"] == "서울 날씨 알려줘"
    assert tx["weather_agent"]["detail"] == "서울 25도 맑음"
    # 실패 건: detail 에 에러 원인
    assert "circuit open" in tx["x_agent"]["detail"]
    assert tx["x_agent"]["status"] == "error"
    print("PASS tx-request-detail")


def test_timeline_continuous_fills_gaps():
    """now 주입 시 timeline 은 윈도우 내 모든 시간 버킷을 0 포함 연속으로 반환."""
    spans = [
        {"agent_id": "fed.instA.math_agent", "status": "success", "duration_ms": 100,
         "start_time": "2026-07-03T12:30:00+00:00"},
    ]
    # now=15시 UTC, 윈도우 4시간 → 12,13,14,15 (4버킷), 데이터는 12시에만
    out = build_federation_live(spans, now_utc="2026-07-03T15:00:00+00:00", window_hours=4)
    tl = out["timeline"]
    hours = [b["hour"] for b in tl]
    assert hours == ["2026-07-03T12", "2026-07-03T13", "2026-07-03T14", "2026-07-03T15"], hours
    assert tl[0]["success"] == 1 and tl[1]["success"] == 0  # 빈 시간대는 0
    print("PASS timeline-continuous")


def test_empty_input():
    out = build_federation_live([])
    assert out["totals"] == {"institutions": 0, "transactions": 0, "success": 0}
    print("PASS empty")


if __name__ == "__main__":
    fails = []
    for fn in [test_parse_fed_agent, test_institutions_aggregated,
               test_transactions_latest_first, test_institution_agent_breakdown,
               test_timeline_buckets, test_transaction_has_request_and_detail, test_timeline_continuous_fills_gaps, test_empty_input]:
        try:
            fn()
        except Exception as e:
            fails.append(fn.__name__)
            print(f"FAIL {fn.__name__}: {e}")
    print("RESULT:", "GREEN" if not fails else f"RED ({fails})")
    sys.exit(1 if fails else 0)

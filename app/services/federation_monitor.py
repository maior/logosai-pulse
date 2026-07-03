"""Federation 실시간 모니터링 집계 — stage=federation span → 기관/트랜잭션 뷰.

순수 함수 (DB 비결합) — journey_builder 와 동일한 테스트 전략.
연합 에이전트 id 규약: fed.<peer_id>.<agent_id> (logos_api app/federation).
"""
from typing import Any, Dict, List


def parse_fed_agent(agent_id: str):
    """'fed.<peer>.<agent>' → (peer, agent). 규약 외 형식이면 None."""
    if not str(agent_id or "").startswith("fed."):
        return None
    rest = str(agent_id)[4:]
    if "." not in rest:
        return None
    peer, agent = rest.split(".", 1)
    return (peer, agent) if peer and agent else None


def _hour_key(iso: str) -> str:
    return iso[:13] if len(iso) >= 13 else iso


def _continuous_hours(now_utc: str, window_hours: int) -> List[str]:
    """now(UTC) 기준 window_hours 전까지 시간별 키 목록 (연속, 오래된 것부터)."""
    from datetime import datetime, timedelta, timezone
    try:
        base = datetime.fromisoformat(now_utc.replace("Z", "+00:00"))
    except (ValueError, AttributeError):
        return []
    base = base.replace(minute=0, second=0, microsecond=0)
    return [ (base - timedelta(hours=window_hours - 1 - i)).strftime("%Y-%m-%dT%H")
             for i in range(window_hours) ]


def build_federation_live(spans: List[Dict[str, Any]],
                          now_utc: str = None,
                          window_hours: int = 24) -> Dict[str, Any]:
    """federation span 목록 → {institutions, transactions, timeline, totals}.

    전략 모니터링용 확장 (2026-07-03): 기관별 에이전트 분해(agents) +
    시간대별 트래픽 버킷(timeline).

    Args:
        spans: dict 목록 — agent_id, status, duration_ms, start_time(iso str),
               output_preview(선택). 최신순 정렬 가정하지 않음 (여기서 정렬).
        now_utc: 주입 시 timeline 을 now 기준 window_hours 연속 버킷(0 채움)으로
               반환 — 추이 차트가 빈 구간도 보이도록. None 이면 데이터 버킷만.
        window_hours: 연속 timeline 윈도우 (시간).
    """
    institutions: Dict[str, Dict[str, Any]] = {}
    transactions: List[Dict[str, Any]] = []
    timeline: Dict[str, Dict[str, int]] = {}

    for s in spans:
        parsed = parse_fed_agent(s.get("agent_id", ""))
        if not parsed:
            continue
        peer, agent = parsed
        ok = str(s.get("status", "")) == "success"
        ts = str(s.get("start_time", "") or "")

        inst = institutions.setdefault(peer, {
            "peer_id": peer, "calls": 0, "success": 0, "error": 0,
            "total_ms": 0, "last_seen": "", "agent_counts": {},
        })
        inst["calls"] += 1
        inst["success" if ok else "error"] += 1
        inst["total_ms"] += int(s.get("duration_ms") or 0)
        inst["agent_counts"][agent] = inst["agent_counts"].get(agent, 0) + 1
        if ts > inst["last_seen"]:
            inst["last_seen"] = ts

        # 시간대(시각의 앞 13자 = 'YYYY-MM-DDTHH') 버킷
        hour = ts[:13] if len(ts) >= 13 else ts
        bucket = timeline.setdefault(hour, {"success": 0, "error": 0})
        bucket["success" if ok else "error"] += 1

        transactions.append({
            "ts": ts,
            "peer_id": peer,
            "agent_id": agent,
            "status": s.get("status", ""),
            "duration_ms": int(s.get("duration_ms") or 0),
            # 요청(무엇을 위임했나) + 결과/원인(성공=응답 요약, 실패=에러 원인)
            "input": str(s.get("input_preview", "") or "")[:160],
            "detail": str(s.get("output_preview", "") or "")[:200],
            "preview": str(s.get("output_preview", "") or "")[:80],  # 하위호환(hover)
        })

    transactions.sort(key=lambda t: t["ts"], reverse=True)
    inst_list = []
    for inst in institutions.values():
        calls = inst["calls"]
        agents = sorted(
            ({"agent_id": a, "calls": c} for a, c in inst["agent_counts"].items()),
            key=lambda x: x["calls"], reverse=True,
        )
        inst_list.append({
            "peer_id": inst["peer_id"],
            "calls": calls,
            "success_rate": round(inst["success"] / calls, 3) if calls else 0.0,
            "error_count": inst["error"],
            "avg_ms": int(inst["total_ms"] / calls) if calls else 0,
            "last_seen": inst["last_seen"],
            "agents": agents,
        })
    inst_list.sort(key=lambda i: i["calls"], reverse=True)

    if now_utc:
        # 연속 버킷: 윈도우 내 모든 시간을 0 채움 (추이 연속성)
        timeline_list = [
            {"hour": h, "success": timeline.get(h, {}).get("success", 0),
             "error": timeline.get(h, {}).get("error", 0)}
            for h in _continuous_hours(now_utc, window_hours)
        ]
    else:
        timeline_list = [
            {"hour": h, "success": v["success"], "error": v["error"]}
            for h, v in sorted(timeline.items())
        ]

    return {
        "institutions": inst_list,
        "transactions": transactions[:50],
        "timeline": timeline_list,
        "totals": {
            "institutions": len(inst_list),
            "transactions": len(transactions),
            "success": sum(1 for t in transactions if t["status"] == "success"),
        },
    }

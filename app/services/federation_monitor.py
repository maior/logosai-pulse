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


def build_federation_live(spans: List[Dict[str, Any]]) -> Dict[str, Any]:
    """federation span 목록 → {institutions, transactions, totals}.

    Args:
        spans: dict 목록 — agent_id, status, duration_ms, start_time(iso str),
               output_preview(선택). 최신순 정렬 가정하지 않음 (여기서 정렬).
    """
    institutions: Dict[str, Dict[str, Any]] = {}
    transactions: List[Dict[str, Any]] = []

    for s in spans:
        parsed = parse_fed_agent(s.get("agent_id", ""))
        if not parsed:
            continue
        peer, agent = parsed
        ok = str(s.get("status", "")) == "success"
        ts = str(s.get("start_time", "") or "")

        inst = institutions.setdefault(peer, {
            "peer_id": peer, "calls": 0, "success": 0, "error": 0,
            "total_ms": 0, "last_seen": "",
        })
        inst["calls"] += 1
        inst["success" if ok else "error"] += 1
        inst["total_ms"] += int(s.get("duration_ms") or 0)
        if ts > inst["last_seen"]:
            inst["last_seen"] = ts

        transactions.append({
            "ts": ts,
            "peer_id": peer,
            "agent_id": agent,
            "status": s.get("status", ""),
            "duration_ms": int(s.get("duration_ms") or 0),
            "preview": str(s.get("output_preview", "") or "")[:80],
        })

    transactions.sort(key=lambda t: t["ts"], reverse=True)
    inst_list = []
    for inst in institutions.values():
        calls = inst["calls"]
        inst_list.append({
            "peer_id": inst["peer_id"],
            "calls": calls,
            "success_rate": round(inst["success"] / calls, 3) if calls else 0.0,
            "error_count": inst["error"],
            "avg_ms": int(inst["total_ms"] / calls) if calls else 0,
            "last_seen": inst["last_seen"],
        })
    inst_list.sort(key=lambda i: i["calls"], reverse=True)

    return {
        "institutions": inst_list,
        "transactions": transactions[:50],
        "totals": {
            "institutions": len(inst_list),
            "transactions": len(transactions),
            "success": sum(1 for t in transactions if t["status"] == "success"),
        },
    }

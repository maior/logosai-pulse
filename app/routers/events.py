"""Events API — 런타임 이벤트 조회.

회로 차단 / 자동 롤백 / 사용자 인터랙션처럼 지금까지 인메모리로만 존재해
프로세스 재시작과 함께 사라지던 신호들을 시간순으로 되짚어 볼 수 있게 한다.
"""

import logging

from fastapi import APIRouter, Query
from sqlalchemy import text

from app.database import get_db_context

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/events", tags=["Events"])

_PERIOD_HOURS = {"1h": 1, "6h": 6, "24h": 24, "7d": 168, "30d": 720}


@router.get("")
async def list_events(
    limit: int = Query(100, ge=1, le=500),
    event_type: str = Query("", description="종류 필터 (circuit_breaker.opened 등)"),
    agent_id: str = Query(""),
    severity: str = Query("", description="info | warning | critical"),
    period: str = Query("24h"),
):
    """런타임 이벤트 목록 (최신순)."""
    hours = _PERIOD_HOURS.get(period, 24)
    where = ["created_at >= now() - make_interval(hours => :hours)"]
    params = {"hours": hours, "limit": limit}

    if event_type:
        where.append("event_type = :et")
        params["et"] = event_type
    if agent_id:
        where.append("agent_id = :aid")
        params["aid"] = agent_id
    if severity:
        where.append("severity = :sev")
        params["sev"] = severity

    sql = f"""
        SELECT id, event_type, source, agent_id, severity, payload, created_at
        FROM logosus.runtime_events
        WHERE {' AND '.join(where)}
        ORDER BY created_at DESC
        LIMIT :limit
    """
    try:
        async with get_db_context() as db:
            rows = (await db.execute(text(sql), params)).mappings().all()
        return {
            "events": [
                {
                    "id": str(r["id"]),
                    "event_type": r["event_type"],
                    "source": r["source"],
                    "agent_id": r["agent_id"],
                    "severity": r["severity"],
                    "payload": r["payload"] or {},
                    "created_at": r["created_at"].isoformat() if r["created_at"] else None,
                }
                for r in rows
            ],
            "count": len(rows),
        }
    except Exception as e:
        logger.warning(f"list_events failed: {e}")
        return {"events": [], "count": 0, "error": str(e)}


@router.get("/stats")
async def event_stats(period: str = Query("24h")):
    """종류·심각도별 집계 — 어떤 장애 신호가 얼마나 났는가."""
    hours = _PERIOD_HOURS.get(period, 24)
    try:
        async with get_db_context() as db:
            rows = (await db.execute(
                text("""
                    SELECT event_type, severity, count(*) AS n, max(created_at) AS last_seen
                    FROM logosus.runtime_events
                    WHERE created_at >= now() - make_interval(hours => :hours)
                    GROUP BY event_type, severity
                    ORDER BY n DESC
                """),
                {"hours": hours},
            )).mappings().all()
        return {
            "period": period,
            "by_type": [
                {
                    "event_type": r["event_type"],
                    "severity": r["severity"],
                    "count": r["n"],
                    "last_seen": r["last_seen"].isoformat() if r["last_seen"] else None,
                }
                for r in rows
            ],
            "total": sum(r["n"] for r in rows),
        }
    except Exception as e:
        logger.warning(f"event_stats failed: {e}")
        return {"period": period, "by_type": [], "total": 0, "error": str(e)}

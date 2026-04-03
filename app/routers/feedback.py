"""Feedback API — 사용자 👍/👎 수집 + 조회."""

import logging
from typing import Optional
from uuid import uuid4

from fastapi import APIRouter, Query
from pydantic import BaseModel

from app.database import get_db_context
from app.models.observability import UserFeedback

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/feedback", tags=["Feedback"])


class FeedbackRecord(BaseModel):
    execution_id: str = ""
    agent_id: str
    rating: int  # 1=good, -1=bad
    comment: str = ""
    query: str = ""
    user_email: str = ""


@router.post("")
async def submit_feedback(record: FeedbackRecord):
    """사용자 피드백 제출."""
    try:
        async with get_db_context() as db:
            fb = UserFeedback(
                id=str(uuid4()),
                execution_id=record.execution_id or None,
                agent_id=record.agent_id,
                rating=record.rating,
                comment=record.comment or None,
                query=record.query[:200] if record.query else None,
                user_email=record.user_email or None,
            )
            db.add(fb)
            await db.commit()
        return {"status": "ok", "feedback_id": fb.id}
    except Exception as e:
        logger.warning(f"Feedback save failed: {e}")
        return {"status": "error", "error": str(e)}


@router.get("")
async def get_feedback(agent_id: str = "", period: str = Query("24h"), limit: int = 50):
    """피드백 목록 조회."""
    from datetime import datetime, timezone, timedelta
    from sqlalchemy import select, desc

    periods = {"1h": 1, "6h": 6, "24h": 24, "7d": 168, "30d": 720}
    since = datetime.now(timezone.utc) - timedelta(hours=periods.get(period, 24))

    try:
        async with get_db_context() as db:
            query = (
                select(UserFeedback)
                .where(UserFeedback.created_at >= since)
                .order_by(desc(UserFeedback.created_at))
                .limit(limit)
            )
            if agent_id:
                query = query.where(UserFeedback.agent_id == agent_id)

            result = await db.execute(query)
            feedbacks = result.scalars().all()

            return [
                {
                    "id": f.id,
                    "agent_id": f.agent_id,
                    "rating": f.rating,
                    "comment": f.comment,
                    "query": f.query,
                    "created_at": f.created_at.isoformat() if f.created_at else None,
                }
                for f in feedbacks
            ]
    except Exception as e:
        logger.warning(f"Feedback query failed: {e}")
        return []


@router.get("/stats")
async def get_feedback_stats(period: str = Query("24h")):
    """에이전트별 피드백 통계."""
    from datetime import datetime, timezone, timedelta
    from sqlalchemy import select, func

    periods = {"1h": 1, "6h": 6, "24h": 24, "7d": 168, "30d": 720}
    since = datetime.now(timezone.utc) - timedelta(hours=periods.get(period, 24))

    try:
        async with get_db_context() as db:
            result = await db.execute(
                select(
                    UserFeedback.agent_id,
                    func.count(UserFeedback.id).label("total"),
                    func.count(UserFeedback.id).filter(UserFeedback.rating > 0).label("positive"),
                    func.count(UserFeedback.id).filter(UserFeedback.rating < 0).label("negative"),
                )
                .where(UserFeedback.created_at >= since)
                .group_by(UserFeedback.agent_id)
            )
            return [
                {
                    "agent_id": row.agent_id,
                    "total": row.total,
                    "positive": row.positive,
                    "negative": row.negative,
                    "satisfaction": round(row.positive / row.total, 2) if row.total > 0 else 0,
                }
                for row in result.all()
            ]
    except Exception as e:
        logger.warning(f"Feedback stats failed: {e}")
        return []

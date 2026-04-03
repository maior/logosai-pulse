"""LearningMetrics — Phase B: 학습 효과 측정.

개선 전후 성공률 비교, 에이전트별 학습 효과 수치화.
LogosPulse 메트릭 + 피드백 데이터 기반.

Usage:
    metrics = LearningMetrics()
    report = await metrics.get_agent_health_report()
    improvement = await metrics.measure_improvement("scheduler_agent")
"""

import logging
from datetime import datetime, timezone, timedelta
from typing import Any, Dict, List, Optional

from sqlalchemy import select, func, and_, desc, text

from app.database import get_db_context
from app.models.observability import AgentExecution, UserFeedback

logger = logging.getLogger(__name__)


class LearningMetrics:
    """학습 효과 측정 서비스."""

    async def get_agent_health_report(self, period: str = "24h") -> List[Dict]:
        """에이전트별 건강 리포트 — 성공률 + 피드백 + 트렌드."""
        hours = {"1h": 1, "6h": 6, "24h": 24, "7d": 168, "30d": 720}.get(period, 24)
        since = datetime.now(timezone.utc) - timedelta(hours=hours)
        prev_since = since - timedelta(hours=hours)  # 이전 기간 (비교용)

        try:
            async with get_db_context() as db:
                # 현재 기간 성공률
                current = await db.execute(
                    select(
                        AgentExecution.agent_id,
                        func.count(AgentExecution.id).label("total"),
                        func.count(AgentExecution.id).filter(AgentExecution.success == True).label("success"),
                        func.avg(AgentExecution.duration_ms).label("avg_duration"),
                    )
                    .where(AgentExecution.created_at >= since)
                    .group_by(AgentExecution.agent_id)
                )

                # 이전 기간 성공률 (트렌드 비교)
                previous = await db.execute(
                    select(
                        AgentExecution.agent_id,
                        func.count(AgentExecution.id).label("total"),
                        func.count(AgentExecution.id).filter(AgentExecution.success == True).label("success"),
                    )
                    .where(and_(
                        AgentExecution.created_at >= prev_since,
                        AgentExecution.created_at < since,
                    ))
                    .group_by(AgentExecution.agent_id)
                )

                prev_map = {r.agent_id: r for r in previous.all()}

                # 피드백
                feedback = await db.execute(
                    select(
                        UserFeedback.agent_id,
                        func.count(UserFeedback.id).filter(UserFeedback.rating > 0).label("positive"),
                        func.count(UserFeedback.id).filter(UserFeedback.rating < 0).label("negative"),
                    )
                    .where(UserFeedback.created_at >= since)
                    .group_by(UserFeedback.agent_id)
                )
                fb_map = {r.agent_id: r for r in feedback.all()}

                report = []
                for row in current.all():
                    cur_rate = row.success / row.total if row.total > 0 else 1.0
                    prev = prev_map.get(row.agent_id)
                    prev_rate = prev.success / prev.total if prev and prev.total > 0 else None
                    fb = fb_map.get(row.agent_id)

                    trend = "stable"
                    if prev_rate is not None:
                        diff = cur_rate - prev_rate
                        if diff > 0.05:
                            trend = "improving"
                        elif diff < -0.05:
                            trend = "degrading"

                    health = "healthy"
                    if cur_rate < 0.5:
                        health = "critical"
                    elif cur_rate < 0.7:
                        health = "degraded"
                    elif cur_rate < 0.9:
                        health = "warning"

                    report.append({
                        "agent_id": row.agent_id,
                        "health": health,
                        "current_success_rate": round(cur_rate, 3),
                        "previous_success_rate": round(prev_rate, 3) if prev_rate is not None else None,
                        "trend": trend,
                        "total_calls": row.total,
                        "avg_duration_ms": round(row.avg_duration or 0, 1),
                        "feedback": {
                            "positive": fb.positive if fb else 0,
                            "negative": fb.negative if fb else 0,
                        },
                    })

                return sorted(report, key=lambda x: x["current_success_rate"])

        except Exception as e:
            logger.warning(f"get_agent_health_report error: {e}")
            return []

    async def measure_improvement(self, agent_id: str, window_hours: int = 24) -> Dict:
        """특정 에이전트의 개선 효과 측정."""
        now = datetime.now(timezone.utc)
        current_start = now - timedelta(hours=window_hours)
        previous_start = current_start - timedelta(hours=window_hours)

        try:
            async with get_db_context() as db:
                # 현재 기간
                cur = await db.execute(
                    select(
                        func.count(AgentExecution.id).label("total"),
                        func.count(AgentExecution.id).filter(AgentExecution.success == True).label("success"),
                        func.avg(AgentExecution.duration_ms).label("avg_duration"),
                    )
                    .where(and_(
                        AgentExecution.agent_id == agent_id,
                        AgentExecution.created_at >= current_start,
                    ))
                )
                cur_row = cur.one()

                # 이전 기간
                prev = await db.execute(
                    select(
                        func.count(AgentExecution.id).label("total"),
                        func.count(AgentExecution.id).filter(AgentExecution.success == True).label("success"),
                        func.avg(AgentExecution.duration_ms).label("avg_duration"),
                    )
                    .where(and_(
                        AgentExecution.agent_id == agent_id,
                        AgentExecution.created_at >= previous_start,
                        AgentExecution.created_at < current_start,
                    ))
                )
                prev_row = prev.one()

                cur_rate = cur_row.success / cur_row.total if cur_row.total > 0 else None
                prev_rate = prev_row.success / prev_row.total if prev_row.total > 0 else None

                improvement = None
                if cur_rate is not None and prev_rate is not None:
                    improvement = round(cur_rate - prev_rate, 3)

                return {
                    "agent_id": agent_id,
                    "window_hours": window_hours,
                    "current": {
                        "total": cur_row.total,
                        "success_rate": round(cur_rate, 3) if cur_rate is not None else None,
                        "avg_duration_ms": round(cur_row.avg_duration or 0, 1),
                    },
                    "previous": {
                        "total": prev_row.total,
                        "success_rate": round(prev_rate, 3) if prev_rate is not None else None,
                        "avg_duration_ms": round(prev_row.avg_duration or 0, 1),
                    },
                    "improvement": improvement,
                    "effective": improvement is not None and improvement > 0,
                }

        except Exception as e:
            logger.warning(f"measure_improvement error: {e}")
            return {"agent_id": agent_id, "error": str(e)}

    async def get_learning_summary(self) -> Dict:
        """전체 학습 시스템 요약."""
        try:
            async with get_db_context() as db:
                # 학습 루프 실행 기록
                loop_result = await db.execute(
                    select(func.count(AgentExecution.id))
                    .where(AgentExecution.agent_id.like("learning_loop_%"))
                )
                loop_count = loop_result.scalar() or 0

                # 전체 피드백 통계
                fb_result = await db.execute(
                    select(
                        func.count(UserFeedback.id).label("total"),
                        func.count(UserFeedback.id).filter(UserFeedback.rating > 0).label("positive"),
                        func.count(UserFeedback.id).filter(UserFeedback.rating < 0).label("negative"),
                    )
                )
                fb = fb_result.one()

                # 건강 상태 분포
                report = await self.get_agent_health_report("24h")
                health_dist = {"healthy": 0, "warning": 0, "degraded": 0, "critical": 0}
                for r in report:
                    health_dist[r["health"]] = health_dist.get(r["health"], 0) + 1

                return {
                    "improvements_applied": loop_count,
                    "feedback": {
                        "total": fb.total,
                        "positive": fb.positive,
                        "negative": fb.negative,
                        "satisfaction": round(fb.positive / fb.total, 2) if fb.total > 0 else None,
                    },
                    "agent_health": health_dist,
                    "agents_monitored": len(report),
                }

        except Exception as e:
            logger.warning(f"get_learning_summary error: {e}")
            return {}

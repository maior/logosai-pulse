"""MetricsCollector — Phase G Observability 핵심 서비스.

에이전트 실행 기록, LLM 호출 추적, 일일 집계를 PostgreSQL에 저장.
모든 기록은 async fire-and-forget — 에이전트 응답을 블로킹하지 않음.

Usage:
    collector = MetricsCollector(db_session_factory)

    # 에이전트 실행 기록
    exec_id = await collector.record_execution(
        agent_id="scheduler_agent", query="이번주 일정",
        success=True, duration_ms=3200
    )

    # LLM 호출 기록
    await collector.record_llm_call(
        execution_id=exec_id, model="gemini-2.5-flash-lite",
        input_tokens=500, output_tokens=200, duration_ms=800
    )

    # 대시보드 조회
    stats = await collector.get_dashboard_summary(period="24h")
"""

import logging
from datetime import datetime, timezone, timedelta
from typing import Any, Dict, List, Optional
from uuid import uuid4

from sqlalchemy import select, func, desc, and_, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.observability import (
    AgentExecution, LLMCall, DailyStat, calculate_cost,
)

logger = logging.getLogger(__name__)


class MetricsCollector:
    """에이전트 성능 메트릭 수집 + 조회 서비스."""

    def __init__(self, db_factory):
        """
        Args:
            db_factory: async context manager that yields AsyncSession
                        (e.g., get_db_context from database.py)
        """
        self._db_factory = db_factory

    # ═══════════════════════════════════════════
    # 기록 (Write) — fire-and-forget
    # ═══════════════════════════════════════════

    async def record_execution(
        self,
        agent_id: str,
        query: str = "",
        success: bool = True,
        duration_ms: float = 0,
        error_message: str = "",
        agent_name: str = "",
        correlation_id: str = "",
        user_email: str = "",
        session_id: str = "",
        token_count: int = 0,
        cost_usd: float = 0.0,
        metadata: Optional[Dict] = None,
    ) -> str:
        """에이전트 실행 기록. Returns execution_id."""
        exec_id = str(uuid4())
        try:
            async with self._db_factory() as db:
                execution = AgentExecution(
                    id=exec_id,
                    correlation_id=correlation_id or None,
                    agent_id=agent_id,
                    agent_name=agent_name or agent_id,
                    query=(query[:200] if query else None),
                    success=success,
                    error_message=(error_message[:500] if error_message else None),
                    duration_ms=duration_ms,
                    token_count=token_count,
                    cost_usd=cost_usd,
                    metadata_json=metadata,
                    user_email=user_email or None,
                    session_id=session_id or None,
                )
                db.add(execution)
                await db.commit()

                # 일일 집계 업데이트
                await self._update_daily_stat(
                    db, agent_id, agent_name, success, duration_ms, token_count, cost_usd
                )

            logger.debug(f"Metrics: execution recorded {agent_id} ({duration_ms:.0f}ms)")
        except Exception as e:
            logger.warning(f"Metrics record_execution failed: {e}")

        return exec_id

    async def record_llm_call(
        self,
        execution_id: str = "",
        agent_id: str = "",
        model: str = "",
        provider: str = "",
        input_tokens: int = 0,
        output_tokens: int = 0,
        duration_ms: float = 0,
        success: bool = True,
        error_message: str = "",
        prompt_preview: str = "",
    ) -> str:
        """LLM 호출 기록. Returns call_id."""
        call_id = str(uuid4())
        total_tokens = input_tokens + output_tokens
        cost = calculate_cost(model, input_tokens, output_tokens)

        try:
            async with self._db_factory() as db:
                llm_call = LLMCall(
                    id=call_id,
                    execution_id=execution_id or None,
                    agent_id=agent_id or None,
                    model=model,
                    provider=provider or None,
                    input_tokens=input_tokens,
                    output_tokens=output_tokens,
                    total_tokens=total_tokens,
                    cost_usd=cost,
                    duration_ms=duration_ms,
                    success=success,
                    error_message=error_message[:500] if error_message else None,
                    prompt_preview=prompt_preview[:200] if prompt_preview else None,
                )
                db.add(llm_call)
                await db.commit()

                # 소속 execution의 토큰/비용 업데이트
                if execution_id:
                    await db.execute(
                        text("""
                            UPDATE logosus.agent_executions
                            SET token_count = token_count + :tokens,
                                cost_usd = cost_usd + :cost
                            WHERE id = :eid
                        """),
                        {"tokens": total_tokens, "cost": cost, "eid": execution_id},
                    )
                    await db.commit()

                # 일일 집계 LLM 호출 수 업데이트
                today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
                await db.execute(
                    text("""
                        UPDATE logosus.daily_stats
                        SET total_llm_calls = total_llm_calls + 1,
                            total_tokens = total_tokens + :tokens,
                            total_cost_usd = total_cost_usd + :cost
                        WHERE date = :d AND agent_id = :aid
                    """),
                    {"tokens": total_tokens, "cost": cost, "d": today, "aid": agent_id},
                )
                await db.commit()

        except Exception as e:
            logger.warning(f"Metrics record_llm_call failed: {e}")

        return call_id

    async def _update_daily_stat(
        self, db: AsyncSession,
        agent_id: str, agent_name: str,
        success: bool, duration_ms: float,
        token_count: int, cost_usd: float,
    ):
        """일일 집계 upsert."""
        today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        try:
            result = await db.execute(
                select(DailyStat).where(
                    and_(DailyStat.date == today, DailyStat.agent_id == agent_id)
                )
            )
            stat = result.scalar_one_or_none()

            if stat:
                stat.total_calls += 1
                if success:
                    stat.success_count += 1
                else:
                    stat.failure_count += 1
                # 이동 평균
                stat.avg_duration_ms = (
                    (stat.avg_duration_ms * (stat.total_calls - 1) + duration_ms)
                    / stat.total_calls
                )
                stat.total_tokens += token_count
                stat.total_cost_usd += cost_usd
            else:
                stat = DailyStat(
                    id=str(uuid4()),
                    date=today,
                    agent_id=agent_id,
                    agent_name=agent_name or agent_id,
                    total_calls=1,
                    success_count=1 if success else 0,
                    failure_count=0 if success else 1,
                    avg_duration_ms=duration_ms,
                    total_tokens=token_count,
                    total_cost_usd=cost_usd,
                    total_llm_calls=0,
                )
                db.add(stat)

            await db.commit()
        except Exception as e:
            logger.warning(f"Metrics daily_stat update failed: {e}")

    # ═══════════════════════════════════════════
    # 조회 (Read) — 대시보드용
    # ═══════════════════════════════════════════

    async def get_dashboard_summary(self, period: str = "24h") -> Dict[str, Any]:
        """대시보드 종합 요약."""
        since = self._period_to_datetime(period)

        try:
            async with self._db_factory() as db:
                # 전체 요약
                result = await db.execute(
                    select(
                        func.count(AgentExecution.id).label("total_calls"),
                        func.count(AgentExecution.id).filter(AgentExecution.success == True).label("success_count"),
                        func.avg(AgentExecution.duration_ms).label("avg_duration"),
                        func.sum(AgentExecution.token_count).label("total_tokens"),
                        func.sum(AgentExecution.cost_usd).label("total_cost"),
                        func.count(func.distinct(AgentExecution.agent_id)).label("active_agents"),
                    ).where(AgentExecution.created_at >= since)
                )
                row = result.one()

                total = row.total_calls or 0
                success = row.success_count or 0

                return {
                    "period": period,
                    "total_calls": total,
                    "success_rate": round(success / total, 3) if total > 0 else 1.0,
                    "avg_duration_ms": round(row.avg_duration or 0, 1),
                    "total_tokens": row.total_tokens or 0,
                    "total_cost_usd": round(row.total_cost or 0, 4),
                    "active_agents": row.active_agents or 0,
                }
        except Exception as e:
            logger.warning(f"Metrics get_dashboard_summary failed: {e}")
            return {"period": period, "total_calls": 0, "error": str(e)}

    async def get_agent_stats(self, period: str = "24h") -> List[Dict]:
        """에이전트별 통계."""
        since = self._period_to_datetime(period)

        try:
            async with self._db_factory() as db:
                result = await db.execute(
                    select(
                        AgentExecution.agent_id,
                        AgentExecution.agent_name,
                        func.count(AgentExecution.id).label("total_calls"),
                        func.count(AgentExecution.id).filter(AgentExecution.success == True).label("success_count"),
                        func.avg(AgentExecution.duration_ms).label("avg_duration"),
                        func.sum(AgentExecution.token_count).label("total_tokens"),
                        func.sum(AgentExecution.cost_usd).label("total_cost"),
                        func.max(AgentExecution.created_at).label("last_called"),
                    )
                    .where(AgentExecution.created_at >= since)
                    .group_by(AgentExecution.agent_id, AgentExecution.agent_name)
                    .order_by(desc("total_calls"))
                )

                agents = []
                for row in result.all():
                    total = row.total_calls or 0
                    success = row.success_count or 0
                    agents.append({
                        "agent_id": row.agent_id,
                        "agent_name": row.agent_name or row.agent_id,
                        "total_calls": total,
                        "success_rate": round(success / total, 3) if total > 0 else 1.0,
                        "avg_duration_ms": round(row.avg_duration or 0, 1),
                        "total_tokens": row.total_tokens or 0,
                        "total_cost_usd": round(row.total_cost or 0, 4),
                        "last_called": row.last_called.isoformat() if row.last_called else None,
                        "error_count": total - success,
                    })
                return agents
        except Exception as e:
            logger.warning(f"Metrics get_agent_stats failed: {e}")
            return []

    async def get_traces(
        self, limit: int = 50, agent_id: str = "", period: str = "24h"
    ) -> List[Dict]:
        """실행 트레이스 목록."""
        since = self._period_to_datetime(period)

        try:
            async with self._db_factory() as db:
                query = (
                    select(AgentExecution)
                    .where(AgentExecution.created_at >= since)
                    .order_by(desc(AgentExecution.created_at))
                    .limit(limit)
                )
                if agent_id:
                    query = query.where(AgentExecution.agent_id == agent_id)

                result = await db.execute(query)
                executions = result.scalars().all()

                return [
                    {
                        "id": e.id,
                        "agent_id": e.agent_id,
                        "agent_name": e.agent_name,
                        "query": e.query,
                        "success": e.success,
                        "duration_ms": e.duration_ms,
                        "token_count": e.token_count,
                        "cost_usd": round(e.cost_usd, 4),
                        "created_at": e.created_at.isoformat() if e.created_at else None,
                        "error_message": e.error_message,
                    }
                    for e in executions
                ]
        except Exception as e:
            logger.warning(f"Metrics get_traces failed: {e}")
            return []

    async def get_trace_detail(self, execution_id: str) -> Optional[Dict]:
        """트레이스 상세 — LLM 호출 트리 포함."""
        try:
            async with self._db_factory() as db:
                # 실행 기록
                result = await db.execute(
                    select(AgentExecution).where(AgentExecution.id == execution_id)
                )
                execution = result.scalar_one_or_none()
                if not execution:
                    return None

                # LLM 호출들
                llm_result = await db.execute(
                    select(LLMCall)
                    .where(LLMCall.execution_id == execution_id)
                    .order_by(LLMCall.created_at)
                )
                llm_calls = llm_result.scalars().all()

                return {
                    "execution": {
                        "id": execution.id,
                        "agent_id": execution.agent_id,
                        "agent_name": execution.agent_name,
                        "query": execution.query,
                        "success": execution.success,
                        "duration_ms": execution.duration_ms,
                        "token_count": execution.token_count,
                        "cost_usd": round(execution.cost_usd, 4),
                        "created_at": execution.created_at.isoformat() if execution.created_at else None,
                        "error_message": execution.error_message,
                        "user_email": execution.user_email,
                    },
                    "llm_calls": [
                        {
                            "id": c.id,
                            "model": c.model,
                            "provider": c.provider,
                            "input_tokens": c.input_tokens,
                            "output_tokens": c.output_tokens,
                            "total_tokens": c.total_tokens,
                            "cost_usd": round(c.cost_usd, 6),
                            "duration_ms": c.duration_ms,
                            "success": c.success,
                            "prompt_preview": c.prompt_preview,
                            "created_at": c.created_at.isoformat() if c.created_at else None,
                        }
                        for c in llm_calls
                    ],
                    "summary": {
                        "total_llm_calls": len(llm_calls),
                        "total_tokens": sum(c.total_tokens for c in llm_calls),
                        "total_cost_usd": round(sum(c.cost_usd for c in llm_calls), 6),
                        "models_used": list(set(c.model for c in llm_calls)),
                    },
                }
        except Exception as e:
            logger.warning(f"Metrics get_trace_detail failed: {e}")
            return None

    async def get_cost_breakdown(self, period: str = "24h") -> Dict[str, Any]:
        """비용 분석 — 모델별/에이전트별."""
        since = self._period_to_datetime(period)

        try:
            async with self._db_factory() as db:
                # 모델별 비용
                model_result = await db.execute(
                    select(
                        LLMCall.model,
                        func.count(LLMCall.id).label("calls"),
                        func.sum(LLMCall.total_tokens).label("tokens"),
                        func.sum(LLMCall.cost_usd).label("cost"),
                    )
                    .where(LLMCall.created_at >= since)
                    .group_by(LLMCall.model)
                    .order_by(desc("cost"))
                )

                by_model = [
                    {
                        "model": row.model,
                        "calls": row.calls,
                        "tokens": row.tokens or 0,
                        "cost_usd": round(row.cost or 0, 4),
                    }
                    for row in model_result.all()
                ]

                # 에이전트별 비용
                agent_result = await db.execute(
                    select(
                        AgentExecution.agent_id,
                        func.sum(AgentExecution.cost_usd).label("cost"),
                        func.sum(AgentExecution.token_count).label("tokens"),
                    )
                    .where(AgentExecution.created_at >= since)
                    .group_by(AgentExecution.agent_id)
                    .order_by(desc("cost"))
                )

                by_agent = [
                    {
                        "agent_id": row.agent_id,
                        "cost_usd": round(row.cost or 0, 4),
                        "tokens": row.tokens or 0,
                    }
                    for row in agent_result.all()
                ]

                total_cost = sum(m["cost_usd"] for m in by_model)

                return {
                    "period": period,
                    "total_cost_usd": round(total_cost, 4),
                    "by_model": by_model,
                    "by_agent": by_agent,
                }
        except Exception as e:
            logger.warning(f"Metrics get_cost_breakdown failed: {e}")
            return {"period": period, "total_cost_usd": 0, "by_model": [], "by_agent": []}

    async def get_hourly_trend(self, period: str = "24h") -> List[Dict]:
        """시간대별 트렌드 (라인 차트용)."""
        since = self._period_to_datetime(period)

        try:
            async with self._db_factory() as db:
                result = await db.execute(
                    text("""
                        SELECT
                            date_trunc('hour', created_at) as hour,
                            COUNT(*) as calls,
                            AVG(duration_ms) as avg_duration,
                            SUM(token_count) as tokens,
                            SUM(cost_usd) as cost
                        FROM logosus.agent_executions
                        WHERE created_at >= :since
                        GROUP BY date_trunc('hour', created_at)
                        ORDER BY hour
                    """),
                    {"since": since},
                )

                return [
                    {
                        "hour": row.hour.isoformat() if row.hour else None,
                        "calls": row.calls,
                        "avg_duration_ms": round(row.avg_duration or 0, 1),
                        "tokens": row.tokens or 0,
                        "cost_usd": round(row.cost or 0, 4),
                    }
                    for row in result.all()
                ]
        except Exception as e:
            logger.warning(f"Metrics get_hourly_trend failed: {e}")
            return []

    # ═══════════════════════════════════════════
    # Helpers
    # ═══════════════════════════════════════════

    @staticmethod
    def _period_to_datetime(period: str) -> datetime:
        """기간 문자열 → datetime 변환."""
        now = datetime.now(timezone.utc)
        mapping = {
            "1h": timedelta(hours=1),
            "6h": timedelta(hours=6),
            "24h": timedelta(hours=24),
            "7d": timedelta(days=7),
            "30d": timedelta(days=30),
        }
        delta = mapping.get(period, timedelta(hours=24))
        return now - delta


# ═══════════════════════════════════════════
# Global instance
# ═══════════════════════════════════════════

_metrics_collector: Optional[MetricsCollector] = None


def get_metrics_collector() -> Optional[MetricsCollector]:
    """Get global MetricsCollector instance."""
    return _metrics_collector


def init_metrics_collector(db_factory) -> MetricsCollector:
    """Initialize global MetricsCollector."""
    global _metrics_collector
    _metrics_collector = MetricsCollector(db_factory)
    return _metrics_collector

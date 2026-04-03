"""Learning API — 학습 루프 상태 + 효과 측정 + 수동 트리거."""

import logging

from fastapi import APIRouter, Query

from app.services.learning_loop import get_learning_loop

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/learning", tags=["Learning"])


@router.get("/status")
async def learning_status():
    """학습 루프 상태."""
    loop = get_learning_loop()
    return {
        "running": loop._running,
        "cycles_completed": loop._cycle_count,
        "cooldown_agents": list(loop._improvement_history.keys()),
    }


@router.post("/trigger")
async def trigger_learning_cycle():
    """학습 사이클 수동 트리거."""
    loop = get_learning_loop()
    try:
        result = await _run_cycle_with_result(loop)
        return {"status": "ok", "result": result}
    except Exception as e:
        return {"status": "error", "error": str(e)}


async def _run_cycle_with_result(loop) -> dict:
    """학습 사이클 실행 + 결과 반환."""
    failing = await loop.detect_failing_agents()
    if not failing:
        return {"failing_agents": 0, "message": "No failing agents detected"}

    results = []
    for agent in failing:
        agent_id = agent["agent_id"]
        if loop._is_in_cooldown(agent_id):
            results.append({"agent_id": agent_id, "action": "skipped_cooldown"})
            continue

        patterns = await loop.analyze_patterns(agent_id)
        if not patterns:
            results.append({"agent_id": agent_id, "action": "no_patterns"})
            continue

        test_result = await loop.shadow_test(agent_id, patterns["failure_queries"])
        results.append({
            "agent_id": agent_id,
            "failure_queries": len(patterns["failure_queries"]),
            "shadow_test": test_result,
            "action": "tested",
        })

    return {
        "failing_agents": len(failing),
        "results": results,
    }


@router.get("/history")
async def learning_history():
    """최근 개선 이력."""
    from datetime import datetime, timezone, timedelta
    from sqlalchemy import select, desc
    from app.database import get_db_context
    from app.models.observability import AgentExecution

    try:
        async with get_db_context() as db:
            result = await db.execute(
                select(AgentExecution)
                .where(AgentExecution.agent_id.like("learning_loop_%"))
                .order_by(desc(AgentExecution.created_at))
                .limit(20)
            )
            executions = result.scalars().all()
            return [
                {
                    "agent_id": e.agent_id.replace("learning_loop_", ""),
                    "query": e.query,
                    "metadata": e.metadata_json,
                    "created_at": e.created_at.isoformat() if e.created_at else None,
                }
                for e in executions
            ]
    except Exception as e:
        return []


@router.get("/health-report")
async def health_report(period: str = Query("24h")):
    """에이전트별 건강 리포트 — 성공률 + 트렌드 + 피드백."""
    from app.services.learning_metrics import LearningMetrics
    metrics = LearningMetrics()
    return await metrics.get_agent_health_report(period)


@router.get("/improvement/{agent_id}")
async def measure_improvement(agent_id: str, window: int = Query(24)):
    """특정 에이전트 개선 효과 측정 (현재 vs 이전 기간)."""
    from app.services.learning_metrics import LearningMetrics
    metrics = LearningMetrics()
    return await metrics.measure_improvement(agent_id, window)


@router.get("/summary")
async def learning_summary():
    """전체 학습 시스템 요약 — 개선 횟수, 피드백, 건강 분포."""
    from app.services.learning_metrics import LearningMetrics
    metrics = LearningMetrics()
    return await metrics.get_learning_summary()

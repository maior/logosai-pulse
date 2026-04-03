"""Dashboard API — logos_web이 조회하는 엔드포인트."""

import logging
from typing import Optional

from fastapi import APIRouter, Query

from app.services.metrics_collector import get_metrics_collector

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1", tags=["Dashboard"])


@router.get("/dashboard")
async def get_dashboard(period: str = Query("24h", regex="^(1h|6h|24h|7d|30d)$")):
    """종합 대시보드."""
    collector = get_metrics_collector()
    if not collector:
        return {"error": "not_initialized"}

    summary = await collector.get_dashboard_summary(period)
    agents = await collector.get_agent_stats(period)
    costs = await collector.get_cost_breakdown(period)
    trend = await collector.get_hourly_trend(period)

    return {
        "summary": summary,
        "agents": agents,
        "costs": costs,
        "trend": trend,
    }


@router.get("/agents")
async def get_agents(period: str = Query("24h")):
    """에이전트별 통계."""
    collector = get_metrics_collector()
    if not collector:
        return []
    return await collector.get_agent_stats(period)


@router.get("/agents/{agent_id}")
async def get_agent_detail(agent_id: str, period: str = Query("24h")):
    """에이전트 상세."""
    collector = get_metrics_collector()
    if not collector:
        return {}
    traces = await collector.get_traces(limit=20, agent_id=agent_id, period=period)
    stats = await collector.get_agent_stats(period)
    agent_stat = next((s for s in stats if s["agent_id"] == agent_id), None)
    return {"stats": agent_stat, "traces": traces}


@router.get("/traces")
async def get_traces(
    limit: int = Query(50, le=200),
    agent_id: str = Query(""),
    period: str = Query("24h"),
):
    """실행 트레이스 목록."""
    collector = get_metrics_collector()
    if not collector:
        return []
    return await collector.get_traces(limit=limit, agent_id=agent_id, period=period)


@router.get("/traces/{execution_id}")
async def get_trace_detail(execution_id: str):
    """트레이스 상세 (LLM 호출 트리)."""
    collector = get_metrics_collector()
    if not collector:
        return None
    return await collector.get_trace_detail(execution_id)


@router.get("/costs")
async def get_costs(period: str = Query("24h")):
    """비용 분석."""
    collector = get_metrics_collector()
    if not collector:
        return {}
    return await collector.get_cost_breakdown(period)


@router.get("/trend")
async def get_trend(period: str = Query("24h")):
    """시간대별 트렌드."""
    collector = get_metrics_collector()
    if not collector:
        return []
    return await collector.get_hourly_trend(period)

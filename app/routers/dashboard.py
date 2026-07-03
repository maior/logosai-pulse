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


@router.get("/conversations/recent")
async def get_recent_conversations(limit: int = 12):
    """최근 에이전트 간 대화 (대시보드 피드용) + 상태 분포."""
    from sqlalchemy import select, func as sa_func
    from app.database import get_db_context
    from app.models.observability import AgentConversation
    try:
        async with get_db_context() as db:
            rows = (await db.execute(
                select(AgentConversation)
                .order_by(AgentConversation.started_at.desc())
                .limit(limit)
            )).scalars().all()
            counts = (await db.execute(
                select(AgentConversation.status, sa_func.count(AgentConversation.id))
                .group_by(AgentConversation.status)
            )).all()
            return {
                "conversations": [
                    {"caller": c.caller, "callee": c.callee, "channel": c.channel,
                     "query": (c.query or "")[:120], "answer": (c.answer or "")[:120],
                     "status": c.status, "duration_ms": c.duration_ms,
                     "trace_id": c.trace_id,
                     "started_at": c.started_at.isoformat() if c.started_at else None}
                    for c in rows
                ],
                "status_counts": {s: n for s, n in counts},
            }
    except Exception as e:
        logger.warning(f"recent conversations failed: {e}")
        return {"conversations": [], "status_counts": {}}


@router.get("/traces/{trace_id}/journey")
async def get_trace_journey(trace_id: str):
    """쿼리 여정 — 유입→분석·판단→에이전트 실행→하네스 동작→에이전트 간 대화→통합.

    span들을 stage 규약(metadata.stage, 레거시는 name 휴리스틱)으로 조립해
    단계 진행바 · 에이전트 스윔레인 · 대화 타임라인을 한 번에 반환한다.
    """
    from sqlalchemy import select
    from app.database import get_db_context
    from app.models.observability import TraceSpanModel, AgentExecution
    from app.services.journey_builder import build_journey

    try:
        async with get_db_context() as db:
            result = await db.execute(
                select(TraceSpanModel)
                .where(TraceSpanModel.trace_id == trace_id)
                .order_by(TraceSpanModel.start_time)
            )
            spans = result.scalars().all()
            if not spans:
                result = await db.execute(
                    select(TraceSpanModel).where(TraceSpanModel.id == trace_id)
                )
                root = result.scalar_one_or_none()
                if root:
                    result = await db.execute(
                        select(TraceSpanModel)
                        .where(TraceSpanModel.trace_id == root.trace_id)
                        .order_by(TraceSpanModel.start_time)
                    )
                    spans = result.scalars().all()

            span_rows = [
                {
                    "id": s.id, "trace_id": s.trace_id, "parent_id": s.parent_id,
                    "name": s.name, "agent_id": s.agent_id, "status": s.status,
                    "input": s.input_text, "output": s.output_text,
                    "duration_ms": s.duration_ms, "metadata": s.span_metadata,
                    "start_time": s.start_time,
                    "created_at": s.created_at,
                }
                for s in spans
            ]

            execution_row = None
            exec_result = await db.execute(
                select(AgentExecution).where(AgentExecution.id == trace_id)
            )
            execution = exec_result.scalar_one_or_none()
            if execution:
                execution_row = {"query": execution.query,
                                 "agent_id": execution.agent_id,
                                 "success": execution.success}

            journey = build_journey(span_rows, execution_row)

            # 대화 로그(1급 기록) 우선 — 있으면 스팬 추출분을 대체 (전문 + 취소 표본 포함)
            try:
                from app.models.observability import AgentConversation
                conv_result = await db.execute(
                    select(AgentConversation)
                    .where(AgentConversation.trace_id == (spans[0].trace_id if spans else trace_id))
                    .order_by(AgentConversation.started_at)
                )
                convs = conv_result.scalars().all()
                if convs:
                    t0 = min((c.started_at for c in convs if c.started_at), default=None)
                    journey["conversations"] = [
                        {"seq": i + 1, "caller": c.caller, "callee": c.callee,
                         "query": c.query or "", "answer": c.answer or "",
                         "status": c.status, "channel": c.channel,
                         "offset_ms": round((c.started_at - t0).total_seconds() * 1000, 1) if (t0 and c.started_at) else 0,
                         "duration_ms": c.duration_ms or 0}
                        for i, c in enumerate(convs)
                    ]
                    journey["counts"]["a2a_calls"] = len(convs)
                    journey["conversations_source"] = "conversation_log"
            except Exception as _ce:
                logger.debug(f"conversation merge skipped: {_ce}")

            return journey
    except Exception as e:
        logger.warning(f"Journey build failed: {e}")
        return {"trace_id": trace_id, "error": str(e), "stages": [],
                "lanes": [], "conversations": [], "counts": {}}


@router.get("/traces/{execution_id}/tree")
async def get_trace_tree(execution_id: str):
    """트레이스 Span 트리 — 계층 구조."""
    from sqlalchemy import select
    from app.database import get_db_context
    from app.models.observability import TraceSpanModel

    try:
        async with get_db_context() as db:
            # execution_id를 trace_id로 사용하여 모든 span 조회
            result = await db.execute(
                select(TraceSpanModel)
                .where(TraceSpanModel.trace_id == execution_id)
                .order_by(TraceSpanModel.created_at)
            )
            spans = result.scalars().all()

            if not spans:
                # trace_id가 아닌 경우 span id로 시도
                result = await db.execute(
                    select(TraceSpanModel)
                    .where(TraceSpanModel.id == execution_id)
                )
                root = result.scalar_one_or_none()
                if root:
                    result = await db.execute(
                        select(TraceSpanModel)
                        .where(TraceSpanModel.trace_id == root.trace_id)
                        .order_by(TraceSpanModel.created_at)
                    )
                    spans = result.scalars().all()

            span_list = [
                {
                    "id": s.id,
                    "trace_id": s.trace_id,
                    "parent_id": s.parent_id,
                    "name": s.name,
                    "agent_id": s.agent_id,
                    "status": s.status,
                    "input": s.input_text,
                    "output": s.output_text,
                    "duration_ms": s.duration_ms,
                    "metadata": s.span_metadata,
                    "created_at": s.created_at.isoformat() if s.created_at else None,
                }
                for s in spans
            ]

            # Build tree structure
            by_id = {s["id"]: {**s, "children": []} for s in span_list}
            roots = []
            for s in span_list:
                if s["parent_id"] and s["parent_id"] in by_id:
                    by_id[s["parent_id"]]["children"].append(by_id[s["id"]])
                else:
                    roots.append(by_id[s["id"]])

            return {
                "trace_id": spans[0].trace_id if spans else execution_id,
                "total_spans": len(spans),
                "tree": roots,
                "flat": span_list,
            }
    except Exception as e:
        logger.warning(f"get_trace_tree failed: {e}")
        return {"tree": [], "flat": [], "total_spans": 0}


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

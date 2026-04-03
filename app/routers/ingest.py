"""Ingest API — ACP/logos_api가 메트릭을 전송하는 엔드포인트.

Fire-and-forget: 클라이언트는 응답을 기다리지 않아도 됨.
"""

import logging
from typing import Any, Dict, List, Optional

from fastapi import APIRouter
from pydantic import BaseModel

from app.services.metrics_collector import get_metrics_collector

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/ingest", tags=["Ingest"])


class ExecutionRecord(BaseModel):
    agent_id: str
    query: str = ""
    success: bool = True
    duration_ms: float = 0
    error_message: str = ""
    agent_name: str = ""
    correlation_id: str = ""
    user_email: str = ""
    session_id: str = ""
    token_count: int = 0
    cost_usd: float = 0.0
    metadata: Optional[Dict[str, Any]] = None


class LLMCallRecord(BaseModel):
    execution_id: str = ""
    agent_id: str = ""
    model: str = ""
    provider: str = ""
    input_tokens: int = 0
    output_tokens: int = 0
    duration_ms: float = 0
    success: bool = True
    error_message: str = ""
    prompt_preview: str = ""


class BatchIngest(BaseModel):
    executions: List[ExecutionRecord] = []
    llm_calls: List[LLMCallRecord] = []


@router.post("/execution")
async def ingest_execution(record: ExecutionRecord):
    """에이전트 실행 기록 수집."""
    collector = get_metrics_collector()
    if not collector:
        return {"status": "not_initialized"}

    exec_id = await collector.record_execution(**record.model_dump())

    # SSE broadcast
    from app.routers.stream import broadcast_event
    broadcast_event("new_execution", {**record.model_dump(), "execution_id": exec_id})

    return {"status": "ok", "execution_id": exec_id}


@router.post("/llm-call")
async def ingest_llm_call(record: LLMCallRecord):
    """LLM 호출 기록 수집."""
    collector = get_metrics_collector()
    if not collector:
        return {"status": "not_initialized"}

    call_id = await collector.record_llm_call(**record.model_dump())

    from app.routers.stream import broadcast_event
    broadcast_event("new_llm_call", {**record.model_dump(), "call_id": call_id})

    return {"status": "ok", "call_id": call_id}


class SpanRecord(BaseModel):
    span_id: str = ""
    trace_id: str = ""
    parent_id: str = ""
    name: str = ""
    agent_id: str = ""
    status: str = "success"
    input_text: str = ""
    output_text: str = ""
    duration_ms: float = 0
    metadata: Optional[Dict[str, Any]] = None


@router.post("/span")
async def ingest_span(record: SpanRecord):
    """트레이스 Span 기록."""
    from datetime import datetime, timezone, timedelta
    try:
        from app.database import get_db_context
        from app.models.observability import TraceSpanModel
        async with get_db_context() as db:
            now = datetime.now(timezone.utc)
            span = TraceSpanModel(
                id=record.span_id or str(__import__('uuid').uuid4()),
                trace_id=record.trace_id,
                parent_id=record.parent_id or None,
                name=record.name,
                agent_id=record.agent_id or None,
                status=record.status,
                input_text=record.input_text[:200] if record.input_text else None,
                output_text=record.output_text[:200] if record.output_text else None,
                start_time=now - timedelta(milliseconds=record.duration_ms),
                end_time=now,
                duration_ms=record.duration_ms,
                span_metadata=record.metadata,
            )
            db.add(span)
            await db.commit()

        from app.routers.stream import broadcast_event
        broadcast_event("new_span", record.model_dump())

        return {"status": "ok", "span_id": span.id}
    except Exception as e:
        logger.warning(f"Span ingest failed: {e}")
        return {"status": "error", "error": str(e)}


@router.post("/batch")
async def ingest_batch(batch: BatchIngest):
    """배치 수집 (여러 기록 한번에)."""
    collector = get_metrics_collector()
    if not collector:
        return {"status": "not_initialized"}

    results = {"executions": 0, "llm_calls": 0}
    for rec in batch.executions:
        await collector.record_execution(**rec.model_dump())
        results["executions"] += 1
    for rec in batch.llm_calls:
        await collector.record_llm_call(**rec.model_dump())
        results["llm_calls"] += 1

    return {"status": "ok", **results}

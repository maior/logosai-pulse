"""Ingest API — ACP/logos_api가 메트릭을 전송하는 엔드포인트.

Fire-and-forget: 클라이언트는 응답을 기다리지 않아도 됨.
"""

import json
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
    execution_id: Optional[str] = None  # N1 (2026-05-09): 클라이언트가 trace_id 와 link 위해 명시 가능


class LLMCallRecord(BaseModel):
    # 클라이언트 발급 ID — 재전송(스풀 replay)을 멱등하게 만든다. 미지정 시 서버 발급.
    call_id: Optional[str] = ""
    # trace_id 가 없으면 발신 측이 None 을 보낸다 (server.py:167).
    # str 로 두면 Pydantic 이 422 로 거부해 기록이 통째로 유실됐다.
    execution_id: Optional[str] = ""
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


class EventRecord(BaseModel):
    """런타임 이벤트 — 휘발하던 장애 신호 (회로 차단/롤백/인터랙션)."""
    # 클라이언트 발급 ID — 스풀 재전송을 멱등하게 만든다. 미지정 시 서버 발급.
    event_id: Optional[str] = ""
    event_type: str = ""
    source: Optional[str] = ""
    agent_id: Optional[str] = ""
    severity: Optional[str] = "info"
    payload: Optional[Dict[str, Any]] = None


@router.post("/event")
async def ingest_event(record: EventRecord):
    """런타임 이벤트 수집."""
    from uuid import uuid4
    from sqlalchemy import text
    from app.database import get_db_context

    event_id = record.event_id or str(uuid4())
    try:
        async with get_db_context() as db:
            await db.execute(
                text("""
                    INSERT INTO logosus.runtime_events
                        (id, event_type, source, agent_id, severity, payload, created_at)
                    VALUES (:id, :et, :src, :aid, :sev, CAST(:pl AS jsonb), now())
                    ON CONFLICT (id) DO NOTHING
                """),
                {
                    "id": event_id,
                    "et": record.event_type or "unknown",
                    "src": record.source or None,
                    "aid": record.agent_id or None,
                    "sev": record.severity or "info",
                    "pl": json.dumps(record.payload) if record.payload else None,
                },
            )
            await db.commit()
    except Exception as e:
        logger.warning(f"ingest_event failed: {e}")
        return {"status": "error", "event_id": event_id}

    from app.routers.stream import broadcast_event
    broadcast_event("new_runtime_event", {**record.model_dump(), "event_id": event_id})

    return {"status": "ok", "event_id": event_id}


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
    # 실측 시각 (epoch sec) — 여정 타임라인/워터폴 정합. 미전송 시 기존처럼 합성.
    start_time: Optional[float] = None
    end_time: Optional[float] = None


@router.post("/span")
async def ingest_span(record: SpanRecord):
    """트레이스 Span 기록."""
    from datetime import datetime, timezone, timedelta
    try:
        from app.database import get_db_context
        from app.models.observability import TraceSpanModel
        async with get_db_context() as db:
            now = datetime.now(timezone.utc)
            _parent = record.parent_id or None
            if _parent:
                try:
                    __import__('uuid').UUID(_parent)
                except (ValueError, AttributeError):
                    # W3C 16-hex 등 비UUID parent → 링크 대신 메타데이터로 보존
                    record.metadata = {**(record.metadata or {}), "w3c_parent": _parent}
                    _parent = None
            span = TraceSpanModel(
                id=record.span_id or str(__import__('uuid').uuid4()),
                trace_id=record.trace_id,
                parent_id=_parent,
                name=record.name,
                agent_id=record.agent_id or None,
                status=record.status,
                input_text=record.input_text[:200] if record.input_text else None,
                output_text=record.output_text[:200] if record.output_text else None,
                start_time=(datetime.fromtimestamp(record.start_time, tz=timezone.utc)
                            if record.start_time
                            else now - timedelta(milliseconds=record.duration_ms)),
                end_time=(datetime.fromtimestamp(record.end_time, tz=timezone.utc)
                          if record.end_time else now),
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


class ConversationRecord(BaseModel):
    trace_id: str = ""
    session_id: str = ""
    caller: str = ""
    callee: str = ""
    channel: str = "call_agent"
    query: str = ""
    answer: str = ""
    status: str = "success"
    duration_ms: float = 0
    started_at: Optional[float] = None


@router.post("/conversation")
async def ingest_conversation(record: ConversationRecord):
    """에이전트 간 대화 로그 수집 (스팬과 분리 — 전문 보존, 취소돼도 기록)."""
    from datetime import datetime, timezone
    import uuid as _uuid
    try:
        from app.database import get_db_context
        from app.models.observability import AgentConversation
        _trace = record.trace_id or None
        if _trace:
            try:
                _uuid.UUID(_trace)
            except ValueError:
                _trace = None
        async with get_db_context() as db:
            conv = AgentConversation(
                id=str(_uuid.uuid4()),
                trace_id=_trace,
                session_id=record.session_id or None,
                caller=record.caller, callee=record.callee, channel=record.channel,
                query=record.query[:4000] or None, answer=record.answer[:4000] or None,
                status=record.status, duration_ms=record.duration_ms,
                started_at=(datetime.fromtimestamp(record.started_at, tz=timezone.utc)
                            if record.started_at else datetime.now(timezone.utc)),
            )
            db.add(conv)
            await db.commit()
        from app.routers.stream import broadcast_event
        broadcast_event("new_conversation", record.model_dump())
        return {"status": "ok", "conversation_id": conv.id}
    except Exception as e:
        logger.warning(f"Conversation ingest failed: {e}")
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

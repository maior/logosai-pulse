"""FORGE Conversation Router — ForgeBridge negotiation 시각화용.

ForgeBridge 가 보내는 trace span (`forge.negotiation`) 을 묶어
대화 목록 + 단일 대화 상세를 반환한다. logos_pulse/frontend ForgeTab 이 소비.

Span 구조 (acp_server/acp_modules/forge_bridge.py 참조):
  name="forge.negotiation"
  agent_id="forge_bridge"
  input_text=<gap_result.suggested_description>
  output_text="agent_id=<id>" | "timeout..." | "error: ..."
  metadata 시작: session_id, missing_capabilities, ws_endpoint
  metadata 종료: code_chars, phases, stages_timeline, self_evolution
"""

from __future__ import annotations

import logging
from typing import Any, Optional

from fastapi import APIRouter, Query
from sqlalchemy import select, desc

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/forge", tags=["Forge"])


_PERIOD_HOURS = {"1h": 1, "6h": 6, "24h": 24, "7d": 24 * 7, "30d": 24 * 30}


def _period_to_cutoff(period: str):
    from datetime import datetime, timedelta, timezone
    hours = _PERIOD_HOURS.get(period, 24)
    return datetime.now(timezone.utc) - timedelta(hours=hours)


def _classify_status(span) -> str:
    """span.status / output_text 기반으로 conversation status 결정."""
    if span.status == "running":
        return "running"
    if span.status == "success":
        return "completed"
    out = (span.output_text or "").lower()
    if "timeout" in out:
        return "timeout"
    if "error" in out or "fail" in out:
        return "failed"
    return "failed"


def _summarize_span(span) -> dict[str, Any]:
    """forge.negotiation span → conversation summary."""
    meta = span.span_metadata or {}
    self_evolution = meta.get("self_evolution") or {}
    stages_timeline = meta.get("stages_timeline") or []
    phases = meta.get("phases") or []

    # output_text 에서 agent_id 추출 (e.g., "agent_id=mycooltool_xxx")
    output = span.output_text or ""
    generated_agent_id: Optional[str] = None
    if output.startswith("agent_id="):
        generated_agent_id = output.split("=", 1)[1].strip() or None

    return {
        "id": span.id,
        "trace_id": span.trace_id,
        "started_at": span.start_time.isoformat() if span.start_time else None,
        "ended_at": span.end_time.isoformat() if span.end_time else None,
        "duration_ms": span.duration_ms,
        "status": _classify_status(span),
        "trigger_query": span.input_text or "",
        "session_id": meta.get("session_id"),
        "missing_capabilities": meta.get("missing_capabilities") or [],
        "ws_endpoint": meta.get("ws_endpoint"),
        "result": {
            "generated_agent_id": generated_agent_id,
            "code_chars": meta.get("code_chars"),
            "phases_count": len(phases),
            "stages_count": len(stages_timeline),
        },
        "self_evolution": {
            "eval_score": self_evolution.get("eval_score"),
            "admission": self_evolution.get("admission"),
            "healing_applied": self_evolution.get("healing_applied"),
            "growing_patterns_added": self_evolution.get("growing_patterns_added"),
            "quality_score": self_evolution.get("quality_score"),
            "requires_approval": self_evolution.get("requires_approval"),
            "registered": self_evolution.get("registered"),
        },
    }


@router.get("/conversations")
async def list_conversations(
    period: str = Query("24h", regex="^(1h|6h|24h|7d|30d)$"),
    limit: int = Query(50, le=200, ge=1),
):
    """최근 FORGE negotiation 대화 목록 (요약)."""
    from app.database import get_db_context
    from app.models.observability import TraceSpanModel

    cutoff = _period_to_cutoff(period)
    try:
        async with get_db_context() as db:
            result = await db.execute(
                select(TraceSpanModel)
                .where(TraceSpanModel.name == "forge.negotiation")
                .where(TraceSpanModel.created_at >= cutoff)
                .order_by(desc(TraceSpanModel.created_at))
                .limit(limit)
            )
            spans = result.scalars().all()
            return [_summarize_span(s) for s in spans]
    except Exception as e:
        logger.warning(f"list_conversations failed: {e}")
        return []


@router.get("/conversations/{span_id}")
async def get_conversation(span_id: str):
    """단일 FORGE 대화 상세 — root span + 동일 trace_id 의 child spans."""
    from app.database import get_db_context
    from app.models.observability import TraceSpanModel

    try:
        async with get_db_context() as db:
            # span_id 로 root 찾기
            result = await db.execute(
                select(TraceSpanModel).where(TraceSpanModel.id == span_id)
            )
            root = result.scalar_one_or_none()
            if not root:
                return {"error": "not_found"}

            # 동일 trace_id 의 모든 spans
            result = await db.execute(
                select(TraceSpanModel)
                .where(TraceSpanModel.trace_id == root.trace_id)
                .order_by(TraceSpanModel.created_at)
            )
            all_spans = result.scalars().all()

            spans_serialized = [
                {
                    "id": s.id,
                    "name": s.name,
                    "agent_id": s.agent_id,
                    "status": s.status,
                    "input": s.input_text,
                    "output": s.output_text,
                    "duration_ms": s.duration_ms,
                    "metadata": s.span_metadata or {},
                    "started_at": s.start_time.isoformat() if s.start_time else None,
                    "ended_at": s.end_time.isoformat() if s.end_time else None,
                }
                for s in all_spans
            ]

            summary = _summarize_span(root)
            root_meta = root.span_metadata or {}
            return {
                "summary": summary,
                "spans": spans_serialized,
                "stages_timeline": root_meta.get("stages_timeline") or [],
                "phases": root_meta.get("phases") or [],
                # 신규 (2026-05-09) — FORGE 대화 가시화
                "negotiation_messages": root_meta.get("negotiation_messages") or [],
                "workflow_context": root_meta.get("workflow_context") or {},
                "generated_code_preview": root_meta.get("generated_code_preview") or "",
                "generated_code_full_chars": root_meta.get("generated_code_full_chars") or 0,
            }
    except Exception as e:
        logger.warning(f"get_conversation failed: {e}")
        return {"error": str(e)}

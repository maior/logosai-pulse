"""Decisions API — 온톨로지 에이전트 선택 근거 + 학습 데이터 추출.

Pulse 가 '무엇이 실행됐나'라면, 여기는 '왜 그 에이전트가 선택됐나'다.
데이터 원천은 온톨로지의 selector_stats.json (읽기 전용).
"""

import logging

from fastapi import APIRouter, Query

from app.services.decision_reader import (
    load_selector_stats, parse_decisions, summarize_decisions, to_training_records,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/decisions", tags=["Decisions"])


@router.get("")
async def list_decisions(
    limit: int = Query(50, ge=1, le=200),
    agent_id: str = Query("", description="특정 에이전트로 필터"),
    method: str = Query("", description="선택 방식으로 필터 (kg_assisted 등)"),
):
    """최근 에이전트 선택 결정 + 근거 체인."""
    raw = load_selector_stats()
    decisions = parse_decisions(raw, limit=200)  # 필터 후 limit 적용

    if agent_id:
        decisions = [d for d in decisions if d["selected_agent"] == agent_id]
    if method:
        decisions = [d for d in decisions if d["method"] == method]

    return {"decisions": decisions[:limit], "count": len(decisions[:limit])}


@router.get("/stats")
async def decision_stats():
    """선택 방식 분포 + GNN+RL 채택률 + 라벨 비율."""
    return summarize_decisions(load_selector_stats())


@router.get("/export")
async def export_training_data(limit: int = Query(1000, ge=1, le=10000)):
    """학습용 (features, action, reward) 레코드.

    feedback 이 달린 레코드만 내보낸다 — 라벨 없는 것을 섞으면 학습이 오염된다.
    """
    out = to_training_records(load_selector_stats())
    return {
        "records": out["records"][:limit],
        "labeled": out["labeled"],
        "unlabeled": out["unlabeled"],
        "schema": {
            "features": ["entities", "related_concepts", "kg_confidence",
                         "method", "pattern_scores", "recommended_agents", "semantics"],
            "action": "selected_agent",
            "reward": ["success", "elapsed_ms", "confidence"],
        },
    }

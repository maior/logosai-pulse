"""온톨로지 에이전트 선택 근거 리더 (2026-07-19).

HybridAgentSelector 는 "왜 이 에이전트를 골랐는지"를 selector_stats.json 에
이미 구조화 저장한다 (그래프 근거 + 과거 패턴 점수 + 자연어 reasoning).
Pulse 는 '무엇이 실행됐나'만 보여줬으므로, 여기에 '왜 선택됐나'를 붙인다.

온톨로지는 DB 가 없어 JSON 파일이 유일한 산출물이다 → 읽기 전용으로 접근한다.
파일 I/O 는 load_selector_stats 에만 두고 나머지는 순수 함수로 분리해
서버·파일 없이 테스트 가능하게 한다.
"""

import json
import logging
import os
from typing import Any, Dict, List

logger = logging.getLogger(__name__)

# 기본 경로는 Logos 루트 기준. 배포 환경이 다르면 env 로 재정의.
_DEFAULT_PATH = os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
    "..", "ontology", "data", "selector_stats.json",
)
SELECTOR_STATS_PATH = os.path.normpath(
    os.getenv("LOGOS_SELECTOR_STATS", _DEFAULT_PATH)
)

# 498KB 파일을 매 요청 파싱하지 않는다 — mtime 이 바뀔 때만 다시 읽는다
_cache: Dict[str, Any] = {"mtime": None, "data": {}}


def load_selector_stats(path: str = "") -> Dict[str, Any]:
    """selector_stats.json 로드. 파일이 없거나 깨져도 예외를 던지지 않는다."""
    target = path or SELECTOR_STATS_PATH
    try:
        mtime = os.path.getmtime(target)
        if _cache["mtime"] == mtime and _cache["data"]:
            return _cache["data"]
        with open(target, encoding="utf-8") as f:
            data = json.load(f)
        _cache["mtime"] = mtime
        _cache["data"] = data
        return data
    except Exception as e:
        logger.warning(f"selector_stats 로드 실패 ({target}): {e}")
        return {}


def _evidence_from(insights: Dict[str, Any]) -> List[Dict[str, Any]]:
    """past_patterns → 근거 항목. 왜 이 에이전트가 점수를 얻었는지를 담는다."""
    out = []
    for p in (insights.get("past_patterns") or []):
        out.append({
            "agent": p.get("agent", ""),
            "pattern": p.get("generalization_pattern", ""),
            "success_rate": p.get("success_rate", 0.0),
            "usage_count": p.get("usage_count", 0),
            "match_score": p.get("match_score", 0.0),
            "final_score": p.get("final_score", 0.0),
            "last_used": p.get("last_used", ""),
        })
    return out


def parse_decisions(raw: Dict[str, Any], limit: int = 50) -> List[Dict[str, Any]]:
    """선택 이력 → 근거 체인이 붙은 결정 목록 (최신순)."""
    history = raw.get("selection_history") or []
    decisions = []
    for rec in reversed(history):          # 저장은 오래된 순 → 최신 먼저 보여준다
        insights = rec.get("graph_insights") or {}
        feedback = rec.get("feedback") or {}
        decisions.append({
            "timestamp": rec.get("timestamp", ""),
            "query": rec.get("query", ""),
            "selected_agent": rec.get("selected_agent", ""),
            "method": rec.get("method", ""),
            "confidence": rec.get("confidence", 0.0),
            "elapsed_ms": rec.get("elapsed_ms", 0.0),
            "reasoning": rec.get("reasoning", ""),
            "entities": insights.get("entities") or [],
            "related_concepts": insights.get("related_concepts") or [],
            "recommended_agents": insights.get("recommended_agents") or [],
            "kg_confidence": insights.get("kg_confidence", 0.0),
            "evidence": _evidence_from(insights),
            "outcome": {
                "success": feedback.get("success"),
                "semantics": feedback.get("query_semantics") or {},
            },
        })
        if len(decisions) >= limit:
            break
    return decisions


def summarize_decisions(raw: Dict[str, Any]) -> Dict[str, Any]:
    """선택 방식 분포 + GNN+RL 채택률 + 라벨 비율."""
    history = raw.get("selection_history") or []
    stats = raw.get("stats") or {}

    by_method: Dict[str, int] = {}
    labeled = 0
    successes = 0
    conf_sum = 0.0
    elapsed_sum = 0.0
    for rec in history:
        by_method[rec.get("method", "unknown")] = by_method.get(rec.get("method", "unknown"), 0) + 1
        conf_sum += rec.get("confidence", 0.0) or 0.0
        elapsed_sum += rec.get("elapsed_ms", 0.0) or 0.0
        fb = rec.get("feedback") or {}
        if fb.get("success") is not None:
            labeled += 1
            if fb.get("success"):
                successes += 1

    total = len(history)
    # 학습된 가중치가 있어도 채택되지 않으면 의미가 없다 — 그 상태를 드러낸다
    gnn_sel = stats.get("gnn_rl_selections", 0) or 0
    gnn_fb = stats.get("gnn_rl_fallback", 0) or 0
    gnn_total = gnn_sel + gnn_fb

    return {
        "total": total,
        "by_method": by_method,
        "labeled": labeled,
        "labeled_ratio": round(labeled / total, 3) if total else 0.0,
        "success_rate": round(successes / labeled, 3) if labeled else None,
        "avg_confidence": round(conf_sum / total, 3) if total else 0.0,
        "avg_elapsed_ms": round(elapsed_sum / total, 1) if total else 0.0,
        "gnn_rl": {
            "selections": gnn_sel,
            "fallback": gnn_fb,
            "adoption_rate": round(gnn_sel / gnn_total, 3) if gnn_total else 0.0,
        },
        "totals": {
            "total_selections": stats.get("total_selections", 0),
            "graph_assisted": stats.get("graph_assisted", 0),
            "llm_only": stats.get("llm_only", 0),
        },
    }


def to_training_records(raw: Dict[str, Any]) -> Dict[str, Any]:
    """(features, action, reward) 학습 데이터.

    feedback 이 있는 레코드만 라벨링된 데이터로 취급한다.
    라벨 없는 것을 섞으면 보상 신호가 오염되므로 개수만 보고한다.
    """
    history = raw.get("selection_history") or []
    records = []
    unlabeled = 0

    for rec in history:
        fb = rec.get("feedback") or {}
        if fb.get("success") is None:
            unlabeled += 1
            continue
        insights = rec.get("graph_insights") or {}
        records.append({
            "timestamp": rec.get("timestamp", ""),
            "query": rec.get("query", ""),
            "features": {
                "entities": insights.get("entities") or [],
                "related_concepts": insights.get("related_concepts") or [],
                "kg_confidence": insights.get("kg_confidence", 0.0),
                "method": rec.get("method", ""),
                "pattern_scores": [
                    p.get("final_score", 0.0)
                    for p in (insights.get("past_patterns") or [])
                ],
                "recommended_agents": insights.get("recommended_agents") or [],
                "semantics": fb.get("query_semantics") or {},
            },
            "action": rec.get("selected_agent", ""),
            "reward": {
                "success": fb.get("success"),
                "elapsed_ms": rec.get("elapsed_ms", 0.0),
                "confidence": rec.get("confidence", 0.0),
            },
        })

    return {"records": records, "labeled": len(records), "unlabeled": unlabeled}

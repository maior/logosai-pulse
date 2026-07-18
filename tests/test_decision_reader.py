"""decision_reader 순수 함수 테스트 (2026-07-19).

배경: 온톨로지(HybridAgentSelector)는 "왜 이 에이전트를 골랐는지"를
      selector_stats.json 에 이미 구조화 저장하지만 아무도 보지 않는다.
      Pulse 는 '무엇이 실행됐나'만 보여준다 — 근거를 붙인다.

또한 feedback(success) 이 달린 레코드는 그대로 (state, action, reward) 학습
데이터가 된다. 라벨 없는 레코드를 섞으면 학습이 오염되므로 분리해야 한다.

직접 실행: python tests/test_decision_reader.py
"""

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from app.services.decision_reader import (
    parse_decisions, summarize_decisions, to_training_records,
)

RAW = {
    "stats": {
        "total_selections": 886,
        "gnn_rl_selections": 0,
        "gnn_rl_fallback": 570,
        "graph_assisted": 878,
        "llm_only": 8,
    },
    "selection_history": [
        {
            "timestamp": "2026-07-18T22:20:00", "query": "서울 날씨",
            "selected_agent": "weather_agent", "method": "kg_assisted",
            "confidence": 0.8, "elapsed_ms": 1200.0, "reasoning": "날씨 요청이므로",
            "graph_insights": {
                "entities": ["서울"], "related_concepts": [], "kg_confidence": 0.9,
                "recommended_agents": ["weather_agent"],
                "past_patterns": [
                    {"agent": "weather_agent", "generalization_pattern": "weather_lookup",
                     "success_rate": 1.0, "usage_count": 5, "match_score": 1.5,
                     "final_score": 1.5, "last_used": "2026-07-18T22:00:00"},
                ],
            },
            "feedback": {"success": True, "query_semantics": {"category": "weather"}},
        },
        {
            "timestamp": "2026-07-18T22:23:00", "query": "환율 알려줘",
            "selected_agent": "currency_exchange_agent", "method": "gnn_rl_assisted",
            "confidence": 0.4, "elapsed_ms": 800.0, "reasoning": "환율 요청",
            "graph_insights": {"entities": ["환율"], "kg_confidence": 0.5,
                               "past_patterns": [], "recommended_agents": []},
            "feedback": None,  # 라벨 없음
        },
    ],
}


def test_parse_returns_newest_first():
    """최근 결정을 먼저 보여줘야 한다."""
    out = parse_decisions(RAW, limit=10)
    assert len(out) == 2
    assert out[0]["query"] == "환율 알려줘", f"최신순 아님: {out[0]['query']}"
    print("PASS parse_returns_newest_first")


def test_parse_includes_evidence_chain():
    """'왜 골랐는지'의 근거가 함께 나와야 한다 — 이 기능의 핵심."""
    out = parse_decisions(RAW, limit=10)
    weather = [d for d in out if d["selected_agent"] == "weather_agent"][0]
    assert weather["reasoning"] == "날씨 요청이므로"
    assert weather["entities"] == ["서울"]
    assert weather["kg_confidence"] == 0.9
    assert len(weather["evidence"]) == 1
    ev = weather["evidence"][0]
    assert ev["pattern"] == "weather_lookup"
    assert ev["success_rate"] == 1.0 and ev["match_score"] == 1.5
    print("PASS parse_includes_evidence_chain")


def test_parse_respects_limit():
    out = parse_decisions(RAW, limit=1)
    assert len(out) == 1, f"limit 무시: {len(out)}건"
    print("PASS parse_respects_limit")


def test_parse_handles_missing_fields():
    """필드가 빠진 레코드에서도 죽지 않는다."""
    out = parse_decisions({"selection_history": [{"query": "x"}]}, limit=10)
    assert len(out) == 1
    assert out[0]["evidence"] == [] and out[0]["entities"] == []
    print("PASS parse_handles_missing_fields")


def test_summary_reports_gnn_rl_adoption():
    """GNN+RL 이 학습은 도는데 채택은 0인 상태가 드러나야 한다."""
    s = summarize_decisions(RAW)
    assert s["gnn_rl"]["selections"] == 0
    assert s["gnn_rl"]["fallback"] == 570
    assert s["gnn_rl"]["adoption_rate"] == 0.0, f"채택률 오류: {s['gnn_rl']}"
    print("PASS summary_reports_gnn_rl_adoption")


def test_summary_reports_method_and_label_ratio():
    s = summarize_decisions(RAW)
    assert s["by_method"]["kg_assisted"] == 1
    assert s["by_method"]["gnn_rl_assisted"] == 1
    assert s["labeled"] == 1 and s["total"] == 2
    assert s["labeled_ratio"] == 0.5
    print("PASS summary_reports_method_and_label_ratio")


def test_training_records_only_labeled():
    """라벨 없는 레코드가 학습 데이터에 섞이면 안 된다."""
    out = to_training_records(RAW)
    assert out["labeled"] == 1 and out["unlabeled"] == 1
    assert len(out["records"]) == 1
    rec = out["records"][0]
    assert rec["action"] == "weather_agent"
    assert rec["reward"]["success"] is True
    assert rec["features"]["kg_confidence"] == 0.9
    assert rec["features"]["pattern_scores"] == [1.5]
    print("PASS training_records_only_labeled")


def test_empty_input_is_safe():
    """파일이 없거나 비어도 예외 없이 빈 결과."""
    assert parse_decisions({}, limit=10) == []
    assert summarize_decisions({})["total"] == 0
    assert to_training_records({})["records"] == []
    print("PASS empty_input_is_safe")


if __name__ == "__main__":
    test_parse_returns_newest_first()
    test_parse_includes_evidence_chain()
    test_parse_respects_limit()
    test_parse_handles_missing_fields()
    test_summary_reports_gnn_rl_adoption()
    test_summary_reports_method_and_label_ratio()
    test_training_records_only_labeled()
    test_empty_input_is_safe()
    print("\n✅ decision_reader 테스트 8/8 통과")

"""journey_builder 순수 함수 테스트.

Usage: python tests/test_journey_builder.py
"""

import os
import sys
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.services.journey_builder import build_journey, infer_stage

T0 = datetime(2026, 7, 2, 10, 0, 0, tzinfo=timezone.utc).timestamp()


def span(id, name, *, parent=None, agent="", start=0.0, dur=100, status="success",
         inp="", out="", meta=None):
    return {"id": id, "trace_id": "tr-1", "parent_id": parent, "name": name,
            "agent_id": agent, "status": status, "start_time": T0 + start,
            "duration_ms": dur, "input": inp, "output": out, "metadata": meta or {}}


SPANS = [
    span("r", "orchestrator.stream_with_orchestrator", agent="logos_api_orchestrator",
         start=0.0, dur=5000, inp="이태원 맛집 찾고 요약해줘", meta={"stage": "ingress"}),
    span("c", "classify.workflow", parent="r", agent="task_classifier",
         start=0.2, dur=800, out="restaurant_finder_agent, summarization_agent",
         meta={"stage": "plan", "agents": ["restaurant_finder_agent", "summarization_agent"]}),
    span("m", "acp.multi_query", parent="r", agent="", start=1.1, dur=3800),
    span("a1", "restaurant_finder_agent.process", parent="m",
         agent="restaurant_finder_agent", start=1.2, dur=1500),
    span("l1", "llm.gemini-2.5-flash-lite", parent="a1", agent="",
         start=1.3, dur=600, meta={"stage": "llm"}),
    span("t1", "tool(search_places)", parent="a1", agent="restaurant_finder_agent",
         start=2.0, dur=400, inp="{'area':'이태원'}", out="12곳",
         meta={"stage": "harness_tool", "tool": "search_places"}),
    span("ca", "call_agent(summarization_agent)", parent="a1",
         agent="summarization_agent", start=2.6, dur=900,
         inp="12곳 요약해줘", out="이태원 상위 3곳: …",
         meta={"stage": "a2a_call", "caller_id": "restaurant_finder_agent"}),
    span("i", "integrate.results", parent="m", agent="result_integrator",
         start=4.6, dur=300, meta={"stage": "integrate"}),
]


def test_stage_inference_metadata_first_then_name_heuristics():
    assert infer_stage({"name": "x", "metadata": {"stage": "plan"}}) == "plan"
    assert infer_stage({"name": "llm.gpt", "metadata": {}}) == "llm"
    assert infer_stage({"name": "call_agent(x)", "metadata": None}) == "a2a_call"
    assert infer_stage({"name": "weather_agent.process"}) == "agent"
    assert infer_stage({"name": "react.step2(calc)"}) == "harness_react"
    assert infer_stage({"name": "internal_call(sample_tools)"}) == "a2a_call"


def test_stages_ordered_by_first_appearance():
    j = build_journey(SPANS)
    stage_seq = [s["stage"] for s in j["stages"]]
    assert stage_seq[0] == "ingress"
    assert stage_seq.index("plan") < stage_seq.index("agent")
    assert stage_seq.index("agent") < stage_seq.index("integrate")
    plan = next(s for s in j["stages"] if s["stage"] == "plan")
    assert plan["label"] == "분석·워크플로 판단"


def test_lanes_inherit_agent_from_ancestors_with_real_offsets():
    j = build_journey(SPANS)
    lane_ids = [l["agent_id"] for l in j["lanes"]]
    # llm span(agent_id="")은 부모 a1의 restaurant_finder_agent 레인으로
    rf = next(l for l in j["lanes"] if l["agent_id"] == "restaurant_finder_agent")
    assert any(sp["stage"] == "llm" for sp in rf["spans"])
    # 실측 offset: llm은 1300ms 지점
    llm = next(sp for sp in rf["spans"] if sp["stage"] == "llm")
    assert abs(llm["offset_ms"] - 1300) < 1
    # 레인은 첫 등장 순
    assert lane_ids[0] == "logos_api_orchestrator"


def test_conversations_extracted_with_caller_and_callee():
    j = build_journey(SPANS)
    assert len(j["conversations"]) == 1
    conv = j["conversations"][0]
    assert conv["caller"] == "restaurant_finder_agent"
    assert conv["callee"] == "summarization_agent"
    assert "요약" in conv["query"]
    assert "상위 3곳" in conv["answer"]


def test_conversation_caller_falls_back_to_parent_agent():
    spans = [
        span("a", "desktop_agent.process", agent="desktop_agent", start=0, dur=1000),
        span("ic", "internal_call(mail_agent)", parent="a", agent="mail_agent",
             start=0.2, dur=500, inp="메일 보내줘", meta={"stage": "a2a_call"}),
    ]
    j = build_journey(spans)
    assert j["conversations"][0]["caller"] == "desktop_agent"
    assert j["conversations"][0]["callee"] == "mail_agent"


def test_delegate_boundary_excluded_from_conversations():
    spans = SPANS + [span("d", "delegate(x3)", parent="a1",
                          agent="restaurant_finder_agent", start=2.5, dur=1000,
                          meta={"stage": "a2a_call", "parallel": True, "tasks": 3})]
    j = build_journey(spans)
    assert all(not c["callee"].startswith("x3") for c in j["conversations"])
    assert len(j["conversations"]) == 1, "delegate 자체는 대화가 아님"


def test_counts_and_totals():
    j = build_journey(SPANS)
    c = j["counts"]
    assert c["spans"] == 8
    assert c["a2a_calls"] == 1 and c["llm_calls"] == 1 and c["tool_calls"] == 1
    assert c["errors"] == 0
    assert j["total_duration_ms"] >= 5000
    assert j["query"].startswith("이태원")


def test_empty_and_legacy_spans_do_not_crash():
    assert build_journey([])["spans" if "spans" in build_journey([]) else "counts"] is not None
    legacy = [{"id": "x", "trace_id": "t", "parent_id": None, "name": "old.process",
               "agent_id": "old", "status": "success", "start_time": None,
               "created_at": datetime.now(timezone.utc), "duration_ms": 100,
               "metadata": None}]
    j = build_journey(legacy)
    assert j["counts"]["spans"] == 1


def test_federation_stage_recognized():
    """연합 위임 span (stage=federation) 이 여정 스테이지로 인식·라벨링돼야 한다."""
    spans = [
        {"span_id": "s1", "parent_span_id": None, "name": "federation.delegate fed.govB.registry_lookup_agent",
         "agent_id": "fed.govB.registry_lookup_agent", "duration_ms": 1200, "success": True,
         "metadata": {"stage": "federation"}, "start_time": "2026-07-03T10:00:00Z"},
    ]
    j = build_journey(spans, {"id": "e1"})
    stages = {st["stage"]: st for st in j["stages"]}
    assert "federation" in stages, f"federation 스테이지 미인식: {list(stages)}"
    assert "연합" in stages["federation"]["label"]


if __name__ == "__main__":
    fns = [v for k, v in sorted(globals().items()) if k.startswith("test_")]
    for fn in fns:
        fn()
        print(f"  ✓ {fn.__name__}")
    print(f"PASS: {len(fns)} journey_builder tests")

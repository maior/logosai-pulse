"""Journey Builder — trace span 목록을 '쿼리 여정' 구조로 조립 (순수 함수).

여정 = 쿼리 유입 → 분석·워크플로 판단 → 에이전트 실행 → 하네스/Agentic 동작
       → 에이전트 간 대화 → LLM 호출 → 결과 통합 → 반환

stage 판정: span_metadata.stage(신규 규약) 우선, 없으면 name 휴리스틱(레거시 span 호환).
DB 접근 없음 — 라우터가 조회한 rows(dict)를 받아 조립만 한다 (단위테스트 용이).
"""

from datetime import datetime
from typing import Any, Dict, List, Optional

STAGE_ORDER = [
    "ingress", "plan", "route", "agent",
    "harness_react", "harness_tool", "harness_plan",
    "a2a_call", "federation", "llm", "external", "integrate",
]

STAGE_LABELS = {
    "ingress": "쿼리 유입",
    "plan": "분석·워크플로 판단",
    "route": "라우팅",
    "agent": "에이전트 실행",
    "harness_react": "추론 (ReAct)",
    "harness_tool": "도구 사용",
    "harness_plan": "계획 수립",
    "a2a_call": "에이전트 간 대화",
    "federation": "기관 간 연합 위임",
    "llm": "LLM 호출",
    "external": "외부 시스템",
    "integrate": "결과 통합",
}


def infer_stage(span: Dict[str, Any]) -> str:
    """metadata.stage 우선, 없으면 name 휴리스틱 (레거시 호환)."""
    meta = span.get("metadata") or {}
    if isinstance(meta, dict) and meta.get("stage"):
        return str(meta["stage"])
    name = span.get("name", "") or ""
    if name.startswith("llm."):
        return "llm"
    if name.startswith("call_agent(") or name.startswith("internal_call(") or name.startswith("delegate("):
        return "a2a_call"
    if name.startswith("tool(") or name.startswith("tool_http("):
        return "harness_tool"
    if name.startswith("react."):
        return "harness_react"
    if name.startswith("classify."):
        return "plan"
    if name.startswith("integrate."):
        return "integrate"
    if name.startswith("orchestrator."):
        return "ingress"
    if name == "acp.multi_query":
        return "route"
    if name.endswith(".process"):
        return "agent"
    if name.startswith("forge."):
        return "external"
    return "agent"


def _ts(value: Any) -> Optional[float]:
    """start_time(datetime|iso str) → epoch sec."""
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.timestamp()
    if isinstance(value, (int, float)):
        return float(value)
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00")).timestamp()
    except (ValueError, TypeError):
        return None


def _callee_from_name(name: str) -> str:
    if "(" in name and name.endswith(")"):
        return name[name.index("(") + 1:-1]
    return ""


def build_journey(spans: List[Dict[str, Any]],
                  execution: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    """span rows → 여정 구조.

    반환:
      trace_id, query, total_duration_ms, started_at,
      stages:  단계별 요약 (등장 순서·소요·건수·상태)
      lanes:   에이전트별 스윔레인 (실측 offset 기반 타임라인 바)
      conversations: 에이전트 간 대화 (caller → callee, 질문/답변, 시각)
      counts:  집계
    """
    if not spans:
        return {"trace_id": "", "query": "", "spans": 0, "stages": [],
                "lanes": [], "conversations": [], "counts": {}}

    by_id = {s.get("id"): s for s in spans}
    for s in spans:
        s["_stage"] = infer_stage(s)
        s["_start"] = _ts(s.get("start_time")) or _ts(s.get("created_at"))

    starts = [s["_start"] for s in spans if s["_start"] is not None]
    t0 = min(starts) if starts else 0.0
    ends = [(s["_start"] or t0) + (s.get("duration_ms") or 0) / 1000.0 for s in spans]
    total_ms = round((max(ends) - t0) * 1000, 1) if ends else 0.0

    def offset_ms(s: Dict) -> float:
        return round(((s["_start"] or t0) - t0) * 1000, 1)

    def agent_of(s: Dict) -> str:
        """agent_id 없으면 조상에서 상속 (llm/도구 span을 소속 에이전트 레인에)."""
        cur, hops = s, 0
        while cur is not None and hops < 20:
            if cur.get("agent_id"):
                return cur["agent_id"]
            cur = by_id.get(cur.get("parent_id"))
            hops += 1
        return "system"

    # ── 스윔레인 ──────────────────────────────────────────────
    lanes_map: Dict[str, List[Dict]] = {}
    for s in sorted(spans, key=lambda x: x["_start"] or t0):
        lane = agent_of(s)
        lanes_map.setdefault(lane, []).append({
            "id": s.get("id"),
            "name": s.get("name"),
            "stage": s["_stage"],
            "status": s.get("status"),
            "offset_ms": offset_ms(s),
            "duration_ms": s.get("duration_ms") or 0,
            "input": s.get("input") or s.get("input_text") or "",
            "output": s.get("output") or s.get("output_text") or "",
            "metadata": s.get("metadata") or {},
        })
    lanes = [
        {"agent_id": k, "spans": v,
         "first_offset_ms": v[0]["offset_ms"],
         "total_ms": round(sum(x["duration_ms"] for x in v), 1)}
        for k, v in lanes_map.items()
    ]
    lanes.sort(key=lambda l: l["first_offset_ms"])

    # ── 단계 요약 (여정 진행바) ────────────────────────────────
    stage_agg: Dict[str, Dict] = {}
    for s in spans:
        st = s["_stage"]
        agg = stage_agg.setdefault(st, {
            "stage": st, "label": STAGE_LABELS.get(st, st),
            "count": 0, "duration_ms": 0.0,
            "first_offset_ms": offset_ms(s), "status": "success",
        })
        agg["count"] += 1
        agg["duration_ms"] = round(agg["duration_ms"] + (s.get("duration_ms") or 0), 1)
        agg["first_offset_ms"] = min(agg["first_offset_ms"], offset_ms(s))
        if s.get("status") == "error":
            agg["status"] = "error"
    stages = sorted(stage_agg.values(),
                    key=lambda a: (a["first_offset_ms"],
                                   STAGE_ORDER.index(a["stage"]) if a["stage"] in STAGE_ORDER else 99))

    # ── 에이전트 간 대화 ──────────────────────────────────────
    conversations = []
    for s in sorted((x for x in spans if x["_stage"] == "a2a_call"),
                    key=lambda x: x["_start"] or t0):
        name = s.get("name", "")
        if name.startswith("delegate("):
            continue  # 팬아웃 경계는 대화 아님 (자식 call_agent가 대화)
        meta = s.get("metadata") or {}
        caller = meta.get("caller_id") or ""
        if not caller:
            parent = by_id.get(s.get("parent_id"))
            caller = agent_of(parent) if parent else "system"
            if meta.get("source"):
                caller = f"{meta['source']}:{caller}"
        callee = s.get("agent_id") or _callee_from_name(name) or "?"
        conversations.append({
            "seq": len(conversations) + 1,
            "caller": caller,
            "callee": callee,
            "query": s.get("input") or s.get("input_text") or "",
            "answer": s.get("output") or s.get("output_text") or "",
            "status": s.get("status"),
            "offset_ms": offset_ms(s),
            "duration_ms": s.get("duration_ms") or 0,
        })

    query = ""
    if execution:
        query = execution.get("query") or ""
    if not query:
        roots = [s for s in spans if not s.get("parent_id")]
        if roots:
            query = roots[0].get("input") or roots[0].get("input_text") or ""

    return {
        "trace_id": spans[0].get("trace_id", ""),
        "query": query,
        "total_duration_ms": total_ms,
        "started_at": datetime.fromtimestamp(t0).isoformat() if t0 else None,
        "stages": stages,
        "lanes": lanes,
        "conversations": conversations,
        "counts": {
            "spans": len(spans),
            "agents": len([l for l in lanes if l["agent_id"] != "system"]),
            "a2a_calls": len(conversations),
            "llm_calls": sum(1 for s in spans if s["_stage"] == "llm"),
            "tool_calls": sum(1 for s in spans if s["_stage"] == "harness_tool"),
            "errors": sum(1 for s in spans if s.get("status") == "error"),
        },
    }

"""TestRun ingest + listing — JSONL file backend.

Lightweight: no DB migration. Each TestRun is one line of JSON in
~/.logosai/test_runs.jsonl. Designed for E2E harness (test_e2e_workflow.py)
to record scenario outcomes and let LogosPulse Tests tab display them.
"""
from __future__ import annotations

import json
import logging
import os
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, List, Optional

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1", tags=["TestRuns"])

_STORE = Path(os.path.expanduser("~/.logosai/test_runs.jsonl"))
_STORE.parent.mkdir(parents=True, exist_ok=True)


class TestRunIn(BaseModel):
    suite: str = Field(..., min_length=1, max_length=80)
    scenario: str = Field(..., min_length=1, max_length=120)
    query: str = Field(..., min_length=1, max_length=2000)
    expected_pattern: str = Field(..., min_length=1, max_length=40)
    actual_pattern: Optional[str] = None
    actual_agents: List[str] = Field(default_factory=list)
    passed: bool
    latency_ms: Optional[float] = None
    trace_id: Optional[str] = None
    issues: List[str] = Field(default_factory=list)
    notes: Optional[str] = None


def _read_all() -> List[dict[str, Any]]:
    if not _STORE.exists():
        return []
    out: List[dict[str, Any]] = []
    try:
        with _STORE.open("r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    out.append(json.loads(line))
                except json.JSONDecodeError:
                    continue  # skip malformed line
    except OSError as e:
        logger.warning(f"_read_all failed: {e}")
    return out


def _append(record: dict[str, Any]) -> None:
    try:
        with _STORE.open("a", encoding="utf-8") as f:
            f.write(json.dumps(record, ensure_ascii=False) + "\n")
    except OSError as e:
        logger.error(f"test_run append failed: {e}")
        raise


@router.post("/ingest/test_run")
async def ingest_test_run(record: TestRunIn):
    """Append one test run to JSONL store."""
    rid = str(uuid.uuid4())
    payload = {
        "id": rid,
        "created_at": datetime.now(timezone.utc).isoformat(),
        **record.model_dump(),
    }
    _append(payload)
    return {"ok": True, "id": rid}


@router.get("/test_runs")
async def list_test_runs(
    suite: Optional[str] = Query(None, max_length=80),
    scenario: Optional[str] = Query(None, max_length=120),
    passed: Optional[bool] = Query(None),
    limit: int = Query(100, le=1000, ge=1),
):
    """List recent test runs (newest first), optionally filtered."""
    rows = _read_all()
    if suite:
        rows = [r for r in rows if r.get("suite") == suite]
    if scenario:
        rows = [r for r in rows if r.get("scenario") == scenario]
    if passed is not None:
        rows = [r for r in rows if bool(r.get("passed")) == passed]
    rows.sort(key=lambda r: r.get("created_at", ""), reverse=True)
    return rows[:limit]


@router.get("/test_runs/summary")
async def summary(
    suite: Optional[str] = Query(None, max_length=80),
):
    """Aggregate pass-rate per suite (or single suite if specified)."""
    rows = _read_all()
    if suite:
        rows = [r for r in rows if r.get("suite") == suite]
    total = len(rows)
    passed = sum(1 for r in rows if r.get("passed"))
    failed = total - passed
    pass_rate = (passed / total) if total else 0.0

    # 시나리오별 분해 (있을 때)
    by_scenario: dict[str, dict[str, Any]] = {}
    for r in rows:
        sc = r.get("scenario", "unknown")
        d = by_scenario.setdefault(sc, {"total": 0, "passed": 0, "failed": 0})
        d["total"] += 1
        if r.get("passed"):
            d["passed"] += 1
        else:
            d["failed"] += 1
    for sc, d in by_scenario.items():
        d["pass_rate"] = (d["passed"] / d["total"]) if d["total"] else 0.0

    return {
        "suite": suite,
        "total": total,
        "passed": passed,
        "failed": failed,
        "pass_rate": round(pass_rate, 4),
        "by_scenario": by_scenario,
    }


@router.get("/test_runs/{run_id}")
async def get_test_run(run_id: str):
    """Fetch single test run by ID."""
    for r in _read_all():
        if r.get("id") == run_id:
            return r
    raise HTTPException(status_code=404, detail="not found")

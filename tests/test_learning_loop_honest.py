"""Phase A1 — LearningLoop.request_improvement 정직 보고 테스트.

결함 D1: 현재 구현은 GET 전용 라우트에 POST(405) 후 except/폴스루에서
무조건 {"success": True} 를 반환한다. 이 테스트는 설계 계약을 표현한다:
  - ACP POST /api/failures/trigger-improve 를 호출할 것
  - 200 + {"triggered": true}  → {"success": True, ...}
  - 비200(405 등)              → {"success": False, ...}  (가짜 성공 금지)
  - 연결 예외                  → {"success": False, "error": ...}

직접 실행:
    cd logos_pulse && python tests/test_learning_loop_honest.py
"""
import asyncio
import os
import sys

_PULSE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))  # logos_pulse/
sys.path.insert(0, _PULSE)
os.environ.setdefault("DATABASE_URL", "postgresql+asyncpg://x:x@localhost:5/x")  # import 안전용

from app.services import learning_loop as ll  # noqa: E402


# ── aiohttp 페이크 ─────────────────────────────────────────────
class FakeResp:
    def __init__(self, status, body):
        self.status = status
        self._body = body

    async def json(self):
        return self._body

    async def text(self):
        return str(self._body)

    async def __aenter__(self):
        return self

    async def __aexit__(self, *a):
        return False


class FakeSession:
    """post 호출 기록 + 지정 응답 반환. raise_exc 시 연결 예외 시뮬레이션."""
    last_url = None
    last_json = None
    resp = None
    raise_exc = None

    def __init__(self, *a, **kw):
        pass

    async def __aenter__(self):
        return self

    async def __aexit__(self, *a):
        return False

    def post(self, url, json=None, timeout=None, **kw):
        FakeSession.last_url = url
        FakeSession.last_json = json
        if FakeSession.raise_exc:
            raise FakeSession.raise_exc
        return FakeSession.resp


def run(coro):
    return asyncio.new_event_loop().run_until_complete(coro)


def main():
    fails = []

    def t(name, cond):
        print(("PASS " if cond else "FAIL ") + name)
        if not cond:
            fails.append(name)

    ll.aiohttp.ClientSession = FakeSession  # 모듈 내 참조 패치
    loop = ll.LearningLoop()
    patterns = {"failure_queries": ["q1", "q2"], "error_messages": ["e1"], "total_failures": 3}

    # 1) 정상: ACP 가 트리거 수락
    FakeSession.raise_exc = None
    FakeSession.resp = FakeResp(200, {"triggered": True, "scheduled": True, "reason": "ok"})
    r = run(loop.request_improvement("gen_agent", patterns))
    t("H-1 trigger-improve 엔드포인트 호출",
      FakeSession.last_url is not None and FakeSession.last_url.endswith("/api/failures/trigger-improve"))
    t("H-2 수락 → success True",
      isinstance(r, dict) and r.get("success") is True)

    # 2) ACP 가 게이트에서 거부 (triggered False) → success False (정직)
    FakeSession.resp = FakeResp(200, {"triggered": False, "reason": "never_improve"})
    r = run(loop.request_improvement("desktop_agent", patterns))
    t("H-3 게이트 거부 → success False + 사유 전달",
      isinstance(r, dict) and r.get("success") is False and r.get("reason") == "never_improve")

    # 3) 비200 (엔드포인트 없음/405) → 가짜 성공 금지
    FakeSession.resp = FakeResp(405, {"detail": "Method Not Allowed"})
    r = run(loop.request_improvement("gen_agent", patterns))
    t("H-4 비200 → success False (가짜 성공 금지)",
      r is None or (isinstance(r, dict) and r.get("success") is not True))
    t("H-5 비200 → dict 로 사유 보고 (None 금지)",
      isinstance(r, dict) and r.get("success") is False)

    # 4) 연결 예외 → success False + error
    FakeSession.raise_exc = ConnectionError("ACP down")
    r = run(loop.request_improvement("gen_agent", patterns))
    t("H-6 예외 → success False + error 필드",
      isinstance(r, dict) and r.get("success") is False and "error" in r)

    # 5) S1: scheduled 위임 — ACP 가 Shadow+A/B 를 소유하므로 로컬 shadow 생략,
    #    쿨다운 즉시 설정 (구버전 에이전트를 조기 테스트하는 시점 오류 제거)
    FakeSession.raise_exc = None
    loop2 = ll.LearningLoop()
    calls = {"shadow": 0, "record": 0}

    async def fake_detect():
        return [{"agent_id": "gen_agent"}]

    async def fake_patterns(agent_id):
        return {"failure_queries": ["q1"], "error_messages": ["e1"], "total_failures": 2}

    async def fake_request(agent_id, patterns_):
        return {"success": True, "triggered": True, "scheduled": True}

    async def fake_shadow(agent_id, queries):
        calls["shadow"] += 1
        return {"pass_rate": 1.0, "tested": 1, "passed": 1}

    async def fake_record(agent_id, patterns_, test_result):
        calls["record"] += 1

    loop2.detect_failing_agents = fake_detect
    loop2.analyze_patterns = fake_patterns
    loop2.request_improvement = fake_request
    loop2.shadow_test = fake_shadow
    loop2.record_improvement = fake_record
    run(loop2.run_cycle())
    t("S1-1 scheduled → 로컬 shadow 생략", calls["shadow"] == 0)
    t("S1-2 scheduled → 기록은 수행", calls["record"] == 1)
    t("S1-3 scheduled → 쿨다운 설정", loop2._is_in_cooldown("gen_agent"))

    print("RESULT:", "GREEN" if not fails else f"RED ({len(fails)} failing)")
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main())

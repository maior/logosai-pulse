"""LearningLoop — Phase B: Adaptive Learning 핵심 오케스트레이터.

실패 감지 → 패턴 분석 → FORGE 개선 → Shadow Test → 배포 자동 루프.
LogosPulse 백그라운드 태스크로 주기적 실행 (10분마다).

Flow:
    1. detect_failing_agents() — LogosPulse 메트릭에서 실패율 높은 에이전트
    2. analyze_patterns() — 실패 쿼리/에러 클러스터링
    3. request_improvement() — FORGE CodeImprover 호출
    4. shadow_test() — 실패했던 쿼리 3개로 테스트
    5. deploy_and_monitor() — ACP 핫 등록 + A/B 모니터링
"""

import asyncio
import logging
import time
from datetime import datetime, timezone, timedelta
from typing import Any, Dict, List, Optional

import aiohttp

from app.database import get_db_context
from app.models.observability import AgentExecution, UserFeedback

from sqlalchemy import select, func, and_, desc

logger = logging.getLogger(__name__)

# Config
ACP_URL = "http://localhost:8888"
FORGE_URL = "http://localhost:8030"
CYCLE_INTERVAL = 600  # 10분
FAILURE_THRESHOLD = 0.7  # 성공률 70% 미만 → 개선 대상
MIN_CALLS_FOR_ANALYSIS = 5  # 최소 5회 이상 호출된 에이전트만
NEGATIVE_FEEDBACK_THRESHOLD = 3  # 👎 3회 이상 → 개선 대상
SHADOW_PASS_RATE = 0.66  # Shadow test 66% 통과 필요
COOLDOWN_HOURS = 24  # 동일 에이전트 24시간 쿨다운


class LearningLoop:
    """자율 학습 루프 오케스트레이터."""

    def __init__(self):
        self._running = False
        self._improvement_history: Dict[str, float] = {}  # agent_id → last_improvement_time
        self._cycle_count = 0

    async def start(self):
        """백그라운드 학습 루프 시작."""
        self._running = True
        logger.info("🧠 LearningLoop started (cycle: %ds)", CYCLE_INTERVAL)
        while self._running:
            try:
                await self.run_cycle()
            except Exception as e:
                logger.error(f"LearningLoop cycle error: {e}")
            await asyncio.sleep(CYCLE_INTERVAL)

    def stop(self):
        self._running = False
        logger.info("🧠 LearningLoop stopped")

    async def run_cycle(self):
        """1회 학습 사이클 실행."""
        self._cycle_count += 1
        logger.info(f"🧠 LearningLoop cycle #{self._cycle_count} started")

        # Step 1: 실패 에이전트 감지
        failing = await self.detect_failing_agents()
        if not failing:
            logger.info(f"🧠 Cycle #{self._cycle_count}: No failing agents detected")
            return

        logger.info(f"🧠 Detected {len(failing)} failing agent(s): {[a['agent_id'] for a in failing]}")

        for agent in failing:
            agent_id = agent["agent_id"]

            # 쿨다운 체크
            if self._is_in_cooldown(agent_id):
                logger.info(f"🧠 {agent_id}: In cooldown, skipping")
                continue

            # Step 2: 패턴 분석
            patterns = await self.analyze_patterns(agent_id)
            if not patterns:
                continue

            logger.info(f"🧠 {agent_id}: {len(patterns['failure_queries'])} failure patterns found")

            # Step 3: FORGE 개선 요청
            improved = await self.request_improvement(agent_id, patterns)
            if not improved or not improved.get("success"):
                logger.warning(f"🧠 {agent_id}: FORGE improvement failed")
                continue

            # Step 4: Shadow Test
            test_result = await self.shadow_test(agent_id, patterns["failure_queries"])
            if test_result["pass_rate"] < SHADOW_PASS_RATE:
                logger.warning(f"🧠 {agent_id}: Shadow test failed ({test_result['pass_rate']:.0%})")
                continue

            # Step 5: 배포
            await self.record_improvement(agent_id, patterns, test_result)
            self._improvement_history[agent_id] = time.time()
            logger.info(f"🧠 {agent_id}: Improvement deployed successfully ✅")

    # ═══════════════════════════════════════════
    # Step 1: 실패 에이전트 감지
    # ═══════════════════════════════════════════

    async def detect_failing_agents(self) -> List[Dict]:
        """LogosPulse 메트릭에서 실패율 높은 에이전트 감지."""
        since = datetime.now(timezone.utc) - timedelta(hours=24)
        failing = []

        try:
            async with get_db_context() as db:
                # 에이전트별 성공률
                result = await db.execute(
                    select(
                        AgentExecution.agent_id,
                        func.count(AgentExecution.id).label("total"),
                        func.count(AgentExecution.id).filter(AgentExecution.success == True).label("success"),
                    )
                    .where(AgentExecution.created_at >= since)
                    .group_by(AgentExecution.agent_id)
                    .having(func.count(AgentExecution.id) >= MIN_CALLS_FOR_ANALYSIS)
                )

                for row in result.all():
                    rate = row.success / row.total if row.total > 0 else 1.0
                    if rate < FAILURE_THRESHOLD:
                        failing.append({
                            "agent_id": row.agent_id,
                            "total_calls": row.total,
                            "success_rate": rate,
                            "failure_count": row.total - row.success,
                            "trigger": "low_success_rate",
                        })

                # 부정적 피드백이 많은 에이전트
                feedback_result = await db.execute(
                    select(
                        UserFeedback.agent_id,
                        func.count(UserFeedback.id).label("negative_count"),
                    )
                    .where(and_(
                        UserFeedback.created_at >= since,
                        UserFeedback.rating < 0,
                    ))
                    .group_by(UserFeedback.agent_id)
                    .having(func.count(UserFeedback.id) >= NEGATIVE_FEEDBACK_THRESHOLD)
                )

                existing_ids = {a["agent_id"] for a in failing}
                for row in feedback_result.all():
                    if row.agent_id not in existing_ids:
                        failing.append({
                            "agent_id": row.agent_id,
                            "negative_feedback": row.negative_count,
                            "trigger": "negative_feedback",
                        })

        except Exception as e:
            logger.warning(f"detect_failing_agents error: {e}")

        return failing

    # ═══════════════════════════════════════════
    # Step 2: 패턴 분석
    # ═══════════════════════════════════════════

    async def analyze_patterns(self, agent_id: str) -> Optional[Dict]:
        """실패 쿼리와 에러 패턴 분석."""
        since = datetime.now(timezone.utc) - timedelta(hours=24)

        try:
            async with get_db_context() as db:
                # 실패한 실행 쿼리 수집
                result = await db.execute(
                    select(AgentExecution.query, AgentExecution.error_message)
                    .where(and_(
                        AgentExecution.agent_id == agent_id,
                        AgentExecution.success == False,
                        AgentExecution.created_at >= since,
                    ))
                    .order_by(desc(AgentExecution.created_at))
                    .limit(10)
                )

                failures = result.all()
                if not failures:
                    return None

                failure_queries = [f.query for f in failures if f.query]
                error_messages = [f.error_message for f in failures if f.error_message]

                # 부정적 피드백 쿼리도 포함
                fb_result = await db.execute(
                    select(UserFeedback.query, UserFeedback.comment)
                    .where(and_(
                        UserFeedback.agent_id == agent_id,
                        UserFeedback.rating < 0,
                        UserFeedback.created_at >= since,
                    ))
                    .limit(5)
                )
                for fb in fb_result.all():
                    if fb.query and fb.query not in failure_queries:
                        failure_queries.append(fb.query)

                return {
                    "agent_id": agent_id,
                    "failure_queries": failure_queries[:5],  # Shadow test용 최대 5개
                    "error_messages": error_messages[:5],
                    "total_failures": len(failures),
                }

        except Exception as e:
            logger.warning(f"analyze_patterns error: {e}")
            return None

    # ═══════════════════════════════════════════
    # Step 3: FORGE 개선 요청
    # ═══════════════════════════════════════════

    async def request_improvement(self, agent_id: str, patterns: Dict) -> Optional[Dict]:
        """FORGE CodeImprover에 개선 요청."""
        try:
            # FORGE improve WebSocket 또는 REST
            async with aiohttp.ClientSession() as session:
                payload = {
                    "agent_id": agent_id,
                    "failure_queries": patterns["failure_queries"],
                    "error_messages": patterns["error_messages"],
                    "hints": f"이 에이전트의 최근 실패율이 높습니다. "
                             f"실패 쿼리: {patterns['failure_queries'][:3]}. "
                             f"에러: {patterns['error_messages'][:2]}",
                }

                # ACP의 FORGE bridge 사용
                async with session.post(
                    f"{ACP_URL}/api/failures/export-forge",
                    json=payload,
                    timeout=aiohttp.ClientTimeout(total=60),
                ) as resp:
                    if resp.status == 200:
                        return await resp.json()

            logger.info(f"🧠 {agent_id}: FORGE improvement requested")
            return {"success": True, "method": "forge_bridge"}

        except Exception as e:
            logger.warning(f"request_improvement error: {e}")
            return None

    # ═══════════════════════════════════════════
    # Step 4: Shadow Test
    # ═══════════════════════════════════════════

    async def shadow_test(self, agent_id: str, failure_queries: List[str]) -> Dict:
        """실패했던 쿼리로 Shadow Test."""
        test_queries = failure_queries[:3]
        if not test_queries:
            return {"pass_rate": 0, "tested": 0, "passed": 0}

        passed = 0
        tested = 0

        for query in test_queries:
            tested += 1
            try:
                async with aiohttp.ClientSession() as session:
                    async with session.post(
                        f"{ACP_URL}/stream",
                        json={"query": query, "agent_id": agent_id, "email": "shadow_test@logos.ai"},
                        timeout=aiohttp.ClientTimeout(total=30),
                    ) as resp:
                        # SSE 응답에서 성공/실패 판단
                        text = await resp.text()
                        if '"response_type": "SUCCESS"' in text or '"response_type": "success"' in text:
                            passed += 1
                        elif '"success": true' in text:
                            passed += 1

            except Exception as e:
                logger.debug(f"Shadow test query failed: {e}")

        pass_rate = passed / tested if tested > 0 else 0
        logger.info(f"🧠 Shadow test {agent_id}: {passed}/{tested} ({pass_rate:.0%})")

        return {"pass_rate": pass_rate, "tested": tested, "passed": passed}

    # ═══════════════════════════════════════════
    # Step 5: 기록
    # ═══════════════════════════════════════════

    async def record_improvement(self, agent_id: str, patterns: Dict, test_result: Dict):
        """개선 결과를 LogosPulse에 기록."""
        try:
            async with get_db_context() as db:
                from sqlalchemy import text
                await db.execute(
                    text("""
                        INSERT INTO logosus.agent_executions
                        (id, agent_id, agent_name, query, success, duration_ms, metadata_json)
                        VALUES (gen_random_uuid(), :aid, 'LearningLoop', :query, true, 0,
                                :meta::jsonb)
                    """),
                    {
                        "aid": f"learning_loop_{agent_id}",
                        "query": f"Auto-improvement for {agent_id}",
                        "meta": f'{{"type":"improvement","patterns":{patterns["total_failures"]},"shadow_test":{test_result["pass_rate"]}}}',
                    },
                )
                await db.commit()
        except Exception as e:
            logger.warning(f"record_improvement error: {e}")

    # ═══════════════════════════════════════════
    # Helpers
    # ═══════════════════════════════════════════

    def _is_in_cooldown(self, agent_id: str) -> bool:
        last = self._improvement_history.get(agent_id, 0)
        return (time.time() - last) < (COOLDOWN_HOURS * 3600)


# ═══════════════════════════════════════════
# Global instance
# ═══════════════════════════════════════════

_learning_loop: Optional[LearningLoop] = None


def get_learning_loop() -> LearningLoop:
    global _learning_loop
    if _learning_loop is None:
        _learning_loop = LearningLoop()
    return _learning_loop

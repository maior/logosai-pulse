"""SSE Stream — 실시간 트레이스 스트리밍.

프론트엔드가 연결하면 새 트레이스/LLM 호출이 발생할 때마다 즉시 전송.
"""

import asyncio
import json
import logging
import os
import time
from datetime import datetime, timezone

from fastapi import APIRouter
from fastapi.responses import StreamingResponse

from app.services.metrics_collector import get_metrics_collector

logger = logging.getLogger(__name__)

router = APIRouter(tags=["Stream"])

# In-memory event bus (간단한 구현)
_subscribers: list = []

# 스트림 수명 상한 (2026-07-19). 클라이언트는 만료 후 자동 재연결한다.
# 상한이 없으면 열린 연결 하나가 서버 종료를 무한정 붙잡는다.
_MAX_SECONDS = int(os.getenv("LOGOS_PULSE_SSE_MAX_SECONDS", "600"))
_RECONNECT_MS = int(os.getenv("LOGOS_PULSE_SSE_RETRY_MS", "3000"))


def broadcast_event(event_type: str, data: dict):
    """새 이벤트를 모든 SSE 구독자에게 전송."""
    event = {"type": event_type, "data": data, "timestamp": datetime.now(timezone.utc).isoformat()}
    for q in _subscribers[:]:
        try:
            q.put_nowait(event)
        except asyncio.QueueFull:
            pass  # Drop if subscriber is slow


@router.get("/api/v1/stream")
async def sse_stream():
    """SSE 실시간 트레이스 스트림. 프론트엔드 EventSource로 연결."""
    queue = asyncio.Queue(maxsize=100)
    _subscribers.append(queue)

    async def event_generator():
        started = time.monotonic()
        try:
            # retry: 브라우저 재연결 간격 지시 (수명 만료로 끊은 뒤 곧 돌아오게)
            yield f"retry: {_RECONNECT_MS}\n\n"
            # 초기 연결 확인
            yield f"event: connected\ndata: {json.dumps({'message': 'LogosPulse SSE connected'})}\n\n"

            # 무한 스트림 금지. 열린 채로 두면 uvicorn 의 graceful shutdown 이
            # 영원히 대기하고, lifespan shutdown 에 도달하지 못한다 → 포트만 닫힌
            # 좀비 프로세스로 남아 메트릭이 전량 유실된다 (2026-07-15, 3일간).
            while True:
                remaining = _MAX_SECONDS - (time.monotonic() - started)
                if remaining <= 0:
                    break
                try:
                    # 남은 수명보다 오래 기다리지 않는다 — 안 그러면 heartbeat
                    # 주기(30초) 단위로만 만료가 감지된다
                    event = await asyncio.wait_for(queue.get(), timeout=min(30, remaining))
                    yield f"event: {event['type']}\ndata: {json.dumps(event['data'], ensure_ascii=False, default=str)}\n\n"
                except asyncio.TimeoutError:
                    # Heartbeat (keep connection alive)
                    yield f"event: heartbeat\ndata: {json.dumps({'ts': datetime.now(timezone.utc).isoformat()})}\n\n"
        except asyncio.CancelledError:
            pass
        finally:
            if queue in _subscribers:
                _subscribers.remove(queue)

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )

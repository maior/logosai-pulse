"""SSE Stream — 실시간 트레이스 스트리밍.

프론트엔드가 연결하면 새 트레이스/LLM 호출이 발생할 때마다 즉시 전송.
"""

import asyncio
import json
import logging
from datetime import datetime, timezone

from fastapi import APIRouter
from fastapi.responses import StreamingResponse

from app.services.metrics_collector import get_metrics_collector

logger = logging.getLogger(__name__)

router = APIRouter(tags=["Stream"])

# In-memory event bus (간단한 구현)
_subscribers: list = []


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
        try:
            # 초기 연결 확인
            yield f"event: connected\ndata: {json.dumps({'message': 'LogosPulse SSE connected'})}\n\n"

            while True:
                try:
                    event = await asyncio.wait_for(queue.get(), timeout=30)
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

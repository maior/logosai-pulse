"""LogosPulse — Agent Observability Service.

LangSmith-level agent tracing, metrics, and cost tracking for LogosAI.
Independent service — ACP/logos_api send metrics via HTTP fire-and-forget.

Port: 8095
"""

import asyncio
import logging
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.database import engine, get_db_context
from app.services.metrics_collector import init_metrics_collector
from app.routers import ingest, dashboard, feedback, learning, stream

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup/shutdown."""
    # Init MetricsCollector
    init_metrics_collector(get_db_context)
    logger.info(f"💓 LogosPulse started on port {settings.port}")

    # Start LearningLoop (Phase B: Adaptive Learning)
    _learning_task = None
    if os.getenv("LOGOS_PULSE_LEARNING_LOOP", "true").lower() == "true":
        from app.services.learning_loop import get_learning_loop
        loop = get_learning_loop()
        _learning_task = asyncio.create_task(loop.start())
        logger.info("🧠 LearningLoop background task started")

    yield

    # Shutdown
    if _learning_task:
        get_learning_loop().stop()
        _learning_task.cancel()
    await engine.dispose()
    logger.info("💓 LogosPulse stopped")


app = FastAPI(
    title="LogosPulse",
    description="Agent Observability Service for LogosAI",
    version="0.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(ingest.router)
app.include_router(dashboard.router)
app.include_router(feedback.router)
app.include_router(learning.router)
app.include_router(stream.router)


@app.get("/health")
async def health():
    from app.services.learning_loop import get_learning_loop
    loop = get_learning_loop()
    return {
        "status": "healthy",
        "service": "logos_pulse",
        "learning_loop": {
            "running": loop._running,
            "cycles": loop._cycle_count,
        },
    }

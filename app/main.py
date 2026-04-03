"""LogosPulse — Agent Observability Service.

LangSmith-level agent tracing, metrics, and cost tracking for LogosAI.
Independent service — ACP/logos_api send metrics via HTTP fire-and-forget.

Port: 8095
"""

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.database import engine, get_db_context
from app.services.metrics_collector import init_metrics_collector
from app.routers import ingest, dashboard

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup/shutdown."""
    # Init MetricsCollector
    init_metrics_collector(get_db_context)
    logger.info(f"💓 LogosPulse started on port {settings.port}")
    yield
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


@app.get("/health")
async def health():
    return {"status": "healthy", "service": "logos_pulse"}

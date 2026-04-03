"""Observability models — PostgreSQL (logosus schema).

Tables:
    agent_executions — 에이전트 실행 기록
    llm_calls        — LLM 호출 기록
    daily_stats      — 일일 집계
"""

from datetime import datetime, timezone
from typing import Optional
from uuid import uuid4

from sqlalchemy import (
    DateTime, Float, ForeignKey, Integer, String, Text, Boolean,
    Index, UniqueConstraint, func,
)
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


class Base(DeclarativeBase):
    pass


class AgentExecution(Base):
    __tablename__ = "agent_executions"
    __table_args__ = (
        Index("ix_agent_exec_agent_id", "agent_id"),
        Index("ix_agent_exec_created", "created_at"),
        Index("ix_agent_exec_correlation", "correlation_id"),
        {"schema": "logosus"},
    )

    id: Mapped[str] = mapped_column(UUID(as_uuid=False), primary_key=True, default=lambda: str(uuid4()))
    correlation_id: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    agent_id: Mapped[str] = mapped_column(String(100), nullable=False)
    agent_name: Mapped[Optional[str]] = mapped_column(String(200), nullable=True)
    query: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    success: Mapped[bool] = mapped_column(Boolean, default=True)
    error_message: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    duration_ms: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    token_count: Mapped[int] = mapped_column(Integer, default=0)
    cost_usd: Mapped[float] = mapped_column(Float, default=0.0)
    metadata_json: Mapped[Optional[dict]] = mapped_column(JSONB, nullable=True)
    user_email: Mapped[Optional[str]] = mapped_column(String(200), nullable=True)
    session_id: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), server_default=func.now())

    llm_calls: Mapped[list["LLMCall"]] = relationship(back_populates="execution", cascade="all, delete-orphan")


class LLMCall(Base):
    __tablename__ = "llm_calls"
    __table_args__ = (
        Index("ix_llm_call_execution", "execution_id"),
        Index("ix_llm_call_model", "model"),
        Index("ix_llm_call_created", "created_at"),
        {"schema": "logosus"},
    )

    id: Mapped[str] = mapped_column(UUID(as_uuid=False), primary_key=True, default=lambda: str(uuid4()))
    execution_id: Mapped[Optional[str]] = mapped_column(UUID(as_uuid=False), ForeignKey("logosus.agent_executions.id", ondelete="CASCADE"), nullable=True)
    agent_id: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    model: Mapped[str] = mapped_column(String(100), nullable=False)
    provider: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    input_tokens: Mapped[int] = mapped_column(Integer, default=0)
    output_tokens: Mapped[int] = mapped_column(Integer, default=0)
    total_tokens: Mapped[int] = mapped_column(Integer, default=0)
    cost_usd: Mapped[float] = mapped_column(Float, default=0.0)
    duration_ms: Mapped[float] = mapped_column(Float, default=0.0)
    success: Mapped[bool] = mapped_column(Boolean, default=True)
    error_message: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    prompt_preview: Mapped[Optional[str]] = mapped_column(String(200), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), server_default=func.now())

    execution: Mapped[Optional["AgentExecution"]] = relationship(back_populates="llm_calls")


class DailyStat(Base):
    __tablename__ = "daily_stats"
    __table_args__ = (
        UniqueConstraint("date", "agent_id", name="uq_daily_stat_date_agent"),
        Index("ix_daily_stat_date", "date"),
        {"schema": "logosus"},
    )

    id: Mapped[str] = mapped_column(UUID(as_uuid=False), primary_key=True, default=lambda: str(uuid4()))
    date: Mapped[str] = mapped_column(String(10), nullable=False)
    agent_id: Mapped[str] = mapped_column(String(100), nullable=False)
    agent_name: Mapped[Optional[str]] = mapped_column(String(200), nullable=True)
    total_calls: Mapped[int] = mapped_column(Integer, default=0)
    success_count: Mapped[int] = mapped_column(Integer, default=0)
    failure_count: Mapped[int] = mapped_column(Integer, default=0)
    avg_duration_ms: Mapped[float] = mapped_column(Float, default=0.0)
    total_tokens: Mapped[int] = mapped_column(Integer, default=0)
    total_cost_usd: Mapped[float] = mapped_column(Float, default=0.0)
    total_llm_calls: Mapped[int] = mapped_column(Integer, default=0)


COST_PER_1M_TOKENS = {
    "gemini-2.5-flash-lite": {"input": 0.075, "output": 0.30},
    "gemini-2.5-flash": {"input": 0.15, "output": 0.60},
    "gemini-2.5-pro": {"input": 1.25, "output": 10.00},
    "gpt-4o-mini": {"input": 0.15, "output": 0.60},
    "gpt-4o": {"input": 2.50, "output": 10.00},
    "gpt-4.1-mini": {"input": 0.40, "output": 1.60},
    "claude-3.5-sonnet": {"input": 3.00, "output": 15.00},
}


def calculate_cost(model: str, input_tokens: int, output_tokens: int) -> float:
    rates = COST_PER_1M_TOKENS.get(model, {"input": 0.10, "output": 0.40})
    return (input_tokens * rates["input"] + output_tokens * rates["output"]) / 1_000_000

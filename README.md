# LogosPulse

**Agent Observability Service for LogosAI** — OpenTelemetry-style tracing, metrics, cost tracking, feedback, and adaptive learning.

LogosPulse is an independent observability service that monitors AI agent executions with hierarchical span tracing, tracks LLM calls (tokens, latency, cost), collects user feedback, and runs an adaptive learning loop. Agents send metrics via a lightweight fire-and-forget SDK — zero impact on agent performance.

## Architecture

```
┌───────────┐    ┌───────────┐    ┌───────────┐
│ logos_web  │    │ logos_api  │    │ ACP Server│
│   (8010)  │    │   (8090)  │    │   (8888)  │
└─────┬─────┘    └─────┬─────┘    └─────┬─────┘
      │                │                │
      │ Feedback 👍/👎  │ POST /ingest   │ POST /ingest
      │ GET /dashboard │ (fire-forget)  │ (execution, llm-call, span)
      ▼                ▼                ▼
┌─────────────────────────────────────────────────────┐
│              LogosPulse (8095)                        │
│  ┌────────┐  ┌─────────┐  ┌────────┐  ┌──────────┐ │
│  │ Ingest │  │Dashboard│  │Feedback│  │ Learning │ │
│  │  API   │  │  API    │  │  API   │  │   Loop   │ │
│  └────────┘  └─────────┘  └────────┘  └──────────┘ │
│  ┌────────┐  ┌─────────┐  ┌──────────────────────┐ │
│  │ Span   │  │ Trace   │  │     PostgreSQL        │ │
│  │ Ingest │  │Tree API │  │ (logosus schema)      │ │
│  └────────┘  └─────────┘  └──────────────────────┘ │
└─────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────┐
│  Frontend (8096)    │
│  Next.js Dashboard  │
│  - KPIs & Charts    │
│  - Span Tree View   │
│  - Feedback Stats   │
│  - Learning Status  │
└─────────────────────┘
```

### Design Principles

- **Zero impact on agents**: Fire-and-forget HTTP (2s timeout). LogosPulse down? Agents continue normally.
- **Independent service**: No import dependencies on ACP or logos_api. HTTP only.
- **Lightweight SDK**: `pulse_client.py` — `send_execution_bg()`, `send_llm_call_bg()`, `send_span_bg()`.
- **OpenTelemetry-style**: ContextVar-based trace propagation, parent-child span hierarchy.

## Features

### Execution Tracking
Every agent call recorded: query, duration, success/failure, tokens, cost, trace_id.

### OpenTelemetry-Style Span Tracing
Hierarchical spans with ContextVar-based parent propagation:

```
Root Span: weather_agent.process (5197ms)
├── LLM Span: llm.gemini-2.5-flash-lite (1106ms) — location extraction
└── LLM Span: llm.gemini-2.5-flash-lite (3232ms) — weather advice generation
```

- Root spans auto-created in ACP `sse_handlers.py` before `agent.process()`
- LLM spans auto-created in `LLMClient.invoke_messages()` after each call
- `TraceSpan` class uses `ContextVar` for async-safe parent propagation
- Overhead: ~0.01ms/span (fire-and-forget HTTP)

### LLM Call Tracing
Each LLM API call tracked: model, provider, input/output tokens, latency, cost.

### Cost Tracking

| Model | Input ($/1M tokens) | Output ($/1M tokens) |
|-------|---------------------|----------------------|
| gemini-2.5-flash-lite | $0.075 | $0.30 |
| gemini-2.5-flash | $0.15 | $0.60 |
| gemini-2.5-pro | $1.25 | $10.00 |
| gpt-4o-mini | $0.15 | $0.60 |
| gpt-4o | $2.50 | $10.00 |
| claude-3.5-sonnet | $3.00 | $15.00 |

### User Feedback
Collect thumbs up/down from users. Per-agent satisfaction tracking.

### Adaptive Learning Loop
Background loop (10-min cycle) that detects failing agents (success rate < 70%), analyzes failure patterns, and triggers improvement via FORGE.

### Dashboard (Next.js, port 8096)

| Tab | Content |
|-----|---------|
| **Dashboard** | KPI cards, Agent success rate bars, Cost by model pie chart, Response time trend |
| **Traces** | Execution list + SpanTreeView (hierarchical span tree with click-to-expand detail) |
| **Feedback** | Positive/Negative counts, Satisfaction %, Per-agent satisfaction bars, Recent feedback list |
| **Learning** | Loop status, Agent health (healthy/warning/degraded/critical), Improvement history |

SSE real-time: New executions and LLM calls appear instantly on the dashboard.

## Quick Start

### 1. Start LogosPulse

```bash
cd logos_pulse
./scripts/start.sh
# 💓 LogosPulse started on port 8095
# Frontend: http://localhost:8096
```

### 2. Send Metrics

```python
from logosai.utils.pulse_client import send_execution_bg, send_llm_call_bg, send_span_bg

# Agent execution (fire-and-forget, non-blocking)
send_execution_bg(
    agent_id="scheduler_agent",
    query="Show this week's schedule",
    success=True,
    duration_ms=3200,
    agent_name="Scheduler Agent",
    metadata={"trace_id": "abc-123"},
)

# LLM call
send_llm_call_bg(
    agent_id="scheduler_agent",
    model="gemini-2.5-flash-lite",
    input_tokens=500,
    output_tokens=200,
    duration_ms=800,
)

# Trace span
send_span_bg(
    span_id="span-1",
    trace_id="abc-123",
    parent_id="",
    name="scheduler_agent.process",
    agent_id="scheduler_agent",
    status="success",
    duration_ms=3200,
)
```

### 3. View Dashboard

Open `http://localhost:8096` — Dashboard, Traces, Feedback, Learning tabs.

## API Reference

### Ingest API (Write)

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/v1/ingest/execution` | Record agent execution |
| POST | `/api/v1/ingest/llm-call` | Record LLM call |
| POST | `/api/v1/ingest/span` | Record trace span |
| POST | `/api/v1/ingest/batch` | Batch ingest |

#### POST /api/v1/ingest/span

```json
{
  "span_id": "uuid",
  "trace_id": "uuid",
  "parent_id": "uuid or empty",
  "name": "weather_agent.process",
  "agent_id": "weather_agent",
  "status": "success",
  "input_text": "서울 날씨",
  "output_text": "서울의 현재 기온은...",
  "duration_ms": 5197,
  "metadata": {"model": "gemini-2.5-flash-lite", "input_tokens": 319}
}
```

### Dashboard API (Read)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/v1/dashboard` | Full dashboard data (summary, agents, costs, trend) |
| GET | `/api/v1/agents` | Agent-level statistics |
| GET | `/api/v1/traces` | Execution trace list (includes `trace_id`) |
| GET | `/api/v1/traces/{id}` | Trace detail (LLM calls within execution) |
| GET | `/api/v1/traces/{trace_id}/tree` | **Span tree** (hierarchical parent-child tree) |
| GET | `/api/v1/costs` | Cost breakdown by model/agent |
| GET | `/api/v1/trend` | Hourly trend data |

All endpoints support `?period=1h|6h|24h|7d|30d`.

#### GET /api/v1/traces/{trace_id}/tree

```json
{
  "trace_id": "a5da2563-...",
  "total_spans": 3,
  "tree": [
    {
      "id": "f3115069-...",
      "name": "weather_agent.process",
      "status": "success",
      "duration_ms": 5197,
      "children": [
        {
          "name": "llm.gemini-2.5-flash-lite",
          "duration_ms": 1106,
          "metadata": {"model": "gemini-2.5-flash-lite", "input_tokens": 319}
        },
        {
          "name": "llm.gemini-2.5-flash-lite",
          "duration_ms": 3232,
          "metadata": {"model": "gemini-2.5-flash-lite", "input_tokens": 301}
        }
      ]
    }
  ]
}
```

### Feedback API

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/v1/feedback` | Submit feedback (thumbs up/down) |
| GET | `/api/v1/feedback` | Recent feedback list |
| GET | `/api/v1/feedback/stats` | Per-agent satisfaction stats |

### Learning API

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/v1/learning/status` | Loop status (running, cycles, cooldowns) |
| POST | `/api/v1/learning/trigger` | Manually trigger learning cycle |
| GET | `/api/v1/learning/history` | Improvement history |
| GET | `/api/v1/learning/health-report` | Agent health report |

### SSE Stream API

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/v1/stream` | Real-time SSE events (new_execution, new_llm_call, new_span) |

## Project Structure

```
logos_pulse/
├── app/
│   ├── main.py                     # FastAPI (port 8095) + LearningLoop
│   ├── config.py                   # Environment configuration
│   ├── database.py                 # SQLAlchemy async setup
│   ├── models/
│   │   └── observability.py        # AgentExecution, LLMCall, DailyStat,
│   │                               # TraceSpanModel, UserFeedback
│   ├── services/
│   │   ├── metrics_collector.py    # Core metrics + traces + costs
│   │   ├── learning_loop.py        # 10-min adaptive learning
│   │   └── learning_metrics.py     # Health reports + improvement stats
│   └── routers/
│       ├── ingest.py               # POST /ingest/* (execution, llm-call, span)
│       ├── dashboard.py            # GET /* (dashboard, traces, tree)
│       ├── feedback.py             # Feedback collection + stats
│       ├── learning.py             # Learning loop control
│       └── stream.py               # SSE real-time events
├── frontend/                       # Next.js dashboard (port 8096)
│   └── src/
│       ├── app/page.tsx            # Main dashboard (4 tabs)
│       └── components/
│           ├── KPICards.tsx         # 4 KPI cards
│           ├── AgentChart.tsx       # Agent success rate bar chart
│           ├── TrendChart.tsx       # Response time line chart
│           ├── CostChart.tsx        # Cost by model pie chart
│           ├── TraceTable.tsx       # Execution trace list
│           ├── WaterfallView.tsx    # LLM call timeline
│           ├── SpanTreeView.tsx     # Hierarchical span tree
│           ├── FeedbackTab.tsx      # Feedback KPIs + per-agent bars
│           └── LearningTab.tsx      # Learning loop status + health
├── scripts/
│   └── start.sh
└── README.md
```

## Database

PostgreSQL (`logosus` schema):

| Table | Purpose |
|-------|---------|
| `agent_executions` | Agent execution records (query, duration, success, cost, metadata) |
| `llm_calls` | LLM API call records (model, tokens, latency, cost) |
| `daily_stats` | Daily aggregated stats per agent |
| `trace_spans` | Hierarchical spans (trace_id, parent_id, name, duration, metadata) |
| `user_feedback` | User feedback (agent_id, rating, comment) |

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `LOGOS_PULSE_DB_URL` | `postgresql+asyncpg://...` | PostgreSQL connection |
| `LOGOS_PULSE_URL` | `http://localhost:8095` | SDK target URL |
| `LOGOS_PULSE_LOG_LEVEL` | `INFO` | Logging level |
| `LOGOS_PULSE_LEARNING_LOOP` | `true` | Enable adaptive learning |

## SDK Integration

### Automatic (ACP Server)

ACP server auto-sends all metrics — no configuration needed:

```python
# sse_handlers.py — auto-configured
# Root span created before agent.process()
# Execution record sent after completion (with trace_id in metadata)
# LLM spans auto-created by LLMClient.invoke_messages()
```

### Manual (Custom Agents)

```python
from logosai.utils.pulse_client import send_execution, send_llm_call

class MyAgent:
    async def process(self, query, context=None):
        start = time.time()
        result = await self._do_work(query)

        await send_execution(
            agent_id="my_agent",
            query=query,
            success=True,
            duration_ms=(time.time() - start) * 1000,
        )
        return result
```

## Related

| Repository | Description |
|-----------|-------------|
| [logosai-framework](https://github.com/maior/logosai-framework) | LogosAI SDK (Python agent framework) |
| [logosai-ontology](https://github.com/maior/logosai-ontology) | Multi-agent orchestration (GNN+RL) |
| [logosai-api](https://github.com/maior/logosai-api) | FastAPI backend |
| [logosai-web](https://github.com/maior/logosai-web) | Next.js frontend |

## License

MIT License — Part of the LogosAI ecosystem.

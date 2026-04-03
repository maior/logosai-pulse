# LogosPulse

**Agent Observability Service for LogosAI** — LangSmith-level tracing, metrics, and cost tracking.

LogosPulse is an independent observability service that monitors AI agent executions, tracks LLM calls (tokens, latency, cost), and provides real-time dashboards. It follows the same architectural pattern as LangSmith: a lightweight SDK sends metrics via HTTP fire-and-forget, and a separate service stores and visualizes the data.

## Architecture

```
┌───────────┐    ┌───────────┐    ┌───────────┐
│ logos_web  │    │ logos_api  │    │ ACP Server│
│   (8010)  │    │   (8090)  │    │   (8888)  │
└─────┬─────┘    └─────┬─────┘    └─────┬─────┘
      │                │                │
      │ GET /dashboard │ POST /ingest   │ POST /ingest
      │                │ (fire-forget)  │ (fire-forget)
      ▼                ▼                ▼
┌─────────────────────────────────────────────┐
│           LogosPulse (8095)                   │
│  ┌──────────┐  ┌──────────┐  ┌───────────┐  │
│  │ Ingest   │  │Dashboard │  │ PostgreSQL│  │
│  │   API    │  │   API    │  │  Storage  │  │
│  └──────────┘  └──────────┘  └───────────┘  │
└─────────────────────────────────────────────┘
```

### Key Design Principles

- **Zero impact on agents**: Fire-and-forget HTTP calls. If LogosPulse is down, agents continue working normally.
- **Independent service**: No import dependencies on ACP or logos_api. Communicates only via HTTP.
- **Lightweight SDK**: `pulse_client.py` (~50 lines) sends metrics asynchronously.
- **Real-time dashboard**: Next.js frontend with live charts and trace viewer.

## Features

### Metrics Collection
- **Agent Execution Tracking**: Every agent call is recorded with query, duration, success/failure, tokens, and cost.
- **LLM Call Tracing**: Each LLM API call is tracked with model, provider, input/output tokens, latency, and calculated cost.
- **Daily Aggregation**: Automatic daily rollup for fast dashboard queries.
- **Cost Calculation**: Built-in pricing table for Gemini, GPT-4o, Claude models.

### Dashboard
- **KPI Cards**: Total calls, success rate, avg response time, total cost.
- **Agent Success Rate**: Bar chart by agent.
- **Response Time Trend**: Line chart over time.
- **Cost Breakdown**: Pie chart by model.
- **Trace Table**: Recent executions with status, duration, cost.
- **Trace Detail**: Tree view of LLM calls within an execution (like LangSmith).

### Supported Models (Cost Tracking)

| Model | Input ($/1M tokens) | Output ($/1M tokens) |
|-------|---------------------|----------------------|
| gemini-2.5-flash-lite | $0.075 | $0.30 |
| gemini-2.5-flash | $0.15 | $0.60 |
| gemini-2.5-pro | $1.25 | $10.00 |
| gpt-4o-mini | $0.15 | $0.60 |
| gpt-4o | $2.50 | $10.00 |
| gpt-4.1-mini | $0.40 | $1.60 |
| claude-3.5-sonnet | $3.00 | $15.00 |

## Quick Start

### 1. Start LogosPulse Server

```bash
cd logos_pulse
./scripts/start.sh
# 💓 LogosPulse started on port 8095
```

### 2. Send Metrics from Your Agent

```python
from logosai.utils.pulse_client import send_execution, send_llm_call

# Record agent execution
await send_execution(
    agent_id="scheduler_agent",
    query="Show this week's schedule",
    success=True,
    duration_ms=3200,
    agent_name="Scheduler Agent",
)

# Record LLM call
await send_llm_call(
    agent_id="scheduler_agent",
    model="gemini-2.5-flash-lite",
    input_tokens=500,
    output_tokens=200,
    duration_ms=800,
)
```

### 3. View Dashboard

Open `http://localhost:8095` in your browser.

## API Reference

### Ingest API (Write)

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/v1/ingest/execution` | Record agent execution |
| POST | `/api/v1/ingest/llm-call` | Record LLM call |
| POST | `/api/v1/ingest/batch` | Batch ingest (multiple records) |

#### POST /api/v1/ingest/execution

```json
{
  "agent_id": "scheduler_agent",
  "query": "Show this week's schedule",
  "success": true,
  "duration_ms": 3200,
  "agent_name": "Scheduler Agent",
  "correlation_id": "req-abc123",
  "user_email": "user@example.com",
  "token_count": 700,
  "cost_usd": 0.001
}
```

#### POST /api/v1/ingest/llm-call

```json
{
  "execution_id": "uuid-of-execution",
  "agent_id": "scheduler_agent",
  "model": "gemini-2.5-flash-lite",
  "provider": "google",
  "input_tokens": 500,
  "output_tokens": 200,
  "duration_ms": 800,
  "success": true,
  "prompt_preview": "Show this week's schedule..."
}
```

### Dashboard API (Read)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/v1/dashboard` | Full dashboard data |
| GET | `/api/v1/agents` | Agent-level statistics |
| GET | `/api/v1/agents/{id}` | Agent detail + traces |
| GET | `/api/v1/traces` | Execution trace list |
| GET | `/api/v1/traces/{id}` | Trace detail (LLM call tree) |
| GET | `/api/v1/costs` | Cost breakdown by model/agent |
| GET | `/api/v1/trend` | Hourly trend data |

All dashboard endpoints support `?period=1h|6h|24h|7d|30d` query parameter.

#### GET /api/v1/dashboard Response

```json
{
  "summary": {
    "total_calls": 320,
    "success_rate": 0.91,
    "avg_duration_ms": 3200,
    "total_tokens": 125000,
    "total_cost_usd": 1.45,
    "active_agents": 15
  },
  "agents": [
    {
      "agent_id": "scheduler_agent",
      "total_calls": 45,
      "success_rate": 0.93,
      "avg_duration_ms": 3200,
      "total_cost_usd": 0.12
    }
  ],
  "costs": {
    "total_cost_usd": 1.45,
    "by_model": [{"model": "gemini-2.5-flash-lite", "cost_usd": 1.04}],
    "by_agent": [{"agent_id": "scheduler_agent", "cost_usd": 0.12}]
  },
  "trend": [
    {"hour": "2026-04-03T14:00", "calls": 25, "avg_duration_ms": 2800}
  ]
}
```

#### GET /api/v1/traces/{id} Response (Trace Tree)

```json
{
  "execution": {
    "agent_id": "desktop_agent",
    "query": "Find SpaceX docs and email to user",
    "duration_ms": 45200,
    "cost_usd": 0.08
  },
  "llm_calls": [
    {"model": "gemini-2.5-flash-lite", "total_tokens": 120, "duration_ms": 800},
    {"model": "gemini-2.5-flash-lite", "total_tokens": 2400, "duration_ms": 1800}
  ],
  "summary": {
    "total_llm_calls": 2,
    "total_tokens": 2520,
    "total_cost_usd": 0.0008,
    "models_used": ["gemini-2.5-flash-lite"]
  }
}
```

## Project Structure

```
logos_pulse/
├── app/
│   ├── main.py              # FastAPI entry point (port 8095)
│   ├── config.py             # Environment configuration
│   ├── database.py           # SQLAlchemy async setup
│   ├── models/
│   │   ├── __init__.py
│   │   └── observability.py  # AgentExecution, LLMCall, DailyStat models
│   ├── services/
│   │   └── metrics_collector.py  # Core metrics logic
│   └── routers/
│       ├── ingest.py         # POST /ingest/* (metrics collection)
│       └── dashboard.py      # GET /* (dashboard queries)
├── frontend/                 # Next.js dashboard (coming soon)
├── scripts/
│   └── start.sh              # Start script
├── logs/
└── README.md
```

## SDK Integration

### For ACP Server (Agent Runtime)

The ACP server automatically sends metrics via the `pulse_client`:

```python
# In acp_server/acp_modules/server.py (auto-configured)
from logosai.utils.pulse_client import send_llm_call_bg
from logosai.utils.llm_client import LLMClient

# LLM callback — every LLM call is automatically tracked
LLMClient._metrics_callback = lambda data: send_llm_call_bg(**data)
```

```python
# In acp_server/acp_modules/sse_handlers.py (auto-configured)
from logosai.utils.pulse_client import send_execution_bg

# After each agent execution
send_execution_bg(agent_id="scheduler_agent", duration_ms=3200, success=True)
```

### For Custom Agents

```python
from logosai.utils.pulse_client import send_execution, send_llm_call

class MyAgent:
    async def process(self, query, context=None):
        start = time.time()
        result = await self._do_work(query)
        duration = (time.time() - start) * 1000

        await send_execution(
            agent_id="my_agent",
            query=query,
            success=True,
            duration_ms=duration,
        )
        return result
```

## Database

LogosPulse uses PostgreSQL (`logosus` schema) with 3 tables:

| Table | Purpose | Rows/day (est.) |
|-------|---------|-----------------|
| `agent_executions` | Agent execution records | ~500 |
| `llm_calls` | LLM API call records | ~2000 |
| `daily_stats` | Daily aggregated stats | ~50 |

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `LOGOS_PULSE_DB_URL` | `postgresql+asyncpg://...` | PostgreSQL connection URL |
| `LOGOS_PULSE_URL` | `http://localhost:8095` | LogosPulse server URL (for SDK) |
| `LOGOS_PULSE_LOG_LEVEL` | `INFO` | Logging level |

## Development

```bash
# Install dependencies
pip install fastapi uvicorn sqlalchemy asyncpg aiohttp

# Run in development mode
cd logos_pulse
uvicorn app.main:app --reload --port 8095

# Run tests
cd logosai
python tests/test_metrics_collector.py
```

## License

MIT License — Part of the LogosAI ecosystem.

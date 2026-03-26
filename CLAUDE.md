# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Environment

All services run via Docker Compose. Never start local dev servers directly.

```bash
docker compose up --build          # Start all services
docker compose restart <service>   # Restart after code changes
docker compose up -d --build <service>  # Rebuild a specific service
```

Services: `backend` (FastAPI, :8010), `worker` (Redis consumer), `cli-bridge` (WebSocket, :9876), `frontend` (Next.js, :3010), `mysql` (:3307), `redis` (:6379), `qdrant` (:6333)

Code is volume-mounted, so backend/frontend hot-reload inside containers. Worker needs manual restart.

### Database Migrations

```bash
docker compose exec backend alembic revision -m "description"  # Create migration
docker compose exec backend alembic upgrade head               # Apply migrations
```

### Frontend Build/Lint

```bash
docker compose exec frontend npm run build
docker compose exec frontend npm run lint
```

If stale webpack errors occur: `docker exec ai_agent_frontend rm -rf /app/.next` then restart.

## Architecture

**Multi-tenant AI agent SaaS** — orchestrates LLM-powered code generation and creates GitHub/Azure DevOps PRs.

### Request Flow

```
API Request → FastAPI (api/routes/) → Redis Queue → Worker → OrchestrationService
  → LangGraph pipeline (5 nodes: fetch_context → analyze → generate_code → review_code → finalize)
  → CrewAI agents (PM, Developer, Reviewer, Finalizer)
  → PR creation (GitHub/Azure DevOps)
```

### Key Entry Points

- **Backend app**: `api/main.py`
- **Worker**: `workers/redis_worker.py` — polls Redis, executes tasks with `MAX_WORKERS` concurrency
- **Core orchestration**: `services/orchestration_service.py` — the heart of task execution
- **LLM routing**: `services/llm/provider.py` — model selection, prompt caching, cost tracking
- **Agent pipeline**: `agents/langgraph_flow.py` (LangGraph DAG) + `agents/crewai_agents.py` (role definitions)

### Layer Structure

- `api/routes/` — FastAPI endpoints (auth, tasks, agents, flows, integrations, billing)
- `services/` — Business logic (orchestration, LLM, queue, GitHub, Azure, Jira, billing, notifications)
- `models/` — SQLAlchemy async ORM models (all queries scoped by `organization_id`)
- `schemas/` — Pydantic request/response schemas
- `agents/` — CrewAI agent definitions + LangGraph orchestration + system prompts
- `memory/` — Qdrant vector store for task similarity retrieval
- `core/` — Settings (`pydantic-settings`, 67 env vars), database engine, logging
- `frontend/` — Next.js 14 app router

### Tech Stack

- **Backend**: Python 3.11, FastAPI, SQLAlchemy 2.0 (async), MySQL 8, Redis 7
- **AI**: LangGraph, CrewAI, OpenAI SDK (with Gemini fallback)
- **Vector memory**: Qdrant (optional, `QDRANT_ENABLED=true`)
- **Frontend**: Next.js 14, React 18, TypeScript
- **Auth**: JWT (python-jose), bcrypt

## Conventions

- All data is multi-tenant: always filter by `organization_id`
- Backend is fully async (`async def`, `AsyncSession`)
- UI text must go through `frontend/lib/i18n.ts` using the `useLocale()` hook — add both `tr` and `en` entries for every new key
- Do not hardcode locale-specific strings in components
- Configuration via environment variables (see `.env.example`, `core/settings.py`)
- Corporate SSL cert bundled in `docker/FLOMcAfeeWG.crt` for proxy environments

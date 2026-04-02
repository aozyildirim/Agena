# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Monorepo Package Structure

Backend is split into **6 pip-installable packages** under `packages/`:

```
packages/
  core/        → agena-core      (settings, database, auth, rbac, security)
  models/      → agena-models    (25 SQLAlchemy ORM models + 9 Pydantic schemas)
  services/    → agena-services  (31 business logic services + integrations)
  agents/      → agena-agents    (CrewAI/LangGraph pipeline + vector memory)
  api/         → agena-api       (FastAPI routes, middleware, dependencies)
  worker/      → agena-worker    (Redis background task consumer)
```

**Import paths** use package prefixes:
- `from agena_core.settings import get_settings`
- `from agena_core.database import get_db_session`
- `from agena_core.security.jwt import create_token`
- `from agena_models.models.task_record import TaskRecord`
- `from agena_models.schemas.agent import AgentRunRequest`
- `from agena_services.services.orchestration_service import OrchestrationService`
- `from agena_services.integrations.azure_client import AzureClient`
- `from agena_agents.agents.crewai_agents import CrewAIAgentRunner`
- `from agena_agents.memory.qdrant import QdrantMemoryStore`
- `from agena_api.api.dependencies import get_current_tenant`
- `from agena_worker.workers.redis_worker import process_queue`

**NEVER** use old flat imports like `from core.settings` or `from models.user`.

## Development Environment

All services run via Docker Compose. Never start local dev servers directly.

```bash
docker-compose up --build          # Start all services
docker-compose restart <service>   # Restart after code changes
docker-compose up -d --build <service>  # Rebuild a specific service
```

Services: `backend` (FastAPI, :8010), `worker` (Redis consumer), `cli-bridge` (WebSocket, :9876), `frontend_blue` (:3011), `frontend_green` (:3012), `mysql` (:3307), `redis` (:6380), `qdrant` (:6333)

Backend code is volume-mounted (`./packages:/app/packages`) — hot-reloads via `pip install -e` on container start. Worker needs manual restart.

### Database Migrations

```bash
docker-compose exec backend alembic revision -m "description"  # Create migration
docker-compose exec backend alembic upgrade head               # Apply migrations
```

Alembic imports use `agena_core` and `agena_models`:
- `from agena_core.settings import get_settings`
- `import agena_models.models  # registers all ORM models`

### Frontend Build/Lint

```bash
docker-compose exec frontend_blue npm run build
docker-compose exec frontend_blue npm run lint
```

If stale webpack errors occur: `docker exec ai_agent_frontend_blue rm -rf /app/.next` then restart.

### Frontend Production Deploy (Zero-Downtime)

Frontend runs as **blue/green** production containers. Nginx load-balances between them. Code is NOT volume-mounted — changes require a rebuild.

```bash
./scripts/deploy-frontend.sh       # Zero-downtime (rebuilds one at a time)
# NEVER use docker-compose up --build for both at once — causes 502
```

### Local Development (without Docker)

```bash
pip install -e packages/core -e packages/models -e packages/services \
    -e packages/agents -e packages/api -e packages/worker
uvicorn agena_api.api.main:app --reload --port 8010
python -m agena_worker.workers.redis_worker
```

## Architecture

**Multi-tenant AI agent SaaS** — orchestrates LLM-powered code generation and creates GitHub/Azure DevOps PRs.

### Request Flow

```
API Request → FastAPI (agena_api) → Redis Queue → Worker (agena_worker)
  → OrchestrationService (agena_services)
  → LangGraph pipeline (5 nodes: fetch_context → analyze → generate_code → review_code → finalize)
  → CrewAI agents (PM, Developer, Reviewer, Finalizer)
  → PR creation (GitHub/Azure DevOps)
```

### Key Entry Points

- **Backend app**: `packages/api/src/agena_api/api/main.py`
- **Worker**: `packages/worker/src/agena_worker/workers/redis_worker.py`
- **Core orchestration**: `packages/services/src/agena_services/services/orchestration_service.py`
- **LLM routing**: `packages/services/src/agena_services/services/llm/provider.py`
- **Agent pipeline**: `packages/agents/src/agena_agents/agents/langgraph_flow.py` + `crewai_agents.py`
- **Flow executor**: `packages/services/src/agena_services/services/flow_executor.py`
- **Prompt service**: `packages/services/src/agena_services/services/prompt_service.py` (DB-backed, cached)

### Package Dependencies

```
agena-core       ← no internal deps (foundation)
agena-models     ← depends on agena-core
agena-services   ← depends on agena-core, agena-models
agena-agents     ← depends on agena-core, agena-models, agena-services
agena-api        ← depends on all above
agena-worker     ← depends on agena-core, agena-models, agena-services
```

### Layer Structure

- `packages/api/` — FastAPI endpoints (18 route modules: auth, tasks, agents, flows, analytics, integrations, billing, etc.)
- `packages/services/` — Business logic (orchestration, LLM, queue, GitHub, Azure, Jira, DORA, billing, notifications) + integrations (azure_client, github_client, jira_client)
- `packages/models/` — SQLAlchemy async ORM models (25 models, all scoped by `organization_id`) + Pydantic schemas
- `packages/agents/` — CrewAI agent definitions + LangGraph orchestration + system prompts + Qdrant vector memory
- `packages/core/` — Settings (`pydantic-settings`), database engine, JWT auth, RBAC, logging
- `packages/worker/` — Redis queue consumer with concurrent task execution

### Other Root Directories

- `alembic/` — Database migrations (24 versions)
- `db/init.sql` — MySQL bootstrap script
- `docker/` — Dockerfiles + SSL certificate
- `docs/` — Architecture Decision Records
- `frontend/` — Next.js 14 app (React 18, TypeScript, 7 languages)
- `scripts/` — Utility scripts (import rewriter, locale translator, deploy)
- `tests/` — Test suite

### Tech Stack

- **Backend**: Python 3.11, FastAPI, SQLAlchemy 2.0 (async), MySQL 8, Redis 7
- **AI**: LangGraph, CrewAI, OpenAI SDK (GPT-5, Gemini fallback)
- **Prompts**: DB-backed via PromptService (editable at runtime via Prompt Studio)
- **Vector memory**: Qdrant (optional, `QDRANT_ENABLED=true`)
- **Frontend**: Next.js 14, React 18, TypeScript
- **Auth**: JWT (python-jose), bcrypt, RBAC (owner/admin/member/viewer)
- **Deploy**: Docker Compose, Nginx (blue/green frontend)

## Flow System

Visual automation flows with n8n-style node configuration:

### Node Types
- **Agent** — LLM-powered (analyzer, planner, developer, reviewer, qa, etc.) with model/provider/prompt selection
- **Azure DevOps** — Create branch, create PR, complete PR, abandon PR (project/repo dropdown from API)
- **Azure Update** — Update work item state + comment
- **GitHub** — Create branch, create PR, merge PR (with reviewers, labels)
- **HTTP** — REST calls with auth (bearer/api-key/basic), timeout, response variables
- **Condition** — Branch logic (10 operators: eq/neq/gt/lt/contains/regex/empty etc.) with true/false targets
- **Notify** — Webhook/Slack/Email notifications
- **Trigger** — Flow entry point

### Node Communication
Nodes pass data via `context['outputs'][node_id]`. Use `{{outputs.node_id.field}}` in any text field. Special context keys:
- `context['product_review_output']` — Analyzer/PM spec output
- `context['plan_output']` — Planner file-level change plan
- `context['last_condition']` — Last condition result (bool)

## Conventions

- All data is multi-tenant: always filter by `organization_id`
- Backend is fully async (`async def`, `AsyncSession`)
- UI text must go through `frontend/lib/i18n.ts` using the `useLocale()` hook — add entries in ALL 7 locale files (tr, en, es, zh, it, de, ja)
- Do not hardcode locale-specific strings in components
- Configuration via environment variables (see `.env.example`, `packages/core/src/agena_core/settings.py`)
- System prompts stored in DB `prompts` table — edit via Prompt Studio UI or PromptService
- Corporate SSL cert bundled in `docker/InternalProxy.crt` for proxy environments
- When adding new ORM models, register them in `packages/models/src/agena_models/models/__init__.py`

# AGENTS.md — Tiqr AI Agent System

This document describes the architecture, agent pipeline, and codebase conventions for AI coding agents working on this repository.

---

## Project Overview

Tiqr is a multi-tenant AI agent orchestration SaaS. It accepts software tasks (from UI, Jira, or Azure DevOps), runs them through a multi-agent LLM pipeline, and automatically opens GitHub PRs with the generated code.

**Stack:**
- Backend: FastAPI (async) + SQLAlchemy + Alembic + MySQL
- Queue: Redis (FIFO, async worker with auto-scaling concurrency)
- Agents: CrewAI (role-based) + LangGraph (state machine flow)
- LLM: OpenAI (model routing by complexity, prompt cache, cost tracking)
- Memory: Qdrant vector store (semantic context retrieval)
- Frontend: Next.js 14 App Router + TypeScript (no UI library, inline styles)
- Auth: JWT + bcrypt, org-scoped multi-tenancy
- Payments: Stripe + Iyzico

---

## Repository Layout

```
api/              FastAPI app — routes, dependencies, main.py
agents/           Agent pipeline logic
  crewai_agents.py   CrewAI role runners (PM, Developer, Reviewer, Finalizer)
  langgraph_flow.py  LangGraph state graph definition
  orchestrator.py    AgentOrchestrator — wires graph nodes to agent runners
  prompts.py         System prompts for each agent role
alembic/          Database migrations
config/           App-level config loader
core/             Database session, logging, settings (pydantic-settings)
db/               SQLAlchemy Base, models import, init.sql
frontend/         Next.js 14 app
  app/            App Router pages
  components/     Shared UI components
  lib/api.ts      All backend API calls (typed fetch helpers)
integrations/     External service clients (GitHub, Jira, Azure, Qdrant, LLM)
memory/           Vector memory abstraction (base + Qdrant impl)
models/           SQLAlchemy ORM models (one file per model)
schemas/          Pydantic request/response schemas
security/         JWT encode/decode, password hashing
services/         Business logic layer
  llm/            LLM provider, prompt cache, cost tracker
  orchestration_service.py  Runs full agent pipeline for a task
  queue_service.py          Redis enqueue/dequeue
  task_service.py           Task CRUD + log helpers
  billing_service.py        Subscription + usage enforcement
workers/
  redis_worker.py   Async worker — dequeues tasks, runs orchestration
docker/           Dockerfile for backend/worker
docker-compose.yml  All services: backend, worker, frontend, mysql, redis
```

---

## Agent Pipeline

When a task is assigned, this is the execution path:

```
POST /tasks/{id}/assign
  → UsageService.check_quota()          # enforce free/pro limits
  → QueueService.enqueue(payload)       # push to Redis queue
  → redis_worker.py (background)
      → OrchestrationService.run_task_record()
          → AgentOrchestrator.run()
              → LangGraph state machine:
                  1. fetch_context   — Qdrant similarity search + context summary
                  2. analyze         — PM Agent: structured JSON spec
                  3. generate_code   — Developer Agent: code from spec
                  4. review_code     — Reviewer Agent: improve code quality
                  5. finalize        — Finalizer Agent: clean output for commit
              → GitHubService.create_pr()   # branch + commit + PR
              → RunRecord saved to DB
              → UsageService.increment_tokens()
```

### Agent Roles (CrewAI)

| Role | File | Responsibility |
|------|------|----------------|
| PM Agent | `crewai_agents.py::run_product_manager` | Converts task to structured JSON spec |
| Developer Agent | `crewai_agents.py::run_developer` | Generates code from spec |
| Reviewer Agent | `crewai_agents.py::run_reviewer` | Reviews and improves generated code |
| Finalizer Agent | `crewai_agents.py::finalize` | Normalizes output for git commit |
| Context Fetcher | `crewai_agents.py::fetch_context` | Retrieves relevant memory context |

CrewAI is attempted first; if it fails, falls back to direct LLM call via `LLMProvider`.

### LangGraph State

Defined in `agents/langgraph_flow.py`. State type: `OrchestrationState` (TypedDict).

Fields passed between nodes:
- `task` — original task dict
- `memory_context` — Qdrant results
- `context_summary` — fetched context string
- `spec` — PM output (JSON)
- `generated_code` — Developer output
- `reviewed_code` — Reviewer output
- `final_code` — Finalizer output
- `usage` — cumulative token counts
- `model_usage` — list of models used per step

---

## LLM Layer (`services/llm/`)

| File | Purpose |
|------|---------|
| `provider.py` | `LLMProvider` — async OpenAI calls, model routing, mock mode |
| `cache.py` | `PromptCache` — Redis-backed prompt deduplication |
| `cost_tracker.py` | `CostTracker` — USD cost estimation per model |

**Model routing:** `complexity_hint` param selects `llm_small_model` (simple/low) or `llm_large_model` (normal/high). Configured via env vars.

**Mock mode:** If `OPENAI_API_KEY` is missing or starts with `your_`, returns deterministic mock output — useful for local dev without API keys.

---

## Redis Worker (`workers/redis_worker.py`)

- Runs as a separate Docker service (`ai_agent_worker`)
- `process_queue()` loop: checks queue size, scales concurrency up to `MAX_WORKERS`
- Each task runs in its own `asyncio.Task` with error isolation (`_run_safe`)
- Uses `brpop` with timeout for blocking dequeue

To run locally:
```bash
python -m workers.redis_worker
```

---

## Database Models (`models/`)

| Model | Table | Description |
|-------|-------|-------------|
| `User` | `users` | Auth, org membership |
| `Organization` | `organizations` | Multi-tenant root |
| `OrganizationMember` | `org_members` | User ↔ org mapping |
| `TaskRecord` | `tasks` | Task lifecycle (pending→running→completed/failed) |
| `RunRecord` | `run_records` | Agent run output + token usage |
| `AgentLog` | `agent_logs` | Step-level logs per task |
| `Subscription` | `subscriptions` | Free/Pro plan per org |
| `UsageRecord` | `usage_records` | Monthly token counters |
| `IntegrationConfig` | `integration_configs` | Per-org Jira/Azure credentials |
| `UserPreference` | `user_preferences` | Saved flows, agent configs (JSON) |
| `FlowRun` | `flow_runs` | Visual flow execution records |
| `FlowRunStep` | `flow_run_steps` | Per-node step results |

Migrations: `alembic upgrade head`

---

## API Routes (`api/routes/`)

All routes require `Authorization: Bearer <token>` except `/auth/*` and `/health`.

Key route files:
- `auth.py` — signup, login
- `tasks.py` — CRUD, assign, logs, Jira/Azure import
- `agents.py` — direct agent run
- `billing.py` — plan management, Stripe/Iyzico webhooks
- `integrations.py` — org-scoped credential management
- `flows.py` — flow run execution and history
- `preferences.py` — user preference save/load (flows, agent configs)
- `github.py` — PR creation endpoint
- `org.py` — invite, accept

---

## Frontend (`frontend/`)

Next.js 14 App Router. No external UI component library — all styling is inline CSS with a dark theme (`rgba` palette, teal accent `#0d9488`/`#5eead4`).

Key pages:
- `app/dashboard/flows/page.tsx` — Visual flow canvas (drag nodes, draw edges, run flows)
- `app/dashboard/tasks/page.tsx` — Task list
- `app/dashboard/sprints/page.tsx` — Sprint board with AI assign + flow run
- `app/dashboard/agents/page.tsx` — Agent configuration
- `app/dashboard/integrations/page.tsx` — Jira/Azure/GitHub credentials

All API calls go through `frontend/lib/api.ts` — typed fetch helpers with JWT from `localStorage`.

---

## Environment Variables

See `.env.example` for the full list. Minimum required:

```
OPENAI_API_KEY=
JWT_SECRET_KEY=
GITHUB_TOKEN=
GITHUB_OWNER=
GITHUB_REPO=
DATABASE_URL=mysql+aiomysql://app_user:app_password@mysql:3306/ai_agent_db
REDIS_URL=redis://redis:6379/0
```

Optional:
```
LLM_LARGE_MODEL=gpt-4o
LLM_SMALL_MODEL=gpt-4o-mini
MAX_WORKERS=4
QDRANT_URL=http://qdrant:6333
STRIPE_SECRET_KEY=
IYZICO_API_KEY=
```

---

## Development Conventions

- **Backend:** async everywhere (`async def`, `AsyncSession`, `await`)
- **Models:** one file per SQLAlchemy model in `models/`
- **Schemas:** Pydantic v2 in `schemas/`, separate files per domain
- **Services:** business logic only — no HTTP concerns, no direct route logic
- **Routes:** thin — validate input, call service, return schema
- **Frontend:** functional components, inline styles, no class components
- **State:** React `useState`/`useRef`/`useCallback` — no external state library
- **API calls:** always through `lib/api.ts`, never raw fetch in components

### Documentation Discipline

- At the end of each day, update this `AGENTS.md` with newly implemented capabilities.
- When a feature is shipped, keep `AGENTS.md`, `docs/FEATURES.md`, and `docs/openapi.json` aligned.
- Prefer adding short operational notes (what changed, where it is wired, and how to validate) instead of vague summaries.

---

## Running the Project

```bash
# Full stack
docker compose up --build

# Backend only (local)
uvicorn api.main:app --reload --port 8010

# Worker (local)
python -m workers.redis_worker

# Frontend (local)
cd frontend && npm run dev

# Migrations
docker exec ai_agent_api alembic upgrade head
```

---

## Testing a Task End-to-End

```bash
# 1. Sign up
curl -X POST http://localhost:8010/auth/signup \
  -H "Content-Type: application/json" \
  -d '{"email":"dev@example.com","full_name":"Dev","password":"Secret123!","organization_name":"Acme"}'

# 2. Login → get token
curl -X POST http://localhost:8010/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"dev@example.com","password":"Secret123!"}'

# 3. Create task
curl -X POST http://localhost:8010/tasks \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"title":"Add rate limiting","description":"Add per-org rate limiting to all API routes"}'

# 4. Assign to AI
curl -X POST http://localhost:8010/tasks/1/assign \
  -H "Authorization: Bearer $TOKEN"

# 5. Poll status
curl http://localhost:8010/tasks/1 -H "Authorization: Bearer $TOKEN"
curl http://localhost:8010/tasks/1/logs -H "Authorization: Bearer $TOKEN"
```

---

## Today Updates (2026-03-23)

### Queue + Worker Reliability

- Fixed repo lock stability to prevent duplicate/retry loops and stuck tasks:
  - `services/queue_service.py`
    - re-entrant `acquire_lock` for same owner
    - new helpers: `get_lock_owner`, `force_delete_lock`
  - `workers/redis_worker.py`
    - deterministic lock owner format: `task:<task_id>`
    - stale/terminal-owner lock recovery before processing
    - periodic stale lock cleanup (`queue_lock:*`) for non-running owners
- Fixed assign race condition that could leave task `queued` in DB while missing from Redis:
  - `services/task_service.py`
  - assignment flow is now: persist `queued` in DB first, then enqueue; on enqueue error mark task failed + log.
- Added git command safety for local execution to avoid hanging worker runs:
  - `services/local_repo_service.py`
  - `GIT_TERMINAL_PROMPT=0`
  - command timeout support (`GIT_COMMAND_TIMEOUT_SEC`, default 300s)

### Qdrant Memory Upgrade (Real Embeddings)

- Replaced deterministic-only memory baseline with provider-backed embeddings (with safe fallback):
  - `memory/qdrant.py`
  - supports OpenAI and Gemini embedding generation
  - preserves 1536-dimensional vector contract for Qdrant collection compatibility
  - keeps deterministic placeholder fallback when provider key/model call is unavailable
- Wired memory embedding runtime to tenant-selected LLM integration at orchestration time:
  - `services/orchestration_service.py`
  - `agents/orchestrator.py`
  - memory now uses org runtime provider/key/base where available (OpenAI/Gemini)
- Added embedding config env knobs:
  - `core/settings.py`, `.env.example`
  - `QDRANT_EMBEDDING_PROVIDER`
  - `QDRANT_OPENAI_EMBEDDING_MODEL`
  - `QDRANT_GEMINI_EMBEDDING_MODEL`
  - `QDRANT_EMBEDDING_TIMEOUT_SEC`
- Updated memory schema docs to reflect real embedding mode + fallback behavior:
  - `api/routes/memory.py`

### Memory Impact Observability

- Added per-task memory impact logging during orchestration:
  - `services/orchestration_service.py`
  - new `memory_impact` stage log includes:
    - embedding mode
    - hit count
    - best/average similarity score
    - top matched memory keys and previews
- Added retrieval score propagation from Qdrant:
  - `memory/qdrant.py`
  - each retrieved payload now includes `_score` when available
- Extended orchestration state to carry memory backend status:
  - `agents/langgraph_flow.py`
  - `agents/orchestrator.py`
- Added Task Detail UI panel to visualize memory effect for each run:
  - `frontend/app/tasks/[id]/page.tsx`
  - shows mode, hits, best/avg score, and top matches
  - fully localized via `frontend/lib/i18n.ts`

### PR Feedback / Review Flow Hardening

- Added PR comment webhook entrypoint:
  - `api/routes/webhooks.py`
  - registered in `api/main.py`
  - setting: `PR_WEBHOOK_SECRET` in `core/settings.py`
- Added auto-fix trigger helper for PR feedback pipeline:
  - `services/flow_executor.py` (`run_pr_feedback_autofix`)
- Improved Azure PR URL parsing for different API/web URL variants:
  - `services/azure_pr_service.py`

### Flow Canvas UX Fixes (`/dashboard/flows`)

- Edge delete `x` is now reliably clickable (no accidental pan/drag conflict):
  - `frontend/app/dashboard/flows/page.tsx`
  - edge delete now handles both `mousedown` and `click` with `preventDefault + stopPropagation`
  - larger delete hit area and center delete badge
  - node layer pointer-event conflict fixed (`wrapper: none`, `node cards: all`)
- New nodes no longer keep drifting to far right/outside viewport:
  - replaced linear `x = 80 + count*220` placement
  - viewport-aware grid placement based on visible canvas + current pan offset
- Canvas cursor behavior improved:
  - default cursor is `default`
  - `grabbing` only during active pan
  - `crosshair` only during connect mode

### Validation Notes

- For backend/worker reliability changes, container rebuild/restart was required:
  - `docker compose up -d --build backend worker`
- For frontend flow fixes, hard refresh required after deploy:
  - `Cmd+Shift+R` / `Ctrl+F5`

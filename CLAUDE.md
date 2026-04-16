# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Monorepo Package Structure

Backend is split into **6 pip-installable packages** + **1 npm package** under `packages/`:

```
packages/
  core/        → agena-core      (settings, database, auth, rbac, security)
  models/      → agena-models    (27 SQLAlchemy ORM models + 9 Pydantic schemas)
  services/    → agena-services  (31 business logic services + integrations)
  agents/      → agena-agents    (CrewAI/LangGraph pipeline + vector memory)
  api/         → agena-api       (FastAPI routes, middleware, dependencies)
  worker/      → agena-worker    (Redis background task consumer)
  sdk/         → @agena/sdk      (TypeScript API client for npm)
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

Use `start.sh` to launch the full stack. It starts Docker services and the CLI bridge on the host:

```bash
./start.sh                         # Start everything (Docker + host bridge)
./stop.sh                          # Stop everything
docker-compose restart <service>   # Restart after code changes
docker-compose up -d --build <service>  # Rebuild a specific service
```

Services: `backend` (FastAPI, :8010), `worker` (Redis consumer), `frontend_blue` (:3011), `frontend_green` (:3012), `mysql` (:3307), `redis` (:6380), `qdrant` (:6333)

### CLI Bridge (Host-Native)

The CLI bridge runs **on the host** (not in Docker) so it can use the host's Claude/Codex CLI authentication (macOS Keychain). Docker containers reach it via `http://host.docker.internal:9876`.

```bash
# start.sh handles this automatically. Manual start:
node docker/bridge-server.mjs &    # Start bridge on host (:9876)
curl localhost:9876/health          # Check status
```

- Bridge authenticates via the host's `claude auth login` session — no API key needed
- `docker-compose up` does NOT start cli-bridge (it uses a Docker profile `bridge-docker`)
- If you need the Docker bridge instead: `docker-compose --profile bridge-docker up cli-bridge`

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
- `packages/models/` — SQLAlchemy async ORM models (27 models, all scoped by `organization_id`) + Pydantic schemas
- `packages/agents/` — CrewAI agent definitions + LangGraph orchestration + system prompts + Qdrant vector memory
- `packages/core/` — Settings (`pydantic-settings`), database engine, JWT auth, RBAC, logging
- `packages/worker/` — Redis queue consumer with concurrent task execution

### Other Root Directories

- `alembic/` — Database migrations (26 versions)
- `db/init.sql` — MySQL bootstrap script
- `docker/` — Dockerfiles + SSL certificate
- `docs/` — Architecture Decision Records
- `frontend/` — Next.js 14 app (React 18, TypeScript, 7 languages)
- `scripts/` — Utility scripts (import rewriter, locale translator, deploy, changelog generator, blog post generator)
- `tests/` — Test suite

### Tech Stack

- **Backend**: Python 3.11, FastAPI, SQLAlchemy 2.0 (async), MySQL 8, Redis 7
- **AI**: LangGraph, CrewAI, OpenAI SDK (GPT-5, Gemini fallback)
- **Prompts**: DB-backed via PromptService (editable at runtime via Prompt Studio)
- **Vector memory**: Qdrant (optional, `QDRANT_ENABLED=true`)
- **Frontend**: Next.js 14, React 18, TypeScript
- **Auth**: JWT (python-jose), bcrypt, RBAC (owner/admin/member/viewer)
- **Deploy**: Docker Compose, Nginx (blue/green frontend)

## Multi-Repo Orchestration

A single task can target multiple repositories simultaneously. Each repo runs its own AI pipeline and gets its own PR.

### Key Components
- **`RepoMapping`** model (`packages/models/.../repo_mapping.py`) — org-level repo registry (provider, owner, repo_name, base_branch, playbook)
- **`TaskRepoAssignment`** model (`packages/models/.../task_repo_assignment.py`) — join table linking tasks to multiple repo mappings with per-repo status/PR
- **API**: `POST /tasks/{id}/assign` with `repo_mapping_ids: [1, 3, 5]` → fan-out to N Redis jobs
- **Worker**: each assignment processed independently with per-repo locking
- **Status aggregation**: all assignments complete → task completed; any fails → partial

### Multi-Repo Flow
```
Task Assignment (repo_mapping_ids: [1, 2, 3])
  → TaskRepoAssignment row per repo (status: queued)
  → Redis payload per assignment (includes assignment_id)
  → Worker picks up each independently (parallel)
  → OrchestrationService resolves repo from assignment
  → PR created per repo
  → Status aggregated when all terminal
```

## Task Dependencies

Tasks can depend on other tasks. The system enforces execution order automatically.

### How It Works
- **Set dependencies**: at task creation (`depends_on_task_ids`), via `PUT /tasks/{id}/dependencies`, or in the UI
- **Assignment check**: `assign_task_to_ai()` raises ValueError if dependencies aren't completed
- **Worker check**: worker re-queues tasks whose dependencies aren't done yet
- **Auto-unblock**: when a task completes, `_auto_queue_dependents()` checks and queues any dependent tasks whose blockers are now all complete
- **Cycle detection**: DFS algorithm prevents circular dependencies

### Key Files
- `packages/models/src/agena_models/models/task_dependency.py` — TaskDependency model
- `packages/services/src/agena_services/services/task_service.py` — `get_dependency_blockers()`, `set_dependencies()`, `get_dependents()`
- `packages/services/src/agena_services/services/orchestration_service.py` — `_auto_queue_dependents()`
- `packages/worker/src/agena_worker/workers/redis_worker.py` — runtime dependency check before execution

## Flow System

Visual automation flows with n8n-style node configuration:

### Node Types
- **Agent** — LLM-powered (analyzer, planner, developer, reviewer, qa, etc.) with model/provider/prompt selection
- **Azure DevOps** — Create branch, create PR, complete PR, abandon PR (project/repo dropdown from API)
- **Azure Update** — Update work item state + comment
- **GitHub** — Create branch, create PR, merge PR (with reviewers, labels)
- **HTTP** — REST calls with auth (bearer/api-key/basic), timeout, response variables
- **Condition** — Branch logic (10 operators: eq/neq/gt/lt/contains/regex/empty etc.) with true/false targets
- **New Relic** — Fetch errors/violations from NR entities, import as tasks (`fetch_errors`, `import_errors`, `fetch_violations`)
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
- Corporate SSL cert bundled in `docker/FLOMcAfeeWG.crt` for proxy environments
- When adding new ORM models, register them in `packages/models/src/agena_models/models/__init__.py`

## Sentry Integration

Auto-imports production errors from Sentry and creates tasks for AI agents to fix. Full feedback loop: error → task → AI fix → PR → merge → Sentry resolved.

### Webhook Setup (PR Merge → Auto-Resolve)

When a PR is merged, Agena auto-resolves the linked Sentry issue. Configure in each repo:

**GitHub:**
1. Repo → Settings → Webhooks → Add webhook
2. URL: `https://api.agena.dev/webhooks/pr-merged`
3. Content type: `application/json`
4. Secret: `PR_WEBHOOK_SECRET` from `.env` (leave blank if not set)
5. Events: select **Pull requests** only

**Azure DevOps:**
1. Project Settings → Service Hooks → Create subscription
2. Event: **Pull request merged**
3. URL: `https://api.agena.dev/webhooks/pr-merged`
4. HTTP headers: `X-Agena-Webhook-Secret: <PR_WEBHOOK_SECRET>` (if set)

### Key Components
- **`SentryClient`** (`packages/services/.../integrations/sentry_client.py`) — list issues, resolve/unresolve, post comments
- **`SentryProjectMapping`** model — maps Sentry projects to repo mappings
- **Import**: `POST /tasks/import/sentry` or auto-import via worker polling
- **Resolve/Unresolve**: `POST /tasks/{id}/sentry-resolve` (toggles from task list)
- **PR comment**: Auto-posted on Sentry issue when AI creates a PR
- **Auto-resolve**: `POST /webhooks/pr-merged` resolves Sentry issue + posts comment on PR merge
- **Priority**: Derived from Sentry level (fatal→critical, error→high, warning→medium, info→low)
- **Deduplication**: Unique constraint on `(organization_id, source, external_id)`

### Configuration
- Integration config stored in `integration_configs` table (provider='sentry')
- `secret` = Sentry API token (Bearer token)
- `base_url` = `https://sentry.io/api/0` (default)
- `extra_config.organization_slug` = Sentry org slug

## New Relic Integration

Auto-imports production errors from New Relic APM entities and creates tasks for AI agents to fix.

### Architecture
```
New Relic NerdGraph API (GraphQL) → NewRelicClient → TaskService.import_from_newrelic()
  → ExternalTask (deduplicated by fingerprint) → TaskRecord (source='newrelic')
  → Worker auto-import every 5 min (for entities with auto_import=True)
```

### Key Components
- **`NewRelicClient`** (`packages/services/.../integrations/newrelic_client.py`) — NerdGraph GraphQL client for entity search, NRQL error queries, and error-to-task conversion
- **`NewRelicEntityMapping`** model (`packages/models/.../newrelic_entity_mapping.py`) — maps NR entity GUID to RepoMapping (which repo to target for fixes)
- **API routes** (`packages/api/.../routes/newrelic.py`) — entity browse, error fetch, mapping CRUD
- **Import endpoint** (`POST /tasks/import/newrelic`) — in `saas_tasks.py`
- **Flow node** — `newrelic` node type in `flow_executor.py` (actions: `fetch_errors`, `import_errors`, `fetch_violations`)
- **Worker polling** — `_poll_newrelic_auto_imports()` in `redis_worker.py`, runs every 5 min
- **Frontend** — `/dashboard/integrations/newrelic` entity browser + mapping page

### Error-to-Task Enrichment
- Parses file path and line number from PHP error messages (`/path/to/File.php:123`)
- Fetches sample transactions (endpoint, method, URI) per error group
- Generates errors inbox link: `https://one.eu.newrelic.com/nr1-core/errors-inbox/entity-inbox/{guid}?account={id}`
- Deduplication via SHA-256 fingerprint of `(entity_name, error_class, error_message)`

### Configuration
- Integration config stored in `integration_configs` table (provider='newrelic')
- `secret` = NR API key (NRAK-...)
- `base_url` = `https://api.newrelic.com/graphql` (US) or `https://api.eu.newrelic.com/graphql` (EU)
- `extra_config.account_id` = NR account ID

### SDK (@agena/sdk) Rules

- SDK lives in `packages/sdk/` — TypeScript API client published to npm as `@agena/sdk`
- SDK is a **thin HTTP client** — only wraps API calls, does NOT contain backend code
- **Version bumps only when SDK code changes**, not on every commit:
  - Bug fix → patch (`0.1.0` → `0.1.1`)
  - New feature/endpoint → minor (`0.1.0` → `0.2.0`)
  - Breaking change → major (`0.x` → `1.0.0`)
- To publish: `cd packages/sdk && npm run build && npm publish --access public`
- When adding new API routes to backend, also add corresponding methods to SDK client
- SDK docs are in `frontend/locales/docs/{lang}.json` under keys `sdk-install`, `sdk-quickstart`, `sdk-reference`

### i18n Rules

- **ALL frontend user-visible text must be in 7 languages**: tr, en, es, de, zh, it, ja
- Never hardcode strings in components — always use `t('key')` from `useLocale()`
- Locale files: `frontend/locales/{lang}.json` (flat dot-notation keys)
- Docs content: `frontend/locales/docs/{lang}.json` (markdown content per section)
- When adding new text, add keys to ALL 7 locale files simultaneously
- Blog posts have a `lang` field — filtered by active language in BlogList component

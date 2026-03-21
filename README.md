# Tiqr AI Agent SaaS

Production-ready, multi-tenant AI agent orchestration platform built with FastAPI + CrewAI + LangGraph + Redis + MySQL, including GitHub PR automation and a Next.js 14 dashboard.

## What is Included

- Async FastAPI backend
- SQLAlchemy models + Alembic scaffold
- JWT auth + organization isolation
- Free/Pro subscription limits with usage enforcement
- Stripe + Iyzico payment integration paths
- Redis queue + auto-scaling async worker (`MAX_WORKERS`)
- LangGraph state flow: `fetch_context -> analyze -> generate_code -> review_code -> finalize`
- CrewAI role orchestration (PM, Developer, Reviewer, Finalizer)
- GitHub branch/commit/PR automation
- Token/cost tracking and org-level usage counters
- LLM optimization (`services/llm`): prompt cache, model routing, context truncation
- Optional vector memory (`memory/base.py`, `memory/qdrant.py`)
- Next.js frontend routes for landing, pricing, auth, tasks, and task timeline

## Feature Catalog (Current)

### Core Delivery
- AI assignment from internal, Jira, and Azure sourced tasks
- Redis-based queue worker with dynamic concurrency
- Task cancellation endpoint and UI action (`POST /tasks/{id}/cancel`)
- Queue lock guard to prevent same-repo concurrent execution
- Retry/backoff handling for transient Codex/OpenAI execution failures
- Stale-running watchdog (auto-fail for long-running stuck jobs)

### Task Intelligence
- Queue insights on API/UI:
  - `queue_position`, `estimated_start_sec`, `queue_wait_sec`, `retry_count`
  - lock scope and blocker task info
- Execution telemetry:
  - start/end/duration
  - token and usage metrics
  - step-level logs with code preview and diff preview
- PR risk scoring per task:
  - `pr_risk_score`, `pr_risk_level`, `pr_risk_reason`

### Dependency & Governance
- Task Dependency Graph:
  - `GET /tasks/{id}/dependencies`
  - `PUT /tasks/{id}/dependencies`
  - cycle detection and self-dependency protection
  - assignment blocked while dependency blockers exist
- Tenant Playbooks (org-specific coding policy layer):
  - `PUT /integrations/playbook`
  - `GET /integrations/playbook/content`
  - playbook rules automatically injected into orchestration prompt context

### Story & Budget Controls
- Task Story Mode (implemented):
  - task-level fields: `story_context`, `acceptance_criteria`, `edge_cases`
  - these fields are injected into orchestration prompt context before generation
  - available in task create UI and task detail view
- Cost Guardrails (implemented):
  - task-level limits: `max_tokens`, `max_cost_usd`
  - run fails before PR creation when usage or estimated cost exceeds limit
  - guardrail events are written to task logs (`stage=guardrail`)

### Frontend
- Landing page sections for Flow/Agent engine and advanced capabilities showcase
- Dashboard overview with operations radar and queue forecast
- Task list with runtime, queue wait, retry, and token visibility
- Task detail panels for queue insight, dependency management, PR risk, and live logs

### Integrations
- Jira, Azure DevOps, OpenAI, and Playbook integration providers
- Org-scoped integration credentials and settings
- Repo mapping UX for Azure repo ↔ local path workflows

## Architecture

Task Fetch/Create -> Save TaskRecord -> Queue Redis -> Worker -> Agent Pipeline -> GitHub PR -> Save Result + Logs + Usage

## Project Layout

```text
ai-agent-system/
  api/
  agents/
  alembic/
  core/
  db/
  frontend/
  integrations/
  memory/
  models/
  schemas/
  security/
  services/
    llm/
  workers/
  docker/
  docker-compose.yml
  requirements.txt
  .env.example
```

## Environment Setup

```bash
cp .env.example .env
cp frontend/.env.example frontend/.env.local
```

Fill at least:
- `OPENAI_API_KEY`
- `JWT_SECRET_KEY`
- `GITHUB_TOKEN`, `GITHUB_OWNER`, `GITHUB_REPO`
- Stripe/Iyzico keys if payment integrations are enabled

Integration credentials are tenant-scoped from dashboard/API (`/integrations/*`).
`JIRA_*` and `AZURE_*` env vars are optional global fallbacks.

## Run with Docker

```bash
docker compose up --build
```

Services:
- Backend API: `http://localhost:8010`
- Frontend: `http://localhost:3010`
- MySQL: `localhost:3306`
- Redis: `localhost:6379`

## Local Development

Backend:

```bash
python3.11 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn api.main:app --reload --host 0.0.0.0 --port 8010
```

Worker:

```bash
python -m workers.redis_worker
```

Frontend:

```bash
cd frontend
npm install
npm run dev
```

## API Endpoints

Auth:
- `POST /auth/signup`
- `POST /auth/login`

Organization:
- `POST /org/invite`
- `POST /org/invite/accept`

Billing:
- `GET /billing/status`
- `POST /billing/plan`
- `POST /billing/stripe/checkout`
- `POST /billing/stripe/webhook`
- `POST /billing/iyzico/checkout`
- `POST /billing/iyzico/webhook`

Tasks:
- `POST /tasks`
- `GET /tasks`
- `GET /tasks/{id}`
- `POST /tasks/{id}/assign`
- `GET /tasks/{id}/logs`
- `POST /tasks/import/jira`
- `POST /tasks/import/azure`

Integrations (org scoped):
- `GET /integrations`
- `GET /integrations/{provider}`
- `PUT /integrations/jira`
- `PUT /integrations/azure`

Other:
- `POST /agents/run`
- `POST /github/pr`
- `GET /health`

## cURL Test Flow

1. Sign up:

```bash
curl -X POST http://localhost:8010/auth/signup \
  -H "Content-Type: application/json" \
  -d '{
    "email": "owner@example.com",
    "full_name": "Owner User",
    "password": "Secret123!",
    "organization_name": "Acme Engineering"
  }'
```

2. Use token:

```bash
export TOKEN="<ACCESS_TOKEN>"
```

3. Create task:

```bash
curl -X POST http://localhost:8010/tasks \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"title":"Build invoice webhook","description":"Add idempotency and retries"}'
```

4. Assign task:

```bash
curl -X POST http://localhost:8010/tasks/1/assign \
  -H "Authorization: Bearer $TOKEN"
```

5. Poll:

```bash
curl -X GET http://localhost:8010/tasks/1 -H "Authorization: Bearer $TOKEN"
curl -X GET http://localhost:8010/tasks/1/logs -H "Authorization: Bearer $TOKEN"
```

## Plans

- Free: 5 tasks/month
- Pro: unlimited tasks

Execution is blocked when free quota is exhausted.

## Frontend Routes

- `/`
- `/pricing`
- `/signin`
- `/signup`
- `/tasks`
- `/tasks/[id]`

## End-to-End Test Scenario

1. Visit landing page
2. Sign up
3. Create task
4. Assign to AI
5. Watch status updates (5s polling)
6. Open generated PR
7. Upgrade plan

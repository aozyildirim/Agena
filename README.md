[![Sponsor AGENA](https://img.shields.io/badge/Sponsor-AGENA-ff69b4?logo=githubsponsors&logoColor=white)](https://github.com/sponsors/aozyildirim)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Website](https://img.shields.io/badge/Website-agena.dev-0d9488)](https://agena.dev)

# AGENA — Agentic AI Platform for Autonomous Code Generation

<p align="center">
  <img src="frontend/public/readmeimg/boss.png" alt="AGENA Pixel Office — Boss Mode" width="800" />
</p>

> **The open-source agentic AI platform that writes code, reviews quality, and ships pull requests autonomously.**

AGENA is a production-ready, multi-tenant **agentic AI** orchestration platform. It coordinates LLM-powered agents to analyze tasks, generate code, review changes, and create pull requests — fully autonomously. Built as a **monorepo with 6 pip-installable packages**.

---

## Table of Contents

- [Key Features](#key-features)
- [Architecture](#architecture)
- [Monorepo Package Structure](#monorepo-package-structure)
- [Tech Stack](#tech-stack)
- [Quick Start](#quick-start)
- [Environment Variables](#environment-variables)
- [Docker Services](#docker-services)
- [Local Development](#local-development)
- [Database Migrations](#database-migrations)
- [Frontend Deploy (Zero-Downtime)](#frontend-deploy-zero-downtime)
- [API Endpoints](#api-endpoints)
- [AI Pipeline](#ai-pipeline)
- [Screenshots](#screenshots)
- [Contributing](#contributing)

---

## Key Features

**AI Pipeline**
- Autonomous PM → Planner → Developer → Reviewer → Finalizer workflow
- CrewAI role-based agents + LangGraph state machine orchestration
- Prompt Studio — edit system prompts at runtime without code deploy
- Vector memory (Qdrant) — learns from previous tasks for better context

**History-Grounded Sprint Refinement**
- Index closed Azure / Jira work items (with final SPs, assignees, PR
  titles, branches) into a per-org Qdrant collection
- For every new item, the LLM receives the top-5 similar past items and
  anchors its SP suggestion on your team's real distribution — naming
  which item it resembles and who did the prior work
- See [`docs/REFINEMENT.md`](docs/REFINEMENT.md) for the full flow and
  tuning knobs

**Team Skill Catalog**
- Completed tasks are automatically distilled into reusable skills
  (name + approach + prompt fragment + touched files + tags) via
  the LLM — Claude CLI, Codex CLI or API, whichever you're using
- When a new task matches an existing skill, the relevant entries are
  prepended to the agent's system prompt so past solutions compound
  instead of being rediscovered ad-hoc
- `/dashboard/skills` catalog page: list with pattern-type badges,
  usage counters, search / filter / manual create + edit
- See [`docs/SKILLS.md`](docs/SKILLS.md) for the extraction + retrieval
  flow, tuning knobs, and comparisons vs agents / refinement items

**Runtimes Registry**
- Every compute environment that can execute agent tasks (host CLI
  bridge, teammate's laptop, cloud daemon) registers as a Runtime
- Auto-enrollment: `bridge-server.mjs` picks up `AGENA_JWT` +
  `AGENA_TENANT_SLUG` from env and calls `/runtimes/register` on
  startup, then heartbeats every 30s with its current CLI availability
- `/dashboard/runtimes` shows the live list with status dots, CLI
  badges, heartbeat age, and daemon version
- See [`docs/RUNTIMES.md`](docs/RUNTIMES.md) for the enrollment +
  heartbeat + security model

**Multi-Repo Orchestration**
- Assign a single task to multiple repositories simultaneously
- Each repo runs its own AI pipeline in parallel — independent branches and PRs
- Per-repo locking prevents concurrent conflicts
- Unified dashboard shows all PRs and their status in one view

**Task Dependencies & Auto-Queue**
- Define execution order: Task B depends on Task A
- Worker checks dependencies before running — blocked tasks wait automatically
- When a dependency completes, dependent tasks auto-queue and start
- Cycle detection prevents circular dependency chains
- Visual dependency flow in the dashboard: A ✓ → B ✓ → C (waiting)

**DevOps Automation**
- Auto-generates branches, commits, and pull requests (GitHub + Azure DevOps)
- Sprint import from Jira and Azure DevOps
- DORA metrics dashboard (deployment frequency, lead time, change failure rate, MTTR)
- Team health symptom analysis (knowledge silos, bus factor, stale PRs, etc.)

**Multi-Tenant SaaS**
- Organization isolation with subdomain routing
- JWT auth + RBAC (owner, admin, member, viewer)
- Free/Pro/Enterprise plans with usage quotas
- Stripe billing integration

**AI-powered Sprint Nudges**
- Every blocked Azure DevOps or Jira work item gets a "Ping" button
- Checks the last comment timestamp — if >24h silent, fires a nudge
- LLM-generated, single-paragraph, language-picked-per-ping (7 locales)
- Pick the generator at send time: Claude CLI (subscription, via host
  bridge), Codex CLI (subscription), OpenAI, Gemini, or HAL. Claude
  CLI failures auto-fall-back to Codex CLI on the same bridge.
- Posts back with an `<at>@Display Name</at>` mention so Azure
  renders it as a real tag, plus a signed "written by Agena via
  {model}" line for transparency
- 48h cooldown + DB-persisted history prevents spam; UI badges
  already-nudged items with "Agena pinged Xh ago"

**Dashboard**
- Boss Mode — pixel-art office where you manage AI agents visually
- Visual flow builder — drag-and-drop automation pipelines
- Sprint performance tracking with risk scoring
- Real-time task monitoring with live logs and WebSocket updates
- Guided tour onboarding for new users
- 7 languages (TR, EN, ES, ZH, IT, DE, JA)

---

## Architecture

```
Request Flow:

  Browser → Next.js Frontend (Port 3010)
     ↓
  API Request → FastAPI (Port 8010)
     ↓
  Redis Queue → Worker (background)
     ↓
  OrchestrationService → LangGraph Pipeline
     ↓
  5 Nodes: fetch_context → analyze → generate_code → review_code → finalize
     ↓
  CrewAI Agents (PM, Developer, Reviewer, Finalizer)
     ↓
  PR Creation (GitHub / Azure DevOps)
```

```
Infrastructure:

  ┌─────────────┐  ┌──────────┐  ┌─────────┐
  │  MySQL 8.0  │  │ Redis 7  │  │ Qdrant  │
  │  (data)     │  │ (queue)  │  │ (vector)│
  └─────────────┘  └──────────┘  └─────────┘
         ↑               ↑            ↑
  ┌──────┴───────────────┴────────────┴──────┐
  │          Python Backend                   │
  │  ┌─────────┐  ┌────────┐  ┌───────────┐ │
  │  │ API     │  │ Worker │  │ CLI Bridge│ │
  │  │ :8010   │  │ (bg)   │  │ :9876     │ │
  │  └─────────┘  └────────┘  └───────────┘ │
  └──────────────────────────────────────────┘
         ↑
  ┌──────┴──────────────┐
  │  Next.js Frontend   │
  │  Blue :3011         │
  │  Green :3012        │
  │  (Nginx LB)         │
  └─────────────────────┘
```

---

## Monorepo Package Structure

The backend is split into **6 independent, pip-installable packages**:

```
packages/
├── core/                    # agena-core
│   └── src/agena_core/
│       ├── settings.py      # Pydantic BaseSettings (67 env vars)
│       ├── database.py      # SQLAlchemy async engine + sessions
│       ├── rbac.py          # Role-based access control matrix
│       ├── plans.py         # Subscription plan definitions
│       ├── http.py          # Corporate SSL patch
│       ├── logging.py       # Logging configuration
│       ├── db/base.py       # SQLAlchemy DeclarativeBase
│       ├── security/        # JWT + bcrypt password hashing
│       └── config/          # App-wide configuration
│
├── models/                  # agena-models
│   └── src/agena_models/
│       ├── models/          # 25 SQLAlchemy ORM models
│       │   ├── user.py, organization.py, task_record.py
│       │   ├── flow_run.py, flow_assets.py
│       │   ├── git_commit.py, git_pull_request.py, git_deployment.py
│       │   ├── prompt.py, prompt_override.py
│       │   └── ... (notification, billing, usage, etc.)
│       └── schemas/         # 9 Pydantic request/response schemas
│           ├── agent.py, auth.py, task.py, github.py
│           └── ... (billing, integration, org, refinement)
│
├── services/                # agena-services
│   └── src/agena_services/
│       ├── services/        # 31 business logic modules
│       │   ├── orchestration_service.py  # Core task execution
│       │   ├── task_service.py           # Task CRUD + queue
│       │   ├── flow_executor.py          # LangGraph flow runner
│       │   ├── prompt_service.py         # DB-backed prompt loader
│       │   ├── github_service.py         # GitHub API operations
│       │   ├── azure_pr_service.py       # Azure DevOps PR creation
│       │   ├── dora_service.py           # DORA metrics calculation
│       │   ├── analytics_service.py      # Team health + analytics
│       │   ├── queue_service.py          # Redis queue management
│       │   ├── auth_service.py           # User auth + signup
│       │   ├── billing_service.py        # Stripe integration
│       │   ├── notification_service.py   # Push + in-app notifications
│       │   ├── llm/                      # LLM provider abstraction
│       │   │   ├── provider.py           # OpenAI + Gemini routing
│       │   │   ├── cost_tracker.py       # Token cost calculation
│       │   │   └── cache.py             # Redis prompt cache
│       │   └── ...
│       └── integrations/    # Third-party API clients
│           ├── azure_client.py, github_client.py
│           ├── jira_client.py, qdrant_memory.py
│           └── llm_client.py
│
├── agents/                  # agena-agents
│   └── src/agena_agents/
│       ├── agents/          # AI agent orchestration
│       │   ├── orchestrator.py    # AgentOrchestrator (main coordinator)
│       │   ├── crewai_agents.py   # CrewAI agent runners (8 roles)
│       │   ├── langgraph_flow.py  # LangGraph state graph (5 nodes)
│       │   └── prompts.py         # Default prompt templates
│       └── memory/          # Vector memory abstraction
│           ├── base.py      # Abstract memory interface
│           └── qdrant.py    # Qdrant implementation
│
├── api/                     # agena-api
│   └── src/agena_api/
│       └── api/
│           ├── main.py            # FastAPI app bootstrap
│           ├── dependencies.py    # Auth, tenant, RBAC injection
│           ├── middleware/        # Rate limit, logging, tenant
│           └── routes/            # 18 route modules
│               ├── agents.py, tasks.py, flows.py
│               ├── auth.py, org.py, billing.py
│               ├── analytics.py, github.py, integrations.py
│               ├── preferences.py, notifications.py
│               └── ... (memory, refinement, usage, webhooks, ws)
│
└── worker/                  # agena-worker
    └── src/agena_worker/
        └── workers/
            └── redis_worker.py    # Redis queue consumer + task executor
```

**Other root-level directories:**

```
alembic/         # Database migrations (24 versions)
db/init.sql      # MySQL bootstrap script
docker/          # Dockerfiles + SSL certificate
docs/            # Architecture Decision Records
frontend/        # Next.js 14 app (React 18, TypeScript)
mobile/          # Mobile app
scripts/         # Utility scripts (import rewriter, locale translator)
tests/           # Test suite
```

### Package Dependency Graph

```
agena-core       ← no internal deps (foundation)
agena-models     ← depends on agena-core
agena-services   ← depends on agena-core, agena-models
agena-agents     ← depends on agena-core, agena-models, agena-services
agena-api        ← depends on all above
agena-worker     ← depends on agena-core, agena-models, agena-services
```

### Install a Single Package

```bash
pip install -e packages/core
pip install -e packages/models
pip install -e packages/agents   # includes CrewAI + LangGraph
```

---

## Tech Stack

| Layer | Technology |
|---|---|
| **Backend** | Python 3.11, FastAPI, SQLAlchemy 2.0 (async), Pydantic v2 |
| **AI** | CrewAI, LangGraph, OpenAI SDK (GPT-5, Gemini fallback) |
| **Database** | MySQL 8.0, Alembic migrations |
| **Queue** | Redis 7 |
| **Vector Memory** | Qdrant (optional, `QDRANT_ENABLED=true`) |
| **Frontend** | Next.js 14, React 18, TypeScript |
| **Auth** | JWT (python-jose), bcrypt, RBAC (4 roles) |
| **Deployment** | Docker Compose, Nginx (blue/green frontend) |

---

## CLI

`@agenaai/cli` drives the whole platform from the terminal — auth,
tasks, skills, refinement, runtimes, and the host bridge daemon:

```bash
# Homebrew (macOS / Linux) — recommended
brew install aozyildirim/tap/agena

# npm (any platform)
npm install -g @agenaai/cli
```

```bash
# Auth + tenant
agena setup                    # device-code OAuth → saves config → starts daemon
agena login                    # login only
agena whoami                   # current user + tenant + JWT source
agena org list / org switch <slug>

# Local CLI bridge (Claude / Codex)
agena daemon start|stop|status|logs
agena runtime list|status <id>

# Tasks
agena task list [-s running|queued|...]
agena task show <id>
agena task logs <id>
agena task create -t "Fix login bug" --assign

# Team skill catalog
agena skill list [-q <query>] [-t <pattern_type>]
agena skill show <id>
agena skill search "nullable pointer panic"    # vector search
agena skill delete <id> -y

# Sprint refinement (Qdrant-grounded SP estimates)
agena refinement backfill -p MyProject -t MyTeam --days 730
agena refinement backfill-status
agena refinement history [--sp 5] [-q auth]
agena refinement analyze -p MyProject -t MyTeam --sprint-path '...'
```

- **Device-code OAuth** — no JWT copy-paste; browser opens, you
  confirm a 6-digit code.
- **Keychain credential storage** — JWT held in macOS Keychain /
  libsecret / Windows Credential Manager when available.
- **Bundled bridge** — `agena daemon start` ships with its own copy
  of `bridge-server.mjs`, so `npm install -g @agenaai/cli` is
  self-contained.
- **Homebrew tap** — `aozyildirim/tap/agena` auto-updates via
  GoReleaser on every CLI release.

See [`packages/cli/README.md`](packages/cli/README.md) for the full
command reference.

---

## Quick Start

### 1. Clone and configure

```bash
git clone https://github.com/aozyildirim/Agena.git
cd Agena
cp .env.example .env
cp frontend/.env.example frontend/.env.local
```

### 2. Set required environment variables in `.env`

```env
OPENAI_API_KEY=sk-...
JWT_SECRET_KEY=your-secret-key
GITHUB_TOKEN=ghp_...
GITHUB_OWNER=your-org
GITHUB_REPO=your-repo
```

### 3. Start all services

```bash
./start.sh
```

This starts Docker services (backend, worker, frontend, MySQL, Redis, Qdrant) and the **CLI bridge on the host** for Claude/Codex CLI authentication via system keychain.

> **Note:** Use `start.sh` instead of `docker-compose up`. The CLI bridge must run on the host (not in Docker) to access Claude/Codex CLI auth. `./stop.sh` stops everything.

### 4. Access

| Service | URL |
|---|---|
| Frontend (dev) | http://localhost:3010 |
| Frontend Blue (prod) | http://localhost:3011 |
| Backend API | http://localhost:8010 |
| API Docs (Swagger) | http://localhost:8010/docs |
| CLI Bridge | http://localhost:9876/health |
| Qdrant Dashboard | http://localhost:6333/dashboard |

### 5. Create your first user

```bash
curl -X POST http://localhost:8010/auth/signup \
  -H "Content-Type: application/json" \
  -d '{
    "email": "admin@example.com",
    "full_name": "Admin User",
    "password": "Secret123!",
    "organization_name": "My Team"
  }'
```

### 6. Create platform admin (optional)

```bash
# Create admin (interactive — prompts for email, name, password)
docker exec -it ai_agent_api agena admin:user:create

# List all platform admins
docker exec ai_agent_api agena admin:user:list

# Promote existing user to admin
docker exec -it ai_agent_api agena admin:user:promote
```

Password requirements: 12+ characters, uppercase, lowercase, digit, and special character.

The admin panel is accessible at `/dashboard/admin` after login. Only platform admins can see it.

---

## Environment Variables

All configuration is via environment variables. See `.env.example` for the full list. Key ones:

| Variable | Description | Required |
|---|---|---|
| `OPENAI_API_KEY` | OpenAI API key | Yes |
| `JWT_SECRET_KEY` | JWT signing secret | Yes |
| `GITHUB_TOKEN` | GitHub PAT for PR creation | For GitHub PRs |
| `GITHUB_OWNER` | GitHub org/user | For GitHub PRs |
| `GITHUB_REPO` | Default repo name | For GitHub PRs |
| `MYSQL_HOST` | MySQL host | Default: `mysql` |
| `MYSQL_DATABASE` | Database name | Default: `ai_agent_db` |
| `REDIS_URL` | Redis connection URL | Default: `redis://redis:6379` |
| `QDRANT_ENABLED` | Enable vector memory | Default: `false` |
| `QDRANT_URL` | Qdrant server URL | Default: `http://qdrant:6333` |
| `LLM_MODEL` | Default LLM model | Default: `gpt-4o` |
| `LLM_LARGE_MODEL` | Model for complex tasks | Default: `gpt-5` |
| `LLM_SMALL_MODEL` | Model for simple tasks | Default: `gpt-4o-mini` |
| `MAX_WORKERS` | Concurrent worker tasks | Default: `3` |

---

## Docker Services

| Service | Container | Port | Description |
|---|---|---|---|
| `backend` | ai_agent_api | 8010 | FastAPI + auto-reload |
| `worker` | ai_agent_worker | — | Redis queue consumer |
| `cli-bridge` | (host process) | 9876 | Claude/Codex CLI bridge (runs on host, not Docker) |
| `frontend` | ai_agent_frontend | 3010 | Next.js (dev) |
| `frontend_blue` | ai_agent_frontend_blue | 3011 | Next.js (blue, prod) |
| `frontend_green` | ai_agent_frontend_green | 3012 | Next.js (green, prod) |
| `mysql` | ai_agent_mysql | 3307 | MySQL 8.0 |
| `redis` | ai_agent_redis | 6380 | Redis 7 |
| `qdrant` | ai_agent_qdrant | 6333 | Qdrant vector DB |

### CLI Bridge

The CLI bridge runs **on the host** (not in Docker) so it can access Claude/Codex CLI authentication (macOS Keychain, browser OAuth). `start.sh` handles this automatically.

```bash
# Manual start (if not using start.sh):
node docker/bridge-server.mjs &

# Check status:
curl http://localhost:9876/health
# → {"status":"ok","codex":true,"claude":true,"codex_auth":true,"claude_auth":true}
```

Docker containers reach the bridge via `http://host.docker.internal:9876`.

### Common Commands

```bash
# Start everything (recommended)
./start.sh

# Restart backend after code changes (hot-reload via volume mount)
docker-compose restart backend

# Restart worker (no hot-reload, needs restart)
docker-compose restart worker

# Rebuild a specific service
docker-compose up -d --build backend

# View logs
docker logs -f ai_agent_api
docker logs -f ai_agent_worker

# Shell into backend container
docker-compose exec backend bash
```

---

## Local Development

### Backend (without Docker)

```bash
python3.11 -m venv .venv
source .venv/bin/activate

# Install all packages in editable mode
pip install -r requirements.txt
pip install -e packages/core \
    -e packages/models \
    -e packages/services \
    -e packages/agents \
    -e packages/api \
    -e packages/worker

# Run API
uvicorn agena_api.api.main:app --reload --host 0.0.0.0 --port 8010

# Run Worker (separate terminal)
python -m agena_worker.workers.redis_worker
```

### Frontend

```bash
cd frontend
npm install
npm run dev        # Development (http://localhost:3010)
npm run build      # Production build
npm run lint       # Lint check
```

---

## Database Migrations

```bash
# Apply all pending migrations
docker-compose exec backend alembic upgrade head

# Create a new migration
docker-compose exec backend alembic revision -m "description"

# Check current version
docker-compose exec backend alembic current

# Rollback one step
docker-compose exec backend alembic downgrade -1
```

---

## Frontend Deploy (Zero-Downtime)

Frontend runs as blue/green production containers. Code is NOT volume-mounted.

```bash
# Zero-downtime deploy (rebuilds one container at a time):
./scripts/deploy-frontend.sh

# NEVER use docker-compose up --build for both at once — causes 502
```

For backend changes, hot-reload works via volume mount:
```bash
docker-compose restart backend worker
```

---

## API Endpoints

### Auth
| Method | Path | Description |
|---|---|---|
| POST | `/auth/signup` | Register + create org |
| POST | `/auth/login` | Get JWT token |

### Tasks
| Method | Path | Description |
|---|---|---|
| POST | `/tasks` | Create task |
| GET | `/tasks` | List tasks |
| GET | `/tasks/{id}` | Task detail |
| POST | `/tasks/{id}/assign` | Assign to AI agent |
| POST | `/tasks/{id}/cancel` | Cancel running task |
| GET | `/tasks/{id}/logs` | Execution logs |
| POST | `/tasks/import/azure` | Import from Azure DevOps |
| POST | `/tasks/import/jira` | Import from Jira |
| POST | `/tasks/import/newrelic` | Import from New Relic |
| POST | `/tasks/import/sentry` | Import from Sentry |
| POST | `/tasks/{id}/sentry-resolve` | Resolve/unresolve linked Sentry issue |
| POST | `/webhooks/pr-merged` | PR merge webhook (auto-resolves Sentry) |

### Agents & Flows
| Method | Path | Description |
|---|---|---|
| POST | `/agents/run` | Run agent on task |
| GET | `/agents/live` | Live agent status |
| POST | `/flows/run` | Execute automation flow |
| GET | `/flows/templates` | List flow templates |

### Organization
| Method | Path | Description |
|---|---|---|
| POST | `/org/invite` | Send invite |
| POST | `/org/invite/accept` | Accept invite |
| GET | `/org/members` | List members |
| PUT | `/org/members/{id}/role` | Change role |

### Integrations
| Method | Path | Description |
|---|---|---|
| PUT | `/integrations/azure` | Configure Azure DevOps |
| PUT | `/integrations/jira` | Configure Jira |
| PUT | `/integrations/github` | Configure GitHub |
| GET | `/integrations` | List all configs |

### Analytics & DORA
| Method | Path | Description |
|---|---|---|
| GET | `/analytics/dora` | DORA metrics |
| GET | `/analytics/team-health` | Team health symptoms |
| GET | `/analytics/sprint` | Sprint analytics |

### Other
| Method | Path | Description |
|---|---|---|
| GET | `/preferences` | User preferences |
| PUT | `/preferences/prompts` | Prompt overrides |
| GET | `/billing/status` | Billing status |
| POST | `/billing/stripe/checkout` | Stripe checkout |
| GET | `/health` | Health check |

Full OpenAPI docs available at `/docs` when running.

---

## AI Pipeline

### How a Task Runs

1. **Task Created** — User creates task via UI or imports from Jira/Azure
2. **Queued** — Task goes to Redis queue with repo lock (prevents concurrent edits)
3. **fetch_context** — Vector memory retrieves similar past tasks for context
4. **analyze (PM Agent)** — Analyzes requirements, estimates story points, plans file changes
5. **generate_code (Developer Agent)** — Generates code patches following the plan
6. **review_code (Reviewer Agent)** — Reviews patches for correctness, security, patterns
7. **finalize** — Cleans output, creates branch, commits, opens PR
8. **Done** — Task marked complete, notifications sent, usage tracked

### Agent Roles

| Agent | Model | Purpose |
|---|---|---|
| Context Analyst | Small (fast) | Summarize memory + repo context |
| Product Manager | Large + reasoning | Technical analysis, scope, estimation |
| AI Planner | Large + reasoning | File-level change plan |
| Developer | Large (128K output) | Code patch generation |
| Reviewer | Large + reasoning | Code review + correction |
| Finalizer | Small | Clean output for git commit |

### Prompt Studio

System prompts are stored in the database and editable at runtime via the Prompt Studio UI. Changes take effect immediately without code deployment.

---

## Screenshots

### Boss Mode — Pixel Office
Manage your AI team in a retro pixel-art office. Each agent is a character you can click, assign tasks, and monitor in real time.

![Boss Mode](frontend/public/readmeimg/boss.png)

### Agent Management
Configure AI agents with different roles. View performance analytics — flow coverage, activity share, latency, and success index per agent.

![Agent Management](frontend/public/readmeimg/agentmanage.png)

### Create Agent
Three-step wizard: pick a pixel character and name, choose provider (OpenAI, Gemini, Codex CLI, Claude CLI, Custom), then select a model.

| Step 1 — Character | Step 2 — Provider | Step 3 — Model |
|---|---|---|
| ![Pick Character](frontend/public/readmeimg/bossagentadd1.png) | ![Select Type](frontend/public/readmeimg/bossagentadd4.png) | ![Choose Model](frontend/public/readmeimg/bossagentadd2.png) |

### Agent Flows — Visual Pipeline Builder
Drag-and-drop flow editor with nodes for PM Analysis, Technical Plan, Development, and QA Test. Includes approval gates, run history, version control, and flow templates.

![Agent Flows](frontend/public/readmeimg/flow.png)

### Sprint Board
Kanban-style board with color-coded columns. Import tasks directly from Azure DevOps or Jira sprints.

![Sprint Board](frontend/public/readmeimg/Sprintboard.png)

### Sprint Performance
Team health dashboard with circular gauge score, timeline progress, completion tracking, and per-member expandable cards.

![Sprint Performance](frontend/public/readmeimg/sprintperformance.png)

### Task Feed
Create tasks with title, description, story context, acceptance criteria, edge cases, and cost guardrails.

![Task Feed](frontend/public/readmeimg/new_task.png)

### Repo Mappings
Map Azure DevOps repositories to local paths for code generation.

![Repo Mappings](frontend/public/readmeimg/repomapp.png)

---

## Plans

| Plan | Tasks/Month | Features |
|---|---|---|
| **Free** | 5 | Basic pipeline, 1 integration |
| **Pro** | Unlimited | All features, priority queue |
| **Enterprise** | Unlimited | Custom models, SSO, dedicated support |

---

## Why AGENA?

| Challenge | How AGENA Solves It |
|---|---|
| Repetitive coding tasks eat developer hours | AI agents autonomously generate code from task descriptions |
| Code review bottlenecks slow delivery | Built-in AI reviewer catches issues before human review |
| Context switching kills productivity | Queue tasks, get PRs — AI handles the implementation |
| Copilot only suggests, you still code | AGENA delivers complete pull requests, not snippets |
| No visibility into AI work | Pixel agent dashboard shows real-time agent activity |

### AGENA vs GitHub Copilot

- **Copilot** = AI-assisted coding (you drive, AI suggests line by line)
- **AGENA** = Agentic AI coding (AI drives the full task-to-PR pipeline)

They're complementary: use Copilot for creative work, AGENA for well-defined tasks. Read more: [AGENA vs GitHub Copilot](https://agena.dev/blog/github-copilot-alternative)

### Learn More

- [What is Agentic AI?](https://agena.dev/blog/what-is-agentic-ai)
- [Agentic AI Nedir?](https://agena.dev/blog/agentic-ai-nedir)
- [AI Code Generation Best Practices](https://agena.dev/blog/ai-code-generation-best-practices)
- [Pixel Agent Technology](https://agena.dev/blog/pixel-agent-technology)
- [Use Cases](https://agena.dev/use-cases)
- [Documentation](https://agena.dev/docs)

---

## Contributing

This repository is open-source under the MIT License.

- License: [LICENSE](./LICENSE)
- Contributing: [CONTRIBUTING.md](./CONTRIBUTING.md)
- Code of Conduct: [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md)
- Security: [SECURITY.md](./SECURITY.md)

---

## Sponsor

If AGENA helps your team, support development:

- GitHub Sponsors: https://github.com/sponsors/aozyildirim

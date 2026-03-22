# Tiqr Feature Catalog

This file is the single source of truth for currently implemented product capabilities in this repository.

## 1) Platform Foundation

- Multi-tenant SaaS architecture with organization-scoped isolation.
- FastAPI async backend, Next.js dashboard frontend, Redis queue worker, MySQL persistence.
- JWT auth (`signup`, `login`, `me`) and protected API routes.
- Team/organization invite and accept flows.
- Subscription-aware execution limits (Free/Pro usage enforcement).

## 2) Task Lifecycle

- Task creation with rich context fields:
  - `story_context`
  - `acceptance_criteria`
  - `edge_cases`
  - guardrails (`max_tokens`, `max_cost_usd`)
- Task listing, search, filtering, and queue visibility.
- Task details with execution status and timeline.
- Task assignment to AI pipeline.
- Task cancellation endpoint and UI flow.
- Task logs endpoint with step-based event stream.
- Dependency graph:
  - read dependencies
  - update dependencies
  - cycle/self dependency protections
  - assignment blocking when dependencies are unresolved

## 3) AI Orchestration Pipeline

- LangGraph state flow:
  - `fetch_context`
  - `analyze`
  - `generate_code`
  - `review_code`
  - `finalize`
- CrewAI role orchestration (PM, Developer, Reviewer, Finalizer).
- Provider fallback path to direct LLM execution when needed.
- Queue worker with dynamic concurrency (`MAX_WORKERS`) and safe task isolation.
- Queue lock guard for repository-level serialization.
- Retry/backoff handling for transient model/tool failures.
- Stale-run watchdog behavior for long-running stuck tasks.

## 4) Code Delivery and PR Automation

- Git branch + commit + pull request creation automation.
- GitHub PR API endpoint for direct PR creation flow.
- Azure/Jira sourced tasks supported in the same execution pipeline.
- Repo mapping model for external repo identity to local execution paths.
- Prompt context enrichment from task details and org settings.

## 5) Integrations

- Integration config CRUD (org-scoped):
  - OpenAI
  - Gemini
  - Azure DevOps
  - Jira
  - GitHub
- Azure helper endpoints:
  - projects, teams, sprints, sprint members
  - repos, states, member work items
- Jira import endpoint.
- Azure import endpoint.
- Credential masking in UI/API outputs (secret-safe responses).

## 6) Flow System

- Visual flow run API and persisted flow run records.
- Flow templates:
  - create
  - list
  - update
  - delete
- Flow versioning:
  - list versions
  - create version snapshots
  - fetch specific version
- Agent analytics endpoint for flow and agent usage insights.

## 7) Agent Management

- Dashboard agent configuration page with:
  - role-based agent cards
  - provider selection (`openai`, `gemini`, `codex_cli`, `custom`)
  - model selection/custom model
  - system prompt editing
  - enable/disable toggle
  - create custom agent
- Agent config persistence in preferences (DB-backed) with local fallback.
- Agent performance analytics cards in dashboard.

## 8) Preferences and Playbooks

- User preferences endpoint (load/save).
- DB-backed profile settings.
- Notification preferences via profile settings.
- Tenant Playbook support:
  - save playbook content
  - read current playbook content
  - automatic orchestration prompt injection of playbook rules

## 9) Notifications

- Notification event ingestion endpoint.
- Notification listing with unread count.
- Mark one as read.
- Mark all as read.
- Clear all notifications endpoint.
- Dashboard bell badge with unread counter.
- Notification center page with filtering and quick actions.
- Browser notification bridge support and user opt-in toggle.
- Audible alert for newly arrived notifications when enabled.

## 10) Dashboard UX Modules

- Overview page with operational widgets.
- Tasks page with status, duration, token visibility, and filters.
- Sprints page with Azure sprint integration and active sprint behavior.
- Mappings page for repo/path mappings.
- Integrations page with provider status and connection states.
- Notifications page with grouped list actions.
- Profile page with preference controls.
- Team page with org context and membership operations.
- Sidebar enhancements:
  - collapsible navigation
  - persistent collapsed state
  - unread notification badge in menu
  - scrollable sidebar for small screens/heights

## 11) Billing and Plans

- Billing status endpoint.
- Plan switch endpoint.
- Stripe checkout + webhook endpoints.
- Iyzico checkout + webhook endpoints.
- Task execution quota enforcement by active plan.

## 12) Ops and Reliability

- `/health` endpoint for liveness checks.
- CORS middleware configured for frontend/backend local runs.
- Structured startup logging and DB table bootstrap on startup.
- Dockerized local stack:
  - API
  - Worker
  - Frontend
  - MySQL
  - Redis

## 13) Internationalization

- Dashboard and user-facing UI supports multi-language key-based translations.
- Project rule enforced for new strings:
  - do not hardcode UI strings in components when locale helper is available
  - provide both `en` and `tr` keys for every new translation key


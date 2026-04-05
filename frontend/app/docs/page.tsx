'use client';

import Link from 'next/link';
import { useState, useMemo, useEffect } from 'react';
import { useLocale } from '@/lib/i18n';
import enDocs from '@/locales/docs/en.json';

const SITE = 'https://agena.dev';

// Section/child keys map to i18n - titles resolved at render time
const sectionsDef = [
  {
    id: 'getting-started', icon: '🚀', titleKey: 'docs.sec.gettingStarted',
    children: [
      { id: 'overview', titleKey: 'docs.overview' },
      { id: 'signup', titleKey: 'docs.signup' },
      { id: 'quickstart-saas', titleKey: 'docs.quickstartSaas' },
      { id: 'quickstart-selfhost', titleKey: 'docs.quickstartSelfhost' },
    ],
  },
  {
    id: 'dashboard', icon: '🖥️', titleKey: 'docs.sec.dashboard',
    children: [
      { id: 'office', titleKey: 'docs.office' },
      { id: 'tasks', titleKey: 'docs.tasks' },
      { id: 'sprints', titleKey: 'docs.sprints' },
      { id: 'sprint-performance', titleKey: 'docs.sprintPerf' },
      { id: 'refinement', titleKey: 'docs.refinement' },
      { id: 'agents', titleKey: 'docs.agents' },
      { id: 'prompt-studio', titleKey: 'docs.promptStudio' },
      { id: 'flows', titleKey: 'docs.flows' },
      { id: 'templates', titleKey: 'docs.templates' },
      { id: 'dora', titleKey: 'docs.dora' },
      { id: 'task-dependencies', titleKey: 'docs.taskDependencies' },
    ],
  },
  {
    id: 'setup', icon: '⚙️', titleKey: 'docs.sec.configuration',
    children: [
      { id: 'integrations', titleKey: 'docs.integrations' },
      { id: 'repo-mapping', titleKey: 'docs.repoMapping' },
      { id: 'team-management', titleKey: 'docs.teamManagement' },
      { id: 'profile-settings', titleKey: 'docs.profileSettings' },
      { id: 'chatops', titleKey: 'docs.chatops' },
      { id: 'multi-repo', titleKey: 'docs.multiRepo' },
    ],
  },
  {
    id: 'architecture', icon: '🏗️', titleKey: 'docs.sec.architecture',
    children: [
      { id: 'pipeline', titleKey: 'docs.pipeline' },
      { id: 'services', titleKey: 'docs.services' },
      { id: 'selfhost-deploy', titleKey: 'docs.selfhostDeploy' },
    ],
  },
  {
    id: 'admin', icon: '👑', titleKey: 'docs.sec.admin',
    children: [
      { id: 'admin-panel', titleKey: 'docs.adminPanel' },
      { id: 'admin-orgs', titleKey: 'docs.adminOrgs' },
      { id: 'admin-users', titleKey: 'docs.adminUsers' },
    ],
  },
  {
    id: 'api-ref', icon: '📡', titleKey: 'docs.sec.apiRef',
    children: [
      { id: 'auth-api', titleKey: 'docs.authApi' },
      { id: 'tasks-api', titleKey: 'docs.tasksApi' },
      { id: 'flows-api', titleKey: 'docs.flowsApi' },
      { id: 'integrations-api', titleKey: 'docs.integrationsApi' },
    ],
  },
  {
    id: 'sdk', icon: '📦', titleKey: 'docs.sec.sdk',
    children: [
      { id: 'sdk-install', titleKey: 'docs.sdkInstall' },
      { id: 'sdk-quickstart', titleKey: 'docs.sdkQuickstart' },
      { id: 'sdk-reference', titleKey: 'docs.sdkReference' },
    ],
  },
];

// EN content imported statically; other langs loaded dynamically
const contentEN: Record<string, string> = enDocs as Record<string, string>;
const _contentCache: Record<string, Record<string, string>> = { en: contentEN };

async function loadDocsLang(lang: string): Promise<Record<string, string>> {
  if (_contentCache[lang]) return _contentCache[lang];
  try {
    const mod = await import(`@/locales/docs/${lang}.json`);
    _contentCache[lang] = mod.default as Record<string, string>;
    return _contentCache[lang];
  } catch {
    return contentEN;
  }
}

// Legacy inline content kept as fallback
const content: Record<string, string> = {
  overview: `
AGENA is an **agentic AI platform** that autonomously generates code, creates pull requests, and manages your software development workflow. It is designed for development teams who want to accelerate delivery without sacrificing code quality.

### What AGENA Does
- **Takes a task** from your backlog (Azure DevOps, Jira, or manually created)
- **Runs an AI agent pipeline**: PM → Developer → Reviewer → Finalizer
- **Generates production code**, creates a branch, commits, and opens a PR
- **Reviews its own output** with a dedicated Reviewer agent before submitting
- **Notifies your team** via Slack, Teams, or Telegram
- **Learns from your codebase** using vector memory for context-aware generation

### Key Concepts
| Concept | Description |
|---------|-------------|
| **Task** | A work item imported from Jira/Azure DevOps or created manually. Contains title, description, acceptance criteria, and context. |
| **Agent** | An AI role (PM, Developer, Reviewer, QA, Finalizer) with its own LLM model, system prompt, and behavior. Configurable per organization. |
| **Flow** | A visual automation pipeline (n8n-style) connecting agents, conditions, HTTP calls, and integrations into custom workflows. |
| **Pixel Agent** | The animated visual workspace showing agents as pixel characters working on tasks in real-time. |
| **Organization** | A multi-tenant workspace. Each org has its own integrations, team members, tasks, and billing. |
| **Repo Mapping** | Links a GitHub/Azure DevOps repository to your org so AGENA knows where to create branches and PRs. |
| **Playbook** | Organization-wide coding rules and conventions. Agents reference the playbook when generating code. |
| **Sprint** | Active sprint from Azure DevOps or Jira. Tasks can be imported from the sprint and tracked on the sprint board. |

### How It Works — End to End
1. You create a task (manually, from Jira/Azure, or via ChatOps: \`/fix login returns 500\`)
2. AGENA queues the task in a Redis-backed priority queue
3. The **Worker** picks up the task and starts the pipeline:
   - **PM Agent** fetches your codebase, analyzes requirements, writes an implementation plan
   - **Developer Agent** generates code following your playbook and repo conventions
   - **Reviewer Agent** reviews the code for bugs, security, and best practices
   - **Finalizer Agent** creates a branch, commits the code, opens a PR
4. You receive a notification with the PR link
5. You review, provide feedback, and merge — or AGENA can auto-fix based on PR comments

### Supported Integrations
| Category | Services |
|----------|----------|
| **Code Hosting** | GitHub, Azure DevOps |
| **Task Management** | Jira, Azure Boards |
| **AI Providers** | OpenAI (GPT-5, GPT-4o), Google Gemini |
| **Notifications** | Slack, Microsoft Teams, Telegram, Email |
| **ChatOps** | Slack commands, Teams bot, Telegram bot |
| **Vector Memory** | Qdrant (optional, for context learning) |
  `,

  signup: `
### Creating Your Account

1. Go to [agena.dev/signup](${SITE}/signup)
2. Enter your email and password
3. You will be assigned to a new organization automatically
4. Complete the onboarding wizard to configure your first integration

### After Signup
- You are the **owner** of your organization
- Invite team members from **Dashboard → Team**
- Configure integrations from **Dashboard → Integrations**
  `,

  'quickstart-saas': `
### Using AGENA SaaS (agena.dev)

**Step 1 — Sign up** at [agena.dev/signup](${SITE}/signup)

**Step 2 — Configure Integrations** (Dashboard → Integrations)
- **AI tab**: Add your OpenAI API key (required) and optionally Gemini
- **Task tab**: Connect GitHub (for PR creation) and optionally Azure DevOps / Jira

**Step 3 — Map a Repository** (Dashboard → Mappings)
- Select your GitHub owner and repository
- This tells AGENA where to create branches and PRs

**Step 4 — Set Active Sprint** (Dashboard → Profile)
- Select your Azure/Jira project, team, and sprint
- The active sprint is auto-detected

**Step 5 — Create Your First Task**
- Go to **Dashboard → Tasks** → Create Task
- Enter a title and description (be specific about what you want)
- Click **Assign to AI** — AGENA will queue it, run the pipeline, and create a PR

**Step 6 — Monitor Progress**
- Watch the task status in the task list or **Office** view
- When done, you will see the PR link
  `,

  'quickstart-selfhost': `
### Self-Hosted Deployment

#### Prerequisites
- Docker & Docker Compose
- A server with at least 4GB RAM
- Domain with SSL (for webhook callbacks)

#### Installation

\`\`\`bash
# Clone the repository
git clone https://github.com/aozyildirim/Agena.git
cd Agena

# Copy environment configuration
cp .env.example .env
# Edit .env — set your database passwords and JWT secret

# Start all services
docker compose up -d --build
\`\`\`

#### Services Started
| Service | Port | Description |
|---------|------|-------------|
| Frontend (blue) | 3011 | Next.js dashboard |
| Frontend (green) | 3012 | Blue/green deployment pair |
| Backend API | 8010 | FastAPI server |
| Worker | — | Redis task consumer |
| MySQL | 3307 | Primary database |
| Redis | 6380 | Task queue + pub/sub |
| Qdrant | 6333 | Vector memory (optional) |

#### Nginx Setup
Configure Nginx to proxy \`yourdomain.com\` to the frontend pool (3011/3012) and \`api.yourdomain.com\` to the backend (8010). See the repo's nginx config for reference.

#### Zero-Downtime Frontend Deploy
\`\`\`bash
./scripts/deploy-frontend.sh
\`\`\`
This rebuilds one frontend container at a time while the other serves traffic.

#### Database Migrations
\`\`\`bash
docker compose exec backend alembic upgrade head
\`\`\`
  `,

  office: `
### Office — Pixel Agent Workspace

The **Office** is AGENA's visual workspace where your AI agents appear as animated pixel characters. Each agent has a desk, walks around, and visually shows what it is working on.

#### What You See
- **Agent Characters** — Each AI role (PM, Developer, Reviewer, etc.) is a pixel character at their desk
- **Activity Indicators** — Agents glow or animate when actively processing a task
- **Task Progress Bar** — Real-time pipeline progress: fetch → analyze → generate → review → finalize
- **Queue Counter** — Shows how many tasks are waiting in the queue
- **Recent Completions** — Quick access to recently finished tasks and their PR links

#### Interactive Elements
- **Click an agent** to see its current task and status
- **Hover over desks** for quick agent info
- **Create Task** button for quick task creation without leaving the office view
- The office layout updates in real-time via WebSocket — no need to refresh

#### When to Use Office
The Office is ideal for:
- Monitoring active agent work in real-time
- Demo/presentation mode to showcase AGENA to stakeholders
- Quick overview of your AI workforce status

#### Navigation
Dashboard → Office (first item in the Workspace section of the sidebar)
  `,

  tasks: `
### Tasks

The task management hub for all your AI-generated work items.

#### Creating Tasks
1. **Manual**: Click "Create Task" → enter title + description → Assign to AI
2. **Import from Azure DevOps**: Select project/team/sprint → Import
3. **Import from Jira**: Select project/board/sprint → Import
4. **ChatOps**: Send \`/fix login page 500 error\` from Teams/Slack/Telegram

#### Task Lifecycle
\`New → Queued → Running → Completed/Failed\`

#### Task Details
Each task shows:
- **Timeline** — Step-by-step agent execution log
- **PR link** — Direct link to the created pull request
- **Branch name** — The auto-generated branch
- **Token usage** — LLM tokens consumed and cost estimate
- **Agent model** — Which AI model was used

#### Tips
- Be specific in task descriptions — include file paths, expected behavior, and edge cases
- Use the **Story Context** and **Acceptance Criteria** fields for complex tasks
- Set **Max Tokens** to control cost per task
  `,

  sprints: `
### Sprint Board

Kanban-style board showing all tasks in your active sprint, grouped by status.

#### Setup
1. Go to **Dashboard → Profile**
2. Select your Azure DevOps or Jira project, team, and sprint
3. The sprint board automatically loads work items from the selected sprint

#### Features
- **Drag-and-drop** task state changes
- **Import all sprint items** with one click
- **Assign to AI** directly from the board
- **Filter** by state, assignee, or work item type
- **Real-time updates** via WebSocket
  `,

  'sprint-performance': `
### Sprint Performance

Analytics dashboard for your sprint velocity and AI agent effectiveness.

#### Metrics
- **Completion rate** — Percentage of tasks completed vs total
- **AI success rate** — How often the AI pipeline succeeds without errors
- **Average cycle time** — From task creation to PR merge
- **Token efficiency** — Cost per successful task
- **PR merge rate** — How many AI-generated PRs get merged
  `,

  refinement: `
### Refinement

AI-powered sprint refinement tool that analyzes backlog items and suggests story points.

#### How It Works
1. Select your source (Azure DevOps or Jira)
2. Select project → team/board → sprint
3. Click **Load Items** — shows all unestimated items
4. Select items to analyze → Click **Run Refinement**
5. The AI analyzes each item and provides:
   - **Suggested story points** with confidence score
   - **Summary** of what the item involves
   - **Ambiguities** and **Questions** to clarify
   - **Ready for planning** indicator

#### Writeback
After reviewing suggestions, click **Write Back** to update story points directly in Azure DevOps or Jira.
  `,

  agents: `
### AI Agents

Configure the AI agents that power your pipeline.

#### Default Agent Roles
| Role | Description |
|------|-------------|
| **PM** | Analyzes requirements, gathers context, creates implementation plan |
| **Developer** | Generates production code based on the plan |
| **Reviewer** | Reviews code for quality, security, and best practices |
| **QA** | Tests and validates the generated code |
| **Finalizer** | Creates branches, commits, and opens pull requests |

#### Configuration Per Agent
- **Provider**: OpenAI or Gemini
- **Model**: gpt-5, gpt-4o, gemini-2.5-pro, etc.
- **Enabled/Disabled**: Toggle each agent on or off
- **Create PR**: Whether this agent run should create a PR

#### Custom Agent Models
Each agent can use a different model. For example:
- PM: gpt-4o-mini (fast, cheap for analysis)
- Developer: gpt-5 (best quality for code generation)
- Reviewer: gpt-4o (good balance for review)
  `,

  'prompt-studio': `
### Prompt Studio

Edit and manage the system prompts used by each AI agent. All prompts are stored in the database and can be modified at runtime without redeploying.

#### Features
- **Live editing** — Changes take effect immediately
- **Version history** — See when prompts were last modified
- **Per-agent prompts** — Each agent role has its own prompt template
- **Variable interpolation** — Use \`{task_title}\`, \`{task_description}\`, \`{code_context}\` in prompts
  `,

  flows: `
### Flow Builder

Visual automation builder for creating custom AI workflows (n8n-style).

#### Node Types
| Node | Description |
|------|-------------|
| **Trigger** | Flow entry point |
| **Agent** | LLM-powered analysis/generation (select model, provider, prompt) |
| **Azure DevOps** | Create branch, create PR, complete PR, abandon PR |
| **GitHub** | Create branch, create PR, merge PR |
| **HTTP** | REST API calls with auth (bearer, API key, basic) |
| **Condition** | Branch logic (eq, neq, contains, regex, etc.) |
| **Notify** | Webhook, Slack, or email notifications |
| **Azure Update** | Update work item state + add comment |

#### Node Communication
Nodes pass data via \`{{outputs.node_id.field}}\`. Each node's output is available to downstream nodes.

#### Creating a Flow
1. Go to **Dashboard → Flows** → Create New Flow
2. Add a **Trigger** node (every flow starts with one)
3. Connect **Agent** nodes for analysis and code generation
4. Add **Condition** nodes to branch logic (e.g., "if code review score > 80")
5. Add **GitHub/Azure** nodes to create branches and PRs
6. Optionally add **Notify** nodes for Slack/Teams/webhook notifications
7. Save and activate the flow

#### Example: Full PR Pipeline
\`\`\`
Trigger → Agent (PM) → Agent (Developer) → Agent (Reviewer)
  → Condition (review passed?)
    → Yes: GitHub (Create PR) → Notify (Slack)
    → No: Agent (Developer, retry) → Agent (Reviewer)
\`\`\`

#### Node Communication in Detail
Each node produces an output stored in \`context['outputs'][node_id]\`. Downstream nodes reference these using template syntax:

- \`{{outputs.node_1.plan}}\` — Get the plan from the PM agent
- \`{{outputs.node_3.code}}\` — Get generated code from the Developer agent
- \`{{outputs.node_5.review_score}}\` — Get review score from the Reviewer

Special context keys:
- \`context['product_review_output']\` — Analyzer/PM spec output
- \`context['plan_output']\` — Planner file-level change plan
- \`context['last_condition']\` — Last condition evaluation result (true/false)

#### Condition Node Operators
| Operator | Description | Example |
|----------|-------------|---------|
| eq | Equals | \`review_score eq 100\` |
| neq | Not equals | \`status neq failed\` |
| gt / lt | Greater/less than | \`confidence gt 80\` |
| contains | String contains | \`output contains "error"\` |
| regex | Regex match | \`branch regex "feature/.*"\` |
| empty | Is empty/null | \`pr_url empty\` |
  `,

  templates: `
### Templates

Reusable task and flow templates for common development patterns.

#### Usage
- Browse pre-built templates for common tasks (bug fix, feature, refactor)
- Create your own templates from successful task configurations
- Apply templates when creating new tasks to pre-fill description, context, and settings
  `,

  dora: `
### DORA Metrics

DevOps Research and Assessment (DORA) metrics dashboard.

#### Available Views
- **Overview** — High-level DORA summary
- **Project** — Per-project delivery metrics
- **Development** — Code velocity, commit frequency, PR throughput
- **Quality** — Code review time, defect density, test coverage
- **Bugs** — Bug tracking, resolution time, severity distribution
- **Team** — Per-developer performance and workload balance

#### Metrics Tracked
- **Deployment Frequency** — How often code is deployed
- **Lead Time for Changes** — Time from commit to production
- **Change Failure Rate** — Percentage of deployments causing failures
- **Mean Time to Recovery** — How quickly failures are resolved
  `,

  integrations: `
### Integrations Setup

Configure external services in **Dashboard → Integrations**.

#### AI Tab
- **OpenAI** — API key + base URL (required for code generation)
- **Gemini** — Google AI API key (optional fallback provider)
- **Playbook** — Organization-wide coding rules and conventions. The AI agents reference these rules when generating code.

#### Task Tab
- **GitHub** — Owner + Personal Access Token (PAT) with \`repo\` scope. Used for branch/PR creation.
- **Azure DevOps** — Organization URL + Project + PAT with Code (Read & Write) scope
- **Jira** — Base URL + Email + API token. Used for task import and sprint sync.

#### Notifications Tab
- **Slack** — Webhook URL (notifications) + Bot Token + Signing Secret (ChatOps)
- **Teams** — Webhook URL (notifications) + Bot App ID + Bot App Secret (ChatOps)
- **Telegram** — Bot Token (from @BotFather) + Chat ID

#### CLI Tab
- **CLI Bridge** — Status of Codex and Claude CLI agent connections
  `,

  'repo-mapping': `
### Repository Mapping

Repository mapping tells AGENA which codebase to work with for each task. Without a mapping, AGENA does not know where to create branches and PRs.

#### Setup
1. Go to **Dashboard → Mappings**
2. Click **Add Mapping**
3. Configure the following fields:

| Field | Description | Example |
|-------|-------------|---------|
| **Provider** | GitHub or Azure DevOps | GitHub |
| **Owner** | GitHub org/user or Azure project | \`aozyildirim\` |
| **Repository** | Target repository name | \`Agena\` |
| **Base Branch** | Branch to create PRs against | \`main\` |
| **Local Repo Path** | Absolute path on server (self-hosted only) | \`/home/user/repos/agena\` |
| **Playbook** | Optional repo-specific coding rules | \`Use TypeScript strict mode...\` |

#### How It Works
When a task is assigned to AI, AGENA:
1. Looks up the repository mapping attached to the task
2. Fetches the codebase via GitHub API (or reads local path for self-hosted)
3. PM agent analyzes the code structure, finds relevant files
4. Developer agent generates code following the repo's conventions and playbook
5. Finalizer agent creates a new branch, commits code, and opens a PR against the base branch

#### Local Repo Path (Self-Hosted)
If you are running AGENA on your own server and the repo is cloned locally:
- Set the **Local Repo Path** to the absolute path of the git clone
- The Worker container must have this path volume-mounted
- Local mode is faster because it avoids GitHub API rate limits
- The Worker acquires a lock per repo path to prevent concurrent modifications

#### Multiple Repositories
You can map multiple repositories to your organization. When creating a task:
- If you have one mapping, it is auto-selected
- If you have multiple, select which repo the task applies to
- Each mapping can have its own playbook (coding rules)

#### Playbook
The playbook is injected into every agent's context for this repo. Use it for:
- Coding conventions (\`Always use async/await, never callbacks\`)
- Architecture rules (\`All new endpoints must have input validation\`)
- Framework specifics (\`Use Pydantic v2 model_validator for complex validation\`)
- Testing requirements (\`Every service method must have a unit test\`)
  `,

  'team-management': `
### Team & Permissions

Manage your organization's team members and their access levels.

#### Roles
| Role | Permissions |
|------|-------------|
| **Owner** | Full access, billing, delete org |
| **Admin** | Manage team, integrations, settings |
| **Member** | Create tasks, view results, use agents |
| **Viewer** | Read-only access to tasks and dashboards |

#### Inviting Members
1. Go to **Dashboard → Team**
2. Click **Invite** → enter email address
3. Select the role to assign
4. The invitee receives an email with a signup/join link

#### Permissions
Fine-grained permissions available at **Dashboard → Permissions**:
- \`tasks:read\`, \`tasks:write\`, \`tasks:assign\`
- \`integrations:manage\`
- \`team:manage\`, \`roles:manage\`
- \`flows:manage\`, \`prompts:manage\`
  `,

  'profile-settings': `
### Profile & Preferences

Configure your personal workspace preferences at **Dashboard → Profile**.

#### Active Sprint Selection
- **Azure DevOps**: Select Project → Team → Sprint (active sprint auto-detected)
- **Jira**: Select Project → Board → Sprint (active sprint auto-detected)

#### Workspace Preferences
- **Email / Web Push / In-app notifications** — Toggle per channel
- **Daily summary email** — Get a daily digest of task activity
- **Auto-assign new tasks** — Automatically queue imported tasks for AI
- **Default create PR** — Whether AI tasks should create PRs by default
- **Preferred provider & model** — Default AI model for new tasks

#### Branch Naming Pattern
Choose from presets or define a custom pattern:
- \`feature/AB#{ext_id}-{title_slug}\` → \`feature/AB#61717-merchant-status\`
- \`feature/{ext_id}-{title_slug}\` → \`feature/61717-merchant-status\`
- \`bugfix/{ext_id}\` → \`bugfix/61717\`

#### Notification Matrix
Per-event control over which channels receive notifications (in-app, email, web push).
  `,

  chatops: `
### ChatOps — Teams / Slack / Telegram

Control AGENA directly from your chat platform.

#### Available Commands
| Command | Description |
|---------|-------------|
| \`help\` | Show available commands |
| \`fix <description>\` | Create task + assign to AI immediately |
| \`create <title>\` | Create task without auto-assign |
| \`status <task_id>\` | Get task status and details |
| \`queue\` | Show queue size and running tasks |
| \`cancel <task_id>\` | Cancel a queued task |
| \`recent [count]\` | List recent tasks (default: 5) |
| \`stats\` | Organization statistics and success rate |

#### Setup

**Telegram**
1. Message \`@BotFather\` on Telegram → \`/newbot\`
2. Copy the Bot Token
3. Dashboard → Integrations → Telegram → paste token → Save
4. Webhook is auto-registered

**Slack**
1. Create a Slack App at api.slack.com/apps
2. Enable Event Subscriptions → Request URL: \`https://api.agena.dev/webhooks/slack\`
3. Subscribe to: \`app_mention\`, \`message.im\`
4. Copy Bot Token + Signing Secret
5. Dashboard → Integrations → Slack → paste both → Save

**Teams**
1. Register a Bot in Azure Portal → Azure Bot Service
2. Enable Microsoft Teams channel
3. Set Messaging Endpoint to: \`https://api.agena.dev/webhooks/teams\`
4. Copy App ID + App Secret
5. Dashboard → Integrations → Teams → paste both → Save
  `,

  pipeline: `
### AI Agent Pipeline

AGENA uses a two-layer orchestration system:

#### CrewAI — Agent Roles
Each agent has a specific role, model, and system prompt:
- **PM Agent**: Analyzes the task, gathers codebase context, creates a detailed implementation plan
- **Developer Agent**: Generates production code following the plan and repo conventions
- **Reviewer Agent**: Reviews generated code for bugs, security issues, and best practices
- **Finalizer Agent**: Creates a git branch, commits code, and opens a pull request

#### LangGraph — Execution Pipeline
\`\`\`
fetch_context → analyze → generate_code → review_code → finalize
\`\`\`

Each node passes data to the next via a shared context. The pipeline supports:
- **Retry logic** — Failed stages can be retried automatically
- **Token budgets** — Per-task token limits to control cost
- **Model routing** — Automatic model selection based on task complexity
- **Memory** — Vector memory (Qdrant) for learning from past tasks
  `,

  services: `
### Service Architecture

AGENA is a monorepo with 6 pip-installable Python packages:

| Package | Description |
|---------|-------------|
| \`agena-core\` | Settings, database, auth, RBAC, JWT, security |
| \`agena-models\` | 25 SQLAlchemy ORM models + Pydantic schemas |
| \`agena-services\` | 31 business logic services + integrations |
| \`agena-agents\` | CrewAI + LangGraph pipeline + vector memory |
| \`agena-api\` | FastAPI routes, middleware, dependencies |
| \`agena-worker\` | Redis background task consumer |

#### Tech Stack
- **Backend**: Python 3.11, FastAPI, SQLAlchemy 2.0 (async), MySQL 8, Redis 7
- **AI**: LangGraph, CrewAI, OpenAI SDK (GPT-5, Gemini fallback)
- **Frontend**: Next.js 14, React 18, TypeScript, 7 languages
- **Auth**: JWT, bcrypt, RBAC (owner/admin/member/viewer)
- **Deploy**: Docker Compose, Nginx (blue/green frontend)
  `,

  'selfhost-deploy': `
### Self-Hosted Deployment

#### Docker Compose Services
\`\`\`yaml
services:
  backend:    # FastAPI API server (port 8010)
  worker:     # Redis task consumer
  frontend_blue:   # Next.js (port 3011)
  frontend_green:  # Next.js (port 3012)
  mysql:      # MySQL 8 (port 3307)
  redis:      # Redis 7 (port 6380)
  qdrant:     # Vector memory (port 6333, optional)
\`\`\`

#### Environment Variables
All configuration is via \`.env\`. Key variables:

\`\`\`bash
# Required
JWT_SECRET_KEY=your-random-secret
MYSQL_PASSWORD=secure-password

# AI Provider (at least one required)
OPENAI_API_KEY=sk-...

# Optional
QDRANT_ENABLED=false
MAX_WORKERS=8
\`\`\`

Integrations (GitHub, Azure, Jira, Slack, Teams, Telegram) are configured per-organization via the dashboard — no env vars needed.

#### Production Checklist
- [ ] Set strong JWT_SECRET_KEY and database passwords
- [ ] Configure SSL certificates for your domain
- [ ] Set up Nginx reverse proxy (see repo for example config)
- [ ] Run database migrations: \`docker compose exec backend alembic upgrade head\`
- [ ] Create your first account at \`yourdomain.com/signup\`
- [ ] Configure integrations via the dashboard
  `,

  'admin-panel': `
### Platform Admin Panel

The admin panel is the super-admin interface for managing the entire AGENA platform across all organizations. It is accessible at **Dashboard → Admin**.

#### Who Can Access
Only users with \`is_platform_admin = true\` in the database have access. Regular org owners/admins cannot see this panel. When a platform admin logs in, they are redirected to \`/dashboard/admin\` and see a dedicated admin sidebar instead of the regular org-level navigation.

#### Overview Tab (Default)
- **Total Organizations** — Number of registered orgs on the platform
- **Total Users** — All users across all orgs
- **Total Tasks** — All tasks ever created
- **Total PRs** — All pull requests created by AI agents
- System-wide health and activity overview

#### Organizations Tab
- Full list of all registered organizations
- Per-org stats: member count, task count, creation date, last activity
- Useful for monitoring tenant health and identifying inactive accounts

#### Users Tab
- All registered users across all organizations
- Shows: email, full name, role, organization, last login timestamp
- Helps track user growth and identify support issues

#### Contact Submissions Tab
- Messages from the public contact form at \`/contact\`
- Shows: name, email, message, submission date

#### Newsletter Tab
- Email addresses from the newsletter signup form
- Export-ready for email marketing tools

#### Platform Admin vs Org Owner
| Capability | Platform Admin | Org Owner |
|-----------|---------------|-----------|
| See all organizations | ✅ | ❌ (own org only) |
| See all users | ✅ | ❌ (own team only) |
| Access admin panel | ✅ | ❌ |
| Manage own org settings | ✅ | ✅ |
| Create tasks | ✅ | ✅ |
| Billing management | ❌ (platform-level) | ✅ (own org) |
  `,

  'admin-orgs': `
### Managing Organizations

#### Viewing Organizations
Navigate to **Admin → Organizations** tab to see all registered organizations.

Each org card shows:
- **Organization name** and ID
- **Member count** — How many users belong to this org
- **Task count** — Total tasks created by this org
- **Created date** — When the org was registered
- **Owner** — The org owner's email

#### Multi-Tenancy
AGENA is fully multi-tenant. Each organization is completely isolated:
- **Separate data** — Tasks, flows, agents, integrations are org-scoped
- **Separate billing** — Each org has its own subscription plan
- **Separate integrations** — Each org connects their own GitHub, Jira, Slack, etc.
- **No cross-org visibility** — Users in Org A cannot see anything from Org B

#### Common Admin Tasks
- **Investigate issues** — If a user reports a problem, find their org and check task logs
- **Monitor growth** — Track new org signups and active tenant count
- **Identify abuse** — Spot orgs with unusually high task counts or API usage
  `,

  'admin-users': `
### Managing Users

#### Viewing Users
Navigate to **Admin → Users** tab to see all registered users across the entire platform.

Each user entry shows:
- **Full name** and email address
- **Organization** they belong to
- **Role** within their organization (owner, admin, member, viewer)
- **Platform admin flag** — Whether they have platform admin access
- **Last login** — When they last authenticated

#### User Lifecycle
1. User signs up at \`/signup\` → new org is created automatically
2. OR user receives an invite link → joins an existing org with assigned role
3. User configures their profile and preferences
4. If user needs platform admin access, set \`is_platform_admin=true\` in the database

#### Contact Submissions
Messages sent via the public \`/contact\` page are visible in a separate tab. These include:
- Sender name and email
- Message content
- Submission timestamp

#### Newsletter Subscribers
Email addresses collected from newsletter signups on the landing page.
  `,

  'auth-api': `
### Authentication API

\`\`\`bash
# Sign up
POST /auth/signup
{"email": "...", "password": "...", "full_name": "..."}

# Login
POST /auth/login
{"email": "...", "password": "..."}
# Returns: {"access_token": "eyJ...", "token_type": "bearer"}

# Get current user
GET /auth/me
Authorization: Bearer <token>
\`\`\`

All subsequent API calls require the \`Authorization: Bearer <token>\` header.
  `,

  'tasks-api': `
### Tasks API

\`\`\`bash
# Create task
POST /tasks
{"title": "Fix login bug", "description": "..."}

# List tasks
GET /tasks

# Get task detail
GET /tasks/{id}

# Assign to AI
POST /tasks/{id}/assign
{"create_pr": true, "mode": "flow"}

# Cancel task
POST /tasks/{id}/cancel

# Import from Azure DevOps
POST /tasks/import/azure
{"project": "MyProject", "team": "MyTeam", "sprint_path": "..."}

# Import from Jira
POST /tasks/import/jira
{"project_key": "PROJ", "board_id": "1", "sprint_id": "2"}
\`\`\`
  `,

  'flows-api': `
### Flows API

\`\`\`bash
# List flows
GET /flows

# Create flow
POST /flows
{"name": "My Pipeline", "nodes": [...], "edges": [...]}

# Run flow
POST /flows/{id}/run
{"task_id": 123}

# Get flow detail
GET /flows/{id}
\`\`\`

Full OpenAPI docs available at \`https://api.agena.dev/docs\` (Swagger UI).
  `,

  'integrations-api': `
### Integrations API

\`\`\`bash
# List all integrations
GET /integrations

# Configure a provider
PUT /integrations/{provider}
{"base_url": "...", "secret": "...", "project": "...", "username": "..."}

# Supported providers:
# jira, azure, github, openai, gemini, slack, teams, telegram, playbook

# Delete integration
DELETE /integrations/{provider}

# List GitHub repos (after configuring GitHub)
GET /integrations/github/repos

# List GitHub branches
GET /integrations/github/branches?owner=...&repo=...
\`\`\`
  `,
  'sdk-install': `
### Installation

Install the AGENA SDK via npm:

\`\`\`bash
npm install @agena/sdk
\`\`\`

#### Requirements
- Node.js 18+ or any environment with \\\`fetch\\\` support
- An AGENA account with an API token
  `,
  'sdk-quickstart': `
### Quick Start

\`\`\`typescript
import { AgenaClient } from '@agena/sdk';

const agena = new AgenaClient({ apiKey: 'your-token' });

const task = await agena.tasks.create({
  title: 'Add dark mode',
  description: 'Implement dark/light theme toggle',
});

console.log(task.pr_url);
\`\`\`
  `,
  'sdk-reference': `
### API Reference

| Method | Description |
|--------|-------------|
| \\\`agena.tasks.create(params)\\\` | Create a new AI task |
| \\\`agena.tasks.get(id)\\\` | Get task by ID |
| \\\`agena.tasks.list()\\\` | List tasks |
| \\\`agena.flows.run({ flow_id })\\\` | Execute a flow |
| \\\`agena.agents.liveStatus(taskId)\\\` | Get live agent status |
| \\\`agena.integrations.list()\\\` | List integrations |

See full docs at [agena.dev/sdk](/sdk).
  `,
};

function SidebarItem({ id, title, active, onClick }: { id: string; title: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        display: 'block', width: '100%', textAlign: 'left', padding: '6px 12px', borderRadius: 6, border: 'none',
        background: active ? 'rgba(13,148,136,0.12)' : 'transparent',
        color: active ? '#5eead4' : 'var(--ink-50)', fontSize: 13, cursor: 'pointer', fontWeight: active ? 600 : 400,
      }}
    >
      {title}
    </button>
  );
}

function renderMarkdown(md: string): string {
  return md
    .replace(/^### (.+)$/gm, '<h3 style="color:var(--ink-90);font-size:17px;font-weight:700;margin:28px 0 10px">$1</h3>')
    .replace(/^#### (.+)$/gm, '<h4 style="color:var(--ink-80);font-size:15px;font-weight:700;margin:20px 0 8px">$1</h4>')
    .replace(/\*\*(.+?)\*\*/g, '<strong style="color:var(--ink-90)">$1</strong>')
    .replace(/`([^`\n]+)`/g, '<code style="background:rgba(13,148,136,0.1);color:var(--accent);padding:2px 6px;border-radius:4px;font-size:12px">$1</code>')
    .replace(/```(\w*)\n([\s\S]*?)```/g, (_m, _lang, code) =>
      `<pre style="background:var(--terminal-bg, #0d1117);border:1px solid var(--panel-border-2);border-radius:10px;padding:16px;overflow-x:auto;font-size:12px;color:var(--ink-65);margin:14px 0;line-height:1.6"><code>${code.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</code></pre>`
    )
    .replace(/^\|(.+)\|$/gm, (match) => {
      const cells = match.split('|').filter(Boolean).map(c => c.trim());
      if (cells.every(c => /^[-:]+$/.test(c))) return '';
      return `<tr>${cells.map(c => `<td style="padding:8px 12px;border:1px solid var(--panel-border-2);font-size:13px">${c}</td>`).join('')}</tr>`;
    })
    .replace(/((<tr>.*<\/tr>\s*)+)/g, '<table style="width:100%;border-collapse:collapse;margin:14px 0">$1</table>')
    .replace(/^- \[x\] (.+)$/gm, '<li style="margin:4px 0;color:var(--ink-58);font-size:13px;list-style:none">✅ $1</li>')
    .replace(/^- \[ \] (.+)$/gm, '<li style="margin:4px 0;color:var(--ink-58);font-size:13px;list-style:none">⬜ $1</li>')
    .replace(/^- (.+)$/gm, '<li style="margin:4px 0;color:var(--ink-58);font-size:13px">$1</li>')
    .replace(/((<li.*<\/li>\s*)+)/g, '<ul style="margin:8px 0;padding-left:20px">$1</ul>')
    .replace(/^\d+\. (.+)$/gm, '<li style="margin:4px 0;color:var(--ink-58);font-size:13px">$1</li>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" style="color:var(--accent);text-decoration:underline" target="_blank" rel="noopener">$1</a>')
    .replace(/^(?!<[a-z])((?!\s*$).+)$/gm, '<p style="margin:8px 0;color:var(--ink-58);font-size:14px;line-height:1.7">$1</p>')
    .replace(/<p[^>]*><\/p>/g, '');
}

export default function DocsPage() {
  const { t, lang } = useLocale();

  // Resolve i18n titles from sectionsDef
  const sections = useMemo(() => sectionsDef.map(s => ({
    ...s,
    title: t(s.titleKey as any),
    children: s.children.map(c => ({ ...c, title: t(c.titleKey as any) })),
  })), [t]);

  const [activeId, setActiveId] = useState('overview');
  const [docsContent, setDocsContent] = useState<Record<string, string>>(contentEN);

  useEffect(() => {
    loadDocsLang(lang).then(setDocsContent);
  }, [lang]);

  const [searchQuery, setSearchQuery] = useState('');

  const searchResults = useMemo(() => {
    if (!searchQuery.trim()) return null;
    const q = searchQuery.toLowerCase();
    const results: { id: string; title: string; snippet: string }[] = [];
    for (const [id, text] of Object.entries(docsContent)) {
      const child = sections.flatMap(s => s.children).find(c => c.id === id);
      if (!child) continue;
      if (child.title.toLowerCase().includes(q) || text.toLowerCase().includes(q)) {
        const idx = text.toLowerCase().indexOf(q);
        const snippet = idx >= 0 ? text.slice(Math.max(0, idx - 40), idx + 80).replace(/[#*`|]/g, '').trim() : '';
        results.push({ id, title: child.title, snippet });
      }
    }
    return results;
  }, [searchQuery, sections, docsContent]);

  const activeContent = docsContent[activeId] || content[activeId] || '';
  const activeSection = sections.flatMap(s => s.children).find(c => c.id === activeId);
  const parentSection = sections.find(s => s.children.some(c => c.id === activeId));

  return (
    <div className='docs-layout' style={{ display: 'flex', minHeight: '100vh', maxWidth: 1200, margin: '0 auto', padding: '0 16px', paddingTop: 72 }}>
      {/* Mobile sidebar toggle */}
      <div className='docs-sidebar-mobile' style={{ display: 'none', padding: '12px 0', overflowX: 'auto', gap: 6, flexWrap: 'nowrap' }}>
        {sections.map((section) =>
          section.children.map((child) => (
            <button
              key={child.id}
              onClick={() => { setActiveId(child.id); setSearchQuery(''); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
              style={{
                padding: '6px 12px', borderRadius: 8, fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap',
                border: activeId === child.id ? '1px solid rgba(13,148,136,0.5)' : '1px solid var(--panel-border)',
                background: activeId === child.id ? 'rgba(13,148,136,0.15)' : 'transparent',
                color: activeId === child.id ? '#5eead4' : 'var(--ink-50)', cursor: 'pointer',
              }}
            >
              {child.title}
            </button>
          ))
        )}
      </div>
      {/* Sidebar */}
      <nav className='docs-sidebar' style={{ width: 240, flexShrink: 0, padding: '24px 0', borderRight: '1px solid var(--panel-border)', position: 'sticky', top: 72, height: 'calc(100vh - 72px)', overflowY: 'auto' }}>
        {/* Search */}
        <div style={{ padding: '0 12px 16px', position: 'relative' }}>
          <input
            type='search'
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t('docs.searchPlaceholder')}
            style={{
              width: '100%',
              padding: '8px 12px 8px 32px',
              borderRadius: 8,
              border: '1px solid var(--panel-border-2)',
              background: 'var(--panel)',
              color: 'var(--ink-90)',
              fontSize: 13,
              outline: 'none',
              fontFamily: 'inherit',
              backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='14' height='14' viewBox='0 0 24 24' fill='none' stroke='rgba(255,255,255,0.3)' stroke-width='2' stroke-linecap='round'%3E%3Ccircle cx='11' cy='11' r='8'/%3E%3Cline x1='21' y1='21' x2='16.65' y2='16.65'/%3E%3C/svg%3E")`,
              backgroundRepeat: 'no-repeat',
              backgroundPosition: '10px center',
            }}
          />
          {searchResults && searchResults.length > 0 && (
            <div style={{
              position: 'absolute',
              top: '100%',
              left: 12,
              right: 12,
              background: 'var(--surface)',
              border: '1px solid var(--panel-border-2)',
              borderRadius: 10,
              padding: 8,
              zIndex: 10,
              maxHeight: 300,
              overflowY: 'auto',
              boxShadow: '0 8px 24px rgba(0,0,0,0.3)',
            }}>
              {searchResults.map((r) => (
                <button
                  key={r.id}
                  onClick={() => { setActiveId(r.id); setSearchQuery(''); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
                  style={{
                    display: 'block',
                    width: '100%',
                    textAlign: 'left',
                    padding: '8px 10px',
                    borderRadius: 6,
                    border: 'none',
                    background: 'transparent',
                    cursor: 'pointer',
                    fontFamily: 'inherit',
                  }}
                >
                  <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink-90)' }}>{r.title}</div>
                  {r.snippet && <div style={{ fontSize: 11, color: 'var(--ink-35)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>...{r.snippet}...</div>}
                </button>
              ))}
            </div>
          )}
          {searchResults && searchResults.length === 0 && searchQuery.trim() && (
            <div style={{
              position: 'absolute',
              top: '100%',
              left: 12,
              right: 12,
              background: 'var(--surface)',
              border: '1px solid var(--panel-border-2)',
              borderRadius: 10,
              padding: '16px',
              zIndex: 10,
              textAlign: 'center',
              boxShadow: '0 8px 24px rgba(0,0,0,0.3)',
            }}>
              <p style={{ color: 'var(--ink-35)', fontSize: 13 }}>{t('docs.noResults')}</p>
            </div>
          )}
        </div>
        {sections.map((section) => (
          <div key={section.id} style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--ink-35)', textTransform: 'uppercase', letterSpacing: 1, padding: '4px 12px', marginBottom: 4 }}>
              {section.icon} {section.title}
            </div>
            {section.children.map((child) => (
              <SidebarItem
                key={child.id}
                id={child.id}
                title={child.title}
                active={activeId === child.id}
                onClick={() => { setActiveId(child.id); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
              />
            ))}
          </div>
        ))}
      </nav>

      {/* Content */}
      <main className='docs-content' style={{ flex: 1, padding: '32px 0 64px 40px', minWidth: 0 }}>
        <div style={{ marginBottom: 8, fontSize: 12, color: 'var(--ink-30)' }}>
          {parentSection && <>{parentSection.icon} {parentSection.title} → </>}
        </div>
        <h1 style={{ fontSize: 28, fontWeight: 800, color: 'var(--ink-90)', margin: '0 0 24px' }}>
          {activeSection?.title || t('docs.title')}
        </h1>
        <div
          style={{ maxWidth: 720 }}
          dangerouslySetInnerHTML={{ __html: renderMarkdown(activeContent) }}
        />

        {/* Prev / Next navigation */}
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 48, paddingTop: 24, borderTop: '1px solid var(--panel-border)' }}>
          {(() => {
            const allChildren = sections.flatMap(s => s.children);
            const idx = allChildren.findIndex(c => c.id === activeId);
            const prev = idx > 0 ? allChildren[idx - 1] : null;
            const next = idx < allChildren.length - 1 ? allChildren[idx + 1] : null;
            return (
              <>
                {prev ? (
                  <button onClick={() => { setActiveId(prev.id); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
                    style={{ padding: '10px 16px', borderRadius: 10, border: '1px solid var(--panel-border-2)', background: 'var(--panel)', color: 'var(--ink-65)', fontSize: 13, cursor: 'pointer' }}>
                    ← {prev.title}
                  </button>
                ) : <div />}
                {next ? (
                  <button onClick={() => { setActiveId(next.id); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
                    style={{ padding: '10px 16px', borderRadius: 10, border: '1px solid rgba(13,148,136,0.3)', background: 'rgba(13,148,136,0.08)', color: '#5eead4', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
                    {next.title} →
                  </button>
                ) : <div />}
              </>
            );
          })()}
        </div>
      </main>
    </div>
  );
}

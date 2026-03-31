import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Documentation – AGENA Agentic AI Platform',
  description:
    'AGENA documentation — setup guide, API reference, agent configuration, integrations, and deployment. Get started with the agentic AI platform for autonomous code generation.',
  openGraph: {
    title: 'Documentation – AGENA Agentic AI Platform',
    description: 'Complete documentation for the AGENA agentic AI platform.',
  },
};

const sections = [
  {
    id: 'quickstart',
    icon: '🚀',
    title: 'Quick Start',
    description: 'Get AGENA running in under 5 minutes with Docker Compose.',
    content: `
### Prerequisites
- Docker & Docker Compose
- GitHub account (for PR automation)
- OpenAI API key

### Setup

\`\`\`bash
# Clone the repository
git clone https://github.com/aozyildirim/Agena.git
cd Agena

# Copy environment configuration
cp .env.example .env

# Configure your API keys in .env
# OPENAI_API_KEY=sk-...
# GITHUB_TOKEN=ghp_...

# Start all services
docker compose up --build
\`\`\`

### Access Points
- **Dashboard**: http://localhost:3010
- **API**: http://localhost:8010
- **API Docs (Swagger)**: http://localhost:8010/docs
    `,
  },
  {
    id: 'architecture',
    icon: '🏗️',
    title: 'Architecture',
    description: 'How AGENA\'s agentic AI pipeline works under the hood.',
    content: `
### System Overview

AGENA uses a multi-agent architecture with two orchestration layers:

**CrewAI** — Defines specialized AI agent roles:
- **PM Agent**: Analyzes tasks, gathers context, plans implementation
- **Developer Agent**: Generates production code
- **Reviewer Agent**: Reviews code quality and security
- **Finalizer Agent**: Creates branches, commits, and PRs

**LangGraph** — Manages the execution pipeline:

\`\`\`
fetch_context → analyze → generate_code → review_code → finalize
\`\`\`

### Services

| Service | Port | Description |
|---------|------|-------------|
| Backend (FastAPI) | 8010 | API server |
| Worker | — | Redis consumer, executes AI tasks |
| Frontend (Next.js) | 3010 | Dashboard UI |
| MySQL | 3307 | Primary database |
| Redis | 6379 | Task queue |
| Qdrant | 6333 | Vector memory (optional) |

### Request Flow

1. User creates a task via UI or API
2. Task is queued in Redis
3. Worker picks up the task
4. OrchestrationService runs the LangGraph pipeline
5. CrewAI agents execute each stage
6. PR is created on GitHub/Azure DevOps
7. User receives notification via Slack/Teams
    `,
  },
  {
    id: 'api',
    icon: '📡',
    title: 'API Reference',
    description: 'REST API endpoints for task management, agents, and integrations.',
    content: `
### Authentication

All API requests require a JWT token:

\`\`\`bash
# Login
curl -X POST http://localhost:8010/auth/login \\
  -H "Content-Type: application/json" \\
  -d '{"email": "user@example.com", "password": "..."}'

# Use token in subsequent requests
curl http://localhost:8010/tasks \\
  -H "Authorization: Bearer <token>"
\`\`\`

### Core Endpoints

**Tasks**
- \`POST /tasks\` — Create a new task
- \`GET /tasks\` — List tasks for your organization
- \`GET /tasks/{id}\` — Get task details with timeline
- \`POST /tasks/{id}/cancel\` — Cancel a running task

**Agents**
- \`GET /agents\` — List configured agents
- \`POST /agents\` — Create custom agent configuration

**Flows**
- \`GET /flows\` — List automation flows
- \`POST /flows\` — Create a new flow

**Integrations**
- \`POST /integrations/github\` — Configure GitHub integration
- \`POST /integrations/azure\` — Configure Azure DevOps
- \`POST /integrations/jira\` — Configure Jira sync

**Memory**
- \`GET /memory/status\` — Vector memory status
- \`GET /memory/schema\` — What is stored and how

Full OpenAPI specification available at \`/docs\` when running the backend.
    `,
  },
  {
    id: 'integrations',
    icon: '🔌',
    title: 'Integrations',
    description: 'Connect AGENA with GitHub, Azure DevOps, Jira, Slack, and Teams.',
    content: `
### GitHub

AGENA automatically creates branches, commits, and pull requests on your GitHub repositories.

**Setup:**
1. Generate a GitHub Personal Access Token (PAT) with \`repo\` scope
2. Add it in Dashboard → Integrations → GitHub
3. Map your repositories to AGENA projects

**Features:**
- Automatic branch creation with configurable naming
- Clean commit messages with task references
- PR descriptions with full task context
- Support for multiple repositories per organization

### Azure DevOps

Full PR automation for Azure DevOps repositories.

**Setup:**
1. Generate an Azure DevOps PAT with Code (Read & Write) permissions
2. Configure in Dashboard → Integrations → Azure DevOps
3. Map your projects and repositories

### Jira

Import tasks from Jira and keep statuses synchronized.

**Setup:**
1. Generate a Jira API token
2. Configure in Dashboard → Integrations → Jira
3. Select which projects to sync

### Slack & Teams

Receive real-time notifications and trigger tasks from chat.

- Task completion notifications with PR links
- Agent status updates
- ChatOps commands for quick task creation
    `,
  },
  {
    id: 'configuration',
    icon: '⚙️',
    title: 'Configuration',
    description: 'Environment variables, model selection, and advanced settings.',
    content: `
### Key Environment Variables

\`\`\`bash
# LLM Configuration
OPENAI_API_KEY=sk-...           # Primary LLM provider
GEMINI_API_KEY=...              # Fallback LLM provider
LLM_MODEL=gpt-4o               # Default model for code generation
LLM_MINI_MODEL=gpt-4o-mini     # Model for lighter tasks

# Database
DATABASE_URL=mysql+asyncmy://user:pass@mysql:3306/agena
REDIS_URL=redis://redis:6379/0

# Integrations
GITHUB_TOKEN=ghp_...            # GitHub access
AZURE_DEVOPS_PAT=...            # Azure DevOps access
JIRA_API_TOKEN=...              # Jira access

# Vector Memory (Optional)
QDRANT_ENABLED=true
QDRANT_HOST=qdrant
QDRANT_PORT=6333

# Worker
MAX_WORKERS=3                   # Concurrent task limit

# Auth
JWT_SECRET=your-secret-key
JWT_ALGORITHM=HS256
\`\`\`

### Model Routing

AGENA automatically selects the best model based on task complexity:
- **Complex tasks** (architecture, multi-file changes): gpt-4o / gemini-1.5-pro
- **Simple tasks** (bug fixes, small features): gpt-4o-mini
- **Review tasks**: Optimized for critical analysis
    `,
  },
];

function simpleMarkdownToHtml(md: string): string {
  return md
    .replace(/^### (.+)$/gm, '<h3 style="color:var(--ink-90);font-size:17px;font-weight:700;margin:28px 0 10px">$1</h3>')
    .replace(/\*\*(.+?)\*\*/g, '<strong style="color:var(--ink-90)">$1</strong>')
    .replace(/`([^`\n]+)`/g, '<code style="background:rgba(13,148,136,0.1);color:var(--accent);padding:2px 6px;border-radius:4px;font-size:13px">$1</code>')
    .replace(/```(\w*)\n([\s\S]*?)```/g, (_m, _lang, code) =>
      `<pre style="background:var(--terminal-bg);border:1px solid var(--panel-border-2);border-radius:10px;padding:16px;overflow-x:auto;font-size:13px;color:var(--ink-65);margin:16px 0;line-height:1.6"><code>${code.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</code></pre>`
    )
    .replace(/^\|(.+)\|$/gm, (match) => {
      const cells = match.split('|').filter(Boolean).map(c => c.trim());
      if (cells.every(c => /^[-:]+$/.test(c))) return '';
      return `<tr>${cells.map(c => `<td style="padding:8px 12px;border:1px solid var(--panel-border-2);font-size:13px">${c}</td>`).join('')}</tr>`;
    })
    .replace(/((<tr>.*<\/tr>\s*)+)/g, '<table style="width:100%;border-collapse:collapse;margin:16px 0">$1</table>')
    .replace(/^- (.+)$/gm, '<li style="margin:4px 0;color:var(--ink-58);font-size:14px">$1</li>')
    .replace(/((<li.*<\/li>\s*)+)/g, '<ul style="margin:10px 0;padding-left:20px">$1</ul>')
    .replace(/^\d+\. (.+)$/gm, '<li style="margin:4px 0;color:var(--ink-58);font-size:14px">$1</li>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" style="color:var(--accent);text-decoration:underline">$1</a>')
    .replace(/^(?!<[a-z])((?!\s*$).+)$/gm, '<p style="margin:10px 0;color:var(--ink-58);font-size:14px;line-height:1.7">$1</p>')
    .replace(/<p style="margin:10px 0;color:var\(--ink-58\);font-size:14px;line-height:1.7"><\/p>/g, '');
}

export default function DocsPage() {
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'TechArticle',
    name: 'AGENA Documentation',
    description: 'Complete documentation for the AGENA agentic AI platform.',
    url: 'https://agena.dev/docs',
    publisher: { '@type': 'Organization', name: 'AGENA', url: 'https://agena.dev' },
    breadcrumb: {
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Home', item: 'https://agena.dev' },
        { '@type': 'ListItem', position: 2, name: 'Documentation', item: 'https://agena.dev/docs' },
      ],
    },
  };

  return (
    <>
      <script type='application/ld+json' dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />

      <div className='container' style={{ maxWidth: 860, padding: '80px 24px' }}>
        <div style={{ marginBottom: 48 }}>
          <div className='section-label'>Documentation</div>
          <h1 style={{ fontSize: 'clamp(32px, 4vw, 48px)', fontWeight: 800, color: 'var(--ink-90)', margin: '8px 0 16px' }}>
            AGENA Documentation
          </h1>
          <p style={{ color: 'var(--ink-45)', fontSize: 16, lineHeight: 1.7 }}>
            Everything you need to set up and use the agentic AI platform for autonomous code generation.
          </p>
        </div>

        {/* Quick nav */}
        <nav style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 48 }}>
          {sections.map((s) => (
            <a
              key={s.id}
              href={`#${s.id}`}
              style={{
                padding: '8px 16px',
                borderRadius: 8,
                border: '1px solid var(--panel-border-2)',
                background: 'var(--panel)',
                color: 'var(--ink-65)',
                fontSize: 13,
                fontWeight: 600,
                textDecoration: 'none',
              }}
            >
              {s.icon} {s.title}
            </a>
          ))}
        </nav>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 48 }}>
          {sections.map((section) => (
            <section key={section.id} id={section.id} style={{ scrollMarginTop: 80 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
                <span style={{ fontSize: 24 }}>{section.icon}</span>
                <div>
                  <h2 style={{ fontSize: 24, fontWeight: 700, color: 'var(--ink-90)', margin: 0 }}>{section.title}</h2>
                  <p style={{ color: 'var(--ink-35)', fontSize: 13, margin: '2px 0 0' }}>{section.description}</p>
                </div>
              </div>
              <div
                style={{ paddingLeft: 4 }}
                dangerouslySetInnerHTML={{ __html: simpleMarkdownToHtml(section.content) }}
              />
            </section>
          ))}
        </div>

        <div style={{ marginTop: 64, padding: '32px', borderRadius: 16, border: '1px solid var(--panel-border-2)', background: 'var(--panel)', textAlign: 'center' }}>
          <h3 style={{ color: 'var(--ink-90)', fontSize: 20, fontWeight: 700, marginBottom: 12 }}>
            Need help?
          </h3>
          <p style={{ color: 'var(--ink-45)', marginBottom: 20, fontSize: 14 }}>
            Check our <Link href='/blog' style={{ color: 'var(--accent)' }}>blog</Link> for tutorials or open an issue on{' '}
            <a href='https://github.com/aozyildirim/Agena/issues' target='_blank' rel='noopener noreferrer' style={{ color: 'var(--accent)' }}>GitHub</a>.
          </p>
          <Link href='/signup' className='button button-primary' style={{ padding: '12px 28px', fontSize: 15 }}>
            Start Free →
          </Link>
        </div>
      </div>
    </>
  );
}

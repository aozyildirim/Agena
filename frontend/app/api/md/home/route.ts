const SITE = 'https://agena.dev';

const md = `# AGENA — Agentic AI Platform

> Autonomous AI agents that write code, review pull requests, and ship features. AGENA turns your backlog into production-ready PRs in minutes.

- **Site:** ${SITE}
- **Status:** ${SITE}/status
- **Docs:** ${SITE}/docs
- **API Docs:** ${SITE}/api-docs
- **Source:** https://github.com/aozyildirim/Agena
- **License:** MIT

## What AGENA Does

AGENA orchestrates a multi-agent pipeline (PM → Developer → Reviewer → Finalizer) to:

1. Analyze a task description from your backlog (Jira, Azure DevOps, GitHub, Sentry, New Relic, or manual entry).
2. Generate production-grade code that matches your repo's conventions.
3. Review the diff for quality, security, and lint compliance.
4. Open a pull request on GitHub or Azure DevOps.

## Key Features

- Autonomous code generation with CrewAI + LangGraph
- Multi-repo orchestration (one task → many PRs in parallel)
- Task dependencies with cycle detection and auto-unblock
- Visual flow builder with 10+ node types (Agent, Condition, HTTP, GitHub, Azure DevOps, New Relic, Notify, …)
- DORA metrics dashboard
- ChatOps via Slack, Microsoft Teams, Telegram
- Sentry & New Relic auto-import → AI fix → PR → auto-resolve
- Vector memory with Qdrant
- 7-language UI (tr, en, es, de, zh, it, ja)
- Multi-tenant SaaS with RBAC (owner/admin/member/viewer)

## Pricing

- **Free:** 5 tasks per month, community support.
- **Pro:** $49 / month, unlimited tasks, priority workers, team invites, Stripe or Iyzico billing.

## Agent Discovery Endpoints

- API catalog: ${SITE}/.well-known/api-catalog
- OAuth protected resource: ${SITE}/.well-known/oauth-protected-resource
- OAuth authorization server: ${SITE}/.well-known/oauth-authorization-server
- OpenID Connect: ${SITE}/.well-known/openid-configuration
- MCP server card: ${SITE}/.well-known/mcp/server-card.json
- Agent skills index: ${SITE}/.well-known/agent-skills/index.json
- ACP discovery: ${SITE}/.well-known/acp.json
- UCP profile: ${SITE}/.well-known/ucp

## Compare

- vs GitHub Copilot — ${SITE}/vs/copilot
- vs Cursor — ${SITE}/vs/cursor
- vs Devin — ${SITE}/vs/devin
- vs Codex — ${SITE}/vs/codex

## Get Started

1. Sign up — ${SITE}/signup
2. Connect a GitHub or Azure DevOps repository.
3. Create a task or import from Jira / Sentry / New Relic.
4. Watch AGENA generate, review, and open the PR.
`;

export async function GET() {
  return new Response(md, {
    headers: {
      'Content-Type': 'text/markdown; charset=utf-8',
      'X-Markdown-Tokens': String(md.length),
      'Cache-Control': 'public, max-age=600, s-maxage=600',
      'Vary': 'Accept',
    },
  });
}

const SITE = 'https://agena.dev';

const md = `# AGENA Documentation

Full HTML version: ${SITE}/docs

## Sections

- **Getting Started** — Sign up, connect a repo, create your first task.
- **Integrations** — GitHub, Azure DevOps, Jira, Sentry, New Relic, Slack, Teams, Telegram.
- **Tasks & Pipeline** — Task lifecycle, multi-repo orchestration, task dependencies.
- **Flow Studio** — Visual automation: Agent, Condition, HTTP, GitHub, Azure, NR, Notify nodes.
- **Prompt Studio** — Edit DB-backed system prompts at runtime.
- **DORA Metrics** — Deployment frequency, lead time, change failure rate, MTTR.
- **API Reference** — REST API for tasks, agents, flows, integrations.
- **SDK** — TypeScript client at npm \`@agena/sdk\`.

## API

- Base URL: https://api.agena.dev
- OpenAPI: https://api.agena.dev/openapi.json
- Interactive docs: https://api.agena.dev/docs

## Self-Hosting

AGENA is MIT-licensed. Source: https://github.com/aozyildirim/Agena

\`\`\`bash
git clone https://github.com/aozyildirim/Agena
cd Agena
./start.sh
\`\`\`
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

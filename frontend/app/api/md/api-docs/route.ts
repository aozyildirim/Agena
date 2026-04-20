const md = `# AGENA API

- Base URL: https://api.agena.dev
- OpenAPI spec: https://api.agena.dev/openapi.json
- Interactive Swagger UI: https://api.agena.dev/docs
- Health: https://api.agena.dev/health

## Authentication

\`Authorization: Bearer <jwt>\`

Obtain a JWT via \`POST /auth/login\` with email + password, or use an organization API key (header \`X-API-Key\`).

## Core Resources

- **Tasks** — \`/tasks\` CRUD, \`/tasks/{id}/assign\` to dispatch to AI, \`/tasks/{id}/dependencies\`
- **Flows** — \`/flows\`, \`/flows/{id}/run\`
- **Agents** — \`/agents/runs\`
- **Integrations** — \`/integrations/{provider}\` (github, azure, jira, sentry, newrelic, slack, teams)
- **Webhooks** — \`/webhooks/pr-merged\`, \`/webhooks/sentry\`, \`/webhooks/newrelic\`
- **Analytics** — \`/analytics/dora\`, \`/analytics/usage\`
- **Billing** — \`/billing/subscribe\`, \`/billing/portal\`

## Rate Limits

- Free tier: 60 req/min
- Pro tier: 600 req/min
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

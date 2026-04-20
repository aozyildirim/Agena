const SITE = 'https://agena.dev';

const md = `# @agena/sdk — TypeScript Client

Full HTML: ${SITE}/sdk

## Install

\`\`\`bash
npm install @agena/sdk
\`\`\`

## Quickstart

\`\`\`ts
import { AgenaClient } from '@agena/sdk';

const client = new AgenaClient({
  apiKey: process.env.AGENA_API_KEY!,
  baseUrl: 'https://api.agena.dev',
});

const task = await client.tasks.create({
  title: 'Add dark mode toggle',
  description: 'Add a theme switcher to the navbar.',
  repo_mapping_ids: [12],
});

await client.tasks.assign(task.id, { repo_mapping_ids: [12] });
\`\`\`

## Reference

- \`tasks.create / list / get / assign / cancel\`
- \`flows.run / list / get\`
- \`integrations.github / azure / jira / sentry / newrelic\`
- \`agents.runs.list\`

## Source

https://github.com/aozyildirim/Agena/tree/main/packages/sdk
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

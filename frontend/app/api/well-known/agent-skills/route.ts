import { createHash } from 'node:crypto';

const SITE = 'https://agena.dev';

const skillBodies: Record<string, string> = {
  'create-task': `# Create Task Skill

POST https://api.agena.dev/tasks
Authorization: Bearer <jwt>
Content-Type: application/json

{
  "title": "string",
  "description": "string",
  "priority": "low|medium|high|critical",
  "repo_mapping_ids": [number]
}
`,
  'assign-task': `# Assign Task Skill

POST https://api.agena.dev/tasks/{task_id}/assign
Authorization: Bearer <jwt>
Content-Type: application/json

{ "repo_mapping_ids": [number] }

Fans out one Redis job per repo. Each PR is created independently.
`,
  'run-flow': `# Run Flow Skill

POST https://api.agena.dev/flows/{flow_id}/run
Authorization: Bearer <jwt>
Content-Type: application/json

{ "inputs": { "key": "value" } }
`,
  'import-sentry': `# Import Sentry Issues Skill

POST https://api.agena.dev/tasks/import/sentry
Authorization: Bearer <jwt>

Pulls unresolved Sentry issues and creates deduplicated AGENA tasks.
`,
  'import-newrelic': `# Import New Relic Errors Skill

POST https://api.agena.dev/tasks/import/newrelic
Authorization: Bearer <jwt>

Pulls error groups from mapped NR entities and creates tasks.
`,
};

function sha256(s: string): string {
  return 'sha256-' + createHash('sha256').update(s).digest('base64');
}

export async function GET() {
  const skills = Object.entries(skillBodies).map(([name, body]) => ({
    name,
    type: 'http-api',
    description: body.split('\n')[0].replace(/^#\s*/, ''),
    url: `${SITE}/.well-known/agent-skills/${name}/SKILL.md`,
    digest: sha256(body),
  }));

  const index = {
    $schema: 'https://agentskills.io/schema/v0.2.0/index.json',
    version: '0.2.0',
    publisher: {
      name: 'AGENA',
      url: SITE,
    },
    skills,
  };

  return new Response(JSON.stringify(index, null, 2), {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'public, max-age=3600, s-maxage=3600',
      'Access-Control-Allow-Origin': '*',
    },
  });
}

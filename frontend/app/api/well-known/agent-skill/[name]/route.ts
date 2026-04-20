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

export async function GET(_req: Request, { params }: { params: { name: string } }) {
  const body = skillBodies[params.name];
  if (!body) {
    return new Response('Skill not found\n', { status: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  }
  return new Response(body, {
    headers: {
      'Content-Type': 'text/markdown; charset=utf-8',
      'Cache-Control': 'public, max-age=3600, s-maxage=3600',
      'Access-Control-Allow-Origin': '*',
    },
  });
}

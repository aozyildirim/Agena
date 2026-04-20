const SITE = 'https://agena.dev';
const API = 'https://api.agena.dev';

export async function GET() {
  const card = {
    $schema: 'https://modelcontextprotocol.io/schema/server-card/v1',
    serverInfo: {
      name: 'agena-mcp',
      version: '0.9.0',
      title: 'AGENA MCP Server',
      description:
        'Model Context Protocol server for AGENA — agentic AI platform for autonomous code generation, multi-repo PR orchestration, sprint refinement, and DORA analytics.',
      vendor: 'AGENA',
      homepage: SITE,
      documentation: `${SITE}/docs`,
      license: 'MIT',
      sourceCode: 'https://github.com/aozyildirim/Agena',
    },
    transport: {
      type: 'http',
      endpoint: `${API}/mcp`,
      authentication: {
        type: 'oauth2',
        authorization_servers: [API],
        scopes: ['tasks:read', 'tasks:write', 'agents:read', 'agents:write'],
      },
    },
    capabilities: {
      tools: {
        listChanged: true,
      },
      resources: {
        subscribe: true,
        listChanged: true,
      },
      prompts: {
        listChanged: true,
      },
      logging: {},
    },
    tools: [
      {
        name: 'create_task',
        description: 'Create a new AGENA task and optionally assign it to AI agents.',
      },
      {
        name: 'list_tasks',
        description: 'List tasks for the authenticated organization.',
      },
      {
        name: 'assign_task',
        description: 'Dispatch a task to one or more repositories for AI execution.',
      },
      {
        name: 'get_pr_status',
        description: 'Get the PR status for a task across all assigned repositories.',
      },
      {
        name: 'run_flow',
        description: 'Trigger a visual automation flow by ID with optional input variables.',
      },
      {
        name: 'import_sentry_issues',
        description: 'Import Sentry issues as AGENA tasks.',
      },
      {
        name: 'import_newrelic_errors',
        description: 'Import New Relic errors as AGENA tasks.',
      },
    ],
    resources: [
      {
        uri: 'agena://tasks',
        name: 'Tasks',
        description: 'All tasks for the authenticated organization.',
      },
      {
        uri: 'agena://flows',
        name: 'Flows',
        description: 'Visual automation flows.',
      },
      {
        uri: 'agena://repos',
        name: 'Repositories',
        description: 'Connected GitHub / Azure DevOps repositories.',
      },
    ],
  };

  return new Response(JSON.stringify(card, null, 2), {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'public, max-age=3600, s-maxage=3600',
      'Access-Control-Allow-Origin': '*',
    },
  });
}

const SITE = 'https://agena.dev';
const API = 'https://api.agena.dev';

export async function GET() {
  const meta = {
    resource: API,
    resource_name: 'AGENA API',
    resource_documentation: `${SITE}/api-docs`,
    authorization_servers: [API],
    jwks_uri: `${API}/.well-known/jwks.json`,
    bearer_methods_supported: ['header'],
    resource_signing_alg_values_supported: ['RS256', 'HS256'],
    scopes_supported: [
      'tasks:read',
      'tasks:write',
      'flows:read',
      'flows:write',
      'agents:read',
      'agents:write',
      'integrations:read',
      'integrations:write',
      'analytics:read',
      'webhooks:write',
    ],
    resource_policy_uri: `${SITE}/privacy`,
    resource_tos_uri: `${SITE}/terms`,
  };

  return new Response(JSON.stringify(meta, null, 2), {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'public, max-age=3600, s-maxage=3600',
      'Access-Control-Allow-Origin': '*',
    },
  });
}

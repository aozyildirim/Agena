const ISSUER = 'https://api.agena.dev';

export async function GET() {
  const config = {
    issuer: ISSUER,
    authorization_endpoint: `${ISSUER}/auth/authorize`,
    token_endpoint: `${ISSUER}/auth/token`,
    jwks_uri: `${ISSUER}/.well-known/jwks.json`,
    registration_endpoint: `${ISSUER}/auth/register`,
    revocation_endpoint: `${ISSUER}/auth/revoke`,
    introspection_endpoint: `${ISSUER}/auth/introspect`,
    response_types_supported: ['code', 'token'],
    response_modes_supported: ['query', 'fragment', 'form_post'],
    grant_types_supported: [
      'authorization_code',
      'refresh_token',
      'password',
      'client_credentials',
    ],
    token_endpoint_auth_methods_supported: [
      'client_secret_basic',
      'client_secret_post',
      'none',
    ],
    code_challenge_methods_supported: ['S256', 'plain'],
    scopes_supported: [
      'tasks:read',
      'tasks:write',
      'flows:read',
      'flows:write',
      'agents:read',
      'agents:write',
      'integrations:read',
      'integrations:write',
    ],
    service_documentation: 'https://agena.dev/docs',
  };

  return new Response(JSON.stringify(config, null, 2), {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'public, max-age=3600, s-maxage=3600',
      'Access-Control-Allow-Origin': '*',
    },
  });
}

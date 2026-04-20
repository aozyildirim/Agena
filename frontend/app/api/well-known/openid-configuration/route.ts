const ISSUER = 'https://api.agena.dev';

export async function GET() {
  const config = {
    issuer: ISSUER,
    authorization_endpoint: `${ISSUER}/auth/authorize`,
    token_endpoint: `${ISSUER}/auth/token`,
    userinfo_endpoint: `${ISSUER}/auth/userinfo`,
    jwks_uri: `${ISSUER}/.well-known/jwks.json`,
    registration_endpoint: `${ISSUER}/auth/register`,
    revocation_endpoint: `${ISSUER}/auth/revoke`,
    introspection_endpoint: `${ISSUER}/auth/introspect`,
    end_session_endpoint: `${ISSUER}/auth/logout`,
    response_types_supported: ['code', 'token', 'id_token', 'code id_token'],
    response_modes_supported: ['query', 'fragment', 'form_post'],
    grant_types_supported: [
      'authorization_code',
      'refresh_token',
      'password',
      'client_credentials',
    ],
    subject_types_supported: ['public'],
    id_token_signing_alg_values_supported: ['RS256', 'HS256'],
    token_endpoint_auth_methods_supported: [
      'client_secret_basic',
      'client_secret_post',
      'none',
    ],
    scopes_supported: [
      'openid',
      'profile',
      'email',
      'tasks:read',
      'tasks:write',
      'flows:read',
      'flows:write',
      'agents:read',
      'agents:write',
      'integrations:read',
      'integrations:write',
    ],
    claims_supported: [
      'sub',
      'iss',
      'aud',
      'exp',
      'iat',
      'email',
      'email_verified',
      'name',
      'organization_id',
      'role',
    ],
    code_challenge_methods_supported: ['S256', 'plain'],
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

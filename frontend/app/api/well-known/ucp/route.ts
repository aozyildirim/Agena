const SITE = 'https://agena.dev';
const API = 'https://api.agena.dev';
const UCP_VERSION = '2026-04-08';
const UCP_SPEC = `https://ucp.dev/${UCP_VERSION}`;

export async function GET() {
  const profile = {
    ucp: {
      version: UCP_VERSION,
      services: {
        'dev.ucp.shopping': [
          {
            version: UCP_VERSION,
            spec: `${UCP_SPEC}/specification/overview`,
            transport: 'rest',
            endpoint: `${API}/ucp/shopping`,
            schema: `${UCP_SPEC}/services/shopping/rest.openapi.json`,
          },
        ],
        'dev.ucp.subscriptions': [
          {
            version: UCP_VERSION,
            spec: `${UCP_SPEC}/specification/overview`,
            transport: 'rest',
            endpoint: `${API}/billing`,
            schema: `${UCP_SPEC}/services/subscriptions/rest.openapi.json`,
          },
        ],
      },
      capabilities: {
        'dev.ucp.shopping.checkout': [
          {
            version: UCP_VERSION,
            spec: `${UCP_SPEC}/specification/checkout`,
            schema: `${UCP_SPEC}/schemas/shopping/checkout.json`,
          },
        ],
        'dev.ucp.subscriptions.recurring': [
          {
            version: UCP_VERSION,
            spec: `${UCP_SPEC}/specification/subscriptions`,
            schema: `${UCP_SPEC}/schemas/subscriptions/recurring.json`,
          },
        ],
      },
      payment_handlers: {
        card: { providers: ['stripe', 'iyzico'] },
        subscription: { providers: ['stripe', 'iyzico'] },
      },
    },
    publisher: {
      name: 'AGENA',
      url: SITE,
      contact: 'mailto:hello@agena.dev',
    },
    endpoints: {
      checkout: `${API}/billing/checkout`,
      subscribe: `${API}/billing/subscribe`,
      portal: `${API}/billing/portal`,
      health: `${API}/health`,
    },
    auth: {
      oauth_protected_resource: `${SITE}/.well-known/oauth-protected-resource`,
      openid_configuration: `${SITE}/.well-known/openid-configuration`,
    },
    signing_keys: [],
  };

  return new Response(JSON.stringify(profile, null, 2), {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'public, max-age=300, s-maxage=300',
      'Access-Control-Allow-Origin': '*',
    },
  });
}

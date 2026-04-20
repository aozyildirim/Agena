const SITE = 'https://agena.dev';
const API = 'https://api.agena.dev';

export async function GET() {
  const profile = {
    $schema: 'https://ucp.dev/specification/v1/profile.schema.json',
    protocol: {
      name: 'ucp',
      version: '1.0',
    },
    publisher: {
      name: 'AGENA',
      url: SITE,
      contact: 'mailto:hello@agena.dev',
    },
    services: [
      {
        name: 'agena-api',
        type: 'api',
        endpoint: API,
        description: 'AGENA REST API for tasks, flows, agents, integrations.',
        documentation: `${SITE}/api-docs`,
      },
    ],
    capabilities: {
      payments: {
        currencies: ['USD', 'EUR', 'TRY'],
        providers: ['stripe', 'iyzico'],
        methods: ['card', 'subscription'],
      },
      content: {
        pricing_url: `${SITE}/pricing`,
        billing_portal: `${API}/billing/portal`,
        catalog: [
          {
            sku: 'agena-pro-monthly',
            name: 'AGENA Pro (monthly)',
            price: { amount: '49.00', currency: 'USD', interval: 'month' },
            includes: ['unlimited tasks', 'priority workers', 'team invites'],
          },
          {
            sku: 'agena-free',
            name: 'AGENA Free',
            price: { amount: '0.00', currency: 'USD', interval: 'month' },
            includes: ['5 tasks / month', 'community support'],
          },
        ],
      },
      auth: {
        oauth_protected_resource: `${SITE}/.well-known/oauth-protected-resource`,
        openid_configuration: `${SITE}/.well-known/openid-configuration`,
      },
    },
    endpoints: {
      checkout: `${API}/billing/checkout`,
      subscribe: `${API}/billing/subscribe`,
      portal: `${API}/billing/portal`,
      health: `${API}/health`,
    },
  };

  return new Response(JSON.stringify(profile, null, 2), {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'public, max-age=3600, s-maxage=3600',
      'Access-Control-Allow-Origin': '*',
    },
  });
}

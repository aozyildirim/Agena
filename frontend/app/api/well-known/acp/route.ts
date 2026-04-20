const SITE = 'https://agena.dev';
const API = 'https://api.agena.dev';

export async function GET() {
  const acp = {
    protocol: {
      name: 'acp',
      version: '0.1.0',
    },
    publisher: {
      name: 'AGENA',
      url: SITE,
      contact: 'mailto:hello@agena.dev',
    },
    api_base_url: `${API}/acp`,
    transports: ['https'],
    capabilities: {
      services: [
        {
          name: 'subscriptions',
          description: 'Subscribe to AGENA plans (Pro, Enterprise) via Stripe or Iyzico.',
          endpoints: {
            list_plans: `${API}/billing/plans`,
            create_checkout: `${API}/billing/checkout`,
            manage: `${API}/billing/portal`,
          },
        },
        {
          name: 'usage_topup',
          description: 'Buy additional task credits beyond the included quota.',
          endpoints: {
            list_packs: `${API}/billing/packs`,
            buy: `${API}/billing/topup`,
          },
        },
      ],
      payment_methods: ['card', 'apple_pay', 'google_pay'],
      currencies: ['USD', 'EUR', 'TRY'],
      auth: {
        scheme: 'Bearer',
        oauth_protected_resource: `${SITE}/.well-known/oauth-protected-resource`,
      },
    },
    documentation: `${SITE}/docs`,
    terms_of_service: `${SITE}/terms`,
    privacy_policy: `${SITE}/privacy`,
  };

  return new Response(JSON.stringify(acp, null, 2), {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'public, max-age=3600, s-maxage=3600',
      'Access-Control-Allow-Origin': '*',
    },
  });
}

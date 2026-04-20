const SITE = 'https://agena.dev';
const API = 'https://api.agena.dev';

export async function GET() {
  const linkset = {
    linkset: [
      {
        anchor: API,
        'service-desc': [
          { href: `${API}/openapi.json`, type: 'application/json' },
        ],
        'service-doc': [
          { href: `${SITE}/api-docs`, type: 'text/html' },
          { href: `${API}/docs`, type: 'text/html' },
        ],
        'service-meta': [
          { href: `${SITE}/.well-known/oauth-protected-resource`, type: 'application/json' },
        ],
        status: [
          { href: `${SITE}/status`, type: 'text/html' },
          { href: `${API}/health`, type: 'application/json' },
        ],
        'terms-of-service': [
          { href: `${SITE}/terms`, type: 'text/html' },
        ],
        license: [
          { href: 'https://opensource.org/licenses/MIT', type: 'text/html' },
        ],
      },
      {
        anchor: `${API}/sdk`,
        describedby: [
          { href: `${SITE}/sdk`, type: 'text/html' },
        ],
        item: [
          { href: 'https://www.npmjs.com/package/@agena/sdk', type: 'text/html' },
        ],
      },
    ],
  };

  return new Response(JSON.stringify(linkset, null, 2), {
    headers: {
      'Content-Type': 'application/linkset+json; charset=utf-8',
      'Cache-Control': 'public, max-age=3600, s-maxage=3600',
      'Access-Control-Allow-Origin': '*',
    },
  });
}

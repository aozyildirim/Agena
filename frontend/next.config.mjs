import { createRequire } from 'node:module';

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  eslint: {
    ignoreDuringBuilds: true,
  },
  typescript: {
    ignoreBuildErrors: true,
  },
  async redirects() {
    return [
      { source: '/login', destination: '/signin', permanent: true },
      { source: '/register', destination: '/signup', permanent: true },
      { source: '/sign-up', destination: '/signup', permanent: true },
      { source: '/sign-in', destination: '/signin', permanent: true },
      { source: '/features', destination: '/use-cases', permanent: true },
      { source: '/about', destination: '/', permanent: false },
      { source: '/documentation', destination: '/docs', permanent: true },
    ];
  },
  async rewrites() {
    return [
      { source: '/.well-known/api-catalog', destination: '/api/well-known/api-catalog' },
      { source: '/.well-known/openid-configuration', destination: '/api/well-known/openid-configuration' },
      { source: '/.well-known/oauth-authorization-server', destination: '/api/well-known/oauth-authorization-server' },
      { source: '/.well-known/oauth-protected-resource', destination: '/api/well-known/oauth-protected-resource' },
      { source: '/.well-known/mcp/server-card.json', destination: '/api/well-known/mcp-server-card' },
      { source: '/.well-known/agent-skills/index.json', destination: '/api/well-known/agent-skills' },
      { source: '/.well-known/agent-skills/:name/SKILL.md', destination: '/api/well-known/agent-skill/:name' },
      { source: '/.well-known/ucp', destination: '/api/well-known/ucp' },
      { source: '/.well-known/acp.json', destination: '/api/well-known/acp' },
    ];
  },
  async headers() {
    const agentDiscoveryLinks = [
      '</.well-known/api-catalog>; rel="api-catalog"; type="application/linkset+json"',
      '</api-docs>; rel="service-doc"; type="text/html"',
      '<https://api.agena.dev/openapi.json>; rel="service-desc"; type="application/json"',
      '</status>; rel="status"; type="text/html"',
      '</.well-known/oauth-protected-resource>; rel="http://openid.net/specs/connect/1.0/issuer"; type="application/json"',
      '</.well-known/mcp/server-card.json>; rel="mcp-server-card"; type="application/json"',
      '</.well-known/agent-skills/index.json>; rel="agent-skills-index"; type="application/json"',
      '</llms.txt>; rel="describedby"; type="text/plain"',
    ].join(', ');

    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-XSS-Protection', value: '1; mode=block' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
          { key: 'Vary', value: 'Accept' },
        ],
      },
      {
        source: '/',
        headers: [
          { key: 'Link', value: agentDiscoveryLinks },
        ],
      },
      {
        source: '/(.*)\\.(js|css|woff2?|png|jpg|svg|ico|webp)',
        headers: [
          { key: 'Cache-Control', value: 'public, max-age=31536000, immutable' },
        ],
      },
    ];
  },
};

let exportedConfig = nextConfig;

const isDev = process.env.NODE_ENV === 'development';
const disableSentry = isDev || process.env.DISABLE_SENTRY === '1';

const require = createRequire(import.meta.url);
let withSentryConfig = null;
if (!disableSentry) {
  try {
    require.resolve('@sentry/nextjs/package.json');
    ({ withSentryConfig } = await import('@sentry/nextjs'));
  } catch {
    // Keep frontend booting even if Sentry dependency is not present yet.
  }
}

if (withSentryConfig) {
  exportedConfig = withSentryConfig(nextConfig, {
    silent: true,
    disableLogger: true,
    widenClientFileUpload: true,
    org: process.env.SENTRY_ORG || undefined,
    project: process.env.SENTRY_PROJECT || undefined,
    authToken: process.env.SENTRY_AUTH_TOKEN || undefined,
  });
}

export default exportedConfig;

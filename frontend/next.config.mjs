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
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-XSS-Protection', value: '1; mode=block' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
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

const require = createRequire(import.meta.url);
let withSentryConfig = null;
try {
  require.resolve('@sentry/nextjs/package.json');
  ({ withSentryConfig } = await import('@sentry/nextjs'));
} catch {
  // Keep frontend booting even if Sentry dependency is not present yet.
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

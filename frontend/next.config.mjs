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
export default exportedConfig;

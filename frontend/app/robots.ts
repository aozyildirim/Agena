import { MetadataRoute } from 'next';

// Anything tenant-scoped or credential-entry. `/share/` and `/tasks/` carry
// customer work-item content, so they must never land in an index.
const DISALLOW = [
  '/dashboard/',
  '/api/',
  '/signin',
  '/signup',
  '/invite/',
  '/share/',
  '/tasks/',
  '/auth/',
];

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: DISALLOW,
      },
      {
        userAgent: 'Googlebot',
        allow: '/',
        disallow: DISALLOW,
      },
      {
        userAgent: 'Bingbot',
        allow: '/',
        disallow: DISALLOW,
      },
    ],
    sitemap: 'https://agena.dev/sitemap.xml',
    host: 'https://agena.dev',
  };
}

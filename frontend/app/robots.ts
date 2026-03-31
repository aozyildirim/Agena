import { MetadataRoute } from 'next';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: ['/dashboard/', '/api/', '/signin', '/signup', '/invite/'],
      },
    ],
    sitemap: 'https://agena.dev/sitemap.xml',
  };
}
